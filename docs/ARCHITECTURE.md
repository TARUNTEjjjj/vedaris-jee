# Vedaris architecture

Vedaris carries forward the study flow of Avenquellis and Axiom SAT: choose a subject or chapter, practice, review answers, and revisit mistakes. Historical papers have an additional source and editorial pipeline. This document distinguishes the current archive tools from the larger system they support.

## Reference projects

| Reference | Established structure | Adaptation for JEE |
| --- | --- | --- |
| [Avenquellis web](https://github.com/TARUNTEjjjj/avenquellis-web) | Overview, test arena, chapter library, problem collection, generator, progress and sources; local saved sessions; static JS UI and optional Pages Functions. | Preserve workspace and study flow across Physics, Chemistry and Mathematics. |
| [Avenquellis question engine](https://github.com/TARUNTEjjjj/avenquellis-question-engine) | Reproducible original families, separate source metadata, C++20/JS interfaces, Wasm artifacts and parity checks. | Keep original generated practice separate from immutable historical questions. |
| [Avenquellis proof grader](https://github.com/TARUNTEjjjj/avenquellis-proof-grader) | Separate assessments, evidence and provenance; explicit limits on model judgments. | Objective PYQs need source-specific marking rules rather than generic proof rubrics. |
| [Axiom SAT](https://github.com/TARUNTEjjjj/axiom-sat) | Pure question/session/progress modules; stable identities; timed reload; retries; validated local backups. | Retain deterministic state, explicit deadlines and validated persistence. |

The existing CMI archive is a linked catalog, not a complete historical transcription. Its generated families and the SAT bank cannot substitute for JEE PYQs. Existing CMI mathematical proof marks and SAT-style correct/incorrect grading do not establish JEE marking policies.

## Responsibilities

```text
Browser workspace
  ├── practice/session state → question and marking engines
  ├── progress and revision → stable question identities
  └── archive browsing → data/archive.json
                         └── src/archive/index.js

Editorial input → src/archive/questions.js → scripts/import-pyq.mjs
                 whole-batch validation      data/imports/validated/
                                             (staged, not app-integrated)
```

| Module | Responsibility |
| --- | --- |
| `src/archive/index.js` | Pure archive validation, conjunctive filtering, honest coverage statistics. |
| `src/archive/questions.js` | Strict reviewed-question batch schema, supported answer/marking validation and paper/source cross-references. |
| `scripts/validate-archive.mjs` | Validate a catalog and print measurable coverage counts. |
| `scripts/import-pyq.mjs` | Stage a fully valid local batch without overwriting or partially importing it. |
| `data/archive.json` | Source-linked paper metadata. No question text or authoritative marks are inferred from this list. |
| `data/imports/validated/` | Reviewed structured batches awaiting integration. Not consumed by the practice UI in this release. |
| `tests/archive.test.mjs` | Coverage semantics, schema failures, combined filters, key constraints and import write behavior. |

The archive module has no dependency on the DOM, storage or network. It can be reused by the browser, Node scripts and future backend services. Files use ES modules. The first version keeps these boundaries inside one project; a future repository split can follow the three-repository Avenquellis convention without changing the data identities.

## Contracts that must remain stable

- A year in the archive means a source is listed for that year. Completeness is a separate property.
- Paper and question IDs are persistent identities, not positions in an array. Catalog additions must not change saved sessions.
- Original generated practice, linked historical papers and reviewed transcriptions carry different provenance.
- No common marking default is assumed across years or sections. Unknown metadata stays `null`.
- Reviewing an answer in practice must not silently replace a learner's first-attempt history.
- Import validation precedes persistence. Invalid batches preserve existing data.
- Source and editor claims remain inspectable. Well-formed records alone do not prove mathematical correctness.

## Limits and next integration work

The link catalog contains source metadata, not a full question database. The structured importer supports single-choice, multiple-choice and decimal numeric responses, with explicit subset partial-credit rules. It deliberately refuses unsupported written, matching and exceptional marking formats. The source-linked archive reports zero practice-ready items even if separate staged files exist.

The staging CLI already resolves paper IDs, year, era, subject and source URLs against the catalog. Before wiring staged PYQs into practice, preserve source and answer-key versions, validate diagrams and shared passages, add exact scoring tests for official section examples, and inspect question rendering. Practice content should be lazy-loaded by year or subject as the corpus grows. Large archives should not be stored as one synchronous `localStorage` payload; keep progress identifiers separate from immutable question data.

The local-first study model does not supply cross-device accounts or authoritative proctored grading. Browser-delivered keys are inspectable. An eventual competitive mode would need server-held keys and authenticated attempts, whereas ordinary self-study can remain local.

## Validation

```sh
node --test tests/archive.test.mjs
node scripts/validate-archive.mjs
```

The tests verify implementation behavior, including no-write on rejected imports and distinct listed-year versus full-paper counts. They do not certify remote links, transcription accuracy, the legality of redistribution or the completeness of historical coverage. The content pipeline records which evidence is still needed.

## Public Cloudflare release

Production is a static Cloudflare Pages deployment. `scripts/build.mjs` emits an immutable `releases/<content-hash>/` tree, a revalidated root document, and a scoped service worker. The worker verifies SHA-256 digests before caching a release; it requests the canonical release directory URL to avoid Pages' index.html redirects. It serves a consistent release shell and waits for old tabs to close before activating an update.

`src/learning/storage.js` holds an exclusive Web Lock for the editing tab. Other tabs can inspect the workspace and receive browser storage updates, but cannot overwrite saved state. If locks are unavailable, the app permits in-memory practice with an explicit export reminder. There is no cross-device account or server-side data store.

All fonts, application code and archive metadata are self-hosted. External paper sources are navigation links, excluded from offline caching and load tests. CI runs state/content/build tests and rejects release hashes, payloads or static-only packaging that violate the release gate. See [capacity notes](CAPACITY.md) for the unverified 10,000-concurrent-user target and the test profile.

## Study workflow (0.3)

The dashboard, test centre, analysis, report and notebook are separate vanilla UI modules under assets/. Session state remains pure and deterministic. Every positional response/flag/timing/visit array follows the same identity permutation when a PCM set is grouped by subject.

Active timing uses a monotonic browser interval and is bounded by session wall-clock timestamps, accumulated only while the practice screen is visible. Visibility changes, navigation, response entry and submission flush timing; an expiry transition records completed history immediately. Opening setup with an existing session does not count activity or replace its answers until the learner starts a new set.

History is a versioned array of at most 50 completed sessions. Restore reconstructs questions and grades; no stored keys/totals are trusted. First saved session ID wins. Notebook annotations hold only original question identities, cause, bounded text and a resolution flag; first-attempt grades are recomputed. A failed persistence callback leaves the draft available. Neither manual resolution nor a successful retry changes the first attempt.

The exclusive-writer rule applies to all new edits. Reader tabs can inspect historical reports and notebook filters without session timing events resetting their view. Storage remains local, with no runtime backend requests.
