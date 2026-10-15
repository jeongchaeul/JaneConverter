fn main() {
    let mut windows = tauri_build::WindowsAttributes::new();
    windows = windows.static_vc_runtime(true);
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
