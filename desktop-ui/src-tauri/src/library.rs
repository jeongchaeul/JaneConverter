use crate::model::LibraryEntry;
use crate::paths::{data_root, find_ffmpeg, now_stamp, prepare_command};
use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
        let keys: Vec<String> = timings.keys().take(timings.len() - 2000).cloned().collect();
        for key in keys {
            timings.remove(&key);
        }
    }
    if let Ok(serialized) = serde_json::to_vec(&timings) {
        let _ = fs::write(timings_file(), serialized);
    }
}

pub fn clear_conversion_timings() -> Result<(), String> {
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

fn is_metadata_path(path: &Path) -> bool {
    path.ancestors().any(|ancestor| {
        ancestor
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("metadata"))
    })
}

fn directory_summary(path: &Path) -> (usize, u64) {
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
        if kind.is_dir() {
            let (nested_count, nested_bytes) = directory_summary(&child);
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
    let target = fs::canonicalize(path.trim())
        .map_err(|error| format!("That library item is unavailable: {error}"))?;
    if target == root || !target.starts_with(&root) {
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

pub fn draggable_media_file(root: &str, path: &str) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path.trim())
        .map_err(|error| format!("That library file is unavailable: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Only regular media files can be dragged from the library.".into());
    }
    let (_root, target) = canonical_library_item(root, path)?;
    if !media_extension(&target) && !image_extension(&target) {
        return Err("Only media files can be dragged from the library.".into());
    }
    Ok(target)
}

pub fn delete_inside(root: &str, path: &str) -> Result<(), String> {
    let (_root, target) = canonical_library_item(root, path)?;
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
    for entry in entries {
        if let Some(candidate) = first_preview_source(&entry.path(), depth + 1) {
            return Some(candidate);
        }
    }
    None
}

fn render_preview(path: &Path) -> Option<Vec<u8>> {
    let mut command = Command::new(find_ffmpeg());
    command.arg("-hide_banner").arg("-loglevel").arg("error");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "mp4" | "mkv" | "webm" | "mov" | "gif") {
        command.arg("-ss").arg("1");
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
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut bytes = Vec::new();
                child.stdout.take()?.read_to_end(&mut bytes).ok()?;
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
                return None;
            }
        }
    }
}

pub fn thumbnail(root: &str, path: &str) -> Result<Option<String>, String> {
    let (_root, target) = canonical_library_item(root, path)?;
    let Some(source) = first_preview_source(&target, 0) else {
        return Ok(None);
    };
    let Some(bytes) = render_preview(&source) else {
        return Ok(None);
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:image/jpeg;base64,{encoded}")))
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
}
