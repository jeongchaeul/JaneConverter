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
    let trimmed = PathBuf::from(raw.trim());
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
        std::env::temp_dir(),
    ];
    if let Ok(cat) = catalog::history(
        &data_root().join("catalog.json"),
        Vec::new(),
        None,
        None,
        false,
    ) {
        for item in cat.history {
            if let Some(export_path) = item.get("exportPath").and_then(|v| v.as_str()) {
                if !export_path.trim().is_empty() {
                    allowed_roots.push(resolve_configured_root(export_path));
                }
            }
        }
    }

    for root in allowed_roots {
        if library::is_library_path(&root, &canonical_target) {
            return Ok(true);
        }
        if let Ok(canonical_root) = fs::canonicalize(&root) {
            if canonical_target == canonical_root || canonical_target.starts_with(&canonical_root) {
                return Ok(true);
            }
        }
    }

    Err("For safety, JaneConverter can only access items inside the configured library or fetched directories.".into())
}

#[tauri::command]
pub async fn path_size(path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !is_allowed_library_or_history_path(&path)? {
            return Ok(0);
        }
        Ok(library::path_total_bytes(&path))
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
        library::scan(&path)
    })
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
    tauri::async_runtime::spawn_blocking(move || {
        if !is_allowed_library_or_history_path(&path)? {
            return Ok(Vec::new());
        }
        library::recent(&path, limit)
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
        library::thumbnail(&root, &path)
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
            && active_job
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
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}
