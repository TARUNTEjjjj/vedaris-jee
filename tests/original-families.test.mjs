import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CHAPTERS, generate, listTemplates, familyDomain, checkFamilyParameters, buildFromParameters } from '../src/questions/index.js';
import { MULTI_CONCEPT_FAMILIES } from '../src/questions/multi-concept.js';
import { gradeQuestion } from '../src/questions/grading.js';
import { restoreSession, gradeSession, sessionItems, createSession } from '../src/practice/session.js';
import { importProgress, getStats } from '../src/learning/progress.js';
import { ORACLES, FEASIBLE, Q, auditQuestion } from '../scripts/original-oracle.mjs';
import { originalCoverage, coverageMarkdown, replaceCoverage, auditKind } from '../scripts/original-coverage.mjs';

const now = 1_760_000_000_000;
const seeds = (count, salt = 1) => Array.from({ length: count }, (_, i) => Math.imul(i + salt, 2654435761) >>> 0);
const NEW_IDS = MULTI_CONCEPT_FAMILIES.map(family => family.id);
// Chapters with an original family before this expansion.
const ORIGINAL_CHAPTERS = new Set(['phy-kinematics', 'phy-newton', 'phy-work', 'phy-momentum', 'phy-oscillations', 'phy-electrostatics', 'phy-circuits', 'phy-optics', 'phy-gravitation', 'phy-modern',
  'chem-mole', 'chem-atomic', 'chem-gases', 'chem-thermo', 'chem-equilibrium', 'chem-ionic', 'chem-electrochemistry', 'chem-kinetics', 'chem-solutions', 'chem-organic',
  'math-quadratic', 'math-complex', 'math-sequences', 'math-binomial', 'math-probability', 'math-matrices', 'math-conics', 'math-derivatives', 'math-integrals', 'math-vectors']);

function auditOk(question, context = question.id ?? question.templateId) {
  const result = auditQuestion(question);
  assert.ok(result.ok, `${context}: ${result.reason}`);
}

test('the expansion adds eight multi-concept families in previously uncovered chapters', () => {
  const all = listTemplates();
  assert.equal(all.length, 38);
  assert.equal(new Set(all.map(f => f.id)).size, 38);
  assert.deepEqual(all.slice(30).map(f => f.id), NEW_IDS, 'new families are appended after the original 30');
  assert.deepEqual(Object.keys(ORACLES).sort(), [...NEW_IDS].sort(), 'every new family has an oracle');
  for (const family of all.slice(30)) {
    assert.equal(family.kind, 'multi-concept');
    assert.ok(!ORIGINAL_CHAPTERS.has(family.chapter), `${family.id} should fill a gap chapter`);
    assert.equal(family.concepts[0], family.chapter);
    assert.ok(family.concepts.every(id => CHAPTERS.some(chapter => chapter.id === id && chapter.subject === family.subject)));
    assert.ok(family.skills.length >= 3, `${family.id} lists the concepts it combines`);
    const domain = familyDomain(family.id);
    assert.ok(Object.keys(domain.parameters).length >= 2 && domain.constraints.length >= 1);
  }
  for (const family of all.slice(0, 30)) { assert.equal(family.kind, 'concept'); assert.deepEqual(family.concepts, [family.chapter]); assert.equal(familyDomain(family.id), null); }
  assert.ok(all.slice(30).filter(f => f.concepts.length > 1).length >= 7, 'most new families cross chapter boundaries');
});

