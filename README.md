# Vedaris

**A focused JEE Advanced workspace, built around understanding.**

Vedaris carries the chapter → practice → timed session → review → progress structure of [Avenquellis](https://github.com/TARUNTEjjjj/avenquellis-web) and [Axiom SAT](https://github.com/TARUNTEjjjj/axiom-sat) into Physics, Chemistry and Mathematics. Indian-rooted branding, an uncluttered workspace, and explicit content provenance are central to the project.

**[Open the private preview](https://vedaris-jee.taruntejavula-honeyb.chatgpt.site)** · [Content pipeline](docs/CONTENT-PIPELINE.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md)

## Current release: 0.1

| Capability | Shipped scope |
| --- | --- |
| PCM chapter library | 54 chapter records, 18 per subject; chapters without practice families are labelled |
| Original practice | 30 deterministic families, 10 per subject; finite seeded variants and worked solutions |
| Historical archive | 79 source records spanning every year **1978–2026** |
| Official full papers | 40 English papers from **2007–2026**, with HTTP, content-type and PDF-signature checks |
| Older source collections | 39 collections from **1978–2006**, explicitly labelled partial |
| Timed practice | Custom subject/chapter sets, single/multiple/numerical responses, wall-clock deadlines, reload resume, flags, review and exact-question retry |
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

The build uses an explicit public-file list, validates the archive, checks JavaScript syntax, and emits an asset-hashed offline cache. It does not publish documentation, tests, staged imports, credentials, or Git metadata. External papers and web fonts are not included in the offline cache. Existing app tabs must close before an installed update activates, so an active timed session is not interrupted.

## Repository structure

```text
assets/              Browser UI, responsive design, route controllers
src/questions/       PCM taxonomy, seeded generators, exact answer grading
src/practice/        Pure session state, deadlines, restore and review
src/learning/        First-attempt history, backup validation and statistics
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

This is a browser-local learning application with no account sync, student analytics or cloud assessment. Browser storage may be unavailable or evicted. Exported progress covers scored session attempts; paper notes have their own export, and saved-question bookmarks remain local. Corrupt saved data is preserved rather than silently replaced. Google Fonts supplies optional typography; ordinary hosting and external paper requests are handled by those providers.

Answer keys ship in the source for learning and review. This is not a secure examination system. Backup validation protects data consistency, not against a user deliberately editing their own learning history.

## Ownership

Created and maintained by **Tarun Tej**. Original project code is MIT licensed; external examination materials are not included in that licence. Vedaris is independent of the IITs, JEE Advanced and archive providers.
