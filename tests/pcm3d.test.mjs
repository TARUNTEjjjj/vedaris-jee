import test from 'node:test';
import assert from 'node:assert/strict';
import {
  add3,
  axisAngleMatrix3,
  buildCrystalLattice,
  buildManifoldMesh,
  describePCMMode,
  dot3,
  evaluateManifold,
  integrateSphericalHarmonicNorm,
  keplerRadius,
  keplerSemiLatusRectum,
  keplerState,
  lookAtMatrix4,
  manifoldProbeFrame,
  manifoldToWorld,
  mat3Apply,
  mat3Det,
  mat3Mul,
  mat3Transpose,
  mat4Mul,
  norm3,
  orbitCameraEye,
  perspectiveMatrix4,
  projectPoint3D,
  realSphericalHarmonic,
  rotationMatrix3,
  sampleOrbitalProbabilityCloud,
  solveKeplerEquation,
  sub3,
} from '../src/visual/pcm3d-math.js';
import { mountPCM3D } from '../src/visual/pcm3d.js';

function assertClose(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tolerance, `${message}: expected ${expected} ± ${tolerance}, got ${actual} (diff ${diff})`);
}

function deterministicStream(seed = 2026) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('SO(3) orbital rotation matrices satisfy orthogonality R^T R = I and det(R) = 1', () => {
  const rand = deterministicStream(1337);
  for (let i = 0; i < 120; i++) {
    const yaw = (rand() - 0.5) * 4 * Math.PI;
    const pitch = (rand() - 0.5) * 2 * Math.PI;
    const roll = (rand() - 0.5) * 4 * Math.PI;
    const R = i % 2 === 0
      ? rotationMatrix3(yaw, pitch, roll)
      : axisAngleMatrix3([rand() - 0.5, rand() - 0.5, rand() - 0.5 || 1], yaw);

    assertClose(mat3Det(R), 1, 1e-12, `det(R) at sample ${i}`);

    const RtR = mat3Mul(mat3Transpose(R), R);
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let k = 0; k < 9; k++) {
      assertClose(RtR[k], identity[k], 1e-12, `R^T R[${k}] at sample ${i}`);
    }

    const u = [rand() * 4 - 2, rand() * 4 - 2, rand() * 4 - 2];
    const v = [rand() * 4 - 2, rand() * 4 - 2, rand() * 4 - 2];
    const ru = mat3Apply(R, u);
    const rv = mat3Apply(R, v);
    assertClose(norm3(ru), norm3(u), 1e-12, 'norm invariance');
    assertClose(dot3(ru, rv), dot3(u, v), 1e-12, 'inner-product invariance');
  }
});

test('3D perspective projection maps camera target to viewport center and preserves depth order', () => {
  const rand = deterministicStream(42);
  for (let i = 0; i < 30; i++) {
    const yaw = (rand() - 0.5) * Math.PI * 2;
    const pitch = (rand() - 0.5) * 2.2;
    const dist = 2.8 + rand() * 4.0;
    const eye = orbitCameraEye(yaw, pitch, dist);
    const view = lookAtMatrix4(eye, [0, 0, 0], [0, 1, 0]);
    const proj = perspectiveMatrix4(0.68, 16 / 10, 0.1, 35);
    const vp = mat4Mul(proj, view);

    const center = projectPoint3D([0, 0, 0], vp, 640, 400);
    assert.equal(center.visible, true);
    assertClose(center.x, 320, 1e-4, 'projected target X');
    assertClose(center.y, 200, 1e-4, 'projected target Y');

    // Point closer to eye along view vector has smaller NDC depth than point behind target
    const forward = [ -eye[0] / norm3(eye), -eye[1] / norm3(eye), -eye[2] / norm3(eye) ];
    const nearPt = add3([0, 0, 0], [-forward[0] * 0.6, -forward[1] * 0.6, -forward[2] * 0.6]);
    const farPt = add3([0, 0, 0], [forward[0] * 0.6, forward[1] * 0.6, forward[2] * 0.6]);
    const nearProj = projectPoint3D(nearPt, vp, 640, 400);
    const farProj = projectPoint3D(farPt, vp, 640, 400);
    assert.ok(nearProj.depth < center.depth && center.depth < farProj.depth, 'monotone depth ordering');
  }
});

