# Legal Disclaimer & Acceptable Use Policy

**Last Updated:** October 2026  
**Project:** JaneConverter  
**Maintainer:** project//aspyr (Jane Cerys)  

---

## 1. Authorized & Intended Use

JaneConverter is an open-source, local media transcoding utility and conversion engine designed exclusively for:

1. **Personal, Non-Commercial Media Processing:** Converting, format-shifting, and archiving digital media that you personally own, have created, or hold an express legal license or permission to process.
2. **Fair Use & Educational Research:** Lawful format adaptation, media inspection, and time-shifting permitted under applicable fair use, fair dealing, or statutory copyright exemptions in your jurisdiction.
3. **Audio Engineering & Project Interoperability:** Inspecting, debugging, and format-adapting user-owned digital audio workstation (DAW) project files (e.g., Image-Line FL Studio `.flp` files) across different installed software versions.

**You are strictly prohibited from using JaneConverter to infringe upon copyrights, violate intellectual property rights, distribute unauthorized digital copies, or violate the Terms of Service of any third-party content platform.**

---

## 2. Anti-Circumvention Declaration (DMCA Section 1201 Compliance)

JaneConverter strictly abides by Section 1201 of the United States Digital Millennium Copyright Act (17 U.S.C. § 1201), the European Union Information Society Directive (2001/29/EC), and equivalent international copyright and anti-circumvention statutes:

- **No DRM Decryption or Circumvention:** JaneConverter does **not** bypass, decrypt, circumvent, defeat, or disable any technological protection measures (TPM) or Digital Rights Management (DRM) technologies, including but not limited to Google Widevine, Apple FairPlay, Microsoft PlayReady, or ClearKey encryption.
- **No Access-Control Cracking:** JaneConverter contains no code, cryptographic keys, secret algorithms, or decryption tables capable of unlocking encrypted streams or circumventing paywalls. Any media stream protected by DRM or encryption cannot be processed by this software and will fail or be rejected.
- **Reliance on Public or Explicitly Authorized Streams:** Online retrieval mechanisms (powered by yt-dlp and guest HTTP inspection) interact solely with publicly accessible streams or streams explicitly served to the user's active, authenticated browser session with user consent.

---

## 3. Third-Party Trademarks & Independence

All product names, logos, brands, trademarks, and registered trademarks referenced within JaneConverter, its documentation, or its graphical interface are the property of their respective owners.

- **Platform Independence:** YouTube, Spotify, Apple Music, SoundCloud, TikTok, Instagram, Facebook, X (formerly Twitter), Reddit, Tumblr, Pinterest, Twitch, Vimeo, Rumble, and Discord are trademarks or registered trademarks of their respective corporate holders.
- **Software Independence:** "FL Studio" and "Image-Line" are trademarks and registered trademarks of Image-Line Software NV.
- **No Affiliation or Endorsement:** project//aspyr and JaneConverter are completely independent open-source initiatives. Reference to any third-party trademark, service, or DAW is solely for identification, interoperability, and nominative descriptive purposes. Neither project//aspyr nor JaneConverter is affiliated with, associated with, sponsored by, or endorsed by any of the aforementioned companies or their subsidiaries.

---

## 4. FL Studio (.flp) Project File Interoperability

The FL Studio project downgrading and inspection capabilities included in JaneConverter are independent, clean-room implementations of public and reverse-engineered binary chunk specifications:

- This tool operates solely on file metadata, header identifiers, and event chunks of user-supplied `.flp` project files.
- It does **not** modify, hook, patch, crack, or decompile any executable or dynamic library (`.exe`, `.dll`, `.dylib`, or `.so`) of FL Studio or Image-Line software.
- It does **not** bypass or tamper with DAW license verification, registration dialogs, or copy-protection mechanisms.
- Its sole intended purpose is format interoperability, enabling music producers and audio engineers to open their own project files on older workstation releases.

---

## 5. Privacy, Air-Gapping & Local Processing

To ensure complete user privacy and operational security:

- **100% Local Conversion:** All audio transcoding (FFmpeg, SoX), video processing, image conversion (Pillow), and FLP patching run locally on your host machine.
- **Zero Telemetry:** JaneConverter transmits no user tracking, analytics, media habits, filenames, or conversion history to any remote server or third party.
- **Ephemeral Session Security:** When the user opts into sandboxed session recovery, session cookies are held strictly in temporary volatile memory for the duration of the active job, are filtered to strip unrelated domains, and are purged immediately upon job completion. No credentials or passwords are ever requested, recorded, or written to disk.
- **Air-Gapped Loopback Bridge:** The optional Browser Bridge listens exclusively on `127.0.0.1` (localhost), rejects non-extension origins, enforces bounded payload limits, and accepts only media chunks explicitly selected and pushed by the user.

---

## 6. Limitation of Liability & Indemnification

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:**

1. **"AS IS" Provision:** JaneConverter is provided "AS IS" and "AS AVAILABLE", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, non-infringement, quiet enjoyment, or error-free operation.
2. **User Liability:** You, as the end user, assume full and exclusive legal responsibility for your use of JaneConverter and any consequences arising from downloading, transcoding, caching, or distributing content processed through the software.
3. **Hold Harmless:** In no event shall the authors, maintainers, contributors, or copyright holders of JaneConverter (`project//aspyr`, Jane Cerys) be liable for any direct, indirect, incidental, special, exemplary, punitive, or consequential damages (including, but not limited to, loss of data, loss of profits, system interruption, or claims of copyright infringement asserted by third parties) arising in any way out of the installation, operation, or misuse of this software.
4. **Indemnification:** You agree to defend, indemnify, and hold harmless project//aspyr, Jane Cerys, and all contributors from and against any claims, liabilities, damages, judgments, awards, losses, costs, expenses, or legal fees arising out of or relating to your violation of this Acceptable Use Policy or any applicable laws.

---

## 7. Governing Principles & Severability

If any provision of this document is found by a court of competent jurisdiction to be invalid, illegal, or unenforceable, that provision shall be enforced to the maximum extent permissible so as to effect the intent of this policy, and the remaining provisions shall continue in full force and effect.
