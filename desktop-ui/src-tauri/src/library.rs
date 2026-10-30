use crate::model::LibraryEntry;
use crate::paths::{data_root, find_ffmpeg, now_stamp, prepare_command};
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static TIMINGS_LOCK: Mutex<()> = Mutex::new(());

pub fn clean_windows_path(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(unc) = trimmed.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if let Some(plain) = trimmed.strip_prefix(r"\\?\") {
        plain.to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn timing_key(path: &Path) -> String {
    clean_windows_path(&path.display().to_string())
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn timings_file() -> PathBuf {
    data_root().join("conversion_timings.json")
}

fn load_conversion_timings() -> HashMap<String, u64> {
    let Ok(bytes) = fs::read(timings_file()) else {
        return HashMap::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub fn record_conversion_timing(path: &Path, elapsed_ms: u64) {
    let Ok(_guard) = TIMINGS_LOCK.lock() else {
        return;
    };
    let mut timings = load_conversion_timings();
    timings.insert(timing_key(path), elapsed_ms);
    if path.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let child = entry.path();
                if child.is_file() && library_file_extension(&child) && !is_metadata_path(&child) {
                    timings.insert(timing_key(&child), elapsed_ms);
                }
            }
        }
    }
    if timings.len() > 2000 {
        let mut sorted_keys: Vec<String> = timings.keys().cloned().collect();
        sorted_keys.sort();
        for key in sorted_keys.into_iter().take(timings.len() - 2000) {
            timings.remove(&key);
        }
    }
    if let Ok(serialized) = serde_json::to_vec(&timings) {
        let target = timings_file();
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let temp = target.with_extension("json.tmp");
        if fs::write(&temp, &serialized).is_ok() {
            let _ = fs::rename(&temp, &target);
        }
    }
}

pub fn clear_conversion_timings() -> Result<(), String> {
    let _guard = TIMINGS_LOCK
        .lock()
        .map_err(|_| "The conversion timing registry is unavailable.".to_string())?;
    let path = timings_file();
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not clear temp conversion history: {error}"))?;
    }
    Ok(())
}

pub fn first_media_file_in_dir(dir: &Path) -> Option<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && library_file_extension(path) && !is_metadata_path(path))
        .collect();
    files.sort_by(|left, right| {
        left.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
            .cmp(
                &right
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase(),
            )
    });
    files.into_iter().next()
}

pub fn resolve_exported_output(raw_path: &str) -> (PathBuf, String) {
    let clean = PathBuf::from(clean_windows_path(raw_path));
    if clean.is_dir() {
        let media_files: Vec<PathBuf> = fs::read_dir(&clean)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file() && library_file_extension(path) && !is_metadata_path(path)
            })
            .collect();
        if media_files.len() == 1 {
            let single = media_files.into_iter().next().unwrap();
            let display = clean_windows_path(&single.display().to_string());
            return (clean, display);
        }
    }
    let display = clean_windows_path(&clean.display().to_string());
    (clean, display)
}

pub fn media_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "mp3"
            | "flac"
            | "wav"
            | "aac"
            | "m4a"
            | "ogg"
            | "opus"
            | "aiff"
            | "aif"
            | "alac"
            | "ac3"
            | "mp2"
            | "wma"
            | "caf"
            | "au"
            | "mp4"
            | "mkv"
            | "webm"
            | "mov"
            | "gif"
            | "avi"
            | "flv"
            | "m4v"
            | "ts"
            | "m2ts"
            | "mpeg"
            | "mpg"
            | "vob"
            | "3gp"
            | "wmv"
            | "asf"
    )
}

fn image_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "jpg"
            | "jpeg"
            | "jfif"
            | "png"
            | "webp"
            | "bmp"
            | "tif"
            | "tiff"
            | "gif"
            | "ico"
            | "tga"
            | "ppm"
            | "pgm"
            | "pbm"
    )
}

fn library_file_extension(path: &Path) -> bool {
    media_extension(path) || image_extension(path)
}

pub fn openable_file_extension(path: &Path) -> bool {
    if library_file_extension(path) {
        return true;
    }
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "flp" | "als" | "txt" | "json" | "bak"
    )
}