test('Keplerian focus equation, Kepler solver, vis-viva, areal velocity and Lenz invariants hold to < 1e-10', () => {
  const rand = deterministicStream(9001);
  for (let trial = 0; trial < 40; trial++) {
    const a = 0.8 + rand() * 3.0;
    const e = trial === 0 ? 0 : rand() * 0.9;
    const mu = 0.4 + rand() * 4.5;
    const p = keplerSemiLatusRectum(a, e);
    assertClose(p, a * (1 - e * e), 1e-12, 'semi-latus rectum');

    const expectedArealVelocity = 0.5 * Math.sqrt(mu * p);
    for (let k = 0; k < 12; k++) {
      const M = (k / 12) * Math.PI * 2 + rand() * 0.2;
      const E = solveKeplerEquation(M, e);
      const wrappedM = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      assertClose(E - e * Math.sin(E), wrappedM, 1e-11, 'Kepler equation residual');

      const state = keplerState(M, { a, e, mu, inclination: 0.48, precession: trial * 0.13 });
      assertClose(state.r, keplerRadius(a, e, state.theta), 1e-12, 'radius parity');
      assertClose(state.r * (1 + e * Math.cos(state.theta)), a * (1 - e * e), 1e-10, 'conic focus equation');
      assertClose(state.speed, state.visVivaSpeed, 1e-11, 'vis-viva energy conservation');
      assertClose(state.arealVelocity, expectedArealVelocity, 1e-11, 'Kepler second law areal velocity');
      assertClose(norm3(state.lenzVector), mu * e, 1e-11, 'Laplace-Runge-Lenz vector magnitude');
      assertClose(dot3(state.lenzVector, state.normalAxis), 0, 1e-11, 'Lenz vector lies in orbital plane');
    }
  }
});

test('Spherical harmonic |Y_2^0|^2 and |Y_1^0|^2 satisfy normalization, parity, and nodal cone invariants', () => {
  for (const [l, m] of [[0, 0], [1, 0], [1, 1], [2, 0], [2, 1]]) {
    const integral = integrateSphericalHarmonicNorm(l, m, 180, 90);
    assertClose(integral, 1, 1e-4, `normalization of Y_${l}^${m}`);
  }

  // d_z2 (Y_2^0) symmetry & nodal cones: 3 cos^2(theta) - 1 = 0 => theta = acos(+- 1/sqrt(3))
  const nodalTheta = Math.acos(1 / Math.sqrt(3));
  assertClose(realSphericalHarmonic(2, 0, nodalTheta).density, 0, 1e-28, 'd_z2 upper nodal cone');
  assertClose(realSphericalHarmonic(2, 0, Math.PI - nodalTheta).density, 0, 1e-28, 'd_z2 lower nodal cone');

  for (const theta of [0.15, 0.72, 1.15, 1.4]) {
    const upper = realSphericalHarmonic(2, 0, theta);
    const lower = realSphericalHarmonic(2, 0, Math.PI - theta);
    assertClose(upper.value, lower.value, 1e-14, 'Y_2^0 even reflection symmetry');
    const phiA = realSphericalHarmonic(2, 0, theta, 0.3);
    const phiB = realSphericalHarmonic(2, 0, theta, 2.7);
    assertClose(phiA.density, phiB.density, 1e-15, 'Y_2^0 azimuthal symmetry');
  }

  const pole = realSphericalHarmonic(2, 0, 0).value;
  const equator = realSphericalHarmonic(2, 0, Math.PI / 2).value;
  assert.ok(pole > 0 && equator < 0, 'd_z2 opposite axial and toroidal signs');
  assertClose(Math.abs(pole / equator), 2, 1e-14, 'd_z2 pole-to-equator amplitude ratio');

  // p_z (Y_1^0) odd parity and equatorial nodal plane
  assertClose(realSphericalHarmonic(1, 0, Math.PI / 2).value, 0, 1e-15, 'p_z equatorial node');
  assertClose(realSphericalHarmonic(1, 0, 0.5).value, -realSphericalHarmonic(1, 0, Math.PI - 0.5).value, 1e-15, 'p_z odd parity');

  const dz2Cloud = sampleOrbitalProbabilityCloud('dz2', 400);
  assert.equal(dz2Cloud.length, 400);
  assert.ok(dz2Cloud.some(p => p.phase > 0) && dz2Cloud.some(p => p.phase < 0), 'd_z2 cloud samples both wavefunction phases');
  assert.deepEqual(dz2Cloud, sampleOrbitalProbabilityCloud('dz2', 400), 'orbital sampling is deterministic');
});

