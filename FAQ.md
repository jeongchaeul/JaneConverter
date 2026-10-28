# JaneConverter Frequently Asked Questions (FAQ)

> *"JaneConverter is tailored specifically for my personal needs and convenience. But I wanted to share it because it can be useful. I don't have a particular goal, it's just my personal toolbox. If you find it useful, then that's great."*  
> — **Jane Cerys** (`project//aspyr`)

Straightforward, technical answers to common questions regarding JaneConverter's architecture, philosophy, and capabilities.

---

### 1. Can I use this to download adult / 18+ content?

**Direct Answer:** Yes.

**Engineering Logic:** Network transport does not inspect moral categories; it inspects protocols and containers. Media on adult sites is delivered over HTTP/HTTPS in standard MP4, WebM, HLS (`.m3u8`), or DASH manifests using standard codecs (H.264, VP9, AV1, AAC). JaneConverter inspects container streams and extracts original media to disk regardless of domain category.

---

### 2. Can I view Instagram or Facebook stories without appearing on the viewer list?

**Direct Answer:** For public profiles, yes. For private accounts, it depends on whether your browser already viewed the story.

**Engineering Logic:** Standard browsers notify servers via telemetry beacons when a story is rendered in the UI, adding your account ID to the author's viewer list. JaneConverter's **Story Capturer** bypasses the web UI entirely. For public profiles, it queries platform preloader endpoints (`xdt_api__v1__feed__reels_media`, `story_card_info`) in anonymous guest mode with zero authentication tokens, making it technically impossible for the server to log a user identity.

> [!WARNING]
> **Operator Liability:** JaneConverter is a neutral, local software utility. It stores no user data and exercises no moral agency. Operators carry 100% of the legal, ethical, and operational liability for how they use the tool and what content they capture.

---

### 3. Does reading browser cookies expose passwords, cryptocurrency wallets, or session tokens?

**Direct Answer:** No. Zero credentials or unrelated private data leave your computer or touch persistent storage.

**Engineering Logic:** Standard downloaders often rely on third-party browser extensions or unencrypted `.txt` cookie dumps. JaneConverter operates defensively:
1. Creates an ephemeral, read-only shadow snapshot of the browser's SQLite database directly in RAM to avoid file-locking conflicts.
2. Decrypts only domain-specific session cookies for the active request (e.g. `.youtube.com`) using Windows DPAPI.
3. Holds tokens exclusively in an in-memory `RequestsCookieJar` to clear bot challenges (such as YouTube Error 152).
4. Zeroes out the memory buffer immediately upon job completion. No passwords, wallets, or browsing histories are accessed, logged, or transmitted.

---

### 4. Why is an FL Studio project downgrader included in a media converter?

**Direct Answer:** Because JaneConverter is Jane Cerys's sovereign creator toolbox, not a single-purpose consumer utility.

**Engineering Logic:** In audio production, newer FL Studio releases (e.g. FL 24 or 21.2) block older engines (e.g. FL 20.8) with error modals: *"This project was saved in a newer version and cannot be opened."* An `.flp` project is a binary event stream; newer releases primarily update header registration bytes. JaneConverter parses the binary event tree, retargets the version bytes to a selected legacy release (`20.8.4`, `21.0.3`, `21.2.3`), and writes a safe new copy (`_downgraded.flp`) so collaborators can work across versions without freezing production.

---

### 5. Does this crack Spotify or Apple Music DRM?

**Direct Answer:** No. It matches metadata against public high-fidelity studio recordings.

**Engineering Logic:** Rather than attempting to bypass Widevine DRM (which degrades audio into lossy re-recordings and breaks frequently), JaneConverter runs a **Catalog Resolution Pipeline**:
1. Fetches official track metadata, ISRC codes, and 1400×1400+ artwork via oEmbed and official APIs.
2. Cleans titles of noise tags (`[Official Video]`, `(Remastered)`, etc.).
3. Queries YouTube Music and SoundCloud in parallel, verifying matches via Levenshtein title distance, artist tokens, and an uncompromising **±15-second duration variance filter** to discard covers, live takes, or edits.
4. Downloads the verified studio audio and embeds canonical tags and cover art.

