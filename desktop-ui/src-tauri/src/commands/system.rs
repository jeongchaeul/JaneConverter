use crate::catalog;
use crate::library;
use crate::model::{self, HardwareSnapshot, RuntimeInfo};
use crate::paths::{
    command_available, data_root, detect_gpu, find_ffmpeg, find_python, packaged_engine,
    prepare_command, project_root, set_data_root, settings_get_internal, write_settings,
};
use crate::process::notify_user_attention;
use crate::{AppState, PendingUpdate, BUILD_COMMIT};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::State;
use tauri_plugin_updater::UpdaterExt;

pub fn is_commit_sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub fn version_core_and_build(value: &str) -> Option<((u64, u64, u64), Option<u64>)> {
    let clean = value.strip_prefix('v').unwrap_or(value);
    let (core, metadata) = clean.split_once('+').unwrap_or((clean, ""));
    let mut parts = core.split('.');
    let core = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    if parts.next().is_some() {
        return None;
    }
    let mut metadata = metadata.split('.');
    let sequence = if metadata.next() == Some("build") {
        metadata.next().and_then(|value| value.parse::<u64>().ok())
    } else {
        None
    };
    Some((core, sequence))
}

pub fn build_metadata_commit(value: &str) -> Option<&str> {
    let (_, metadata) = value.split_once('+')?;
    let mut parts = metadata.split('.');
    if parts.next()? != "build" || parts.next()?.parse::<u64>().is_err() {
        return None;
    }
    let commit = parts.next()?.strip_prefix('g')?;
    (parts.next().is_none() && is_commit_sha(commit)).then_some(commit)
}

pub fn short_commit(value: &str) -> String {
    value.chars().take(7).collect()
}

pub fn is_newer_updater_build(current: &str, latest: &str) -> bool {
    let (Some((current_core, current_build)), Some((latest_core, latest_build))) = (
        version_core_and_build(current),
        version_core_and_build(latest),
    ) else {
        return false;
    };
    if latest_core != current_core {
        return latest_core > current_core;
    }
    matches!((current_build, latest_build), (Some(current), Some(latest)) if latest > current)
        || matches!((current_build, latest_build), (None, Some(latest)) if latest > 0)
}

