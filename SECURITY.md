# Security Policy

**Project:** JaneConverter  
**Maintainer:** project//aspyr (Jane Cerys)  

---

## 1. Supported Versions

Security updates and vulnerability remediation are actively provided for:

| Version Line | Supported | Status |
| :--- | :--- | :--- |
| **v2.x** (Current) | :white_check_mark: Yes | Actively maintained, tested, and updated |
| **v1.x** (Legacy) | :x: No | Deprecated; upgrade to v2.x |

---

## 2. Reporting a Vulnerability

We welcome responsible security research and vulnerability disclosures. If you discover a vulnerability in JaneConverter, please report it privately:

- **GitHub Advisory (Preferred):** Open a private report under [Security Advisories](https://github.com/jeongchaeul/JaneConverter/security/advisories).
- **Direct Maintainer Contact:** Contact the maintainer via the email on the profile with subject `[SECURITY] JaneConverter`.

### Report Requirements:
1. Clear vulnerability description, affected component, and impact assessment.
2. Step-by-step reproduction instructions or a Minimal Proof of Concept (PoC).
3. Environment details (OS, JaneConverter version, Python / Rust / Node version).
4. Suggested remediation or patch, if available.

### Timelines & Safe Harbor:
- **Acknowledgment:** Within 2–4 business days.
- **Triage & Patching:** Critical vulnerabilities receive prioritized patching via continuous updater packages and releases.
- **Safe Harbor:** We will not pursue legal action against researchers disclosing vulnerabilities in good faith following these guidelines without accessing unauthorized user data or disrupting service availability.

---

## 3. Scope & Threat Model

JaneConverter is a desktop media processing utility running on local hardware. For a detailed breakdown of intentional low-level capabilities, privacy controls, and defense mechanisms, consult [Architectural Threat Model](docs/THREAT_MODEL.md).

### In-Scope Vulnerabilities:
- Remote Code Execution (RCE) via malformed media, metadata tags, or `.flp` files.
- Command or argument injection via unsanitized URLs, filenames, or CLI flags.
- Loopback IPC privilege escalation, unauthorized command dispatch, or arbitrary file access in `desktop-ui` (Tauri bridge) or `browser_bridge.py`.
- Server-Side Request Forgery (SSRF) bypassing loopback/private IP filtering for thumbnails or media streams.
- Tampering or integrity flaws in updater routines (`updater.py`, Tauri updater).

### Out-of-Scope Vulnerabilities:
- Attacks requiring physical access or administrative control (`root` / `Administrator`) over the workstation.
- Self-inflicted Denial of Service (DoS) via unbounded local inputs consuming CPU/RAM.
- Inability to download DRM-protected or encrypted media (JaneConverter does not decrypt DRM).
- Flaws in external third-party services (YouTube, Spotify, etc.).

---

## 4. Architectural Security Guarantees

1. **Zero Remote Telemetry & 100% Local Processing:** No tracking beacons, analytics, or conversion logs are sent to remote servers. All conversions execute locally.
2. **Ephemeral Sessions & Isolated Staging:** Session cookies are borrowed only for active requests and discarded immediately upon completion. Temporary database copies for locked files are isolated in private temporary directories and deleted promptly. Passwords and credentials are never requested or stored.
3. **Opt-in Windows Cookie Policy:** For Chromium 127+ App-Bound Encryption, the app provides an optional toggle configuring `ApplicationBoundEncryptionEnabled=0` under `HKCU\Software\Policies` (per-user policy). This is disabled by default, completely opt-in, and can be disabled at any time.
4. **Hardened Loopback Interface:** The desktop access server and Browser Bridge bind strictly to `127.0.0.1`, validate extension origins, require session tokens, and enforce bounded payload limits.
5. **Input Sanitization & Safe Paths:** Filenames are NFC-normalized, bidi control marks stripped, illegal OS characters removed, and Windows reserved names escaped. File paths are canonicalized prior to writing.
6. **Cryptographically Signed Updates:** Updates are served over HTTPS from canonical GitHub releases, verified via Minisign cryptographic signatures in the Tauri updater.
