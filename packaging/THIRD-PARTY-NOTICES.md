# Third-party notices

JaneConverter is distributed under the MIT License in `LICENSE`.

## FFmpeg and FFprobe

JaneConverter bundles FFmpeg and FFprobe. The Windows and Linux release workflows use the static GPL build from the BtbN FFmpeg Builds release `autobuild-2026-09-30-13-08` (`ffmpeg-N-127021-ge0c94b2d1c`). The committed archive SHA-256 values are Windows `85c4a4636b93d681a07588ffa6f1d8f5c064d9c3fb0622066662906b6fd718a1` and Linux `3a2a94e704752287833604501a79505c2319ad1d8b2f5577c63f2b1b7a6f2b66`. The macOS release workflows use the `b6.1.1` binaries from `eugeneware/ffmpeg-static`. Each package includes `FFMPEG-BUILD-INFO.txt` with the actual binary version and configure output.

- BtbN build release and build sources: <https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08>
- eugeneware FFmpeg static release: <https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1>
- FFmpeg source repository: <https://git.ffmpeg.org/ffmpeg.git>
- FFmpeg licensing and source-distribution guidance: <https://www.ffmpeg.org/legal.html>

The selected binaries include GPL-enabled FFmpeg builds. FFmpeg's enabled external libraries can add their own license terms. Each package includes `FFMPEG-SOURCE-INFO.txt` with the pinned FFmpeg source revision and provider build reference, plus `FFMPEG-BUILD-INFO.txt` with the binary configuration. Release operators must still archive or publish the complete corresponding source for the exact FFmpeg build and enabled external libraries with applicable notices before redistributing the binaries. The source index and build record help identify the inputs; they do not replace the corresponding source or a review of the licenses for enabled components.

## yt-dlp and EJS

JaneConverter packages `yt-dlp` and its `yt-dlp-ejs` solver dependency in the Python engine. Their upstream projects and license files are available at <https://github.com/yt-dlp/yt-dlp> and <https://github.com/yt-dlp/ejs>. Runtime solver code is installed with the application instead of fetched from a remote source during media retrieval.

Other bundled Python, JavaScript, Rust, and desktop dependencies can carry additional license terms. Release operators should preserve and review the license files from each exact dependency distribution.