fn is_metadata_path(path: &Path) -> bool {
    if let Some(parent) = path.parent() {
        if parent
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("metadata"))
        {
            return true;
        }
    }
    path.file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("metadata"))
}

fn directory_summary(path: &Path) -> (usize, u64) {
    directory_summary_bounded(path, 0)
}

fn directory_summary_bounded(path: &Path, depth: usize) -> (usize, u64) {
    if depth > 32 {
        return (0, 0);
    }
    let mut count = 0;
    let mut bytes = 0;
    let Ok(entries) = fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let child = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            let (nested_count, nested_bytes) = directory_summary_bounded(&child, depth + 1);
            count += nested_count;
            bytes += nested_bytes;
        } else if kind.is_file() && library_file_extension(&child) && !is_metadata_path(&child) {
            count += 1;
            bytes += entry
                .metadata()
                .map(|value| value.len())
                .unwrap_or_default();
        }
    }
    (count, bytes)
}

fn recursive_folder_bytes(path: &Path) -> u64 {
    recursive_folder_bytes_bounded(path, 0)
}

fn recursive_folder_bytes_bounded(path: &Path, depth: usize) -> u64 {
    if depth > 32 {
        return 0;
    }
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let child = entry.path();
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_symlink() {
                    continue;
                }
                if file_type.is_dir() {
                    total += recursive_folder_bytes_bounded(&child, depth + 1);
                } else if file_type.is_file() {
                    total += entry.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
    }
    total
}

pub fn path_total_bytes(raw_path: &str) -> u64 {
    let clean = PathBuf::from(clean_windows_path(raw_path));
    if !clean.exists() {
        return 0;
    }
    if clean.is_file() {
        return fs::metadata(&clean).map(|m| m.len()).unwrap_or(0);
    }
    if clean.is_dir() {
        let (_, media_bytes) = directory_summary(&clean);
        if media_bytes > 0 {
            return media_bytes;
        }
        return recursive_folder_bytes(&clean);
    }
    0
}

fn media_file_entry(path: &Path, bytes: u64, conversion_ms: Option<u64>) -> LibraryEntry {
    LibraryEntry {
        path: clean_windows_path(&path.display().to_string()),
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default(),
        is_directory: false,
        is_playlist: false,
        media_count: 1,
        total_bytes: bytes,
        extension: path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_uppercase(),
        conversion_ms,
    }
}

pub fn scan(path: &str) -> Result<Vec<LibraryEntry>, String> {
    let root = std::path::PathBuf::from(clean_windows_path(path));
    if !root.exists() {
        return Ok(Vec::new());
    }
    let timings = load_conversion_timings();
    let mut result = Vec::new();
    for entry in fs::read_dir(&root)
        .map_err(|error| format!("Could not read the converted library: {error}"))?
        .flatten()
    {
        let child = entry.path();
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let conversion_ms = timings.get(&timing_key(&child)).copied();
        if kind.is_dir() {
            let (count, bytes) = directory_summary(&child);
            result.push(LibraryEntry {
                path: clean_windows_path(&child.display().to_string()),
                name,
                is_directory: true,
                is_playlist: child
                    .join("metadata")
                    .join("playlist_credits.txt")
                    .is_file(),
                media_count: count,
                total_bytes: bytes,
                extension: String::new(),
                conversion_ms,
            });
        } else if kind.is_file() && (is_metadata_path(&child) || library_file_extension(&child)) {
            result.push(media_file_entry(
                &child,
                entry
                    .metadata()
                    .map(|value| value.len())
                    .unwrap_or_default(),
                conversion_ms,
            ));
        }
    }
    result.sort_by(|left, right| {
        (!left.is_directory, left.name.to_lowercase())
            .cmp(&(!right.is_directory, right.name.to_lowercase()))
    });
    Ok(result)
}

const MAX_RECENT_DEPTH: usize = 32;

