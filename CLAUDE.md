# CLAUDE.md - JaneConverter Guidelines

Guidance for Claude Code operating in this repository.

See [AGENTS.md](AGENTS.md) for full engineering contracts, live-verification protocols, toolchains, and quality standards.

## Project Scope
JaneConverter is Jane Cerys's (`project//aspyr`) personal sovereign creator toolbox. Its multi-disciplinary scope (media conversion, DSP audio engineering, FL Studio binary patchers, and social scrapers) is determined solely by the maintainer. High-rigor bug fixes, performance improvements, and tests are welcomed; scope policing or unsolicited product management advice is disregarded.

## Engineering Contracts

- **Python Engine**: Managed via `uv`. Run tests with `uv run --locked pytest tests/ -v`. Lint with `uv run --locked pyflakes src/janeconverter packaging/engine_entry.py packaging/create_updater_manifest.py`.
- **Desktop UI**: Tauri 2 + React + TypeScript in `desktop-ui/`. Tests: `npm.cmd --prefix desktop-ui test -- --run`. Build: `npm.cmd --prefix desktop-ui run build`.
- **Rust Bridge**: Tauri bridge in `desktop-ui/src-tauri/`. Tests: `cargo test --manifest-path desktop-ui/src-tauri/Cargo.toml`. Format check: `cargo fmt --manifest-path desktop-ui/src-tauri/Cargo.toml --check`.
- **Media Fix Verification**: Never rely solely on mocks or unit tests for media extractors. Always live-test against real-world links before marking issues resolved.
