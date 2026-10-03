//! Versioned local catalog with durable writes and a recoverable previous snapshot.
use crate::model::FetchedMedia;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

static CATALOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default, Serialize, Deserialize)]
pub struct Catalog {
    pub version: u32,
    #[serde(default)]
    pub migrated: bool,
    #[serde(default)]
    pub history: Vec<Value>,
    #[serde(default)]
    pub captures: Vec<FetchedMedia>,
    #[serde(skip)]
    pub warning: Option<String>,
}

fn decode(bytes: &[u8]) -> Result<Catalog, String> {
    let catalog: Catalog =
        serde_json::from_slice(bytes).map_err(|_| "The local catalog is damaged.")?;
    if catalog.version != 1 {
        return Err("The catalog version is unsupported; preserve it and use a compatible application version.".into());
    }
    for entry in &catalog.history {
        validate_history(entry)?;
    }
    Ok(catalog)
}

fn load(path: &Path) -> Result<Catalog, String> {
    match fs::read(path) {
        Ok(bytes) => {
            match decode(&bytes) {
                Ok(catalog) => Ok(catalog),
                Err(error) if error.contains("unsupported") => Err(error),
                Err(_) => {
                    let mut catalog = decode(&fs::read(path.with_extension("bak")).map_err(|_| "The catalog and its backup could not be read; history was preserved on disk.")?)?;
                    catalog.warning = Some("Recovered the previous catalog snapshot; the most recent change may be missing.".into());
                    Ok(catalog)
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if path.with_extension("bak").exists() {
                let mut catalog = decode(
                    &fs::read(path.with_extension("bak")).map_err(|error| error.to_string())?,
                )?;
                catalog.warning = Some("Recovered the previous catalog snapshot; the most recent change may be missing.".into());
                return Ok(catalog);
            }
            Ok(Catalog {
                version: 1,
                ..Catalog::default()
            })
        }
        Err(error) => Err(format!("Could not read the local catalog: {error}")),
    }
}

fn save(path: &Path, catalog: &Catalog) -> Result<(), String> {
    let parent = path.parent().ok_or("The catalog folder is invalid.")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the catalog folder: {error}"))?;
    let staging = path.with_extension(format!("{}.tmp", rand::random::<u64>()));
    let backup = path.with_extension("bak");
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging)
            .map_err(|error| error.to_string())?;
        file.write_all(&serde_json::to_vec(catalog).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        if path.exists() {
            // Never replace a valid backup with a damaged primary snapshot.
            if catalog.warning.is_none() {
                if backup.exists() {
                    fs::remove_file(&backup).map_err(|error| error.to_string())?;
                }
                fs::rename(path, &backup).map_err(|error| error.to_string())?;
            } else {
                fs::remove_file(path).map_err(|error| error.to_string())?;
            }
        }
        if let Err(error) = fs::rename(&staging, path) {
            if backup.exists() {
                let _ = fs::rename(&backup, path);
            }
            return Err(error.to_string());
        }
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(staging);
    }
    result.map_err(|error| {
        format!("Could not save the local catalog: {error}. Your media files were preserved.")
    })
}

pub fn source_url(value: &str) -> String {
    if let Ok(mut url) = url::Url::parse(value) {
        if matches!(url.scheme(), "http" | "https") {
            let ids: Vec<(String, String)> = url
                .query_pairs()
                .filter(|(key, _)| matches!(key.as_ref(), "v" | "fbid"))
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect();
            let _ = url.set_username("");
            let _ = url.set_password(None);
            url.set_query(None);
            url.set_fragment(None);
            if !ids.is_empty() {
                url.query_pairs_mut().extend_pairs(ids);
            }
            return url.into();
        }
    }
    value.to_owned()
}

fn validate_history(entry: &Value) -> Result<(), String> {
    for field in [
        "id",
        "timestamp",
        "source",
        "fileName",
        "exportPath",
        "presetName",
        "formatLabel",
        "qualityLabel",
    ] {
        let text = entry
            .get(field)
            .and_then(Value::as_str)
            .ok_or("A history entry has invalid fields.")?;
        if text.len() > 8192 || (matches!(field, "id" | "timestamp") && text.is_empty()) {
            return Err("A history field exceeds its supported size.".into());
        }
    }
    if !matches!(
        entry.get("status").and_then(Value::as_str),
        Some("succeeded" | "failed" | "partial")
    ) || !entry
        .get("elapsedMs")
        .is_some_and(|value| value.as_u64().is_some())
    {
        return Err("A history entry has an invalid result or elapsed time.".into());
    }
    Ok(())
}

pub fn history(
    path: &Path,
    legacy: Vec<Value>,
    entry: Option<Value>,
    remove: Option<&str>,
    clear: bool,
) -> Result<Catalog, String> {
    let _guard = CATALOG_LOCK
        .lock()
        .map_err(|_| "The local catalog is unavailable.")?;
    let mut catalog = load(path)?;
    let mut changed = entry.is_some() || remove.is_some() || clear;
    if !catalog.migrated {
        for mut item in legacy {
            validate_history(&item)?;
            item["source"] = Value::String(source_url(item["source"].as_str().unwrap_or_default()));
            if !catalog
                .history
                .iter()
                .any(|value| value["id"] == item["id"])
            {
                catalog.history.push(item);
            }
        }
        catalog.migrated = true;
        changed = true;
    }
    if clear {
        catalog.history.clear();
    }
    if let Some(id) = remove {
        catalog
            .history
            .retain(|value| value["id"].as_str() != Some(id));
    }
    if let Some(mut item) = entry {
        validate_history(&item)?;
        item["source"] = Value::String(source_url(item["source"].as_str().unwrap_or_default()));
        catalog.history.retain(|value| value["id"] != item["id"]);
        catalog.history.insert(0, item);
    }
    if changed {
        save(path, &catalog)?;
    }
    Ok(catalog)
}

pub fn capture(path: &Path, item: FetchedMedia) -> Result<(), String> {
    let _guard = CATALOG_LOCK
        .lock()
        .map_err(|_| "The local catalog is unavailable.")?;
    let mut catalog = load(path)?;
    let file_name = Path::new(&item.path).file_name();
    catalog
        .captures
        .retain(|value| Path::new(&value.path).file_name() != file_name);
    catalog.captures.push(item);
    save(path, &catalog)
}

pub fn captures(path: &Path) -> Result<Vec<FetchedMedia>, String> {
    let _guard = CATALOG_LOCK
        .lock()
        .map_err(|_| "The local catalog is unavailable.")?;
    Ok(load(path)?.captures)
}

pub fn backup_for_update(root: &Path, fetched: &Path) -> Result<(), String> {
    let _guard = CATALOG_LOCK
        .lock()
        .map_err(|_| "The local catalog is unavailable.")?;
    let path = root.join("catalog.json");
    if path.exists() {
        let catalog = load(&path)?;
        save(&root.join("update-backup").join("catalog.json"), &catalog)?;
    }
    let captures = fetched.join("capture-catalog.json");
    if captures.exists() {
        let catalog = load(&captures)?;
        save(
            &root.join("update-backup").join("capture-catalog.json"),
            &catalog,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identically_named_captures_keep_separate_provenance() {
        let root =
            std::env::temp_dir().join(format!("jane-catalog-captures-{}", rand::random::<u64>()));
        let path = root.join("catalog.json");
        for id in ["one", "two"] {
            capture(
                &path,
                FetchedMedia {
                    path: root
                        .join(format!("{id}-photo.png"))
                        .to_string_lossy()
                        .into_owned(),
                    name: "photo.png".into(),
                    media_kind: "image".into(),
                    mime_type: "image/png".into(),
                    capture_mode: "collect".into(),
                    title: id.into(),
                    size: 100,
                    source_url: format!("https://example.test/{id}"),
                    captured_at: 1,
                    capture_method: "rendered".into(),
                },
            )
            .unwrap();
        }
        assert_eq!(captures(&path).unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn provenance_does_not_store_signed_query_secrets() {
        assert_eq!(
            source_url("https://user:secret@example.test/watch?v=123&token=secret#secret"),
            "https://example.test/watch?v=123"
        );
    }
    #[test]
    fn update_backup_preserves_history_and_capture_catalogs() {
        let root =
            std::env::temp_dir().join(format!("jane-catalog-update-{}", rand::random::<u64>()));
        let fetched = root.join("fetched");
        let catalog = Catalog {
            version: 1,
            ..Catalog::default()
        };
        save(&root.join("catalog.json"), &catalog).unwrap();
        save(&fetched.join("capture-catalog.json"), &catalog).unwrap();
        backup_for_update(&root, &fetched).unwrap();
        assert!(root.join("update-backup/catalog.json").is_file());
        assert!(root.join("update-backup/capture-catalog.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_writes_preserve_the_existing_snapshot() {
        let root =
            std::env::temp_dir().join(format!("jane-catalog-fail-{}", rand::random::<u64>()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("catalog.json");
        let catalog = Catalog {
            version: 1,
            ..Catalog::default()
        };
        save(&path, &catalog).unwrap();
        // A directory at the backup location simulates a reproducible filesystem failure.
        fs::create_dir(root.join("catalog.bak")).unwrap();
        assert!(save(&path, &catalog).is_err());
        assert_eq!(load(&path).unwrap().version, 1);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn catalog_recovers_previous_snapshot_and_rejects_bad_entries() {
        let root = std::env::temp_dir().join(format!("jane-catalog-{}", rand::random::<u64>()));
        let path = root.join("catalog.json");
        let value = serde_json::json!({"id":"one","timestamp":"2026-10-04","source":"https://example.test/post?token=secret", "fileName":"media", "exportPath":"out", "presetName":"preset", "formatLabel":"PNG", "qualityLabel":"original", "elapsedMs":1,"status":"succeeded"});
        history(&path, vec![value.clone()], None, None, false).unwrap();
        history(&path, vec![], Some(value), None, false).unwrap();
        fs::write(&path, b"interrupted").unwrap();
        let recovered = history(&path, vec![], None, None, false).unwrap();
        assert_eq!(recovered.history.len(), 1);
        assert!(recovered.warning.is_some());
        assert!(history(
            &path,
            vec![],
            Some(serde_json::json!({"id":"bad"})),
            None,
            false
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
