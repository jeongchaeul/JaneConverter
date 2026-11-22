use crate::catalog;
use crate::library;
use crate::model::LibraryEntry;
use crate::paths::{data_root, project_root, settings_get_internal, write_settings};
use crate::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

#[tauri::command]
pub fn conversion_history(
    legacy: Vec<serde_json::Value>,
    entry: Option<serde_json::Value>,
    remove: Option<String>,
    clear: bool,
) -> Result<serde_json::Value, String> {
    let result = catalog::history(
        &data_root().join("catalog.json"),
        legacy,
        entry,
        remove.as_deref(),
        clear,
    )?;
    Ok(serde_json::json!({"history":result.history,"warning":result.warning}))
}

fn resolve_configured_root(raw: &str) -> PathBuf {
    let cleaned = library::clean_windows_path(raw.trim());
    let trimmed = PathBuf::from(&cleaned);
    if trimmed.is_absolute() {
        trimmed
    } else {
        project_root().join(trimmed)
    }
}

fn is_allowed_library_or_history_path(candidate: &str) -> Result<bool, String> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }
    let candidate_path = resolve_configured_root(trimmed);
    if !candidate_path.exists() {
        return Ok(false);
    }
    let canonical_target = fs::canonicalize(&candidate_path)
        .map_err(|error| format!("Could not resolve library path: {error}"))?;
    let settings = settings_get_internal();

    let mut allowed_roots = vec![
        resolve_configured_root(&settings.output_dir),
        resolve_configured_root(&settings.fetched_dir),
        data_root(),
        crate::paths::default_temp_dir(),
    ];
    if !settings.temp_dir.trim().is_empty() {
        allowed_roots.push(resolve_configured_root(&settings.temp_dir));
    }
    #[cfg(test)]
    allowed_roots.push(std::env::temp_dir());
    for export_path in catalog::load_history_paths(&data_root().join("catalog.json")) {
        if !export_path.trim().is_empty() {
            allowed_roots.push(resolve_configured_root(&export_path));
        }
    }

    if allowed_roots
        .iter()
        .any(|root| library::is_library_path(root, &canonical_target))
    {
        return Ok(true);
    }

    Err("For safety, JaneConverter can only access items inside the configured library or fetched directories.".into())
}

#[tauri::command]
pub async fn path_size(path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !is_allowed_library_or_history_path(&path)? {
            return Ok(0);
        }
        let resolved = resolve_configured_root(&path);
        Ok(library::path_total_bytes(&resolved.display().to_string()))
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub async fn scan_library(path: String) -> Result<Vec<LibraryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !is_allowed_library_or_history_path(&path)? {
            return Ok(Vec::new());
        }
        let resolved = resolve_configured_root(&path);
        library::scan(&resolved.display().to_string())
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub fn is_converted_library_path(path: String) -> bool {
    let root = resolve_configured_root(&settings_get_internal().output_dir);
    let candidate = resolve_configured_root(&path);
    library::is_library_path(&root, &candidate)
}

#[tauri::command]
pub async fn recent_conversions(path: String, limit: usize) -> Result<Vec<LibraryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !is_allowed_library_or_history_path(&path)? {
            return Ok(Vec::new());
        }
        let resolved = resolve_configured_root(&path);
        library::recent(&resolved.display().to_string(), limit)
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub async fn drag_library_file(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let settings = settings_get_internal();
        let file = library::draggable_media_file(&settings.output_dir, &path)?;
        let (sender, receiver) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let result = drag::start_drag(
                &window,
                drag::DragItem::Files(vec![file]),
                drag::Image::Raw(include_bytes!("../../../../assets/icon.png").to_vec()),
                |_, _| {},
                drag::Options {
                    mode: drag::DragMode::Copy,
                    ..drag::Options::default()
                },
            )
            .map_err(|error| format!("Could not start the file drag: {error}"));
            let _ = sender.send(result);
        })
        .map_err(|error| format!("Could not start the file drag: {error}"))?;
        receiver
            .recv()
            .map_err(|error| format!("Could not start the file drag: {error}"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, window, path);
        Err("Dragging library files into other apps is currently available on Windows.".into())
    }
}

