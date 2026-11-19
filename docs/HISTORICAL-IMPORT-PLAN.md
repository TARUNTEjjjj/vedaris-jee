# Historical paper import plan

**Years 1978–2021 are still not playable.** This plan bounds the first historical import and tracks it. It does not add questions and it does not make the forty-year archive available. It records what must be known about a paper before any of its questions can be staged or published, and what must be true before its full mock unlocks.

The plan is `content/historical-import-plan.json`, validated by `scripts/import-plan.mjs` (build tooling; it is not shipped to browsers). It holds **evidence about** papers: identities, pages, hashes, keys, sections, permissions, reviews and revisions. It never holds statements, options, figures or solutions; the validator refuses those fields anywhere in the file. No paper content was copied or transcribed to produce it.

## First tranche: 2021 Papers 1 and 2

| | |
| --- | --- |
| Papers | `official-2021-paper-1-en`, `official-2021-paper-2-en` (official English PDFs, catalogued as `pdf-verified` full papers) |
| Why first | Most recent unplayable year, directly before the reviewed 2022–2026 bank. Same `jee-advanced` exam identity and recorded 180-minute duration. As the nearest year, probably closest in format to papers the runtime already grades. That is **unverified** until the sections are recorded from the PDFs. Two papers keep review bounded and would complete one year. |
| Next candidates | 2020 and 2019, Papers 1 and 2 |
| Selected by | Claude, as an AI-assisted proposal on 2026-11-19 |
| Owner approval | **Pending.** The owner may replace the tranche; edit `tranches[0]` and re-run the checks. |

Earlier years are deferred deliberately. Before 2013 the exam is IIT-JEE, and before 2007 the catalogue holds only partial or third-party collections. Legacy subjective papers and screening/main stages need response formats that the current grading contract does not support. They must not be silently converted into objective questions.

## What the plan records for each paper

| Requirement | Plan field | Recorded when |
| --- | --- | --- |
| Source completeness | `source.questionPaper.{sha256,pageCount,checkedBy,checkedAt}`, `completeness.{status,missingPages}` | Someone checks the PDF page by page. `complete` is refused while any page is missing. |
| Original page and question references | `questions[].{subject,number,section,pdfPage}` | Every printed question is listed in order. A missing question needs a `missing-page` revision. |
| Final keys | `source.finalKey.{status,url,sha256,archivedOfficialOrigin}`, `questions[].finalKey.{status,evidencePage}` | A `verified` key needs its hash. Every question's key cites its evidence page. |
| Section instructions | `source.instructions.pages`, `format.sections[].{type,marking,instructionPage,questionNumbers}` | Each section's marking, response type and instruction page come from the paper. |
| Provenance | `provenance.{transcriptSource,transcriptRevision}`, `assets[].{sourcePage,derivedFrom,sha256}` | A transcript source is pinned to a revision. Every figure is checksummed. |
| Reuse permission | `permissions.{questionText,figures,answerKey,explanations}` | **Owner task.** Granted or `not-required` decisions need a basis, the deciding person and a date. `granted` also needs evidence. The validator refuses a decision without them, and every component starts as `pending-owner`. |
| Missing pages, revised versions, withdrawn questions | `revisions[]` with `kind` (`missing-page`, `revised-paper`, `revised-key`, `withdrawn-question`, `bonus`, `translation-discrepancy`, `other`), evidence URL, date, `open`/`resolved` | Withdrawn and bonus entries also record the official marks and whether blank responses receive them. A question marked `withdrawn` or `missing` without a matching revision is refused. |
| Transcript, answer and marking review | `questions[].reviews.{transcript,answer,marking}[]`, each `kind: "ai-assisted"` or `"human"` | Kinds are never merged. A reviewer named as AI, Codex, Claude, a model or automation cannot be recorded as `human`. |

## Gates

