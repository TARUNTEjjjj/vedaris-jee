# Written-answer review for legacy papers · design

Older IIT-JEE papers asked for written derivations. The objective contract (exact keys, ranges, option sets) cannot evaluate a derivation, and Vedaris will not guess. This document records the paper-selection audit, the evidence a paper needs before learners can use it, and the review workflow implemented in `src/content/written-review.js`.

**Status: no legacy paper is reviewable yet.** The engine and its publication gate exist; no question has been transcribed, and nothing in the learner interface offers written review.

## Paper-selection audit (19 November 2026)

The issue asks for a source-backed legacy paper with its original response format and marking instructions documented before any UI is designed. Only provenance already recorded in this repository was eligible.

| Checked | Finding |
| --- | --- |
| `data/archive.json`, 39 records for 1978–2006 | Every record is an ExamGOAL third-party `partial-collection` with verification `link-observed`. `maxMarks` and `durationMinutes` are `null`. None records an original response format or marking instructions. |
| `data/archive.json`, 2007–2026 records | Official papers, but objective-response papers; they are not written-answer papers. |
| `content/*.json`, `content/*audit*.json`, `content/math-review-checks.json` | 2022–2026 objective questions only. No rubric, written response format or legacy marking record. |
| `docs/`, `content/README.md` | The content pipeline states that older subjective questions need a faithful response and review format, and that the earlier older-source audit found partial indexes and reprints without an established redistribution grant. |

**Result: no legacy paper qualifies.** Choosing one would require new source work (complete original pages, the printed or officially published marking instructions, and reuse permission), which this change does not claim. The gate test runs against the committed archive and confirms that every pre-2007 record is blocked.

## Evidence required before a paper can be published

A written paper record (`validateWrittenPaper`) is accepted only when all of the following hold:

| Requirement | Recorded as |
| --- | --- |
| A complete, inspected source paper | Archive record with `coverage: full-paper`, `verification: pdf-verified`, recorded maximum marks and duration. |
| Original response format | `responseFormat.kind` (`written-derivation` or `written-short-answer`), a description, and the source URL and page where the paper states it. |
| Marking instructions | A summary of the original instructions, their source URL and page, who recorded them and when. |
| Question identity | Stable ID, original printed question number, subject, source URL and page, complete statement, maximum marks. |
| Rubric provenance | Rubric source URL and page; criteria whose marks sum to the question's maximum. |
| Partial marks | A criterion may allow partial marks only when `partialMarksSource` records where the source says partial marks are given. Otherwise a criterion is awarded all or nothing. |
| Worked explanation | Steps, author, and an explicit review status (`unreviewed`, `ai-assisted` or `expert-reviewed`; reviewed states need reviewer and date). |

If a historical paper publishes only total marks per question, its rubric is one criterion with no partial marks. Vedaris must not invent step marks that the source does not support. Schema validity does not prove that a transcription or rubric is faithful; the evidence fields make that claim checkable.

## Review workflow

1. **Record work.** The learner types or pastes their working (up to 20,000 characters). Saving work changes nothing about reviews.
2. **See the worked explanation.** The explanation is shown with its author and review status, after the learner chooses to reveal it.
3. **Record a review.** Reviews are appended, never edited in place:
   - `self`: the learner records marks per rubric criterion. A criterion can be left unknown (`null`).
   - `expert`: requires a named reviewer, an optional qualification, a real review date and a short description of how the review was carried out.
   - `automated-assist`: names its tool and version and may attach annotations only. Any attempt to include marks, criteria, a status or a correctness verdict is rejected.
4. **Report.** Status is `expert-reviewed` (latest expert review), otherwise `self-reviewed` (latest self review), otherwise `unreviewed`. A total is reported only when every criterion has recorded marks; otherwise the total is `null` and the number of unknown criteria is shown. Unknown is never displayed as zero. Reports always carry `automaticCorrectnessJudgment: false`.

The interface wording must say who awarded marks ("4 of 6, self-reviewed"), never "correct" or "incorrect".

## Persistence and export

`restoreWrittenWorkspace` follows the repository's storage contract: corrupt or tampered data returns `null` so the caller can preserve it, stored totals and statuses are discarded and recomputed, and every review is revalidated against the current rubric. Scoring fields in an automated-assist record make the whole workspace invalid rather than being silently accepted.

`exportWrittenReview` produces JSON with the paper identity, response format, marking provenance, and for each question: identity and printed number, source page, rubric and partial-mark sources, explanation review status, learner work, every review with its kind, recomputed status and marks, and a notice that no automatic judgment was made.

## Remaining work

- Obtain and verify a legacy written-answer paper with complete pages, its original marking instructions and reuse permission; record them in the archive and a written paper record.
- Verify real sample responses against that paper's real rubric (current tests use a clearly labelled synthetic fixture only).
- Any expert review of rubrics, explanations or sample responses. None has occurred.
- Learner interface and browser storage wiring, once a paper passes the gate.
