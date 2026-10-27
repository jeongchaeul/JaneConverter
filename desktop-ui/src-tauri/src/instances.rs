//! Instance management and multi-instance capping for JaneConverter Desktop.
//!
//! Enforces:
//! - Maximum instances capped to 3.
//! - When 0 instances are running: launch Instance 1 normally without prompting.
//! - When 1 or 2 instances are running: prompt confirmation:
//!   "An Instance is already running. Launch another instance? (Max of 3)"
//!   If Yes: launch. If No: bring existing window to top and exit.
//! - When 3 instances are running: do NOT prompt a window; bring the active window
//!   to top and exit immediately.
//! - Anti-spam guard: if rapid simultaneous launches occur (e.g. keyboard repeat
//!   spawning dozens of instances), only one confirmation dialog is ever shown.
//!   All subsequent concurrent launch attempts abort immediately.

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(not(windows))]
use std::fs::{self, File};
#[cfg(not(windows))]
use std::os::unix::io::AsRawFd;

pub const MAX_INSTANCES: usize = 3;

#[cfg(windows)]
const SLOT_MUTEX_PREFIX: &str = "Local\\JaneConverter_Instance_Slot_";
#[cfg(windows)]
const COORD_MUTEX_NAME: &str = "Local\\JaneConverter_Instance_Coord";
#[cfg(windows)]
const PROMPT_MUTEX_NAME: &str = "Local\\JaneConverter_Instance_Prompt";

#[cfg(windows)]
const SYNCHRONIZE: u32 = 0x0010_0000;
#[cfg(windows)]
const WAIT_OBJECT_0: u32 = 0x0000_0000;
#[cfg(windows)]
const WAIT_ABANDONED: u32 = 0x0000_0080;
#[cfg(windows)]
const ERROR_ALREADY_EXISTS: u32 = 183;

#[cfg(windows)]
const MB_YESNO: u32 = 0x0000_0004;
#[cfg(windows)]
const MB_ICONQUESTION: u32 = 0x0000_0020;
#[cfg(windows)]
const MB_TOPMOST: u32 = 0x0004_0000;
#[cfg(windows)]
const MB_SETFOREGROUND: u32 = 0x0001_0000;
#[cfg(windows)]
const IDYES: i32 = 6;

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn EnumWindows(
        lp_enum_func: Option<unsafe extern "system" fn(isize, isize) -> i32>,
        lparam: isize,
    ) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, n_max_count: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
    fn AllowSetForegroundWindow(dw_process_id: u32) -> i32;
    fn ShowWindow(hwnd: isize, n_cmd_show: i32) -> i32;
    fn BringWindowToTop(hwnd: isize) -> i32;
    fn SetForegroundWindow(hwnd: isize) -> i32;
    fn MessageBoxW(
        hwnd: *mut c_void,
        lp_text: *const u16,
        lp_caption: *const u16,
        u_type: u32,
    ) -> i32;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CreateMutexW(
        lp_mutex_attributes: *mut c_void,
        b_initial_owner: i32,
        lp_name: *const u16,
    ) -> *mut c_void;
    fn OpenMutexW(
        dw_desired_access: u32,
        b_inherit_handle: i32,
        lp_name: *const u16,
    ) -> *mut c_void;
    fn ReleaseMutex(h_mutex: *mut c_void) -> i32;
    fn CloseHandle(h_object: *mut c_void) -> i32;
    fn GetLastError() -> u32;
    fn WaitForSingleObject(h_handle: *mut c_void, dw_milliseconds: u32) -> u32;
    fn GetCurrentProcessId() -> u32;
}

/// An active instance slot guard. While held, this process occupies one of the
/// allowed instance slots. Dropping this guard automatically frees the slot.
pub struct InstanceGuard {
    slot: usize,
    #[cfg(windows)]
    handle: *mut c_void,
    #[cfg(not(windows))]
    _file: File,
}

#[cfg(windows)]
unsafe impl Send for InstanceGuard {}
#[cfg(windows)]
unsafe impl Sync for InstanceGuard {}

