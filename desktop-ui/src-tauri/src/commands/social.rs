use crate::facebook_capture;
use crate::model::{FacebookCaptureResult, FacebookPhotoManifest, SocialCaptureResult};
use crate::paths;
use crate::social_photo_capture;
use crate::{AppState, FacebookCaptureSession, FacebookRefreshWaiters};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub fn valid_capture_id(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(index, character)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                character == '-'
            } else {
                character.is_ascii_hexdigit()
            }
        })
}

pub fn valid_refresh_request_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub fn valid_facebook_photo_id(value: &str) -> bool {
    (5..=30).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_digit())
}

pub fn refresh_facebook_candidates(
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
        if !waiters.is_empty() || waiters.contains_key(request_id) {
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
        .eval(format!("window[{function}]({request},{photo});"))
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

pub fn close_facebook_capture_session(
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

pub fn close_idle_facebook_captures(
    captures: &Arc<Mutex<std::collections::HashMap<String, FacebookCaptureSession>>>,
    keep_capture_id: Option<&str>,
) {
    let removed = captures.lock().ok().map(|mut values| {
        let keys: Vec<String> = values
            .iter()
            .filter(|(id, session)| {
                keep_capture_id != Some(id.as_str()) && !session.in_use.load(Ordering::Relaxed)
            })
            .map(|(id, _)| id.clone())
            .collect();
        keys.into_iter()
            .filter_map(|key| values.remove(&key))
            .collect::<Vec<_>>()
    });
    for session in removed.unwrap_or_default() {
        let _ = session.window.close();
        clean_facebook_capture_profile(&session.profile);
    }
}

pub fn close_all_social_captures(
    captures: &Arc<Mutex<std::collections::HashMap<String, WebviewWindow>>>,
) {
    let removed = captures
        .lock()
        .ok()
        .map(|mut values| values.drain().map(|(_, window)| window).collect::<Vec<_>>());
    for window in removed.unwrap_or_default() {
        let _ = window.close();
    }
}

fn recv_with_pause<T>(
    receiver: &mpsc::Receiver<T>,
    timeout: Duration,
    paused: &AtomicBool,
) -> Result<T, mpsc::RecvTimeoutError> {
    let step = Duration::from_millis(250);
    let mut active_elapsed = Duration::ZERO;
    loop {
        match receiver.recv_timeout(step) {
            Ok(value) => return Ok(value),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(mpsc::RecvTimeoutError::Disconnected);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !paused.load(Ordering::Relaxed) {
                    active_elapsed += step;
                    if active_elapsed >= timeout {
                        return Err(mpsc::RecvTimeoutError::Timeout);
                    }
                }
            }
        }
    }
}

fn clean_profile_directory_delayed(path: PathBuf, prefix: &'static str) {
    let _ = std::thread::Builder::new()
        .name("jane-clean-profile".into())
        .spawn(move || {
            let Ok(temp_root) = fs::canonicalize(std::env::temp_dir()) else {
                return;
            };
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                return;
            };
            if !name.starts_with(prefix)
                || path
                    .parent()
                    .and_then(|parent| fs::canonicalize(parent).ok())
                    .as_deref()
                    != Some(temp_root.as_path())
            {
                return;
            }
            for attempt in 0..6 {
                if !path.exists() {
                    break;
                }
                if let Ok(metadata) = fs::symlink_metadata(&path) {
                    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
                        if fs::remove_dir_all(&path).is_ok() {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                std::thread::sleep(Duration::from_millis(100 * (1 << attempt.min(3))));
            }
        });
}

fn clean_facebook_capture_profile(path: &Path) {
    clean_profile_directory_delayed(path.to_path_buf(), "JaneConverter-facebook-");
}

fn clean_social_capture_profile(path: &Path) {
    clean_profile_directory_delayed(path.to_path_buf(), "JaneConverter-social-");
}

pub fn sweep_stale_webview_profiles() {
    let _ = std::thread::Builder::new()
        .name("jane-sweep-profiles".into())
        .spawn(|| {
            let temp = std::env::temp_dir();
            let Ok(entries) = fs::read_dir(&temp) else {
                return;
            };
            let max_age = Duration::from_secs(15 * 60);
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with("JaneConverter-facebook-")
                    || name.starts_with("JaneConverter-social-")
                {
                    let path = entry.path();
                    if let Ok(metadata) = fs::symlink_metadata(&path) {
                        if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
                            let is_stale = metadata
                                .modified()
                                .ok()
                                .and_then(|m| m.elapsed().ok())
                                .is_some_and(|elapsed| elapsed > max_age);
                            if is_stale {
                                let _ = fs::remove_dir_all(&path);
                            }
                        }
                    }
                }
            }
        });
}

#[tauri::command]
pub async fn capture_facebook_album(
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

    state.active_paused.store(false, Ordering::Relaxed);
    state
        .facebook_manifests
        .lock()
        .map_err(|_| "The Facebook photo manifest registry is unavailable.")?
        .retain(|_, (_, _, created)| created.elapsed() < Duration::from_secs(600));

    close_idle_facebook_captures(&state.facebook_captures, None);
    close_all_social_captures(&state.social_captures);

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
                        if !message.title.is_empty() && message.title.chars().count() <= 500 {
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
                            .unwrap_or_else(|_| {
                                format!("\"__JANE_FACEBOOK_ACK__{nonce_for_title}\"")
                            });
                    let _ = window.eval(format!("window[{ack_key}] = {sequence};"));
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
                                message.title.chars().take(500).collect()
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
                    let message = if message.error.chars().count() <= 400 {
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

    let paused_flag = Arc::clone(&state.active_paused);
    let received = tauri::async_runtime::spawn_blocking(move || {
        recv_with_pause(&receiver, Duration::from_secs(210), &paused_flag)
    })
    .await;
    state.active_paused.store(false, Ordering::Relaxed);
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
pub fn cancel_facebook_album(state: State<'_, AppState>, capture_id: String) -> Result<(), String> {
    if !valid_capture_id(&capture_id) {
        return Err("The Facebook capture session is invalid.".into());
    }
    state.active_paused.store(false, Ordering::Relaxed);
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
pub async fn capture_social_post_photos(
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
    state.active_paused.store(false, Ordering::Relaxed);
    state
        .social_manifests
        .lock()
        .map_err(|_| "The public photo manifest registry is unavailable.")?
        .retain(|_, (_, _, created)| created.elapsed() < Duration::from_secs(600));
    close_all_social_captures(&state.social_captures);
    close_idle_facebook_captures(&state.facebook_captures, None);

    let sequence = state.sequence.fetch_add(1, Ordering::Relaxed);
    let nonce = format!("{}-{sequence}", paths::now_stamp());
    let label = format!("social-photo-capture-{sequence}");
    let profile = std::env::temp_dir().join(format!("JaneConverter-social-{nonce}"));
    fs::create_dir(&profile)
        .map_err(|error| format!("Could not create a temporary guest session: {error}"))?;

    let (sender, receiver) =
        mpsc::channel::<Result<social_photo_capture::CaptureOutcome, String>>();
    let accumulator = Arc::new(Mutex::new(
        social_photo_capture::CaptureAccumulator::default(),
    ));
    let accumulator_for_title = Arc::clone(&accumulator);
    let nonce_for_title = nonce.clone();
    let sender_for_title = sender.clone();
    let platform_for_title = platform;
    let initial_script =
        social_photo_capture::initialization_script(&nonce, platform, source_url.as_str());
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(source_url))
        .title(format!("Reading public {} photos", platform.label()))
        .inner_size(940.0, 700.0)
        .visible(false)
        .incognito(true)
        .data_directory(profile.clone())
        .initialization_script(&initial_script)
        .on_navigation(move |url| {
            social_photo_capture::is_allowed_navigation(url.as_str(), platform)
        })
        .on_document_title_changed(move |window, title| {
            let Some(message) = social_photo_capture::message_from_title(&title, &nonce_for_title)
            else {
                return;
            };
            if message.platform != platform_for_title.key() {
                return;
            }
            match message.kind.as_str() {
                "photos" => {
                    if message.photos.is_empty()
                        || message.photos.len() > 25
                        || message.sequence == 0
                    {
                        return;
                    }
                    let capture_count = {
                        let Ok(mut collected) = accumulator_for_title.lock() else {
                            return;
                        };
                        if !message.title.is_empty() && message.title.chars().count() <= 500 {
                            collected.title.clone_from(&message.title);
                        }
                        for photo in message.photos {
                            if photo.id.is_empty()
                                || photo.id.len() > 200
                                || !photo.id.bytes().all(|byte| {
                                    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
                                })
                                || !social_photo_capture::validate_photo_url(
                                    &photo.url,
                                    platform_for_title,
                                )
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
                    let _ = window.set_title(&format!(
                        "Found {capture_count} {} photos...",
                        platform_for_title.label()
                    ));
                    let ack_key = serde_json::to_string(&format!(
                        "__JANE_SOCIAL_PHOTO_ACK__{nonce_for_title}"
                    ))
                    .unwrap_or_else(|_| format!("\"__JANE_SOCIAL_PHOTO_ACK__{nonce_for_title}\""));
                    let _ = window.eval(format!("window[{ack_key}] = {};", message.sequence));
                }
                "done" => {
                    let result = accumulator_for_title
                        .lock()
                        .map_err(|_| "The public photo list became unavailable.".to_string())
                        .and_then(|collected| {
                            social_photo_capture::validate_completion(
                                &message,
                                collected.photos.len(),
                            )?;
                            let title = if !message.title.is_empty() {
                                message.title.chars().take(500).collect()
                            } else {
                                collected.title.clone()
                            };
                            Ok(social_photo_capture::CaptureOutcome::Photos(
                                social_photo_capture::manifest(
                                    platform_for_title,
                                    title,
                                    collected.photos.clone(),
                                ),
                            ))
                        });
                    let _ = sender_for_title.send(result);
                    let _ = window.close();
                }
                "video" => {
                    let title = message.title.chars().take(500).collect();
                    let _ = sender_for_title
                        .send(Ok(social_photo_capture::CaptureOutcome::Video(title)));
                    let _ = window.close();
                }
                "no_photos"
                    if platform_for_title == social_photo_capture::SocialPlatform::Twitter =>
                {
                    let _ = sender_for_title.send(Err("NO_PUBLIC_PHOTOS".into()));
                    let _ = window.close();
                }
                "error" => {
                    let error = if message.error.chars().count() <= 400 {
                        message.error
                    } else {
                        format!(
                            "{} could not show this post to a logged-out visitor.",
                            platform_for_title.label()
                        )
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

    let paused_flag = Arc::clone(&state.active_paused);
    let received = tauri::async_runtime::spawn_blocking(move || {
        recv_with_pause(&receiver, Duration::from_secs(90), &paused_flag)
    })
    .await;
    state.active_paused.store(false, Ordering::Relaxed);
    if let Ok(mut captures) = state.social_captures.lock() {
        captures.remove(&capture_id);
    }
    let _ = window.close();
    clean_social_capture_profile(&profile);

    match received {
        Ok(Ok(Ok(social_photo_capture::CaptureOutcome::Photos(manifest)))) => {
            let result = SocialCaptureResult {
                capture_id: capture_id.clone(),
                title: manifest.title.clone(),
                photo_count: manifest.photos.len(),
                media_kind: "photo",
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
        Ok(Ok(Ok(social_photo_capture::CaptureOutcome::Video(title)))) => Ok(SocialCaptureResult {
            capture_id,
            title,
            photo_count: 0,
            media_kind: "video",
        }),
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
pub fn cancel_social_post_photos(
    state: State<'_, AppState>,
    capture_id: String,
) -> Result<(), String> {
    if !valid_capture_id(&capture_id) {
        return Err("The photo capture session is invalid.".into());
    }
    state.active_paused.store(false, Ordering::Relaxed);
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
