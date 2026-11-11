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
