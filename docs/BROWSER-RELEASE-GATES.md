# Browser release gates

A release is ready only when the automated browser gate passes on the exact build being deployed, the known accessibility failures listed below are resolved or explicitly accepted by the owner, and the manual checks have dated results. This page defines the matrix, the journeys, the thresholds and how evidence is kept.

HTTP concurrency is a separate question. The [capacity protocol](CAPACITY.md) covers it and does not substitute for these checks.

## Run it

```sh
npm ci                                   # dev-only: Playwright and axe-core
npx playwright install chromium          # once per machine
npm run test:browser                     # builds dist/, then runs tests/browser/*.spec.mjs
npm run test:browser:evidence -- --out docs/releases/browser-gates
```

`npm run test:browser` serves the built `dist/` from `tests/browser/static-server.mjs`. It applies the same `_headers` rules as Cloudflare Pages, including the Content Security Policy. The host name is `vedaris.localhost`. That is a secure context, so the real service worker installs. The app skips worker registration on bare `localhost`. Every other host name fails DNS resolution in the test browser. DNS failure alone would hide an attempted dependency (and does not stop IP-literal URLs), so every test also records each request its browser context makes, service worker included, and fails if any leaves the release origin. The only exemption is the resource library's optional live-catalog refresh from `raw.githubusercontent.com`, which the CSP also names. Axe audits run once fonts are loaded and the DOM has stopped changing, so asynchronous renders are audited complete.

GitHub Actions runs the gate on every push and pull request in the `browser-gate` job of `.github/workflows/ci.yml`. It uploads `test-results/browser-gate/` (the Playwright JSON results, `evidence.json`, and traces and screenshots for failures) as a 30-day artifact. The deployed application stays dependency-free. Playwright and axe-core are `devDependencies` and never ship.

## Supported matrix

| Browser / device | How it is checked | Status |
| --- | --- | --- |
| Chromium desktop, 1366×900 | Automated: every spec | Gate |
| Chromium, emulated phone 390×844, DPR 3, touch, 4× CPU throttle | Automated: full-corpus timing | Gate |
| Chromium at 320, 360 and 390 px wide | Automated: reflow on all routes, full-paper questions and report | Gate |
| Desktop Firefox, current release | Manual (`browser-firefox-desktop`) | Not yet run |
| Desktop Safari, current release | Manual (`browser-safari-desktop`) | Not yet run |
| iPhone Safari | Manual (`device-ios-safari-offline`, `sr-voiceover-ios-safari`) | Not yet run |
| Android Chrome, mid-range phone | Manual (`device-android-chrome-offline`, `sr-talkback-android-chrome`) | Not yet run |
| 400% zoom at 1280 px | Manual (`zoom-400-percent`) | Not yet run |

Automation covers Chromium only. The offline and upgrade checks depend on Chromium's service-worker behaviour under Playwright. Other engines are listed because learners use them. Until a person records a result for them, they are unverified, not passing.

## Automated checks

