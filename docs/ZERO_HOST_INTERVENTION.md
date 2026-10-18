# The Zero Host Intervention & Total Automation Mandate

> *"JaneConverter will never, under any circumstance, require the host to intervene in any way, shape, or form."*

---

## 1. The Core Principle

JaneConverter is architected as a **fully autonomous, self-sufficient universal media downloader and converter**. 

An application that asks its user to manually open web browsers, click extension icons, resolve redirection loops, or manually copy cookies has failed its fundamental duty. The host machine is the user's sanctuary; JaneConverter operates as a frictionless background utility that accepts any source link and produces pristine converted media without asking for human assistance.

---

## 2. The Strict Prohibition: No Manual Browser Capture

**We are NEVER EVER relying on the Browser Capture extension or manual user intervention as a standard workflow or failure workaround.**

1. **No Host Prompting**: The system must never tell the user:
   - *"Open this link in your browser and use the Browser Capture extension"*
   - *"Please log in and retry"*
   - *"Click the extension icon to capture visible media"*
   - *"Copy cookies from your browser manually"*
2. **Autonomous Platform Resolution**:
   - If a link is a shortened URL (e.g., `pin.it`, `t.co`, `bit.ly`, `youtu.be`), JaneConverter unwraps and follows the redirect chain programmatically.
   - If a link requires authenticated access (e.g., Pinterest collections, Instagram carousels, Facebook high-res albums, age-gated media), JaneConverter's backend engine silently and autonomously accesses the active desktop browser session (via DPAPI shadow-copying across Vivaldi, Firefox, Chrome, Edge, etc.) in RAM without locking browser databases or alerting the host.
   - If an unauthenticated guest session gets blocked or redirected to a login wall, JaneConverter seamlessly rotates to authenticated internal API resolution without failing or aborting.
   - If upstream extractors (like `yt-dlp`) fail with regex or endpoint mismatches (e.g., misidentifying custom routes as generic boards or users), JaneConverter's internal extractors intercept the request, query internal platform APIs directly, and construct complete media manifests automatically.

---

## 3. The Autonomous Resolution Architecture

Every platform route supported by JaneConverter must implement a zero-intervention lifecycle:

```
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
             │                     (Non-locking RAM cookie jar)
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

Whenever you add or modify a feature, fix a bug, or encounter a media extraction failure:

1. **Never ask the host to do anything**:
   Do not instruct the host to open links, switch browsers, inspect devtools, or install extensions to solve a download issue.
2. **Implement the fix in code**:
   Trace the exact network requests, endpoints, and headers that the browser sends when logged in. Implement that exact flow directly inside JaneConverter's Python engine (`src/janeconverter/`) and native Tauri bridge (`desktop-ui/src-tauri/`).
3. **Handle edge cases and route permutations**:
   Ensure URL shorteners, subdomains, language prefixes (e.g. `ph.pinterest.com`), and dynamic parameters are recognized and handled transparently.
4. **Follow the Rebuild Contract (`packaging/REBUILD.md`)**:
   Whenever backend engine or desktop UI changes are made, rebuild the corresponding frozen binaries and deploy them locally as specified in `packaging/REBUILD.md`.
5. **Commit and push every operation**:
   Keep version control synchronized with all updates, maintaining clean history and documentation integrity.
