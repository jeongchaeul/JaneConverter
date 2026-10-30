# Legal Handbook, Acceptable Use Policy & Comprehensive Disclaimer

**Last Updated:** October 2026  
**Project:** JaneConverter  
**Maintainer:** project//aspyr (Jane Cerys)  

---

## 🏛️ Preamble & Sovereign Scope

JaneConverter is an open-source local media transcoding, format-shifting, and studio workflow toolbox engineered by Jane Cerys (`project//aspyr`) for personal creative utility and shared publicly under the MIT License. 

JaneConverter is distributed strictly as a **local format-shifting tool, personal digital archive assistant, and audio workstation utility**. It is not designed, marketed, or licensed for copyright infringement, commercial media distribution, unauthorized data mining, stalking, privacy invasion, or technological security circumvention. 

> [!CRITICAL]
> ### 🛑 STRICT PROHIBITION ON ILLEGAL USE & TOTAL CONTRIBUTOR IMMUNITY
> **JaneConverter explicitly advises and strictly forbids any use of this software for unlawful, infringing, or tortious purposes.** 
> 
> As a neutral, dual-use local utility (analogous to a command-line HTTP client, an audio editor, or a web browser), the software has zero telemetric control over how an individual operates it locally. **The individual or host running JaneConverter assumes 100% full, exclusive, and unreserved civil, statutory, and criminal liability for every action they perform and every byte they process.**
> 
> **Under no legal theory shall the creator (Jane Cerys), project//aspyr, or any project contributor be held liable, accountable, or legally responsible for any illegal, unauthorized, infringing, or prohibited conduct committed by end users.**

By downloading, installing, compiling, or executing JaneConverter (via desktop UI, CLI, or API), you agree unconditionally to the terms, limitations, and statutory boundaries set forth in this Handbook. If you do not agree, you must immediately cease all use of this software.

---

## 1. Authorized & Lawful Intended Use

JaneConverter is intended exclusively for the following lawful applications:

1. **Personal Media Format-Shifting & Archival:** Transcoding, formatting, and locally backing up digital audio, video, and image assets that you personally created, hold title to, or hold express authorization from the rights holder to archive.
2. **Fair Use, Fair Dealing & Educational Research:** Lawful format conversion, media inspection, sampling, commentary, scholarship, and time-shifting permitted under Section 107 of the U.S. Copyright Act (17 U.S.C. § 107), the fair dealing doctrines of common-law jurisdictions, or statutory private-copying exemptions in your territory.
3. **Studio DAW Interoperability:** Inspecting, debugging, converting, and format-adapting user-owned digital audio workstation (DAW) project files (e.g., Image-Line FL Studio `.flp` files and Ableton Live `.als` files) across different installed software versions and collaborative studio environments.

> [!CAUTION]
> Using JaneConverter to infringe copyrights, distribute unauthorized copies, bypass access restrictions, harass individuals, or violate third-party Terms of Service is strictly prohibited.

---

## 2. Digital Rights Management (DRM) & Technological Protection

JaneConverter strictly respects technical access controls and technological protection measures:

### What JaneConverter Does NOT Do:
- **Zero DRM Decryption:** JaneConverter does **not** bypass, decrypt, circumvent, defeat, or disable Digital Rights Management (DRM) or technological access controls. This includes, without limitation, Google Widevine, Apple FairPlay, Microsoft PlayReady, ClearKey, or Adobe Primetime encryption.
- **No Decryption Keys or Proprietary Logic:** The software contains no DRM decryption keys, key-derivation algorithms, unauthorized cryptographic tables, or reverse-engineered DRM binaries. Encrypted or DRM-protected streams are mathematically undecryptable and rejected.
- **No Credential Theft or Account Hijacking:** JaneConverter does not harvest passwords, bypass two-factor authentication, forge login credentials, or spoof foreign identity sessions.

### What JaneConverter Does:
- Retrieves media assets that are either:
  1. Openly accessible on the public Internet without login barriers (guest mode); or
  2. Accessible through your own authenticated desktop browser session upon your explicit local opt-in.
- Uses public, non-encrypted HTTP/HTTPS transport streams, standard browser user-agent headers, and open media delivery endpoints.

Operators assume sole and exclusive legal liability under the Digital Millennium Copyright Act (17 U.S.C. § 1201), the WIPO Copyright Treaty (WCT), and applicable international anti-circumvention statutes.

