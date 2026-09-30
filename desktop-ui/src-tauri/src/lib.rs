mod access;
mod facebook_capture;
mod library;
mod model;
mod paths;
mod process;
mod social_photo_capture;

use model::{
    AccessDiagnostic, AccessStatus, ConversionRequest, FacebookCaptureResult,
    FacebookPhotoManifest, FetchedMedia, HardwareSnapshot, LibraryEntry, RuntimeInfo,
    SocialCaptureResult, SocialPhotoManifest,
};
use paths::{
    cleanup_stale_update_installers, command_available, data_root, detect_gpu, find_ffmpeg,
    find_python, packaged_engine, prepare_command, project_root, set_data_root,
    settings_get_internal, write_settings,
};
use process::{
    load_playlist as load_playlist_engine, start_conversion as start_engine_conversion,
    terminate_child, ConversionSlots,
};
use rfd::FileDialog;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_updater::{Update, UpdaterExt};

const BUILD_COMMIT: &str = match option_env!("JANECONVERTER_BUILD_COMMIT") {
    Some(commit) => commit,
    None => "unknown",
};

#[derive(Default)]
struct PendingUpdate(Mutex<Option<Update>>);

type FacebookRefreshWaiters =
    std::collections::HashMap<String, (String, mpsc::Sender<Vec<String>>)>;

#[derive(Clone)]
struct FacebookCaptureSession {
    window: WebviewWindow,
    profile: PathBuf,
    refresh_waiters: Arc<Mutex<FacebookRefreshWaiters>>,
    refresh_function: String,
    created: Instant,
    in_use: Arc<AtomicBool>,
}

