use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use include_dir::{include_dir, Dir};
use percent_encoding::percent_decode_str;
use reqwest::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};
use http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};
use zip::ZipArchive;

static EMBEDDED_ASSETS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../build");

const OTA_RELEASE_BASE: &str =
    "https://github.com/kipetsh/bandito/releases/download/ota-latest";
const OTA_PUBLIC_KEY: [u8; 32] = [
    0xb1, 0x55, 0x3c, 0xa7, 0x58, 0x90, 0xd1, 0x82, 0xb2, 0x69, 0x88, 0xdb, 0x41, 0xd5, 0x75, 0x1b,
    0x4f, 0xce, 0x4c, 0x2b, 0xc9, 0xa4, 0xf7, 0x2a, 0xbd, 0xd7, 0xe0, 0x6a, 0xf9, 0x67, 0x47, 0x39,
];
const MAX_ARCHIVE_BYTES: usize = 80 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 160 * 1024 * 1024;
const MAX_FILES: usize = 2_000;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;

const CONTENT_SECURITY_POLICY: &str = concat!(
    "default-src 'self' customprotocol: asset: bandito:; ",
    "script-src 'self' https://www.gstatic.com; ",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ",
    "font-src 'self' https://fonts.gstatic.com data:; ",
    "img-src 'self' asset: data: blob: https:; ",
    "connect-src 'self' ipc: http://ipc.localhost https://*.firebaseio.com ",
    "wss://*.firebaseio.com https://identitytoolkit.googleapis.com ",
    "https://securetoken.googleapis.com https://www.googleapis.com ",
    "https://bandito-83823.firebaseapp.com; ",
    "object-src 'none'; base-uri 'self'; ",
    "frame-src 'self' https://bandito-83823.firebaseapp.com"
);

#[derive(Debug, Default, Deserialize, Serialize)]
struct OtaState {
    active_version: Option<String>,
    previous_version: Option<String>,
    pending_version: Option<String>,
    staged_version: Option<String>,
    boot_attempts: u8,
}

#[derive(Debug, Deserialize)]
struct OtaManifest {
    schema_version: u32,
    version: String,
    min_app_version: String,
    max_app_version: Option<String>,
    archive_name: String,
    archive_sha256: String,
    notes: Option<String>,
}

#[derive(Serialize)]
pub struct OtaUpdateResult {
    staged: bool,
    version: Option<String>,
    notes: Option<String>,
}

#[derive(Serialize)]
pub struct OtaLaunchResult {
    activated: bool,
    active_version: Option<String>,
}

fn ota_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("ota"))
        .map_err(|error| format!("Cannot resolve app data directory: {error}"))
}

fn load_state(root: &Path) -> OtaState {
    fs::read(root.join("state.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_state(root: &Path, state: &OtaState) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("Cannot create OTA directory: {error}"))?;

    let state_path = root.join("state.json");
    let temporary_path = root.join("state.json.tmp");
    let bytes = serde_json::to_vec(state).map_err(|error| format!("Cannot serialize OTA state: {error}"))?;

    fs::write(&temporary_path, bytes).map_err(|error| format!("Cannot write OTA state: {error}"))?;

    if state_path.exists() {
        fs::remove_file(&state_path).map_err(|error| format!("Cannot replace OTA state: {error}"))?;
    }

    fs::rename(&temporary_path, &state_path).map_err(|error| format!("Cannot activate OTA state: {error}"))
}

fn asset_response(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache")
        .header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        .header("X-Content-Type-Options", "nosniff")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn safe_asset_path(request_path: &str) -> Option<String> {
    let decoded = percent_decode_str(request_path).decode_utf8().ok()?;
    let relative = decoded.trim_start_matches('/');
    let relative = if relative.is_empty() { "index.html" } else { relative };

    if relative.contains('\\')
        || relative.contains(':')
        || relative.starts_with('/')
        || relative
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        || !Path::new(relative)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return None;
    }

    Some(relative.to_owned())
}

pub fn serve_frontend<R: Runtime>(
    app: &AppHandle<R>,
    request_path: &str,
) -> Response<Vec<u8>> {
    let Some(relative) = safe_asset_path(request_path) else {
        return asset_response(StatusCode::BAD_REQUEST, "text/plain; charset=utf-8", b"Invalid path".to_vec());
    };

    let content_type = mime_guess::from_path(&relative)
        .first_or_octet_stream()
        .essence_str()
        .to_owned();

    if let Ok(root) = ota_root(app) {
        let state = load_state(&root);
        if let Some(version) = state.active_version {
            let versioned_file = root.join("versions").join(version).join(&relative);
            if let Ok(bytes) = fs::read(versioned_file) {
                return asset_response(StatusCode::OK, &content_type, bytes);
            }
        }
    }

    match EMBEDDED_ASSETS.get_file(&relative) {
        Some(file) => asset_response(StatusCode::OK, &content_type, file.contents().to_vec()),
        None => asset_response(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", b"Not found".to_vec()),
    }
}

fn verify_manifest(manifest_bytes: &[u8], signature_text: &str) -> Result<(), String> {
    let signature_bytes = STANDARD
        .decode(signature_text.trim())
        .map_err(|error| format!("Invalid OTA signature encoding: {error}"))?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|error| format!("Invalid OTA signature: {error}"))?;
    let public_key = VerifyingKey::from_bytes(&OTA_PUBLIC_KEY)
        .map_err(|error| format!("Invalid embedded OTA public key: {error}"))?;

    public_key
        .verify(manifest_bytes, &signature)
        .map_err(|_| "OTA manifest signature verification failed".to_owned())
}

fn safe_archive_path(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name.contains(':')
        && name
            .trim_end_matches('/')
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
        && Path::new(name)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn extract_archive(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("Invalid OTA archive: {error}"))?;

    if archive.len() == 0 || archive.len() > MAX_FILES {
        return Err("OTA archive contains an invalid number of files".to_owned());
    }

    let mut total_size = 0_u64;
    let mut seen_paths = HashSet::new();

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Cannot read OTA archive entry: {error}"))?;
        let name = entry.name().to_owned();

        if !safe_archive_path(&name) || !seen_paths.insert(name.clone()) {
            return Err("OTA archive contains an unsafe or duplicate path".to_owned());
        }

        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("OTA archive must not contain symbolic links".to_owned());
        }

        let target = destination.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|error| format!("Cannot create OTA directory: {error}"))?;
            continue;
        }

        let file_size = entry.size();
        total_size = total_size.saturating_add(file_size);
        if file_size > MAX_FILE_BYTES || total_size > MAX_EXTRACTED_BYTES {
            return Err("OTA archive exceeds the extraction size limit".to_owned());
        }

        let parent = target
            .parent()
            .ok_or_else(|| "Invalid OTA archive path".to_owned())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create OTA asset directory: {error}"))?;

        let mut output = fs::File::create(&target)
            .map_err(|error| format!("Cannot create OTA asset: {error}"))?;
        let copied = std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Cannot extract OTA asset: {error}"))?;
        if copied != file_size {
            return Err("An OTA asset was extracted with an unexpected size".to_owned());
        }
        output
            .flush()
            .map_err(|error| format!("Cannot flush OTA asset: {error}"))?;
    }

    if !destination.join("index.html").is_file() {
        return Err("OTA archive does not contain index.html".to_owned());
    }

    Ok(())
}

