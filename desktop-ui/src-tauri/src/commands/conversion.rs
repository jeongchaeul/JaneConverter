use crate::commands::social::{
    close_all_social_captures, close_facebook_capture_session, close_idle_facebook_captures,
    refresh_facebook_candidates, valid_capture_id,
};
use crate::facebook_capture;
use crate::model::{self, ConversionRequest, ConverterEvent};
use crate::paths::{self, settings_get_internal};
use crate::process::{
    self, emit_event, load_playlist as load_playlist_engine, set_child_paused,
    start_conversion as start_engine_conversion, terminate_child, ConversionSlots,
};
use crate::social_photo_capture;
use crate::AppState;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::State;

pub fn active_capture_path(
    state: &AppState,
    source: &str,
    requested_path: Option<&str>,
) -> Option<PathBuf> {
    let captured = state.access.lock().ok().and_then(|value| {
        value
            .as_ref()
            .and_then(|server| server.captured_media_path(source, requested_path))
    });
    if captured.is_some() || !source.trim().is_empty() {
        return captured;
    }

    let requested = requested_path?.trim();
    let root = fs::canonicalize(settings_get_internal().fetched_dir).ok()?;
    let target = fs::canonicalize(requested).ok()?;
    (target.starts_with(root) && target.is_file()).then_some(target)
}

pub fn job_is_active(active_job: Option<&str>, requested_job: &str) -> bool {
    active_job == Some(requested_job.trim())
}

