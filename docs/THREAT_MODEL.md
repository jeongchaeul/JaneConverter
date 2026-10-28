# Architectural Threat Model & Security Intent

**Project:** JaneConverter  
**Maintainer:** project//aspyr (Jane Cerys)  
**Target Audience:** Security researchers, third-party code auditors, and open-source contributors reviewing JaneConverter's architecture and capabilities.

---

## 1. Executive Summary & Design Philosophy

JaneConverter is a high-performance, local-first multimedia conversion suite and creator studio toolbox. Unlike consumer SaaS web converters, JaneConverter operates **100% locally on the user's workstation** without remote telemetry, external servers, or cloud dependencies.

Because JaneConverter solves complex real-world media extraction challenges—such as extracting authenticated high-definition streams, bypassing Windows exclusive SQLite database locks while browsers are open, and downgrading binary DAW project formats—it incorporates low-level operating system integrations that automated scanners or external auditors with no context may initially view with suspicion.

This document outlines the **threat model, security guarantees, architectural intent, and guardrails** governing these high-privilege subsystems.

---

## 2. High-Privilege Capabilities & Threat Analysis

### A. Non-Destructive Win32 Handle Duplication (`cookie_unlocker.py`)

* **What It Does:** On Windows, running Chromium browsers (Chrome, Edge, Brave, Vivaldi) lock their cookie databases (`Network\Cookies`) with exclusive file sharing flags. `cookie_unlocker.py` queries locking PIDs via the Windows Restart Manager API in read-only mode, duplicates the open file handle into JaneConverter's process via `DuplicateHandle`, and streams a snapshot of the database into an isolated temporary folder.
* **Why It Is Not An Infostealer:**
  1. **Strictly Read-Only:** It does not terminate browser processes, inject code, hijack DLLs, hook memory, or modify browser state.
  2. **Isolated Ephemeral Snapshot:** Snapshots are written to a private temporary directory and deleted immediately after the query.
  3. **No Key Exfiltration:** JaneConverter never stores or transmits browser master keys or decrypted session tokens.
  4. **Functional Purpose:** It exists purely so `yt-dlp` does not crash with a `PermissionError` or file lock contention when the creator runs conversions while their browser is open.

### B. Chrome DevTools Protocol (`debugger` Permission in Browser Extension)

* **What It Does:** The JaneConverter Browser Bridge extension requests the `debugger` permission in Manifest V3 to attach to selected media tabs via the Chrome DevTools Protocol (CDP).
* **Why It Is A Privacy Defense, Not Spyware:**
  1. **Cookie-Free Media Capture:** Standard extensions capture authenticated media by stealing and exporting session cookies to a backend. JaneConverter explicitly rejects cookie export. Instead, it captures media stream packets directly out of in-memory network buffers (`Network.getResponseBody`).
  2. **User-Gated Activation:** The extension only attaches to tabs when the user explicitly triggers capture on a supported media page.
  3. **Strict Origin Enforcement:** The loopback receiver in `account_access.py` and `browser_bridge.py` validates that media bytes match confirmed source domains, rejecting third-party webpage origins.

### C. Chromium App-Bound Encryption Policy Toggle

* **What It Does:** Chromium 127+ introduced App-Bound Encryption, binding DPAPI cookie decryption to the browser's executable identity. JaneConverter provides an optional toggle in the UI to set `ApplicationBoundEncryptionEnabled=0` under `HKCU\Software\Policies\Microsoft\Edge` and `Google\Chrome`.
* **Security Controls & Scope:**
  1. **Explicit Opt-In:** Disabled by default. It is never applied automatically without explicit user consent.
  2. **Per-User Scoping:** Configured strictly under `HKEY_CURRENT_USER` (HKCU). It does not permanently alter system-wide `HKEY_LOCAL_MACHINE` policies.
  3. **Reversible:** The user can disable the toggle at any time, which completely removes the policy key.

---

## 3. Network & System Boundaries

### A. Server-Side Request Forgery (SSRF) Mitigations
* **Hop-by-Hop Validation:** Both archival stream lookups (`archival.py`) and shortlink expansion (`social_photo_capture.py`) disable automated HTTP redirect following. Every redirect target is resolved and validated before any connection is made.
* **Private/Loopback IP Filtering:** All outbound requests probe resolved IP addresses via `_is_safe_public_url()` to verify that destinations do not belong to private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), multicast, or cloud metadata endpoints.

### B. Subprocess & Living-off-the-Land (LOLBin) Defense
* **Native Shell APIs:** External link opening in the desktop shell uses native Win32 `ShellExecuteW` directly in Rust, avoiding living-off-the-land proxy binaries such as `rundll32.exe`.
* **Argument Injection Prevention:** All ffmpeg, ffprobe, and Python CLI invocations pass arguments as discrete array vectors (`subprocess.Popen` / `std::process::Command`), never through an intermediate system shell (`shell=True`).
* **Input Path Sanitization:** Output filenames are stripped of bidirectional control marks, null bytes, path traversal sequences (`..`), and OS-reserved characters before being written to disk.

### C. Binary & DAW Project File Boundaries
* **Input File Size Limits:** The FL Studio project parser (`flp/parser.py`) enforces an upfront 512 MB file size ceiling prior to reading binary streams into memory, mitigating memory exhaustion (DoS).
* **Varint Safeguards:** The varint decoder enforces a bit-shift ceiling (`shift > 35`) to prevent integer overflows on corrupted binary event streams.
* **Hermetic Backups:** Project downgrading creates `.bak` backups before writing modified projects in-place.

---

## 4. Summary for Auditors

When assessing JaneConverter, evaluate findings through this threat model:
* Capabilities that interact with browser locks, developer protocols, or enterprise policies are **intentional, transparent, creator-facing engineering solutions**, not evasive payloads.
* Boundaries that accept untrusted URLs, parse external binary files, or handle network redirects are **strictly bounded, validated hop-by-hop, and sandboxed locally**.