fn prepare_launch_state(state: &mut OtaState) -> (bool, Option<String>) {
    let failed_version = state.pending_version.take();
    if failed_version.is_some() {
        state.active_version = state.previous_version.take();
        state.boot_attempts = 0;
    }

    let activated = if let Some(staged_version) = state.staged_version.take() {
        state.previous_version = state.active_version.take();
        state.active_version = Some(staged_version.clone());
        state.pending_version = Some(staged_version);
        state.boot_attempts = 0;
        true
    } else {
        false
    };

    (activated, failed_version)
}

#[tauri::command]
pub fn ota_prepare_launch(app: AppHandle) -> Result<OtaLaunchResult, String> {
    if cfg!(debug_assertions) {
        return Ok(OtaLaunchResult {
            activated: false,
            active_version: None,
        });
    }

    let root = ota_root(&app)?;
    let mut state = load_state(&root);
    let (activated, failed_version) = prepare_launch_state(&mut state);
    save_state(&root, &state)?;

    if let Some(version) = failed_version {
        if Version::parse(&version).is_ok() {
            let failed_directory = root.join("versions").join(version);
            let _ = fs::remove_dir_all(failed_directory);
        }
    }

    Ok(OtaLaunchResult {
        activated,
        active_version: state.active_version,
    })
}