#[tauri::command]
pub fn start_conversion(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: ConversionRequest,
) -> Result<String, String> {
    if request.facebook_capture_id.is_some() && request.social_capture_id.is_some() {
        return Err("Use only one public photo capture for a conversion.".into());
    }
    close_all_social_captures(&state.social_captures);
    if state
        .active_child
        .lock()
        .map_err(|_| "The conversion registry is unavailable.")?
        .is_some()
    {
        return Err("A conversion is already running.".into());
    }
    state.active_paused.store(false, Ordering::Relaxed);
    let facebook_capture_id = request.facebook_capture_id.clone();
    let social_capture_id = request.social_capture_id.clone();
    close_idle_facebook_captures(&state.facebook_captures, facebook_capture_id.as_deref());
    let facebook_session = {
        let captures = state
            .facebook_captures
            .lock()
            .map_err(|_| "The Facebook capture registry is unavailable.")?;
        if let Some(capture_id) = facebook_capture_id.as_deref() {
            if !valid_capture_id(capture_id) || !captures.contains_key(capture_id) {
                return Err(
                    "The Facebook photo capture has expired. Capture the album again.".into(),
                );
            }
            let session = captures
                .get(capture_id)
                .cloned()
                .ok_or_else(|| "The Facebook guest session has expired.".to_string())?;
            if session.created.elapsed() >= Duration::from_secs(600)
                || session.in_use.load(Ordering::Relaxed)
            {
                return Err("The Facebook guest session has expired or is already in use.".into());
            }
            Some((capture_id.to_owned(), session))
        } else {
            None
        }
    };
    let facebook_manifest = if let Some(capture_id) = facebook_capture_id.as_deref() {
        if !valid_capture_id(capture_id) {
            return Err("The Facebook photo capture has expired. Capture the album again.".into());
        }
        let ready = state
            .facebook_manifests
            .lock()
            .map_err(|_| "The Facebook photo manifest registry is unavailable.")?
            .get(capture_id)
            .cloned()
            .ok_or_else(|| {
                "The Facebook photo capture has expired. Capture the album again.".to_string()
            })?;
        if ready.0 != request.source.trim() || ready.2.elapsed() >= Duration::from_secs(600) {
            return Err(
                "The Facebook photo capture no longer matches this link. Capture the album again."
                    .into(),
            );
        }
        if facebook_capture::validate_post_url(&request.source).is_err() {
            return Err(
                "The Facebook photo capture no longer matches a Facebook post link.".into(),
            );
        }
        Some(ready.1)
    } else {
        None
    };
    let social_manifest = if let Some(capture_id) = request.social_capture_id.clone() {
        if !valid_capture_id(&capture_id) {
            return Err("The public photo capture has expired. Capture the post again.".into());
        }
        let ready = state
            .social_manifests
            .lock()
            .map_err(|_| "The public photo manifest registry is unavailable.")?
            .remove(&capture_id)
            .ok_or_else(|| {
                "The public photo capture has expired. Capture the post again.".to_string()
            })?;
        let (platform, _) = social_photo_capture::validate_post_url(&request.source)?;
        if ready.0 != request.source.trim() || ready.2.elapsed() >= Duration::from_secs(600) {
            return Err(
                "The photo capture no longer matches this link. Capture the post again.".into(),
            );
        }
        if ready.1.platform != platform.key() {
            return Err("The photo capture no longer matches this platform link.".into());
        }
        Some(ready.1)
    } else {
        None
    };
    let job_id = format!(
        "conversion-{}-{}",
        paths::now_stamp(),
        state.sequence.fetch_add(1, Ordering::Relaxed)
    );
    let child_slot = Arc::clone(&state.active_child);
    let cancel_slot = Arc::clone(&state.active_cancel);
    let active_job_slot = Arc::clone(&state.active_job);
    let child_slot_for_worker = Arc::clone(&child_slot);
    let cancel_slot_for_worker = Arc::clone(&cancel_slot);
    let active_job_for_worker = Arc::clone(&active_job_slot);
    let paused_for_worker = Arc::clone(&state.active_paused);
    let completed_job_id = job_id.clone();
    let browser = request.browser_session.clone();
    let capture_path = active_capture_path(
        &state,
        &request.source,
        request.browser_capture_path.as_deref(),
    );

    if let Some((capture_id, expected_session)) = &facebook_session {
        let captures = state
            .facebook_captures
            .lock()
            .map_err(|_| "The Facebook capture registry is unavailable.")?;
        let current = captures
            .get(capture_id)
            .ok_or_else(|| "The Facebook guest session has expired.".to_string())?;
        if current.created != expected_session.created
            || current.created.elapsed() >= Duration::from_secs(600)
            || current.in_use.load(Ordering::Relaxed)
        {
            return Err("The Facebook guest session has expired or is already in use.".into());
        }
        current.in_use.store(true, Ordering::Relaxed);
    }

    let retry_manifest = facebook_manifest.clone();
    let retry_social_manifest = social_manifest.clone();
    let storage_guard = match state.storage_operation.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::WouldBlock) => {
            if let Some((_, session)) = &facebook_session {
                session.in_use.store(false, Ordering::Relaxed);
            }
            return Err("A library or fetched-folder move is in progress.".into());
        }
        Err(std::sync::TryLockError::Poisoned(_)) => {
            if let Some((_, session)) = &facebook_session {
                session.in_use.store(false, Ordering::Relaxed);
            }
            return Err("The storage operation registry is unavailable.".into());
        }
    };
    let mut active_job = match active_job_slot.lock() {
        Ok(value) => value,
        Err(_) => {
            if let Some((_, session)) = &facebook_session {
                session.in_use.store(false, Ordering::Relaxed);
            }
            return Err("The conversion registry is unavailable.".into());
        }
    };
    if active_job.is_some() {
        if let Some((_, session)) = &facebook_session {
            session.in_use.store(false, Ordering::Relaxed);
        }
        return Err("A conversion is already running.".into());
    }
    *active_job = Some(job_id.clone());
    drop(active_job);
    drop(storage_guard);
    if let Some(capture_id) = facebook_capture_id.as_deref() {
        if let Ok(mut manifests) = state.facebook_manifests.lock() {
            manifests.remove(capture_id);
        }
    }
    let facebook_refresh = facebook_capture_id.as_ref().map(|capture_id| {
        let captures = Arc::clone(&state.facebook_captures);
        let capture_id = capture_id.clone();
        Arc::new(move |request_id: &str, photo_id: &str| {
            refresh_facebook_candidates(&captures, &capture_id, request_id, photo_id)
        }) as process::FacebookRefreshHandler
    });
    let captures_for_worker = Arc::clone(&state.facebook_captures);
    let manifests_for_worker = Arc::clone(&state.facebook_manifests);
    let completed_facebook_capture_id = facebook_capture_id.clone();
    let source_for_retry = request.source.trim().to_owned();
    if let Err(error) = start_engine_conversion(
        app,
        job_id.clone(),
        request,
        browser,
        capture_path,
        facebook_manifest,
        social_manifest,
        ConversionSlots {
            child: child_slot,
            cancel: cancel_slot,
            facebook_refresh,
        },
        move |_code, _cancelled| {
            paused_for_worker.store(false, Ordering::Relaxed);
            if let Ok(mut value) = child_slot_for_worker.lock() {
                *value = None;
            }
            if let Ok(mut value) = cancel_slot_for_worker.lock() {
                *value = None;
            }
            if let Ok(mut value) = active_job_for_worker.lock() {
                if value.as_deref() == Some(completed_job_id.as_str()) {
                    *value = None;
                }
            }
            if let Some(capture_id) = completed_facebook_capture_id.as_deref() {
                close_facebook_capture_session(&captures_for_worker, capture_id);
                if let Ok(mut manifests) = manifests_for_worker.lock() {
                    manifests.remove(capture_id);
                }
            }
        },
    ) {
        if let Ok(mut active_job) = active_job_slot.lock() {
            if active_job.as_deref() == Some(job_id.as_str()) {
                *active_job = None;
            }
        }
        if let (Some(capture_id), Some(manifest)) = (&facebook_capture_id, &retry_manifest) {
            if let Ok(captures) = state.facebook_captures.lock() {
                if let Some(session) = captures.get(capture_id) {
                    session.in_use.store(false, Ordering::Relaxed);
                    if let Ok(mut manifests) = state.facebook_manifests.lock() {
                        manifests.insert(
                            capture_id.clone(),
                            (source_for_retry.clone(), manifest.clone(), Instant::now()),
                        );
                    }
                }
            }
        }
        if let (Some(capture_id), Some(manifest)) = (&social_capture_id, &retry_social_manifest) {
            if let Ok(mut manifests) = state.social_manifests.lock() {
                manifests.insert(
                    capture_id.clone(),
                    (source_for_retry.clone(), manifest.clone(), Instant::now()),
                );
            }
        }
        return Err(error);
    }
    Ok(job_id)
}