pub fn format_update_summary(stdout: &str) -> String {
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(stdout) else {
        return if stdout.trim().is_empty() {
            "Update check completed, but no result was returned.".into()
        } else {
            stdout.trim().into()
        };
    };

    let mut messages = Vec::new();
    if let Some(engine) = payload.get("engine") {
        if engine
            .get("has_update")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            let current = engine
                .get("current_version")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("installed");
            let latest = engine
                .get("latest_version")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("latest");
            messages.push(format!(
                "Extractor engine update available: v{current} -> v{latest}."
            ));
        } else if !engine
            .get("online")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true)
        {
            messages.push("Extractor engine check unavailable.".to_owned());
        } else {
            messages.push("Extractor engine is up to date.".to_owned());
        }
    }

    if let Some(repo) = payload.get("repo") {
        let current_commit = repo
            .get("current_commit")
            .and_then(serde_json::Value::as_str);
        let latest_commit = repo
            .get("latest_commit")
            .and_then(serde_json::Value::as_str);
        if let (Some(current_commit), Some(latest_commit)) = (current_commit, latest_commit) {
            if is_commit_sha(current_commit) && is_commit_sha(latest_commit) {
                if repo
                    .get("has_update")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false)
                {
                    messages.push(format!(
                        "JaneConverter repository update available: {} -> {}. Choose Update now to install it.",
                        short_commit(current_commit),
                        short_commit(latest_commit)
                    ));
                } else if let Some(error) = repo.get("error").and_then(serde_json::Value::as_str) {
                    if !error.trim().is_empty() {
                        messages.push(format!(
                            "JaneConverter repository update check unavailable: {error}"
                        ));
                    } else {
                        messages.push(format!(
                            "JaneConverter repository build is up to date ({}).",
                            short_commit(current_commit)
                        ));
                    }
                } else {
                    messages.push(format!(
                        "JaneConverter repository build is up to date ({}).",
                        short_commit(current_commit)
                    ));
                }
                return format!("Update check complete. {}", messages.join(" "));
            }
        }

        let packaged_snapshot = !repo
            .get("is_git")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true)
            && repo.get("current_version").is_some();
        if packaged_snapshot
            && repo
                .get("has_update")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
        {
            let current = repo
                .get("current_version")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("installed");
            let latest = repo
                .get("latest_version")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("latest");
            let installer_note = if repo
                .get("installer_available")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                " The latest consumer installer is available from GitHub."
            } else {
                " Open the published GitHub release to update this snapshot."
            };
            messages.push(format!(
                "JaneConverter update available: v{current} -> v{latest}.{installer_note}"
            ));
        } else if packaged_snapshot {
            if let Some(error) = repo.get("error").and_then(serde_json::Value::as_str) {
                if !error.trim().is_empty() {
                    messages.push(format!("JaneConverter release check unavailable: {error}"));
                } else {
                    let current = repo
                        .get("current_version")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("installed");
                    messages.push(format!("JaneConverter is up to date (v{current})."));
                }
            } else {
                let current = repo
                    .get("current_version")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("installed");
                messages.push(format!("JaneConverter is up to date (v{current})."));
            }
        } else if repo
            .get("has_update")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            let commits = repo
                .get("commits_behind")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(1);
            let noun = if commits == 1 { "commit" } else { "commits" };
            messages.push(format!(
                "JaneConverter has {commits} newer repository {noun}."
            ));
        } else if let Some(error) = repo.get("error").and_then(serde_json::Value::as_str) {
            if !error.trim().is_empty() {
                messages.push(format!(
                    "JaneConverter repository check unavailable: {error}"
                ));
            }
        } else {
            messages.push("JaneConverter is up to date.".to_owned());
        }
    }

    if messages.is_empty() {
        "Update check completed, but no update details were returned.".into()
    } else {
        format!("Update check complete. {}", messages.join(" "))
    }
}

pub fn disable_unsigned_installer(payload: &mut serde_json::Value) {
    if let Some(repo) = payload
        .get_mut("repo")
        .and_then(serde_json::Value::as_object_mut)
    {
        repo.insert("installer_available".into(), serde_json::Value::Bool(false));
    }
}

pub fn format_update_summary_value(payload: &serde_json::Value) -> String {
    format_update_summary(&payload.to_string())
}

#[tauri::command]
pub async fn runtime_info() -> Result<RuntimeInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (gpu_available, gpu_label) = detect_gpu();
        let python = find_python();
        let ffmpeg = find_ffmpeg();
        let packaged = packaged_engine(&python);
        RuntimeInfo {
            mode: "tauri",
            python_ready: if python.is_file() {
                true
            } else {
                command_available(python.to_str().unwrap_or("python"))
            },
            ffmpeg_ready: command_available(ffmpeg.to_str().unwrap_or("ffmpeg")),
            ffmpeg_path: ffmpeg.display().to_string(),
            python_path: python.display().to_string(),
            data_root: data_root().display().to_string(),
            project_root: project_root().display().to_string(),
            gpu_available,
            gpu_label,
            packaged,
        }
    })
    .await
    .map_err(|e| format!("Task execution error: {e}"))
}

#[tauri::command]
pub async fn hardware_snapshot() -> Result<HardwareSnapshot, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let engine = find_python();
        let mut command = Command::new(&engine);
        if !packaged_engine(&engine) {
            command.args(["run", "--locked", "janeconverter"]);
        }
        let target_pid = std::process::id().to_string();
        command
            .args([
                "--hardware-snapshot-json",
                "--hardware-target-pid",
                &target_pid,
            ])
            .current_dir(project_root());
        prepare_command(&mut command);
        let output = command
            .output()
            .map_err(|error| format!("Could not read local hardware telemetry: {error}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if detail.is_empty() {
                format!("Hardware telemetry exited with status {}.", output.status)
            } else {
                detail
            });
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Could not read the hardware telemetry response: {error}"))
    })
    .await
    .map_err(|error| format!("Hardware telemetry task failed: {error}"))?
}

