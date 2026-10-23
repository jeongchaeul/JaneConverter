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

## 2. DRM, Access Controls & Platform Terms

**What JaneConverter does not do:**
- **No DRM Decryption:** JaneConverter does **not** bypass, decrypt, circumvent, defeat, or disable any Digital Rights Management (DRM) or technological protection measures, including Google Widevine, Apple FairPlay, Microsoft PlayReady, or ClearKey encryption. Media streams protected by DRM cannot be decrypted and will fail.
- **No DRM Keys or Extraction Logic:** JaneConverter contains no DRM keys, key-extraction code, proprietary decryption algorithms, or decryption tables.
- **No Password Cracking or Impersonation:** JaneConverter does not guess passwords, harvest credentials, or authenticate as anyone other than the local user.

**What JaneConverter does:**
- JaneConverter retrieves media that is accessible to you, either as a public guest on the open web or, if you explicitly opt in, through your own signed-in browser session.
- When encountering HTTP errors, bot challenges, or rate limits, the engine may retry requests using alternate standard browser headers or extraction methods available within yt-dlp and its companion extractors.

**Platform Terms and User Responsibility:**
Many online platforms restrict or prohibit automated downloading, scraping, or caching in their Terms of Service. Using JaneConverter may constitute a breach of those terms, and platforms may restrict, rate-limit, or suspend your account or IP address. Whether automated retrieval constitutes circumvention of access controls under statutes such as 17 U.S.C. § 1201 or international equivalents depends on the specific facts and jurisdiction. This document does not constitute legal advice; you are solely responsible for ensuring your use complies with applicable laws and contracts.

---

## 3. Third-Party Trademarks & Independence

All product names, logos, brands, trademarks, and registered trademarks referenced within JaneConverter, its documentation, or its graphical interface are the property of their respective owners.

- **Platform Independence:** YouTube, Spotify, Apple Music, SoundCloud, TikTok, Instagram, Facebook, X (formerly Twitter), Reddit, Tumblr, Pinterest, Twitch, Vimeo, Rumble, and Discord are trademarks or registered trademarks of their respective corporate holders.
- **Software Independence:** "FL Studio" and "Image-Line" are trademarks and registered trademarks of Image-Line Software NV.
- **No Affiliation or Endorsement:** project//aspyr and JaneConverter are completely independent open-source initiatives. Reference to any third-party trademark, service, or DAW is solely for identification, interoperability, and nominative descriptive purposes. Neither project//aspyr nor JaneConverter is affiliated with, associated with, sponsored by, or endorsed by any of the aforementioned companies or their subsidiaries.

---

## 4. FL Studio (.flp) Project File Interoperability

The FL Studio project downgrading and inspection capabilities included in JaneConverter are independent implementations of public and reverse-engineered binary chunk specifications:

- This tool operates solely on file metadata, header identifiers, and event chunks of user-supplied `.flp` project files.
- It does **not** modify, hook, patch, crack, or decompile any executable or dynamic library (`.exe`, `.dll`, `.dylib`, or `.so`) of FL Studio or Image-Line software.
- It does **not** bypass or tamper with DAW license verification, registration dialogs, or copy-protection mechanisms.
- Its sole intended purpose is format interoperability, enabling music producers and audio engineers to open their own project files on older workstation releases.

---

## 5. Privacy, Local Processing & Security

To ensure complete user privacy and operational security:

- **100% Local Conversion:** All audio transcoding (FFmpeg, SoX), video processing, image conversion (Pillow), and FLP patching run locally on your host machine.
- **Zero Telemetry:** JaneConverter transmits no user tracking, analytics, media habits, filenames, or conversion history to any remote server or third party.
- **Ephemeral Session Security:** When the user opts into session recovery, session cookies for the target domain are temporarily copied and held in volatile memory for the active job, and the temporary database copy is deleted immediately upon job completion or abort. No passwords or credentials are ever requested or stored.
- **Local Loopback Bridge:** The optional Browser Bridge listens exclusively on `127.0.0.1` (localhost), rejects non-extension origins, enforces bounded payload limits, and accepts only media chunks explicitly selected and pushed by the user.

---

## 6. Stories & Audience-Restricted Content (Instagram & Facebook Stories)

Instagram and Facebook Stories are ephemeral formats designed to expire within 24 hours, often shared with limited audiences (such as Close Friends or Friends Only lists). Creators hold explicit expectations of temporary and restricted visibility.

1. **Disabled by Default:** Story capture is disabled by default and requires explicit affirmative user opt-in in Settings. It relies on your signed-in browser session (see Session & Cookie Handling).
2. **Access Does Not Equal Authorization:** Having technical access to view a story in your personal feed does not automatically grant you the legal right to download, archive, or distribute it. Use this capability only for stories you authored, public content, or content where you have the creator's express permission.
3. **Anti-Harassment & Privacy Protection:** You may never use JaneConverter to stalk, harass, surveil, dox, blackmail, or republish someone's personal or ephemeral media.
4. **Legal Compliance:** Privacy, wiretapping, and data protection laws in many jurisdictions restrict recording or archiving private communications without consent. You assume full legal responsibility for following the laws applicable in your jurisdiction.
5. **Platform Account Risk:** Automated access to story endpoints carries elevated risk of platform abuse detection, which may result in account restrictions or bans.

---

## 7. Limitation of Liability & Indemnification

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:**

1. **"AS IS" Provision:** JaneConverter is provided "AS IS" and "AS AVAILABLE", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, non-infringement, quiet enjoyment, or error-free operation.
2. **User Liability:** You, as the end user, assume full and exclusive legal responsibility for your use of JaneConverter and any consequences arising from downloading, transcoding, caching, or distributing content processed through the software.
3. **Hold Harmless:** In no event shall the authors, maintainers, contributors, or copyright holders of JaneConverter (`project//aspyr`, Jane Cerys) be liable for any direct, indirect, incidental, special, exemplary, punitive, or consequential damages (including, but not limited to, loss of data, loss of profits, system interruption, or claims of copyright infringement asserted by third parties) arising in any way out of the installation, operation, or misuse of this software.
4. **Indemnification:** You agree to defend, indemnify, and hold harmless project//aspyr, Jane Cerys, and all contributors from and against any claims, liabilities, damages, judgments, awards, losses, costs, expenses, or legal fees arising out of or relating to your violation of this Acceptable Use Policy or any applicable laws.

---

## 8. Governing Principles & Severability

If any provision of this document is found by a court of competent jurisdiction to be invalid, illegal, or unenforceable, that provision shall be enforced to the maximum extent permissible so as to effect the intent of this policy, and the remaining provisions shall continue in full force and effect.