fn set_active_operation_paused(
    app: &tauri::AppHandle,
    state: &AppState,
    job_id: Option<&str>,
    paused: bool,
) -> Result<(), String> {
    let active_job = state
        .active_job
        .lock()
        .map_err(|_| "The conversion registry is unavailable.")?
        .clone();
    if let Some(requested_job) = job_id.map(str::trim).filter(|id| !id.is_empty()) {
        if active_job.is_some() && !job_is_active(active_job.as_deref(), requested_job) {
            return Err("That conversion is no longer active.".into());
        }
    }
    let child = state
        .active_child
        .lock()
        .map_err(|_| "The conversion registry is unavailable.")?
        .clone();
    let mut updated_any = false;
    if let Some(child) = child {
        let mut guard = child
            .lock()
            .map_err(|_| "The conversion process is unavailable.")?;
        set_child_paused(&mut guard, paused)?;
        updated_any = true;
    }
    let pause_script = if paused {
        "window.__JANE_CAPTURE_PAUSED__ = true;"
    } else {
        "window.__JANE_CAPTURE_PAUSED__ = false;"
    };
    if let Ok(captures) = state.facebook_captures.lock() {
        for session in captures.values() {
            let _ = session.window.eval(pause_script);
            updated_any = true;
        }
    }
    if let Ok(captures) = state.social_captures.lock() {
        for window in captures.values() {
            let _ = window.eval(pause_script);
            updated_any = true;
        }
    }
    state.active_paused.store(paused, Ordering::Relaxed);
    if updated_any {
        if let Some(active_id) = active_job {
            emit_event(
                app,
                ConverterEvent {
                    job_id: active_id,
                    kind: "status".into(),
                    message: if paused {
                        "Operation paused.".into()
                    } else {
                        "Operation resumed.".into()
                    },
                    progress: None,
                    output: None,
                },
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub fn pause_conversion(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    job_id: Option<String>,
) -> Result<(), String> {
    set_active_operation_paused(&app, &state, job_id.as_deref(), true)
}

#[tauri::command]
pub fn resume_conversion(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    job_id: Option<String>,
) -> Result<(), String> {
    set_active_operation_paused(&app, &state, job_id.as_deref(), false)
}

#[tauri::command]
pub fn cancel_conversion(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
    if job_id.trim().is_empty() {
        return Err("The conversion id is missing.".into());
    }
    let active_job = state
        .active_job
        .lock()
        .map_err(|_| "The conversion registry is unavailable.")?
        .clone();
    if !job_is_active(active_job.as_deref(), &job_id) {
        return Err("That conversion is no longer active.".into());
    }
    state.active_paused.store(false, Ordering::Relaxed);
    let cancel = state
        .active_cancel
        .lock()
        .map_err(|_| "The cancellation registry is unavailable.")?
        .clone();
    let child = state
        .active_child
        .lock()
        .map_err(|_| "The conversion registry is unavailable.")?
        .clone();
    let Some(cancel) = cancel else {
        return Err("No conversion is running.".into());
    };
    cancel.store(true, Ordering::Relaxed);
    if let Some(child) = child {
        if let Ok(mut value) = child.lock() {
            terminate_child(&mut value);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn load_playlist(
    state: State<'_, AppState>,
    source: String,
) -> Result<model::PlaylistCatalog, String> {
    let settings = settings_get_internal();
    let allow_story = settings.allow_story_extraction;
    let browser = if settings.read_browser_cookies {
        settings.browser_session
    } else {
        Some("none".into())
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let slot = state.playlist_cancel.clone();
    {
        let mut current = slot
            .lock()
            .map_err(|_| "The playlist loader is unavailable.")?;
        if current.is_some() {
            return Err("A playlist is already loading. Cancel it before retrying.".into());
        }
        *current = Some(cancel.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        load_playlist_engine(&source, browser, allow_story, &cancel)
    })
    .await
    .map_err(|error| format!("Playlist loading stopped: {error}"));
    if let Ok(mut current) = slot.lock() {
        *current = None;
    }
    result?
}

#[tauri::command]
pub fn cancel_playlist(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(cancel) = state
        .playlist_cancel
        .lock()
        .map_err(|_| "The playlist loader is unavailable.")?
        .as_ref()
    {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}