---

## 3. Platform Terms, Guest Routing & Browser Session Access

1. **Guest vs. Authenticated Access:** When using guest extraction, JaneConverter interacts only with publicly broadcast resources. When opt-in browser session extraction is enabled, JaneConverter duplicates local, ephemeral browser cookies solely to retrieve content your existing personal account is already granted authorization to view.
2. **Contractual Terms of Service:** Many online platforms (including YouTube, Meta, TikTok, Instagram, X/Twitter, and Pinterest) maintain Terms of Service that restrict automated scraping or programmatic retrieval. 
3. **Operator Assumption of Risk:** The operator is solely responsible for evaluating platform contractual terms. The maintainers of JaneConverter accept zero responsibility for account suspensions, IP rate limits, API bans, or legal claims resulting from platform policy enforcement.

---

## 4. Bulk Archival, Photo Albums & Social Media Collections

JaneConverter includes capabilities to extract multi-photo galleries, carousel posts, collection boards, and large photo albums (e.g., Facebook albums, Pinterest boards, TikTok photo slideshows, Instagram carousels, and X/Twitter galleries).

### Lawful Purpose:
Bulk photo extraction is provided solely for **personal media preservation, creative reference, and personal offline backup of publicly shared content**.

### Strict Behavioral & Privacy Boundaries:
1. **No Circumvention of Audience Boundaries:** Operators must never use bulk extraction tools to scrape or aggregate content from private profiles, restricted groups, or audience-gated collections to which the operator has not been granted authorized access.
2. **Absolute Ban on Surveillance, Stalking & Doxxing:** It is strictly forbidden to use JaneConverter for surveillance, stalking, non-consensual personal monitoring, doxxing, harassment, or aggregating images of individuals to invade their privacy.
3. **Biometric & Facial Recognition Prohibition:** You agree not to use extracted albums or bulk photo collections to build, train, fine-tune, or populate facial recognition models, biometric tracking databases, or unauthorized AI surveillance datasets without the explicit, written, verifiable consent of every depicted subject.
4. **Commercial Redistribution Prohibited:** Downloading public images confers no commercial rights, licensing, or ownership. Public visibility does not equate to public domain.

---

## 5. Digital Audio Workstation (.flp & .als) Studio Interoperability

The FL Studio project downgrading and Ableton Live project conversion utilities are independent implementations of binary chunk and XML structure parsing:

1. **Metadata & Event Chunks Only:** Operates exclusively on file metadata, header identifiers, track arrangements, and event chunks of user-supplied `.flp` and `.als` project files.
2. **No Binary Patching or DAW Modification:** JaneConverter does **not** hook, patch, crack, modify, or decompile any executable or dynamic link library (`.exe`, `.dll`, `.dylib`, `.so`) of FL Studio, Ableton Live, or any third-party VST/AU plugin.
3. **No License Circumvention:** Does not bypass DAW registration dialogs, software trial limitations, or copy protection dongles.
4. **Interoperability Purpose:** Solely intended to enable music producers, audio engineers, and collaborators to open their own arrangements across different workstation revisions without artificial cross-version lockouts.

---

## 6. Ephemeral Stories & Temporary Media (Instagram & Facebook Stories)

Instagram Stories and Facebook Stories are ephemeral formats intentionally designed by creators and platforms with an explicit expectation of temporary (24-hour) availability.

### Mandatory Compliance Protocol:
1. **Disabled by Default:** Ephemeral story extraction is locked and disabled by default. It can only be activated by an affirmative, explicit opt-in in the desktop UI Settings or via the CLI flag (`--allow-ephemeral-stories`).
2. **Public vs. Audience-Restricted Content:** While public stories are broadcast openly, **audience-restricted stories** (e.g., Instagram *Close Friends*, Facebook *Friends Only*) constitute private, confidential electronic communications. Extracting, archiving, or disseminating restricted stories without the express knowledge and written consent of the creator is strictly prohibited.
3. **Statutory Legal Protections:** Processing, recording, or redistributing ephemeral media without consent may trigger serious civil and criminal penalties under:
   - **Republic Act No. 10173** (Data Privacy Act of 2012, Philippines)
   - **Republic Act No. 9995** (Anti-Photo and Video Voyeurism Act of 2009, Philippines)
   - **Regulation (EU) 2016/679** (General Data Protection Regulation / GDPR, Articles 6 & 9)
   - **18 U.S.C. § 2701 et seq.** (Stored Communications Act, United States)
   - Local state and national wiretapping, electronic eavesdropping, and privacy legislation.
