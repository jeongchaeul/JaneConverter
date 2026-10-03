use crate::model::{
    ConversionRequest, ConverterEvent, FacebookPhotoManifest, PlaylistCatalog, PlaylistItem,
    SocialPhotoManifest,
};
use crate::paths::{find_python, packaged_engine, prepare_command, project_root};
use std::io::{BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Emitter;

pub type FacebookRefreshHandler =
    Arc<dyn Fn(&str, &str) -> Result<Vec<String>, String> + Send + Sync>;

const FACEBOOK_REFRESH_PREFIX: &str = "__JANE_FB_REFRESH__";

fn parse_facebook_refresh_request(line: &str) -> Option<(String, String)> {
    let request = line.strip_prefix(FACEBOOK_REFRESH_PREFIX)?;
    let (request_id, photo_id) = request.split_once('\t')?;
    if request_id.len() != 32
        || !request_id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !(5..=30).contains(&photo_id.len())
        || !photo_id.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    Some((request_id.to_owned(), photo_id.to_owned()))
}

pub fn progress_from_line(line: &str) -> Option<f32> {
    let start = line.find('[')?;
    let end = line[start + 1..].find('%')? + start + 1;
    line[start + 1..end]
        .trim()
        .parse::<f32>()
        .ok()
        .map(|value| (value / 100.0).clamp(0.0, 1.0))
}

#[cfg(target_os = "windows")]
fn flash_windows_taskbar(window: &tauri::WebviewWindow) {
    #[repr(C)]
    struct FlashwInfo {
        cb_size: u32,
        hwnd: isize,
        dw_flags: u32,
        u_count: u32,
        dw_timeout: u32,
    }
    extern "system" {
        fn FlashWindowEx(pfwi: *const FlashwInfo) -> i32;
        fn GetForegroundWindow() -> isize;
    }
    const FLASHW_ALL: u32 = 0x0000_0003;
    const FLASHW_TIMERNOFG: u32 = 0x0000_000C;

    if let Ok(hwnd) = window.hwnd() {
        let raw_hwnd = hwnd.0 as isize;
        if raw_hwnd != 0 {
            // SAFETY: FlashWindowEx and GetForegroundWindow are standard Win32 user32 functions;
            // raw_hwnd is a valid top-level window handle owned by Tauri.
            unsafe {
                let is_foreground = GetForegroundWindow() == raw_hwnd;
                let info = FlashwInfo {
                    cb_size: std::mem::size_of::<FlashwInfo>() as u32,
                    hwnd: raw_hwnd,
                    dw_flags: if is_foreground {
                        FLASHW_ALL
                    } else {
                        FLASHW_ALL | FLASHW_TIMERNOFG
                    },
                    u_count: if is_foreground { 3 } else { u32::MAX },
                    dw_timeout: 0,
                };
                let _ = FlashWindowEx(&info);
            }
        }
    }
}

pub fn notify_user_attention(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Critical));
        #[cfg(target_os = "windows")]
        flash_windows_taskbar(&window);
    }
}

pub fn emit_event(app: &tauri::AppHandle, event: ConverterEvent) {
    let should_notify = matches!(event.kind.as_str(), "finished" | "failed" | "partial");
    let _ = app.emit("converter-event", event);
    if should_notify {
        notify_user_attention(app);
    }
}

fn failure_detail_from_line(line: &str) -> Option<String> {
    let (label, detail) = line.trim().split_once(':')?;
    let label = label.trim();
    let detail = detail.trim();
    if detail.is_empty()
        || !(label.ends_with("Error")
            || label.ends_with("Exception")
            || label.eq_ignore_ascii_case("error"))
    {
        return None;
    }
    Some(detail.chars().take(500).collect())
}

fn partial_summary_from_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if let Some(rest) = trimmed.strip_prefix("PARTIAL_COMPLETION:") {
        let text = rest.trim();
        if !text.is_empty() {
            return Some(text.to_owned());
        }
    }
    if let Some(rest) = trimmed.strip_prefix("[*] Partial completion:") {
        let text = rest.trim();
        if !text.is_empty() {
            return Some(text.to_owned());
        }
    }
    None
}

