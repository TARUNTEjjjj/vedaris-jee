// Original multi-concept practice families (first expansion).
//
// Each family separates an explicit parameter domain from question
// construction: sample(rng) draws parameters, check(params) states every
// domain and physical/mathematical constraint, and build(params) writes the
// question. generate() in index.js only ever builds checked parameters.
// Answers here are derived by the authored solution route. A separately
// written exact-arithmetic oracle (scripts/original-oracle.mjs, not shipped)
// re-derives every answer from the question text by a different method.
// These are Vedaris original practice questions, never historical PYQs.

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const int = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const pick = (rng, values) => values[rng.int(0, values.length - 1)];
/** Signed integers use the typographic minus, matching existing families. */
const signed = value => value < 0 ? `−${-value}` : String(value);
const vector = values => `(${values.map(signed).join(', ')})`;
/** Exact reduced fraction text accepted by the practice grader. */
function fraction(n, d = 1) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) throw new Error('Invalid fraction');
  if (d < 0) { n = -n; d = -d; }
  const common = gcd(n, d) || 1;
  n /= common; d /= common;
  return d === 1 ? String(n) : `${n}/${d}`;
}
/** Parse a short decimal parameter such as '0.375' into an exact integer ratio. */
function ratio(text) {
  if (typeof text !== 'string' || !/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Invalid decimal parameter');
  const [whole, frac = ''] = text.split('.');
  return { n: Number(whole + frac), d: 10 ** frac.length };
}
const fractionText = (n, d) => fraction(n, d);
const lessThanOrEqual = (a, b) => a.n * b.d <= b.n * a.d;

const ROLLING_BODIES = Object.freeze({
  ring: { label: 'thin uniform ring', inertia: 'mR²', beta: { n: 1, d: 1 } },
  disc: { label: 'uniform solid disc', inertia: 'mR²/2', beta: { n: 1, d: 2 } },
  sphere: { label: 'uniform solid sphere', inertia: '2mR²/5', beta: { n: 2, d: 5 } },
});
const ROLLING_FRICTION = Object.freeze(['0.2', '0.25', '0.3', '0.375', '0.4', '0.5', '0.6']);
/** Minimum static friction for rolling without slipping when sin θ = 3/5: (3/4)β/(1+β). */
const rollingMinimumFriction = beta => ({ n: 3 * beta.n, d: 4 * (beta.n + beta.d) });

const INDUCTION_FIELDS = Object.freeze(['0.5', '1', '1.5', '2']);
const INDUCTION_LENGTHS = Object.freeze(['0.5', '1', '2']);
const INDUCTION_MAX_SPEED = 100;
function inductionSpeed({ massTenths, resistance, field, length }) {
  // v = mgR/(B²L²) with m = massTenths/10 kg and g = 10 m s⁻², so mg = massTenths N.
  const B = ratio(field), L = ratio(length);
  return { n: massTenths * resistance * B.d * B.d * L.d * L.d, d: B.n * B.n * L.n * L.n };
}

const OXIDANTS = Object.freeze({
  KMnO4: { name: 'KMnO₄', ion: 'MnO₄⁻', reduced: 'Mn²⁺' },
  K2Cr2O7: { name: 'K₂Cr₂O₇', ion: 'Cr₂O₇²⁻', reduced: 'Cr³⁺' },
});
const REDUCTANTS = Object.freeze({
  FeSO4: { name: 'FeSO₄', species: 'Fe²⁺', oxidised: 'Fe³⁺' },
  H2C2O4: { name: 'oxalic acid (H₂C₂O₄)', species: 'H₂C₂O₄', oxidised: 'CO₂' },
});
// Balanced acidic ionic equations and the reductant : oxidant mole ratio they imply.
const REDOX_EQUATIONS = Object.freeze({
  'KMnO4:FeSO4': { equation: 'MnO₄⁻ + 5Fe²⁺ + 8H⁺ → Mn²⁺ + 5Fe³⁺ + 4H₂O', ratio: { n: 5, d: 1 } },
  'KMnO4:H2C2O4': { equation: '2MnO₄⁻ + 5H₂C₂O₄ + 6H⁺ → 2Mn²⁺ + 10CO₂ + 8H₂O', ratio: { n: 5, d: 2 } },
  'K2Cr2O7:FeSO4': { equation: 'Cr₂O₇²⁻ + 6Fe²⁺ + 14H⁺ → 2Cr³⁺ + 6Fe³⁺ + 7H₂O', ratio: { n: 6, d: 1 } },
  'K2Cr2O7:H2C2O4': { equation: 'Cr₂O₇²⁻ + 3H₂C₂O₄ + 8H⁺ → 2Cr³⁺ + 6CO₂ + 7H₂O', ratio: { n: 3, d: 1 } },
});
const REDOX_CONCENTRATIONS = Object.freeze(['0.01', '0.02', '0.05', '0.1']);
const REDOX_SAMPLE_VOLUMES = Object.freeze([10, 20, 25, 50]);

function linearText(p, q) {
  const head = p === 1 ? 'xᵢ' : p === -1 ? '−xᵢ' : `${signed(p)}xᵢ`;
  return q === 0 ? head : `${head} ${q < 0 ? '−' : '+'} ${Math.abs(q)}`;
}
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const integerVector = (value, min, max) => Array.isArray(value) && value.length === 3 && value.every(x => int(x, min, max));
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = result * (n - k + i) / i;
  return Math.round(result);
}

