# Curated examination content

`catalog.json` declares the published bundles, complete-paper configurations,
attributions, and explicit coverage limits. Each paper JSON contains the source
question, options, any matching lists, original scoring, chapter assignments,
worked explanation, source page, and recorded reviews.

The playable collection is the 2023 JEE Advanced papers listed in the catalog.
The separate historical archive is a collection of source links; it is not
counted as forty years of playable questions.

The transcripts come from `propar2750/jee-advanced`, pinned to revision
`2580e96f1e74343e1d478509187f16fe58dbab85`. Codex compared the included records
and figure crops against the official PDFs, independently authored explanations,
and compared answers with the archived official final keys. This is AI-assisted
review, not a claim of human editorial certification. `review-audit.json`
records source hashes, original upstream review metadata, individual checks,
normalizations, figure provenance, and any question-specific qualifications.

The source question text already includes shared passages. Matching-list text
is preserved separately. An extra escaping layer in some upstream option/list
fields was removed before compilation; legitimate LaTeX row breaks are retained.
Numerical alternatives remain discrete alternatives, accepted ranges retain the
official bounds, and officially dropped questions award their published marks
even when unanswered.

`scripts/build-content.mjs` validates these inputs and compiles mathematical
expressions into native MathML at build time. It emits a digest-bearing public
catalog and one `{bundle, markup}` JSON per paper, each below 1 MiB. It fetches
no remote content and makes no review decisions. The normal release builder
includes these outputs and local figures in the same immutable release.

Question, key, and figure attribution stays with the organising IITs. The
dataset's MIT statement covers its transcriptions, structure, and annotations;
it does not state that IIT rights are transferred. See `UPSTREAM-LICENSE.txt`.
The newly authored Vedaris explanations are covered by the project MIT license.
