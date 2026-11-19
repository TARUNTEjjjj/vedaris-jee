import { CHAPTERS } from '../questions/catalog.js';

/**
 * Prerequisite relationships between canonical chapter IDs.
 *
 * Every edge reads "`from` is usually needed before `to`". The set was drafted
 * with AI assistance from general syllabus structure. No teacher, examiner or
 * other human subject expert has reviewed it, so each edge and the dataset are
 * explicitly `unreviewed-draft`. Interfaces must show that status wherever a
 * relationship influences a recommendation. A relationship is study guidance,
 * not evidence about the learner and not a claim about official JEE structure.
 *
 * An edge may become `reviewed` only with a named reviewer, a real review date
 * and evidence; validateTopicRelations() enforces that contract.
 */
export const RELATION_REVIEW_STATUSES = Object.freeze(['unreviewed-draft', 'reviewed', 'rejected']);
export const DRAFT_NOTICE = 'Unreviewed draft: these prerequisite links were drafted with AI assistance and have not been checked by a human subject expert.';

const draft = { status: 'unreviewed-draft', drafted: 'AI-assisted draft, 2026-11-19' };
const edge = (from, to, rationale) => ({ from, to, rationale, review: draft });

const EDGES = [
  // Physics
  edge('phy-units', 'phy-experiments', 'Error propagation and graph work rely on dimensions and significant figures.'),
  edge('math-derivatives', 'phy-kinematics', 'Velocity and acceleration are rates of change.'),
  edge('math-vectors', 'phy-kinematics', 'Two-dimensional and relative motion use vector components.'),
  edge('phy-kinematics', 'phy-newton', 'Force analysis predicts accelerations described kinematically.'),
  edge('phy-newton', 'phy-work', 'Work is defined from forces acting along a displacement.'),
  edge('phy-newton', 'phy-momentum', 'Impulse is the time effect of the net force.'),
  edge('phy-work', 'phy-momentum', 'Collision problems compare kinetic energy with conserved momentum.'),
  edge('phy-momentum', 'phy-rotation', 'Angular momentum and centre-of-mass motion extend linear momentum.'),
  edge('phy-work', 'phy-rotation', 'Rolling problems combine translational and rotational kinetic energy.'),
  edge('phy-newton', 'phy-gravitation', 'Circular orbits apply Newton’s second law with gravitational force.'),
  edge('phy-work', 'phy-gravitation', 'Escape speed and orbital energy use potential energy.'),
  edge('phy-newton', 'phy-fluids', 'Pressure, buoyancy and elasticity are force-balance problems.'),
  edge('phy-work', 'phy-thermal', 'The first law of thermodynamics is an energy balance.'),
  edge('phy-newton', 'phy-oscillations', 'Simple harmonic motion follows from a linear restoring force.'),
  edge('phy-work', 'phy-oscillations', 'SHM energy exchanges kinetic and potential energy.'),
  edge('phy-oscillations', 'phy-waves', 'Waves are propagating oscillations.'),
  edge('math-vectors', 'phy-electrostatics', 'Fields from several charges are vector sums.'),
  edge('phy-work', 'phy-electrostatics', 'Electric potential is potential energy per unit charge.'),
  edge('phy-electrostatics', 'phy-circuits', 'Potential difference and capacitance underpin circuit analysis.'),
  edge('phy-circuits', 'phy-magnetism', 'Magnetic fields and forces are produced by and act on currents.'),
  edge('phy-magnetism', 'phy-induction', 'Induction follows from changing magnetic flux.'),
  edge('phy-circuits', 'phy-induction', 'Induced emf drives currents through circuit elements.'),
  edge('phy-waves', 'phy-optics', 'Interference and diffraction are wave superposition.'),
  edge('phy-electrostatics', 'phy-modern', 'Stopping potential and atomic energy levels use electric potential energy.'),
  edge('phy-optics', 'phy-modern', 'Photon and matter-wave ideas build on wave optics.'),
  // Chemistry
  edge('chem-mole', 'chem-gases', 'Gas-law calculations count amount of substance.'),
  edge('chem-atomic', 'chem-periodic', 'Periodic trends follow electronic configuration.'),
  edge('chem-atomic', 'chem-bonding', 'Bonding models use valence electrons and orbitals.'),
  edge('chem-periodic', 'chem-bonding', 'Electronegativity and size trends explain bond polarity.'),
  edge('chem-mole', 'chem-thermo', 'Enthalpy changes are quoted per mole of reaction.'),
  edge('chem-thermo', 'chem-equilibrium', 'Gibbs energy links spontaneity to equilibrium constants.'),
  edge('chem-equilibrium', 'chem-ionic', 'Acid–base and solubility equilibria are applications of equilibrium constants.'),
  edge('chem-mole', 'chem-redox', 'Redox titrations are stoichiometric calculations.'),
  edge('chem-redox', 'chem-electrochemistry', 'Cells and electrolysis are separated redox half-reactions.'),
  edge('chem-thermo', 'chem-electrochemistry', 'Cell potential relates to Gibbs energy.'),
  edge('chem-mole', 'chem-kinetics', 'Rate laws use concentrations.'),
  edge('chem-mole', 'chem-solutions', 'Molality and mole fraction come from amount of substance.'),
  edge('chem-periodic', 'chem-blocks', 'Group chemistry follows periodic trends.'),
  edge('chem-bonding', 'chem-coordination', 'Complex bonding extends hybridisation and orbital ideas.'),
  edge('chem-bonding', 'chem-organic', 'Electronic effects and shapes rely on bonding models.'),
  edge('chem-organic', 'chem-hydrocarbons', 'Hydrocarbon reactions use intermediates and electronic effects.'),
  edge('chem-hydrocarbons', 'chem-functional', 'Functional-group chemistry builds on hydrocarbon reaction patterns.'),
  edge('chem-functional', 'chem-practical', 'Biomolecules, polymers and qualitative tests use functional groups.'),
  // Mathematics
  edge('math-sets', 'math-quadratic', 'Root conditions are statements about domains and ranges.'),
  edge('math-quadratic', 'math-complex', 'Complex numbers arise as roots of quadratics.'),
  edge('math-sequences', 'math-binomial', 'Binomial sums are finite series.'),
  edge('math-counting', 'math-binomial', 'Binomial coefficients count selections.'),
  edge('math-counting', 'math-probability', 'Classical probability counts favourable outcomes.'),
  edge('math-sets', 'math-probability', 'Events are sets of outcomes.'),
  edge('math-sets', 'math-trigonometry', 'Inverse trigonometric functions depend on restricted domains.'),
  edge('math-trigonometry', 'math-lines', 'Slopes and angles between lines use trigonometric ratios.'),
  edge('math-lines', 'math-conics', 'Tangents, normals and chords are lines.'),
  edge('math-quadratic', 'math-conics', 'Intersections with conics reduce to quadratics.'),
  edge('math-sets', 'math-limits', 'Limits and continuity are statements about functions on domains.'),
  edge('math-limits', 'math-derivatives', 'The derivative is defined as a limit.'),
  edge('math-derivatives', 'math-integrals', 'Integration reverses differentiation.'),
  edge('math-integrals', 'math-differential', 'Solving differential equations requires integration.'),
  edge('math-derivatives', 'math-differential', 'Forming differential equations requires derivatives.'),
  edge('math-lines', 'math-vectors', 'Vector geometry generalises coordinate geometry.'),
  edge('math-vectors', 'math-geometry3d', 'Lines and planes in space use vector equations.'),
  edge('math-matrices', 'math-geometry3d', 'Coplanarity and systems of planes use determinants.'),
  edge('math-sequences', 'math-statistics', 'Means and variances of progressions use series sums.'),
];

