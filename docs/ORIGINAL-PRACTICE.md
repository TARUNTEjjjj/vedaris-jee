# Original practice coverage · first multi-concept expansion

Original practice is Vedaris-authored, seeded question families. It is labelled **original practice** on every question, stored separately from the reviewed PYQ bank, and never counted as a historical question, a complete paper or a calibrated mock. Coverage is reported in **families that have a recorded audit**, not in seeds: one family produces many variants of one idea, so a variant count would overstate what a learner can actually practise.

## What this expansion adds

Release 0.5 shipped 30 single-concept families covering 30 of the 54 study chapters. This expansion chooses eight uncovered chapters and adds one family to each. Every new family combines at least two ideas, and most cross chapter boundaries:

| Family | Primary gap | Concepts combined | Explicit constraint that refuses invalid combinations |
| --- | --- | --- | --- |
| `phy-rolling-incline-v1` | Rotational mechanics | Moment of inertia, rolling energy, static-friction requirement (also Work, Laws of motion) | μ ≥ (3/4)β/(1 + β) for sin θ = 3/5; otherwise the body slips and the rolling result is false |
| `phy-induction-rod-v1` | Induction & AC | Motional emf, Ohm's law, force balance (also Current electricity, Laws of motion) | B, L > 0 and terminal speed ≤ 100 m/s |
| `phy-ice-water-v1` | Thermal physics | Sensible heat, latent heat, final-phase case analysis | Water starts liquid: 0 °C < T < 100 °C |
| `chem-redox-titration-v1` | Redox reactions | Oxidation-state change, balanced acidic equations, titration (also Mole concept) | Acidic medium only; permanganate and dichromate follow other half-reactions in neutral or alkaline solution |
| `chem-combustion-dbe-v1` | Hydrocarbons & aromaticity | Combustion stoichiometry, formula from atom balance, degree of unsaturation (also Mole concept) | H = 2C + 2 − 2·DBE ≥ C, and observed O₂ must be a whole number of mmol |
| `math-arrangement-probability-v1` | Permutations & combinations | Gap and block methods, classical probability (also Probability) | For "no two girls adjacent", girls ≤ boys + 1 |
| `math-ap-variance-v1` | Statistics | Arithmetic progressions, variance of equally spaced data, linear transformations (also Sequences) | Nonzero scale factor; population variance (divisor n) is stated |
| `math-point-plane-v1` | Three-dimensional geometry | Vector form of a plane, cross product, perpendicular distance (also Vectors) | u × v ≠ 0: parallel or zero direction vectors define no plane |

Each family declares its parameter domain and constraints in `src/questions/multi-concept.js` (`familyDomain(id)` exposes them). Seeded generation only builds parameters that pass `check()`. `buildFromParameters(id, parameters)` builds a specific parameter set for audits and refuses invalid combinations with a reason instead of adjusting them. That audit path has no seed and is not a playable identity.

Worked explanations follow the authored route and, where a modelling assumption matters, check it in the explanation: the rolling family verifies friction before using energy conservation; the ice family decides the final phase before computing a mass; the combustion family notes that a formula fixes rings plus π bonds, not their split.

## How the new families are audited

`scripts/original-oracle.mjs` is a separate exact-arithmetic oracle. It does not import the generator or the grader; it has its own BigInt rational type and reads only the question text. For each family it derives the answer by a **different method** from the explanation:

| Family | Oracle method |
| --- | --- |
| Rolling | Newton's second law plus the torque equation solved for acceleration and friction, then v² = 2as along the incline; slipping is detected from f ≤ μN |
| Induction rod | Net force evaluated through emf → current → force and solved for its root, then a power-balance cross-check (mgv = I²R) |
| Ice in water | Enthalpy bookkeeping relative to ice at 0 °C instead of a two-case heat comparison |
| Redox titration | Oxidation states computed from formula and charge, then equal electron equivalents, instead of balanced-equation mole ratios |
| Combustion | Brute-force search over every CₓHᵧ (x ≤ 40) matching both observations, requiring a unique formula, then the valence-sum definition of unsaturation |
| Arrangements | Enumeration of every girl-position pattern by bitmask |
| AP variance | Explicit list of every transformed observation, exact mean and variance |
| Point–plane | Least-squares closest point from the 2 × 2 normal equations, then the squared residual, with no cross product |

The oracle also restates each family's validity rule from first principles (`FEASIBLE`). `tests/original-families.test.mjs` checks:

- thousands of seeds per family against the oracle, and that a slightly altered key fails the audit;
- every point of each small discrete domain (rolling, induction, ice, redox, combustion and arrangements), including deliberately out-of-domain values. The generator's `check()` and the oracle's feasibility must agree on validity, and every valid point must match the oracle's answer;
- random and targeted samples for the larger mathematics domains;
- boundary cases: friction exactly at the rolling limit, ice that exactly melts, alkanes and the least-saturated permitted formulas, alternating rows, terminal speed exactly at the limit, and a point on the plane;
- equivalent answers: reduced, unreduced and terminating-decimal forms earn credit, and rounded non-terminating decimals do not;
- unchanged output for the original 30 families, and restoration and regrading of a saved session and progress that use their identities.

`node scripts/original-oracle.mjs 2000` repeats the seed audit from the command line.

**No human audit occurred.** "Independently audited" here means machine-checked by a separately written oracle that uses a different derivation. The same AI author (Claude, in a Claude Code session) wrote both the generator and the oracle, so a shared misconception about the underlying physics or chemistry would not be caught. No difficulty calibration or exam equivalence is claimed. Subject-expert review of statements, constraints and explanations remains open.

The first 30 families keep their earlier audits in `tests/core.test.mjs`. Statement recovery re-derives the numerical key from the stem in floating point; key-text checks confirm the keyed option of choice families. These are weaker than the exact oracle and are labelled as such below.