/**
 * parameters: documented domain for each parameter; constraints: the extra
 * cross-parameter rules enforced by check(). Invalid combinations are refused,
 * never silently adjusted.
 */
export const MULTI_CONCEPT_FAMILIES = Object.freeze([
  {
    id: 'phy-rolling-incline-v1', subject: 'physics', chapter: 'phy-rotation', concepts: ['phy-rotation', 'phy-work', 'phy-newton'],
    title: 'Rolling descent with a friction check', type: 'numerical',
    skills: ['moment of inertia', 'energy conservation with rolling', 'static-friction requirement for rolling without slipping'],
    parameters: { body: 'ring | disc | sphere', height: 'integer metres, 1–20', friction: ROLLING_FRICTION.join(' | ') },
    constraints: ['Rolling without slipping must be possible: μ ≥ (3/4)β/(1 + β), where β = I/(mR²) and sin θ = 3/5.'],
    check(p) {
      const body = ROLLING_BODIES[p?.body];
      if (!body) return 'Unknown rolling body';
      if (!int(p.height, 1, 20)) return 'Height must be an integer from 1 to 20 m';
      if (!ROLLING_FRICTION.includes(p.friction)) return 'Friction coefficient is outside the family domain';
      if (!lessThanOrEqual(rollingMinimumFriction(body.beta), ratio(p.friction))) return 'Static friction is too small for rolling without slipping';
      return null;
    },
    sample(rng) {
      const body = pick(rng, Object.keys(ROLLING_BODIES));
      const allowed = ROLLING_FRICTION.filter(value => lessThanOrEqual(rollingMinimumFriction(ROLLING_BODIES[body].beta), ratio(value)));
      return { body, height: rng.int(1, 20), friction: pick(rng, allowed) };
    },
    build({ body: key, height, friction }) {
      const body = ROLLING_BODIES[key], { beta } = body;
      const answer = fraction(20 * height * beta.d, beta.n + beta.d);
      const minimum = rollingMinimumFriction(beta);
      return {
        stem: `A ${body.label} of mass m and radius R is released from rest on a fixed incline with sin θ = 3/5 (so cos θ = 4/5). The coefficient of static friction between the body and the incline is μ = ${friction}. Take g = 10 m/s². While its centre descends a vertical height of ${height} m, find v², the square of the speed of its centre, in m²/s². A fraction is accepted.`,
        answer,
        solution: [
          `For a ${body.label} about its centre, I = ${body.inertia}, so β = I/(mR²) = ${fractionText(beta.n, beta.d)}.`,
          `Check the rolling assumption first. Without slipping, a = g sin θ/(1 + β) and f = β·m·a, so the body needs μ ≥ β tan θ/(1 + β) = (3/4)β/(1 + β) = ${fractionText(minimum.n, minimum.d)}. Here μ = ${friction}, so it rolls without slipping.`,
          `Static friction does no work in rolling without slipping: mgh = ½mv² + ½Iω² = ½mv²(1 + β), giving v² = 2gh/(1 + β).`,
          `v² = 2 × 10 × ${height}/(1 + ${fractionText(beta.n, beta.d)}) = ${answer} m²/s².`,
        ],
      };
    },
  },
  {
    id: 'phy-induction-rod-v1', subject: 'physics', chapter: 'phy-induction', concepts: ['phy-induction', 'phy-circuits', 'phy-newton'],
    title: 'Terminal speed of a falling rod', type: 'numerical',
    skills: ['motional emf', 'Ohm’s law in a single loop', 'magnetic force and terminal-velocity balance'],
    parameters: { massTenths: 'rod mass in tenths of a kilogram, 1–10', resistance: 'integer ohms, 1–12', field: INDUCTION_FIELDS.join(' | ') + ' T', length: INDUCTION_LENGTHS.join(' | ') + ' m' },
    constraints: [`Terminal speed mgR/(B²L²) must not exceed ${INDUCTION_MAX_SPEED} m/s, keeping the idealised rail model plausible.`, 'B and L are strictly positive; a zero field gives no terminal speed.'],
    check(p) {
      if (!int(p?.massTenths, 1, 10)) return 'Rod mass must be 0.1 to 1.0 kg in tenths';
      if (!int(p.resistance, 1, 12)) return 'Resistance must be an integer from 1 to 12 Ω';
      if (!INDUCTION_FIELDS.includes(p.field)) return 'Magnetic field is outside the family domain';
      if (!INDUCTION_LENGTHS.includes(p.length)) return 'Rail separation is outside the family domain';
      const v = inductionSpeed(p);
      if (v.n > INDUCTION_MAX_SPEED * v.d) return `Terminal speed exceeds ${INDUCTION_MAX_SPEED} m/s`;
      return null;
    },
    sample(rng) {
      for (let attempt = 0; attempt < 1000; attempt++) {
        const p = { massTenths: rng.int(1, 10), resistance: rng.int(1, 12), field: pick(rng, INDUCTION_FIELDS), length: pick(rng, INDUCTION_LENGTHS) };
        if (this.check(p) === null) return p;
      }
      throw new Error('Could not sample a valid induction-rod variant');
    },
    build(p) {
      const v = inductionSpeed(p), answer = fraction(v.n, v.d);
      const mass = (p.massTenths / 10).toFixed(1);
      return {
        stem: `Two long, smooth, vertical conducting rails ${p.length} m apart are joined at the top by a ${p.resistance} Ω resistor. A uniform horizontal magnetic field of ${p.field} T is perpendicular to the plane of the rails. A horizontal conducting rod of mass ${mass} kg is released from rest and slides down while staying horizontal and in contact with both rails. Neglect friction, air drag, self-inductance and every other resistance. Take g = 10 m/s². Find the rod’s terminal speed in m/s. A fraction is accepted.`,
        answer,
        solution: [
          `At speed v the rod’s motional emf is BLv, so the loop current is I = BLv/R.`,
          `The magnetic force on the rod, BIL = B²L²v/R, opposes its motion (Lenz’s law) and grows with v.`,
          `At terminal speed the net force is zero: mg = B²L²v/R, so v = mgR/(B²L²).`,
          `v = ${mass} × 10 × ${p.resistance}/(${p.field}² × ${p.length}²) = ${answer} m/s.`,
        ],
      };
    },
  },
  {
    id: 'phy-ice-water-v1', subject: 'physics', chapter: 'phy-thermal', concepts: ['phy-thermal'],
    title: 'Ice in water: which final phase?', type: 'numerical',
    skills: ['sensible heat', 'latent heat of fusion', 'case analysis of the equilibrium phase'],
    parameters: { ice: 'grams of ice at 0 °C, 10–200 in steps of 10', water: 'grams of water, 50–500 in steps of 10', temperature: 'integer °C, 1–99' },
    constraints: ['The water starts as liquid below boiling: 0 °C < T < 100 °C.', 'Heat exchange is with the mixture only (insulated, negligible container heat capacity).'],
    check(p) {
      if (!int(p?.ice, 10, 200) || p.ice % 10) return 'Ice mass must be 10–200 g in steps of 10';
      if (!int(p.water, 50, 500) || p.water % 10) return 'Water mass must be 50–500 g in steps of 10';
      if (!int(p.temperature, 1, 99)) return 'Water must start as liquid between 1 and 99 °C';
      return null;
    },
    sample(rng) { return { ice: 10 * rng.int(1, 20), water: 10 * rng.int(5, 50), temperature: rng.int(1, 99) }; },
    build({ ice, water, temperature }) {
      const released = water * temperature, needed = 80 * ice;
      const allMelts = released >= needed;
      const answer = allMelts ? String(water + ice) : fraction(80 * water + released, 80);
      return {
        stem: `${ice} g of ice at 0 °C is dropped into ${water} g of water at ${temperature} °C in an insulated container of negligible heat capacity. Take the specific heat of water as 1 cal g⁻¹ °C⁻¹ and the latent heat of fusion of ice as 80 cal g⁻¹. Find the mass of liquid water, in grams, after thermal equilibrium is reached. A fraction is accepted.`,
        answer,
        solution: [
          `If all the water cooled to 0 °C it would release ${water} × 1 × ${temperature} = ${released} cal.`,
          `Melting all the ice needs ${ice} × 80 = ${needed} cal.`,
          allMelts
            ? `${released} ≥ ${needed}, so all the ice melts${released === needed ? ' with exactly 0 °C left over' : ' and the mixture finishes above 0 °C'}. The final temperature is (${released} − ${needed})/(${water} + ${ice}) °C.`
            : `${released} < ${needed}, so the mixture stops at 0 °C with some ice left. The heat available melts ${released}/80 = ${fraction(released, 80)} g of ice.`,
          allMelts ? `All ${water} + ${ice} = ${answer} g is liquid.` : `Liquid water = ${water} + ${fraction(released, 80)} = ${answer} g.`,
        ],
      };
    },
  },
  {
    id: 'chem-redox-titration-v1', subject: 'chemistry', chapter: 'chem-redox', concepts: ['chem-redox', 'chem-mole'],
    title: 'Redox titration in acid', type: 'numerical',
    skills: ['balancing redox equations', 'oxidation-state change', 'titration stoichiometry'],
    parameters: { oxidant: 'KMnO4 | K2Cr2O7', reductant: 'FeSO4 | H2C2O4', medium: 'acidic', concentration: REDOX_CONCENTRATIONS.join(' | ') + ' M', titre: 'integer mL, 5–50', sample: REDOX_SAMPLE_VOLUMES.join(' | ') + ' mL' },
    constraints: ['Only acidic solution is modelled. In neutral or alkaline solution permanganate is reduced to MnO₂ and dichromate becomes chromate, which needs different equations.'],
    check(p) {
      if (!OXIDANTS[p?.oxidant] || !REDUCTANTS[p.reductant]) return 'Unknown oxidant or reductant';
      if (p.medium !== 'acidic') return 'Only acidic titrations are modelled';
      if (!REDOX_CONCENTRATIONS.includes(p.concentration)) return 'Titrant concentration is outside the family domain';
      if (!int(p.titre, 5, 50)) return 'Titre must be an integer from 5 to 50 mL';
      if (!REDOX_SAMPLE_VOLUMES.includes(p.sample)) return 'Sample volume is outside the family domain';
      return null;
    },
    sample(rng) {
      return { oxidant: pick(rng, Object.keys(OXIDANTS)), reductant: pick(rng, Object.keys(REDUCTANTS)), medium: 'acidic', concentration: pick(rng, REDOX_CONCENTRATIONS), titre: rng.int(5, 50), sample: pick(rng, REDOX_SAMPLE_VOLUMES) };
    },
    build(p) {
      const oxidant = OXIDANTS[p.oxidant], reductant = REDUCTANTS[p.reductant], reaction = REDOX_EQUATIONS[`${p.oxidant}:${p.reductant}`];
      const c = ratio(p.concentration);
      // Molarity of reductant = c × titre × (mole ratio) / sample volume.
      const answer = fraction(c.n * p.titre * reaction.ratio.n, c.d * p.sample * reaction.ratio.d);
      return {
        stem: `In acidic solution, ${p.sample} mL of an aqueous ${reductant.name} solution is titrated with ${p.concentration} M ${oxidant.name}. The end point is reached after ${p.titre} mL of titrant. ${oxidant.ion} is reduced to ${oxidant.reduced} and ${reductant.species} is oxidised to ${reductant.oxidised}. Find the molarity of the ${reductant.name} solution. A fraction or decimal is accepted.`,
        answer,
        solution: [
          `Balanced acidic equation: ${reaction.equation}.`,
          `Amount of ${oxidant.ion} used = ${p.concentration} × ${p.titre}/1000 mol.`,
          `The equation gives ${fractionText(reaction.ratio.n, reaction.ratio.d)} mol ${reductant.species} per mol ${oxidant.ion}; electron gain and loss balance.`,
          `Molarity = ${p.concentration} × ${p.titre} × ${fractionText(reaction.ratio.n, reaction.ratio.d)}/${p.sample} = ${answer} M.`,
        ],
      };
    },
  },
  {
    id: 'chem-combustion-dbe-v1', subject: 'chemistry', chapter: 'chem-hydrocarbons', concepts: ['chem-hydrocarbons', 'chem-mole'],
    title: 'Unsaturation from combustion data', type: 'numerical',
    skills: ['combustion stoichiometry', 'molecular formula from atom balance', 'degree of unsaturation'],
    parameters: { carbon: 'integer, 2–10', unsaturation: 'integer rings + π bonds, 0 or more', sample: 'integer mmol, 1–10' },
    constraints: ['Hydrogen count H = 2C + 2 − 2·DBE must satisfy C ≤ H, keeping the formula within common hydrocarbons.', 'Observed O₂ consumption sample × (C + H/4) must be a whole number of mmol.'],
    check(p) {
      if (!int(p?.carbon, 2, 10)) return 'Carbon count must be 2 to 10';
      if (!int(p.unsaturation, 0, 20)) return 'Unsaturation must be a non-negative integer';
      if (!int(p.sample, 1, 10)) return 'Sample must be 1 to 10 mmol';
      const hydrogen = 2 * p.carbon + 2 - 2 * p.unsaturation;
      if (hydrogen < p.carbon) return 'Hydrogen count would fall below the carbon count';
      if ((p.sample * hydrogen) % 4) return 'Oxygen consumption would not be a whole number of mmol';
      return null;
    },
    sample(rng) {
      for (let attempt = 0; attempt < 1000; attempt++) {
        const carbon = rng.int(2, 10);
        const p = { carbon, unsaturation: rng.int(0, Math.floor((carbon + 2) / 2)), sample: rng.int(1, 10) };
        if (this.check(p) === null) return p;
      }
      throw new Error('Could not sample a valid combustion variant');
    },
    build({ carbon, unsaturation, sample }) {
      const hydrogen = 2 * carbon + 2 - 2 * unsaturation;
      const oxygen = sample * (4 * carbon + hydrogen) / 4, dioxide = sample * carbon;
      return {
        stem: `${sample} mmol of a hydrocarbon is burnt completely in excess oxygen. The combustion consumes ${oxygen} mmol O₂ and forms ${dioxide} mmol CO₂; water is the only other product. Find the degree of unsaturation (number of rings plus π bonds) of one molecule.`,
        answer: String(unsaturation),
        solution: [
          `For CₓHᵧ + (x + y/4)O₂ → xCO₂ + (y/2)H₂O, carbon balance gives x = ${dioxide}/${sample} = ${carbon}.`,
          `Oxygen balance gives x + y/4 = ${oxygen}/${sample} = ${fraction(oxygen, sample)}, so y = 4(${fraction(oxygen, sample)} − ${carbon}) = ${hydrogen}. The formula is C${carbon}H${hydrogen}.`,
          `Degree of unsaturation = (2x + 2 − y)/2 = (${2 * carbon + 2} − ${hydrogen})/2 = ${unsaturation}. The formula alone does not decide how many of these are rings or π bonds.`,
        ],
      };
    },
  },
  {
    id: 'math-arrangement-probability-v1', subject: 'mathematics', chapter: 'math-counting', concepts: ['math-counting', 'math-probability'],
    title: 'Random row with separated or grouped people', type: 'numerical',
    skills: ['gap method for separated objects', 'block method for grouped objects', 'classical probability'],
    parameters: { condition: 'apart | together', boys: 'integer, 2–7', girls: 'integer, 2–8' },
    constraints: ['For “apart”, girls ≤ boys + 1; otherwise no arrangement keeps the girls apart and the probability is 0, which this family excludes.'],
    check(p) {
      if (!['apart', 'together'].includes(p?.condition)) return 'Unknown arrangement condition';
      if (!int(p.boys, 2, 7) || !int(p.girls, 2, 8)) return 'Group sizes are outside the family domain';
      if (p.condition === 'apart' && p.girls > p.boys + 1) return 'Too many girls to keep every pair apart';
      return null;
    },
    sample(rng) {
      const condition = pick(rng, ['apart', 'together']), boys = rng.int(2, 7);
      return { condition, boys, girls: rng.int(2, condition === 'apart' ? boys + 1 : 8) };
    },
    build({ condition, boys, girls }) {
      const total = choose(boys + girls, girls);
      // Both counts are divided by boys! × girls!, leaving binomial coefficients.
      const favourable = condition === 'apart' ? choose(boys + 1, girls) : boys + 1;
      const answer = fraction(favourable, total);
      return {
        stem: `${boys} distinct boys and ${girls} distinct girls stand in a row in a uniformly random order. Find the probability that ${condition === 'apart' ? 'no two girls stand next to each other' : 'all the girls stand together in one consecutive block'}. Give an exact fraction or terminating decimal.`,
        answer,
        solution: condition === 'apart' ? [
          `All ${boys + girls} people can be ordered in ${boys + girls}! equally likely ways.`,
          `Arrange the boys first (${boys}! ways). They create ${boys + 1} gaps, including both ends; placing the girls in different gaps keeps them apart, in ${boys + 1}!/${boys + 1 - girls}! ordered ways.`,
          `Probability = ${boys}! × ${boys + 1}!/(${boys + 1 - girls}! × ${boys + girls}!) = C(${boys + 1}, ${girls})/C(${boys + girls}, ${girls}) = ${favourable}/${total}.`,
          `In lowest terms the probability is ${answer}.`,
        ] : [
          `All ${boys + girls} people can be ordered in ${boys + girls}! equally likely ways.`,
          `Treat the girls as one block: the block and ${boys} boys form ${boys + 1} units, ordered in ${boys + 1}! ways, and the girls can be ordered inside the block in ${girls}! ways.`,
          `Probability = ${boys + 1}! × ${girls}!/${boys + girls}! = ${boys + 1}/C(${boys + girls}, ${girls}) = ${favourable}/${total}.`,
          `In lowest terms the probability is ${answer}.`,
        ],
      };
    },
  },
  {
    id: 'math-ap-variance-v1', subject: 'mathematics', chapter: 'math-statistics', concepts: ['math-statistics', 'math-sequences'],
    title: 'Variance of a transformed progression', type: 'numerical',
    skills: ['arithmetic progressions', 'variance of equally spaced data', 'effect of linear transformations on variance'],
    parameters: { count: 'integer, 3–15', first: 'integer, −10 to 10', difference: 'integer, 1–6', scale: '−3, −2, −1, 1, 2 or 3', shift: 'integer, −20 to 20' },
    constraints: ['The scale factor is nonzero; a zero scale collapses every observation to the same value.', 'Population variance uses divisor n.'],
    check(p) {
      if (!int(p?.count, 3, 15)) return 'Number of observations must be 3 to 15';
      if (!int(p.first, -10, 10) || !int(p.difference, 1, 6) || !int(p.shift, -20, 20)) return 'Progression or shift is outside the family domain';
      if (!int(p.scale, -3, 3) || p.scale === 0) return 'Scale factor must be a nonzero integer from −3 to 3';
      return null;
    },
    sample(rng) { return { count: rng.int(3, 15), first: rng.int(-10, 10), difference: rng.int(1, 6), scale: pick(rng, [-3, -2, -1, 1, 2, 3]), shift: rng.int(-20, 20) }; },
    build({ count, first, difference, scale, shift }) {
      const answer = fraction(scale * scale * difference * difference * (count * count - 1), 12);
      return {
        stem: `The n = ${count} observations x₁, …, xₙ are the first ${count} terms of an arithmetic progression with first term ${signed(first)} and common difference ${difference}. Each observation is transformed to yᵢ = ${linearText(scale, shift)}. Using the population variance (divisor n), find the variance of the y-values. A fraction is accepted.`,
        answer,
        solution: [
          `Var(px + q) = p²Var(x): adding ${signed(shift)} shifts every value equally, and the first term ${signed(first)} does not affect spread either.`,
          `The terms are ${signed(first)} + ${difference}k for k = 0, …, ${count - 1}, so Var(x) = ${difference}² × Var(0, 1, …, ${count - 1}) = ${difference}²(n² − 1)/12 = ${fraction(difference * difference * (count * count - 1), 12)}.`,
          `Var(y) = (${signed(scale)})² × ${fraction(difference * difference * (count * count - 1), 12)} = ${answer}.`,
        ],
      };
    },
  },
  {
    id: 'math-point-plane-v1', subject: 'mathematics', chapter: 'math-geometry3d', concepts: ['math-geometry3d', 'math-vectors'],
    title: 'Distance to a plane given by direction vectors', type: 'numerical',
    skills: ['vector form of a plane', 'cross product as a normal', 'perpendicular distance'],
    parameters: { point: 'A, integer coordinates −5 to 5', u: 'integer components −3 to 3', v: 'integer components −3 to 3', target: 'P, integer coordinates −6 to 6' },
    constraints: ['u × v ≠ 0: parallel or zero direction vectors do not determine a plane.'],
    check(p) {
      if (!integerVector(p?.point, -5, 5) || !integerVector(p.target, -6, 6)) return 'Point coordinates are outside the family domain';
      if (!integerVector(p.u, -3, 3) || !integerVector(p.v, -3, 3)) return 'Direction vectors are outside the family domain';
      if (cross(p.u, p.v).every(x => x === 0)) return 'Direction vectors are parallel or zero, so they do not define a plane';
      return null;
    },
    sample(rng) {
      const v3 = (a, b) => [rng.int(a, b), rng.int(a, b), rng.int(a, b)];
      for (let attempt = 0; attempt < 1000; attempt++) {
        const p = { point: v3(-5, 5), u: v3(-3, 3), v: v3(-3, 3), target: v3(-6, 6) };
        if (this.check(p) === null) return p;
      }
      throw new Error('Could not sample a valid plane variant');
    },
    build({ point, u, v, target }) {
      const normal = cross(u, v), offset = target.map((x, i) => x - point[i]);
      const projection = dot(normal, offset), length = dot(normal, normal);
      const answer = fraction(projection * projection, length);
      return {
        stem: `A plane passes through A${vector(point)} and is parallel to the vectors u = ${vector(u)} and v = ${vector(v)}. Find the square of the perpendicular distance from P${vector(target)} to this plane. A fraction is accepted.`,
        answer,
        solution: [
          `A normal to the plane is n = u × v = ${vector(normal)}, so |n|² = ${length}.`,
          `AP = P − A = ${vector(offset)}, and n · AP = ${signed(projection)}.`,
          `The distance is |n · AP|/|n|, so its square is (${signed(projection)})²/${length} = ${answer}.`,
        ],
      };
    },
  },
].map(definition => Object.freeze(definition)));

const byId = new Map(MULTI_CONCEPT_FAMILIES.map(family => [family.id, family]));
function definition(templateId) {
  const family = byId.get(templateId);
  if (!family) throw new Error('Unknown multi-concept family');
  return family;
}

/** Null when the parameters are inside the documented domain, else the reason. */
export function checkFamilyParameters(templateId, parameters) {
  try { return definition(templateId).check(parameters); }
  catch (error) { return error.message; }
}

/** Build from explicit parameters for audits and documentation. Not a playable identity: it has no seed. */
export function buildFromParameters(templateId, parameters) {
  const family = definition(templateId);
  const reason = family.check(parameters);
  if (reason) throw new Error(`Invalid parameters for ${templateId}: ${reason}`);
  return { templateId, ...family.build(parameters) };
}

/** Seeded construction used by generate(): the sampled parameters must pass the same check. */
export function sampleAndBuild(family, rng) {
  const parameters = family.sample(rng);
  const reason = family.check(parameters);
  if (reason) throw new Error(`Sampler produced invalid parameters for ${family.id}: ${reason}`);
  return family.build(parameters);
}
