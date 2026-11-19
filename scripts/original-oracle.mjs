// Independent exact-arithmetic oracle for the multi-concept original families.
//
// Deliberately separate from src/questions/: it imports nothing from the
// generator or the grader. solve(stem) reads only the question text and
// re-derives the answer by a different method from the authored solution
// (dynamics instead of energy, enthalpy bookkeeping instead of case analysis,
// oxidation-state arithmetic instead of balanced-equation ratios, brute-force
// enumeration, least squares instead of a cross product). feasible(params)
// re-states each family's validity rule from first principles.
//
// This is machine checking written by the same AI author as the generator.
// It is independent in method and code path, not a human audit.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const big = value => BigInt(value);
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };

export class Q {
  constructor(n, d = 1n) {
    n = big(n); d = big(d);
    if (d === 0n) throw new RangeError('Zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g; this.d = d / g;
    Object.freeze(this);
  }
  static of(value) { return value instanceof Q ? value : Q.parse(String(value)); }
  /** Exact decimal, integer or a/b text, accepting the typographic minus. */
  static parse(text) {
    const s = String(text).trim().replace(/−/g, '-');
    let match = s.match(/^([+-]?\d+)\s*\/\s*([+-]?\d+)$/);
    if (match) return new Q(match[1], match[2]);
    match = s.match(/^([+-]?)(\d*)(?:\.(\d*))?$/);
    if (!match || (match[2] === '' && !match[3])) throw new SyntaxError(`Not an exact number: ${text}`);
    const fraction = match[3] || '';
    const n = big((match[2] || '0') + fraction) * (match[1] === '-' ? -1n : 1n);
    return new Q(n, 10n ** big(fraction.length));
  }
  add(o) { o = Q.of(o); return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Q.of(o); return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Q.of(o); return new Q(this.n * o.n, this.d * o.d); }
  div(o) { o = Q.of(o); return new Q(this.n * o.d, this.d * o.n); }
  cmp(o) { o = Q.of(o); const x = this.n * o.d, y = o.n * this.d; return x < y ? -1 : x > y ? 1 : 0; }
  eq(o) { return this.cmp(o) === 0; }
  toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
}
const q = value => Q.of(value);
const ZERO = q(0);

function grab(stem, pattern, label) {
  const match = stem.match(pattern);
  if (!match) throw new Error(`Oracle could not read ${label}`);
  return match.slice(1);
}
const numbers = text => [...text.matchAll(/[−-]?\d+/g)].map(m => q(m[0]));

// ---------- physics ----------

// Moment-of-inertia factors from their definitions, for the bodies named in the text.
const INERTIA = [[/thin uniform ring/, q(1)], [/uniform solid disc/, q('1/2')], [/uniform solid sphere/, q('2/5')]];
function rolling(stem) {
  const beta = INERTIA.find(([pattern]) => pattern.test(stem))?.[1];
  if (!beta) throw new Error('Oracle could not identify the rolling body');
  const [sin, cos] = grab(stem, /sin θ = (\d+\/\d+) \(so cos θ = (\d+\/\d+)\)/, 'incline').map(q);
  const [mu, height] = grab(stem, /μ = ([\d.]+)\..*height of (\d+) m/, 'friction and height').map(q);
  const g = q(10);
  // Newton + torque with m = R = 1: g sinθ − f = a, f = β α, a = α.
  // Solve the 2×2 linear system for (a, f) by elimination.
  const a = g.mul(sin).div(q(1).add(beta));
  const f = beta.mul(a);
  const normal = g.mul(cos);
  if (f.cmp(mu.mul(normal)) > 0) return { feasible: false };
  const distance = height.div(sin); // along the incline
  return { feasible: true, answer: q(2).mul(a).mul(distance) }; // v² = 2as
}

function inductionRod(stem) {
  const [length, resistance, field, mass] = grab(stem, /rails ([\d.]+) m apart.*by a (\d+) Ω resistor.*field of ([\d.]+) T.*mass ([\d.]+) kg/, 'rod data').map(q);
  const g = q(10);
  // Net force through the physical chain emf → current → force, as a function of v.
  const net = v => { const emf = field.mul(length).mul(v); const current = emf.div(resistance); return mass.mul(g).sub(field.mul(current).mul(length)); };
  // Net force is affine in v; its root is the terminal speed.
  const f0 = net(ZERO), f1 = net(q(1));
  const speed = f0.div(f0.sub(f1));
  // Energy cross-check: gravitational power equals Joule heating at terminal speed.
  const current = field.mul(length).mul(speed).div(resistance);
  if (!mass.mul(g).mul(speed).eq(current.mul(current).mul(resistance))) throw new Error('Power balance failed');
  return { feasible: speed.cmp(100) <= 0, answer: speed };
}

function iceWater(stem) {
  const [ice, water, temperature] = grab(stem, /^(\d+) g of ice at 0 °C is dropped into (\d+) g of water at (\d+) °C/, 'masses').map(q);
  const latent = q(80), c = q(1);
  // Enthalpy relative to ice at 0 °C: water at T carries (L + cT) per gram.
  const enthalpy = water.mul(latent.add(c.mul(temperature)));
  const total = ice.add(water);
  // A state at 0 °C with liquid mass x has enthalpy L·x; above 0 °C everything is liquid.
  if (enthalpy.cmp(latent.mul(total)) >= 0) return { feasible: true, answer: total };
  return { feasible: true, answer: enthalpy.div(latent) };
}

// ---------- chemistry ----------

const OXIDATION = { O: q(-2), H: q(1), K: q(1), S: q(6) };
/** Oxidation state of `element` in a species from its atom counts and charge, all others fixed. */
function oxidationState(atoms, charge, element) {
  let rest = q(charge);
  for (const [symbol, count] of Object.entries(atoms)) if (symbol !== element) rest = rest.sub(OXIDATION[symbol].mul(count));
  return rest.div(atoms[element]);
}
const SPECIES = {
  'MnO₄⁻': { element: 'Mn', before: () => oxidationState({ Mn: 1, O: 4 }, -1, 'Mn'), after: q(2), atoms: 1 },
  'Cr₂O₇²⁻': { element: 'Cr', before: () => oxidationState({ Cr: 2, O: 7 }, -2, 'Cr'), after: q(3), atoms: 2 },
  'Fe²⁺': { element: 'Fe', before: () => q(2), after: q(3), atoms: 1 },
  'H₂C₂O₄': { element: 'C', before: () => oxidationState({ H: 2, C: 2, O: 4 }, 0, 'C'), after: oxidationState({ C: 1, O: 2 }, 0, 'C'), atoms: 2 },
};
const electrons = name => { const s = SPECIES[name]; return s.after.sub(s.before()).mul(s.atoms); };
function redoxTitration(stem) {
  if (!/^In acidic solution/.test(stem)) return { feasible: false };
  const [sample, concentration, titre] = grab(stem, /^In acidic solution, (\d+) mL of .*titrated with ([\d.]+) M .*after (\d+) mL of titrant/, 'volumes').map(q);
  const [oxidant] = grab(stem, /titrant\. (\S+) is reduced/, 'oxidant');
  const [reductant] = grab(stem, /and (\S+) is oxidised/, 'reductant');
  const gained = electrons(oxidant).mul(-1); // electrons gained per oxidant formula unit
  const lost = electrons(reductant);          // electrons lost per reductant formula unit
  if (gained.cmp(0) <= 0 || lost.cmp(0) <= 0) throw new Error('Unexpected electron count');
  // Equivalents of oxidant = equivalents of reductant (mmol × electrons).
  const reductantMmol = concentration.mul(titre).mul(gained).div(lost);
  return { feasible: true, answer: reductantMmol.div(sample) };
}

function combustionDbe(stem) {
  const [sample, oxygen, dioxide] = grab(stem, /^(\d+) mmol of a hydrocarbon.*consumes (\d+) mmol O₂ and forms (\d+) mmol CO₂/, 'amounts').map(q);
  const matches = [];
  // Brute force every small CcHh and keep those consistent with both observations.
  for (let c = 1; c <= 40; c++) for (let h = 0; h <= 2 * c + 2; h++) {
    const perMole = q(c).add(q(h).div(4));
    if (sample.mul(c).eq(dioxide) && sample.mul(perMole).eq(oxygen)) matches.push({ c, h });
  }
  if (matches.length !== 1) throw new Error(`Expected one formula, found ${matches.length}`);
  const { c, h } = matches[0];
  // Valence-sum definition: DBE = 1 + Σ nᵢ(vᵢ − 2)/2 with v(C) = 4, v(H) = 1.
  const dbe = q(1).add(q(c).mul(4 - 2).div(2)).add(q(h).mul(1 - 2).div(2));
  return { feasible: h % 2 === 0 && h >= c, answer: dbe };
}

// ---------- mathematics ----------

function arrangement(stem) {
  const [boys, girls] = grab(stem, /^(\d+) distinct boys and (\d+) distinct girls/, 'group sizes').map(Number);
  const apart = /no two girls stand next to each other/.test(stem);
  const together = /all the girls stand together/.test(stem);
  if (apart === together) throw new Error('Oracle could not read the condition');
  const size = boys + girls;
  // Every girl-position pattern corresponds to boys!·girls! equally likely orders.
  let favourable = 0, total = 0;
  for (let mask = 0; mask < 1 << size; mask++) {
    let bits = 0;
    for (let i = 0; i < size; i++) if (mask >> i & 1) bits++;
    if (bits !== girls) continue;
    total++;
    if (apart && !(mask & (mask >> 1))) favourable++;
    if (together) { const low = mask & -mask; if (((mask / low) & ((mask / low) + 1)) === 0) favourable++; }
  }
  return { feasible: favourable > 0, answer: q(favourable).div(total) };
}

function apVariance(stem) {
  const [count, first, difference] = grab(stem, /n = (\d+) observations.*first term ([−-]?\d+) and common difference (\d+)/, 'progression').map(text => Number(text.replace('−', '-')));
  const [expression] = grab(stem, /yᵢ = ([^.]+)\. Using/, 'transformation');
  const match = expression.replace(/−/g, '-').replace(/\s+/g, '').match(/^([+-]?\d*)xᵢ(?:([+-])(\d+))?$/);
  if (!match) throw new Error('Oracle could not read the transformation');
  const scale = match[1] === '' || match[1] === '+' ? 1 : match[1] === '-' ? -1 : Number(match[1]);
  const shift = match[2] ? (match[2] === '-' ? -1 : 1) * Number(match[3]) : 0;
  const values = Array.from({ length: count }, (_, k) => q(scale * (first + k * difference) + shift));
  const mean = values.reduce((sum, value) => sum.add(value), ZERO).div(count);
  const variance = values.reduce((sum, value) => { const gap = value.sub(mean); return sum.add(gap.mul(gap)); }, ZERO).div(count);
  return { feasible: scale !== 0, answer: variance };
}

function pointPlane(stem) {
  const [a, u, v, p] = grab(stem, /through A(\([^)]*\)).*u = (\([^)]*\)) and v = (\([^)]*\)).*from P(\([^)]*\))/, 'vectors').map(numbers);
  const dot = (x, y) => x.reduce((sum, value, i) => sum.add(value.mul(y[i])), ZERO);
  const w = p.map((value, i) => value.sub(a[i]));
  // Least squares: minimise |w − s·u − t·v|² via the 2×2 normal equations.
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), uw = dot(u, w), vw = dot(v, w);
  const determinant = uu.mul(vv).sub(uv.mul(uv));
  if (determinant.eq(ZERO)) return { feasible: false };
  const s = uw.mul(vv).sub(vw.mul(uv)).div(determinant);
  const t = uu.mul(vw).sub(uv.mul(uw)).div(determinant);
  const residual = w.map((value, i) => value.sub(s.mul(u[i])).sub(t.mul(v[i])));
  return { feasible: true, answer: dot(residual, residual) };
}