#[tauri::command]
pub fn settings_get() -> model::ConverterSettings {
    settings_get_internal()
}

#[tauri::command]
pub fn settings_save(
    state: State<'_, AppState>,
    settings: model::ConverterSettings,
) -> Result<(), String> {
    let _storage_guard = state
        .storage_operation
        .try_lock()
        .map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => "A library move is already running.",
            std::sync::TryLockError::Poisoned(_) => {
                "The storage operation registry is unavailable."
            }
        })?;
    write_settings(&settings).map_err(|error| format!("Could not save settings: {error}"))
}

#[tauri::command]
pub fn set_data_root_path(state: State<'_, AppState>, path: String) -> Result<String, String> {
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
            "Wait for the active conversion to finish before changing the data root.".into(),
        );
    }
    set_data_root(PathBuf::from(path.trim()).as_path())
        .map(|value| value.display().to_string())
        .map_err(|error| format!("Could not change the data root: {error}"))
}

#[tauri::command]
pub fn set_taskbar_progress(
    window: tauri::WebviewWindow,
    progress: Option<u64>,
    status: Option<String>,
) -> Result<(), String> {
    let bar_status = match status.as_deref() {
        Some("normal") => Some(tauri::window::ProgressBarStatus::Normal),
        Some("indeterminate") => Some(tauri::window::ProgressBarStatus::Indeterminate),
        Some("paused") => Some(tauri::window::ProgressBarStatus::Paused),
        Some("error") => Some(tauri::window::ProgressBarStatus::Error),
        Some("none") | None => Some(tauri::window::ProgressBarStatus::None),
        _ => Some(tauri::window::ProgressBarStatus::Normal),
    };
    window
        .set_progress_bar(tauri::window::ProgressBarState {
            status: bar_status,
            progress,
        })
        .map_err(|error| format!("Could not set taskbar progress: {error}"))
}

#[tauri::command]
pub fn clear_conversion_timings() -> Result<(), String> {
    library::clear_conversion_timings()
}

