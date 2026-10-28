use crate::library;
use crate::AppState;
use rfd::FileDialog;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::State;

#[tauri::command]
pub fn choose_file() -> Option<String> {
    FileDialog::new()
        .set_title("Choose media file")
        .pick_file()
        .map(|path| path.display().to_string())
}

#[tauri::command]
pub fn choose_files() -> Vec<String> {
    FileDialog::new()
        .set_title("Choose media files")
        .pick_files()
        .map(|paths| {
            paths
                .into_iter()
                .map(|path| path.display().to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn choose_folder() -> Option<String> {
    FileDialog::new()
        .set_title("Choose export folder")
        .pick_folder()
        .map(|path| path.display().to_string())
}

#[tauri::command]
pub fn export_log_file(
    content: String,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let name = default_filename.unwrap_or_else(|| "janeconverter-logs.txt".to_string());
    let path = FileDialog::new()
        .set_title("Export Console Logs")
        .set_file_name(&name)
        .add_filter("Text File (*.txt)", &["txt"])
        .add_filter("Log File (*.log)", &["log"])
        .save_file();

    if let Some(path) = path {
        fs::write(&path, content.as_bytes())
            .map_err(|error| format!("Could not save log file: {error}"))?;
        Ok(Some(path.display().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let raw_target = PathBuf::from(library::clean_windows_path(&path));
    if !raw_target.exists() {
        return Err("That file or folder no longer exists.".into());
    }
    let canonical = fs::canonicalize(&raw_target)
        .map_err(|error| format!("Could not resolve path: {error}"))?;
    let target = PathBuf::from(library::clean_windows_path(
        &canonical.display().to_string(),
    ));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("explorer");
        if target.is_file() {
            command.raw_arg(format!("/select,\"{}\"", target.display()));
        } else {
            command.arg(&target);
        }
        command.spawn().map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    let initial = PathBuf::from(library::clean_windows_path(&path));
    let target = if initial.is_dir() {
        library::first_media_file_in_dir(&initial).unwrap_or(initial)
    } else {
        initial
    };
    if !target.exists() {
        return Err("That media file no longer exists.".into());
    }
    if target.is_dir() {
        return open_path(target.display().to_string());
    }
    let sym_meta = fs::symlink_metadata(&target)
        .map_err(|error| format!("Could not inspect file metadata: {error}"))?;
    if sym_meta.file_type().is_symlink() {
        return Err("Opening symbolic links is not supported.".into());
    }
    if !library::openable_file_extension(&target) {
        return Err("Only supported media, DAW project, and metadata files can be opened.".into());
    }
    let canonical = fs::canonicalize(&target)
        .map_err(|error| format!("Could not resolve file path: {error}"))?;
    let clean_target = PathBuf::from(library::clean_windows_path(
        &canonical.display().to_string(),
    ));
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&clean_target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&clean_target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&clean_target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let value = url.trim();
    if !(value.starts_with("http://") || value.starts_with("https://")) {
        return Err("Only http and https URLs can be opened.".into());
    }
    let is_active_access_link = state
        .access
        .lock()
        .ok()
        .and_then(|access| {
            access
                .as_ref()
                .map(|server| server.link.trim_end_matches('/') == value.trim_end_matches('/'))
        })
        .unwrap_or(false);

    let parsed = url::Url::parse(value).map_err(|_| "Invalid URL.".to_string())?;
    let is_local_host = match parsed.host() {
        Some(url::Host::Domain(domain)) => {
            let d = domain.to_ascii_lowercase();
            d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local")
        }
        Some(url::Host::Ipv4(ip)) => {
            ip.is_loopback() || ip.is_unspecified() || ip.is_private() || ip.is_link_local()
        }
        Some(url::Host::Ipv6(ip)) => ip.is_loopback() || ip.is_unspecified(),
        None => true,
    };
    if !is_active_access_link && is_local_host {
        return Err("Opening local or loopback addresses in external browsers is blocked.".into());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", value])
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(value)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(value)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
