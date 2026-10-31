"""Safe, opt-in browser-session authentication for media extraction.

JaneConverter never asks for or stores a user's password. When selected, the
browser session is handed directly to yt-dlp for the active job.
"""

import os
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Mapping, Optional, Tuple


PUBLIC_SESSION_LABEL = "Public only"
BROWSER_SESSION_CHOICES = (
    PUBLIC_SESSION_LABEL,
    "Chrome",
    "Edge",
    "Firefox",
    "Brave",
    "Vivaldi",
    "Safari",
)

_BROWSER_ALIASES = {
    "none": None,
    "guest": None,
    "disabled": None,
    "off": None,
    "false": None,
    "public": None,
    "public only": None,
    "auto": "auto",
    "default": "auto",
    "chrome": "chrome",
    "edge": "edge",
    "firefox": "firefox",
    "brave": "brave",
    "vivaldi": "vivaldi",
    "opera": "opera",
    "chromium": "chromium",
    "safari": "safari",
}

_DEFAULT_BROWSER_PROGIDS = {
    "chromehtml": "chrome",
    "mseedgehtm": "edge",
    "firefoxurl": "firefox",
    "bravehtml": "brave",
    "vivaldihtm": "vivaldi",
    "vivaldiurl": "vivaldi",
    "operastable": "opera",
    "operagxstable": "opera",
}

_BROWSER_SIGNAL_MARKERS = (
    ("vivaldi", "vivaldi"),
    ("brave", "brave"),
    ("firefox", "firefox"),
    ("msedge", "edge"),
    ("microsoftedge", "edge"),
    ("edgemac", "edge"),
    ("chrome", "chrome"),
    ("opera", "opera"),
    ("safari", "safari"),
    ("arc", "chrome"),
)

_BROWSER_PROCESS_NAMES = {
    "chrome": {"chrome"},
    "edge": {"msedge", "microsoft edge"},
    "firefox": {"firefox"},
    "brave": {"brave", "brave browser"},
    "vivaldi": {"vivaldi"},
    "opera": {"opera", "opera_gx", "operagx"},
    "chromium": {"chromium"},
    "safari": {"safari"},
    "arc": {"arc"},
}


@dataclass(frozen=True)
class BrowserDetection:
    """Browser identity observed from the temporary localhost request."""

    label: str
    session_browser: Optional[str]
    user_agent: str = ""


def detect_browser_from_headers(headers: Mapping[str, str]) -> BrowserDetection:
    """Identify the browser that opened the access link from request headers.

    Browser client hints are checked along with the traditional user-agent so
    Chromium derivatives such as Vivaldi and Brave can be identified when they
    advertise their brand. This identifies the browser only; it never grants
    access or reads credentials.
    """
    user_agent = str(headers.get("User-Agent", "") or "")
    client_hints = " ".join(
        str(headers.get(name, "") or "")
        for name in ("Sec-CH-UA", "Sec-CH-UA-Full-Version-List", "Sec-CH-UA-Platform")
    )
    signal = f"{client_hints} {user_agent}".lower()

    browser_signals = (
        ("vivaldi", "Vivaldi", "vivaldi"),
        ("brave", "Brave", "brave"),
        ("edg/", "Microsoft Edge", "edge"),
        ("edga/", "Microsoft Edge", "edge"),
        ("edgios/", "Microsoft Edge", "edge"),
        ("opr/", "Opera", "opera"),
        ("opera", "Opera", "opera"),
        ("firefox", "Firefox", "firefox"),
        ("fxios", "Firefox", "firefox"),
        ("crios", "Google Chrome", "chrome"),
        ("chrome", "Google Chrome", "chrome"),
        ("chromium", "Chromium", "chromium"),
        ("safari", "Safari", "safari"),
    )
    for marker, label, session_browser in browser_signals:
        if marker in signal:
            # Safari appears in many Chromium user-agents; it is only Safari
            # when no Chromium-family marker was present.
            if label == "Safari" and any(token in signal for token in ("chrome", "chromium", "edg/", "opr/")):
                continue
            return BrowserDetection(label, session_browser, user_agent)
    return BrowserDetection("Unrecognized browser", None, user_agent)


