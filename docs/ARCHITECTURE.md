# Vedaris architecture · 0.4

Vedaris carries forward the study flow of Avenquellis and Axiom SAT: choose a subject or chapter, practise, review, and revisit mistakes. Release 0.4 adds a separate historical engine containing 102 reviewed JEE Advanced questions from the complete 2023 Paper 1 and Paper 2. The source-link archive, immutable historical questions and generated original practice retain distinct identities and provenance.

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
| `content/review-audit.json` | Source pages, key checks, dataset revision, normalization notes and source/asset hashes. |

Pure engines have no DOM, network or storage dependency. Files use ES modules and run in Node or the browser. The current repository keeps these boundaries together; a future repository split must preserve stable identities.

## Historical content and scoring

The reviewed bank contains 51 questions per paper, 180 marks per paper and a 180-minute duration per paper. Chapter filters can select questions across both papers. Full mocks retain the original question order, subject sections and marking; a custom set is not presented as a complete exam paper.

Normalized historical questions expose source provenance, chapter IDs, type, options, exact answer, optional accepted range or discrete values, explicit marks, solutions, matching lists and assets. Numeric parsing uses rational arithmetic. Multiple-correct partial scores are exact permitted subsets, not a global heuristic. Two dropped Paper 2 Physics questions award +3 unconditionally and are reported separately from correct or attempted questions.

The runtime refuses missing reviews, unsafe or unavailable assets, duplicate source identities and mismatched paper metadata. Full-paper readiness additionally requires exact counts, order, totals, duration, all PCM subjects and section-rule agreement. The separate [content pipeline](CONTENT-PIPELINE.md) describes evidence and review limitations.

## Identity and persistence

Content IDs such as `2023_P1_Chemistry_Q01-v1` identify a specific reviewed record, not an array position. `bankId` binds historical backups to a compatible bank. A historical session stores question IDs, responses, visits, flags and timing alongside its start/deadline/finish timestamps. Questions, answer keys and score totals are resolved from the registry when reporting or restoring.

Responses at or after the deadline do not change the attempt; the session finishes at the deadline. Only explicit visible-screen timing calls add active time, each bounded to 60 seconds and to elapsed wall time. Time spent elsewhere still consumes a timed exam's wall-clock duration. A completed attempt leaves the active slot and is saved once by stable session ID. History keeps the latest 20 completed historical attempts; duplicate IDs, unfinished history, invalid arrays and impossible timing fail restore.

PYQ backup exports the active attempt and those 20 reports. Import checks the version, bank identity and every session, recomputes reports, and asks before replacing existing local PYQ work. No stored total is authoritative. Original-practice first-attempt progress, its separate 50-session history and revision notebook remain distinct; the PYQ backup does not claim to include those stores.

`src/learning/storage.js` holds the editing tab's exclusive Web Lock. A second tab can browse reports and active questions but cannot persist mutations. Reader snapshots update the mounted PYQ workspace without resetting the report filter or question position for timing-only changes. Unsupported lock APIs degrade to in-memory practice with an export reminder; no timestamp-based local-storage lease is used. Page hiding flushes timing and releases the lock, and a restored back/forward-cache page reloads to acquire a fresh role.

Corrupt saved state is preserved rather than overwritten. A failed PYQ persistence callback leaves the accepted session intact. Route generation guards prevent an asynchronous content download from painting a route the learner has already left. Mount cleanup removes timers and document/window listeners.

## Original practice and study analysis

The dashboard, test centre, analysis, report and notebook remain separate vanilla UI modules. Original practice uses deterministic template IDs and seeds. When a mixed set is grouped by subject, responses, flags, timing and visit arrays follow the same identity permutation.

Original-practice completed history is limited to 50 validated sessions, with first-attempt grades protected from retries. Notebook annotations refer to original question identities and hold bounded cause labels, notes and resolution flags. Resolving an annotation or improving a retry does not rewrite the first attempt. Historical reports likewise distinguish a new exact-question retry from its source attempt.

No rank, percentile, national comparison or difficulty calibration is derived from this local data. Browser-delivered answer keys are inspectable; this is a self-study workspace, not a proctored assessment system.

## Static release and delivery

Production is a static Cloudflare Pages deployment. `scripts/build.mjs` emits an immutable `releases/<content-hash>/` tree, a revalidated root document and a scoped service worker. Release-relative content bundles and 39 local diagram files are part of that release. The worker verifies SHA-256 digests before caching assets and waits for old tabs to close before activating an update.

KaTeX is a build-time dependency vendored with its license. Published pages use native MathML; application code, fonts and content figures are self-hosted. External source PDFs remain navigation links, excluded from offline caching and load tests. No runtime database, model grading or account service is required.

This architecture does not establish capacity for 10,000 simultaneous learners. That target remains unmeasured until the separate bounded test and deployment acceptance criteria are met. See [capacity notes](CAPACITY.md) and the release checklist. Accounts and cross-device synchronization remain future work; learners can transfer a compatible PYQ backup manually.

## Verification

```sh
npm test
node scripts/validate-archive.mjs
npm run build
```

Engine tests cover source identity and completeness, exact scoring, deadline boundaries, storage tampering, deduplication, bounded timing and regraded reports. UI-controller tests cover reader report/filter continuity, active-session updates and cleanup. Build tests cover native math compilation, hashes and release isolation. These verify software behavior; source inspection and mathematical review remain separate evidence requirements.