test('FCC and BCC crystal lattices enforce exact stoichiometry, coordination counts, and nearest-neighbor geometry', () => {
  for (const a of [1, 2.45, 4.08]) {
    const fcc = buildCrystalLattice('fcc', a);
    assert.equal(fcc.nodes.length, 14);
    assert.equal(fcc.edges.length, 12);
    assert.equal(fcc.atomsPerUnitCell, 4);
    assert.equal(fcc.coordinationNumber, 12);
    assertClose(fcc.nearestNeighborDistance, a / Math.SQRT2, 1e-12, 'FCC d_min');
    assertClose(fcc.packingEfficiency, (Math.PI * Math.SQRT2) / 6, 1e-12, 'FCC packing efficiency');
    // In a single closed unit cell, each of 6 face centers touches 4 corners (24) + 4 adjacent face centers (12) = 36 bonds
    assert.equal(fcc.coordinationBonds.length, 36);
    for (const [u, v] of fcc.coordinationBonds) {
      assertClose(norm3(sub3(u, v)), fcc.nearestNeighborDistance, 1e-12, 'FCC bond length');
    }

    const bcc = buildCrystalLattice('bcc', a);
    assert.equal(bcc.nodes.length, 9);
    assert.equal(bcc.edges.length, 12);
    assert.equal(bcc.atomsPerUnitCell, 2);
    assert.equal(bcc.coordinationNumber, 8);
    assertClose(bcc.nearestNeighborDistance, (Math.sqrt(3) / 2) * a, 1e-12, 'BCC d_min');
    assertClose(bcc.packingEfficiency, (Math.PI * Math.sqrt(3)) / 8, 1e-12, 'BCC packing efficiency');
    assert.equal(bcc.coordinationBonds.length, 8);
    for (const [u, v] of bcc.coordinationBonds) {
      assertClose(norm3(sub3(u, v)), bcc.nearestNeighborDistance, 1e-12, 'BCC bond length');
    }
  }
});

test('3D complex/hyperbolic manifolds match finite-difference partials and exact unit normal orthogonality', () => {
  const rand = deterministicStream(777);
  const h = 1e-6;
  for (const surface of ['wave', 'saddle']) {
    for (let i = 0; i < 40; i++) {
      const x = (rand() - 0.5) * 3.2;
      const y = (rand() - 0.5) * 3.2;
      const evalPt = evaluateManifold(surface, x, y);
      const zxPlus = evaluateManifold(surface, x + h, y).z;
      const zxMinus = evaluateManifold(surface, x - h, y).z;
      const zyPlus = evaluateManifold(surface, x, y + h).z;
      const zyMinus = evaluateManifold(surface, x, y - h).z;

      assertClose(evalPt.dzdx, (zxPlus - zxMinus) / (2 * h), 1e-7, `${surface} dz/dx differential parity`);
      assertClose(evalPt.dzdy, (zyPlus - zyMinus) / (2 * h), 1e-7, `${surface} dz/dy differential parity`);
      assertClose(norm3(evalPt.normal), 1, 1e-12, `${surface} unit normal`);
      assertClose(dot3(evalPt.normal, evalPt.tangentX), 0, 1e-12, `${surface} n·T_x = 0`);
      assertClose(dot3(evalPt.normal, evalPt.tangentY), 0, 1e-12, `${surface} n·T_y = 0`);

      const worldNormal = manifoldToWorld(evalPt.normal);
      const worldTx = manifoldToWorld(evalPt.tangentX);
      assertClose(norm3(worldNormal), 1, 1e-12, `${surface} world normal unit length`);
      assertClose(dot3(worldNormal, worldTx), 0, 1e-12, `${surface} world normal orthogonality`);
    }
  }

  const originWave = evaluateManifold('wave', 0, 0);
  assertClose(originWave.z, 1, 1e-12, 'wave origin value');
  assert.deepEqual(originWave.normal, [0, 0, 1]);

  const mesh = buildManifoldMesh('wave', { gridSize: 12 });
  assert.equal(mesh.vertices.length, 13);
  const probe = manifoldProbeFrame('saddle', 0.4);
  assertClose(norm3(probe.normalWorld), 1, 1e-12, 'probe normal unit length');
  assert.ok(describePCMMode('physics', 0).formula.includes('r(θ)'));
  assert.ok(describePCMMode('chemistry', 0).readout.includes('CN = 12'));
  assert.ok(describePCMMode('mathematics', 1).formula.includes('α(x² − y²)'));
});