export const TOPIC_RELATIONS = Object.freeze({
  version: 1,
  reviewStatus: 'unreviewed-draft',
  notice: DRAFT_NOTICE,
  edges: Object.freeze(EDGES.map(value => Object.freeze({ ...value, review: Object.freeze({ ...value.review }) }))),
});

const reviewDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

/**
 * Validate canonical IDs, acyclicity and review claims. A `reviewed` edge needs
 * reviewer, reviewedAt (YYYY-MM-DD) and evidence; no edge is silently upgraded.
 */
export function validateTopicRelations(dataset, chapters = CHAPTERS) {
  const errors = [];
  if (!dataset || dataset.version !== 1 || !Array.isArray(dataset.edges)) return ['relations: expected { version: 1, edges: [] }'];
  if (!RELATION_REVIEW_STATUSES.includes(dataset.reviewStatus)) errors.push('relations.reviewStatus: unknown status');
  const known = new Set(chapters.map(chapter => chapter.id));
  const seen = new Set();
  const next = new Map();
  dataset.edges.forEach((value, index) => {
    const path = `edges[${index}]`;
    if (!value || typeof value !== 'object') { errors.push(`${path}: expected an object`); return; }
    if (!known.has(value.from)) errors.push(`${path}.from: unknown chapter ${value.from}`);
    if (!known.has(value.to)) errors.push(`${path}.to: unknown chapter ${value.to}`);
    if (value.from === value.to) errors.push(`${path}: self-prerequisite`);
    const key = `${value.from}>${value.to}`;
    if (seen.has(key)) errors.push(`${path}: duplicate relationship`);
    seen.add(key);
    if (!text(value.rationale) || value.rationale.length > 300) errors.push(`${path}.rationale: required, up to 300 characters`);
    const review = value.review;
    if (!review || !RELATION_REVIEW_STATUSES.includes(review.status)) errors.push(`${path}.review.status: unknown status`);
    else if (review.status === 'reviewed' && (!text(review.reviewer) || !reviewDate(review.reviewedAt) || !text(review.evidence))) errors.push(`${path}.review: a reviewed relationship needs reviewer, reviewedAt and evidence`);
    if (!next.has(value.from)) next.set(value.from, []);
    next.get(value.from).push(value.to);
  });
  if (dataset.reviewStatus === 'reviewed' && dataset.edges.some(value => value?.review?.status !== 'reviewed')) errors.push('relations.reviewStatus: a dataset is reviewed only when every edge is reviewed');
  // Depth-first cycle detection.
  const state = new Map();
  const visit = node => {
    if (state.get(node) === 1) return true;
    if (state.get(node) === 2) return false;
    state.set(node, 1);
    for (const target of next.get(node) || []) if (visit(target)) return true;
    state.set(node, 2);
    return false;
  };
  for (const node of next.keys()) if (visit(node)) { errors.push('relations: prerequisite cycle detected'); break; }
  return errors;
}

/** Usable edges exclude rejected ones; unreviewed drafts remain usable but labelled. */
export function prerequisitesOf(chapterId, dataset = TOPIC_RELATIONS) {
  return dataset.edges.filter(value => value.to === chapterId && value.review.status !== 'rejected');
}
export function dependentsOf(chapterId, dataset = TOPIC_RELATIONS) {
  return dataset.edges.filter(value => value.from === chapterId && value.review.status !== 'rejected');
}