fn is_commit_sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn version_core_and_build(value: &str) -> Option<((u64, u64, u64), Option<u64>)> {
    let (core, metadata) = value.split_once('+').unwrap_or((value, ""));
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

fn build_metadata_commit(value: &str) -> Option<&str> {
    let (_, metadata) = value.split_once('+')?;
    let mut parts = metadata.split('.');
    if parts.next()? != "build" || parts.next()?.parse::<u64>().is_err() {
        return None;
    }
    let commit = parts.next()?.strip_prefix('g')?;
    (parts.next().is_none() && is_commit_sha(commit)).then_some(commit)
}

fn short_commit(value: &str) -> String {
    value.chars().take(7).collect()
}

fn is_newer_updater_build(current: &str, latest: &str) -> bool {
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

#[derive(Clone)]
pub struct AppState {
    active_child: Arc<Mutex<Option<Arc<Mutex<std::process::Child>>>>>,
    active_cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    active_job: Arc<Mutex<Option<String>>>,
    sequence: Arc<AtomicU64>,
    access: Arc<Mutex<Option<access::AccessServer>>>,
    facebook_captures: Arc<Mutex<std::collections::HashMap<String, FacebookCaptureSession>>>,
    facebook_manifests: Arc<
        Mutex<
            std::collections::HashMap<String, (String, FacebookPhotoManifest, std::time::Instant)>,
        >,
    >,
    social_captures: Arc<Mutex<std::collections::HashMap<String, WebviewWindow>>>,
    social_manifests: Arc<
        Mutex<std::collections::HashMap<String, (String, SocialPhotoManifest, std::time::Instant)>>,
    >,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_child: Arc::new(Mutex::new(None)),
            active_cancel: Arc::new(Mutex::new(None)),
            active_job: Arc::new(Mutex::new(None)),
            sequence: Arc::new(AtomicU64::new(1)),
            access: Arc::new(Mutex::new(None)),
            facebook_captures: Arc::new(Mutex::new(std::collections::HashMap::new())),
            facebook_manifests: Arc::new(Mutex::new(std::collections::HashMap::new())),
            social_captures: Arc::new(Mutex::new(std::collections::HashMap::new())),
            social_manifests: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }
}

fn active_capture_path(
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

fn job_is_active(active_job: Option<&str>, requested_job: &str) -> bool {
    active_job == Some(requested_job.trim())
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
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
}

#[tauri::command]
async fn hardware_snapshot() -> Result<HardwareSnapshot, String> {
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
fn settings_get() -> model::ConverterSettings {
    settings_get_internal()
}

#[tauri::command]
fn settings_save(settings: model::ConverterSettings) -> Result<(), String> {
    write_settings(&settings).map_err(|error| format!("Could not save settings: {error}"))
}

#[tauri::command]
fn set_data_root_path(path: String) -> Result<String, String> {
    set_data_root(PathBuf::from(path.trim()).as_path())
        .map(|value| value.display().to_string())
        .map_err(|error| format!("Could not change the data root: {error}"))
}

#[tauri::command]
fn choose_file() -> Option<String> {
    FileDialog::new()
        .set_title("Choose media file")
        .pick_file()
        .map(|path| path.display().to_string())
}

#[tauri::command]
fn choose_files() -> Vec<String> {
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
fn choose_folder() -> Option<String> {
    FileDialog::new()
        .set_title("Choose export folder")
        .pick_folder()
        .map(|path| path.display().to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim());
    if !target.exists() {
        return Err("That file or folder no longer exists.".into());
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        if target.is_file() {
            command.arg("/select,").arg(&target);
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
fn open_file(path: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim());
    if !target.is_file() {
        return Err("That media file no longer exists.".into());
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", target.to_string_lossy().as_ref()]);
        prepare_command(&mut command);
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
fn open_url(url: String) -> Result<(), String> {
    let value = url.trim();
    if !(value.starts_with("http://") || value.starts_with("https://")) {
        return Err("Only http and https URLs can be opened.".into());
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

fn valid_capture_id(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(index, character)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                character == '-'
            } else {
                character.is_ascii_hexdigit()
            }
        })
}

fn valid_refresh_request_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_facebook_photo_id(value: &str) -> bool {
    (5..=30).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn refresh_facebook_candidates(
    captures: &Arc<Mutex<std::collections::HashMap<String, FacebookCaptureSession>>>,
    capture_id: &str,
    request_id: &str,
    photo_id: &str,
) -> Result<Vec<String>, String> {
    if !valid_capture_id(capture_id)
        || !valid_refresh_request_id(request_id)
        || !valid_facebook_photo_id(photo_id)
    {
        return Err("The Facebook rendition refresh request was invalid.".into());
    }
    let session = captures
        .lock()
        .map_err(|_| "The Facebook capture registry is unavailable.")?
        .get(capture_id)
        .cloned()
        .ok_or_else(|| "The Facebook guest session has expired.".to_string())?;
    if session.created.elapsed() >= Duration::from_secs(600)
        || !session.in_use.load(Ordering::Relaxed)
    {
        return Err("The Facebook guest session has expired.".into());
    }

    let (sender, receiver) = mpsc::channel();
    {
        let mut waiters = session
            .refresh_waiters
            .lock()
            .map_err(|_| "The Facebook rendition refresh is unavailable.")?;
        if waiters.len() >= 1 || waiters.contains_key(request_id) {
            return Err("A Facebook rendition refresh is already in progress.".into());
        }
        waiters.insert(request_id.to_owned(), (photo_id.to_owned(), sender));
    }

    let function = serde_json::to_string(&session.refresh_function)
        .map_err(|_| "The Facebook rendition refresh could not be prepared.")?;
    let request = serde_json::to_string(request_id)
        .map_err(|_| "The Facebook rendition refresh could not be prepared.")?;
    let photo = serde_json::to_string(photo_id)
        .map_err(|_| "The Facebook rendition refresh could not be prepared.")?;
    if let Err(error) = session
        .window
        .eval(&format!("window[{function}]({request},{photo});"))
    {
        if let Ok(mut waiters) = session.refresh_waiters.lock() {
            waiters.remove(request_id);
        }
        return Err(format!(
            "Could not refresh the Facebook photo rendition: {error}"
        ));
    }

    match receiver.recv_timeout(Duration::from_secs(10)) {
        Ok(urls) => Ok(urls),
        Err(_) => {
            if let Ok(mut waiters) = session.refresh_waiters.lock() {
                waiters.remove(request_id);
            }
            Ok(Vec::new())
        }
    }
}

fn close_facebook_capture_session(
    captures: &Arc<Mutex<std::collections::HashMap<String, FacebookCaptureSession>>>,
    capture_id: &str,
) {
    let session = captures
        .lock()
        .ok()
        .and_then(|mut values| values.remove(capture_id));
    if let Some(session) = session {
        let _ = session.window.close();
        clean_facebook_capture_profile(&session.profile);
    }
}

fn clean_facebook_capture_profile(path: &Path) {
    let Ok(temp_root) = fs::canonicalize(std::env::temp_dir()) else {
        return;
    };
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return;
    };
    if !name.starts_with("JaneConverter-facebook-")
        || path
            .parent()
            .and_then(|parent| fs::canonicalize(parent).ok())
            .as_deref()
            != Some(temp_root.as_path())
    {
        return;
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        let _ = fs::remove_dir_all(path);
    }
}

fn clean_social_capture_profile(path: &Path) {
    let Ok(temp_root) = fs::canonicalize(std::env::temp_dir()) else {
        return;
    };
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return;
    };
    if !name.starts_with("JaneConverter-social-")
        || path
            .parent()
            .and_then(|parent| fs::canonicalize(parent).ok())
            .as_deref()
            != Some(temp_root.as_path())
    {
        return;
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        let _ = fs::remove_dir_all(path);
    }
}

#[tauri::command]
async fn capture_facebook_album(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source: String,
    capture_id: String,
) -> Result<FacebookCaptureResult, String> {
    let source_url = facebook_capture::validate_post_url(&source)?;
    if !valid_capture_id(&capture_id) {
        return Err("The Facebook capture session is invalid. Please try again.".into());
    }
    if state
        .active_job
        .lock()
        .map_err(|_| "The conversion registry is unavailable.")?
        .is_some()
    {
        return Err(
            "Finish or cancel the current conversion before starting an album capture.".into(),
        );
    }

    state
        .facebook_manifests
        .lock()
        .map_err(|_| "The Facebook photo manifest registry is unavailable.")?
        .retain(|_, (_, _, created)| created.elapsed() < Duration::from_secs(600));

    {
        let captures = state
            .facebook_captures
            .lock()
            .map_err(|_| "The Facebook capture registry is unavailable.")?;
        if !captures.is_empty() {
            return Err("A Facebook photo capture is already running.".into());
        }
    }

    let sequence = state.sequence.fetch_add(1, Ordering::Relaxed);
    let nonce = format!("{}-{sequence}", paths::now_stamp());
    let label = format!("facebook-capture-{sequence}");
    let profile = std::env::temp_dir().join(format!("JaneConverter-facebook-{nonce}"));
    fs::create_dir(&profile)
        .map_err(|error| format!("Could not create a temporary guest session: {error}"))?;

    let (sender, receiver) = mpsc::channel::<Result<facebook_capture::CaptureOutcome, String>>();
    let accumulator = Arc::new(Mutex::new(facebook_capture::CaptureAccumulator::default()));
    let accumulator_for_title = Arc::clone(&accumulator);
    let refresh_waiters = Arc::new(Mutex::new(FacebookRefreshWaiters::new()));
    let refresh_waiters_for_title = Arc::clone(&refresh_waiters);
    let nonce_for_title = nonce.clone();
    let refresh_function = format!("__JANE_FACEBOOK_REFRESH__{nonce}");
    let sender_for_title = sender.clone();
    let initial_script = facebook_capture::initialization_script(&nonce);
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(source_url))
        .title("Reading public Facebook album")
        .inner_size(940.0, 700.0)
        .visible(false)
        .incognito(true)
        .data_directory(profile.clone())
        .initialization_script(&initial_script)
        .on_navigation(|url| facebook_capture::is_facebook_navigation(url.as_str()))
        .on_document_title_changed(move |window, title| {
            let Some(message) = facebook_capture::message_from_title(&title, &nonce_for_title)
            else {
                return;
            };
            match message.kind.as_str() {
                "photos" => {
                    if message.photos.is_empty()
                        || message.photos.len() > 2
                        || message.sequence == 0
                    {
                        return;
                    }
                    let sequence = message.sequence;
                    let count = {
                        let Ok(mut collected) = accumulator_for_title.lock() else {
                            return;
                        };
                        if !message.title.is_empty() && message.title.len() <= 500 {
                            collected.title.clone_from(&message.title);
                        }
                        for mut photo in message.photos {
                            if photo.id.len() < 5
                                || photo.id.len() > 30
                                || !photo.id.bytes().all(|byte| byte.is_ascii_digit())
                                || !facebook_capture::validate_photo_url(&photo.url)
                            {
                                continue;
                            }
                            photo
                                .alternates
                                .retain(|url| facebook_capture::validate_photo_url(url));
                            photo.alternates.truncate(3);
                            collected.add_photo(photo);
                        }
                        collected.photos.len()
                    };
                    let _ = window.set_title(&format!("Found {count} public Facebook photos..."));
                    let ack_key =
                        serde_json::to_string(&format!("__JANE_FACEBOOK_ACK__{nonce_for_title}"))
                            .expect("acknowledgment key is a string");
                    let _ = window.eval(&format!("window[{ack_key}] = {sequence};"));
                }
                "done" => {
                    let result = accumulator_for_title
                        .lock()
                        .map_err(|_| "The Facebook photo list became unavailable.".to_string())
                        .and_then(|collected| {
                            facebook_capture::validate_completion(
                                &message,
                                collected.photos.len(),
                            )?;
                            let title = if !message.title.is_empty() {
                                message.title
                            } else {
                                collected.title.clone()
                            };
                            Ok(facebook_capture::CaptureOutcome::Photos(
                                FacebookPhotoManifest {
                                    title,
                                    photos: collected.ordered_photos(),
                                },
                            ))
                        });
                    let _ = sender_for_title.send(result);
                }
                "refresh" => {
                    if !valid_refresh_request_id(&message.request_id) {
                        return;
                    }
                    let waiter = refresh_waiters_for_title
                        .lock()
                        .ok()
                        .and_then(|mut waiters| waiters.remove(&message.request_id));
                    if let Some((expected_photo_id, sender)) = waiter {
                        let urls = facebook_capture::refreshed_candidate_urls(
                            &message,
                            &expected_photo_id,
                        );
                        let _ = sender.send(urls);
                    }
                }
                "video" => {
                    let has_photos = accumulator_for_title
                        .lock()
                        .map(|collected| !collected.photos.is_empty())
                        .unwrap_or(true);
                    if !has_photos {
                        let title = message.title.chars().take(500).collect();
                        let _ = sender_for_title
                            .send(Ok(facebook_capture::CaptureOutcome::Video(title)));
                        let _ = window.close();
                    }
                }
                "error" => {
                    let message = if message.error.len() <= 400 {
                        message.error
                    } else {
                        "Facebook could not show this album to a logged-out visitor.".into()
                    };
                    let _ = sender_for_title.send(Err(message));
                    let _ = window.close();
                }
                _ => {}
            }
        });

    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            clean_facebook_capture_profile(&profile);
            return Err(format!(
                "Could not open the isolated Facebook capture window: {error}"
            ));
        }
    };
    drop(sender);
    state
        .facebook_captures
        .lock()
        .map_err(|_| "The Facebook capture registry is unavailable.")?
        .insert(
            capture_id.clone(),
            FacebookCaptureSession {
                window: window.clone(),
                profile: profile.clone(),
                refresh_waiters,
                refresh_function,
                created: Instant::now(),
                in_use: Arc::new(AtomicBool::new(false)),
            },
        );

    let received = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(210))
    })
    .await;
    let capture_result = match received {
        Ok(Ok(result)) => result,
        Ok(Err(mpsc::RecvTimeoutError::Timeout)) => {
            Err("Facebook did not finish loading the public album within 210 seconds.".into())
        }
        Ok(Err(mpsc::RecvTimeoutError::Disconnected)) => {
            Err("Facebook photo capture was cancelled.".into())
        }
        Err(_) => Err("The Facebook photo capture could not finish.".into()),
    };

    match capture_result {
        Ok(facebook_capture::CaptureOutcome::Photos(manifest)) => {
            let registered_at = Instant::now();
            if let Ok(mut captures) = state.facebook_captures.lock() {
                if let Some(session) = captures.get_mut(&capture_id) {
                    session.created = registered_at;
                }
            }
            let result = FacebookCaptureResult {
                capture_id: capture_id.clone(),
                title: manifest.title.clone(),
                photo_count: manifest.photos.len(),
                media_kind: "photo",
            };
            state
                .facebook_manifests
                .lock()
                .map_err(|_| "The Facebook photo manifest registry is unavailable.")?
                .insert(
                    capture_id.clone(),
                    (source.trim().to_string(), manifest, registered_at),
                );
            let captures = Arc::clone(&state.facebook_captures);
            let manifests = Arc::clone(&state.facebook_manifests);
            let expiry_capture_id = capture_id;
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(600));
                let expired = captures.lock().ok().and_then(|mut sessions| {
                    let is_expired = sessions.get(&expiry_capture_id).is_some_and(|session| {
                        session.created.elapsed() >= Duration::from_secs(600)
                            && !session.in_use.load(Ordering::Relaxed)
                    });
                    is_expired
                        .then(|| sessions.remove(&expiry_capture_id))
                        .flatten()
                });
                if let Some(session) = expired {
                    let _ = session.window.close();
                    clean_facebook_capture_profile(&session.profile);
                }
                if let Ok(mut values) = manifests.lock() {
                    values.remove(&expiry_capture_id);
                }
            });
            Ok(result)
        }
        Ok(facebook_capture::CaptureOutcome::Video(title)) => {
            close_facebook_capture_session(&state.facebook_captures, &capture_id);
            Ok(FacebookCaptureResult {
                capture_id,
                title,
                photo_count: 0,
                media_kind: "video",
            })
        }
        Err(message) => {
            close_facebook_capture_session(&state.facebook_captures, &capture_id);
            Err(message)
        }
    }
}