fn exported_path_from_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let raw = trimmed
        .strip_prefix("DONE! Exported:")
        .or_else(|| trimmed.strip_prefix("Export Directory:"))?
        .trim();
    if raw.is_empty() {
        return None;
    }
    Some(raw.to_owned())
}

pub fn forward_output<R: Read + Send + 'static>(
    reader: R,
    app: tauri::AppHandle,
    job_id: String,
    failure_detail: Option<Arc<Mutex<Option<String>>>>,
    exported_output: Option<Arc<Mutex<Option<String>>>>,
    partial_summary: Option<Arc<Mutex<Option<String>>>>,
    facebook_stdin: Option<Arc<Mutex<ChildStdin>>>,
    facebook_refresh: Option<FacebookRefreshHandler>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut line_buf = Vec::new();

        loop {
            line_buf.clear();
            let mut byte = [0u8; 1];
            loop {
                match buf_reader.read(&mut byte) {
                    Ok(0) => break,
                    Ok(_) => {
                        if byte[0] == b'\n' || byte[0] == b'\r' {
                            break;
                        }
                        line_buf.push(byte[0]);
                    }
                    Err(_) => break,
                }
            }

            if line_buf.is_empty() && byte[0] == 0 {
                break;
            }

            if line_buf.is_empty() {
                continue;
            }

            let message = String::from_utf8_lossy(&line_buf).trim().to_owned();
            if message.is_empty() {
                continue;
            }
            if message.starts_with(FACEBOOK_REFRESH_PREFIX) {
                if let (Some((request_id, photo_id)), Some(stdin), Some(refresh)) = (
                    parse_facebook_refresh_request(&message),
                    facebook_stdin.as_ref(),
                    facebook_refresh.as_ref(),
                ) {
                    let urls = refresh(&request_id, &photo_id).unwrap_or_default();
                    if let Ok(mut input) = stdin.lock() {
                        let response = serde_json::json!({
                            "requestId": request_id,
                            "urls": urls.into_iter().take(4).collect::<Vec<_>>(),
                        });
                        if serde_json::to_writer(&mut *input, &response).is_ok() {
                            let _ = input.write_all(b"\n");
                            let _ = input.flush();
                        }
                    }
                    emit_event(
                        &app,
                        ConverterEvent {
                            job_id: job_id.clone(),
                            kind: "log".into(),
                            message: "Refreshing an expired Facebook photo rendition in the active guest session.".into(),
                            progress: None,
                            output: None,
                        },
                    );
                }
                continue;
            }
            if let Some(detail) = failure_detail_from_line(&message) {
                if let Some(failure_detail) = &failure_detail {
                    if let Ok(mut current) = failure_detail.lock() {
                        *current = Some(detail);
                    }
                }
            }
            if let Some(exported) = exported_path_from_line(&message) {
                if let Some(exported_output) = &exported_output {
                    if let Ok(mut current) = exported_output.lock() {
                        *current = Some(exported);
                    }
                }
            }
            if let Some(partial) = partial_summary_from_line(&message) {
                if let Some(partial_summary) = &partial_summary {
                    if let Ok(mut current) = partial_summary.lock() {
                        *current = Some(partial);
                    }
                }
            }

            let progress = progress_from_line(&message);
            let is_progress = message.starts_with("[download]")
                || message.contains("Downloading stream:")
                || message.starts_with("Transcoding ")
                || message.contains("Transcoding ");
            emit_event(
                &app,
                ConverterEvent {
                    job_id: job_id.clone(),
                    kind: if is_progress { "progress" } else { "log" }.into(),
                    message,
                    progress,
                    output: None,
                },
            );
        }
    })
}

