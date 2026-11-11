# Vedaris

**A focused JEE Advanced workspace, built around understanding.**

Vedaris carries the chapter → practice → timed session → review → progress structure of [Avenquellis](https://github.com/TARUNTEjjjj/avenquellis-web) and [Axiom SAT](https://github.com/TARUNTEjjjj/axiom-sat) into Physics, Chemistry and Mathematics. Indian-rooted branding, an uncluttered workspace, and explicit content provenance are central to the project.

**[Open Vedaris on Cloudflare](https://vedaris-jee.pages.dev)** · [Content pipeline](docs/CONTENT-PIPELINE.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md)

## Current release: 0.3

| Capability | Shipped scope |
| --- | --- |
| PCM chapter library | 54 chapter records, 18 per subject; chapters without practice families are labelled |
| Original practice | 30 deterministic families, 10 per subject; finite seeded variants and worked solutions |
| Historical archive | 79 source records spanning every year **1978–2026** |
| Official full papers | 40 English papers from **2007–2026**, with HTTP, content-type and PDF-signature checks |
| Older source collections | 39 collections from **1978–2006**, explicitly labelled partial |
| Study dashboard | Daily first-attempt goal, seven-day activity, subject progress, resume and chapter recommendations |
| Test centre | 6/12/30-question original PCM sets plus custom chapter sessions; not calibrated full mock exams |
| Exam workspace | Subject navigation, five palette states, per-question active time, submission summary, autosave and reload resume |
| Performance analysis | Last 50 completed reports, score trends, subject breakdown, weak-chapter priorities and exact missed-question retry |
| Revision notebook | First-attempt errors and saved questions, cause labels, 1,000-character notes, resolution state and exact revision sets |
| Progress | First-attempt deduplication, 1,000-record bound, regraded JSON imports and exports |
| Question studio | Reproducible seeds, worked reasoning and saved questions |
| Paper workspace | External source link, independent study timer, saved working notes and notes export |
| Content ingestion | Strict reviewed-question schema, source and marking evidence, atomic staging, no silent publication |

**The 40+ year complete playable PYQ bank is not finished.** This release provides 49 years of linked sources, not 49 years of fully digitised papers. It currently includes **zero transcribed, automatically scored historical questions**. The older collections are incomplete; a 1978 source, for example, lists only two Physics questions. No claim of complete legacy coverage is made.

Original practice is distinct from PYQs. The present families are concept practice, not calibrated JEE Advanced mocks or a complete chapter curriculum. Vedaris does not predict a rank or admission outcome.

## Run locally

Node.js 22 or newer and Python 3 are sufficient. There are no npm dependencies or install step.

```sh
npm test
npm run validate:archive
npm run build
npm start
```

Open `http://127.0.0.1:4173/`. For direct source development, use `npm run serve`. Serve over HTTP; ES modules do not work correctly from `file://`.

The build uses an explicit public-file list, validates the archive, checks JavaScript syntax, and emits an asset-hashed offline cache. It does not publish documentation, tests, staged imports, credentials, or Git metadata. Self-hosted fonts are included in the offline cache; external papers are not. Existing app tabs must close before an installed update activates, so an active timed session is not interrupted.

## Repository structure

```text
assets/              Browser UI, responsive design, route controllers
src/questions/       PCM taxonomy, seeded generators, exact answer grading
src/practice/        Pure session state, deadlines, restore and review
src/learning/        First-attempt progress, session history, notebook and statistics
src/archive/         Source catalog, coverage filters, import schemas
 data/archive.json   Historical source manifest (external links only)
scripts/             Build, archive validation and reviewed PYQ staging
 tests/              Content, generation, grading and state regressions
docs/                Architecture, content pipeline and release roadmap
```

The first release keeps these components in one repository, matching SAT's small dependency footprint while preserving the separation of responsibilities used by the CMI project. It does not pretend to ship Avenquellis's C++/Wasm engines, proof grading, or cloud model services.

## Archive provenance

The [official JEE Advanced archive](https://jeeadv.ac.in/archive.html) supplies papers through 2025; the [official homepage](https://jeeadv.ac.in/) supplied 2026 papers when checked on 11 November 2026. Older [ExamGOAL year collections](https://pdf.questions.examgoal.com/past-years/year-wise/jee/jee-advanced) are third-party and partial. Source dates and delivery checks are recorded separately from content completeness.

Question papers and third-party questions retain their owners' rights. This project links to those documents and does not mirror them. Source availability does not establish permission to republish a full question bank. Historical transcription requires suitable source rights plus statement, diagram, answer and marking review. See [content pipeline](docs/CONTENT-PIPELINE.md).

## Data and privacy

This is a browser-local learning application with no account sync, student analytics or cloud assessment. Browser storage may be unavailable or evicted. Exported progress covers scored session attempts; paper notes have their own export, and saved-question bookmarks remain local. Corrupt saved data is preserved rather than silently replaced. Fonts are self-hosted with the site. Ordinary Cloudflare hosting and external paper requests are handled by those providers.

Answer keys ship in the source for learning and review. This is not a secure examination system. Backup validation protects data consistency, not against a user deliberately editing their own learning history.

## Ownership

Created and maintained by **Tarun Tej**. Original project code is MIT licensed. Bundled fonts use the SIL Open Font License, with notices in assets/fonts/. External examination materials are not included in the code licence. Vedaris is independent of the IITs, JEE Advanced and archive providers.

## Cloudflare production and the 10,000-user target

The public deployment is **https://vedaris-jee.pages.dev/**. The GitHub source remains private. The earlier ChatGPT Site is a separate private preview, not the production address; browser-local progress does not automatically move between domains.

This release is designed for a target of 10,000 concurrent open study sessions: Cloudflare serves immutable static assets and the browser generates, scores and stores practice. It has no application server, database, per-user API or cloud grading call to saturate. **A 10,000-user production load test has not been completed.** See [capacity model and test protocol](docs/CAPACITY.md) for the distinction between open sessions, cold-launch bursts and measured capacity.

Production hardening includes content-hashed releases, integrity-checked offline assets, immutable browser caching, revalidated entry points, self-hosted fonts, a complete compressed offline-bundle budget, and an exclusive browser writer guard. A second tab is read-only to prevent lost saved answers; browsers without Web Locks can practise in memory and export progress. Chapter setup disables question counts that exceed available distinct variants.

Deploy from a tested checkout with the existing authenticated Cloudflare account:

```sh
npm run deploy
npm run check:live
```

`wrangler.jsonc` names the existing direct-upload Pages project. Deployment runs the build and its checks before pinned Wrangler uploads `dist/`. No Functions or `_worker.js` are deployed. GitHub Actions validates each push and retains the build artifact; production publishing is an explicit command. No Cloudflare credential is stored in Git.

`npm run check:release` verifies hashes, static-only output and payload budgets. `npm run check:live` verifies production bytes, cache/security headers, 404 handling and a bounded 5-concurrent-request smoke probe. That probe is not a 10,000-user test. Use the staged k6 profile in [scripts/loadtest.js](scripts/loadtest.js) for a separately provisioned representative load run.

For rollback, select an earlier successful deployment in the Cloudflare Pages dashboard. Keep source and generated build identities with the deployment. The service worker does not force an update into an active test; users close old tabs and reopen to activate a newly installed release.

## Product direction

The learner workflow is inspired by the capability split between MathonGo MARKS (chapter practice and revision) and Quizrr (tests and analysis), with original Vedaris branding and implementation. See [product scope](docs/PRODUCT.md) for the feature benchmark and remaining content gaps.

Active question time counts only the visible practice screen, including its submit dialog. Elapsed session time includes time away. Legacy sessions without recorded timing remain unknown. Session history retains the latest 50 completed sessions and is separate from first-attempt progress; notebook resolution is a learner decision and never rewrites the original score. The existing progress export covers first-attempt answers only: session history, goals, bookmarks and notes currently remain browser-local.
