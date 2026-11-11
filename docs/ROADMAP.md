# Building the complete Vedaris archive

The ambition is a complete, reliable JEE Advanced learning platform. The current release adds reviewed complete historical papers, chapter practice and full-paper mocks; it does not complete the forty-year content project.

## 1. Establish the full source corpus

- [x] Catalog 40 official English papers, 2007–2026.
- [x] Observe source collections for every year 1978–2006 and label incompleteness.
- [ ] Obtain complete, suitably reusable legacy papers, including separate subject papers and screening/main stages where applicable.
- [ ] Track missing pages, versions, revised keys and withdrawn questions.
- [ ] Record answer keys and original marking instructions for every section.

Acceptance: every claimed complete paper has all original pages and its format independently checked; external links alone do not meet this condition.

## 2. Build the question-level corpus

- [x] Versioned reviewed-question schema and atomic staging CLI.
- [ ] Transcribe statements, diagrams, options, passages, matrices and units.
- [ ] Require independent transcript, answer and marking review with evidence.
- [ ] Add provenance-preserving assets with checksums and source permissions.
- [x] Publish year/subject/chapter coverage with question-level counts and explicit gaps.
- [x] Wire reviewed imports into the practice registry after a public-content build gate.

Acceptance: each playable PYQ resolves to an original paper, page and question number, a reviewed key, and the exact section marking scheme. Generated variants must never be labelled historical questions.

## 3. Reproduce each historical exam faithfully

- [x] Original-practice single, multiple and exact numerical grading.
- [x] Implement exact keys, ranges, disjoint ranges, alternative option sets, matching lists and passage groups.
- [ ] Add historical written-answer review for legacy subjective papers.
- [x] Encode section-specific partial/negative marks, instructions, duration and marks.
- [ ] Add full two-paper sessions and intentional inter-paper breaks where supported by that year's instructions.
- [x] Verify representative complete papers against independent official totals and answer fixtures.

Acceptance: no generic universal JEE scoring rule; each exam uses a versioned, source-backed configuration.

## 4. Deepen the learning experience

- [x] Chapters, question studio, sessions, saved questions, review and browser-local progress.
- [ ] Expand every chapter with independently audited multi-concept Advanced-level practice.
- [x] Add learner-labelled mistake causes, revision notebook and exact-question retries.
- [x] Preserve 50 completed test reports with active question timing and subject analysis.
- [ ] Connect topic relationships and reviewed Advanced-level content to revision recommendations.
- [x] Render mathematics and chemical structures accessibly with reviewed diagrams.
- [ ] Add comprehensive workspace backups and optional cross-device sync with explicit account design.
- [ ] Establish accessibility, mobile, offline and large-corpus performance release gates.

A large line count or an unreviewed data dump is not a content-completeness milestone. Release metrics report what students can actually use.
