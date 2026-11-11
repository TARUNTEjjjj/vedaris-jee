# Cloudflare release verification

Checked 11 November 2026. Production target: `https://vedaris-jee.pages.dev/`.

## Automated checks

- Original question schema and independent mathematical audits, exact numeric grading, negative and partial marks.
- Wall-clock expiry, restore, retries, first-attempt deduplication and validated progress backups.
- Source catalog coverage and reviewed import evidence.
- Deterministic versioned build and Cloudflare canonical URL handling.
- Service-worker integrity checks, cache isolation, failed-install rejection and active-tab update safety.
- Exclusive writer ownership, reader behavior, release/reacquisition and unsupported-browser fallback.
- Static-only output, hash integrity and compressed bundle size budget.

## Browser checks on Cloudflare preview

- Overview, archive metadata and self-hosted fonts load without console errors.
- Atomic structure defaults to three questions; unavailable 6/12/30-question choices are disabled.
- Numerical response and flag persist through reload.
- Second tab displays read-only state and disabled response/submit controls.
- Second tab receives saved response and flag changes.
- Closing the writer and reloading the reader restores editing without losing the saved response.

## HTTP smoke probe

The preview probe checked 86 requests at a maximum of five in flight from one developer machine. It verified release hashes, root release identity, immutable asset caching, revalidated entry points, security headers, and a real 404 response. All checks passed. This was a bounded smoke check, not a 10,000-user load test. The production probe is recorded separately after deployment.

## Scope limits

The 10,000-concurrent-session target remains unmeasured. The k6 profile is supplied for a representative staged run; it does not execute in CI or deployment. External PYQ publishers are excluded. Historical question-level transcription remains unfinished and is independent of hosting readiness.

## Study workflow release 0.3

- 60 automated tests pass, including aligned PCM-session restore, chapter-specific setup routes, expiry during navigation, question timing, 50-session history bounds and notebook persistence/escaping.
- Browser verified: a six-question PCM session persisted its answer and review flag through reload; subject navigation and submission summary worked; one correct, one wrong and four skipped answers yielded 4/23 and 50% attempt accuracy with subject timing.
- Incorrect answer appeared in the notebook. Cause and note survived reload. An exact-question revision accepted 4/7; the original 50% first-attempt accuracy remained intact, while history grew to two sessions.
- Reader tab opened an old report, retained its Incorrect filter while the writer changed an active response, and kept retry/edit controls disabled.
- Chapter links opened the selected chapter setup after a completed session. Dashboard and test workspace fit a 390×844 viewport without document horizontal overflow.
- Cloudflare preview displayed the dashboard and test centre with no console warnings/errors. Its 96-request, concurrency-five HTTP smoke check passed; p50 39ms, p95 543ms from one developer machine. This is not a concurrency capacity measurement.
- Complete offline build: 336,578 raw bytes, 138,871-byte gzip estimate, 29 immutable release assets, no runtime external dependencies or server functions.


## Reviewed PYQ release 0.4

- 108 automated tests pass. The complete corpus has 102 questions, 39 verified diagram files and two ready 2023 papers, each 51 questions / 180 marks / 180 minutes. All canonical keys grade for full credit; an additional 390 canonical/subset checks were run during review.
- Original explanations, chapter assignments, source pages, final-key evidence and asset hashes are recorded in `content/review-audit.json`. These are Codex-assisted reviews, not human editorial certification.
- Browser checked: full Paper 1 retained its numerical answer and review flag through reload. One correct numerical answer, one partial multiple-choice response and one incorrect matching answer scored 4/180 with subject totals 4, 1 and −1.
- Paper 2 accepted the exact upper boundary 8.4 for Physics Q15 and awarded the two official three-mark bonuses even when blank: 9/180, one correct and two bonuses, with bonuses excluded from accuracy.
- Matching-list diagrams and shared passages rendered; solutions remained hidden until submission. A reader tab kept its open solution and Correct filter during writer updates and could not retry or edit responses.
- Chapter links selected the correct subject and chapter. A 390×844 mobile question screen displayed native MathML without horizontal document overflow. Browser console had no warnings/errors.
- Cloudflare preview: a single actual chapter question scored 3/3; backup export and restore retained the report and recalculated scores. Preview asset/hash/header/404 checks passed: 143 requests, concurrency limited to five, p50 49 ms and p95 508 ms from one machine.
- Release `13f305902dcad30826e6`: 76 immutable assets, 2,552,580 raw offline bytes, 1,378,271-byte gzip estimate. The offline budget is now 2 MiB compressed to include the checked figures; each file remains below 1 MiB. No external runtime dependencies or server functions.
- Remaining content scope: 2023 is the only playable exam year. The 40+ year bank is not complete. No 10,000-user capacity result is asserted.