def normalize_browser_session(selection: Optional[str]) -> Optional[str]:
    """Normalize a UI or CLI browser selection to yt-dlp's browser name."""
    key = str(selection or "none").strip().lower()
    if key not in _BROWSER_ALIASES:
        supported = ", ".join(BROWSER_SESSION_CHOICES)
        raise ValueError(f"Unsupported browser session '{selection}'. Choose from: {supported}")
    return _BROWSER_ALIASES[key]


def browser_session_label(selection: Optional[str]) -> str:
    """Return the stable user-facing label for a browser selection."""
    browser = normalize_browser_session(selection)
    if browser is None:
        return PUBLIC_SESSION_LABEL
    if browser == "auto":
        return "Auto-detect"
    return browser.title()


def yt_dlp_cookie_option(selection: Optional[str]) -> Optional[Tuple[str, None, None, None]]:
    """Build yt-dlp's in-memory browser-cookie option without creating a file."""
    browser = normalize_browser_session(selection)
    if browser is None:
        return None
    if browser == "auto":
        browser = detect_default_browser_session()
        if not browser:
            return None
    # yt-dlp accepts (browser, profile, keyring, container). Leaving the
    # optional values empty lets it select the user's default profile.
    return (browser, None, None, None)


def browser_process_is_running(selection: Optional[str]) -> Optional[bool]:
    """Check whether the selected browser still has a live process.

    This is deliberately limited to process names. It never opens a browser
    profile, reads cookies, or changes process state. ``None`` means the
    browser cannot be checked reliably on this host.
    """
    browser = normalize_browser_session(selection)
    if browser is None:
        return False
    process_names = _BROWSER_PROCESS_NAMES.get(browser)
    if not process_names:
        return None

    try:
        import psutil
    except ImportError:
        return None

    try:
        processes = psutil.process_iter(["name"])
        for process in processes:
            try:
                name = str(process.info.get("name") or "").strip().lower()
                if name.endswith(".exe"):
                    name = name[:-4]
            except (OSError, psutil.Error):
                continue
            if name in process_names:
                return True
    except (OSError, psutil.Error):
        return None
    return False


def normalize_browser_error_message(message: object) -> str:
    """Use Chromium terminology for yt-dlp's Chromium-family errors."""
    return str(message or "").replace("Chrome cookie database", "Chromium cookie database")


def describe_authenticated_extraction_failure(
    selection: Optional[str],
    error: BaseException,
    subject: str = "stream",
) -> str:
    """Turn browser-cookie extraction failures into safe, actionable guidance."""
    browser = browser_session_label(selection)
    subject = "playlist" if subject == "playlist" else "stream"
    detail = normalize_browser_error_message(error)
    lowered = detail.lower()
    if "dpapi" in lowered and "decrypt" in lowered:
        return (
            f"Windows could not decrypt the {browser} browser session with DPAPI. "
            f"Make sure JaneConverter and {browser} are running under the same Windows account, "
            f"close {browser} completely, reopen JaneConverter, and create a new access link in {browser}. "
            "If you use a non-default browser profile, sign in to the default browser profile or switch Account access back to Public only. "
            "JaneConverter does not copy or save your cookies."
        )
    if "could not copy" in lowered and "cookie database" in lowered:
        process_running = browser_process_is_running(selection)
        if process_running is True:
            process_guidance = (
                f"{browser} is still running after its windows were closed; a background process is keeping its cookie database locked. "
                f"JaneConverter already retried the safe live-session read, and the current yt-dlp path cannot safely force access to this locked profile. "
                f"Use {browser}'s File > Exit (or its full quit shortcut), wait a few seconds, and retry."
            )
        elif process_running is False:
            process_guidance = (
                f"Windows reports no {browser} process, so this points to a {browser} profile or Windows permission problem "
                "rather than a browser-lock problem."
            )
        else:
            process_guidance = (
                f"JaneConverter could not determine whether {browser} is still running. "
                f"Use {browser}'s full File > Exit command before retrying."
            )
        return (
            f"{browser} was detected, but yt-dlp could not copy the Chromium cookie database. "
            "JaneConverter automatically retried the read-only in-memory browser path before falling back to yt-dlp. "
            f"{process_guidance} Then retry the conversion; create a fresh access link only if you changed browser profiles or signed in again. "
            f"Use the default {browser} profile and make sure JaneConverter and {browser} run under the same Windows account. "
            "JaneConverter does not copy or save your cookies. If it still fails, switch Account access back to Public only."
        )
    return (
        f"Authenticated {subject} extraction failed using your {browser} browser session. "
        "The session may be expired, locked, or unable to access this content. "
        "JaneConverter does not save your cookies. Try opening the link in that browser first, "
        "then retry, or switch Account access back to Public only."
    )