#[tauri::command]
pub async fn get_thumbnail(root: String, path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !is_allowed_library_or_history_path(&root)? {
            return Ok(None);
        }
        let resolved_root = resolve_configured_root(&root);
        let resolved_path = resolve_configured_root(&path);
        library::thumbnail(
            &resolved_root.display().to_string(),
            &resolved_path.display().to_string(),
        )
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub async fn move_library(
    state: State<'_, AppState>,
    source: String,
    destination_parent: String,
) -> Result<library::MoveDirectoryResult, String> {
    let storage_operation = std::sync::Arc::clone(&state.storage_operation);
    let active_job = std::sync::Arc::clone(&state.active_job);
    tauri::async_runtime::spawn_blocking(move || {
        let _storage_guard = storage_operation.try_lock().map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => "Another storage operation is already running.",
            std::sync::TryLockError::Poisoned(_) => {
                "The storage operation registry is unavailable."
            }
        })?;
        if active_job
            .lock()
            .map_err(|_| "The conversion registry is unavailable.")?
            .is_some()
        {
            return Err("Wait for the active conversion to finish before moving the library.".into());
        }
        let mut settings = settings_get_internal();
        let configured = fs::canonicalize(settings.output_dir.trim())
            .map_err(|error| format!("The configured library is unavailable: {error}"))?;
        let requested = fs::canonicalize(source.trim())
            .map_err(|error| format!("The current library is unavailable: {error}"))?;
        if configured != requested {
            return Err("For safety, only the active converted library can be moved.".into());
        }
        write_settings(&settings).map_err(|error| {
            format!("JaneConverter could not verify that settings are writable: {error}")
        })?;
        let result = library::move_directory(&source, &destination_parent)?;
        settings.output_dir = result.destination.clone();
        write_settings(&settings).map_err(|error| {
            format!(
                "The library moved to {}, but JaneConverter could not save the new location: {error}",
                result.destination
            )
        })?;
        Ok(result)
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub async fn move_fetched_folder(
    state: State<'_, AppState>,
    source: String,
    destination_parent: String,
) -> Result<library::MoveDirectoryResult, String> {
    let storage_operation = std::sync::Arc::clone(&state.storage_operation);
    let active_job = std::sync::Arc::clone(&state.active_job);
    let access = std::sync::Arc::clone(&state.access);
    tauri::async_runtime::spawn_blocking(move || {
        let _storage_guard = storage_operation.try_lock().map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => "Another storage operation is already running.",
            std::sync::TryLockError::Poisoned(_) => {
                "The storage operation registry is unavailable."
            }
        })?;
        if active_job
            .lock()
            .map_err(|_| "The conversion registry is unavailable.")?
            .is_some()
        {
            return Err(
                "Wait for the active conversion to finish before moving captured media.".into(),
            );
        }
        if access
            .lock()
            .map_err(|_| "The access registry is unavailable.")?
            .is_some()
        {
            return Err("Clear browser access before moving the media capturer folder.".into());
        }

        let mut settings = settings_get_internal();
        let configured = fs::canonicalize(settings.fetched_dir.trim())
            .map_err(|error| format!("The configured media capturer folder is unavailable: {error}"))?;
        let requested = fs::canonicalize(source.trim())
            .map_err(|error| format!("The current media capturer folder is unavailable: {error}"))?;
        if configured != requested {
            return Err("For safety, only the active media capturer folder can be moved.".into());
        }
        write_settings(&settings).map_err(|error| {
            format!("JaneConverter could not verify that settings are writable: {error}")
        })?;
        let result = library::move_directory(&source, &destination_parent)?;
        settings.fetched_dir = result.destination.clone();
        write_settings(&settings).map_err(|error| {
            format!(
                "The media capturer folder moved to {}, but JaneConverter could not save the new location: {error}",
                result.destination
            )
        })?;
        Ok(result)
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

fn resolve_delete_target(canonical_root: &Path, path: &str) -> PathBuf {
    let cleaned = library::clean_windows_path(path);
    let target_path = Path::new(&cleaned);
    let direct_candidate = if target_path.is_absolute() {
        target_path.to_path_buf()
    } else {
        canonical_root.join(target_path)
    };
    if direct_candidate.exists() {
        return direct_candidate;
    }

    let parent_canon = direct_candidate
        .parent()
        .and_then(|parent| fs::canonicalize(parent).ok());
    let parent_is_root = parent_canon
        .as_ref()
        .map(|parent| parent == canonical_root)
        .unwrap_or(false);
    let parent_is_specific_subdir = parent_canon
        .as_ref()
        .map(|parent| parent != canonical_root && parent.starts_with(canonical_root))
        .unwrap_or(false);

    // Check alternate image/media extensions and numbered suffix only within the exact parent folder.
    if let (Some(parent), Some(stem)) = (direct_candidate.parent(), direct_candidate.file_stem()) {
        if parent.is_dir() {
            let stem_str = stem.to_string_lossy();
            for ext in [
                "png", "jpg", "jpeg", "webp", "avif", "mp4", "mkv", "mp3", "wav", "flac",
            ] {
                let candidate = parent.join(format!("{stem_str}.{ext}"));
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }
    let direct_str = direct_candidate.display().to_string();
    let stripped_self = library::strip_numbered_suffix(&direct_str);
    if stripped_self != direct_str {
        let candidate = PathBuf::from(&stripped_self);
        if candidate.exists() {
            return candidate;
        }
    }

    // Never jump across unrelated albums when the caller specified an existing subdirectory under root.
    if parent_is_specific_subdir {
        return direct_candidate;
    }

    if parent_is_root || !target_path.is_absolute() {
        if let Some(found) = target_path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|fname| library::find_file_in_dir_recursive(canonical_root, fname, 0, 5))
        {
            return found;
        }
    }
    direct_candidate
}

fn delete_entry_with_roots(
    root: &str,
    path: &str,
    configured_output_dir: &str,
    configured_fetched_dir: &str,
    has_active_job: bool,
) -> Result<(), String> {
    let canonical_root = fs::canonicalize(resolve_configured_root(root.trim()))
        .map_err(|error| format!("The library root is unavailable: {error}"))?;
    let canonical_out =
        fs::canonicalize(resolve_configured_root(configured_output_dir.trim())).ok();
    let canonical_fetch =
        fs::canonicalize(resolve_configured_root(configured_fetched_dir.trim())).ok();
    let is_valid_root = canonical_out
        .as_ref()
        .map(|o| o == &canonical_root || canonical_root.starts_with(o))
        .unwrap_or(false)
        || canonical_fetch
            .as_ref()
            .map(|f| f == &canonical_root || canonical_root.starts_with(f))
            .unwrap_or(false);

    if !is_valid_root {
        return Err("For safety, JaneConverter can only delete items inside the configured library or fetched directories.".into());
    }

    let resolved_target = resolve_delete_target(&canonical_root, path);
    if resolved_target.is_dir() && has_active_job {
        return Err(
            "Wait for the active conversion to finish before deleting library media folders."
                .into(),
        );
    }

    let effective_root = if let Ok(canon_target) = fs::canonicalize(&resolved_target) {
        if canon_target.starts_with(&canonical_root) && canon_target != canonical_root {
            canonical_root.clone()
        } else if let Some(out) = canonical_out
            .as_ref()
            .filter(|o| canon_target.starts_with(o) && &canon_target != *o)
        {
            out.clone()
        } else if let Some(fetch) = canonical_fetch
            .as_ref()
            .filter(|f| canon_target.starts_with(f) && &canon_target != *f)
        {
            fetch.clone()
        } else {
            canonical_root.clone()
        }
    } else {
        canonical_root.clone()
    };

    let effective_root_str = library::clean_windows_path(&effective_root.display().to_string());
    let resolved_target_str = library::clean_windows_path(&resolved_target.display().to_string());
    let res = library::delete_inside(&effective_root_str, &resolved_target_str);
    if res.is_ok() {
        let _ = crate::catalog::remove_capture(
            &effective_root.join("capture-catalog.json"),
            Path::new(&resolved_target_str),
        );
    }
    res
}

#[tauri::command]
pub async fn delete_library_entry(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<(), String> {
    let storage_operation = std::sync::Arc::clone(&state.storage_operation);
    let active_job = std::sync::Arc::clone(&state.active_job);
    tauri::async_runtime::spawn_blocking(move || {
        let _storage_guard = storage_operation.try_lock().map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => "Another storage operation is already running.",
            std::sync::TryLockError::Poisoned(_) => {
                "The storage operation registry is unavailable."
            }
        })?;
        let settings = settings_get_internal();
        let has_active_job = active_job
            .lock()
            .map_err(|_| "The conversion registry is unavailable.")?
            .is_some();
        delete_entry_with_roots(
            &root,
            &path,
            &settings.output_dir,
            &settings.fetched_dir,
            has_active_job,
        )
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delete_entry_resolves_nested_and_suffixed_files_within_configured_root() {
        let base = std::env::temp_dir().join(format!("janec-del-{}", crate::paths::now_stamp()));
        let output_root = base.join("converted");
        let fetched_root = base.join("fetched");
        let nested = output_root.join("Images").join("youtube");
        fs::create_dir_all(&nested).expect("create nested output dir");
        fs::create_dir_all(&fetched_root).expect("create fetched dir");

        let real_file = nested.join("kpop_mix.png");
        fs::write(&real_file, b"png-bytes").expect("write png");

        // Stale root-level guess (e.g. when summary.outputDir wasn't the leaf subfolder)
        let root_guess = output_root.join("kpop_mix.png");
        delete_entry_with_roots(
            output_root.to_str().unwrap(),
            root_guess.to_str().unwrap(),
            output_root.to_str().unwrap(),
            fetched_root.to_str().unwrap(),
            false,
        )
        .expect("should resolve and delete nested file under output_root");
        assert!(!real_file.exists());

        // Alternate extension resolution in same parent directory
        let actual_webp = nested.join("cover_art.png");
        fs::write(&actual_webp, b"png-bytes").expect("write cover art");
        let wrong_ext = nested.join("cover_art.jpg");
        delete_entry_with_roots(
            output_root.to_str().unwrap(),
            wrong_ext.to_str().unwrap(),
            output_root.to_str().unwrap(),
            fetched_root.to_str().unwrap(),
            false,
        )
        .expect("should resolve alternate extension and delete");
        assert!(!actual_webp.exists());

        // Outside configured roots must still be rejected
        let outside = base.join("outside.txt");
        fs::write(&outside, b"keep").expect("write outside file");
        let err = delete_entry_with_roots(
            output_root.to_str().unwrap(),
            outside.to_str().unwrap(),
            output_root.to_str().unwrap(),
            fetched_root.to_str().unwrap(),
            false,
        )
        .unwrap_err();
        assert!(err.contains("inside the active library"));
        assert!(outside.exists());

        // Deleting a missing numbered track inside a specific album must NOT delete another track or album's file
        let album_a = output_root.join("AlbumA");
        let album_b = output_root.join("AlbumB");
        fs::create_dir_all(&album_a).expect("create AlbumA");
        fs::create_dir_all(&album_b).expect("create AlbumB");
        let track_2 = album_a.join("2. Intro.mp3");
        let other_album_track = album_b.join("1. Intro.mp3");
        fs::write(&track_2, b"track2").expect("write track2");
        fs::write(&other_album_track, b"albumB").expect("write albumB track");

        let missing_track_1 = album_a.join("1. Intro.mp3");
        let res = delete_entry_with_roots(
            output_root.to_str().unwrap(),
            missing_track_1.to_str().unwrap(),
            output_root.to_str().unwrap(),
            fetched_root.to_str().unwrap(),
            false,
        );
        assert!(res.is_err());
        assert!(track_2.exists());
        assert!(other_album_track.exists());

        fs::remove_dir_all(base).expect("cleanup temp test dir");
    }
}
