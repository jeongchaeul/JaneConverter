mod access;
mod catalog;
pub mod commands;
mod facebook_capture;
pub mod instances;
mod library;
mod model;
mod paths;
mod process;
mod social_photo_capture;

use commands::*;
pub use instances::{
    acquire_instance_slot, bring_active_window_to_top, InstanceGuard, MAX_INSTANCES,
};

use model::{FacebookPhotoManifest, SocialPhotoManifest};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Instant;
use tauri::WebviewWindow;

pub const BUILD_COMMIT: &str = match option_env!("JANECONVERTER_BUILD_COMMIT") {
    Some(commit) => commit,
    None => "unknown",
};

#[derive(Default)]
pub struct PendingUpdate(pub(crate) Mutex<Option<tauri_plugin_updater::Update>>);

pub(crate) type FacebookRefreshWaiters =
    std::collections::HashMap<String, (String, mpsc::Sender<Vec<String>>)>;

#[derive(Clone)]
pub struct FacebookCaptureSession {
    pub(crate) window: WebviewWindow,
    pub(crate) profile: PathBuf,
    pub(crate) refresh_waiters: Arc<Mutex<FacebookRefreshWaiters>>,
    pub(crate) refresh_function: String,
    pub(crate) created: Instant,
    pub(crate) in_use: Arc<AtomicBool>,
}

pub(crate) type FacebookManifestEntry = (String, FacebookPhotoManifest, std::time::Instant);
pub(crate) type FacebookManifestStore =
    Arc<Mutex<std::collections::HashMap<String, FacebookManifestEntry>>>;
pub(crate) type SocialManifestEntry = (String, SocialPhotoManifest, std::time::Instant);
pub(crate) type SocialManifestStore =
    Arc<Mutex<std::collections::HashMap<String, SocialManifestEntry>>>;

#[derive(Clone)]
pub struct AppState {
    pub(crate) active_child: Arc<Mutex<Option<Arc<Mutex<std::process::Child>>>>>,
    pub(crate) active_cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    pub(crate) playlist_cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    pub(crate) active_paused: Arc<AtomicBool>,
    pub(crate) active_job: Arc<Mutex<Option<String>>>,
    pub(crate) storage_operation: Arc<Mutex<()>>,
    pub(crate) sequence: Arc<AtomicU64>,
    pub(crate) access: Arc<Mutex<Option<access::AccessServer>>>,
    pub(crate) facebook_captures:
        Arc<Mutex<std::collections::HashMap<String, FacebookCaptureSession>>>,
    pub(crate) facebook_manifests: FacebookManifestStore,
    pub(crate) social_captures: Arc<Mutex<std::collections::HashMap<String, WebviewWindow>>>,
    pub(crate) social_manifests: SocialManifestStore,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            active_child: Arc::new(Mutex::new(None)),
            active_cancel: Arc::new(Mutex::new(None)),
            playlist_cancel: Arc::new(Mutex::new(None)),
            active_paused: Arc::new(AtomicBool::new(false)),
            active_job: Arc::new(Mutex::new(None)),
            storage_operation: Arc::new(Mutex::new(())),
            sequence: Arc::new(AtomicU64::new(1)),
            access: Arc::new(Mutex::new(None)),
            facebook_captures: Arc::new(Mutex::new(std::collections::HashMap::new())),
            facebook_manifests: Arc::new(Mutex::new(std::collections::HashMap::new())),
            social_captures: Arc::new(Mutex::new(std::collections::HashMap::new())),
            social_manifests: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }
}

pub fn run() {
    sweep_stale_webview_profiles();
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
            choose_flp_file,
            choose_als_file,
            flp_inspect,
            flp_downgrade,
            flp_detect_installed,
            open_path,
            open_file,
            open_url,
            capture_facebook_album,
            cancel_facebook_album,
            capture_social_post_photos,
            cancel_social_post_photos,
            start_conversion,
            pause_conversion,
            resume_conversion,
            cancel_conversion,
            load_playlist,
            cancel_playlist,
            conversion_history,
            scan_library,
            is_converted_library_path,
            recent_conversions,
            clear_conversion_timings,
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
            notify_attention,
            check_updates,
            install_update,
            export_log_file,
            set_taskbar_progress,
            get_chromium_cookie_policy,
            set_chromium_cookie_policy,
            path_size,
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
    fn unsigned_build_does_not_offer_a_downloadable_installer() {
        let mut payload = serde_json::json!({
            "repo": {
                "has_update": true,
                "installer_available": true,
                "release_url": "https://github.com/jeongchaeul/JaneConverter/releases/tag/v2.3.0"
            }
        });

        disable_unsigned_installer(&mut payload);

        assert_eq!(payload["repo"]["has_update"], true);
        assert_eq!(payload["repo"]["installer_available"], false);
        assert!(payload["repo"]["release_url"].is_string());
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
            reconstruct_frequency_loss: false,
            retries: 2,
            playlist_indexes: None,
            read_browser_cookies: false,
            browser_session: None,
            browser_capture_path: None,
            facebook_capture_id: None,
            social_capture_id: None,
            start_time: None,
            end_time: None,
            allow_story_extraction: false,
            archival_fallback: false,
        };
        assert!(
            crate::process::build_conversion_args_with_capture(&request, None, None, false)
                .is_err()
        );
    }

    #[test]
    fn chromium_cookie_policy_query_does_not_panic() {
        let res = get_chromium_cookie_policy();
        assert!(res.is_ok());
    }
}