#[cfg(target_os = "windows")]
mod win_suspend {
    use std::collections::{HashSet, VecDeque};
    use std::ffi::c_void;

    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const PROCESS_SUSPEND_RESUME: u32 = 0x0800;
    const INVALID_HANDLE_VALUE: *mut c_void = -1isize as *mut c_void;

    #[repr(C)]
    struct PROCESSENTRY32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> *mut c_void;
        fn Process32FirstW(h_snapshot: *mut c_void, lppe: *mut PROCESSENTRY32W) -> i32;
        fn Process32NextW(h_snapshot: *mut c_void, lppe: *mut PROCESSENTRY32W) -> i32;
        fn OpenProcess(
            dw_desired_access: u32,
            b_inherit_handle: i32,
            dw_process_id: u32,
        ) -> *mut c_void;
        fn CloseHandle(h_object: *mut c_void) -> i32;
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtSuspendProcess(process_handle: *mut c_void) -> i32;
        fn NtResumeProcess(process_handle: *mut c_void) -> i32;
    }

    fn collect_process_tree(root_pid: u32) -> Vec<u32> {
        let mut relations = Vec::new();
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot != INVALID_HANDLE_VALUE && !snapshot.is_null() {
                let mut entry: PROCESSENTRY32W = std::mem::zeroed();
                entry.dw_size = std::mem::size_of::<PROCESSENTRY32W>() as u32;
                if Process32FirstW(snapshot, &mut entry) != 0 {
                    loop {
                        relations.push((entry.th32_process_id, entry.th32_parent_process_id));
                        if Process32NextW(snapshot, &mut entry) == 0 {
                            break;
                        }
                    }
                }
                CloseHandle(snapshot);
            }
        }
        let mut result = Vec::new();
        let mut seen = HashSet::new();
        let mut queue = VecDeque::new();
        seen.insert(root_pid);
        queue.push_back(root_pid);
        while let Some(pid) = queue.pop_front() {
            result.push(pid);
            for &(child_pid, parent_pid) in &relations {
                if parent_pid == pid && seen.insert(child_pid) {
                    queue.push_back(child_pid);
                }
            }
        }
        result
    }

    pub fn set_process_tree_paused(root_pid: u32, paused: bool) -> Result<(), String> {
        let mut pids = collect_process_tree(root_pid);
        if !paused {
            pids.reverse();
        }
        let mut any_succeeded = false;
        for pid in pids {
            unsafe {
                let handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
                if !handle.is_null() {
                    let status = if paused {
                        NtSuspendProcess(handle)
                    } else {
                        NtResumeProcess(handle)
                    };
                    if status >= 0 {
                        any_succeeded = true;
                    }
                    CloseHandle(handle);
                }
            }
        }
        if any_succeeded {
            Ok(())
        } else {
            Err("Could not update the conversion process state.".into())
        }
    }
}

pub fn set_child_paused(child: &mut Child, paused: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win_suspend::set_process_tree_paused(child.id(), paused)
    }
    #[cfg(unix)]
    {
        let process_group = format!("-{}", child.id());
        let signal = if paused { "-STOP" } else { "-CONT" };
        let status = Command::new("kill")
            .args([signal, "--", &process_group])
            .status()
            .map_err(|error| format!("Could not signal conversion process: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not update the conversion process state.".into())
        }
    }
}