impl InstanceGuard {
    pub fn slot(&self) -> usize {
        self.slot
    }
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            if !self.handle.is_null() {
                CloseHandle(self.handle);
                self.handle = std::ptr::null_mut();
            }
        }
    }
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
struct CoordGuard(*mut c_void);

#[cfg(windows)]
impl Drop for CoordGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                ReleaseMutex(self.0);
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(windows)]
fn acquire_coord(name: &str, timeout_ms: u32) -> Option<CoordGuard> {
    let wide = to_wide(name);
    unsafe {
        let handle = CreateMutexW(std::ptr::null_mut(), 0, wide.as_ptr());
        if handle.is_null() {
            return None;
        }
        let wait = WaitForSingleObject(handle, timeout_ms);
        if wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED {
            Some(CoordGuard(handle))
        } else {
            CloseHandle(handle);
            None
        }
    }
}

#[cfg(windows)]
struct PromptGuard(*mut c_void);

#[cfg(windows)]
impl Drop for PromptGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(windows)]
fn try_acquire_prompt_lock(name: &str) -> Option<PromptGuard> {
    let wide = to_wide(name);
    unsafe {
        let handle = CreateMutexW(std::ptr::null_mut(), 1, wide.as_ptr());
        if handle.is_null() {
            return None;
        }
        if GetLastError() == ERROR_ALREADY_EXISTS {
            CloseHandle(handle);
            return None;
        }
        Some(PromptGuard(handle))
    }
}

#[cfg(windows)]
fn get_active_slot_count_custom(prefix: &str, max_slots: usize) -> usize {
    let mut count = 0;
    for slot in 1..=max_slots {
        let name = to_wide(&format!("{}{}", prefix, slot));
        unsafe {
            let handle = OpenMutexW(SYNCHRONIZE, 0, name.as_ptr());
            if !handle.is_null() {
                count += 1;
                CloseHandle(handle);
            }
        }
    }
    count
}

#[cfg(windows)]
fn try_claim_free_slot_custom(prefix: &str, max_slots: usize) -> Option<InstanceGuard> {
    for slot in 1..=max_slots {
        let name = to_wide(&format!("{}{}", prefix, slot));
        unsafe {
            let open_h = OpenMutexW(SYNCHRONIZE, 0, name.as_ptr());
            if !open_h.is_null() {
                CloseHandle(open_h);
                continue;
            }
            let handle = CreateMutexW(std::ptr::null_mut(), 1, name.as_ptr());
            if handle.is_null() {
                continue;
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                continue;
            }
            return Some(InstanceGuard { slot, handle });
        }
    }
    None
}

#[cfg(windows)]
fn ask_user_confirmation() -> bool {
    let text = to_wide("An Instance is already running. Launch another instance? (Max of 3)");
    let caption = to_wide("JaneConverter");
    unsafe {
        let result = MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_YESNO | MB_ICONQUESTION | MB_TOPMOST | MB_SETFOREGROUND,
        );
        result == IDYES
    }
}

#[cfg(windows)]
unsafe extern "system" fn enum_windows_callback(hwnd: isize, lparam: isize) -> i32 {
    let found = &mut *(lparam as *mut Option<isize>);
    if IsWindowVisible(hwnd) != 0 {
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != GetCurrentProcessId() {
            let mut text = [0u16; 512];
            let len = GetWindowTextW(hwnd, text.as_mut_ptr(), text.len() as i32);
            if len > 0 {
                let title = String::from_utf16_lossy(&text[..len as usize]);
                if title.contains("JaneConverter") {
                    *found = Some(hwnd);
                    return 0; // stop enumeration
                }
            }
        }
    }
    1 // continue enumeration
}

/// Brings an already running JaneConverter window to the foreground and restores
/// it if it was minimized.
pub fn bring_active_window_to_top() {
    #[cfg(windows)]
    unsafe {
        let mut target_hwnd: Option<isize> = None;
        EnumWindows(
            Some(enum_windows_callback),
            &mut target_hwnd as *mut _ as isize,
        );
        if let Some(hwnd) = target_hwnd {
            const SW_RESTORE: i32 = 9;
            AllowSetForegroundWindow(0xFFFF_FFFF);
            ShowWindow(hwnd, SW_RESTORE);
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
        }
    }
}

