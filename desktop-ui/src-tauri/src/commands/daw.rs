use crate::model::{FlpDowngradeResult, FlpProjectInfo, InstalledFlStudio};
use crate::paths::{find_python, packaged_engine, project_root};
use rfd::FileDialog;
use std::process::Command;

#[tauri::command]
pub fn choose_flp_file() -> Option<String> {
    FileDialog::new()
        .set_title("Choose FL Studio Project (.flp)")
        .add_filter("FL Studio Project (*.flp)", &["flp"])
        .pick_file()
        .map(|path| path.display().to_string())
}

#[tauri::command]
pub fn choose_als_file() -> Option<String> {
    FileDialog::new()
        .set_title("Choose Ableton Live Project (.als)")
        .add_filter("Ableton Live Project (*.als)", &["als"])
        .pick_file()
        .map(|path| path.display().to_string())
}

#[tauri::command]
pub async fn flp_inspect(path: String) -> Result<FlpProjectInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = find_python();
        let mut command = Command::new(&engine);
        if !packaged_engine(&engine) {
            command.args(["run", "--locked", "janeconverter"]);
        }
        command
            .arg(format!("--flp-inspect={path}"))
            .current_dir(project_root());
        let output = crate::process::bounded_output(
            &mut command,
            std::time::Duration::from_secs(30),
            &std::sync::atomic::AtomicBool::new(false),
        )
        .map_err(|error| format!("Could not inspect FL Studio project: {error}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                format!("FLP inspector exited with status {}.", output.status)
            } else {
                detail
            });
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Could not read FLP inspector output: {error}"))
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub async fn flp_downgrade(
    source: String,
    target_version: String,
    target_build: Option<u32>,
    output_path: Option<String>,
    overwrite: Option<bool>,
) -> Result<FlpDowngradeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = find_python();
        let mut command = Command::new(&engine);
        if !packaged_engine(&engine) {
            command.args(["run", "--locked", "janeconverter"]);
        }
        command
            .args([
                format!("--flp-downgrade={source}"),
                format!("--flp-target={target_version}"),
            ])
            .current_dir(project_root());
        if let Some(build) = target_build {
            if build > 0 {
                command.arg(format!("--flp-build={build}"));
            }
        }
        if let Some(ref out) = output_path {
            if !out.trim().is_empty() {
                command.arg(format!("--flp-output={}", out.trim()));
            }
        }
        if overwrite.unwrap_or(false) {
            command.arg("--flp-overwrite");
        }
        let output = crate::process::bounded_output(
            &mut command,
            std::time::Duration::from_secs(30),
            &std::sync::atomic::AtomicBool::new(false),
        )
        .map_err(|error| format!("Could not downgrade FL Studio project: {error}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                format!("FLP downgrader exited with status {}.", output.status)
            } else {
                detail
            });
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Could not read FLP downgrader output: {error}"))
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub async fn flp_detect_installed() -> Result<Vec<InstalledFlStudio>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = find_python();
        let mut command = Command::new(&engine);
        if !packaged_engine(&engine) {
            command.args(["run", "--locked", "janeconverter"]);
        }
        command
            .arg("--flp-detect-installed")
            .current_dir(project_root());
        let output = crate::process::bounded_output(
            &mut command,
            std::time::Duration::from_secs(30),
            &std::sync::atomic::AtomicBool::new(false),
        )
        .map_err(|error| format!("Could not detect FL Studio installations: {error}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                format!("FLP detector exited with status {}.", output.status)
            } else {
                detail
            });
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Could not read FLP detector output: {error}"))
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}