test('mountPCM3D respects prefers-reduced-motion static framing, fallback rendering, and keyboard controls', () => {
  const prevWindow = globalThis.window;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;

  const listeners = new Map();
  let rafScheduled = 0;
  let mediaListener = null;
  const mql = {
    matches: true,
    addEventListener(type, fn) { if (type === 'change') mediaListener = fn; },
    removeEventListener(type, fn) { if (type === 'change' && mediaListener === fn) mediaListener = null; },
  };

  function makeElement(tag = 'div') {
    const attrs = new Map();
    const elListeners = new Map();
    return {
      tagName: tag.toUpperCase(),
      dataset: {},
      attributes: attrs,
      textContent: '',
      innerHTML: '',
      disabled: false,
      classList: { add() {}, remove() {} },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      removeAttribute(k) { attrs.delete(k); },
      getBoundingClientRect: () => ({ width: 420, height: 280 }),
      addEventListener(type, fn) {
        if (!elListeners.has(type)) elListeners.set(type, new Set());
        elListeners.get(type).add(fn);
      },
      removeEventListener(type, fn) { elListeners.get(type)?.delete(fn); },
      dispatch(type, event) { for (const fn of elListeners.get(type) ?? []) fn(event); },
    };
  }

  const stage = makeElement('div');
  const canvas = makeElement('canvas');
  canvas.getContext = () => null; // Force SVG fallback path
  const svgFallback = makeElement('svg');
  const rendererBadge = makeElement('span');
  const motionBadge = makeElement('span');
  const motionBtn = makeElement('button');
  const titleEl = makeElement('h2');
  const descEl = makeElement('p');
  const formulaEl = makeElement('code');
  const readoutEl = makeElement('div');
  const modeBtns = ['physics', 'chemistry', 'mathematics'].map(m => {
    const b = makeElement('button');
    b.dataset.pcmMode = m;
    return b;
  });
  const varBtns = [0, 1].map(v => {
    const b = makeElement('button');
    b.dataset.pcmVariant = String(v);
    return b;
  });

  const root = {
    dataset: {},
    getBoundingClientRect: () => ({ width: 420, height: 280 }),
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    querySelector(sel) {
      return {
        '.pcm-stage-frame': stage,
        '.pcm-canvas': canvas,
        '.pcm-fallback-svg': svgFallback,
        '[data-pcm-renderer-badge]': rendererBadge,
        '[data-pcm-motion-badge]': motionBadge,
        '[data-pcm-action="toggle-motion"]': motionBtn,
        '#pcm-lab-title': titleEl,
        '#pcm-lab-desc': descEl,
        '#pcm-lab-formula': formulaEl,
        '#pcm-lab-readout': readoutEl,
      }[sel] ?? null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-pcm-mode]') return modeBtns;
      if (sel === '[data-pcm-variant]') return varBtns;
      return [];
    },
  };

  globalThis.window = { matchMedia: () => mql, devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = () => { rafScheduled++; return rafScheduled; };
  globalThis.cancelAnimationFrame = () => {};

  try {
    const dispose = mountPCM3D(root, { initialMode: 'physics' });
    assert.equal(rafScheduled, 0, 'continuous rAF must not start under prefers-reduced-motion: reduce');
    assert.equal(root.dataset.renderer, 'svg');
    assert.equal(root.dataset.motion, 'paused');
    assert.equal(root.dataset.reducedMotion, 'true');
    assert.equal(motionBtn.disabled, true);
    assert.equal(motionBtn.getAttribute('aria-pressed'), 'true');
    assert.match(svgFallback.innerHTML, /<line /);

    // Discrete keyboard orbit still renders updated static SVG frame on demand without rAF
    const beforeSvg = svgFallback.innerHTML;
    let prevented = false;
    stage.dispatch('keydown', { key: 'ArrowRight', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(rafScheduled, 0);
    assert.notEqual(svgFallback.innerHTML, beforeSvg);

    // Switching mode updates geometry & metadata cleanly
    listeners.get('click')({ target: { closest: sel => sel === '[data-pcm-mode]' ? modeBtns[1] : null } });
    assert.equal(root.dataset.mode, 'chemistry');
    assert.match(titleEl.textContent, /Crystal Lattice/);
    assert.equal(rafScheduled, 0);

    // Live reduced-motion preference turning off resumes continuous motion
    mql.matches = false;
    mediaListener({ matches: false });
    assert.equal(root.dataset.reducedMotion, 'false');
    assert.equal(root.dataset.motion, 'running');
    assert.equal(motionBtn.disabled, false);
    assert.equal(rafScheduled, 1);

    // Turning reduced-motion back on pauses instantaneously
    mql.matches = true;
    mediaListener({ matches: true });
    assert.equal(root.dataset.motion, 'paused');
    assert.equal(motionBtn.disabled, true);

    dispose();
  } finally {
    globalThis.window = prevWindow;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancel;
  }
});
