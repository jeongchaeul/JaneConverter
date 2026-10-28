use crate::access;
use crate::catalog;
use crate::library;
use crate::model::{AccessDiagnostic, AccessStatus, FetchedMedia};
use crate::paths::{self, settings_get_internal};
use crate::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

#[tauri::command]
pub fn create_access_link(
    state: State<'_, AppState>,
    source: String,
) -> Result<AccessStatus, String> {
    let settings = settings_get_internal();
    let server = access::create_with_root(
        &source,
        paths::now_stamp(),
        PathBuf::from(settings.fetched_dir),
    )?;
    let status = server.status();
    let mut access = state
        .access
        .lock()
        .map_err(|_| "The access registry is unavailable.")?;
    *access = Some(server);
    Ok(status)
}

#[tauri::command]
pub fn access_status(state: State<'_, AppState>) -> AccessStatus {
    state
        .access
        .lock()
        .ok()
        .and_then(|value| value.as_ref().map(access::AccessServer::status))
        .unwrap_or(AccessStatus {
            active: false,
            link: String::new(),
            browser: String::new(),
            source: None,
            bridge_connected: false,
            capture_count: 0,
            captured_media_kind: None,
        })
}

#[tauri::command]
pub fn fetched_media(state: State<'_, AppState>) -> Result<Vec<FetchedMedia>, String> {
    let fallback_root = PathBuf::from(settings_get_internal().fetched_dir);
    // Surface a catalog failure instead of silently replacing provenance with filenames.
    catalog::captures(&fallback_root.join("capture-catalog.json"))?;
    Ok(state
        .access
        .lock()
        .ok()
        .and_then(|value| value.as_ref().map(access::AccessServer::fetched_media))
        .unwrap_or_else(|| access::scan_fetched_media(&fallback_root)))
}

#[tauri::command]
pub fn access_diagnostics(state: State<'_, AppState>) -> Vec<AccessDiagnostic> {
    state
        .access
        .lock()
        .ok()
        .and_then(|value| value.as_ref().map(access::AccessServer::diagnostics))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn fetched_media_thumbnail(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<String>, String> {
    let active_root = state
        .access
        .lock()
        .map_err(|_| "The access registry is unavailable.".to_owned())?
        .as_ref()
        .map(|server| server.capture_root_path().to_string_lossy().into_owned());
    let root = active_root.unwrap_or_else(|| settings_get_internal().fetched_dir);
    tauri::async_runtime::spawn_blocking(move || library::thumbnail(&root, &path))
        .await
        .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub fn discard_fetched_media(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let _storage_guard = state
        .storage_operation
        .try_lock()
        .map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => "Another storage operation is already running.",
            std::sync::TryLockError::Poisoned(_) => {
                "The storage operation registry is unavailable."
            }
        })?;
    if state
        .active_job
        .lock()
        .map_err(|_| "The conversion registry is unavailable.")?
        .is_some()
    {
        return Err(
            "Wait for the active conversion to finish before discarding captured media.".into(),
        );
    }
    let fallback_root = settings_get_internal().fetched_dir;
    let access = state
        .access
        .lock()
        .map_err(|_| "The access registry is unavailable.".to_owned())?;
    match access.as_ref() {
        Some(server) => server.discard_fetched_media(&path),
        None => {
            let res = library::delete_inside(&fallback_root, &path);
            if res.is_ok() {
                let _ = crate::catalog::remove_capture(
                    &Path::new(&fallback_root).join("capture-catalog.json"),
                    Path::new(&path),
                );
            }
            res
        }
    }
}

#[tauri::command]
pub fn clear_access_link(state: State<'_, AppState>) -> Result<(), String> {
    let mut access = state
        .access
        .lock()
        .map_err(|_| "The access registry is unavailable.")?;
    *access = None;
    Ok(())
}
