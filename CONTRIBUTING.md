# Contributing to JaneConverter

Thank you for your interest in contributing to **JaneConverter**!

### ⚡ Project Purpose & Scope

JaneConverter is **Jane Cerys's personal creator toolbox** (`project//aspyr`). It is not an enterprise commercial utility, and its feature set is defined by Jane's creative, multimedia, and engineering workflows.

> *"JaneConverter is tailored specifically for my personal needs and convenience. But I wanted to share it because it can be useful. I don't have a particular goal, it's just my personal toolbox. If you find it useful, then that's great."* — **Jane Cerys**

- **Welcomed & Valued:** Concrete bug fixes, performance optimizations, memory safety hardening, hardware acceleration enhancements, and clean structural refactorings.
- **Disregarded:** Scope-policing, unsolicited product management advice, or critiques attempting to restrict the project's personal feature set (e.g. arguing against DAW utilities, studio audio DSP, or social archival). Repository scope remains sovereign to Jane's creative direction.
- **Decent Human Standard & Professional Restraint:** Technical critique is welcomed as an instrument for structural and algorithmic improvement—never to attack or demean the creator or project. Arrogant posturing and bad-faith hostility are rejected with prejudice.
- **The Artist Principle & Style Orthodoxy:** Feedback addressing verifiable correctness, safety, and throughput is embraced. However, imposing arbitrary design patterns or stylistic orthodoxy on functional code that works deterministically without performance penalties will be disregarded. Observations grounded in subjective preference must be framed as *personal suggestions* rather than objective deficiencies.
- **Non-Obligatory Receptivity:** An openness to hearing technical perspectives carries no obligation to adopt them. Declining non-essential recommendations is an exercise of maintainer sovereignty, not resistance to quality.

---

## 1. Developer Certificate of Origin (DCO)

All contributions must comply with the Developer Certificate of Origin (Version 1.1):

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

Submitting a Pull Request certifies that your contribution is licensed under the repository's [MIT License](LICENSE) and does not violate third-party intellectual property rights.

---

## 2. Engineering Standards & Verification Gates

Before submitting a Pull Request, ensure all test suites pass across all layers:

### A. Python Conversion Engine
```bash
uv sync --locked
uv run --locked pytest tests/ -v
uv run --locked pyflakes src/janeconverter packaging/engine_entry.py
```
- All unit tests must pass.
- Pyflakes linting must produce 0 errors or warnings.
- New features or bug fixes must include unit test coverage in `tests/`.

### B. Tauri Desktop Rust Bridge
```bash
cargo fmt --manifest-path desktop-ui/src-tauri/Cargo.toml --check
cargo test --manifest-path desktop-ui/src-tauri/Cargo.toml
```
- Rust code must be formatted and pass all unit tests.

### C. React / TypeScript Frontend
```bash
cd desktop-ui
npm test -- --run
npm run build
```
- Vitest tests must pass completely.
- TypeScript compiler (`tsc -b`) must build cleanly with 0 type errors.

---

## 3. Pull Request Guidelines

1. **Focused Scope:** Keep pull requests targeted and minimal. Avoid bundling unrelated refactors and feature changes.
2. **Defensive Coding:**
   - Canonicalize and validate all file paths.
   - Never invoke child processes with `shell=True`.
   - Enforce timeouts on network requests and external process executions.
   - Write output media and project files using atomic temporary files.
3. **Cross-Platform Compatibility:** The engine supports Python `>=3.10` across Windows, Linux, and macOS. Guard OS-specific operations with proper platform checks.
4. **Documentation:** Update relevant markdown files (`README.md`, `CHANGELOG.md`, `USER_MANUAL.md`) when introducing user-facing behavioral changes.
