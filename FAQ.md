# JaneConverter Frequently Asked Questions (FAQ)

> *"JaneConverter is tailored specifically for my personal needs and convenience. But I wanted to share it because it can be useful. I don't have a particular goal, it's just my personal toolbox. If you find it useful, then that's great."*  
> — **Jane Cerys** (`project//aspyr`)

This document cuts straight through corporate PR fluff and answers the most provocative, technical, and controversial questions regarding JaneConverter's architecture, philosophy, and capabilities.

---

### 1. Can I use this to download porn?

**The Unfiltered Truth:** Yes, absolutely.

**The Engineering Logic:** The internet does not know what "porn" is; it only knows data packets. A video on an adult website is hosted on the exact same HTTP/HTTPS servers, packaged in the exact same MP4, WebM, or HLS (`.m3u8`) playlist containers, and streamed using the exact same codecs as an MIT physics lecture on YouTube. JaneConverter does not inspect morality—it inspects containers. If a server transmits video bytes to your screen, JaneConverter reverse-engineers the stream and writes the master file to your disk.

---

### 2. Can I secretly download my crush's Instagram or Facebook stories without showing up on their viewer list?

**The Unfiltered Truth:** If their account is public, yes—they will never know. If their account is private, it depends on whether your browser has already seen it.

**The Engineering Logic:** When you view a story in a normal browser, the platform’s client script fires a telemetry beacon back to their servers logging your user ID to the author's "Seen" list. JaneConverter’s **Story Capturer** bypasses the web UI entirely. For public profiles, it talks directly to platform preloader relays (`reels_media`, `story_card_info`) in 100% anonymous guest mode—sending **zero authentication tokens**. Because the server never receives an account ID, it is physically impossible for Instagram to put you on the viewer list.

> [!WARNING]
> **The Sovereign Liability Defense**  
> Let's be real: people will use tools for whatever they want regardless of terms. JaneConverter is an agnostic piece of local machinery—like a hammer or a network packet sniffer. It holds zero moral agency, stores zero user data, and takes zero blame. **The host operating the binary carries 100% of the ethical, operational, and legal liability for what they choose to aim it at.**

---

### 3. You ask to read my browser cookies. Are you going to drain my crypto wallet, steal my passwords, or hijack my Discord?

**The Unfiltered Truth:** Not a single byte of your private data ever leaves your computer or is written to a file.

