# Vedaris content pipeline

The historical archive and the playable question bank are separate collections. A paper link makes a source discoverable. It does not establish that every question has been transcribed, that an answer key is correct, or that the paper is ready for automatic marking.

## Coverage vocabulary

| Field or stage | Meaning | What it does not establish |
| --- | --- | --- |
| `link-observed` | The source listing exposed this link. | The destination was downloaded or inspected. |
| `http-verified` | An HTTP check reached the document. | Its content, year, completeness or answer key was reviewed. |
| `pdf-verified` | The PDF was opened and its identity inspected. | Every question or solution was editorially verified. |
| `full-paper` | The source represents a complete paper. | A machine-readable reproduction is available. |
| `partial-collection` | The source contains selected historical material. | Complete subject or year coverage. |
| `unknown` coverage | Completeness has not been established. | A complete paper may be inferred from its label. |
| `source-linked` | A source record exists in the archive. | Any playable PYQ exists. |
| `transcript-reviewed` | An editor checked text, notation, diagrams and numbering against the source. | The answer or marking scheme was checked. |
| `answer-verified` | An editor checked the answer against identified key evidence. | Every marking rule is encoded. |
| `practice-ready` | Transcript, answer and marking reviews are recorded and the supported structured format validates. | This release has integrated the item into its practice engine. |

The middle editorial stages are a workflow, not fields accepted by the link catalog. The importer only accepts completed `practice-ready` records and places them in a staging directory. Earlier work should stay outside `data/imports/validated/`.

The dashboard's **years listed** count is the number of distinct years represented by archive records. The span 1978–2026 contains 49 years, but a 49-year listing is not a claim of 49 complete, digitized examination years. Full-paper, partial-collection, official-source and PDF-inspection counts remain separate. `practiceReadyCount` from the link catalog is always zero.

## Source catalog

`data/archive.json` uses version 1. It contains `checkedAt` as a real `YYYY-MM-DD` date, `sources`, and `papers`.

Each source has `id`, `title`, `url`, `authority` (`official` or `third-party`) and `notes`.

Each paper has:

```json
{
  "id": "jee-2024-paper-1",
  "year": 2024,
  "exam": "jee-advanced",
  "label": "JEE Advanced 2024 — Paper 1",
  "subject": "all",
  "paper": 1,
  "sourceId": "official-archive",
  "url": "https://example.org/paper.pdf",
  "sourceUrl": "https://example.org/archive",
  "verification": "link-observed",
  "coverage": "unknown",
  "questionCount": null,
  "durationMinutes": null,
  "maxMarks": null,
  "transcriptionStatus": "source-linked"
}
```

The example URL is deliberately illustrative and is not a source. All fields are required, including nullable ones. Unknown duration, marks, number of questions and paper number remain `null`. Subject is `all`, `physics`, `chemistry` or `mathematics`; paper number is `null`, `1` or `2`. Preserve historical exam identity: `iit-jee` before 2013 and `jee-advanced` from 2013. Use stable IDs and never silently repurpose them.

Validate with:

```sh
node scripts/validate-archive.mjs
node scripts/validate-archive.mjs /path/to/candidate-archive.json
```

Validation checks shape, URLs, identities, source relationships, dates, exam eras and enum values. It does not perform network checks or certify the evidence behind `coverage` and `verification`. Preserve inspection notes and source evidence during editorial review. Linking a publisher does not grant permission to redistribute its PDFs, solutions or illustrations.

## Reviewed question staging

The import file is `{ "version": 1, "questions": [...] }`. Each question requires:

| Field | Contract |
| --- | --- |
| `id`, `paperId` | Stable nonempty identifiers; `paperId` must exist in the selected source catalog. |
| `year`, `exam`, `subject` | Historical year, era, and one PCM subject. |
| `section`, `questionNumber` | Original nonempty printed identifiers, stored as strings. |
| `source` | `{url, page}` with positive 1-based page; URL must match the catalog paper URL or its source listing URL. |
| `statement` | Complete reviewed nonempty text; preserve shared setups and all information needed to answer. |
| `options` | For choice questions, 2–20 `{id, text}` records with unique IDs. Omit for numeric questions. |
| `answer` | One of the supported formats below. |
| `marking` | Explicit correct, incorrect and unanswered marks; optional explicit partial-credit cases. |
| `review` | Separate `transcript`, `answer` and `marking` records. Each is `{reviewer, reviewedAt, sourceUrl}`. |
| `status` | Exactly `practice-ready`. |

Supported answers:

```json
{"type":"single-choice","value":"B"}
{"type":"multiple-choice","value":["A","C"]}
{"type":"numeric","value":"1.25","acceptedRange":["1.24","1.26"]}
```

Numeric values are decimal strings. An optional accepted range must be explicitly supported by key evidence, not inferred as a generic tolerance. Omit it for an exact answer. This version does not support radicals, fractions, matching matrices, written answers, withdrawn questions or special bonus policies; do not coerce them into supported formats.

A marking example, solely to illustrate the schema:

```json
{
  "correct": 4,
  "incorrect": -2,
  "unanswered": 0,
  "partialCredits": [
    {"selected":["A"],"marks":1},
    {"selected":["C"],"marks":1}
  ]
}
```

This is **not** a default JEE marking scheme. Every item needs its actual section instructions and key evidence. Each partial-credit entry lists an exact nonempty proper subset of the correct options, with a positive award below full credit. Other selections receive the explicitly declared incorrect score; therefore enumerate every allowed partial-credit selection before approval. Automatic scoring of these staged records is not implemented in this release.

Run:

```sh
node scripts/import-pyq.mjs /path/to/reviewed-2024-paper-1.json
node scripts/import-pyq.mjs /path/to/reviewed-2024-paper-1.json --catalog /path/to/archive.json
```

The importer loads `data/archive.json` by default, or the explicitly selected catalog. It validates the catalog and resolves each `paperId`, requiring the same year and exam era. The question's subject must match the paper's subject unless the paper covers `all` subjects. Source URLs must match the paper document or its source listing; answer-key and marking-review evidence may have independent URLs.

The importer limits each input file to 20 MiB, validates the whole batch, rejects duplicate IDs and paper/subject/section/question identities, checks existing staged files against the selected catalog, and creates `data/imports/validated/<input-filename>.json` exclusively. It never overwrites an existing import. It does not write partial valid subsets when a batch fails. Run one import process at a time; concurrent imports to different filenames are not transactionally coordinated.

Review identities and evidence URLs are recorded assertions, not authenticated editor credentials. Validation cannot detect a fabricated review or a mathematically wrong but well-formed key. The importer does not verify URLs remotely or inspect the printed page. Integration must add diagram asset validation and question rendering review before staged content becomes available to learners.

## Route to a complete historical bank

1. Establish a source inventory for each year, paper and subject; disclose gaps explicitly.
2. Obtain an appropriate basis for hosting any reproduced content and record source provenance.
3. Transcribe text and diagrams while preserving original numbering and shared passages.
4. Check the transcript against the source, independently solve or check answers, and record the final key plus section instructions.
5. Encode and test the actual marking policy, including partial credit and exceptions.
6. Stage validated batches against the source catalog; resolve diagram assets during integration.
7. Test rendering and scoring against representative official examples, then publish counts based on integrated records.

Original generated practice must retain its own provenance and must never be relabeled as a historical question.
