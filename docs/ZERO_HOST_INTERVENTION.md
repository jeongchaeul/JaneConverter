# The Zero Host Intervention & Total Automation Mandate

> *"JaneConverter will never, under any circumstance, require the host to intervene in any way, shape, or form."*

---

## 1. The Core Principle

JaneConverter is architected as a **fully autonomous, self-sufficient universal media downloader and converter**.

An application that asks users to manually open browsers, click extension icons, resolve redirects, or copy cookies has failed its fundamental purpose. JaneConverter operates as a frictionless background workstation that accepts any source link and produces pristine media without requesting human assistance.

---

## 2. Zero-Intervention Rules

**Never rely on manual user capture as a standard workflow or failure workaround.**

1. **No Host Prompting:** Never instruct the user to:
   - *"Open this link in your browser and use the Browser Capture extension"*
   - *"Please log in and retry"*
   - *"Click the extension icon to capture visible media"*
   - *"Copy cookies from your browser manually"*
2. **Autonomous Platform Resolution:**
   - **Shortlink Unwrapping:** Programmatically expands `pin.it`, `t.co`, `bit.ly`, `youtu.be`, and redirects.
   - **Session Access:** For authenticated routes (Instagram carousels, Facebook albums, age-gated YouTube), accesses active desktop browser sessions (DPAPI shadow copies across Vivaldi, Firefox, Chrome, Edge) without locking databases.
   - **Dynamic Failover:** Blocks or login walls trigger seamless failover to internal platform API endpoints.
   - **Direct Extraction Interception:** If upstream extractors (`yt-dlp`) fail on custom routes, internal extractors query platform APIs directly to build media manifests.

---

## 3. Autonomous Resolution Flow

```text
                  [ Source URL Ingestion ]
                             │
                             ▼
              [ Programmatic Shortlink Expansion ]
               (Resolves pin.it, redirects, etc.)
                             │
                             ▼
            ┌─────────────────────────────────┐
            │   Platform & Route Classifier   │
            └─────────────────────────────────┘
                             │
             ┌───────────────┴───────────────┐
             ▼                               ▼
    [ Public Clean Route ]         [ Auth-Restricted Route ]
             │                               │
             ▼                               ▼
   [ Headless / API Ingestion ]   [ Silent Desktop Browser Session ]
             │                     (Non-locking ephemeral cookie jar)
             │                               │
             └───────────────┬───────────────┘
                             ▼
              [ Autonomous Direct API Extract ]
              (Intercepts before fragile scrapers)
                             │
                             ▼
              [ Media Processing & Conversion ]
                             │
                             ▼
                      [ Pristine Media ]
```

---

## 4. Engineering Directives for Contributors & AI Agents

1. **Never Ask the Host to Intervene:** Do not ask the user to open links, switch browsers, inspect devtools, or install extensions to resolve conversion failures.
2. **Implement Fixes in Code:** Trace the exact network requests and headers sent by active sessions. Implement that flow directly in the Python engine (`src/janeconverter/`) or Tauri bridge (`desktop-ui/src-tauri/`).
3. **Handle Edge Cases & Route Permutations:** Transparently support subdomains, international prefixes (e.g. `ph.pinterest.com`), and dynamic parameters.
4. **Mandatory Live Verification & The Universal Rule of 7:**
   - Unit tests and mocks are necessary but never sufficient; they cannot detect live CDN throttling, API schema drift, or bot guards.
   - Always live-test the exact URL that triggered the failure.
   - **The Rule of 7:** Test extractions across at least **7 diverse real-world links** of the same platform/media category (single items, multi-slide carousels, reels/shorts, audio vs. video, shortlinks, user handles, guest vs. authenticated routes). Testing 7 distinct situations proactively detects latent failure modes and platform code reshuffling before regressions reach the host.
5. **Adhere to Rebuild Protocols (`packaging/REBUILD.md`):** Whenever engine or UI modifications are made, compile and deploy the corresponding binaries (`JaneConverterEngine.exe`, `janeconverter-desktop.exe`) per documented contracts.
6. **Continuous Pipeline Monitoring:** Never stop operations after pushing code or tags until all CI and packaging workflow jobs are 100% green and live packages are verified.