pub fn terminate_child(child: &mut Child) {
    let _ = set_child_paused(child, false);
    #[cfg(target_os = "windows")]
    {
        let pid_text = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid_text, "/T", "/F"])
            .status();
    }
    #[cfg(unix)]
    {
        let process_group = format!("-{}", child.id());
        let _ = Command::new("kill")
            .args(["-TERM", "--", &process_group])
            .status();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let _ = child.try_wait();
            thread::sleep(Duration::from_millis(50));
        }
        let _ = Command::new("kill")
            .args(["-KILL", "--", &process_group])
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn build_conversion_args_with_capture(
    request: &ConversionRequest,
    browser: Option<String>,
    browser_media_path: Option<PathBuf>,
    has_facebook_manifest: bool,
) -> Result<Vec<String>, String> {
    if request.source.trim().is_empty() && browser_media_path.is_none() {
        return Err("Paste a media URL or choose a local file first.".into());
    }
    if request.output_dir.trim().is_empty() {
        return Err("Choose an export folder first.".into());
    }
    if ![44100, 48000, 96000].contains(&request.sample_rate) {
        return Err("Unsupported sample rate.".into());
    }
    let engine = find_python();
    let mut args = Vec::new();
    if !packaged_engine(&engine) {
        args.extend(["run".into(), "--locked".into(), "janeconverter".into()]);
    }
    args.extend([
        "--source".into(),
        request.source.trim().into(),
        "--format".into(),
        request.format.trim().into(),
        "--output".into(),
        request.output_dir.trim().into(),
        "--bitrate".into(),
        request.bitrate.trim().into(),
        "--sample-rate".into(),
        request.sample_rate.to_string(),
        "--resolution".into(),
        request.resolution.trim().into(),
        "--category".into(),
        request.category.trim().into(),
        "--retries".into(),
        request.retries.min(5).to_string(),
        "--no-update".into(),
    ]);
    if !request.use_gpu {
        args.push("--no-gpu".into());
    }
    if !request.save_cover {
        args.push("--no-cover-art".into());
    }
    if !request.save_metadata {
        args.push("--no-metadata".into());
    }
    if request.normalize {
        args.push("--normalize".into());
    }
    if request.allow_png_fallback && request.format == "source" && request.category == "Image" {
        args.push("--allow-lossless-png-recovery".into());
    }
    if let Some(browser) = browser
        .or_else(|| request.browser_session.clone())
        .filter(|value| !value.trim().is_empty())
    {
        args.extend([
            "--browser-session".into(),
            normalize_browser_session_arg(&browser)?,
        ]);
    }
    if let Some(path) = browser_media_path {
        if !path.is_file() {
            return Err(
                "The browser capture file is no longer available. Capture the media again.".into(),
            );
        }
        args.extend(["--browser-media-path".into(), path.display().to_string()]);
    }
    if has_facebook_manifest {
        args.push("--facebook-photo-manifest-stdin".into());
        if let Some(capture_id) = request.facebook_capture_id.as_ref() {
            args.extend(["--facebook-capture-id".into(), capture_id.clone()]);
        }
    }
    if request.social_capture_id.is_some() {
        args.push("--social-photo-manifest-stdin".into());
    }
    if let Some(indexes) = &request.playlist_indexes {
        if !indexes.trim().is_empty() {
            args.extend([
                "--playlist".into(),
                "--playlist-indexes".into(),
                indexes.trim().into(),
            ]);
        }
    }
    Ok(args)
}

fn normalize_browser_session_arg(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "none"
            | "chrome"
            | "edge"
            | "firefox"
            | "brave"
            | "vivaldi"
            | "opera"
            | "chromium"
            | "safari"
    ) {
        return Ok(normalized);
    }
    Err(format!(
        "Unsupported browser session '{value}'. Choose Chrome, Edge, Firefox, Brave, Vivaldi, Opera, Chromium, Safari, or Public only."
    ))
}

pub struct ConversionSlots {
    pub child: Arc<Mutex<Option<Arc<Mutex<Child>>>>>,
    pub cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    pub facebook_refresh: Option<FacebookRefreshHandler>,
}

