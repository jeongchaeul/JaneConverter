# Signed desktop updates

The desktop updater downloads signed application packages from the rolling GitHub release named `continuous`. A push to `main` starts native Windows x64, Linux x86_64, macOS Apple Silicon, and macOS Intel builds. The workflow publishes a new feed only after every platform package and signature is present. The app compares its embedded build number and commit with the feed; the visible **Update now** button still requires the user to approve installation.

The engine version in `src/janeconverter/version.py` does not change for ordinary commits. CI adds a monotonically increasing build number and the full Git commit as SemVer build metadata, then validates that the feed's commit matches that metadata. The feed includes all four platform entries because Tauri validates the complete static manifest before selecting the current platform.

## One-time GitHub configuration

1. From `desktop-ui`, run `npx tauri signer generate -w <private-key-path>` and choose a secure path outside the repository. Keep the private key and its backup private. Do not rotate or lose it while existing updater-enabled installations are in use.
2. Add the generated public key as the GitHub repository variable `JANECONVERTER_UPDATER_PUBKEY`.
3. Add the private key contents as the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`. If the key is password protected, also add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. To bootstrap an existing release without using the GitHub Actions dispatch button, push a unique tag matching `bootstrap-v2.2.6-*` to the commit to package. For example, `bootstrap-v2.2.6-<unique-suffix>` runs the release workflow against that commit and uploads its installers to the existing `v2.2.6` release. It leaves the `v2.2.6` source tag and product version unchanged. The normal `workflow_dispatch` input remains available for other existing releases. Users of older packages must install this bootstrap package manually; those builds do not contain the updater code or pinned public key.

After bootstrap, pushes to `main` publish signed updates without a version bump or manual installer rebuild. The Windows setup installer, macOS app, and Linux AppImage support in-app updates. Windows and Linux portable archives remain manual-update distributions.

The signing secret is used only by GitHub Actions. Only the public key is embedded in app builds. If the signing configuration is missing, the workflows stop before publishing an incomplete or unsigned feed.