#[tauri::command]
fn cancel_facebook_album(state: State<'_, AppState>, capture_id: String) -> Result<(), String> {
    if !valid_capture_id(&capture_id) {
        return Err("The Facebook capture session is invalid.".into());
    }
    let session = state
        .facebook_captures
        .lock()
        .map_err(|_| "The Facebook capture registry is unavailable.")?
        .remove(&capture_id);
    if let Some(session) = session {
        session
            .window
            .close()
            .map_err(|error| format!("Could not cancel Facebook capture: {error}"))?;
        clean_facebook_capture_profile(&session.profile);
    }
    if let Ok(mut manifests) = state.facebook_manifests.lock() {
        manifests.remove(&capture_id);
    }
    Ok(())
}

#[tauri::command]
async fn capture_social_post_photos(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source: String,
    capture_id: String,
) -> Result<SocialCaptureResult, String> {
    let (platform, source_url) = social_photo_capture::validate_post_url(&source)?;
    if !valid_capture_id(&capture_id) {
        return Err("The photo capture session is invalid. Please try again.".into());
    }
    if state
        .active_job
        .lock()
        .map_err(|_| "The conversion registry is unavailable.")?
        .is_some()
    {
        return Err(
            "Finish or cancel the current conversion before starting a photo capture.".into(),
        );
    }
    state
        .social_manifests
        .lock()
        .map_err(|_| "The public photo manifest registry is unavailable.")?
        .retain(|_, (_, _, created)| created.elapsed() < Duration::from_secs(600));
    if !state
        .social_captures
        .lock()
        .map_err(|_| "The public photo capture registry is unavailable.")?
        .is_empty()
        || !state
            .facebook_captures
            .lock()
            .map_err(|_| "The Facebook photo capture registry is unavailable.")?
            .is_empty()
    {
        return Err("Another public photo capture is already running.".into());
    }

    let sequence = state.sequence.fetch_add(1, Ordering::Relaxed);
    let nonce = format!("{}-{sequence}", paths::now_stamp());
    let label = format!("social-photo-capture-{sequence}");
    let profile = std::env::temp_dir().join(format!("JaneConverter-social-{nonce}"));
    fs::create_dir(&profile)
        .map_err(|error| format!("Could not create a temporary guest session: {error}"))?;

    let (sender, receiver) = mpsc::channel::<Result<SocialPhotoManifest, String>>();
    let accumulator = Arc::new(Mutex::new(
        social_photo_capture::CaptureAccumulator::default(),
    ));
    let accumulator_for_title = Arc::clone(&accumulator);
    let nonce_for_title = nonce.clone();
    let sender_for_title = sender.clone();
    let platform_for_title = platform;
    let initial_script = social_photo_capture::initialization_script(&nonce, platform);
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(source_url))
        .title(format!("Reading public {} photos", platform.label()))
        .inner_size(940.0, 700.0)
        .visible(false)
        .incognito(true)
        .data_directory(profile.clone())
        .initialization_script(&initial_script)
        .on_navigation(move |url| social_photo_capture::is_allowed_navigation(url.as_str(), platform))
        .on_document_title_changed(move |window, title| {
            let Some(message) =
                social_photo_capture::message_from_title(&title, &nonce_for_title)
            else {
                return;
            };
            if message.platform != platform_for_title.key() {
                return;
            }
            match message.kind.as_str() {
                "photos" => {
                    if message.photos.is_empty() || message.photos.len() > 2 || message.sequence == 0 {
                        return;
                    }
                    let capture_count = {
                        let Ok(mut collected) = accumulator_for_title.lock() else {
                            return;
                        };
                        if !message.title.is_empty() && message.title.len() <= 500 {
                            collected.title.clone_from(&message.title);
                        }
                        for photo in message.photos {
                            if photo.id.is_empty()
                                || photo.id.len() > 200
                                || !photo.id.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
                                || !social_photo_capture::validate_photo_url(&photo.url, platform_for_title)
                            {
                                continue;
                            }
                            if let Some(index) = collected.photo_indexes.get(&photo.id).copied() {
                                if collected.photos[index].width < photo.width {
                                    collected.photos[index] = photo;
                                }
                            } else {
                                let index = collected.photos.len();
                                collected.photo_indexes.insert(photo.id.clone(), index);
                                collected.photos.push(photo);
                            }
                        }
                        collected.photos.len()
                    };
                    let _ = window.set_title(&format!("Found {capture_count} {} photos...", platform_for_title.label()));
                    let ack_key = serde_json::to_string(&format!("__JANE_SOCIAL_PHOTO_ACK__{nonce_for_title}"))
                        .expect("acknowledgment key is a string");
                    let _ = window.eval(&format!("window[{ack_key}] = {};", message.sequence));
                }
                "done" => {
                    let result = accumulator_for_title.lock().map_err(|_| "The public photo list became unavailable.".to_string()).and_then(|collected| {
                        if message.count == 0 || message.count > 500 || collected.photos.len() != message.count {
                            return Err(format!(
                                "{} reported {} photos, but JaneConverter received {}. No partial post was saved.",
                                platform_for_title.label(), message.count, collected.photos.len()
                            ));
                        }
                        let title = if !message.title.is_empty() { message.title } else { collected.title.clone() };
                        Ok(social_photo_capture::manifest(
                            platform_for_title,
                            title,
                            collected.photos.clone(),
                        ))
                    });
                    let _ = sender_for_title.send(result);
                    let _ = window.close();
                }
                "no_photos" if platform_for_title == social_photo_capture::SocialPlatform::Twitter => {
                    let _ = sender_for_title.send(Err("NO_PUBLIC_PHOTOS".into()));
                    let _ = window.close();
                }
                "error" => {
                    let error = if message.error.len() <= 400 { message.error } else {
                        format!("{} could not show this post to a logged-out visitor.", platform_for_title.label())
                    };
                    let _ = sender_for_title.send(Err(error));
                    let _ = window.close();
                }
                _ => {}
            }
        });

    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            clean_social_capture_profile(&profile);
            return Err(format!(
                "Could not open the isolated {} guest session: {error}",
                platform.label()
            ));
        }
    };
    drop(sender);
    state
        .social_captures
        .lock()
        .map_err(|_| "The public photo capture registry is unavailable.")?
        .insert(capture_id.clone(), window.clone());

    let received = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(90))
    })
    .await;
    if let Ok(mut captures) = state.social_captures.lock() {
        captures.remove(&capture_id);
    }
    let _ = window.close();
    clean_social_capture_profile(&profile);

    match received {
        Ok(Ok(Ok(manifest))) => {
            let result = SocialCaptureResult {
                capture_id: capture_id.clone(),
                title: manifest.title.clone(),
                photo_count: manifest.photos.len(),
            };
            state
                .social_manifests
                .lock()
                .map_err(|_| "The public photo manifest registry is unavailable.")?
                .insert(
                    capture_id,
                    (
                        source.trim().to_string(),
                        manifest,
                        std::time::Instant::now(),
                    ),
                );
            Ok(result)
        }
        Ok(Ok(Err(message))) => Err(message),
        Ok(Err(mpsc::RecvTimeoutError::Timeout)) => Err(format!(
            "{} did not finish showing its public photos within 90 seconds.",
            platform.label()
        )),
        Ok(Err(mpsc::RecvTimeoutError::Disconnected)) => {
            Err("Public photo capture was cancelled.".into())
        }
        Err(_) => Err("The public photo capture could not finish.".into()),
    }
}