def detect_default_browser_session() -> Optional[str]:
    """Return the yt-dlp browser name associated with the host's default browser.

    The lookup is intentionally read-only. Unknown browsers are
    treated as public-only rather than guessing a profile or opening files.
    """
    if os.name == "nt":
        for signal in _windows_default_browser_signals():
            browser = _browser_from_signal(signal)
            if browser:
                return browser
        return None

    if sys.platform == "darwin":
        for signal in _macos_default_browser_signals():
            browser = _browser_from_signal(signal)
            if browser:
                return browser
        return "safari"

    for signal in _posix_default_browser_signals():
        browser = _browser_from_signal(signal)
        if browser:
            return browser
    return None


def detect_running_browsers() -> list[str]:
    """Return all supported browsers currently running with active processes."""
    running: list[str] = []
    seen: set[str] = set()

    if os.name == "nt":
        try:
            import ctypes
            import ctypes.wintypes

            th32cs_snapprocess = 0x00000002

            class _PROCESSENTRY32(ctypes.Structure):
                _fields_ = [
                    ("dwSize", ctypes.wintypes.DWORD),
                    ("cntUsage", ctypes.wintypes.DWORD),
                    ("th32ProcessID", ctypes.wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_size_t),
                    ("th32ModuleID", ctypes.wintypes.DWORD),
                    ("cntThreads", ctypes.wintypes.DWORD),
                    ("th32ParentProcessID", ctypes.wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long),
                    ("dwFlags", ctypes.wintypes.DWORD),
                    ("szExeFile", ctypes.c_char * 260),
                ]

            h_snap = ctypes.windll.kernel32.CreateToolhelp32Snapshot(th32cs_snapprocess, 0)
            if h_snap and h_snap != ctypes.wintypes.HANDLE(-1).value:
                pe = _PROCESSENTRY32()
                pe.dwSize = ctypes.sizeof(_PROCESSENTRY32)
                if ctypes.windll.kernel32.Process32First(h_snap, ctypes.byref(pe)):
                    while True:
                        exe = pe.szExeFile.decode("latin1", errors="ignore").lower()
                        if exe.endswith(".exe"):
                            exe = exe[:-4]
                        for b, names in _BROWSER_PROCESS_NAMES.items():
                            if b not in seen and exe in names:
                                running.append(b)
                                seen.add(b)
                        if not ctypes.windll.kernel32.Process32Next(h_snap, ctypes.byref(pe)):
                            break
                ctypes.windll.kernel32.CloseHandle(h_snap)
                return running
        except Exception:
            pass

    try:
        import psutil
    except ImportError:
        return running

    try:
        for p in psutil.process_iter(["name"]):
            try:
                n = str(p.info.get("name") or "").strip().lower()
                if n.endswith(".exe"):
                    n = n[:-4]
                for b, names in _BROWSER_PROCESS_NAMES.items():
                    if b not in seen and n in names:
                        running.append(b)
                        seen.add(b)
            except (OSError, psutil.Error):
                continue
    except (OSError, psutil.Error):
        pass
    return running


def get_ordered_browser_candidates(
    preferred: Optional[str] = None, running: Optional[list[str]] = None
) -> list[str]:
    """Return candidate browsers intelligently ordered by relevance:
    1. Explicitly requested or preferred browser.
    2. Browsers currently running on the host that are confirmed installed.
    3. System default browser.
    4. Installed browsers with existing user profiles.
    5. Other known supported browsers.
    """
    candidates: list[str] = []
    raw_pref = normalize_browser_session(preferred)
    if raw_pref and raw_pref not in ("auto", "none"):
        candidates.append(raw_pref)

    installed = detect_installed_browser_sessions()
    installed_set = set(installed)

    running_browsers = running if running is not None else detect_running_browsers()
    for b in running_browsers:
        if b in installed_set and b not in candidates:
            candidates.append(b)

    default_b = detect_default_browser_session()
    if default_b and default_b not in candidates:
        candidates.append(default_b)

    for b in installed:
        if b not in candidates:
            candidates.append(b)

    return candidates