## Stable identities and saved work

New families are appended after the original 30 under new `-v1` IDs. Existing families, their seeds and generated questions are unchanged, so saved sessions, first-attempt progress, notebook annotations and bookmarks keep resolving to the same questions. A future correction to a family's mathematics must use a new versioned ID rather than silently changing an existing one. New seeded custom sets can now draw from the larger pool, so the same set seed builds a different selection than before. Saved sessions store explicit family and seed identities and are unaffected.

## Coverage map

<!-- coverage:start (generated by scripts/original-coverage.mjs) -->
38 original families, 38 with a recorded audit (8 by the exact oracle). 38 of 54 chapters have at least one audited family; 16 remain gaps. Seeds and variants are not counted.

| Subject | Chapter | Own families (audit) | Also exercised by |
| --- | --- | --- | --- |
| Physics | Units & dimensions | **Gap** | — |
| Physics | Kinematics | `phy-projectile-v1` (statement recovery) | — |
| Physics | Laws of motion | `phy-atwood-v1` (statement recovery) | `phy-rolling-incline-v1`<br>`phy-induction-rod-v1` |
| Physics | Work, energy & power | `phy-work-spring-v1` (statement recovery) | `phy-rolling-incline-v1` |
| Physics | Momentum & collisions | `phy-collision-v1` (statement recovery) | — |
| Physics | Rotational mechanics | `phy-rolling-incline-v1` (exact oracle) | — |
| Physics | Gravitation | `phy-orbit-v1` (key-text check) | — |
| Physics | Solids & fluids | **Gap** | — |
| Physics | Thermal physics | `phy-ice-water-v1` (exact oracle) | — |
| Physics | Oscillations | `phy-shm-v1` (key-text check) | — |
| Physics | Waves & sound | **Gap** | — |
| Physics | Electrostatics | `phy-capacitors-v1` (statement recovery) | — |
| Physics | Current electricity | `phy-circuit-v1` (statement recovery) | `phy-induction-rod-v1` |
| Physics | Magnetism | **Gap** | — |
| Physics | Induction & AC | `phy-induction-rod-v1` (exact oracle) | — |
| Physics | Optics | `phy-lens-v1` (statement recovery) | — |
| Physics | Modern physics | `phy-photoelectric-v1` (statement recovery) | — |
| Physics | Experimental skills | **Gap** | — |
| Chemistry | Mole concept & stoichiometry | `chem-limiting-v1` (statement recovery) | `chem-redox-titration-v1`<br>`chem-combustion-dbe-v1` |
| Chemistry | Atomic structure | `chem-hydrogen-v1` (statement recovery) | — |
| Chemistry | Chemical bonding | **Gap** | — |
| Chemistry | States of matter | `chem-gas-v1` (statement recovery) | — |
| Chemistry | Chemical thermodynamics | `chem-hess-v1` (statement recovery) | — |
| Chemistry | Chemical equilibrium | `chem-kc-v1` (statement recovery) | — |
| Chemistry | Ionic equilibrium | `chem-neutralisation-v1` (key-text check) | — |
| Chemistry | Redox reactions | `chem-redox-titration-v1` (exact oracle) | — |
| Chemistry | Electrochemistry | `chem-electrolysis-v1` (statement recovery) | — |
| Chemistry | Chemical kinetics | `chem-first-order-v1` (statement recovery) | — |
| Chemistry | Solutions | `chem-colligative-v1` (statement recovery) | — |
| Chemistry | Periodicity | **Gap** | — |
| Chemistry | Main-group chemistry | **Gap** | — |
| Chemistry | Coordination chemistry | **Gap** | — |
| Chemistry | Organic fundamentals | `chem-isomers-v1` (key-text check) | — |
| Chemistry | Hydrocarbons & aromaticity | `chem-combustion-dbe-v1` (exact oracle) | — |
| Chemistry | Functional-group chemistry | **Gap** | — |
| Chemistry | Practical & applied chemistry | **Gap** | — |
| Mathematics | Sets, relations & functions | **Gap** | — |
| Mathematics | Quadratic equations | `math-roots-v1` (statement recovery) | — |
| Mathematics | Complex numbers | `math-complex-v1` (statement recovery) | — |
| Mathematics | Sequences & series | `math-ap-v1` (statement recovery) | `math-ap-variance-v1` |
| Mathematics | Binomial theorem | `math-binomial-v1` (statement recovery) | — |
| Mathematics | Permutations & combinations | `math-arrangement-probability-v1` (exact oracle) | — |
| Mathematics | Probability | `math-probability-v1` (statement recovery) | `math-arrangement-probability-v1` |
| Mathematics | Matrices & determinants | `math-matrix-v1` (statement recovery) | — |
| Mathematics | Trigonometry | **Gap** | — |
| Mathematics | Straight lines | **Gap** | — |
| Mathematics | Circles & conic sections | `math-conic-v1` (key-text check) | — |
| Mathematics | Limits & continuity | **Gap** | — |
| Mathematics | Differential calculus | `math-optimisation-v1` (key-text check) | — |
| Mathematics | Integral calculus | `math-integral-v1` (statement recovery) | — |
| Mathematics | Differential equations | **Gap** | — |
| Mathematics | Vectors | `math-vectors-v1` (statement recovery) | `math-point-plane-v1` |
| Mathematics | Three-dimensional geometry | `math-point-plane-v1` (exact oracle) | — |
| Mathematics | Statistics | `math-ap-variance-v1` (exact oracle) | — |
<!-- coverage:end -->

Remaining gaps are deliberate: each needs a family whose statement, constraints and oracle are written with the same care, not more seeds of an existing family.