#[tauri::command]
fn cancel_social_post_photos(state: State<'_, AppState>, capture_id: String) -> Result<(), String> {
    if !valid_capture_id(&capture_id) {
        return Err("The photo capture session is invalid.".into());
    }
    let window = state
        .social_captures
        .lock()
        .map_err(|_| "The public photo capture registry is unavailable.")?
        .remove(&capture_id);
    if let Some(window) = window {
        window
            .close()
            .map_err(|error| format!("Could not cancel the photo capture: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn start_conversion(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: ConversionRequest,
) -> Result<String, String> {
    if request.facebook_capture_id.is_some() && request.social_capture_id.is_some() {
        return Err("Use only one public photo capture for a conversion.".into());
    }
    if !state
        .social_captures
        .lock()
        .map_err(|_| "The public photo capture registry is unavailable.")?
        .is_empty()
    {
        return Err("Finish or cancel the current photo capture first.".into());
    }
    if state
        .active_child
        .lock()
        .map_err(|_| "The conversion registry is unavailable.")?
        .is_some()
    {
        return Err("A conversion is already running.".into());
    }
    let facebook_capture_id = request.facebook_capture_id.clone();
    let facebook_session = {
        let captures = state
            .facebook_captures
            .lock()
            .map_err(|_| "The Facebook capture registry is unavailable.")?;
        if let Some(capture_id) = facebook_capture_id.as_deref() {
            if !valid_capture_id(capture_id)
                || captures.len() != 1
                || !captures.contains_key(capture_id)
            {
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
            if !captures.is_empty() {
                return Err("Finish or cancel the current Facebook photo capture first.".into());
            }
            None
        }
    };
    let facebook_manifest = if let Some(capture_id) = facebook_capture_id.as_deref() {
        if !valid_capture_id(&capture_id) {
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
        if facebook_capture::validate_post_url(&request.source).is_ok()
            && !facebook_capture::is_video_conversion_intent(&request.category, &request.format)
        {
            return Err("Capture the public Facebook album before starting its download.".into());
        }
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
        if let (Some(capture_id), Some(manifest)) = (facebook_capture_id, retry_manifest) {
            if let Ok(captures) = state.facebook_captures.lock() {
                if let Some(session) = captures.get(&capture_id) {
                    session.in_use.store(false, Ordering::Relaxed);
                    if let Ok(mut manifests) = state.facebook_manifests.lock() {
                        manifests.insert(capture_id, (source_for_retry, manifest, Instant::now()));
                    }
                }
            }
        }
        return Err(error);
    }
    Ok(job_id)
}

#[tauri::command]
fn cancel_conversion(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
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
fn load_playlist(
    _state: State<'_, AppState>,
    source: String,
) -> Result<model::PlaylistCatalog, String> {
    load_playlist_engine(&source, None)
}

#[tauri::command]
fn scan_library(path: String) -> Result<Vec<LibraryEntry>, String> {
    library::scan(&path)
}

#[tauri::command]
fn is_converted_library_path(path: String) -> bool {
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
fn recent_conversions(path: String, limit: usize) -> Result<Vec<LibraryEntry>, String> {
    library::recent(&path, limit)
}

#[tauri::command]
async fn drag_library_file(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let root = settings_get_internal().output_dir;
        let file = library::draggable_media_file(&root, &path)?;
        let (sender, receiver) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let result = drag::start_drag(
                &window,
                drag::DragItem::Files(vec![file]),
                drag::Image::Raw(include_bytes!("../../../assets/icon.png").to_vec()),
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
fn get_thumbnail(root: String, path: String) -> Result<Option<String>, String> {
    library::thumbnail(&root, &path)
}

#[tauri::command]
fn move_library(source: String, destination_parent: String) -> Result<String, String> {
    let mut settings = settings_get_internal();
    let configured = fs::canonicalize(settings.output_dir.trim())
        .map_err(|error| format!("The configured library is unavailable: {error}"))?;
    let requested = fs::canonicalize(source.trim())
        .map_err(|error| format!("The current library is unavailable: {error}"))?;
    if configured != requested {
        return Err("For safety, only the active converted library can be moved.".into());
    }
    let destination = library::move_directory(&source, &destination_parent)?;
    settings.output_dir = destination.clone();
    write_settings(&settings).map_err(|error| {
        format!(
            "The library moved to {destination}, but JaneConverter could not save the new location: {error}"
        )
    })?;
    Ok(destination)
}

#[tauri::command]
fn move_fetched_folder(
    state: State<'_, AppState>,
    source: String,
    destination_parent: String,
) -> Result<String, String> {
    if state
        .access
        .lock()
        .map_err(|_| "The access registry is unavailable.")?
        .is_some()
    {
        return Err("Clear browser access before moving the fetched media folder.".into());
    }

    let mut settings = settings_get_internal();
    let configured = fs::canonicalize(settings.fetched_dir.trim())
        .map_err(|error| format!("The configured fetched media folder is unavailable: {error}"))?;
    let requested = fs::canonicalize(source.trim())
        .map_err(|error| format!("The current fetched media folder is unavailable: {error}"))?;
    if configured != requested {
        return Err("For safety, only the active fetched media folder can be moved.".into());
    }
    let destination = library::move_directory(&source, &destination_parent)?;
    settings.fetched_dir = destination.clone();
    write_settings(&settings).map_err(|error| {
        format!(
            "The fetched media folder moved to {destination}, but JaneConverter could not save the new location: {error}"
        )
    })?;
    Ok(destination)
}

#[tauri::command]
fn delete_library_entry(root: String, path: String) -> Result<(), String> {
    library::delete_inside(&root, &path)
}

#[tauri::command]
fn create_access_link(state: State<'_, AppState>, source: String) -> Result<AccessStatus, String> {
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
fn access_status(state: State<'_, AppState>) -> AccessStatus {
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
fn fetched_media(state: State<'_, AppState>) -> Vec<FetchedMedia> {
    let fallback_root = PathBuf::from(settings_get_internal().fetched_dir);
    state
        .access
        .lock()
        .ok()
        .and_then(|value| value.as_ref().map(access::AccessServer::fetched_media))
        .unwrap_or_else(|| access::scan_fetched_media(&fallback_root))
}

#[tauri::command]
fn access_diagnostics(state: State<'_, AppState>) -> Vec<AccessDiagnostic> {
    state
        .access
        .lock()
        .ok()
        .and_then(|value| value.as_ref().map(access::AccessServer::diagnostics))
        .unwrap_or_default()
}

#[tauri::command]
fn fetched_media_thumbnail(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<String>, String> {
    let fallback_root = settings_get_internal().fetched_dir;
    let access = state
        .access
        .lock()
        .map_err(|_| "The access registry is unavailable.".to_owned())?;
    match access.as_ref() {
        Some(server) => server.fetched_media_thumbnail(&path),
        None => library::thumbnail(&fallback_root, &path),
    }
}

#[tauri::command]
fn discard_fetched_media(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let fallback_root = settings_get_internal().fetched_dir;
    let access = state
        .access
        .lock()
        .map_err(|_| "The access registry is unavailable.".to_owned())?;
    match access.as_ref() {
        Some(server) => server.discard_fetched_media(&path),
        None => library::delete_inside(&fallback_root, &path),
    }
}

#[tauri::command]
fn clear_access_link(state: State<'_, AppState>) -> Result<(), String> {
    let mut access = state
        .access
        .lock()
        .map_err(|_| "The access registry is unavailable.")?;
    *access = None;
    Ok(())
}

#[tauri::command]
fn relaunch(app: tauri::AppHandle) -> Result<(), String> {
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

fn format_update_summary(stdout: &str) -> String {
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
                            "JaneConverter repository build is up to date ({ }).",
                            short_commit(current_commit)
                        ));
                    }
                } else {
                    messages.push(format!(
                        "JaneConverter repository build is up to date ({ }).",
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

fn format_update_summary_value(payload: &serde_json::Value) -> String {
    format_update_summary(&payload.to_string())
}

#[tauri::command]
async fn check_updates(
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
    command
        .current_dir(project_root())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_command(&mut command);
    let mut payload = match command.output() {
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
            "engine": { "has_update": false, "online": false, "error": error.to_string() }
        }),
        Err(error) => return Err(format!("Could not start update check: {error}")),
    };
    if !payload.is_object() {
        payload = serde_json::json!({});
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
                .timeout(Duration::from_secs(20))
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
                    let latest_commit = update
                        .raw_json
                        .get("build_commit")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    let version_commit = build_metadata_commit(&update.version).unwrap_or_default();
                    if !is_commit_sha(&latest_commit)
                        || !is_commit_sha(version_commit)
                        || !latest_commit.eq_ignore_ascii_case(version_commit)
                    {
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
                                "error": "The signed update metadata did not match its build."
                            }),
                        );
                    } else if latest_commit.eq_ignore_ascii_case(BUILD_COMMIT) {
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
                                "latest_version": update.version,
                                "installer_available": false,
                                "release_url": "https://github.com/jeongchaeul/JaneConverter/releases/tag/continuous",
                                "error": null
                            }),
                        );
                    } else {
                        let latest_version = update.version.clone();
                        *pending_update
                            .0
                            .lock()
                            .map_err(|_| "The pending update state is unavailable.".to_owned())? =
                            Some(update);
                        object.insert(
                            "repo".into(),
                            serde_json::json!({
                                "has_update": true,
                                "is_git": false,
                                "online": true,
                                "current_commit": BUILD_COMMIT,
                                "latest_commit": latest_commit,
                                "commits_behind": 1,
                                "current_version": current_version,
                                "latest_version": latest_version,
                                "installer_available": true,
                                "release_url": "https://github.com/jeongchaeul/JaneConverter/releases/tag/continuous",
                                "error": null
                            }),
                        );
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
                            "error": null
                        }),
                    );
                }
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
                            "error": "The signed repository update feed could not be reached or verified."
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
async fn install_update(
    _app: tauri::AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending_update
        .0
        .lock()
        .map_err(|_| "The pending update state is unavailable.".to_owned())?
        .take()
        .ok_or_else(|| "Check for updates again before installing.".to_owned())?;
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

pub fn run() {
    cleanup_stale_update_installers();
    let builder = tauri::Builder::default();
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .manage(AppState::default())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            hardware_snapshot,
            settings_get,
            settings_save,
            set_data_root_path,
            choose_file,
            choose_files,
            choose_folder,
            open_path,
            open_file,
            open_url,
            capture_facebook_album,
            cancel_facebook_album,
            capture_social_post_photos,
            cancel_social_post_photos,
            start_conversion,
            cancel_conversion,
            load_playlist,
            scan_library,
            is_converted_library_path,
            recent_conversions,
            drag_library_file,
            get_thumbnail,
            move_library,
            move_fetched_folder,
            delete_library_entry,
            create_access_link,
            access_status,
            fetched_media,
            access_diagnostics,
            fetched_media_thumbnail,
            discard_fetched_media,
            clear_access_link,
            relaunch,
            check_updates,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running JaneConverter Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ConversionRequest;

    #[test]
    fn cancellation_only_matches_the_active_job() {
        assert!(job_is_active(Some("conversion-123"), " conversion-123 "));
        assert!(!job_is_active(Some("conversion-123"), "conversion-stale"));
        assert!(!job_is_active(None, "conversion-123"));
    }

    #[test]
    fn facebook_refresh_ids_are_strictly_bounded() {
        assert!(valid_refresh_request_id("0123456789abcdef0123456789abcdef"));
        assert!(!valid_refresh_request_id("0123456789abcdef"));
        assert!(valid_facebook_photo_id("123456789"));
        assert!(!valid_facebook_photo_id("123"));
        assert!(!valid_facebook_photo_id("12abc6789"));
    }

    #[test]
    fn settings_default_is_project_local() {
        assert!(paths::default_output_dir().ends_with("converted"));
    }

    #[test]
    fn project_root_contains_converter_engine() {
        assert!(paths::project_root()
            .join("src")
            .join("janeconverter")
            .join("cli.py")
            .is_file());
    }

    #[test]
    fn update_summary_is_human_readable() {
        let summary = format_update_summary(
            r#"{"engine":{"has_update":false,"current_version":"2026.08.30","latest_version":"2026.08.19","online":true},"repo":{"has_update":false,"is_git":false,"current_commit":"unknown","latest_commit":"unknown","commits_behind":0,"error":"Not a Git repository"}}"#,
        );
        assert!(summary.contains("Extractor engine is up to date"));
        assert!(summary.contains("repository check unavailable"));
        assert!(!summary.contains("\"engine\""));
    }

    #[test]
    fn packaged_snapshot_reports_published_release() {
        let summary = format_update_summary(
            r#"{"engine":{"has_update":false,"current_version":"2026.08.30","latest_version":"2026.08.19","online":true},"repo":{"has_update":true,"is_git":false,"current_version":"1.2.0","latest_version":"1.3.0","installer_available":true,"error":null}}"#,
        );
        assert!(summary.contains("JaneConverter update available: v1.2.0 -> v1.3.0"));
        assert!(summary.contains("latest consumer installer"));
        assert!(!summary.contains("not a Git repository"));
    }

    #[test]
    fn updater_accepts_newer_build_metadata_without_version_bump() {
        let commit = "0123456789abcdef0123456789abcdef01234567";
        assert!(is_newer_updater_build(
            "2.2.6",
            &format!("2.2.6+build.1.g{commit}")
        ));
        assert!(is_newer_updater_build(
            &format!("2.2.6+build.4.g{commit}"),
            &format!("2.2.6+build.5.g{commit}")
        ));
        assert!(!is_newer_updater_build(
            &format!("2.2.6+build.5.g{commit}"),
            &format!("2.2.6+build.5.g{commit}")
        ));
        assert!(!is_newer_updater_build(
            "2.2.7",
            &format!("2.2.6+build.99.g{commit}")
        ));
    }

    #[test]
    fn updater_commit_metadata_must_match_a_full_sha() {
        let commit = "0123456789abcdef0123456789abcdef01234567";
        assert_eq!(
            build_metadata_commit(&format!("2.2.6+build.4.g{commit}")),
            Some(commit)
        );
        assert!(build_metadata_commit("2.2.6+build.4.gshort").is_none());
        assert_eq!(short_commit("é123456789"), "é123456");
    }

    #[test]
    fn conversion_request_rejects_empty_source() {
        let request = ConversionRequest {
            source: " ".into(),
            output_dir: "out".into(),
            category: "Music".into(),
            format: "mp3".into(),
            bitrate: "320k".into(),
            sample_rate: 48000,
            resolution: "original".into(),
            normalize: false,
            use_gpu: false,
            save_cover: true,
            save_metadata: true,
            allow_png_fallback: false,
            retries: 2,
            playlist_indexes: None,
            browser_session: None,
            browser_capture_path: None,
            facebook_capture_id: None,
            social_capture_id: None,
        };
        assert!(
            crate::process::build_conversion_args_with_capture(&request, None, None, false)
                .is_err()
        );
    }
}