pub fn start_conversion(
    app: tauri::AppHandle,
    job_id: String,
    request: ConversionRequest,
    browser: Option<String>,
    browser_media_path: Option<PathBuf>,
    facebook_manifest: Option<FacebookPhotoManifest>,
    social_manifest: Option<SocialPhotoManifest>,
    slots: ConversionSlots,
    output: impl FnOnce(i32, bool) + Send + 'static,
) -> Result<(), String> {
    let has_facebook_manifest = facebook_manifest.is_some();
    let manifest_json = if let Some(manifest) = social_manifest.as_ref() {
        Some(serde_json::to_vec(manifest))
            .transpose()
            .map_err(|error| format!("Could not prepare the social photo list: {error}"))?
    } else {
        facebook_manifest
            .as_ref()
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|error| format!("Could not prepare the Facebook photo list: {error}"))?
    };
    let args = build_conversion_args_with_capture(
        &request,
        browser,
        browser_media_path,
        has_facebook_manifest,
    )?;
    std::fs::create_dir_all(&request.output_dir)
        .map_err(|error| format!("Could not use the export folder: {error}"))?;
    let mut command = Command::new(find_python());
    command
        .args(&args)
        .current_dir(project_root())
        .env("PYTHONUNBUFFERED", "1")
        .stdin(if manifest_json.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    prepare_command(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the Python engine: {error}"))?;
    let mut facebook_stdin = None;
    if let Some(manifest_json) = manifest_json {
        let mut input = child.stdin.take().ok_or_else(|| {
            "The Python engine did not accept the captured photo list.".to_string()
        })?;
        if let Err(error) = input
            .write_all(&manifest_json)
            .and_then(|()| input.write_all(b"\n"))
        {
            terminate_child(&mut child);
            return Err(format!(
                "Could not pass the captured photo list to the local engine: {error}"
            ));
        }
        if has_facebook_manifest {
            facebook_stdin = Some(Arc::new(Mutex::new(input)));
        }
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    let cancel = Arc::new(AtomicBool::new(false));
    *slots
        .child
        .lock()
        .map_err(|_| "The conversion process slot is unavailable.")? = Some(Arc::clone(&child));
    *slots
        .cancel
        .lock()
        .map_err(|_| "The cancellation slot is unavailable.")? = Some(Arc::clone(&cancel));
    let started_at = Instant::now();
    let failure_detail = Arc::new(Mutex::new(None));
    let exported_output = Arc::new(Mutex::new(None));
    let partial_summary = Arc::new(Mutex::new(None));
    let stdout_thread = stdout.map(|reader| {
        forward_output(
            reader,
            app.clone(),
            job_id.clone(),
            None,
            Some(Arc::clone(&exported_output)),
            Some(Arc::clone(&partial_summary)),
            facebook_stdin,
            slots.facebook_refresh.clone(),
        )
    });
    let stderr_thread = stderr.map(|reader| {
        forward_output(
            reader,
            app.clone(),
            job_id.clone(),
            Some(Arc::clone(&failure_detail)),
            None,
            None,
            None,
            None,
        )
    });
    emit_event(
        &app,
        ConverterEvent {
            job_id: job_id.clone(),
            kind: "started".into(),
            message: "The local conversion engine is working.".into(),
            progress: Some(0.02),
            output: None,
        },
    );
    let app_for_thread = app.clone();
    thread::spawn(move || {
        let status = loop {
            let result = child
                .lock()
                .ok()
                .and_then(|mut value| value.try_wait().ok())
                .flatten();
            if let Some(status) = result {
                break status;
            }
            thread::sleep(Duration::from_millis(80));
        };
        let elapsed_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let cancelled = cancel.load(Ordering::Relaxed);
        let code = status.code().unwrap_or(1);
        output(code, cancelled);
        if let Some(thread) = stdout_thread {
            let _ = thread.join();
        }
        if let Some(thread) = stderr_thread {
            let _ = thread.join();
        }
        let mut resolved_output = None;
        if !cancelled {
            if let Some(raw_path) = exported_output.lock().ok().and_then(|value| value.clone()) {
                let (record_target, display_output) =
                    crate::library::resolve_exported_output(&raw_path);
                crate::library::record_conversion_timing(&record_target, elapsed_ms);
                resolved_output = Some(display_output);
            }
        }
        let partial_msg = partial_summary.lock().ok().and_then(|value| value.clone());
        let failure_msg = failure_detail.lock().ok().and_then(|value| value.clone());

        let (kind, message, progress) = if cancelled {
            ("cancelled", "Conversion cancelled.".to_string(), None)
        } else if let Some(summary) = partial_msg {
            let msg = if let Some(detail) = failure_msg {
                format!("{summary} ({detail})")
            } else {
                summary
            };
            ("partial", msg, Some(1.0))
        } else if status.success() {
            (
                "finished",
                "Conversion finished. Your media is ready.".to_string(),
                Some(1.0),
            )
        } else if resolved_output.is_some() {
            let msg = failure_msg
                .map(|value| format!("Partial conversion: {value}"))
                .unwrap_or_else(|| "Partial conversion completed with some errors.".to_string());
            ("partial", msg, Some(1.0))
        } else {
            (
                "failed",
                failure_msg
                    .map(|value| format!("Conversion failed: {value}"))
                    .unwrap_or_else(|| "The Python engine reported a conversion failure. Review Console for details.".to_string()),
                None,
            )
        };
        emit_event(
            &app_for_thread,
            ConverterEvent {
                job_id,
                kind: kind.into(),
                message,
                progress,
                output: resolved_output,
            },
        );
    });
    Ok(())
}

pub fn parse_playlist_output(output: &str) -> Result<PlaylistCatalog, String> {
    let mut title = None;
    let mut items = Vec::new();
    for line in output.lines() {
        let mut fields = line.splitn(6, '\t');
        match fields.next() {
            Some("PLAYLIST") => title = fields.next().map(str::to_owned),
            Some("ENTRY") => {
                let index = fields
                    .next()
                    .and_then(|value| value.parse().ok())
                    .ok_or("Playlist item index was invalid.")?;
                let item_title = fields.next().unwrap_or_default().to_owned();
                let artist = fields.next().unwrap_or_default().to_owned();
                let duration = fields.next().unwrap_or_default().to_owned();
                let url = fields.next().unwrap_or_default().to_owned();
                items.push(PlaylistItem {
                    index,
                    title: item_title,
                    artist,
                    duration,
                    url,
                });
            }
            _ => {}
        }
    }
    let title =
        title.ok_or_else(|| "The playlist loader returned no playlist title.".to_owned())?;
    if items.is_empty() {
        return Err("The source contained no usable tracks.".into());
    }
    Ok(PlaylistCatalog { title, items })
}

pub fn bounded_output(
    command: &mut Command,
    timeout: Duration,
    cancel: &AtomicBool,
) -> Result<std::process::Output, String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("Operation cancelled.".into());
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_command(command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start operation: {error}"))?;
    fn drain(mut pipe: impl Read + Send + 'static) -> std::sync::mpsc::Receiver<Vec<u8>> {
        let (sender, receiver) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let mut result = Vec::new();
            let mut buffer = [0u8; 8192];
            while let Ok(size) = pipe.read(&mut buffer) {
                if size == 0 {
                    break;
                }
                let keep = size.min((2 * 1024 * 1024usize).saturating_sub(result.len()));
                result.extend_from_slice(&buffer[..keep]);
            }
            let _ = sender.send(result);
        });
        receiver
    }
    let stdout = drain(child.stdout.take().expect("piped stdout"));
    let stderr = drain(child.stderr.take().expect("piped stderr"));
    let started = Instant::now();
    let status =
        loop {
            if cancel.load(Ordering::Relaxed) || started.elapsed() >= timeout {
                terminate_child(&mut child);
                let _ = stdout.recv_timeout(Duration::from_millis(100));
                let _ = stderr.recv_timeout(Duration::from_millis(100));
                return Err(if cancel.load(Ordering::Relaxed) { "Operation cancelled." } else {
                "Operation timed out. Check the connection, keep the source available, and retry."
            }.into());
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(Duration::from_millis(20)),
                Err(error) => {
                    terminate_child(&mut child);
                    let _ = stdout.recv_timeout(Duration::from_millis(100));
                    let _ = stderr.recv_timeout(Duration::from_millis(100));
                    return Err(format!("Could not wait for operation: {error}"));
                }
            }
        };
    let output = (|| {
        let stdout = stdout
            .recv_timeout(Duration::from_secs(1))
            .map_err(|_| "The operation left its output stream open.")?;
        let stderr = stderr
            .recv_timeout(Duration::from_secs(1))
            .map_err(|_| "The operation left its error stream open.")?;
        Ok(std::process::Output {
            status,
            stdout,
            stderr,
        })
    })();
    if output.is_err() {
        terminate_child(&mut child);
    }
    output
}