test('original 30 families still generate byte-identical questions for existing identities', () => {
  // Digests of [id, stem, options, answer, solution, marking, type, chapter, subject] for 200 seeds,
  // recorded from main before this expansion.
  const expected = { 'phy-projectile-v1': '8ae32b41bd89c6c1', 'phy-atwood-v1': '2ea87c680e6527d5', 'phy-work-spring-v1': '4d770eb734355b86', 'phy-collision-v1': 'ab69856f33e45fa4', 'phy-shm-v1': 'ceb751d88fb47114', 'phy-capacitors-v1': '85d84b772c79f683', 'phy-circuit-v1': '966ddd064f980169', 'phy-lens-v1': '557c830872c2064a', 'phy-orbit-v1': 'a358d6fae0e23033', 'phy-photoelectric-v1': '0354785ba7c60863', 'chem-limiting-v1': 'c1a1cdb9aaf99989', 'chem-hydrogen-v1': '3f11ac055f6a919a', 'chem-gas-v1': '330d7889f09036db', 'chem-hess-v1': 'a4594974d400c93b', 'chem-kc-v1': '3719b34fd48705d4', 'chem-neutralisation-v1': '0c1ecc0414dd8339', 'chem-electrolysis-v1': '6572d2e3a4c9a427', 'chem-first-order-v1': '6ffd5f4c21aa7fbf', 'chem-colligative-v1': '47774a27f535147a', 'chem-isomers-v1': '042ffb6f49795030', 'math-roots-v1': '4773ac7927faca0f', 'math-complex-v1': '4ad9b99c97f1b6ef', 'math-ap-v1': 'b0b0bc5419977077', 'math-binomial-v1': '2eed725a48a5365e', 'math-probability-v1': 'f4328542b81f8949', 'math-matrix-v1': '87a43d416074a1db', 'math-conic-v1': '8f2057d0af8cd976', 'math-optimisation-v1': '6ef4a0f70b6a0b0b', 'math-integral-v1': '2ce9c0c7f253ca7f', 'math-vectors-v1': '349005697958cb99' };
  for (const [id, digest] of Object.entries(expected)) {
    const hash = createHash('sha256');
    for (let i = 0; i < 200; i++) {
      const seed = Math.imul(i + 7, 2654435761) >>> 0, q = generate(id, seed);
      hash.update(JSON.stringify([q.id, q.stem, q.options ?? null, q.answer, q.solution, q.marking, q.type, q.chapter, q.subject]));
    }
    assert.equal(hash.digest('hex').slice(0, 16), digest, id);
  }
});

test('saved sessions and progress that use original identities restore and regrade unchanged', () => {
  // A completed session as stored before this expansion; no field refers to the new families.
  const saved = { version: 1, id: `session-${now}-77`, mode: 'practice', seed: 77, subject: 'all', chapter: 'all', timed: true, minutes: 9, index: 0,
    questions: [{ templateId: 'phy-atwood-v1', seed: 11 }, { templateId: 'chem-kc-v1', seed: 22 }, { templateId: 'math-ap-v1', seed: 33 }],
    responses: ['', '', ''], flags: [false, false, false], visited: [true, true, true], timeSpentMs: [1000, 1000, 1000], timingUpdatedAt: now + 3000, startedAt: now, deadline: now + 540000, finishedAt: now + 4000 };
  saved.responses = saved.questions.map(q => generate(q.templateId, q.seed).answer);
  const restored = restoreSession(JSON.stringify(saved), now + 5000);
  assert.ok(restored);
  assert.deepEqual(sessionItems(restored).map(q => q.id), ['phy-atwood-v1:11', 'chem-kc-v1:22', 'math-ap-v1:33']);
  assert.equal(gradeSession(restored).correct, 3);
  const backup = { app: 'vedaris', version: 1, records: saved.questions.map((q, i) => ({ ...q, response: saved.responses[i], answeredAt: now + 4000 })) };
  assert.equal(getStats(importProgress(JSON.stringify(backup), undefined, now + 5000)).correct, 3);
});

test('the oracle agrees with thousands of seeded variants and catches altered keys', () => {
  for (const id of NEW_IDS) {
    for (const seed of seeds(1500)) {
      const q = generate(id, seed);
      assert.equal(q.origin, 'original'); assert.equal(q.label, 'Original practice');
      assert.equal(q.id, `${id}:${seed}`);
      assert.equal(gradeQuestion(q, q.answer).status, 'correct');
      assert.ok(q.solution.length >= 3 && !/undefined|NaN/.test(q.stem + q.solution.join(' ')));
      auditOk(q);
    }
    const q = generate(id, 12345);
    const altered = Q.parse(q.answer).add(new Q(1, 1000)).toString();
    assert.equal(auditQuestion({ ...q, answer: altered }).ok, false, `${id} audit must reject a wrong key`);
  }
});