1. **Staging.** `node scripts/import-pyq.mjs batch.json [--catalog …] [--plan …]` validates the plan. It refuses any question from a paper before 2022 (`policy.appliesBeforeYear`) unless the paper is selected, the tranche is owner-approved, question-text, answer-key and explanation permissions are granted or not required, the PDF hash and page count are recorded, transcript provenance is pinned, and the question is listed and is not missing or withdrawn. Without a plan file, every historical question is refused.
2. **Build.** `npm run build` validates the plan and applies the same checks to any listed content bundle for a historical paper. Every figure in such a bundle must appear in the plan with a matching SHA-256. Compiled bundles keep their existing release hashes.
3. **Full mock.** A historical paper configuration in `content/catalog.json` makes the build fail until the plan's mock gate passes. That needs: a complete source with no missing pages; a verified final key; recorded instructions; recorded question count, marks and duration that match the source catalog; sections listing every question once, with section marks summing to the total and all three subjects present; every question staged with a recorded key and all three reviews; no open revisions; and every permission settled. `policy.requireHumanCertificationForMock` is `true`, so each review must also include a `human` record. The runtime completeness gate in `src/content/catalog.js` still applies afterwards.

`node scripts/validate-archive.mjs` validates the plan with the archive and prints blocker counts. `node scripts/import-plan-status.mjs` prints the block below. `npm test` fails if the committed block is stale.

## Owner tasks (pending)

- Approve or change the tranche (`tranches[0].ownerApproval`).
- Decide reuse for question text, figures, answer keys and explanations for each paper, with basis and evidence.
- Arrange **human** transcript, answer and marking certification. AI-assisted checks may support a reviewer, but they are recorded as `ai-assisted` and do not satisfy the mock gate while human certification is required. Relaxing that policy is an owner decision. It would match the AI-assisted review of the current 2022–2026 bank, and it must stay visible in the plan and in the paper's explanations.

Source inspection (hashes, page counts, completeness, keys, instructions) is unassigned. Whoever does it records their name and date in the plan.

## Usable coverage and remaining gaps

<!-- import-plan-status:start -->

Generated by `node scripts/import-plan-status.mjs --write` from the plan dated 2026-11-19.

- **Playable now:** 510 reviewed questions from 10 complete papers, years 2022, 2023, 2024, 2025, 2026.
- **Historical years not playable:** 44 (1978–2021). Playable historical questions: 0.
- **Catalogued as official full papers but untranscribed:** 15 years (2007–2021).
- **Only partial or third-party collections catalogued:** 29 years (1978–2006). These cannot complete a paper.

| Tranche paper | Stage | Questions referenced / staged | Certification | Publication blockers | Full-mock blockers |
| --- | --- | ---: | --- | ---: | ---: |
| official-2021-paper-1-en | planned | 0 / 0 | none | 6 | 10 |
| official-2021-paper-2-en | planned | 0 / 0 | none | 6 | 10 |

**official-2021-paper-1-en: what still blocks a full mock**

- Owner approval of tranche-1 is pending-owner.
- Reuse permission for questionText is pending-owner.
- Reuse permission for answerKey is pending-owner.
- Reuse permission for explanations is pending-owner.
- The question paper hash and page count are not recorded.
- Transcript provenance is not recorded.
- Source completeness is not-assessed.
- The final answer key is not-located.
- Section instructions are not recorded.
- Question count, maximum marks and duration are not all recorded.

**official-2021-paper-2-en: what still blocks a full mock**

- Owner approval of tranche-1 is pending-owner.
- Reuse permission for questionText is pending-owner.
- Reuse permission for answerKey is pending-owner.
- Reuse permission for explanations is pending-owner.
- The question paper hash and page count are not recorded.
- Transcript provenance is not recorded.
- Source completeness is not-assessed.
- The final answer key is not-located.
- Section instructions are not recorded.
- Question count, maximum marks and duration are not all recorded.

<!-- import-plan-status:end -->