fn collect_recent(
    path: &Path,
    depth: usize,
    timings: &HashMap<String, u64>,
    result: &mut Vec<(SystemTime, LibraryEntry)>,
) -> Result<(), String> {
    if depth > MAX_RECENT_DEPTH {
        return Ok(());
    }
    for entry in fs::read_dir(path)
        .map_err(|error| format!("Could not read the converted library: {error}"))?
        .flatten()
    {
        let child = entry.path();
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            collect_recent(&child, depth + 1, timings, result)?;
        } else if kind.is_file() && library_file_extension(&child) && !is_metadata_path(&child) {
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            let modified = metadata.modified().unwrap_or(UNIX_EPOCH);
            let conversion_ms = timings.get(&timing_key(&child)).copied();
            result.push((
                modified,
                media_file_entry(&child, metadata.len(), conversion_ms),
            ));
        }
    }
    Ok(())
}

pub fn recent(path: &str, limit: usize) -> Result<Vec<LibraryEntry>, String> {
    let input = PathBuf::from(clean_windows_path(path));
    if !input.exists() {
        return Ok(Vec::new());
    }
    let root = fs::canonicalize(&input)
        .map_err(|error| format!("Could not read the converted library: {error}"))?;
    if !root.is_dir() {
        return Err("The converted library path is not a folder.".into());
    }

    let timings = load_conversion_timings();
    let mut candidates = Vec::new();
    collect_recent(&root, 0, &timings, &mut candidates)?;
    candidates.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.name.to_lowercase().cmp(&right.1.name.to_lowercase()))
    });
    Ok(candidates
        .into_iter()
        .take(limit.clamp(1, 200))
        .map(|(_, entry)| entry)
        .collect())
}

fn canonical_library_item(root: &str, path: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = fs::canonicalize(root.trim())
        .map_err(|error| format!("The library root is unavailable: {error}"))?;
    let target_path = Path::new(path.trim());
    let candidate = if target_path.is_absolute() {
        target_path.to_path_buf()
    } else {
        root.join(target_path)
    };
    let target = fs::canonicalize(&candidate)
        .map_err(|error| format!("That library item is unavailable: {error}"))?;
    if !target.starts_with(&root) && target != root {
        return Err(
            "For safety, JaneConverter can only access items inside the active library.".into(),
        );
    }
    Ok((root, target))
}

pub fn is_library_path(root: &Path, candidate: &Path) -> bool {
    let (Ok(root), Ok(candidate)) = (fs::canonicalize(root), fs::canonicalize(candidate)) else {
        return false;
    };
    candidate == root || candidate.starts_with(root)
}

fn strip_paren_digits(val: &str) -> String {
    let trimmed = val.trim_end();
    if let Some(open_idx) = trimmed.rfind(" (") {
        let inside = &trimmed[open_idx + 2..];
        if let Some(digits) = inside.strip_suffix(')') {
            if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
                return trimmed[..open_idx].to_string();
            }
        }
    }
    val.to_string()
}

fn strip_numbered_suffix(val: &str) -> String {
    if let Some((stem, ext)) = val.rsplit_once('.') {
        if ext.len() <= 5 && !stem.contains('/') && !stem.contains('\\') {
            let stripped_stem = strip_paren_digits(stem);
            return format!("{stripped_stem}.{ext}");
        }
    }
    strip_paren_digits(val)
}

fn strip_track_prefix(filename: &str) -> &str {
    let mut chars = filename.chars().peekable();
    let mut has_digits = false;
    let mut advance_count = 0;
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            has_digits = true;
            advance_count += c.len_utf8();
            chars.next();
        } else {
            break;
        }
    }
    if has_digits {
        let rest = &filename[advance_count..];
        if let Some(after_dot) = rest.strip_prefix(". ") {
            return after_dot;
        }
        if let Some(after_dash) = rest.strip_prefix(" - ") {
            return after_dash;
        }
        if let Some(after_under) = rest.strip_prefix('_') {
            return after_under;
        }
    }
    filename
}