#[tauri::command]
pub fn ota_mark_boot_success(app: AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }

    let root = ota_root(&app)?;
    let mut state = load_state(&root);
    let previous_version = state.previous_version.take();
    state.pending_version = None;
    state.boot_attempts = 0;
    save_state(&root, &state)?;

    if let Some(version) = previous_version {
        if Version::parse(&version).is_ok() {
            let previous_directory = root.join("versions").join(version);
            let _ = fs::remove_dir_all(previous_directory);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn ota_check_and_install(app: AppHandle) -> Result<OtaUpdateResult, String> {
    if cfg!(debug_assertions) {
        return Ok(OtaUpdateResult {
            staged: false,
            version: None,
            notes: None,
        });
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent(concat!("Bandito/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Cannot create OTA client: {error}"))?;

    let manifest_url = format!("{OTA_RELEASE_BASE}/manifest.json");
    let signature_url = format!("{OTA_RELEASE_BASE}/manifest.sig");
    let manifest_bytes = client
        .get(manifest_url)
        .send()
        .await
        .map_err(|error| format!("Cannot check for updates: {error}"))?
        .error_for_status()
        .map_err(|error| format!("OTA manifest request failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Cannot read OTA manifest: {error}"))?;

    let signature_text = client
        .get(signature_url)
        .send()
        .await
        .map_err(|error| format!("Cannot download OTA signature: {error}"))?
        .error_for_status()
        .map_err(|error| format!("OTA signature request failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Cannot read OTA signature: {error}"))?;

    verify_manifest(&manifest_bytes, &signature_text)?;
    let manifest: OtaManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("Invalid OTA manifest: {error}"))?;

    if manifest.schema_version != 1 || manifest.archive_name != "web-assets.zip" {
        return Err("Unsupported OTA manifest format".to_owned());
    }

    let ota_version = Version::parse(&manifest.version)
        .map_err(|error| format!("Invalid OTA version: {error}"))?;
    let min_app_version = Version::parse(&manifest.min_app_version)
        .map_err(|error| format!("Invalid minimum app version: {error}"))?;
    let app_version = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|error| format!("Invalid native app version: {error}"))?;

    if app_version < min_app_version {
        return Err("This OTA update requires a newer Bandito app".to_owned());
    }

    if let Some(maximum) = manifest.max_app_version.as_deref() {
        let max_app_version = Version::parse(maximum)
            .map_err(|error| format!("Invalid maximum app version: {error}"))?;
        if app_version > max_app_version {
            return Ok(OtaUpdateResult {
                staged: false,
                version: None,
                notes: None,
            });
        }
    }

    let root = ota_root(&app)?;
    let mut state = load_state(&root);
    let active_version = state
        .active_version
        .as_deref()
        .and_then(|version| Version::parse(version).ok())
        .unwrap_or_else(|| Version::new(0, 0, 0));
    let staged_version = state
        .staged_version
        .as_deref()
        .and_then(|version| Version::parse(version).ok())
        .unwrap_or_else(|| Version::new(0, 0, 0));
    let current_version = active_version.max(staged_version);

    if ota_version <= current_version {
        return Ok(OtaUpdateResult {
            staged: false,
            version: None,
            notes: None,
        });
    }

    let archive_bytes = client
        .get(format!("{OTA_RELEASE_BASE}/web-assets.zip"))
        .send()
        .await
        .map_err(|error| format!("Cannot download OTA archive: {error}"))?
        .error_for_status()
        .map_err(|error| format!("OTA archive request failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Cannot read OTA archive: {error}"))?;

    if archive_bytes.len() > MAX_ARCHIVE_BYTES {
        return Err("OTA archive is larger than the allowed limit".to_owned());
    }

    let actual_hash = format!("{:x}", Sha256::digest(&archive_bytes));
    if !actual_hash.eq_ignore_ascii_case(&manifest.archive_sha256) {
        return Err("OTA archive checksum verification failed".to_owned());
    }

    let versions_directory = root.join("versions");
    fs::create_dir_all(&versions_directory)
        .map_err(|error| format!("Cannot create OTA versions directory: {error}"))?;

    let version_name = ota_version.to_string();
    let staging_directory = versions_directory.join(format!("{version_name}.staging"));
    let version_directory = versions_directory.join(&version_name);

    if staging_directory.exists() {
        fs::remove_dir_all(&staging_directory)
            .map_err(|error| format!("Cannot clear incomplete OTA update: {error}"))?;
    }
    fs::create_dir_all(&staging_directory)
        .map_err(|error| format!("Cannot prepare OTA update: {error}"))?;

    if let Err(error) = extract_archive(&archive_bytes, &staging_directory) {
        let _ = fs::remove_dir_all(&staging_directory);
        return Err(error);
    }

    if version_directory.exists() {
        fs::remove_dir_all(&version_directory)
            .map_err(|error| format!("Cannot replace previous OTA files: {error}"))?;
    }
    fs::rename(&staging_directory, &version_directory)
        .map_err(|error| format!("Cannot stage OTA update: {error}"))?;

    state.staged_version = Some(version_name.clone());

    if let Err(error) = save_state(&root, &state) {
        let _ = fs::remove_dir_all(&version_directory);
        return Err(error);
    }

    Ok(OtaUpdateResult {
        staged: true,
        version: Some(version_name),
        notes: manifest.notes,
    })
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_update_activates_without_immediate_rollback() {
        let mut state = OtaState {
            active_version: None,
            previous_version: None,
            pending_version: None,
            staged_version: Some("0.1.123".to_owned()),
            boot_attempts: 0,
        };

        let (activated, failed) = prepare_launch_state(&mut state);

        assert!(activated);
        assert_eq!(failed, None);
        assert_eq!(state.active_version.as_deref(), Some("0.1.123"));
        assert_eq!(state.pending_version.as_deref(), Some("0.1.123"));
        assert_eq!(state.staged_version, None);
    }

    #[test]
    fn interrupted_update_rolls_back_on_the_next_launch() {
        let mut state = OtaState {
            active_version: Some("0.1.123".to_owned()),
            previous_version: Some("0.1.100".to_owned()),
            pending_version: Some("0.1.123".to_owned()),
            staged_version: None,
            boot_attempts: 0,
        };

        let (activated, failed) = prepare_launch_state(&mut state);

        assert!(!activated);
        assert_eq!(failed.as_deref(), Some("0.1.123"));
        assert_eq!(state.active_version.as_deref(), Some("0.1.100"));
        assert_eq!(state.previous_version, None);
        assert_eq!(state.pending_version, None);
    }
}