export const ORACLES = Object.freeze({
  'phy-rolling-incline-v1': rolling,
  'phy-induction-rod-v1': inductionRod,
  'phy-ice-water-v1': iceWater,
  'chem-redox-titration-v1': redoxTitration,
  'chem-combustion-dbe-v1': combustionDbe,
  'math-arrangement-probability-v1': arrangement,
  'math-ap-variance-v1': apVariance,
  'math-point-plane-v1': pointPlane,
});

/** Parameter-level validity restated independently of the generator's check(). */
export const FEASIBLE = Object.freeze({
  'phy-rolling-incline-v1': p => {
    const beta = { ring: q(1), disc: q('1/2'), sphere: q('2/5') }[p.body];
    if (!beta || !Number.isInteger(p.height) || p.height < 1 || p.height > 20) return false;
    // Required friction from f = βa ≤ μN, with a = g sinθ/(1+β), N = g cosθ.
    const required = beta.mul(q('3/5')).div(q(1).add(beta)).div(q('4/5'));
    return ['0.2', '0.25', '0.3', '0.375', '0.4', '0.5', '0.6'].includes(p.friction) && required.cmp(q(p.friction)) <= 0;
  },
  'phy-induction-rod-v1': p => Number.isInteger(p.massTenths) && p.massTenths >= 1 && p.massTenths <= 10 && Number.isInteger(p.resistance) && p.resistance >= 1 && p.resistance <= 12
    && ['0.5', '1', '1.5', '2'].includes(p.field) && ['0.5', '1', '2'].includes(p.length)
    && q(p.massTenths).div(10).mul(10).mul(p.resistance).div(q(p.field).mul(p.field).mul(p.length).mul(p.length)).cmp(100) <= 0,
  'phy-ice-water-v1': p => [p.ice, p.water, p.temperature].every(Number.isInteger) && p.ice >= 10 && p.ice <= 200 && p.ice % 10 === 0 && p.water >= 50 && p.water <= 500 && p.water % 10 === 0 && p.temperature > 0 && p.temperature < 100,
  'chem-redox-titration-v1': p => p.medium === 'acidic' && ['KMnO4', 'K2Cr2O7'].includes(p.oxidant) && ['FeSO4', 'H2C2O4'].includes(p.reductant)
    && ['0.01', '0.02', '0.05', '0.1'].includes(p.concentration) && Number.isInteger(p.titre) && p.titre >= 5 && p.titre <= 50 && [10, 20, 25, 50].includes(p.sample),
  'chem-combustion-dbe-v1': p => {
    if (![p.carbon, p.unsaturation, p.sample].every(Number.isInteger) || p.carbon < 2 || p.carbon > 10 || p.unsaturation < 0 || p.sample < 1 || p.sample > 10) return false;
    const hydrogen = 2 * p.carbon + 2 - 2 * p.unsaturation;
    return hydrogen >= p.carbon && q(p.sample).mul(q(p.carbon).add(q(hydrogen).div(4))).d === 1n;
  },
  'math-arrangement-probability-v1': p => ['apart', 'together'].includes(p.condition) && Number.isInteger(p.boys) && p.boys >= 2 && p.boys <= 7 && Number.isInteger(p.girls) && p.girls >= 2 && p.girls <= 8
    && (p.condition === 'together' || p.girls <= p.boys + 1),
  'math-ap-variance-v1': p => [p.count, p.first, p.difference, p.scale, p.shift].every(Number.isInteger) && p.count >= 3 && p.count <= 15 && Math.abs(p.first) <= 10
    && p.difference >= 1 && p.difference <= 6 && p.scale !== 0 && Math.abs(p.scale) <= 3 && Math.abs(p.shift) <= 20,
  'math-point-plane-v1': p => {
    const ok = (x, limit) => Array.isArray(x) && x.length === 3 && x.every(value => Number.isInteger(value) && Math.abs(value) <= limit);
    if (!ok(p.point, 5) || !ok(p.target, 6) || !ok(p.u, 3) || !ok(p.v, 3)) return false;
    // Parallel or zero direction vectors: the Gram determinant |u|²|v|² − (u·v)² vanishes.
    const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    return dot(p.u, p.u) * dot(p.v, p.v) - dot(p.u, p.v) ** 2 !== 0;
  },
});

/** Audit one generated or parameter-built question. Returns {ok, expected, reason}. */
export function auditQuestion(question) {
  const oracle = ORACLES[question.templateId];
  if (!oracle) return { ok: false, reason: 'No oracle for this family' };
  const result = oracle(question.stem);
  if (!result.feasible) return { ok: false, reason: 'Oracle judges the stated situation infeasible' };
  const ok = result.answer.eq(Q.parse(question.answer));
  return { ok, expected: result.answer.toString(), reason: ok ? null : `Oracle expected ${result.answer}, generator stated ${question.answer}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // CLI: audit N seeds of every oracle-backed family, e.g. `node scripts/original-oracle.mjs 2000`.
  const { generate } = await import('../src/questions/index.js');
  const count = Number(process.argv[2] || 1000);
  let failures = 0;
  for (const id of Object.keys(ORACLES)) {
    for (let i = 0; i < count; i++) {
      const seed = Math.imul(i + 1, 2654435761) >>> 0;
      const result = auditQuestion(generate(id, seed));
      if (!result.ok) { failures++; console.error(`${id}:${seed} ${result.reason}`); }
    }
    console.log(`${id}: ${count} seeds audited`);
  }
  process.exitCode = failures ? 1 : 0;
}
