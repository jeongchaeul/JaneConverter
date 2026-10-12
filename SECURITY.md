# Security Policy

**Project:** JaneConverter  
**Maintainer:** project//aspyr (Jane Cerys)  

---

## 1. Supported Versions

Security updates and vulnerability remediation are actively provided for the following releases:

| Version Line | Supported | Status |
| :--- | :--- | :--- |
| **v2.x** (Current) | :white_check_mark: Yes | Actively maintained, tested, and updated |
| **v1.x** (Legacy) | :x: No | Deprecated; users are advised to upgrade to v2.x |

---

## 2. Reporting a Vulnerability

We welcome responsible security research and vulnerability disclosures. If you discover a security vulnerability or weakness in JaneConverter, please report it privately rather than filing a public issue.

### Preferred Reporting Method
- **GitHub Private Vulnerability Reporting:** Open a private advisory under the [JaneConverter Security Advisories](https://github.com/jeongchaeul/JaneConverter/security/advisories) tab.
- **Direct Maintainer Contact:** Alternatively, reach out directly to the maintainer via the contact channel provided in the repository's profile with the subject `[SECURITY VULNERABILITY] JaneConverter`.

### What to Include in Your Report
To help us triage and reproduce the issue rapidly, please provide:
1. A clear description of the vulnerability, affected components, and perceived impact.
2. Step-by-step instructions or a Minimal Reproducible Example / Proof of Concept (PoC).
3. The affected environment (Operating System, JaneConverter version, Python / Rust / Node version).
4. Proposed mitigation or patch, if known.

### Response Timelines & SLA
- **Initial Acknowledgment:** Within **48 hours** of receiving the report.
- **Triage & Assessment:** Within **5 business days**, confirming reproduction and assigning an internal priority.
- **Remediation & Patch Release:** Critical and High severity issues will receive priority patching, followed by a coordinated public release.
- **Safe Harbor:** We will not pursue legal action against researchers who discover and disclose vulnerabilities in good faith following these guidelines, without accessing unauthorized user data, modifying external services, or disrupting availability.

---

## 3. Scope & Threat Model

JaneConverter is a desktop media processing utility running on local hardware.

### In-Scope Vulnerabilities
- Remote Code Execution (RCE) triggered by processing malformed media files, metadata tags, or `.flp` project files.
- Command injection or argument injection via unsanitized URLs, filenames, or CLI flags.
- Loopback IPC privilege escalation, unauthorized command dispatch, or arbitrary file system read/write vulnerabilities in `desktop-ui` (Tauri bridge) or `browser_bridge.py`.
- Server-Side Request Forgery (SSRF) bypassing loopback / private IP filtering when fetching thumbnails or media feeds.
- Supply-chain or integrity tampering in the automated update downloader (`updater.py`, Tauri updater).

### Out-of-Scope Vulnerabilities
- Attacks requiring physical access or local administrative control (`root` / `Administrator`) over the user's workstation.
- Denial of Service (DoS) where an attacker requires the user to manually pass unbounded local inputs that consume CPU/RAM on their own machine.
- Requests or issues regarding inability to download DRM-protected or encrypted streams (JaneConverter by design complies with DMCA § 1201 and does not crack DRM).
- Flaws in third-party services (e.g. YouTube, Spotify) outside JaneConverter's control.

---

## 4. Architectural Security & Privacy Guarantees

JaneConverter is engineered with a strict defense-in-depth posture:

1. **Zero Remote Telemetry & Complete Air-Gapping:**
   - No telemetry, analytics, tracking beacons, or conversion logs are transmitted to any remote server.
   - All conversions run 100% locally via bundled or system FFmpeg, Pillow, and Python engines.
2. **Ephemeral In-Memory Credentials:**
   - The sandboxed browser session fallback never touches disk storage for cookies or credentials.
   - Cookies are held exclusively in process memory and wiped immediately upon job completion.
   - Unrelated third-party cookies are stripped prior to extraction.
3. **Hardened Loopback Boundary:**
   - The desktop access server and browser companion bridge bind strictly to `127.0.0.1`.
   - Origins are checked against extension schemes (`chrome-extension://`, `moz-extension://`, etc.).
   - All requests require a randomized cryptographic session token in the path.
   - Payload bodies are strictly bounded with hard limits on headers, chunks, and metadata.
4. **Input Sanitization & Path Traversal Prevention:**
   - Filenames are normalized (NFC), bidi formatting marks are stripped, illegal OS characters are purged, and Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, etc.) are defensively escaped.
   - Output paths are canonicalized and verified before writing.
5. **Signed & Verified Updates:**
   - Updates are retrieved strictly from canonical HTTPS GitHub releases.
   - SHA-256 integrity checksums and cryptographic signatures verify binary authenticity prior to installation.
