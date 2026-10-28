# CLAUDE.md

Guidelines for Claude Code working in the JaneConverter repository.

Refer to the primary guidelines in [AGENTS.md](AGENTS.md) for project architecture, toolchains, verification commands, and collaboration guidelines.

## Quick Commands

- **Python Tests**: `uv run --locked pytest tests/ -v`
- **Python Lint**: `uv run --locked pyflakes src/janeconverter packaging/engine_entry.py packaging/create_updater_manifest.py`
- **Frontend Tests & Build**: `cd desktop-ui && npm test -- --run && npm run build`
- **Rust Bridge Tests & Format**: `cargo fmt --manifest-path desktop-ui/src-tauri/Cargo.toml --check && cargo test --manifest-path desktop-ui/src-tauri/Cargo.toml`