| Area | Spec | What it proves |
| --- | --- | --- |
| Keyboard: skip link, navigation | `keyboard.spec.mjs` | Tab reaches the skip link, Enter moves focus to `main`, and the sidebar route can be opened from the keyboard. Each focused control shows a visible outline. |
| Keyboard: setup | `keyboard.spec.mjs` | Filters change by typing, and focus stays on the changed control after the re-render. Instructions open and a full paper begins with Tab and Enter. |
| Keyboard: answering | `keyboard.spec.mjs` | Space selects an option (or typing fills the numeric field). Flag for review, Save & next and the palette all work, and the palette announces answered, flagged and current. |
| Keyboard: dialogs | `keyboard.spec.mjs` | PYQ submit confirmation receives focus and can be dismissed. The original-practice modal `<dialog>` keeps focus out of the inert page, closes with Escape and returns focus to its opener. |
| Keyboard: finish and review | `keyboard.spec.mjs` | Submit leads to the report. The review filter exposes `aria-pressed`, and a question's worked solution opens from its summary. |
| Keyboard: backup restore | `keyboard.spec.mjs` | Export downloads `vedaris-pyq-backup.json`. In a separate empty profile, the restore control is reachable by Tab and opens the file chooser with Space; the restored report appears. A second restore asks before replacing work, and dismissing it keeps the data. The progress restore control is also keyboard reachable. |
| WCAG rules | `axe.spec.mjs` | axe-core with the WCAG 2.0/2.1/2.2 A and AA tags on every route the shell links to (read from `index.html`, so a new view is audited automatically), on the PYQ hub, instructions, a question with a figure, the submit confirmation and the report, on an original-practice question and dialog, on the 404 page and on `/resources/`. |
| Structure | `layout.spec.mjs` | Every route the shell links to has one `h1`, one `main` landmark, labelled navigation and a `· Vedaris` page title. |
| Narrow viewports | `layout.spec.mjs` | No horizontal document overflow at 320, 360 or 390 px on every route, on full-paper questions with figures and maths, or on the report. Intentional scrollers (navigation strip, tables, the palette) are allowed. Enabled controls on the question screen are at least 24×24 px (WCAG 2.2 SC 2.5.8). |
| Reduced motion | `layout.spec.mjs` | With `prefers-reduced-motion: reduce`, no element has a transition, animation or smooth scrolling. A control run confirms the probe detects motion when the preference is absent. |
| Equations | `layout.spec.mjs` | All 48 questions of 2025 Paper 2 are checked at 320 px. Maths is native MathML, never zero-sized, at least 12 px, has text, contains no render errors or raw TeX, and never widens the page. |
| Diagrams | `layout.spec.mjs` | Figures load at a readable width and their alternative text is descriptive (more than 15 characters, not "Figure 1"). |
| Missing content | `layout.spec.mjs`, `resilience.spec.mjs` | Empty filter results say so and disable Start. Linked-only years are labelled as not playable. A figure that fails to load is replaced by an announced note while its description stays. An unknown paper says "Paper not found." An uncached paper offline names the reason and offers Try again. |
| Offline, cached | `resilience.spec.mjs` | After one online visit, a used paper reloads with the network cut. The attempt resumes, a viewed figure comes from the worker cache, and answers keep saving. A figure never viewed online shows the explicit unavailable note. |
| Offline, uncached | `resilience.spec.mjs` | With only the shell installed, PYQ practice shows "The question bank could not load." with the reason, original practice still works, and reconnecting recovers. With the shell evicted, the worker returns its explicit 503 offline message. |
| Storage failure | `resilience.spec.mjs` | A quota error while answering shows the not-saved notice and keeps the saved attempt unchanged. Recovery is announced. If `localStorage` is unavailable, practice runs in memory with an export reminder. If Web Locks are unavailable, the workspace says it is memory-only. |
| Reader tabs | `resilience.spec.mjs` | A second tab is read-only, with disabled controls. It follows the writer's answers and flags, and it becomes the writer after the first tab closes, with the work intact. |
| Upgrade while active | `resilience.spec.mjs` | A second release is built and deployed with the first retained, as `npm run deploy` does. During an active paper, the new worker installs and waits. The page is not reloaded, answers keep saving and an old-release figure still loads. After the tab closes, the new release controls the page and the attempt resumes with its answers and flags. |
| Full-corpus timing | `performance.spec.mjs` | Cold start, bank readiness for all reviewed papers, full-paper render, question navigation and interaction latency, measured against the thresholds below. |

## Performance thresholds

Thresholds are in `tests/browser/performance-thresholds.json` and marked **proposed**. They come from public boundaries, not from one machine's results: 2.5 s "good" LCP for the first useful screen, 200 ms "good" and 500 ms "poor" INP, and 200 ms "good" and 600 ms "poor" total blocking time. The emulated phone fails only at the "poor" boundary. The owner should confirm or change them. Any later change needs a dated note here.

| Metric | Measures | Desktop | Emulated phone (4× CPU) |
| --- | --- | ---: | ---: |
| `dashboardReadyMs` | Navigation start to the dashboard heading, cold cache | 2,500 | 2,500 |
| `corpusReadyMs` | Opening PYQ practice to the mounted bank: every paper bundle downloaded, SHA-256 checked and indexed | 3,000 | 6,000 |
| `corpusLongTaskBlockingMs` | Long-task time beyond 50 ms per task while the bank loads | 200 | 600 |
| `fullPaperRenderMs` | "Begin full paper" to the first question, on 2026 Paper 2 (54 questions) | 500 | 1,000 |
| `questionNavigationMedianMs` | Palette click to the next question rendered, median of 11 | 200 | 500 |
| `interactionLatencyMaxMs` | Longest Event Timing duration over all interactions (INP for fewer than 50 interactions) | 200 | 500 |

Every run records the device: OS, CPU model and count, memory, browser build, Node version, viewport, DPR, CPU throttling and whether it ran in CI. Network is loopback and unthrottled, so download time on a real connection is **not** represented. The `device-android-chrome-offline` manual row covers a real phone.

## Accessibility baseline: known failures

When the gate was introduced, axe found these and they were fixed:

