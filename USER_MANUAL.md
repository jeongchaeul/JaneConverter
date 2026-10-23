# JaneConverter User Manual

A simple, straightforward guide to getting the most out of JaneConverter.

---

## Table of Contents
1. [What is JaneConverter?](#what-is-janeconverter)
2. [Quick Start: Convert in 3 Steps](#quick-start-convert-in-3-steps)
3. [Downloading Online Media & Social Posts](#downloading-online-media--social-posts)
4. [Using Browser Cookies for Private Media](#using-browser-cookies-for-private-media)
5. [FL Studio (.flp) Project Downgrader](#fl-studio-flp-project-downgrader)
6. [Presets & Format Guide](#presets--format-guide)
7. [Managing Output & Export Library](#managing-output--export-library)
8. [Hardware Acceleration (GPU vs CPU)](#hardware-acceleration-gpu-vs-cpu)
9. [Frequently Asked Questions & Troubleshooting](#frequently-asked-questions--troubleshooting)

---

## What is JaneConverter?

JaneConverter is the sovereign, all-in-one personal creator toolbox of Jane Cerys (project//aspyr). It is explicitly **not just a media converter**—it is a bespoke creator workbench built to solve real-world audio engineering, DAW compatibility, multimedia processing, and media archival problems. Jane adds any tool or feature she needs directly to this suite.
- **Downloading Media:** Grab video, audio, or high-res photos from YouTube, Instagram, Facebook, TikTok, SoundCloud, Pinterest, and Reddit.
- **Transcoding & Converting:** Convert between 15+ audio, video, and image formats with customizable bitrates, resolutions, and loudness normalization.
- **Music Catalog Matching:** Paste Spotify or Apple Music links to automatically locate clean public audio recordings and embed full metadata and album artwork.
- **FL Studio Downgrades:** Downgrade FL Studio project files (`.flp`) so collaborators on older FL Studio versions can open them without version errors.

---

## Quick Start: Convert in 3 Steps

1. **Input Your Media:**
   - **Online Link:** Paste any URL into the input field at the top.
   - **Local File or Folder:** Click **Choose File** or drag and drop any file/folder into the app.
2. **Choose Your Preset or Format:**
   - Use the **Quick Presets** at the top (e.g., *Universal Video*, *Fast MP3*, *Universal Music*, *Lossless Image*).
   - Or click the format pill (e.g., `MP3`, `MP4`, `FLAC`, `PNG`) to select custom settings like bitrate or resolution.
3. **Click Convert:**
   - Click the prominent **Convert** button.
   - Real-time progress is shown on screen. When done, your finished file is ready in your library.

---

## Downloading Online Media & Social Posts

JaneConverter automatically recognizes what kind of link you paste:

### YouTube & YouTube Music
- Works out of the box with zero login required.
- Paste a video or playlist URL. If you want audio only, choose **MP3** or **FLAC**; if you want video, choose **MP4** or **MKV**.

### Instagram Posts, Reels & Multi-Photo Carousels
- Paste any public Instagram post, Reel, or multi-photo carousel link.
- If it's a photo post, JaneConverter fetches all original high-resolution photos in the post and exports them in your chosen format (PNG or JPG).
- If it's a video or Reel, it downloads the full video and audio stream.

### Facebook Albums & Shared Posts
- Supports public Facebook posts, photo albums, videos, and Reels.
- Automatically reads the album title and downloads the full set of pictures at maximum available resolution.

### TikTok, SoundCloud & Pinterest
- **TikTok:** Downloads watermark-free video or extracted audio.
- **SoundCloud:** Grabs high-bitrate audio streams and automatically embeds track tags and artwork.
- **Pinterest:** Downloads full-resolution original pins, boards, and news hub photos.

### Spotify & Apple Music Links
- Spotify and Apple Music are catalog-protected. When you paste a track or playlist link, JaneConverter reads the exact artist, track title, and album metadata, then automatically searches public recordings (YouTube Music / SoundCloud) to fetch and tag the track seamlessly.

---

## Using Browser Cookies for Private Media

### When do you need this?
Public posts download instantly without any browser setup. However, some platforms restrict content:
- Private videos or members-only YouTube channels.
- Friends-only or group-locked Facebook posts and albums.
- Private Instagram accounts you follow.
- Age-restricted media.

### Zero-Extension Setup (Automatic):
JaneConverter can read your logged-in session cookies directly from your installed browsers:
1. Open **Settings** (gear icon in sidebar).
2. Go to **Browser & Sessions**.
3. Enable **Read Browser Cookies**.
4. *(For Edge & Chrome users)*: Enable **Direct Edge & Chrome Cookie Access**.
   - This sets a standard Windows system policy so JaneConverter can read your sessions directly without needing third-party extensions.
5. Select your **Preferred Browser** (e.g. *Vivaldi*, *Edge*, *Chrome*, *Brave*, *Firefox*).
6. That's it! JaneConverter will automatically use your existing login session when needed.

---

## FL Studio (.flp) Project Downgrader

If you collaborate with other producers who use older versions of FL Studio (e.g., FL Studio 20 or 21), opening an `.flp` saved in FL Studio 24 will normally show a blocking warning: *"This project was saved in a newer version."*

### How to Downgrade:
1. Click **FL Studio Tools** in the left sidebar.
2. Click **Browse FLP** and select your project file.
3. Review the project summary (Tempo, PPQ, Channel count, Creation build).
4. Select your **Target FL Studio Version** (e.g. `20.8.4`, `21.0.3`, `21.2.3`).
5. Click **Downgrade Project**.
6. A new file named `<ProjectName>_downgraded.flp` will be created safely without touching your original file.

> [!NOTE]
> Downgrading adjusts project header event IDs so older FL Studio engines can parse the project. Any native plugins or stock effects that only exist in newer versions might not open in older FL Studio releases.

---

## Presets & Format Guide

JaneConverter comes with built-in presets designed for common workflows:

| Preset | Format | Best For | What it Does |
| :--- | :--- | :--- | :--- |
| **Fast MP3** | MP3 | Everyday listening, sample downloads | High-bitrate 320kbps MP3 encoding at maximum speed without volume leveling. |
| **Universal Music** | MP3 | Playlists, Spotify matches, library archiving | 320kbps MP3 with EBU R128 (-14 LUFS) volume normalization and embedded cover art. |
| **Lossless Audio** | FLAC / WAV | Music production, studio masters | Bit-perfect, uncompressed audio preserving 100% of the dynamic range and sample rate. |
| **Universal Video** | MP4 | YouTube, phone/TV playback, social sharing | Standard 1080p Full HD H.264 video with AAC audio for universal hardware playback. |
| **4K Ultra HD** | MP4 / MKV | High-end displays, master recordings | Preserves up to 3840×2160 resolution with high-bitrate video. |
| **Lossless Image** | PNG | Artwork, wallpapers, social photo albums | Full original pixel-for-pixel dimensions with uncompressed clarity. |
| **Compact Image** | JPG / WebP | Web uploads, quick sharing | High-efficiency compression that keeps file sizes small while retaining sharp visuals. |

> [!TIP]
> **Stream Copy Mode:** If your input file format already matches your target format (e.g. converting an MP4 stream to MP4), JaneConverter automatically uses *Stream Copy* (`-c copy`), completing the task in milliseconds with zero quality loss.

---

## Managing Output & Export Library

### Where are files saved?
All converted files are automatically saved into your **JaneConverter Export Library**:
- Converted files are neatly organized by media type and platform:
  - `Export Library/Music/` (MP3, FLAC, WAV, Spotify matches)
  - `Export Library/Video/` (MP4, MKV, WebM)
  - `Export Library/Images/` (PNG, JPG, Instagram albums, Facebook photos)

### Changing the Library Location:
1. Open **Settings** -> **System & Updates**.
2. Click **Change Folder** under **Data Root Folder**.
3. Pick your preferred drive or folder (e.g. `D:\Media\JaneConverter`).
4. JaneConverter will update its storage paths immediately.

---

## Hardware Acceleration (GPU vs CPU)

- **Adaptive GPU Acceleration:** JaneConverter automatically detects NVIDIA NVENC, AMD AMF, Intel QuickSync (QSV), or Apple Silicon VideoToolbox to accelerate video encoding.
- **Multi-Core CPU Fallback:** If your GPU is busy running games/DAWs or does not support a specific codec, the engine automatically falls back to multi-threaded CPU encoding without interrupting your queue.
- You can toggle Hardware Acceleration on or off at any time in **Settings** -> **Hardware & Engine**.

---

## Frequently Asked Questions & Troubleshooting

### Q: Why do I see "Sign in required" or a bot check on a public video?
JaneConverter is updated to bypass public bot challenges automatically. However, if a video is age-restricted or members-only:
1. Go to **Settings** -> **Browser & Sessions**.
2. Make sure **Read Browser Cookies** is enabled.
3. If using Chrome or Edge, enable **Direct Edge & Chrome Cookie Access**.

### Q: An Instagram or Facebook album didn't download all photos.
Make sure the URL is a direct link to the post or album (e.g. `https://www.instagram.com/p/ABC...` or `https://www.facebook.com/media/set/?set=a...`). If the post is restricted to friends or members, ensure you are logged into that platform in your selected browser.

### Q: Can I convert multiple files at once?
Yes! Drag and drop multiple files or an entire folder into the converter. JaneConverter will queue them up and convert them sequentially.

### Q: Where did my downloaded album artwork go?
For audio conversions (MP3, FLAC, M4A), album artwork is embedded directly inside the audio file itself so your music player displays the cover automatically. A separate high-res `.jpg` is also saved next to your file.

---

*JaneConverter is built and maintained by Jane Cerys (`project//aspyr`).*