/// Attempts to acquire an instance slot according to the multi-instance rules.
///
/// Returns:
/// - `Some(InstanceGuard)`: Slot acquired, process is permitted to launch and run.
/// - `None`: Launch cancelled, maximum reached, or concurrent duplicate launch aborted.
pub fn acquire_instance_slot() -> Option<InstanceGuard> {
    #[cfg(windows)]
    {
        // 1. Acquire coordination lock with a 3-second timeout to prevent race conditions.
        let _coord = acquire_coord(COORD_MUTEX_NAME, 3000)?;

        // 2. Query how many instance slots are currently active.
        let active_count = get_active_slot_count_custom(SLOT_MUTEX_PREFIX, MAX_INSTANCES);

        // Case 1: First instance (0 running) -> launch immediately without prompting.
        if active_count == 0 {
            return try_claim_free_slot_custom(SLOT_MUTEX_PREFIX, MAX_INSTANCES);
        }

        // Case 2: Max instances (3) already active -> do NOT prompt; reject immediately.
        if active_count >= MAX_INSTANCES {
            return None;
        }

        // Case 3: 1 or 2 instances currently active -> prompt user.
        // First acquire prompt lock. If another instance is ALREADY displaying the prompt
        // (e.g. keyboard repeat spamming dozens of launches), abort immediately to avoid dialog spam.
        let prompt_guard = match try_acquire_prompt_lock(PROMPT_MUTEX_NAME) {
            Some(guard) => guard,
            None => {
                // A prompt dialog is already open on screen
                return None;
            }
        };

        // Release coordination lock while waiting on user response so other operations aren't blocked.
        drop(_coord);

        // Show native modal prompt.
        let confirmed = ask_user_confirmation();

        // Release prompt lock once user answers.
        drop(prompt_guard);

        if !confirmed {
            return None;
        }

        // User confirmed Yes -> re-acquire coordination lock and claim next available slot.
        let _coord = acquire_coord(COORD_MUTEX_NAME, 3000)?;
        try_claim_free_slot_custom(SLOT_MUTEX_PREFIX, MAX_INSTANCES)
    }

    #[cfg(not(windows))]
    {
        acquire_instance_slot_unix()
    }
}

#[cfg(not(windows))]
fn get_unix_instances_dir() -> std::path::PathBuf {
    let base = std::env::var("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            std::path::PathBuf::from(home).join(".local").join("share")
        });
    base.join("janeconverter").join("instances")
}

#[cfg(not(windows))]
fn acquire_instance_slot_unix() -> Option<InstanceGuard> {
    let dir = get_unix_instances_dir();
    let _ = fs::create_dir_all(&dir);

    // Advisory flock for coordination
    let coord_file = File::create(dir.join("coord.lock")).ok()?;
    let coord_fd = coord_file.as_raw_fd();
    unsafe {
        if libc::flock(coord_fd, libc::LOCK_EX) != 0 {
            return None;
        }
    }

    // Count active slots
    let mut active_count = 0;
    for slot in 1..=MAX_INSTANCES {
        let path = dir.join(format!("slot_{}.lock", slot));
        if let Ok(f) = File::create(&path) {
            let fd = f.as_raw_fd();
            let is_locked = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) != 0 };
            if is_locked {
                active_count += 1;
            } else {
                unsafe {
                    libc::flock(fd, libc::LOCK_UN);
                }
            }
        }
    }

    if active_count == 0 {
        return try_claim_free_slot_unix(&dir);
    }

    if active_count >= MAX_INSTANCES {
        return None;
    }

    // Try prompt lock
    let prompt_file = File::create(dir.join("prompt.lock")).ok()?;
    let prompt_fd = prompt_file.as_raw_fd();
    let got_prompt_lock = unsafe { libc::flock(prompt_fd, libc::LOCK_EX | libc::LOCK_NB) == 0 };
    if !got_prompt_lock {
        return None;
    }

    // Release coordination lock before showing prompt
    unsafe {
        libc::flock(coord_fd, libc::LOCK_UN);
    }

    let confirmed = rfd::MessageDialog::new()
        .set_title("JaneConverter")
        .set_description("An Instance is already running. Launch another instance? (Max of 3)")
        .set_buttons(rfd::MessageButtons::YesNo)
        .show()
        == rfd::MessageDialogResult::Yes;

    unsafe {
        libc::flock(prompt_fd, libc::LOCK_UN);
    }

    if !confirmed {
        return None;
    }

    unsafe {
        if libc::flock(coord_fd, libc::LOCK_EX) != 0 {
            return None;
        }
    }

    try_claim_free_slot_unix(&dir)
}