fn find_file_in_dir_recursive(
    dir: &Path,
    target_name: &str,
    depth: usize,
    max_depth: usize,
) -> Option<PathBuf> {
    if depth > max_depth {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    let target_clean = target_name.trim();
    let target_stripped = strip_track_prefix(target_clean);

    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(file_type) = entry.file_type() {
            if file_type.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    let name_clean = name.trim();
                    let name_stripped = strip_track_prefix(name_clean);
                    if name_clean.eq_ignore_ascii_case(target_clean)
                        || name_stripped.eq_ignore_ascii_case(target_stripped)
                        || name_clean
                            .to_ascii_lowercase()
                            .ends_with(&format!(". {}", target_clean.to_ascii_lowercase()))
                        || name_clean
                            .to_ascii_lowercase()
                            .ends_with(&format!("- {}", target_clean.to_ascii_lowercase()))
                    {
                        return Some(path);
                    }
                }
            } else if file_type.is_dir() && !file_type.is_symlink() {
                subdirs.push(path);
            }
        }
    }
    for subdir in subdirs {
        if let Some(found) = find_file_in_dir_recursive(&subdir, target_name, depth + 1, max_depth)
        {
            return Some(found);
        }
    }
    None
}

pub fn resolve_existing_path(path_str: &str) -> Option<PathBuf> {
    let clean = clean_windows_path(path_str);
    let trimmed = clean.trim();
    if trimmed.is_empty() {
        return None;
    }

    let initial = PathBuf::from(trimmed);
    if initial.exists() {
        return Some(initial);
    }

    // 1b. Check same parent directory with alternate image/media extensions
    if let (Some(parent), Some(stem)) = (initial.parent(), initial.file_stem()) {
        if parent.is_dir() {
            let stem_str = stem.to_string_lossy();
            for ext in [
                "png", "jpg", "jpeg", "webp", "avif", "mp4", "mkv", "mp3", "wav", "flac",
            ] {
                let candidate = parent.join(format!("{stem_str}.{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    // 2. Try stripping collision suffix e.g. " (1)", " (2)", " (5)"
    if let Some(parent) = initial.parent() {
        let parent_str = parent.display().to_string();
        let stripped_parent = strip_numbered_suffix(&parent_str);
        if let Some(file_name) = initial.file_name() {
            if stripped_parent != parent_str {
                let candidate = PathBuf::from(&stripped_parent).join(file_name);
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }
    let stripped_self = strip_numbered_suffix(trimmed);
    if stripped_self != trimmed {
        let candidate = PathBuf::from(&stripped_self);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 3. Search in catalog history paths
    let target_file_name = initial.file_name().and_then(|n| n.to_str());
    let history_paths =
        crate::catalog::load_history_paths(&crate::paths::data_root().join("catalog.json"));
    if let Some(fname) = target_file_name {
        let fname_clean = fname.trim();
        let fname_stripped = strip_track_prefix(fname_clean);
        for hist in &history_paths {
            let hist_clean = clean_windows_path(hist);
            let hist_path = PathBuf::from(&hist_clean);
            if hist_path.exists() {
                if hist_path.is_file() {
                    if let Some(hname) = hist_path.file_name().and_then(|n| n.to_str()) {
                        let h_clean = hname.trim();
                        let h_stripped = strip_track_prefix(h_clean);
                        if h_clean.eq_ignore_ascii_case(fname_clean)
                            || h_stripped.eq_ignore_ascii_case(fname_stripped)
                        {
                            return Some(hist_path);
                        }
                    }
                } else if hist_path.is_dir() {
                    let candidate = hist_path.join(fname_clean);
                    if candidate.exists() {
                        return Some(candidate);
                    }
                    if let Some(found) = find_file_in_dir_recursive(&hist_path, fname_clean, 0, 3) {
                        return Some(found);
                    }
                }
            }
        }
    }

    // 4. Recursive search inside settings.output_dir and settings.fetched_dir
    // Avoid crawling entire library trees if the item is already scoped to a valid parent directory
    let parent_is_valid_dir = initial.parent().map(|p| p.is_dir()).unwrap_or(false);
    if !parent_is_valid_dir {
        let settings = crate::paths::settings_get_internal();
        if let Some(fname) = target_file_name {
            for root in [&settings.output_dir, &settings.fetched_dir] {
                let root_clean = clean_windows_path(root);
                let root_path = PathBuf::from(&root_clean);
                if root_path.is_dir() {
                    if let Some(found) = find_file_in_dir_recursive(&root_path, fname, 0, 5) {
                        return Some(found);
                    }
                }
            }
        }
    }

    None
}

pub fn draggable_media_file(root: &str, path: &str) -> Result<PathBuf, String> {
    let resolved =
        resolve_existing_path(path).unwrap_or_else(|| PathBuf::from(clean_windows_path(path)));
    let path_to_check = resolved.display().to_string();
    let metadata = fs::symlink_metadata(resolved.as_path())
        .map_err(|error| format!("That library file is unavailable: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Only regular media files can be dragged from the library.".into());
    }
    let target = fs::canonicalize(&resolved)
        .map_err(|error| format!("That library item is unavailable: {error}"))?;
    if !media_extension(&target) && !image_extension(&target) {
        return Err("Only media files can be dragged from the library.".into());
    }
    if let Ok((_root, library_target)) = canonical_library_item(root, &path_to_check) {
        return Ok(library_target);
    }
    let history_paths =
        crate::catalog::load_history_paths(&crate::paths::data_root().join("catalog.json"));
    for history_path in history_paths {
        if let Ok(canonical_history) = fs::canonicalize(history_path.trim()) {
            if canonical_history == target {
                return Ok(target);
            }
        }
    }
    let settings = crate::paths::settings_get_internal();
    for candidate_root in [&settings.output_dir, &settings.fetched_dir, root] {
        if let Ok(canon_root) = fs::canonicalize(candidate_root.trim()) {
            if target.starts_with(&canon_root) {
                return Ok(target);
            }
        }
    }
    Err("For safety, JaneConverter can only access items inside the active library.".into())
}

pub fn delete_inside(root: &str, path: &str) -> Result<(), String> {
    let (root_canon, target) = canonical_library_item(root, path)?;
    if target == root_canon {
        return Err("Cannot delete the library root itself.".into());
    }
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|error| format!("Could not delete the folder: {error}"))
    } else {
        fs::remove_file(target).map_err(|error| format!("Could not delete the file: {error}"))
    }
}

fn copy_directory(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let source_child = entry.path();
        let destination_child = destination.join(entry.file_name());
        if kind.is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "symbolic links are not supported in a library move",
            ));
        }
        if kind.is_dir() {
            copy_directory(&source_child, &destination_child)?;
        } else if kind.is_file() {
            fs::copy(&source_child, &destination_child)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveDirectoryResult {
    pub destination: String,
    pub cleanup_warning: Option<String>,
}

fn finish_cross_volume_move<F>(
    source: &Path,
    target: &Path,
    remove_source: F,
) -> MoveDirectoryResult
where
    F: FnOnce(&Path) -> std::io::Result<()>,
{
    let cleanup_warning = remove_source(source).err().map(|error| {
        format!(
            "The complete library is available at '{}', but JaneConverter could not fully remove the old folder '{}': {error}. Review the old folder and remove any remaining files when they are no longer in use.",
            clean_windows_path(&target.display().to_string()),
            clean_windows_path(&source.display().to_string()),
        )
    });
    MoveDirectoryResult {
        destination: clean_windows_path(&target.display().to_string()),
        cleanup_warning,
    }
}

pub fn move_directory(
    source: &str,
    destination_parent: &str,
) -> Result<MoveDirectoryResult, String> {
    let source_input = PathBuf::from(source.trim());
    let source_metadata = fs::symlink_metadata(&source_input)
        .map_err(|error| format!("The current library is unavailable: {error}"))?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
        return Err("The current library must be a real folder.".into());
    }
    let source = fs::canonicalize(&source_input)
        .map_err(|error| format!("The current library is unavailable: {error}"))?;
    let parent = fs::canonicalize(destination_parent.trim())
        .map_err(|error| format!("The destination folder is unavailable: {error}"))?;
    if !parent.is_dir() {
        return Err("The destination must be a folder.".into());
    }
    if parent == source || parent.starts_with(&source) {
        return Err("The destination cannot be inside the current library.".into());
    }
    let name = source
        .file_name()
        .ok_or_else(|| "The current library has no usable folder name.".to_owned())?;
    let target = parent.join(name);
    if fs::symlink_metadata(&target).is_ok() {
        return Err(format!(
            "A file or folder named '{}' already exists at the destination.",
            name.to_string_lossy()
        ));
    }

    if fs::rename(&source, &target).is_ok() {
        return Ok(MoveDirectoryResult {
            destination: clean_windows_path(&target.display().to_string()),
            cleanup_warning: None,
        });
    }

    let temporary = parent.join(format!(
        ".{}.janemove-{}",
        name.to_string_lossy(),
        now_stamp()
    ));
    copy_directory(&source, &temporary).map_err(|error| {
        let _ = fs::remove_dir_all(&temporary);
        format!("Could not copy the library to the destination: {error}")
    })?;
    if let Err(error) = fs::rename(&temporary, &target) {
        let _ = fs::remove_dir_all(&temporary);
        return Err(format!("Could not finalize the library move: {error}"));
    }
    Ok(finish_cross_volume_move(&source, &target, |path| {
        fs::remove_dir_all(path)
    }))
}

fn first_preview_source(path: &Path, depth: usize) -> Option<PathBuf> {
    if depth > 4 {
        return None;
    }
    let kind = fs::symlink_metadata(path).ok()?.file_type();
    if kind.is_symlink() {
        return None;
    }
    if kind.is_file() && (media_extension(path) || image_extension(path)) {
        return Some(path.to_path_buf());
    }
    if !kind.is_dir() {
        return None;
    }

    for name in [
        "cover.jpg",
        "cover.jpeg",
        "cover.png",
        "cover.webp",
        "folder.jpg",
        "album.jpg",
    ] {
        let candidate = path.join("metadata").join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let mut entries = fs::read_dir(path).ok()?.flatten().collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in &entries {
        let entry_path = entry.path();
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_file() && (media_extension(&entry_path) || image_extension(&entry_path))
            {
                return Some(entry_path);
            }
        }
    }

    for entry in entries {
        let entry_path = entry.path();
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_dir() {
                if let Some(candidate) = first_preview_source(&entry_path, depth + 1) {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn render_preview_at(path: &Path, seek_sec: Option<&str>) -> Option<Vec<u8>> {
    let mut command = Command::new(find_ffmpeg());
    command.arg("-hide_banner").arg("-loglevel").arg("error");
    if let Some(ss) = seek_sec {
        command.arg("-ss").arg(ss);
    }
    command
        .arg("-i")
        .arg(path)
        .arg("-map")
        .arg("0:v:0?")
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg("scale=320:320:force_original_aspect_ratio=decrease")
        .arg("-f")
        .arg("image2pipe")
        .arg("-vcodec")
        .arg("mjpeg")
        .arg("-q:v")
        .arg("5")
        .arg("-");
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    prepare_command(&mut command);
    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.take(2 * 1024 * 1024 + 1).read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let bytes = reader.join().ok()?;
                if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
                    return None;
                }
                return Some(bytes);
            }
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return None;
            }
        }
    }
}

fn render_preview(path: &Path) -> Option<(Vec<u8>, &'static str)> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_video = matches!(extension.as_str(), "mp4" | "mkv" | "webm" | "mov" | "gif");
    if is_video {
        if let Some(bytes) = render_preview_at(path, Some("1")) {
            return Some((bytes, "image/jpeg"));
        }
        return render_preview_at(path, Some("0")).map(|bytes| (bytes, "image/jpeg"));
    }

    // Direct read for still image files under 25MB to bypass FFmpeg process spawns
    if matches!(
        extension.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif"
    ) {
        if let Ok(metadata) = fs::metadata(path) {
            if metadata.is_file() && metadata.len() > 0 && metadata.len() <= 25 * 1024 * 1024 {
                if let Ok(bytes) = fs::read(path) {
                    let mime = match extension.as_str() {
                        "png" => "image/png",
                        "webp" => "image/webp",
                        "gif" => "image/gif",
                        "bmp" => "image/bmp",
                        "avif" => "image/avif",
                        _ => "image/jpeg",
                    };
                    return Some((bytes, mime));
                }
            }
        }
    }

    render_preview_at(path, None).map(|bytes| (bytes, "image/jpeg"))
}

pub fn thumbnail(root: &str, path: &str) -> Result<Option<String>, String> {
    let (_root, target) = canonical_library_item(root, path)?;
    let Some(source) = first_preview_source(&target, 0) else {
        return Ok(None);
    };
    let Some((bytes, mime)) = render_preview(&source) else {
        return Ok(None);
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_extension_accepts_audio_and_video() {
        assert!(media_extension(Path::new("song.flac")));
        assert!(media_extension(Path::new("clip.MP4")));
        assert!(!media_extension(Path::new("notes.txt")));
    }

    #[test]
    fn drag_source_is_limited_to_media_inside_the_library() {
        let project = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let icon = project.join("assets/icon.png");
        let non_media = project.join("desktop-ui/src-tauri/Cargo.toml");
        let other_root = project.join("desktop-ui/src-tauri");

        assert_eq!(
            draggable_media_file(project.to_str().unwrap(), icon.to_str().unwrap()).unwrap(),
            icon
        );
        assert!(
            draggable_media_file(project.to_str().unwrap(), non_media.to_str().unwrap()).is_err()
        );
        assert!(
            draggable_media_file(other_root.to_str().unwrap(), icon.to_str().unwrap()).is_err()
        );
    }

    #[test]
    fn preview_and_library_sources_accept_images() {
        assert!(image_extension(Path::new("cover.jpg")));
        assert!(!media_extension(Path::new("cover.jpg")));
        assert!(library_file_extension(Path::new("photo.jpeg")));
        assert!(library_file_extension(Path::new("photo.webp")));
    }

    #[test]
    fn scan_lists_downloaded_images_and_counts_them_in_album_folders() {
        let root = std::env::temp_dir().join(format!("janec-images-{}", crate::paths::now_stamp()));
        let album = root.join("Images").join("Facebook").join("Public album");
        fs::create_dir_all(&album).expect("create Facebook album folder");
        fs::write(album.join("photo_001.jpg"), b"first photo").expect("write first photo");
        fs::write(album.join("photo_002.webp"), b"second photo").expect("write second photo");
        let metadata = album.join("metadata");
        fs::create_dir_all(&metadata).expect("create metadata folder");
        fs::write(metadata.join("manifest.json"), b"{}").expect("write album metadata");
        fs::write(metadata.join("credits.txt"), b"credits").expect("write photo credits");

        let entries = scan(album.to_str().expect("album path")).expect("scan album photos");
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().any(|entry| entry.extension == "JPG"));
        assert!(entries.iter().any(|entry| entry.extension == "WEBP"));
        assert!(entries
            .iter()
            .any(|entry| entry.is_directory && entry.name == "metadata"));

        let metadata_entries =
            scan(metadata.to_str().expect("metadata path")).expect("scan album metadata");
        assert_eq!(metadata_entries.len(), 2);
        assert!(metadata_entries
            .iter()
            .any(|entry| entry.name == "manifest.json"));
        assert!(metadata_entries
            .iter()
            .any(|entry| entry.name == "credits.txt"));

        let parent_entries = scan(
            album
                .parent()
                .expect("Facebook parent")
                .to_str()
                .expect("parent path"),
        )
        .expect("scan Facebook folder");
        assert_eq!(parent_entries[0].media_count, 2);
        assert_eq!(
            parent_entries[0].total_bytes,
            b"first photosecond photo".len() as u64
        );
        fs::remove_dir_all(root).expect("clean Facebook album test folder");
    }

    #[test]
    fn recent_returns_nested_media_and_images_and_ignores_non_media_files() {
        let root = std::env::temp_dir().join(format!("janec-recent-{}", crate::paths::now_stamp()));
        let nested = root.join("Videos").join("Facebook");
        fs::create_dir_all(&nested).expect("create recent test folders");
        fs::write(root.join("cover.jpg"), b"cover").expect("write cover");
        fs::write(root.join("first.mp4"), b"first").expect("write first media");
        fs::write(nested.join("second.mp3"), b"second").expect("write nested media");

        let entries =
            recent(root.to_str().expect("recent test path"), 10).expect("scan recent media");

        assert_eq!(entries.len(), 3);
        assert!(entries.iter().any(|entry| entry.name == "first.mp4"));
        assert!(entries.iter().any(|entry| entry.name == "second.mp3"));
        assert!(entries.iter().any(|entry| entry.name == "cover.jpg"));
        fs::remove_dir_all(root).expect("clean recent test folders");
    }

    #[test]
    fn failed_source_cleanup_preserves_the_complete_destination() {
        let root = std::env::temp_dir().join(format!("janec-move-{}", crate::paths::now_stamp()));
        let source = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(&source).expect("create source folder");
        fs::create_dir_all(&target).expect("create target folder");
        fs::write(source.join("locked.mp3"), b"source").expect("write source file");
        fs::write(target.join("complete.mp3"), b"complete").expect("write destination file");

        let result = finish_cross_volume_move(&source, &target, |_path| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "file is in use",
            ))
        });

        assert_eq!(
            result.destination,
            clean_windows_path(&target.display().to_string())
        );
        assert!(result.cleanup_warning.is_some());
        assert!(target.join("complete.mp3").is_file());
        assert!(source.join("locked.mp3").is_file());
        fs::remove_dir_all(root).expect("clean move test folders");
    }

    #[test]
    fn path_total_bytes_computes_single_file_and_folder_aggregate_sizes() {
        let root = std::env::temp_dir().join(format!("janec-size-{}", crate::paths::now_stamp()));
        fs::create_dir_all(&root).expect("create size test root");

        let single = root.join("track.mp3");
        fs::write(&single, b"1234567890").expect("write single track");
        assert_eq!(path_total_bytes(single.to_str().unwrap()), 10);

        let album = root.join("Album");
        fs::create_dir_all(&album).expect("create album dir");
        fs::write(album.join("track1.flac"), b"abcdefghij").expect("write track 1");
        fs::write(album.join("track2.flac"), b"12345").expect("write track 2");
        let meta = album.join("metadata");
        fs::create_dir_all(&meta).expect("create album metadata");
        fs::write(meta.join("credits.txt"), b"credits content").expect("write credits");

        // directory_summary should aggregate media files (10 + 5 = 15 bytes)
        assert_eq!(path_total_bytes(album.to_str().unwrap()), 15);

        // Non-existent path returns 0
        assert_eq!(path_total_bytes("D:\\non_existent_folder_xyz_12345"), 0);

        fs::remove_dir_all(root).expect("clean size test root");
    }

    #[test]
    fn strip_numbered_suffix_and_track_prefix_clean_names() {
        assert_eq!(strip_numbered_suffix("Discography (5)"), "Discography");
        assert_eq!(strip_numbered_suffix("My Album (2).mp3"), "My Album.mp3");
        assert_eq!(strip_numbered_suffix("Normal Song.mp3"), "Normal Song.mp3");

        assert_eq!(
            strip_track_prefix("1. Donut's New Groove.mp3"),
            "Donut's New Groove.mp3"
        );
        assert_eq!(
            strip_track_prefix("05. Summer Vibe.flac"),
            "Summer Vibe.flac"
        );
        assert_eq!(strip_track_prefix("12 - Beat.wav"), "Beat.wav");
        assert_eq!(strip_track_prefix("Single Track.mp3"), "Single Track.mp3");
    }

    #[test]
    fn resolve_existing_path_resolves_nested_and_suffixed_files() {
        let root =
            std::env::temp_dir().join(format!("janec-resolve-{}", crate::paths::now_stamp()));
        let album = root
            .join("Audio")
            .join("YouTube")
            .join("Artist Discography");
        fs::create_dir_all(&album).expect("create test album hierarchy");
        let track = album.join("1. Test Track.mp3");
        fs::write(&track, b"media content").expect("write test track");

        // 1. Direct path
        assert_eq!(
            resolve_existing_path(track.to_str().unwrap()).unwrap(),
            track
        );

        // 2. Collision suffix on folder
        let suffixed_folder_track = root
            .join("Audio")
            .join("YouTube")
            .join("Artist Discography (5)")
            .join("1. Test Track.mp3");
        assert_eq!(
            resolve_existing_path(suffixed_folder_track.to_str().unwrap()).unwrap(),
            track
        );

        fs::remove_dir_all(root).expect("clean resolve test root");
    }
}