// Every point of the small discrete domains, deliberately including out-of-domain values.
function* product(axes) {
  const keys = Object.keys(axes);
  function* walk(index, value) {
    if (index === keys.length) { yield { ...value }; return; }
    for (const option of axes[keys[index]]) yield* walk(index + 1, { ...value, [keys[index]]: option });
  }
  yield* walk(0, {});
}
const range = (from, to, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const EXHAUSTIVE = {
  'phy-rolling-incline-v1': { body: ['ring', 'disc', 'sphere', 'cube'], height: range(0, 21), friction: ['0.1', '0.2', '0.25', '0.3', '0.375', '0.4', '0.5', '0.6'] },
  'phy-induction-rod-v1': { massTenths: range(0, 11), resistance: range(0, 13), field: ['0', '0.5', '1', '1.5', '2'], length: ['0.5', '1', '2'] },
  'phy-ice-water-v1': { ice: range(0, 210, 10), water: range(40, 510, 10), temperature: range(0, 100) },
  'chem-redox-titration-v1': { oxidant: ['KMnO4', 'K2Cr2O7'], reductant: ['FeSO4', 'H2C2O4'], medium: ['acidic', 'neutral', 'alkaline'], concentration: ['0.01', '0.02', '0.05', '0.1'], titre: range(4, 51), sample: [10, 20, 25, 50] },
  'chem-combustion-dbe-v1': { carbon: range(1, 11), unsaturation: range(0, 12), sample: range(0, 11) },
  'math-arrangement-probability-v1': { condition: ['apart', 'together'], boys: range(1, 8), girls: range(1, 9) },
};

test('generator constraints and oracle feasibility agree over every small domain point', () => {
  for (const [id, axes] of Object.entries(EXHAUSTIVE)) {
    let valid = 0, invalid = 0;
    for (const parameters of product(axes)) {
      const reason = checkFamilyParameters(id, parameters);
      assert.equal(reason === null, FEASIBLE[id](parameters), `${id} ${JSON.stringify(parameters)}: generator says ${reason ?? 'valid'}`);
      if (reason === null) { valid++; auditOk(buildFromParameters(id, parameters), `${id} ${JSON.stringify(parameters)}`); }
      else { invalid++; assert.throws(() => buildFromParameters(id, parameters), /Invalid parameters/); }
    }
    assert.ok(valid > 0 && invalid > 0, `${id} domain walk must include both valid and invalid points`);
  }
});

test('larger mathematics domains pass random and targeted audits', () => {
  let state = 987654321;
  const next = (a, b) => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return a + (state % (b - a + 1)); };
  const vec = (a, b) => [next(a, b), next(a, b), next(a, b)];
  for (let i = 0; i < 4000; i++) {
    const ap = { count: next(1, 16), first: next(-11, 11), difference: next(0, 7), scale: next(-4, 4), shift: next(-21, 21) };
    const apReason = checkFamilyParameters('math-ap-variance-v1', ap);
    assert.equal(apReason === null, FEASIBLE['math-ap-variance-v1'](ap), JSON.stringify(ap));
    if (apReason === null) auditOk(buildFromParameters('math-ap-variance-v1', ap));
    const plane = { point: vec(-5, 5), u: vec(-3, 3), v: vec(-3, 3), target: vec(-6, 6) };
    if (i % 5 === 0) plane.v = plane.u.map(x => -2 * x).map(x => Math.max(-3, Math.min(3, x))); // often parallel
    const planeReason = checkFamilyParameters('math-point-plane-v1', plane);
    assert.equal(planeReason === null, FEASIBLE['math-point-plane-v1'](plane), JSON.stringify(plane));
    if (planeReason === null) auditOk(buildFromParameters('math-point-plane-v1', plane));
  }
  for (const [u, v] of [[[1, 1, -1], [2, 2, -2]], [[0, 0, 0], [1, 0, 0]], [[1, -1, 2], [-1, 1, -2]]]) {
    assert.match(checkFamilyParameters('math-point-plane-v1', { point: [0, 0, 0], u, v, target: [1, 1, 1] }), /parallel or zero/);
  }
  assert.match(checkFamilyParameters('math-ap-variance-v1', { count: 5, first: 1, difference: 2, scale: 0, shift: 3 }), /nonzero/);
});

