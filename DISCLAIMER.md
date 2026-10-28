# Legal Disclaimer & Acceptable Use Policy

**Last Updated:** October 2026  
**Project:** JaneConverter  
**Maintainer:** project//aspyr (Jane Cerys)  

---

## 1. Authorized & Intended Use

JaneConverter is an open-source local media transcoding and studio utility intended exclusively for:

1. **Personal Media Processing:** Format-shifting, converting, and archiving digital media that you personally own, created, or hold express legal authorization to process.
2. **Fair Use & Educational Research:** Lawful format adaptation, media inspection, and time-shifting permitted under fair use, fair dealing, or statutory exemptions in your jurisdiction.
3. **DAW Interoperability:** Inspecting, debugging, and format-adapting user-owned digital audio workstation project files (e.g., Image-Line FL Studio `.flp` files) across installed software versions.

**Using JaneConverter to infringe copyrights, violate intellectual property rights, distribute unauthorized copies, or breach platform Terms of Service is strictly prohibited.**

---

## 2. DRM, Access Controls & Platform Terms

### What JaneConverter Does Not Do:
- **No DRM Decryption:** JaneConverter does **not** bypass, decrypt, circumvent, or disable any Digital Rights Management (DRM) or technological protection measures, including Google Widevine, Apple FairPlay, Microsoft PlayReady, or ClearKey encryption. Encrypted streams cannot be decrypted.
- **No DRM Keys or Extraction Logic:** Contains no DRM keys, key-extraction tools, or proprietary decryption algorithms.
- **No Credential Harvesting:** Does not harvest passwords, bypass login barriers, or impersonate third-party accounts.

### What JaneConverter Does:
- Retrieves media accessible to you as a public guest on the open web, or through your own signed-in browser session upon explicit opt-in.
- Retries transient HTTP errors or rate limits using standard browser headers available within `yt-dlp` and companion extractors.

### Platform Terms & User Responsibility:
Online platforms may restrict automated downloading in their Terms of Service. Using automated tools may lead to account or IP restrictions. Operators carry sole legal responsibility for ensuring their usage complies with all applicable statutes (including 17 U.S.C. § 1201 or international equivalents) and contractual obligations.

---

## 3. Third-Party Trademarks & Independence

All trademarks, logos, and brand names referenced within JaneConverter or its documentation belong to their respective owners:
- **Platforms:** YouTube, Spotify, Apple Music, SoundCloud, TikTok, Instagram, Facebook, X (formerly Twitter), Reddit, Tumblr, Pinterest, Twitch, and Discord are trademarks of their respective corporate holders.
- **Software:** "FL Studio" and "Image-Line" are registered trademarks of Image-Line Software NV.
- **No Affiliation:** JaneConverter and `project//aspyr` are independent open-source initiatives. Trademark references are used strictly for identification, interoperability, and nominative descriptive purposes, and do not imply affiliation, sponsorship, or endorsement.

---

## 4. FL Studio (.flp) Project Interoperability

The FL Studio project downgrading and inspection tools are independent implementations of reverse-engineered binary chunk specifications:
- Operates exclusively on file metadata, header identifiers, and event chunks of user-supplied `.flp` project files.
- Does **not** modify, hook, patch, or decompile any executable or dynamic library (`.exe`, `.dll`, `.dylib`, `.so`) of FL Studio or Image-Line software.
- Does **not** bypass DAW licensing, registration dialogs, or copy protection.
- Purpose is format interoperability, enabling producers to open their own project files across workstation releases.

---

## 5. Privacy, Local Processing & Security

- **100% Local Conversion:** All transcoding (FFmpeg, SoX, Pillow) and project patching execute locally on your machine.
- **Zero Telemetry:** Transmits no usage analytics, tracking beacons, filenames, or conversion history.
- **Ephemeral Session Security:** Session cookies are loaded into volatile process memory for active requests only, and are never written to disk. Passwords and credentials are never accessed.
- **Hardened Loopback Bridge:** The companion Browser Bridge listens strictly on `127.0.0.1`, enforces origin validation, and accepts only media chunks explicitly pushed by the user.

---

## 6. Stories & Ephemeral Content (Instagram & Facebook Stories)

Instagram and Facebook Stories are ephemeral formats with restricted visibility:
1. **Disabled by Default:** Requires explicit opt-in via Settings and acknowledgement of the Terms of Usage modal.
2. **Access Does Not Equal Authorization:** Viewing rights in a personal feed do not confer redistribution rights. Use only for content you authored, public media, or media you have express permission to archive.
3. **Anti-Harassment Protection:** Strictly prohibited for stalking, surveillance, harassment, doxxing, or republishing private communications.
4. **Legal Compliance:** Wiretapping, data privacy, and recording statutes vary by jurisdiction; operators assume full responsibility for local compliance.

---

## 7. Limitation of Liability & Indemnification

**TO THE MAXIMUM EXTENT PERMITTED BY LAW:**

1. **"AS IS" Warranty Disclaimer:** JaneConverter is provided "AS IS" and "AS AVAILABLE", without warranties of merchantability, fitness for a particular purpose, or error-free operation.
2. **User Liability:** Operators assume full, exclusive legal responsibility for their use of the software and any consequences arising from downloading, processing, or distributing content.
3. **Hold Harmless:** The maintainers, authors, and contributors (`project//aspyr`, Jane Cerys) shall not be liable for any direct, indirect, incidental, special, exemplary, or consequential damages (including loss of data, loss of profits, system downtime, or third-party infringement claims) arising from the use or misuse of this software.
4. **Indemnification:** You agree to defend, indemnify, and hold harmless project//aspyr, Jane Cerys, and all contributors from any claims, liabilities, damages, or legal costs arising out of your violation of this policy or applicable laws.

---

## 8. Severability

If any provision of this document is held invalid or unenforceable, that provision shall be enforced to the maximum extent permissible, and all remaining provisions shall continue in full force and effect.
