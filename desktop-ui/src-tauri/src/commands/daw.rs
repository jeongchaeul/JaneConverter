use crate::model::{
    AlsMigrationResult, AlsProjectInfo, FlpDowngradeResult, FlpProjectInfo, InstalledFlStudio,
};
use crate::paths::{find_python, packaged_engine, project_root};
use rfd::FileDialog;
use std::process::Command;

#[tauri::command]
pub async fn choose_flp_file() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        FileDialog::new()
            .set_title("Choose FL Studio Project (.flp)")
            .add_filter("FL Studio Project (*.flp)", &["flp"])
            .pick_file()
            .map(|path| path.display().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn choose_als_file() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        FileDialog::new()
            .set_title("Choose Ableton Live Project (.als)")
            .add_filter("Ableton Live Project (*.als)", &["als"])
            .pick_file()
            .map(|path| path.display().to_string())
    })
    .await
    .ok()
    .flatten()
}

async fn run_daw_engine_json<T: serde::de::DeserializeOwned + Send + 'static>(
    args: Vec<String>,
    run_context: &'static str,
    exit_label: &'static str,
    parse_context: &'static str,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = find_python();
        let mut command = Command::new(&engine);
        if !packaged_engine(&engine) {
            command.args(["run", "--locked", "janeconverter"]);
        }
        command.args(&args).current_dir(project_root());
        let output = crate::process::bounded_output(
            &mut command,
            std::time::Duration::from_secs(30),
            &std::sync::atomic::AtomicBool::new(false),
        )
        .map_err(|error| format!("{run_context}: {error}"))?;
        if !output.status.success() {
            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                if let Some(err_msg) = val.get("error").and_then(|v| v.as_str()) {
                    if !err_msg.trim().is_empty() {
                        return Err(err_msg.trim().to_string());
                    }
                }
            }
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                format!("{exit_label} exited with status {}.", output.status)
            } else {
                detail
            });
        }
        serde_json::from_slice(&output.stdout).map_err(|error| format!("{parse_context}: {error}"))
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub async fn als_inspect(path: String) -> Result<AlsProjectInfo, String> {
    run_daw_engine_json(
        vec![format!("--als-inspect={path}")],
        "Could not inspect Ableton Live project",
        "ALS inspector",
        "Could not read ALS inspector output",
    )
    .await
}

#[tauri::command]
pub async fn als_migrate(
    source: String,
    target_version: String,
    output_path: Option<String>,
    overwrite: Option<bool>,
) -> Result<AlsMigrationResult, String> {
    let mut args = vec![
        format!("--als-migrate={source}"),
        format!("--als-target={target_version}"),
    ];
    if let Some(ref out) = output_path {
        if !out.trim().is_empty() {
            args.push(format!("--als-output={}", out.trim()));
        }
    }
    if overwrite.unwrap_or(false) {
        args.push("--als-overwrite".to_string());
    }
    run_daw_engine_json(
        args,
        "Could not migrate Ableton Live project",
        "ALS migrator",
        "Could not read ALS migrator output",
    )
    .await
}

#[tauri::command]
pub async fn flp_inspect(path: String) -> Result<FlpProjectInfo, String> {
    run_daw_engine_json(
        vec![format!("--flp-inspect={path}")],
        "Could not inspect FL Studio project",
        "FLP inspector",
        "Could not read FLP inspector output",
    )
    .await
}

#[tauri::command]
pub async fn flp_downgrade(
    source: String,
    target_version: String,
    target_build: Option<u32>,
    output_path: Option<String>,
    overwrite: Option<bool>,
) -> Result<FlpDowngradeResult, String> {
    let mut args = vec![
        format!("--flp-downgrade={source}"),
        format!("--flp-target={target_version}"),
    ];
    if let Some(build) = target_build {
        if build > 0 {
            args.push(format!("--flp-build={build}"));
        }
    }
    if let Some(ref out) = output_path {
        if !out.trim().is_empty() {
            args.push(format!("--flp-output={}", out.trim()));
        }
    }
    if overwrite.unwrap_or(false) {
        args.push("--flp-overwrite".to_string());
    }
    run_daw_engine_json(
        args,
        "Could not downgrade FL Studio project",
        "FLP downgrader",
        "Could not read FLP downgrader output",
    )
    .await
}

#[tauri::command]
pub async fn flp_detect_installed() -> Result<Vec<InstalledFlStudio>, String> {
    run_daw_engine_json(
        vec!["--flp-detect-installed".to_string()],
        "Could not detect FL Studio installations",
        "FLP detector",
        "Could not read FLP detector output",
    )
    .await
}