def detect_installed_browser_sessions() -> list[str]:
    """Return all supported browsers with installed profiles on the current host.

    The default browser is always prioritized first, followed by other detected
    browsers. This allows JaneConverter to autonomously locate active login
    sessions across all browsers on the system without user intervention.
    """
    default_browser = detect_default_browser_session()
    installed: list[str] = []
    if default_browser:
        installed.append(default_browser)

    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        app_data = os.environ.get("APPDATA", "")
        profile_candidates = [
            ("chrome", os.path.join(local_app_data, "Google", "Chrome", "User Data")),
            ("chrome", os.path.join(local_app_data, "Google", "Chrome SxS", "User Data")),
            ("edge", os.path.join(local_app_data, "Microsoft", "Edge", "User Data")),
            ("edge", os.path.join(local_app_data, "Microsoft", "Edge Beta", "User Data")),
            ("brave", os.path.join(local_app_data, "BraveSoftware", "Brave-Browser", "User Data")),
            ("vivaldi", os.path.join(local_app_data, "Vivaldi", "User Data")),
            ("opera", os.path.join(app_data, "Opera Software", "Opera Stable")),
            ("opera", os.path.join(app_data, "Opera Software", "Opera GX Stable")),
            ("firefox", os.path.join(app_data, "Mozilla", "Firefox", "Profiles")),
            ("chromium", os.path.join(local_app_data, "Chromium", "User Data")),
        ]
        for b, path in profile_candidates:
            if b not in installed and os.path.exists(path):
                installed.append(b)
    elif sys.platform == "darwin":
        app_candidates = [
            ("chrome", "/Applications/Google Chrome.app"),
            ("chrome", "/Applications/Google Chrome Canary.app"),
            ("edge", "/Applications/Microsoft Edge.app"),
            ("brave", "/Applications/Brave Browser.app"),
            ("vivaldi", "/Applications/Vivaldi.app"),
            ("opera", "/Applications/Opera.app"),
            ("opera", "/Applications/Opera GX.app"),
            ("firefox", "/Applications/Firefox.app"),
            ("safari", "/Applications/Safari.app"),
        ]
        for b, path in app_candidates:
            if b not in installed and os.path.exists(path):
                installed.append(b)
    else:
        home = os.path.expanduser("~")
        candidates = [
            ("chrome", os.path.join(home, ".config", "google-chrome")),
            ("chromium", os.path.join(home, ".config", "chromium")),
            ("brave", os.path.join(home, ".config", "BraveSoftware", "Brave-Browser")),
            ("vivaldi", os.path.join(home, ".config", "vivaldi")),
            ("opera", os.path.join(home, ".config", "opera")),
            ("firefox", os.path.join(home, ".mozilla", "firefox")),
            ("edge", os.path.join(home, ".config", "microsoft-edge")),
        ]
        for b, path in candidates:
            if b not in installed and os.path.exists(path):
                installed.append(b)

    return installed


def _browser_from_signal(signal: Optional[str]) -> Optional[str]:
    """Map a Windows ProgId or association command to a yt-dlp browser name."""
    normalized = str(signal or "").strip().lower()
    if not normalized:
        return None
    if normalized in _DEFAULT_BROWSER_PROGIDS:
        return _DEFAULT_BROWSER_PROGIDS[normalized]
    for marker, browser in _BROWSER_SIGNAL_MARKERS:
        if marker in normalized:
            return browser
    return None


def _windows_default_browser_signals() -> list[str]:
    """Read several Windows association locations, in preference order."""
    try:
        import winreg
    except ImportError:
        return []

    signals = []
    user_choice_root = r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations"
    for scheme in ("https", "http"):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, f"{user_choice_root}\\{scheme}\\UserChoice") as key:
                value, _ = winreg.QueryValueEx(key, "ProgId")
            signals.append(str(value))
        except OSError:
            pass

    # Some Windows configurations omit UserChoice but still expose the actual
    # command used for HTTP/HTTPS. HKCR also includes per-user class overrides.
    user_association_paths = (
        r"Software\Classes\https\shell\open\command",
        r"Software\Classes\http\shell\open\command",
    )
    for path in user_association_paths:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as key:
                value, _ = winreg.QueryValueEx(key, "")
            signals.append(str(value))
        except OSError:
            pass

    for scheme in ("https", "http"):
        try:
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, f"{scheme}\\shell\\open\\command") as key:
                value, _ = winreg.QueryValueEx(key, "")
            signals.append(str(value))
        except OSError:
            pass
    return signals


