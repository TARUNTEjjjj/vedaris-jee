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