test('boundary cases are accepted exactly at their limits and explained', () => {
  const at = (id, parameters) => buildFromParameters(id, parameters);
  // Friction exactly at the rolling limit 3/8 for a ring, 1/4 for a disc; just below is refused.
  assert.equal(at('phy-rolling-incline-v1', { body: 'ring', height: 4, friction: '0.375' }).answer, '40');
  assert.match(checkFamilyParameters('phy-rolling-incline-v1', { body: 'ring', height: 4, friction: '0.3' }), /too small/);
  assert.equal(at('phy-rolling-incline-v1', { body: 'disc', height: 3, friction: '0.25' }).answer, '40');
  assert.equal(at('phy-rolling-incline-v1', { body: 'sphere', height: 7, friction: '0.25' }).answer, '100');
  // Ice that exactly melts, ice left over, and the warm-water limit.
  const exact = at('phy-ice-water-v1', { ice: 10, water: 80, temperature: 10 });
  assert.equal(exact.answer, '90'); assert.match(exact.solution.join(' '), /exactly 0 °C/);
  assert.equal(at('phy-ice-water-v1', { ice: 200, water: 50, temperature: 3 }).answer, '415/8');
  assert.match(checkFamilyParameters('phy-ice-water-v1', { ice: 10, water: 80, temperature: 100 }), /liquid/);
  // Terminal speed exactly at the 100 m/s limit is allowed.
  assert.equal(at('phy-induction-rod-v1', { massTenths: 10, resistance: 10, field: '1', length: '1' }).answer, '100');
  assert.match(checkFamilyParameters('phy-induction-rod-v1', { massTenths: 10, resistance: 11, field: '1', length: '1' }), /exceeds/);
  // Combustion extremes: an alkane (DBE 0) and the least-saturated permitted formula (H = C).
  assert.equal(at('chem-combustion-dbe-v1', { carbon: 4, unsaturation: 0, sample: 2 }).answer, '0');
  const benzeneLike = at('chem-combustion-dbe-v1', { carbon: 6, unsaturation: 4, sample: 2 });
  assert.equal(benzeneLike.answer, '4'); assert.match(benzeneLike.solution.join(' '), /C6H6/);
  assert.match(checkFamilyParameters('chem-combustion-dbe-v1', { carbon: 6, unsaturation: 5, sample: 2 }), /below the carbon count/);
  assert.match(checkFamilyParameters('chem-combustion-dbe-v1', { carbon: 2, unsaturation: 0, sample: 1 }), /whole number/);
  // Redox: every oxidant/reductant pair, and refusal outside acidic medium.
  assert.equal(at('chem-redox-titration-v1', { oxidant: 'KMnO4', reductant: 'FeSO4', medium: 'acidic', concentration: '0.02', titre: 25, sample: 25 }).answer, '1/10');
  assert.equal(at('chem-redox-titration-v1', { oxidant: 'KMnO4', reductant: 'H2C2O4', medium: 'acidic', concentration: '0.02', titre: 20, sample: 20 }).answer, '1/20');
  assert.equal(at('chem-redox-titration-v1', { oxidant: 'K2Cr2O7', reductant: 'FeSO4', medium: 'acidic', concentration: '0.1', titre: 10, sample: 20 }).answer, '3/10');
  assert.equal(at('chem-redox-titration-v1', { oxidant: 'K2Cr2O7', reductant: 'H2C2O4', medium: 'acidic', concentration: '0.1', titre: 10, sample: 10 }).answer, '3/10');
  assert.match(checkFamilyParameters('chem-redox-titration-v1', { oxidant: 'KMnO4', reductant: 'FeSO4', medium: 'neutral', concentration: '0.02', titre: 25, sample: 25 }), /acidic/);
  // Alternating row: girls = boys + 1 gives 1/C(2b + 1, b); one more girl is refused for "apart" only.
  assert.equal(at('math-arrangement-probability-v1', { condition: 'apart', boys: 3, girls: 4 }).answer, '1/35');
  assert.match(checkFamilyParameters('math-arrangement-probability-v1', { condition: 'apart', boys: 3, girls: 5 }), /apart/);
  assert.equal(at('math-arrangement-probability-v1', { condition: 'together', boys: 3, girls: 5 }).answer, '1/14');
  // Point on the plane: distance 0; smallest AP sample.
  assert.equal(at('math-point-plane-v1', { point: [1, 2, 3], u: [1, 0, 0], v: [0, 1, 0], target: [4, -5, 3] }).answer, '0');
  assert.equal(at('math-ap-variance-v1', { count: 3, first: -10, difference: 1, scale: -1, shift: 0 }).answer, '2/3');
  for (const id of NEW_IDS) assert.throws(() => buildFromParameters(id, {}), /Invalid parameters/);
  assert.throws(() => buildFromParameters('phy-atwood-v1', {}), /Unknown multi-concept family/);
});