#[tauri::command]
pub fn relaunch(app: tauri::AppHandle) -> Result<(), String> {
    let root = project_root();
    let launcher = std::env::current_exe()
        .map_err(|error| format!("Could not locate JaneConverter: {error}"))?;
    let mut command = Command::new(&launcher);
    command
        .current_dir(&root)
        .env("JANECONVERTER_DATA_DIR", data_root());
    prepare_command(&mut command);
    command
        .spawn()
        .map_err(|error| format!("Could not relaunch JaneConverter: {error}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn check_updates(
    app: tauri::AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<serde_json::Value, String> {
    let engine = find_python();
    let mut command = Command::new(&engine);
    if !packaged_engine(&engine) {
        command.args(["run", "--locked", "janeconverter"]);
    }
    if is_commit_sha(BUILD_COMMIT) {
        command.arg("--check-engine-updates");
    } else {
        command.arg("--check-updates");
    }
    command.current_dir(project_root());
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let output_res = crate::process::bounded_output(&mut command, Duration::from_secs(12), &cancel);
    let mut payload = match output_res {
        Ok(output) if output.status.success() => {
            serde_json::from_slice(&output.stdout).unwrap_or_else(|_| serde_json::json!({}))
        }
        Ok(output) if is_commit_sha(BUILD_COMMIT) => {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            serde_json::json!({
                "engine": { "has_update": false, "online": false, "error": detail }
            })
        }
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(if stderr.is_empty() { stdout } else { stderr });
        }
        Err(error) if is_commit_sha(BUILD_COMMIT) => serde_json::json!({
            "engine": { "has_update": false, "online": false, "error": error }
        }),
        Err(error) => return Err(format!("Could not start update check: {error}")),
    };
    if !payload.is_object() {
        payload = serde_json::json!({});
    }
    if !is_commit_sha(BUILD_COMMIT) {
        disable_unsigned_installer(&mut payload);
    }
    if let Some(object) = payload.as_object_mut() {
        if is_commit_sha(BUILD_COMMIT) {
            *pending_update
                .0
                .lock()
                .map_err(|_| "The pending update state is unavailable.".to_owned())? = None;

            let updater = app
                .updater_builder()
                .version_comparator(|current, release| {
                    is_newer_updater_build(&current.to_string(), &release.version.to_string())
                })
                .timeout(Duration::from_secs(12))
                .build();

            let current_version = app.package_info().version.to_string();
            let check = match updater {
                Ok(updater) => updater.check().await,
                Err(_) => {
                    object.insert(
                        "repo".into(),
                        serde_json::json!({
                            "has_update": false,
                            "is_git": false,
                            "online": false,
                            "current_commit": BUILD_COMMIT,
                            "latest_commit": BUILD_COMMIT,
                            "commits_behind": 0,
                            "current_version": current_version,
                            "latest_version": current_version,
                            "installer_available": false,
                            "release_url": "https://github.com/jeongchaeul/JaneConverter/releases/tag/continuous",
                            "error": "The signed repository updater is not configured."
                        }),
                    );
                    let summary =
                        format_update_summary_value(&serde_json::Value::Object(object.clone()));
                    object.insert("message".into(), serde_json::Value::String(summary));
                    return Ok(payload);
                }
            };

            match check {
                Ok(Some(update)) => {
                    let latest_version = update.version.to_string();
                    let latest_commit =
                        build_metadata_commit(&latest_version).unwrap_or(BUILD_COMMIT);
                    let has_update = is_newer_updater_build(&current_version, &latest_version);
                    object.insert(
                        "repo".into(),
                        serde_json::json!({
                            "has_update": has_update,
                            "is_git": false,
                            "online": true,
                            "current_commit": BUILD_COMMIT,
                            "latest_commit": latest_commit,
                            "commits_behind": if has_update { 1 } else { 0 },
                            "current_version": current_version,
                            "latest_version": latest_version,
                            "installer_available": true,
                            "release_url": "https://github.com/jeongchaeul/JaneConverter/releases/tag/continuous",
                            "error": serde_json::Value::Null
                        }),
                    );
                    if has_update {
                        *pending_update
                            .0
                            .lock()
                            .map_err(|_| "The pending update state is unavailable.".to_owned())? =
                            Some(update);
                    }
                }
                Ok(None) => {
                    object.insert(
                        "repo".into(),
                        serde_json::json!({
                            "has_update": false,
                            "is_git": false,
                            "online": true,
                            "current_commit": BUILD_COMMIT,
                            "latest_commit": BUILD_COMMIT,
                            "commits_behind": 0,
                            "current_version": current_version,
                            "latest_version": current_version,
                            "installer_available": false,
                            "release_url": "https://github.com/jeongchaeul/JaneConverter/releases/tag/continuous",
                            "error": serde_json::Value::Null
                        }),
                    );
                }
                Err(error) => {
                    let error_message = error.to_string();
                    object.insert(
                        "repo".into(),
                        serde_json::json!({
                            "has_update": false,
                            "is_git": false,
                            "online": false,
                            "current_commit": BUILD_COMMIT,
                            "latest_commit": BUILD_COMMIT,
                            "commits_behind": 0,
                            "current_version": current_version,
                            "latest_version": current_version,
                            "installer_available": false,
                            "release_url": "https://github.com/jeongchaeul/JaneConverter/releases/tag/continuous",
                            "error": error_message
                        }),
                    );
                }
            }
        }
        let summary = format_update_summary_value(&serde_json::Value::Object(object.clone()));
        object.insert("message".into(), serde_json::Value::String(summary));
    }
    Ok(payload)
}

#[tauri::command]
pub async fn install_update(
    _app: tauri::AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending_update
        .0
        .lock()
        .map_err(|_| "The pending update state is unavailable.".to_owned())?
        .take()
        .ok_or_else(|| "Check for updates again before installing.".to_owned())?;
    // Preserve a readable catalog snapshot before the signed installer runs.
    catalog::backup_for_update(
        &data_root(),
        &PathBuf::from(settings_get_internal().fetched_dir),
    )?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| {
            "The signed JaneConverter update could not be downloaded or installed.".to_owned()
        })?;

    #[cfg(not(target_os = "windows"))]
    _app.restart();

    Ok(())
}

#[tauri::command]
pub fn get_chromium_cookie_policy() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
        for root in [
            RegKey::predef(HKEY_CURRENT_USER),
            RegKey::predef(HKEY_LOCAL_MACHINE),
        ] {
            for subkey in [
                r"Software\Policies\Microsoft\Edge",
                r"Software\Policies\Google\Chrome",
            ] {
                if let Ok(key) = root.open_subkey(subkey) {
                    if let Ok(val) = key.get_value::<u32, _>("ApplicationBoundEncryptionEnabled") {
                        if val == 0 {
                            return Ok(true);
                        }
                    }
                }
            }
        }
        Ok(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

pub fn set_chromium_cookie_policy_sync(enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let targets = [
            r"Software\Policies\Microsoft\Edge",
            r"Software\Policies\Google\Chrome",
        ];

        let mut direct_ok = true;
        for target in targets {
            if enabled {
                if hkcu
                    .create_subkey(target)
                    .and_then(|(k, _)| k.set_value("ApplicationBoundEncryptionEnabled", &0u32))
                    .is_err()
                {
                    direct_ok = false;
                    break;
                }
            } else if let Ok(key) = hkcu.open_subkey_with_flags(target, KEY_SET_VALUE) {
                let _ = key.delete_value("ApplicationBoundEncryptionEnabled");
            }
        }

        if direct_ok && (!enabled || get_chromium_cookie_policy().unwrap_or(false)) {
            return Ok(enabled);
        }

        // Direct write was blocked by Windows ACL. Elevate via PowerShell Start-Process -Verb RunAs.
        let ps_script = if enabled {
            r#"Start-Process cmd.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '/c reg add "HKCU\Software\Policies\Microsoft\Edge" /v ApplicationBoundEncryptionEnabled /t REG_DWORD /d 0 /f & reg add "HKCU\Software\Policies\Google\Chrome" /v ApplicationBoundEncryptionEnabled /t REG_DWORD /d 0 /f & reg add "HKLM\Software\Policies\Microsoft\Edge" /v ApplicationBoundEncryptionEnabled /t REG_DWORD /d 0 /f & reg add "HKLM\Software\Policies\Google\Chrome" /v ApplicationBoundEncryptionEnabled /t REG_DWORD /d 0 /f'"#
        } else {
            r#"Start-Process cmd.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '/c reg delete "HKCU\Software\Policies\Microsoft\Edge" /v ApplicationBoundEncryptionEnabled /f & reg delete "HKCU\Software\Policies\Google\Chrome" /v ApplicationBoundEncryptionEnabled /f & reg delete "HKLM\Software\Policies\Microsoft\Edge" /v ApplicationBoundEncryptionEnabled /f & reg delete "HKLM\Software\Policies\Google\Chrome" /v ApplicationBoundEncryptionEnabled /f'"#
        };

        let mut ps_cmd = std::process::Command::new("powershell");
        ps_cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            ps_script,
        ]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            ps_cmd.creation_flags(crate::paths::CREATE_NO_WINDOW);
        }
        let status = ps_cmd
            .status()
            .map_err(|e| format!("Could not launch administrator setup: {e}"))?;

        if !status.success() {
            return Err("Administrator approval was declined or cancelled.".into());
        }

        let current = get_chromium_cookie_policy().unwrap_or(false);
        if current == enabled {
            Ok(enabled)
        } else {
            Err("Windows policy was not updated. If a UAC prompt appeared, please ensure you select 'Yes'.".into())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(enabled)
    }
}

#[tauri::command]
pub async fn set_chromium_cookie_policy(enabled: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || set_chromium_cookie_policy_sync(enabled))
        .await
        .map_err(|e| format!("Task execution error: {e}"))?
}

#[tauri::command]
pub fn notify_attention(app: tauri::AppHandle) {
    notify_user_attention(&app);
}
