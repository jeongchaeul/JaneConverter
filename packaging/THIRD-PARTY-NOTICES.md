# Third-Party Software Notices and Licenses

JaneConverter is developed by project//aspyr and distributed under the [MIT License](../LICENSE).

JaneConverter redistributes, bundles, or interfaces with third-party open-source components, libraries, and binaries. Each component is subject to its respective author's license terms as described below.

---

## 1. FFmpeg & FFprobe

- **License:** GNU General Public License (GPL) v3.0 / GNU Lesser General Public License (LGPL) v2.1+
- **Website:** <https://ffmpeg.org/>
- **Source Code:** <https://git.ffmpeg.org/ffmpeg.git>
- **Legal Guide:** <https://www.ffmpeg.org/legal.html>

JaneConverter bundles FFmpeg and FFprobe binaries for media decoding, encoding, muxing, and stream inspection:
- **Windows and Linux:** Built using static GPL builds from BtbN FFmpeg Builds release `autobuild-2026-09-30-13-08` (`ffmpeg-N-127021-ge0c94b2d1c`). Archive SHA-256 digests:
  - Windows x64: `85c4a4636b93d681a07588ffa6f1d8f5c064d9c3fb0622066662906b6fd718a1`
  - Linux x86_64: `3a2a94e704752287833604501a79505c2319ad1d8b2f5577c63f2b1b7a6f2b66`
- **macOS:** Built using `eugeneware/ffmpeg-static` release `b6.1.1`.
- **Packaging Information:** Every release archive contains `FFMPEG-BUILD-INFO.txt` detailing configuration flags, and `FFMPEG-SOURCE-INFO.txt` detailing source revisions and build recipes to fulfill complete corresponding source distribution requirements under the GPL.

---

## 2. yt-dlp & yt-dlp-ejs

- **Component:** yt-dlp
  - **License:** The Unlicense / Public Domain (<https://unlicense.org/>)
  - **Repository:** <https://github.com/yt-dlp/yt-dlp>
- **Component:** yt-dlp-ejs (Embedded JavaScript runtime solver)
  - **License:** MIT License
  - **Repository:** <https://github.com/yt-dlp/ejs>

Runtime solver components are pre-bundled with the frozen application engine to ensure offline deterministic execution without unvetted runtime remote code execution.

---

## 3. SoX Resampler Library (libsoxr)

- **License:** GNU Lesser General Public License (LGPL) v2.1
- **Website:** <https://sourceforge.net/projects/soxr/>

Used within bundled FFmpeg via the `aresample` audio filter to deliver 64-bit float studio-grade audio resampling (`soxr`, precision 28, cutoff 0.97, triangular dither).

---

## 4. Desktop Framework & Native Rust Bridge

- **Tauri Framework (`@tauri-apps/api`, `tauri`, `tauri-plugin-updater`):**
  - **License:** MIT License or Apache License 2.0 (<https://tauri.app/>)
- **Rust Crates:**
  - `serde`, `serde_json`: MIT / Apache-2.0 (<https://serde.rs/>)
  - `rand`: MIT / Apache-2.0
  - `url`: MIT / Apache-2.0
  - `base64`: MIT / Apache-2.0
  - `rfd`: MIT (<https://github.com/PolyMeilex/rfd>)
  - `winreg`: MIT (Windows registry integration)
  - `drag`: MIT / Apache-2.0

---

## 5. Frontend UI Libraries

- **React & React DOM:** MIT License (Copyright © Meta Platforms, Inc.)
- **Lucide Icons (`lucide-react`):** ISC License (Copyright © Lucide Contributors)
- **Framer Motion:** MIT License (Copyright © Framer B.V.)
- **Tailwind CSS:** MIT License (Copyright © Tailwind Labs, Inc.)
- **Vite:** MIT License (Copyright © Evan You & Vite Contributors)

---

## 6. Python Conversion Engine & Runtime Dependencies

- **Pillow:** Historical Permission Notice and Disclaimer (HPND / PIL Software License) (Copyright © Secret Labs AB, Fredrik Lundh, and contributors)
- **Requests:** Apache License 2.0 (Copyright © Kenneth Reitz and contributors)
- **psutil:** BSD 3-Clause License (Copyright © Jay Loden, Dave Daeschler, Giampaolo Rodola)
- **packaging:** Apache License 2.0 / BSD 2-Clause (Copyright © Donald Stufft and individual contributors)