def _macos_default_browser_signals() -> list[str]:
    """Read macOS default browser associations and installed browser bundles."""
    signals: list[str] = []
    # 1. Ask LaunchServices via JXA / NSWorkspace
    try:
        script = 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("https://apple.com")).path.js'
        res = subprocess.run(
            ["osascript", "-l", "JavaScript", "-e", script],
            capture_output=True, text=True, timeout=2.0
        )
        if res.returncode == 0 and res.stdout.strip():
            signals.append(res.stdout.strip().lower())
    except (OSError, subprocess.SubprocessError):
        pass

    # 2. Query LaunchServices secure plist via defaults
    try:
        res = subprocess.run(
            ["defaults", "read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"],
            capture_output=True, text=True, timeout=2.0
        )
        if res.returncode == 0 and res.stdout:
            lines = res.stdout.splitlines()
            for i, line in enumerate(lines):
                if "LSHandlerURLScheme" in line and ("https" in line.lower() or "http" in line.lower()):
                    for j in range(max(0, i - 5), min(len(lines), i + 6)):
                        m = re.search(r'LSHandlerRoleAll\s*=\s*"([^"]+)"', lines[j])
                        if m:
                            signals.append(m.group(1).lower())
    except (OSError, subprocess.SubprocessError):
        pass

    # 3. Check installed application bundles in priority order
    for app_path, name in (
        ("/Applications/Google Chrome.app", "chrome"),
        ("/Applications/Brave Browser.app", "brave"),
        ("/Applications/Vivaldi.app", "vivaldi"),
        ("/Applications/Microsoft Edge.app", "edge"),
        ("/Applications/Firefox.app", "firefox"),
        ("/Applications/Safari.app", "safari"),
    ):
        if os.path.exists(app_path):
            signals.append(name)

    signals.append("safari")
    return signals


def _posix_default_browser_signals() -> list[str]:
    """Query Linux XDG default browser associations."""
    signals: list[str] = []
    try:
        res = subprocess.run(
            ["xdg-settings", "get", "default-web-browser"],
            capture_output=True, text=True, timeout=2.0
        )
        if res.returncode == 0 and res.stdout.strip():
            signals.append(res.stdout.strip().lower())
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        res = subprocess.run(
            ["xdg-mime", "query", "default", "x-scheme-handler/https"],
            capture_output=True, text=True, timeout=2.0
        )
        if res.returncode == 0 and res.stdout.strip():
            signals.append(res.stdout.strip().lower())
    except (OSError, subprocess.SubprocessError):
        pass
    return signals


def is_chromium_direct_cookie_policy_enabled() -> bool:
    """Check whether Windows policy allows standard DPAPI decryption for Edge/Chrome."""
    if os.name != "nt":
        return False
    try:
        import winreg
        for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for subkey in (r"Software\Policies\Microsoft\Edge", r"Software\Policies\Google\Chrome"):
                try:
                    with winreg.OpenKey(root, subkey) as key:
                        val, _ = winreg.QueryValueEx(key, "ApplicationBoundEncryptionEnabled")
                        if val == 0:
                            return True
                except OSError:
                    continue
    except Exception:
        pass
    return False


def set_chromium_direct_cookie_policy(enabled: bool) -> bool:
    """Configure or remove the ApplicationBoundEncryptionEnabled policy in HKCU."""
    if os.name != "nt":
        return False
    try:
        import winreg
        targets = (r"Software\Policies\Microsoft\Edge", r"Software\Policies\Google\Chrome")
        for subkey in targets:
            if enabled:
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER, subkey) as key:
                    winreg.SetValueEx(key, "ApplicationBoundEncryptionEnabled", 0, winreg.REG_DWORD, 0)
            else:
                try:
                    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, subkey, 0, winreg.KEY_SET_VALUE) as key:
                        winreg.DeleteValue(key, "ApplicationBoundEncryptionEnabled")
                except OSError:
                    pass
        return True
    except Exception:
        return False