---

### 6. Can JaneConverter recover deleted or taken-down YouTube videos?

**Direct Answer:** Yes, if any snapshot or mirror exists in global archival repositories.

**Engineering Logic:** When a video returns `Video unavailable`, enabling **Archival Vault Recovery** initiates a 4-stage scientific retrieval ladder:
- **Stage 1 (Filmot & Wayback CDX):** Recovers original metadata (title, channel, upload date, description).
- **Stage 2 (Archive.org Collections):** Queries `archiveteam_youtube` and `youtube-archive` repositories for direct media streams.
- **Stage 3 (Ghostarchive Mirrors):** Checks `ghostarchive.org` mirrors for preserved copies.
- **Stage 4 (Wayback CDX Stream Captures):** Searches the Wayback Machine CDX index for historical `googlevideo.com/videoplayback` segments.
Recovered media is validated via `ffprobe`, transcoded, stamped with metadata, and placed in your library.

---

### 7. Why does JaneConverter successfully capture multi-image carousels and albums that other downloaders fail on?

**Direct Answer:** It navigates dynamic single-page web applications using an autonomous headless browser rather than naive static HTML scraping.

**Engineering Logic:** Platforms like Facebook and Instagram hide full photo collections behind dynamic pagination, modal backdrops, and login prompts. JaneConverter launches an isolated headless session that:
1. Dismisses login modals and restores page scrollability.
2. Synthesizes full 5-stage pointer event sequences (`pointerdown` &rarr; `mousedown` &rarr; `pointerup` &rarr; `mouseup` &rarr; `click` + `ArrowRight`) to cycle through carousel slides.
3. Dynamically falls back to grid scraping if redirected, and refreshes CDN tokens on HTTP 403.

---

### 8. Will transcoding overheat my hardware or consume excessive system resources?

**Direct Answer:** No. Most conversions use zero CPU/GPU re-encoding effort.

**Engineering Logic:** When source and target codecs match (e.g. H.264 + AAC in an MP4 container) with no audio filters or scaling requested, JaneConverter activates **Stream Copy Mode (`-c copy`)**, remuxing streams at the container level in under 2 seconds with **0% transcoding load**. When re-encoding is necessary, it uses dedicated hardware chips (NVENC, AMF, QSV, VideoToolbox). If GPU memory runs out, it automatically fails over to multi-core CPU software encoding without crashing.

---

### 9. Why does audio exported through JaneConverter sound more consistent and balanced?

**Direct Answer:** Audio is processed through an automated studio mastering chain rather than raw, unadjusted stream dumps.

**Engineering Logic:** Raw web audio varies wildly from `-22 LUFS` (quiet) to `-6 LUFS` (severely clipped). JaneConverter applies professional DSP:
- **EBU R128 Loudness Normalization:** Levels tracks to `-14 LUFS` for uniform listening volume.
- **True-Peak Limiting:** Two-pass dynamic limiting pegged to `-1.0 dBTP` prevents inter-sample DAC distortion on playback.
- **Harmonic Exciter:** Restores high-frequency air and presence lost during lossy web compression.

---

### 10. There are no ads, subscriptions, or paywalls. Is my data being collected or sold?

**Direct Answer:** No. The software is 100% local and has zero telemetry.

**Engineering Logic:** Commercial SaaS platforms charge subscriptions to fund servers, marketing, and investor returns. JaneConverter is personal open-source software running locally on your own machine. It makes zero analytics calls, stores no telemetry, and transmits nothing to external servers. It was built by a creator to solve real studio bottlenecks, and is shared openly for anyone who finds it useful.