**The Engineering Logic:** Most third-party "downloaders" force you to install shady browser extensions that inject malware, or they dump your entire browser profile into unencrypted plaintext `.txt` cookie files on your desktop. JaneConverter does neither:
1. It creates an ephemeral, read-only shadow snapshot of the browser’s SQLite database directly inside RAM.
2. It decrypts only the specific platform domain session token (e.g., `.youtube.com` or `.facebook.com`) using Windows DPAPI.
3. It places the token into a volatile, in-memory `RequestsCookieJar` to satisfy anti-bot challenges (like YouTube's Error 152).
4. The moment the download finishes, the memory buffer is completely zeroed out. Nothing is saved to disk, and there is zero outbound telemetry.

---

### 4. Why the hell is there an FL Studio project downgrader inside a media converter?

**The Unfiltered Truth:** Because JaneConverter is Jane Cerys's personal creator workstation, not a watered-down consumer utility designed to satisfy corporate categorization.

**The Engineering Logic:** In music production, version locking is a manufactured nightmare. When an artist saves an `.flp` project in FL Studio 24 and sends it to a collaborator running FL Studio 20, Image-Line throws a blocking modal: *"This project was saved in a newer version and cannot be opened."* This forces producers to either stall a session, spend hundreds on upgrades, or spend hours manually bouncing audio stems.

**The Binary Reality:** An `.flp` file is a structured binary chunk format. Later versions of FL Studio don’t rebuild the wheel—they simply increment an internal version registration byte in the project header. JaneConverter's downgrader parses the binary event tree, modifies those specific header version bytes down to a target release (like `20.8.4` or `21.0.3`), and writes a new, safe copy. Collaborators open the project immediately, and production continues without interruption.

---

### 5. Does this actually hack Spotify and Apple Music DRM, or is that just marketing BS?

**The Unfiltered Truth:** It doesn't break Widevine DRM—because trying to crack streaming encryption is a cat-and-mouse trap that breaks every two weeks. It uses an architectural workaround that yields higher quality anyway.

**The Engineering Logic:** Spotify and Apple Music stream encrypted, lossy, compressed audio. Instead of ripping degraded sound through a fake virtual soundcard, JaneConverter executes the **Catalog Resolution Pipeline**:
1. It queries official API and oEmbed endpoints to extract canonical metadata: exact song title, main artist, album name, release year, ISRC code, and uncompressed 1400×1400+ album artwork.
2. It strips clutter (like `[Official Music Video]`, `(Remastered 2021)`, or `[Lyric Video]`) to create prioritized search permutations.
3. It probes global studio repositories in parallel, evaluating candidates through Levenshtein string matching and an uncompromising **±15-second duration filter** (which instantly discards live versions, acoustic covers, sped-up TikTok edits, or radio versions).
4. Once mathematically confirmed, it downloads the clean studio master and embeds the pristine metadata and high-res cover art directly into the tags.

---

### 6. A YouTube video was banned or deleted 4 years ago. Can JaneConverter actually bring it back from the dead?

**The Unfiltered Truth:** If a single snapshot of that video was saved in world archival memory, yes.

**The Engineering Logic:** When a video is taken down, normal software immediately throws `Video unavailable` or crashes. When you turn on JaneConverter's **Archival Vault Recovery**, it triggers a 4-stage scientific retrieval ladder:
- **Stage 1 (Filmot & Wayback CDX):** Looks up the raw YouTube ID to resurrect the deleted title, original channel name, description, and running time.
- **Stage 2 (Archive.org Repositories):** Queries the Internet Archive's advanced search across dedicated preservation buckets like `archiveteam_youtube` and `youtube-archive` for direct HTTPS video files.
- **Stage 3 (Ghostarchive Mirrors):** Checks `ghostarchive.org` mirrors for preserved MP4 streams.
- **Stage 4 (Wayback CDX Stream Captures):** Searches the Wayback Machine CDX index for historical `googlevideo.com/videoplayback` chunk captures.
The engine validates the recovered video headers with `ffprobe`, transcodes it, stamps it with historical metadata, and delivers it to your library.

---

### 7. Why do online converters always fail on Facebook albums and Instagram carousels, but this grabs every slide?

**The Unfiltered Truth:** Because online converters use naive static HTTP scrapers, while JaneConverter uses an autonomous headless browser that acts like a human user.

**The Engineering Logic:** Modern social networks are dynamic React single-page applications. They do not load full albums in the HTML source; they hide images behind login gates, dynamic pagination, and anti-scraping traps. JaneConverter launches an isolated headless session that:
1. Detects and programmatically dismisses login modals and dark backdrops.
2. Fires a synthetic 5-stage pointer event sequence (`pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click` + `ArrowRight`) to physically paginate through carousels.
3. Detects image redirects and extracts uncompressed CDN masters, automatically refreshing tokens if Facebook returns an HTTP 403 Forbidden.

---

### 8. Is running this going to fry my GPU or turn my laptop into a jet engine?

**The Unfiltered Truth:** No. For most conversions, your GPU doesn't even have to do any math.

**The Engineering Logic:** If your source video (e.g., a 1080p H.264 stream from YouTube) matches your target format, JaneConverter engages **Stream Copy Mode (`-c copy`)**. It doesn't re-render a single frame or re-encode an audio sample; it simply extracts the raw audio and video packets and remuxes them into your new container. The result? A full-length 4K movie converts in **under 1.5 seconds** with **0% GPU load**.

**The Safety Net:** When transcoding *is* required, it routes through dedicated hardware ASIC chips (NVENC, AMF, QSV, VideoToolbox). If your system runs out of VRAM (e.g., you're rendering 3D or gaming), its Adaptive Engine automatically catches the failure and seamlessly drops down to multi-core CPU encoding without corrupting the file or crashing.

---

### 9. Why does music exported through JaneConverter sound significantly louder and punchier than on other downloaders?

**The Unfiltered Truth:** Because JaneConverter was built by an audio engineer with an 11-year background in production, not a programmer who just learned what FFmpeg is.

**The Engineering Logic:** Raw web rips are notoriously inconsistent: some tracks are recorded at `-22 LUFS` (quiet and muffled), while modern masters are pushed to `-6 LUFS` (heavily clipped). JaneConverter runs audio through a studio-grade DSP chain:
- **EBU R128 Loudness Normalization:** Levels tracks to the broadcast standard of `-14 LUFS`, so your library plays at a consistent volume without ear-splitting jumps.
- **Dynamic True-Peak Limiting:** Uses a two-pass true-peak limiter pegged to `-1.0 dBTP`, completely eliminating the inter-sample DAC clipping distortion that ruins lossy web playback.
- **Harmonic Excitation:** Restores high-frequency air and phase clarity that lossy MP3 compression strips away.

---

### 10. There are no ads, no monthly subscription, and no paywalled features. What's the catch? Are you selling my data?

**The Unfiltered Truth:** There is no catch, no telemetry, and no tracking. You are running local software on your own machine.

**The Sovereign Philosophy:** Corporate SaaS platforms force you onto a $12/month subscription because they have servers to pay for, investors to appease, and a corporate incentive to lock you into their ecosystem. JaneConverter is sovereign, local-first software. It runs entirely on your own CPU and GPU. It doesn't ping an analytics server, it doesn't log your downloads, and it has no shareholders. It exists because its creator wanted an uncompromising studio tool—and if other creators find it useful, they are free to use it.
