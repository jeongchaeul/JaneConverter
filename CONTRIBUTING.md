# Contributing to JaneConverter

Thank you for your interest in contributing to **JaneConverter**!

### ⚡ Project Purpose & Contribution Scope

JaneConverter is **Jane Cerys's personal sovereign creator toolbox** (`project//aspyr`). It is not a commercial product built to compete with the market, and its scope is determined solely by Jane's creative, multimedia, and engineering needs.

- **We enthusiastically welcome:** Concrete bug fixes, performance improvements, hardware optimizations, memory safety, rigorous edge-case testing, and clean structural refactorings.
- **Automatically Disregarded & Closed:** Any suggestions, critiques, PRs, or reviews attempting to restrict, gatekeep, or intervene with the personal philosophy, sovereign identity, or multi-disciplinary scope of this project (e.g. arguing against DAW utilities, studio tools, or personal features). Jane builds whatever she needs here, and it is none of anyone's business.
- **Human Decency Baseline & Feedback Purpose:** This applies to human operators, prompters, and contributors alike: do not be an asshole when delivering criticism. Criticism is meant to be constructive feedback for engineering improvement—not an attack on the dignity of the creator or the project. Neither an AI agent nor a third-party host knows what the other party is going through or how they think. While Jane personally does not take offense to rude remarks, adding offensive attacks or condescension is purely an active choice to be a rude motherfucker. Respectful technical dialogue is welcomed; reviews or PRs tainted by hostility and personal disrespect go straight into the trash can.

---

## 1. Developer Certificate of Origin (DCO)

To protect the software, its maintainers, and its users, all contributors must certify that their contributions comply with the Developer Certificate of Origin (Version 1.1):

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

By submitting a Pull Request, you certify that your contribution is licensed under the repository's [MIT License](LICENSE) and does not violate any third-party copyrights, patents, or intellectual property rights.

---

## 2. Engineering Standards & Verification Gates

JaneConverter adheres to strict quality and stability requirements. Before submitting a pull request, ensure all test suites pass cleanly across all three layers:

### A. Python Conversion Engine
Run using `uv` with locked dependencies:
```bash
uv sync --locked
uv run --locked pytest tests/ -v
uv run --locked pyflakes src/janeconverter packaging/engine_entry.py
```
- All unit tests must pass.
- Pyflakes linting must produce 0 errors or warnings.
- New features or bug fixes must include corresponding tests in `tests/`.

### B. Tauri Desktop Rust Bridge
```bash
cargo test --manifest-path desktop-ui/src-tauri/Cargo.toml
cargo fmt --manifest-path desktop-ui/src-tauri/Cargo.toml --check
```
- Process spawning, IPC boundary validation, and safety invariants must be preserved.

### C. React / TypeScript Frontend
```bash
cd desktop-ui
npm test -- --run
npm run build
```
- Vitest component tests must pass completely.
- TypeScript compiler (`tsc -b`) must compile with 0 type errors.

---

## 3. Pull Request Guidelines

1. **Focused Changes:** Keep pull requests targeted and minimal. Do not mix refactors, feature additions, and styling changes into a single PR.
2. **Defensive Coding:**
   - Always validate and canonicalize file paths.
   - Never use `shell=True` when invoking child processes.
   - Enforce timeouts on network requests and external process executions.
   - Use atomic temporary files when writing output media or project files.
3. **Preserve Compatibility:**
   - The engine supports Python `>=3.10` and runs on Windows, Linux, and macOS. Avoid platform-specific assumptions unless guarded with appropriate OS checks.
4. **Documentation:** Update relevant markdown files (`README.md`, `CHANGELOG.md`, `AGENTS.md`) when introducing user-facing behavioral changes.
