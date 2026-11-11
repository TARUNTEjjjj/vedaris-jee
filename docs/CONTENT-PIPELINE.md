# Vedaris content pipeline · 0.5

Release 0.5 contains **510 actual JEE Advanced questions**, covering both English papers for every year from 2022–2026. Each of the ten papers carries 180 marks and lasts 180 minutes. The bank includes 170 questions per subject, chapter assignments, original explanations, 279 unique local figures and the original section rules.

| Year | Paper 1 | Paper 2 | Per subject, both papers | Total |
| --- | ---: | ---: | ---: | ---: |
| 2022 | 54 | 54 | 36 | 108 |
| 2023 | 51 | 51 | 34 | 102 |
| 2024 | 51 | 51 | 34 | 102 |
| 2025 | 48 | 48 | 32 | 96 |
| 2026 | 48 | 54 | 34 | 102 |
| **Total** | **252** | **258** | **170** | **510** |

**The 40+ year playable bank remains unfinished. Years 1978–2021 are not playable.** The separate source archive spans 1978–2026; linked years and partial historical collections are not counted as solved questions or complete mocks. Original generated practice is separately labelled.

## Evidence and review

Transcripts and figure crops come from [propar2750/jee-advanced](https://huggingface.co/datasets/propar2750/jee-advanced/tree/2580e96f1e74343e1d478509187f16fe58dbab85), pinned to revision `2580e96f1e74343e1d478509187f16fe58dbab85`. Its MIT notice covers dataset transcription, structure and annotations; original examination questions, keys and figures are attributed to the organising IITs. `content/UPSTREAM-LICENSE.txt` preserves that scope. It does not grant rights in third-party books or worked solutions.

Questions and diagrams were compared against official papers. The [official archive](https://jeeadv.ac.in/archive.html) supplies 2022–2025 papers; the 2026 [Paper 1](https://jeeadv.ac.in/documents/p1_english.pdf) and [Paper 2](https://jeeadv.ac.in/documents/p2_english.pdf) come from the official documents directory. Final-key evidence includes archived official-origin documents for 2022–2024, the 2025 official papers with final-key overlays, and the 2026 [Paper 1](https://jeeadv.ac.in/documents/p1_solutions_final.pdf) and [Paper 2](https://jeeadv.ac.in/documents/p2_solutions_final.pdf) final keys. Exact document URLs, pages and hashes are recorded in the audit; an archived official-origin key is not described as a currently working original URL.

`content/review-audit.json` records source pages and hashes, individual answer checks, dataset revision, upstream review metadata, transcript normalizations and diagram provenance. Codex independently derived the Vedaris explanations and chapter assignments and checked them against those sources. This is **AI-assisted review**, not official IIT solutions or human editorial certification. Upstream automated flags do not replace source inspection.

Unresolved wording, ambiguous historical conventions and unexplained official alternatives remain explicit in affected explanations and audit notes. The accepted official key is preserved without inventing a derivation for an unexplained alternative or silently correcting the source. Review metadata names the reviewer, date and evidence; schema validation alone cannot prove a transcription, explanation or reuse permission.

The bounded older-source audit found partial commercial indexes, publisher reprints without an established redistribution grant, inaccessible scan links, and candidate datasets containing selected recent questions or statistics. Those findings concern inspected sources, not proof that no usable legacy dataset exists. Expansion needs authenticated paper/stage identity, complete question order, final-key evidence and appropriate provenance. Older subjective questions also require a faithful response and review format; they must not be silently converted into objective questions.

## Coverage vocabulary

| Stage | Meaning |
| --- | --- |
| `link-observed` | A listing exposed a link; its destination may be uninspected. |
| `http-verified` | A document was reached; its contents and completeness still need review. |
| `pdf-verified` | PDF identity was inspected, without implying question-level review. |
| `full-paper` | The source represents a complete paper; this alone does not unlock a mock. |
| `partial-collection` | Selected historical material with no full-paper claim. |
| `source-linked` | A source-catalog record, not necessarily a playable question. |
| `practice-ready` | A structured question has the required reviews and passes the runtime schema. |
| Complete playable paper | Every ordered question, asset, solution and section rule passes the completeness gate. |

The link catalog's `practiceReadyCount` remains zero because it contains links. Playable counts and year-by-PCM coverage come from the reviewed registry and compiled content manifest.

## Stable identities and publication inputs

`data/archive.json` records year, exam era, subject, paper number, URLs, verification and source coverage. Unknown totals stay `null`. Exam identity is `iit-jee` before 2013 and `jee-advanced` from 2013.

Content IDs such as `2023_P1_Chemistry_Q01-v1` retain the original subject and printed question number. Compatible expansion preserves the existing IDs and `bankId`; an incompatible correction requires an explicit version or migration decision. Stored attempts hold question IDs and responses, never an authoritative answer key or score.

`content/catalog.json` explicitly lists ten `content/YYYY-pN.json` bundles. Each integrated question requires:

| Field group | Required content or evidence |
| --- | --- |
| Identity | Stable ID, known paper, year, exam, subject, original section and question number. |
| Source | Original document URL and positive 1-based PDF page. |
| Transcript | Complete statement, options, shared passage and matching lists where applicable. |
| Answer and marks | Supported key and actual correct, incorrect, blank and partial marks. |
| Reviews | Separate transcript, answer and marking records with reviewer, date and evidence. |
| Chapters | Existing chapter IDs for its subject and chapter review. |
| Solution | Newly authored steps, attribution and solution review. |
| Assets | Safe local path, semantic alternative text, role and source URL; present in the build inventory. |

Diagram review compares labels, geometry, arrows, molecular bonds and graph values with the paper. Matching lists preserve both columns and labels. Shared passages remain available with each question. Alternative text describes the information depicted, rather than saying only “Figure 1”.

The staging CLI remains separate from publication:

```sh
node scripts/validate-archive.mjs
node scripts/import-pyq.mjs /path/to/reviewed-batch.json --catalog /path/to/archive.json
```

It validates `{ "version": 1, "questions": [...] }` against the base schema in `src/archive/questions.js` and writes exclusively under `data/imports/validated/`, without overwriting existing files or publishing a partly valid batch. Run one importer at a time. `src/content/catalog.js` supplies the richer integrated contract; formats outside the staging schema must pass the runtime gate rather than being coerced into another type.

## Exact answers and section marking

Supported answer records include:

```json
{"type":"single-choice","value":"A","acceptedOptionSets":[["A"],["B"]]}
{"type":"multiple-choice","value":["A","D"],"acceptedOptionSets":[["A","D"],["D"]]}
{"type":"numeric","value":"0.31","acceptedRange":["0.30","0.32"]}
{"type":"numeric","value":"80","acceptedValues":["80","150","220"]}
{"type":"numeric","value":"29.88","acceptedRanges":[["-29.95","-29.80"],["29.80","29.95"]]}
{"type":"bonus","value":null}
```

Numbers and bounds are decimal strings. Student decimal or fraction responses are parsed as exact rationals without `eval`; there is no generic floating-point tolerance. Ranges are inclusive. Discrete alternatives and disjoint intervals preserve excluded values: 2023 Paper 1 Physics Q9 accepts only 80, 150 or 220, while 2025 Paper 1 Chemistry Q11 accepts two separate signed ranges, not the interval between them.

An exact match to any `acceptedOptionSets` entry earns full credit before partial scoring. Permitted proper subsets and their marks are explicit; full-credit sets are excluded from that table. For example, 2022 Paper 1 Chemistry Q9 accepts A+D or D alone, with A alone worth +1. Selecting a wrong option follows the recorded section penalty.

Marking is never inferred from a global response-type default. The 2022–2025 multiple-correct sections use a −2 penalty; the 2026 multiple-correct sections use −1. Correct marks, partial marks and numerical penalties also follow their own source instructions. In particular, 2026 Paper 2 paragraph questions carry +2 each. Mock instructions display the actual sections before an attempt.

Officially dropped questions award their published marks to every response, including blank, and use report status `bonus`. Examples are 2023 Paper 2 Physics Q16/Q17 (+3 each) and 2024 Paper 2 Chemistry Q11 (+4). Bonuses count toward the score but not attempted-question accuracy; their explanations disclose the official disposition instead of supplying an invented conventional key.

Objective matching-list questions retain `matchingLists` and their option key. Written proofs, arbitrary symbolic responses and unsupported historical matrix-response formats remain outside the current grading contract.

## Full-paper completeness gate

A mock must match the source catalog's question count, maximum marks and duration. Reviewed sections supply order, subject, response format, source instruction page and marking. Every ordered question must exist once, carry its required reviews and explanation, and agree with its section rules. All three subjects must be present.

Unknown totals, missing questions, duplicate identities, missing subjects or assets, and inconsistent marking keep a full mock closed. Neither generated questions nor partial collections can complete a paper.

## Build, delivery and checks

`scripts/build-content.mjs` reads only the listed bundles, validates the registry and compiles prose, statements, options, matching lists and solutions. `scripts/render-math.mjs` uses vendored KaTeX with its chemistry extension to emit native MathML at build time. Unsupported notation fails the build; untrusted commands are disabled. The browser fetches no math-rendering CDN and runs no KaTeX.

Compiled bundles live in the immutable release's `data/content/` directory, with SHA-256 hashes, counts, paper configurations and an asset inventory. Each paper JSON is bounded below 1 MiB. The shell, fonts and content index are precached; paper bundles and figures are excluded from installation precache. Opening PYQ practice downloads all ten bundles with at most four concurrent requests, checks their hashes and reconstructs the registry. Figures load as their questions appear. Successfully verified content is cached on demand; a cache write failure does not block a valid online response. External source PDFs are never bundled or precached. Selecting only one paper's data is a future loading optimization.

```sh
npm test
npm run build
```

Tests cover exact numbers, ranges and alternatives, subset credit, bonuses, completeness, deadlines, corruption, bounded timing, stable identities, regraded backups and reader-tab behavior. Build checks cover MathML, hashes and release isolation. These software checks complement source inspection and independent derivation; they do not certify human review.
