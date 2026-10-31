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

#[tauri::command]
pub async fn path_size(path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || library::path_total_bytes(&path))
        .await
        .map_err(|e| format!("Task execution error: {e}"))
}

#[tauri::command]
pub async fn scan_library(path: String) -> Result<Vec<LibraryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || library::scan(&path))
        .await
        .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub fn is_converted_library_path(path: String) -> bool {
    let configured = PathBuf::from(settings_get_internal().output_dir.trim());
    let root = if configured.is_absolute() {
        configured
    } else {
        project_root().join(configured)
    };
    let candidate = PathBuf::from(path.trim());
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        project_root().join(candidate)
    };
    library::is_library_path(&root, &candidate)
}

#[tauri::command]
pub async fn recent_conversions(path: String, limit: usize) -> Result<Vec<LibraryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || library::recent(&path, limit))
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
    tauri::async_runtime::spawn_blocking(move || library::thumbnail(&root, &path))
        .await
        .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub fn move_library(
    state: State<'_, AppState>,
    source: String,
    destination_parent: String,
) -> Result<library::MoveDirectoryResult, String> {
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
}

#[tauri::command]
pub fn move_fetched_folder(
    state: State<'_, AppState>,
    source: String,
    destination_parent: String,
) -> Result<library::MoveDirectoryResult, String> {
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
            "Wait for the active conversion to finish before moving captured media.".into(),
        );
    }
    if state
        .access
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
}

#[tauri::command]
pub fn delete_library_entry(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<(), String> {
    let _storage_guard = state
        .storage_operation
        .try_lock()
        .map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => "Another storage operation is already running.",
            std::sync::TryLockError::Poisoned(_) => {
                "The storage operation registry is unavailable."
            }
        })?;
    let settings = settings_get_internal();
    let canonical_root = fs::canonicalize(root.trim())
        .map_err(|error| format!("The library root is unavailable: {error}"))?;
    let canonical_out = fs::canonicalize(settings.output_dir.trim()).ok();
    let canonical_fetch = fs::canonicalize(settings.fetched_dir.trim()).ok();
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

    let target_path = Path::new(path.trim());
    let candidate = if target_path.is_absolute() {
        target_path.to_path_buf()
    } else {
        canonical_root.join(target_path)
    };
    if candidate.is_dir()
        && state
            .active_job
            .lock()
            .map_err(|_| "The conversion registry is unavailable.")?
            .is_some()
    {
        return Err(
            "Wait for the active conversion to finish before deleting library media folders."
                .into(),
        );
    }
    let res = library::delete_inside(&root, &path);
    if res.is_ok() {
        let _ = crate::catalog::remove_capture(
            &Path::new(&root).join("capture-catalog.json"),
            Path::new(&path),
        );
    }
    res
}