- The PYQ backup restore control was `display:none`/`hidden`, so a keyboard could not reach it. The original-practice progress restore had the same problem. Both are now visually hidden but focusable, and the label shows the focus ring.
- PYQ palette buttons showed `18` but were named "Physics Q1". Names now begin with the visible position, for example "Question 18: Physics Q1, …" (WCAG 2.5.3).
- The brand link's name did not contain its visible text.
- A link inside dashboard prose was distinguishable by colour only.
- The revision notebook had no `h1`.
- At 320 px, the dashboard subject cards and the question-studio family select caused horizontal page overflow.
- An uncached paper offline showed the raw browser error "Failed to fetch". Figures that failed to load showed a broken image.

**Still failing: `color-contrast` (WCAG 1.4.3).** Many muted greys and greens in the visual design measure 2.3:1 to 4.48:1 against their backgrounds. The gate was introduced with 195 patterns; when the Revision suggestions and backup views joined the audit, their shared muted, footer, breadcrumb, table-header and sidebar colours were fixed rather than baselined, which also removed 78 existing patterns. AA requires 4.5:1 for normal-size text. Every audited view is affected. The patterns are recorded in `tests/browser/a11y-baseline.json` and appear as known open failures in every evidence file. A new failing colour pair or element in any view fails the gate as a regression. Removing entries is expected; the evidence script refuses to add new ones (an empty baseline included) and refuses to rewrite the baseline from a run with any failed or skipped check. A palette change touches every stylesheet, so it is left to a dedicated design change, not hidden inside this gate. Until it lands, `decision.releaseReady` stays `false`.

## Recording evidence

`npm run test:browser:evidence -- --out docs/releases/browser-gates` writes `YYYY-MM-DD-<release>.json`, containing:

- `release`: the immutable release hash, app version, package version, git commit and whether the working tree was clean (plus the Actions run ID in CI).
- `environment` and `playwright`: the measuring machine and tool versions.
- `automated`: each check with pass or fail, duration and the first lines of any error.
- `accessibility`: the axe version and tags, the views audited, regressions and known failures.
- `performance`: per profile, the device, corpus size, metrics, thresholds and per-metric pass or fail, with raw samples.
- `offline`: the cached-offline and upgrade records.
- `manual`: copied from `tests/browser/manual-checks.json`.
- `decision`: whether the automated gate passed, the regressions (failed checks, threshold misses, new axe patterns), known open failures, manual checks not run, and `releaseReady`.

Any failed automated check is a **regression**. It is listed in `decision.regressions`, and the evidence script exits non-zero. Keep the dated file for each release you deploy, next to the existing `docs/releases/*-production.json` probes. Never edit results by hand. Re-run instead.

## Manual protocol (screen readers, real devices, other browsers)

Automation cannot judge speech output, real touch devices or other engines. `tests/browser/manual-checks.json` lists the rows. All are **not yet run**. For each row, the tester records the status (`pass` or `fail`), the date, their name, exact versions (OS, browser, screen reader) and notes. The change is committed with the release's evidence file. Never mark a row as passed without doing it.

Use a fresh browser profile and the deployed release. Each screen-reader journey passes only if every step is announced understandably and is operable with that reader's standard commands, without sight of the screen:

1. **Setup.** Find PYQ practice from the main navigation. The coverage figures (playable questions, years, complete papers) are announced. Change Subject and Chapter; the match count update is perceivable. Open a full paper's instructions. The section marking table is read with its headers.
2. **Answering.** Begin the paper. The question heading, subject, question number and marking are announced. Equations are read meaningfully as MathML, not as letter-by-letter noise, and figure descriptions are read. Choose an option, or enter a numeric answer. Flag the question and move with Save & next and the palette; each palette button announces its position, subject and question number, and whether it is answered, flagged or current. Change subject with the subject navigation.
3. **Dialogs.** Submit. The confirmation is announced and focus lands on "Submit & see report"; "Keep working" returns to the question. In original practice, the submit `<dialog>` is announced as a dialog with its title, Escape closes it, and focus returns to "Submit session".
4. **Finish and review.** The score, the subject totals and the review filters are announced, with pressed state. A question's review opens, and the learner's answer, the accepted answer and the worked solution are read in order.
5. **Backup restore.** Export the backup. In a second profile, reach "Restore backup", choose the file, and hear the "PYQ backup restored" status. Restoring again, the replace confirmation is announced and cancelling it keeps the data.

Real-device offline rows: install or visit online, open one paper and view one figure, then turn on airplane mode. Reload. The attempt must resume, the viewed figure must show, an unviewed figure must show the unavailable note, and a never-opened bank (in a fresh profile) must show the explicit offline message. The Android row also records full-corpus timing on a named mid-range phone.

## Interpreting a failure

A failing spec names the journey and step. Its trace (`npx playwright show-trace test-results/browser-gate/artifacts/<test>/trace.zip`) shows the DOM, console and network at each step. Fix the product, not the check. Weakening a check, raising a threshold or enlarging the accessibility baseline needs the owner's agreement and a dated note in this document.
