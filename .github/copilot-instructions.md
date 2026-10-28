# GitHub Copilot Instructions

Guidelines for GitHub Copilot working in the JaneConverter repository.

Refer to [AGENTS.md](../AGENTS.md) for full project architecture, sovereign creator directives, toolchains, verification commands, and collaboration guidelines.

## Key Directives

- Run Python through `uv` (`uv run --locked pytest tests/ -v`, `uv run --locked pyflakes src/janeconverter packaging/engine_entry.py`).
- Run Rust tests through `cargo test --manifest-path desktop-ui/src-tauri/Cargo.toml`.
- Run frontend tests through `npm test -- --run` in `desktop-ui/`.
- JaneConverter is Jane Cerys's sovereign personal creator toolbox; focus contributions on deterministic correctness, memory safety, and performance.