pub fn validate_capture(
    path: &std::path::Path,
    kind: &str,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let engine = find_python();
    let mut command = Command::new(&engine);
    if !packaged_engine(&engine) {
        command.args(["run", "--locked", "janeconverter"]);
    }
    command
        .arg("--validate-browser-capture")
        .arg(path)
        .args(["--capture-kind", kind]);
    command.current_dir(project_root());
    let output = bounded_output(&mut command, Duration::from_secs(40), cancel)?;
    if !output.status.success() {
        return Err("The browser returned unreadable or mismatched media. Keep the original item open and retry.".into());
    }
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "The media validator returned an invalid result.")?;
    report
        .get("mimeType")
        .and_then(|value| value.as_str())
        .filter(|value| value.starts_with(&format!("{kind}/")))
        .map(str::to_owned)
        .ok_or_else(|| "The capture does not contain the requested media kind.".into())
}

pub fn load_playlist(
    source: &str,
    browser: Option<String>,
    cancel: &AtomicBool,
) -> Result<PlaylistCatalog, String> {
    let engine = find_python();
    let mut command = Command::new(&engine);
    if !packaged_engine(&engine) {
        command.args(["run", "--locked", "janeconverter"]);
    }
    command.args(["--source", source.trim(), "--list-playlist", "--no-update"]);
    if let Some(browser) = browser.filter(|value| !value.trim().is_empty()) {
        let browser = normalize_browser_session_arg(&browser)?;
        command.args(["--browser-session", browser.as_str()]);
    }
    command
        .current_dir(project_root())
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepare_command(&mut command);
    let output = bounded_output(&mut command, Duration::from_secs(60), cancel)?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if detail.is_empty() {
            "Playlist loading failed. Review Console for details.".into()
        } else {
            detail
        });
    }
    let mut catalog = parse_playlist_output(&String::from_utf8_lossy(&output.stdout))?;
    let _ = browser;
    catalog.items.shrink_to_fit();
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_operations_honour_cancellation_and_deadlines() {
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut c = Command::new("powershell.exe");
            c.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 5"]);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut command = {
            let mut c = Command::new("sh");
            c.args(["-c", "sleep 5"]);
            c
        };
        assert!(
            bounded_output(&mut command, Duration::from_secs(5), &AtomicBool::new(true))
                .unwrap_err()
                .contains("cancelled")
        );
        let started = Instant::now();
        assert!(bounded_output(
            &mut command,
            Duration::from_millis(100),
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn progress_parser_is_bounded() {
        assert_eq!(progress_from_line("[105%] done"), Some(1.0));
        assert_eq!(progress_from_line("plain output"), None);
    }

    #[test]
    fn facebook_refresh_protocol_accepts_only_bounded_ids() {
        assert_eq!(
            parse_facebook_refresh_request(
                "__JANE_FB_REFRESH__0123456789abcdef0123456789abcdef\t123456789"
            ),
            Some((
                "0123456789abcdef0123456789abcdef".into(),
                "123456789".into()
            ))
        );
        assert!(
            parse_facebook_refresh_request("__JANE_FB_REFRESH__not-a-request\t123456789").is_none()
        );
        assert!(parse_facebook_refresh_request(
            "__JANE_FB_REFRESH__0123456789abcdef0123456789abcdef\tbad"
        )
        .is_none());
    }

    #[test]
    fn extracts_engine_failure_without_traceback_noise() {
        assert_eq!(
            failure_detail_from_line(
                "RuntimeError: Facebook returned an unsupported image type for photo 21."
            ),
            Some("Facebook returned an unsupported image type for photo 21.".into())
        );
        assert_eq!(failure_detail_from_line("File \"cli.py\", line 279"), None);
        assert_eq!(failure_detail_from_line("[download] 86%"), None);
    }

    #[test]
    fn parses_playlist_output_with_unicode_fields() {
        let catalog = parse_playlist_output(
            "PLAYLIST\tSongs\nENTRY\t1\tBeyonce\tArtist\t03:20\thttps://example.test/1\n",
        )
        .unwrap();
        assert_eq!(catalog.title, "Songs");
        assert_eq!(catalog.items[0].duration, "03:20");
    }

    #[test]
    fn normalizes_display_browser_label_for_python_cli() {
        let mut request = ConversionRequest {
            source: "https://example.com/private-media".into(),
            output_dir: "out".into(),
            category: "Video".into(),
            format: "mp4".into(),
            bitrate: "original".into(),
            sample_rate: 48000,
            resolution: "original".into(),
            normalize: false,
            use_gpu: false,
            save_cover: true,
            save_metadata: true,
            allow_png_fallback: false,
            retries: 2,
            playlist_indexes: None,
            browser_session: Some("Chrome".into()),
            browser_capture_path: None,
            facebook_capture_id: None,
            social_capture_id: None,
        };
        let args = build_conversion_args_with_capture(&request, None, None, false)
            .expect("display labels should be accepted");
        let flag = args
            .iter()
            .position(|value| value == "--browser-session")
            .expect("browser session flag should be forwarded");
        assert_eq!(args[flag + 1], "chrome");
        request.category = "Image".into();
        request.format = "source".into();
        request.allow_png_fallback = true;
        let args = build_conversion_args_with_capture(&request, None, None, false).unwrap();
        assert!(args.contains(&"--allow-lossless-png-recovery".to_string()));
    }

    #[test]
    fn facebook_manifest_forwards_its_session_id_to_the_engine() {
        let request = ConversionRequest {
            source: "https://www.facebook.com/groups/42/permalink/123456/".into(),
            output_dir: "out".into(),
            category: "Image".into(),
            format: "source".into(),
            bitrate: "original".into(),
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
            facebook_capture_id: Some("01234567-89ab-cdef-0123-456789abcdef".into()),
            social_capture_id: None,
        };
        let args = build_conversion_args_with_capture(&request, None, None, true).unwrap();

        let flag = args
            .iter()
            .position(|value| value == "--facebook-capture-id")
            .expect("the refresh callback needs the active capture id");
        assert_eq!(args[flag + 1], "01234567-89ab-cdef-0123-456789abcdef");
        assert!(args.contains(&"--facebook-photo-manifest-stdin".into()));
    }

    #[test]
    fn browser_capture_allows_empty_source_when_capture_file_exists() {
        let capture_path = std::env::temp_dir().join(format!(
            "janeconverter-capture-test-{}.webm",
            std::process::id()
        ));
        std::fs::write(&capture_path, b"captured").expect("test capture should be writable");
        let request = ConversionRequest {
            source: "".into(),
            output_dir: "out".into(),
            category: "Video".into(),
            format: "mp4".into(),
            bitrate: "original".into(),
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

        let args =
            build_conversion_args_with_capture(&request, None, Some(capture_path.clone()), false)
                .expect("a valid browser capture should satisfy source validation");
        let flag = args
            .iter()
            .position(|value| value == "--browser-media-path")
            .expect("browser capture path should be forwarded");
        assert_eq!(args[flag + 1], capture_path.display().to_string());
        let _ = std::fs::remove_file(capture_path);
    }

    #[test]
    fn public_conversion_does_not_add_browser_session_flag() {
        let request = ConversionRequest {
            source: "https://soundcloud.com/example/track".into(),
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
        let args = build_conversion_args_with_capture(&request, None, None, false)
            .expect("public conversion should be valid");
        assert!(!args.iter().any(|value| value == "--browser-session"));
    }
}