4. **Affirmation of Ownership:** By enabling story extraction, the operator legally warrants that they are the original author of the content or hold explicit authorization from the author to perform the extraction.

---

## 7. Privacy, Zero Telemetry & Local Data Sovereignty

1. **100% Local Execution:** JaneConverter operates entirely locally on your host hardware. All media decoding, transcoding, metadata embedding, and file operations execute directly within your local operating system environment.
2. **Zero Remote Telemetry:** The application contains zero telemetry trackers, tracking beacons, user analytics, device fingerprinting, or external phoning-home logic.
3. **Volatile Session Security:** Browser session cookies utilized for authenticated extraction are held in volatile runtime memory only. They are never written to disk, never logged, and never transmitted to any third-party server or maintainer endpoint. (See [SECURITY.md](SECURITY.md) for technical auditing details).

---

## 8. Third-Party Trademarks & Independence

All trademarks, service marks, trade names, and product names cited in JaneConverter, its source code, or documentation belong strictly to their respective owners:
- **Platforms:** YouTube, Meta, Facebook, Instagram, Spotify, Apple Music, SoundCloud, TikTok, X (formerly Twitter), Reddit, Tumblr, Pinterest, Discord, and Twitch are trademarks of their respective corporate holders.
- **Software:** "FL Studio" and "Image-Line" are registered trademarks of Image-Line Software NV. "Ableton" and "Ableton Live" are registered trademarks of Ableton AG.
- **Nominative Fair Use:** References to third-party platforms or software products are made strictly for identification, format compatibility, and nominative descriptive purposes. Such references do not imply affiliation, sponsorship, endorsement, or approval by the respective trademark owners.

---

## 9. Neutral Tool Doctrine, Contributor Immunity & Full Operator Indemnification

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:**

1. **The Neutral Dual-Use Tool Doctrine:** Like a command-line network utility (`curl`), a generic media framework (`ffmpeg`), an operating system terminal, or a physical recording device, JaneConverter is a neutral, multi-purpose software utility created solely for lawful media manipulation, studio file compatibility, and personal data preservation. Because JaneConverter runs 100% locally and offline without telemetric intervention, the maintainers possess no technical ability to supervise, moderate, intercept, or restrict how individual users operate the software.
2. **Express Warning & Absolute Condemnation of Unlawful Use:** JaneConverter explicitly, unequivocally, and repeatedly advises and commands users **NOT** to use this software for any illegal, copyright-infringing, privacy-invasive, harassing, or tortious purpose. The maintainers categorically condemn any unlawful utilization of this utility.
3. **100% Sole Operator Liability:** The person, entity, or automated host invoking JaneConverter assumes **100% full, exclusive, personal, and unreserved legal, civil, regulatory, and criminal liability** for all media streams targeted, URLs supplied, files downloaded, format transformations executed, and any subsequent dissemination, publication, or commercial exploitation.
4. **Complete Contributor Immunity & Hold Harmless:** Under no legal doctrine—whether contributory infringement, secondary liability, vicarious liability, inducement, enterprise liability, negligence, or strict liability—shall the author and maintainer (**Jane Cerys / project//aspyr**) or any software contributor be held legally liable for the independent, unauthorized actions of third-party users. You hereby release and covenant never to sue the creators or contributors for any direct, indirect, incidental, special, punitive, or consequential damages arising from the use or misuse of this tool.
5. **Full Defense & Indemnification:** You agree to unconditionally defend, indemnify, and hold harmless Jane Cerys, `project//aspyr`, and all project contributors from and against any third-party claims, lawsuits, damages, regulatory penalties, fines, or legal expenses (including full attorney's fees) arising out of or related to your operation of JaneConverter or your violation of any law, third-party intellectual property right, or platform agreement.

---

## 10. Severability & Legal Enforceability

If any provision, section, or clause of this Handbook is held to be unlawful, invalid, or unenforceable under applicable law:
1. Such provision shall be enforced to the maximum extent permissible so as to give effect to the intent of this policy; and
2. The invalidity or unenforceability of such provision shall not affect the validity or enforceability of any other provision, and all remaining sections shall continue in full force and legal effect.