#[cfg(not(windows))]
fn try_claim_free_slot_unix(dir: &std::path::Path) -> Option<InstanceGuard> {
    for slot in 1..=MAX_INSTANCES {
        let path = dir.join(format!("slot_{}.lock", slot));
        if let Ok(file) = File::create(&path) {
            let fd = file.as_raw_fd();
            let locked = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) == 0 };
            if locked {
                return Some(InstanceGuard { slot, _file: file });
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constants_match_specification() {
        assert_eq!(MAX_INSTANCES, 3);
    }

    #[cfg(windows)]
    #[test]
    fn test_slot_claiming_and_dropping() {
        let prefix = "Local\\JaneConverter_Unit_Test_Slot_";
        let coord_name = "Local\\JaneConverter_Unit_Test_Coord";

        let _coord = acquire_coord(coord_name, 2000).expect("acquire coord");

        // Initially 0 slots active
        assert_eq!(get_active_slot_count_custom(prefix, 3), 0);

        // Claim slot 1
        let guard1 = try_claim_free_slot_custom(prefix, 3).expect("claim slot 1");
        assert_eq!(guard1.slot(), 1);
        assert_eq!(get_active_slot_count_custom(prefix, 3), 1);

        // Claim slot 2
        let guard2 = try_claim_free_slot_custom(prefix, 3).expect("claim slot 2");
        assert_eq!(guard2.slot(), 2);
        assert_eq!(get_active_slot_count_custom(prefix, 3), 2);

        // Claim slot 3
        let guard3 = try_claim_free_slot_custom(prefix, 3).expect("claim slot 3");
        assert_eq!(guard3.slot(), 3);
        assert_eq!(get_active_slot_count_custom(prefix, 3), 3);

        // All 3 slots full -> 4th claim returns None
        let guard4 = try_claim_free_slot_custom(prefix, 3);
        assert!(guard4.is_none());

        // Drop slot 2
        drop(guard2);
        assert_eq!(get_active_slot_count_custom(prefix, 3), 2);

        // Slot 2 should now be free to claim again
        let guard2_new = try_claim_free_slot_custom(prefix, 3).expect("claim slot 2 again");
        assert_eq!(guard2_new.slot(), 2);
        assert_eq!(get_active_slot_count_custom(prefix, 3), 3);

        drop(guard1);
        drop(guard2_new);
        drop(guard3);
        assert_eq!(get_active_slot_count_custom(prefix, 3), 0);
    }

    #[cfg(windows)]
    #[test]
    fn test_prompt_lock_anti_spam() {
        let prompt_name = "Local\\JaneConverter_Unit_Test_Prompt";

        // First instance acquires prompt lock
        let guard1 = try_acquire_prompt_lock(prompt_name);
        assert!(guard1.is_some());

        // Second concurrent instance attempts to acquire prompt lock -> fails (prevents spam dialog)
        let guard2 = try_acquire_prompt_lock(prompt_name);
        assert!(guard2.is_none());

        // Drop first guard -> prompt lock is free again
        drop(guard1);

        let guard3 = try_acquire_prompt_lock(prompt_name);
        assert!(guard3.is_some());
        drop(guard3);
    }
}
