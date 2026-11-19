# Vedaris architecture · 0.5

Vedaris carries forward the study flow of Avenquellis and Axiom SAT: choose a subject or chapter, practise, review, and revisit mistakes. Release 0.5 contains a separate historical engine with 510 reviewed JEE Advanced questions from ten complete papers across 2022–2026, with 170 questions per subject and 279 unique local figures. The source-link archive, immutable historical questions and generated original practice retain distinct identities and provenance.

## Reference projects

| Reference | Established structure | JEE adaptation |
| --- | --- | --- |
| [Avenquellis web](https://github.com/TARUNTEjjjj/avenquellis-web) | Overview, test arena, chapters, problems, progress and sources. | A PCM workspace with local sessions and reports. |
| [Avenquellis question engine](https://github.com/TARUNTEjjjj/avenquellis-question-engine) | Reproducible original families and separate source metadata. | Original families remain separate from historical PYQs. |
| [Avenquellis proof grader](https://github.com/TARUNTEjjjj/avenquellis-proof-grader) | Assessments with evidence and explicit limits. | Objective historical questions use their actual source marking. |
| [Axiom SAT](https://github.com/TARUNTEjjjj/axiom-sat) | Pure question/session/progress modules, reload and retries. | Stable identities, explicit deadlines and validated local persistence. |

The reference projects' generated questions or historical links cannot substitute for authentic JEE content. No shared generic marking policy is assumed across examinations or years.

## Responsibilities

```text
Browser workspace
  ├── Original practice → src/questions + src/practice + src/learning
  ├── PYQ practice → assets/content-loader.js → src/content/catalog.js
  │                                            └── src/content/session.js
  └── Source browsing → src/archive/index.js → data/archive.json

Reviewed content/ bundles + local diagrams
  └── scripts/build-content.mjs → validated registry + build-time MathML
                                  └── immutable data/content/ bundles + hashes

Legacy staged imports → src/archive/questions.js → data/imports/validated/
                                                    (not auto-published)
```

| Module | Responsibility |
| --- | --- |
| `src/archive/index.js` | Archive validation, combined filters and honest source-coverage statistics. |
| `src/archive/questions.js`, `scripts/import-pyq.mjs` | Base reviewed-batch validation and exclusive, whole-batch staging. |
| `src/content/catalog.js` | Deeply immutable content registry, filters, exact marking, source identity and full-paper completeness gate. |
| `src/content/session.js` | Historical attempts, deadlines, responses, visits, flags, bounded active timing, regraded reports and a 20-session workspace. |
| `assets/content-loader.js` | Release-relative downloads, bounded paper bundles, SHA-256 checks and registry reconstruction. |
| `assets/pyq.js` | Chapter sets, historical paper instructions, test navigation, review, exact-question retries and backup controls. |
| `scripts/build-content.mjs`, `scripts/render-math.mjs` | Validate explicit content inputs and compile escaped prose/LaTeX into native MathML. |
| `src/learning/storage.js` | One browser-wide workspace writer using an exclusive Web Lock. |
| `src/learning/topic-relations.js`, `src/learning/recommendations.js`, `src/learning/revision-plan.js` | Draft prerequisite map over canonical chapter IDs, explainable revision suggestions and the learner's local goals/dismissals. |
| `src/content/written-review.js` | Source-backed written-answer contract, publication gate, self/expert/automated-assist review records and export. Not wired to the UI; no legacy paper passes its gate. |
| `content/review-audit.json` | Source pages, key checks, dataset revision, normalization notes and source/asset hashes. |

Pure engines have no DOM, network or storage dependency. Files use ES modules and run in Node or the browser. The current repository keeps these boundaries together; a future repository split must preserve stable identities.

## Historical content and scoring

The reviewed bank covers both papers in each year from 2022–2026. Every paper carries 180 marks and lasts 180 minutes; question counts vary: 54/54 in 2022, 51/51 in 2023 and 2024, 48/48 in 2025, and 48/54 in 2026. Year-by-subject coverage is derived from the registry; the five yearly totals are 108, 102, 102, 96 and 102. Chapter filters span the bank. Full mocks retain original order, subjects and sections; custom sets remain distinct.

The requested 40+ year playable archive is unfinished: 1978–2021 are source-linked only and are not playable. Partial third-party collections and generated practice cannot fill historical gaps.

Normalized historical questions expose provenance, chapter IDs, type, options, an exact key, optional numerical ranges or discrete values, alternative option sets, explicit marks, solutions, matching lists and assets. Rational arithmetic preserves gaps between accepted numerical intervals. An exact accepted option set earns full credit before explicit proper-subset partial marks are considered.

Marking belongs to the source section: the 2026 multiple-correct penalty is −1, whereas 2022–2025 use −2. Dropped questions award their published bonus marks unconditionally and are reported separately from correct or attempted questions. There is no universal penalty or bonus value inferred from question type.

The runtime refuses missing reviews, unsafe or unavailable assets, duplicate source identities and mismatched paper metadata. Full-paper readiness additionally requires exact counts, order, totals, duration, all PCM subjects and section-rule agreement. The separate [content pipeline](CONTENT-PIPELINE.md) describes evidence and review limitations. Codex independently authored explanations and compared questions, diagrams and answers with official papers and final keys. These are explicitly AI-assisted reviews; they do not assert human certification. Unresolved source wording and unexplained official alternatives remain visible in the explanations and audit rather than being silently rewritten.

## Identity and persistence

Content IDs such as `2023_P1_Chemistry_Q01-v1` identify a specific reviewed record, not an array position. `bankId` binds historical backups to a compatible bank; adding these papers preserves existing 2023 identities and the compatible bank ID. A historical session stores question IDs, responses, visits, flags and timing alongside its start/deadline/finish timestamps. Questions, answer keys and score totals are resolved from the registry when reporting or restoring.

Responses at or after the deadline do not change the attempt; the session finishes at the deadline. Only explicit visible-screen timing calls add active time, each bounded to 60 seconds and to elapsed wall time. Time spent elsewhere still consumes a timed exam's wall-clock duration. A completed attempt leaves the active slot and is saved once by stable session ID. History keeps the latest 20 completed historical attempts; duplicate IDs, unfinished history, invalid arrays and impossible timing fail restore.

PYQ backup exports the active attempt and those 20 reports. Import checks the version, bank identity and every session, recomputes reports, and asks before replacing existing local PYQ work. No stored total is authoritative. Original-practice first-attempt progress, its separate 50-session history and revision notebook remain distinct; the PYQ backup does not claim to include those stores.

`src/learning/storage.js` holds the editing tab's exclusive Web Lock. A second tab can browse reports and active questions but cannot persist mutations. Reader snapshots update the mounted PYQ workspace without resetting the report filter or question position for timing-only changes. Unsupported lock APIs degrade to in-memory practice with an export reminder; no timestamp-based local-storage lease is used. Page hiding flushes timing and releases the lock, and a restored back/forward-cache page reloads to acquire a fresh role.

Corrupt saved state is preserved rather than overwritten. A failed PYQ persistence callback leaves the accepted session intact. Route generation guards prevent an asynchronous content download from painting a route the learner has already left. Mount cleanup removes timers and document/window listeners.

## Original practice and study analysis

The dashboard, test centre, analysis, report and notebook remain separate vanilla UI modules. Original practice uses deterministic template IDs and seeds. Multi-concept families in `src/questions/multi-concept.js` separate a documented parameter domain and constraint check from question construction; the dev-only `scripts/original-oracle.mjs` re-derives their answers from question text with exact rational arithmetic, and `scripts/original-coverage.mjs` publishes the chapter coverage map in [ORIGINAL-PRACTICE.md](ORIGINAL-PRACTICE.md). New families are appended under new IDs so existing identities keep producing the same questions. When a mixed set is grouped by subject, responses, flags, timing and visit arrays follow the same identity permutation.

Original-practice completed history is limited to 50 validated sessions, with first-attempt grades protected from retries. Notebook annotations refer to original question identities and hold bounded cause labels, notes and resolution flags. Resolving an annotation or improving a retry does not rewrite the first attempt. Historical reports likewise distinguish a new exact-question retry from its source attempt.

### Revision suggestions

`src/learning/topic-relations.js` lists prerequisite edges between the 54 canonical chapter IDs, each with a rationale and review status. Validation rejects unknown chapters, self-links, duplicates and cycles, and accepts `reviewed` only with a named reviewer, real date and evidence. The current edges were drafted with AI assistance and no human subject expert has checked them, so the dataset and every edge are `unreviewed-draft`; the suggestions page states this wherever prerequisites appear.

`src/learning/recommendations.js` reads only retained evidence: the earliest original-practice attempt per `templateId:seed` in progress (up to 1,000), notebook resolution decisions, and the earliest attempt per historical question ID across the saved PYQ reports (latest 20, graded only after the reviewed bank is loaded). Retries never replace a first attempt. Original-practice and historical-PYQ evidence are counted and explained separately, never merged into a score. Every reason cites counts, example question IDs and dates, or the date a learner declared a goal. Fewer than five retained attempts overall, or fewer than three in a chapter, are reported as insufficient evidence rather than ranked. Chapters with no original family or published PYQ say so. Unknown template IDs, PYQ IDs, bank versions and chapters are ignored, counted and left untouched in storage.

The learner's `vedaris.revision-plan.v1` store holds up to 12 goal chapters and dismissals keyed to an evidence signature, so a hidden suggestion returns when its retained evidence changes. It follows the same writer/reader/memory rules and corrupt-data preservation as other local stores. Nothing starts automatically; links open the chosen chapter's practice setup.

No rank, percentile, national comparison or difficulty calibration is derived from this local data. Browser-delivered answer keys are inspectable; this is a self-study workspace, not a proctored assessment system.

## Static release and delivery

Production is a static Cloudflare Pages deployment. `scripts/build.mjs` emits an immutable `releases/<content-hash>/` tree, a revalidated root document and a scoped service worker. Release-relative paper bundles and 279 unique local figures are part of that release. Installation precaches the shell, fonts and content index, excluding paper data and figures. Opening PYQ practice downloads the ten bounded bundles with no more than four concurrent requests; the loader verifies each digest and constructs the immutable registry. Figures load as their questions appear. Per-paper selection before download remains a future optimization.

The worker verifies SHA-256 digests before caching successful on-demand content. A cache write failure does not turn an otherwise valid online download into a failure. Only content already fetched and successfully cached is available offline; linked external papers are excluded. The worker waits for old tabs to close before activating an update.

KaTeX and its chemistry extension are build-time dependencies vendored with their licenses. Published pages use native MathML; application code, fonts and content figures are self-hosted. External source PDFs remain navigation links, excluded from offline caching and load tests. No runtime database, model grading or account service is required.

This architecture does not establish capacity for 10,000 simultaneous learners. That target remains unmeasured until the separate bounded test and deployment acceptance criteria are met. See [capacity notes](CAPACITY.md) and the release checklist. Accounts and cross-device synchronization remain future work; learners can transfer a compatible PYQ backup manually.

## Verification

```sh
npm test
node scripts/validate-archive.mjs
npm run build
```

Engine tests cover source identity and completeness, exact scoring, deadline boundaries, storage tampering, deduplication, bounded timing and regraded reports. UI-controller tests cover reader report/filter continuity, active-session updates and cleanup. Build tests cover native math compilation, hashes and release isolation. These verify software behavior; source inspection and mathematical review remain separate evidence requirements.

## Release retention

On-demand question bundles and figures require older immutable URLs to remain available after an update. `npm run deploy` runs `scripts/retain-releases.mjs` after the fresh build. It fetches only the owned production origin, validates manifest paths and SHA-256 hashes, stages at most four concurrent downloads, and preserves every previous immutable release in the upload. The current shell and service-worker precache remain unchanged. Failed downloads, hash mismatches, version collisions, more than 18,000 total deployment files, or more than 500 MiB of retained content stop publication without evicting a version. Rollbacks must also run retention against current production; selecting an older Pages deployment directly would break newer open tabs.
