# Vedaris content pipeline · 0.4

Release 0.4 includes **102 actual JEE Advanced questions**, covering the complete 2023 English Paper 1 and Paper 2. Each paper contains 51 questions, carries 180 marks and has a 180-minute timer. The bank includes chapter assignments, original worked explanations, 39 local diagram files, original section marking and final-key exceptions.

The historical link archive remains a separate collection. Its 1978–2026 span is not a claim of 49 complete, transcribed or solved examination years. Only the two 2023 papers are currently playable as full historical mocks. Original generated practice is separately labelled and never fills gaps in a historical paper.

## Evidence and review

The transcription source is [propar2750/jee-advanced](https://huggingface.co/datasets/propar2750/jee-advanced/tree/2580e96f1e74343e1d478509187f16fe58dbab85), pinned to revision `2580e96f1e74343e1d478509187f16fe58dbab85`. Its MIT notice covers the dataset's transcription, structure and annotations; the dataset attributes original examination questions, keys and figures to the organising IITs. `content/UPSTREAM-LICENSE.txt` preserves the upstream notice. Do not infer a transfer of rights to third-party books or worked solutions.

The included questions were compared with the official [2023 Paper 1](https://jeeadv.ac.in/past_qps/2023_1_English.pdf) and [Paper 2](https://jeeadv.ac.in/past_qps/2023_2_English.pdf). Final keys were recovered from archived copies of the official documents: [Paper 1 final key](https://web.archive.org/web/20230618114607/https://jeeadv.ac.in/documents/Paper1_Final_Answer_Keys.pdf) and [Paper 2 final key](https://web.archive.org/web/20230618114609/https://jeeadv.ac.in/documents/Paper2_Final_Answer_Keys.pdf). These are archived official-origin documents, not claims that the old live URLs still work. The [official 2023 report](https://jeeadv.ac.in/reports/2023.pdf) also identifies the dropped Physics questions.

`content/review-audit.json` records question-level source pages, answer checks, review notes, any escaping corrections, dataset revision, source-document hashes and diagram hashes. The worked explanations and chapter assignments were authored and checked by Codex against those sources. They are independent Vedaris explanations, not official IIT worked solutions or a claim of human editorial certification. Upstream automated review flags are retained as upstream metadata; they do not replace this source comparison.

A review record is an assertion with a named reviewer, date and evidence URL. Schema validation cannot authenticate an editor, establish legal permissions, or prove a mathematically correct explanation. Source inspection and derivation remain necessary.

## Coverage vocabulary

| Stage | Meaning |
| --- | --- |
| `link-observed` | A listing exposed a link; its destination may not have been inspected. |
| `http-verified` | A document was reached; content and completeness still require review. |
| `pdf-verified` | The PDF identity was inspected; this does not imply question-level review. |
| `full-paper` | The source represents a complete paper; this alone does not unlock a mock. |
| `partial-collection` | Selected historical material, with no full-paper claim. |
| `source-linked` | The source catalog has a record, without implying a playable question. |
| `practice-ready` | A structured question carries the required reviews and passes the runtime schema. |
| Complete playable paper | Every ordered source question, required asset, solution and section rule passes the completeness gate. |

The link catalog's `practiceReadyCount` remains zero because that catalog contains links, not questions. Playable counts come from the separate reviewed registry and compiled content manifest.

## Source catalog and stable identities

`data/archive.json` is version 1 and contains `checkedAt`, `sources` and `papers`. Each paper records its year, exam era, subject, paper number, source identity, URLs, verification, coverage and nullable question count, duration and maximum marks. Unknown values stay `null`; they are not guessed from a label. Exam identity is `iit-jee` before 2013 and `jee-advanced` from 2013.

Paper IDs and content IDs are persistent identities. The current questions use IDs such as `2023_P1_Chemistry_Q01-v1`, retaining the original subject and printed question number. An incompatible correction requires an explicit content-version/migration decision; do not silently repurpose a saved identity. `bankId` binds saved historical attempts to the compatible bank. Stored attempts hold IDs and responses, never a trusted answer key or score.

```sh
node scripts/validate-archive.mjs
node scripts/validate-archive.mjs /path/to/candidate-archive.json
```

## Staging and runtime integration

The legacy staging CLI validates `{ "version": 1, "questions": [...] }` batches against a selected archive and writes them exclusively under `data/imports/validated/`. It neither overwrites an existing file nor publishes a partly valid batch. Run one importer at a time. Staging does not add content to the application.

```sh
node scripts/import-pyq.mjs /path/to/reviewed-batch.json
node scripts/import-pyq.mjs /path/to/reviewed-batch.json --catalog /path/to/archive.json
```

`src/archive/questions.js` supplies the base staging schema. `src/content/catalog.js` adds the richer integrated contract, including discrete numerical alternatives, official bonus questions, matching lists, chapter review, solutions and verified asset inventory. The staging CLI remains deliberately narrower; use the runtime gate for the additional supported formats rather than coercing them into a different question type.

Integrated source files are `content/2023-p1.json` and `content/2023-p2.json`, explicitly listed by `content/catalog.json`. Each question requires:

| Field group | Required evidence or content |
| --- | --- |
| Identity | Stable ID, known paper ID, year, exam, subject, original section and question number. |
| Source | Original document URL and positive 1-based PDF page. |
| Transcript | Complete statement, options, shared passage and any matching lists. |
| Answer and marks | Explicit supported key and actual section-specific correct, wrong, blank and partial marks. |
| Reviews | Separate transcript, answer and marking records with reviewer, date and evidence URL. |
| Chapters | Existing chapter IDs for the question's subject and a chapter review. |
| Solution | Nonempty newly authored steps, attribution URL and solution review. |
| Assets | Safe local path, semantic alternative text, statement/option/solution role and source URL; present in the verified build inventory. |

Diagram review compares labels, geometry, arrows, molecular bonds and graph values against the source. Matching lists preserve both columns and labels. Shared passages are included once per question. Alternative text must communicate the depicted information; generic labels such as “Figure 1” are insufficient.

## Exact answers and marking

Runtime answer records include:

```json
{"type":"single-choice","value":"B"}
{"type":"multiple-choice","value":["A","C"]}
{"type":"numeric","value":"0.31","acceptedRange":["0.30","0.32"]}
{"type":"numeric","value":"80","acceptedValues":["80","150","220"]}
{"type":"bonus","value":null}
```

Numerical keys and bounds are decimal strings. Student decimal or fraction responses are parsed as exact rational values without `eval`; no generic floating-point tolerance is added. Ranges are inclusive and must be supported by the final key. Discrete alternatives are not expanded into a continuous interval: 2023 Paper 1 Physics Q9 accepts 80, 150 or 220, and does not accept a value merely between them.

Multiple-correct partial credit is an explicit list of permitted selected subsets. For the included 2023 sections, choosing all correct options earns +4, an allowed proper subset of correct options earns its specified partial award, a wrong selection earns −2, and a blank earns zero. Single-choice/matching sections use +3/−1/0. Integer sections use +4/0/0, and Paper 2 paragraph numerical sections use +3/0/0. These are 2023 rules, not defaults for future years.

Paper 2 Physics Q16 and Q17 were officially dropped with marks for all. Their records give +3 for every response, including blank, and report status `bonus`. Bonus marks contribute to the score but not attempted-question accuracy. Do not invent a replacement key or fabricate a conventional solution for a dropped problem; the review explains its official disposition.

Matching-list questions with an objective option key remain single/multiple choice and preserve `matchingLists`. Written proofs, arbitrary symbolic answers and unsupported historical matrix response formats remain outside this release's grading contract.

## Full-paper completeness gate

A full mock must match the source catalog's question count, maximum marks and duration. Its reviewed section configuration supplies question order, subject, response format, source instruction page and marking. Every ordered question must exist exactly once, have its required reviews and solution, and agree with its section rules. Both 2023 papers have Mathematics, Physics and Chemistry in original source order.

Missing questions, unknown source totals, missing subjects, duplicate IDs, absent assets or inconsistent marking keep the mock closed. Neither original generated questions nor a partial historical collection can complete a paper.

## Build, delivery and verification

`scripts/build-content.mjs` reads only explicitly listed reviewed bundles, validates the registry and compiles statements, options, matching lists and solutions. `scripts/render-math.mjs` uses vendored KaTeX at build time to emit native MathML with untrusted commands disabled. Unsupported notation fails the build; the browser does not fetch a math-rendering CDN or run KaTeX.

Compiled paper bundles live under the immutable release's `data/content/` directory. Their manifest carries SHA-256 hashes, counts, paper configurations and the asset inventory. The browser downloads the bank when PYQ practice opens, verifies each bundle's hash and rebuilds the validated registry. The current bank loads both small paper bundles together; partitioned loading for a much larger corpus remains future work.

```sh
node --test tests/content-runtime.test.mjs tests/content-session.test.mjs tests/content-ui.test.mjs tests/render-math.test.mjs
npm run build
```

Tests cover exact/range/discrete grading, subset partial credit, bonus rules, full-paper completeness, deadlines, corruption, bounded timing, immutable identities, report regrading, backup history and reader-tab lifecycle. Source and rendered-page inspection complement tests; automated tests alone do not certify a transcription. Expansion beyond 2023 follows the same evidence and completeness gates before increasing published playable counts.