test('equivalent answer forms earn credit and rounded non-terminating decimals do not', () => {
  const terminating = q => { let d = Q.parse(q.answer).d; for (const p of [2n, 5n]) while (d % p === 0n) d /= p; return d === 1n; };
  const decimal = ({ n, d }) => {
    let digits = 0n;
    while ((10n ** digits) % d !== 0n) digits++;
    const units = n * 10n ** digits / d, sign = units < 0n ? '-' : '', text = (units < 0n ? -units : units).toString().padStart(Number(digits) + 1, '0');
    return digits ? `${sign}${text.slice(0, -Number(digits))}.${text.slice(-Number(digits))}` : `${sign}${text}`;
  };
  let checkedDecimal = 0, checkedRounding = 0;
  for (const id of NEW_IDS) for (const seed of seeds(200, 3)) {
    const q = generate(id, seed), value = Q.parse(q.answer);
    assert.equal(gradeQuestion(q, `${value.n * 3n}/${value.d * 3n}`).status, 'correct', 'unreduced fraction');
    if (terminating(q)) { assert.equal(gradeQuestion(q, decimal(value)).status, 'correct', `${q.id} decimal ${decimal(value)}`); checkedDecimal++; }
    else { assert.equal(gradeQuestion(q, (Number(value.n) / Number(value.d)).toFixed(3)).status, 'incorrect', `${q.id} rounded`); checkedRounding++; }
  }
  assert.ok(checkedDecimal > 100 && checkedRounding > 100);
});

test('new families are labelled original practice and are not counted as historical questions', async () => {
  const catalog = JSON.parse(await readFile(new URL('../content/catalog.json', import.meta.url), 'utf8'));
  const serialised = JSON.stringify(catalog);
  for (const family of listTemplates()) {
    assert.doesNotMatch(family.id, /^\d{4}_P\d_/, 'original IDs never look like PYQ IDs');
    assert.ok(!serialised.includes(family.id), `${family.id} must not appear in the PYQ catalog`);
  }
  for (const id of NEW_IDS) {
    const session = createSession({ subject: 'all', chapter: listTemplates().find(f => f.id === id).chapter, count: 3, seed: 9, timed: false, now });
    for (const item of sessionItems(session)) { assert.equal(item.templateId, id); assert.equal(item.origin, 'original'); }
  }
});

test('coverage map counts audited families per chapter and the published document is current', async () => {
  const map = originalCoverage();
  assert.equal(map.familyCount, 38); assert.equal(map.auditedFamilyCount, 38); assert.equal(map.exactOracleFamilyCount, 8);
  assert.equal(map.coveredChapterCount, 38); assert.equal(map.gaps.length, 16);
  for (const id of NEW_IDS) assert.equal(auditKind(id), 'exact-oracle');
  assert.equal(auditKind('phy-atwood-v1'), 'statement-recovery'); assert.equal(auditKind('phy-orbit-v1'), 'key-text-check');
  for (const chapter of map.chapters) if (chapter.families.length) assert.ok(!map.gaps.includes(chapter.id));
  const document = await readFile(new URL('../docs/ORIGINAL-PRACTICE.md', import.meta.url), 'utf8');
  assert.equal(replaceCoverage(document), document, 'run node scripts/original-coverage.mjs --write');
  assert.match(coverageMarkdown(map), /Seeds and variants are not counted/);
  assert.match(document, /No human audit occurred/);
});
