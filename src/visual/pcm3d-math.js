/**
 * Pure mathematical core for the Vedaris 3D JEE PCM Field Lab.
 * Zero DOM dependencies: shared by WebGL2 shaders/meshes, 2D projection fallback,
 * and property-based differential verification tests.
 */

const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);

export function vec3(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function norm3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize3(v) {
  const len = norm3(v);
  if (len <= 1e-15) return [0, 0, 0];
  return [v[0] / len || 0, v[1] / len || 0, v[2] / len || 0];
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Column-major 3x3 matrices: [c0r0, c0r1, c0r2, c1r0, c1r1, c1r2, c2r0, c2r1, c2r2]
export function mat3Identity() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function mat3Mul(a, b) {
  const out = new Array(9);
  for (let col = 0; col < 3; col++) {
    const b0 = b[col * 3], b1 = b[col * 3 + 1], b2 = b[col * 3 + 2];
    out[col * 3] = a[0] * b0 + a[3] * b1 + a[6] * b2;
    out[col * 3 + 1] = a[1] * b0 + a[4] * b1 + a[7] * b2;
    out[col * 3 + 2] = a[2] * b0 + a[5] * b1 + a[8] * b2;
  }
  return out;
}

export function mat3Transpose(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3Det(m) {
  return (
    m[0] * (m[4] * m[8] - m[7] * m[5]) -
    m[3] * (m[1] * m[8] - m[7] * m[2]) +
    m[6] * (m[1] * m[5] - m[4] * m[2])
  );
}

export function mat3Apply(m, v) {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

/** Construct orthonormal SO(3) rotation R = Rz(roll) * Rx(pitch) * Ry(yaw). */
export function rotationMatrix3(yaw = 0, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
  const rz = [cr, sr, 0, -sr, cr, 0, 0, 0, 1];
  return mat3Mul(rz, mat3Mul(rx, ry));
}

/** Rodrigues' rotation matrix in SO(3) around an axis vector by angle (radians). */
export function axisAngleMatrix3(axis, angle) {
  const [ux, uy, uz] = normalize3(axis);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * ux * ux + c, t * ux * uy + s * uz, t * ux * uz - s * uy,
    t * ux * uy - s * uz, t * uy * uy + c, t * uy * uz + s * ux,
    t * ux * uz + s * uy, t * uy * uz - s * ux, t * uz * uz + c,
  ];
}

// Column-major 4x4 WebGL matrices
export function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4FromMat3(m3) {
  return new Float32Array([
    m3[0], m3[1], m3[2], 0,
    m3[3], m3[4], m3[5], 0,
    m3[6], m3[7], m3[8], 0,
    0, 0, 0, 1,
  ]);
}

export function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function mat4TransformVec4(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

export function perspectiveMatrix4(fovYRad, aspect, near, far) {
  const safeAspect = aspect > 0 ? aspect : 1;
  const f = 1 / Math.tan(fovYRad * 0.5);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / safeAspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function lookAtMatrix4(eye, target = [0, 0, 0], up = [0, 1, 0]) {
  const z = normalize3(sub3(eye, target));
  let x = cross3(up, z);
  if (norm3(x) < 1e-8) x = cross3([0, 0, 1], z);
  x = normalize3(x);
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

export function orbitCameraEye(yaw, pitch, distance, target = [0, 0, 0]) {
  const phi = clamp(pitch, -1.42, 1.42);
  const r = clamp(distance, 1.8, 12.0);
  const cp = Math.cos(phi);
  return [
    target[0] + r * cp * Math.sin(yaw),
    target[1] + r * Math.sin(phi),
    target[2] + r * cp * Math.cos(yaw),
  ];
}

export function projectPoint3D(point, viewProj, width, height) {
  const clip = mat4TransformVec4(viewProj, [point[0], point[1], point[2], 1]);
  const w = clip[3];
  if (Math.abs(w) <= 1e-9) {
    return { x: width * 0.5, y: height * 0.5, depth: 1, ndcX: 0, ndcY: 0, ndcZ: 1, visible: false };
  }
  const ndcX = clip[0] / w;
  const ndcY = clip[1] / w;
  const ndcZ = clip[2] / w;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (0.5 - ndcY * 0.5) * height,
    depth: ndcZ,
    ndcX,
    ndcY,
    ndcZ,
    visible: w > 0 && ndcZ >= -1 && ndcZ <= 1,
  };
}

// ---------------------------------------------------------------------------
// 1. Physics · Kepler & Larmor Field
// ---------------------------------------------------------------------------

export function keplerSemiLatusRectum(a, e) {
  if (!(a > 0)) throw new Error('Semi-major axis must be positive');
  if (!(e >= 0 && e < 1)) throw new Error('Orbital eccentricity must satisfy 0 <= e < 1');
  return a * (1 - e * e);
}

export function keplerRadius(a, e, theta) {
  const p = keplerSemiLatusRectum(a, e);
  return p / (1 + e * Math.cos(theta));
}

/** Solve Kepler's equation M = E - e sin(E) via Newton-Raphson iteration. */
export function solveKeplerEquation(meanAnomaly, e, tolerance = 1e-13) {
  if (!(e >= 0 && e < 1)) throw new Error('Orbital eccentricity must satisfy 0 <= e < 1');
  let M = meanAnomaly % TAU;
  if (M < 0) M += TAU;
  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI;
  for (let i = 0; i < 32; i++) {
    const f = E - e * Math.sin(E) - M;
    if (Math.abs(f) <= tolerance) break;
    const fp = 1 - e * Math.cos(E);
    E -= f / fp;
  }
  return E;
}

export function trueAnomalyFromMean(meanAnomaly, e) {
  const E = solveKeplerEquation(meanAnomaly, e);
  const halfE = E * 0.5;
  const factor = Math.sqrt((1 + e) / (1 - e));
  return 2 * Math.atan2(factor * Math.sin(halfE), Math.cos(halfE));
}

/**
 * Compute instantaneous 3D Keplerian orbital state with Larmor nodal precession.
 * Returns exact focal radius, vis-viva velocity, areal velocity dA/dt, and Lenz vector.
 */
export function keplerState(meanAnomaly, {
  a = 1.65,
  e = 0.56,
  mu = 1.0,
  inclination = 0.48,
  precession = 0,
} = {}) {
  const p = keplerSemiLatusRectum(a, e);
  const E = solveKeplerEquation(meanAnomaly, e);
  const theta = trueAnomalyFromMean(meanAnomaly, e);
  const r = p / (1 + e * Math.cos(theta));
  const h = Math.sqrt(mu * p);

  // Orbital plane coordinates (focus at origin, periapsis on +x)
  const rOrb = [r * Math.cos(theta), r * Math.sin(theta), 0];
  const vScale = h / p;
  const vOrb = [-vScale * Math.sin(theta), vScale * (e + Math.cos(theta)), 0];
  const lOrb = cross3(rOrb, vOrb); // [0, 0, h]
  const lenzOrb = sub3(cross3(vOrb, lOrb), scale3(rOrb, mu / r)); // [mu*e, 0, 0]

  // Orient orbital plane into 3D scene space (X-tilt + Y nodal Larmor precession)
  const tiltMat = rotationMatrix3(precession, inclination - Math.PI * 0.5, 0);
  const position = mat3Apply(tiltMat, rOrb);
  const velocity = mat3Apply(tiltMat, vOrb);
  const lenzVector = mat3Apply(tiltMat, lenzOrb);
  const normalAxis = normalize3(mat3Apply(tiltMat, [0, 0, 1]));
  const secondFocus = mat3Apply(tiltMat, [-2 * a * e, 0, 0]);

  return {
    a,
    e,
    p,
    mu,
    theta,
    eccentricAnomaly: E,
    r,
    speed: norm3(velocity),
    visVivaSpeed: Math.sqrt(mu * (2 / r - 1 / a)),
    arealVelocity: 0.5 * norm3(lOrb),
    angularMomentum: h,
    position,
    velocity,
    focalVector: position,
    lenzVector,
    normalAxis,
    secondFocus,
    tiltMatrix: tiltMat,
  };
}

export function sampleKeplerOrbit(segments = 128, {
  a = 1.65,
  e = 0.56,
  inclination = 0.48,
  precession = 0,
} = {}) {
  const p = keplerSemiLatusRectum(a, e);
  const tiltMat = rotationMatrix3(precession, inclination - Math.PI * 0.5, 0);
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * TAU;
    const r = p / (1 + e * Math.cos(theta));
    points.push(mat3Apply(tiltMat, [r * Math.cos(theta), r * Math.sin(theta), 0]));
  }
  return points;
}

export function samplePrecessionRings(ringCount = 3, segments = 64, baseRadius = 1.95) {
  const rings = [];
  for (let idx = 0; idx < ringCount; idx++) {
    const yOffset = (idx - (ringCount - 1) * 0.5) * 0.55;
    const r = baseRadius * (1 - Math.abs(yOffset) * 0.24);
    const tilt = 0.14 * (idx - 1);
    const mat = rotationMatrix3(0, tilt, 0);
    const points = [];
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * TAU;
      points.push(mat3Apply(mat, [r * Math.cos(phi), yOffset, r * Math.sin(phi)]));
    }
    rings.push(points);
  }
  return rings;
}

// ---------------------------------------------------------------------------
// 2. Chemistry · Quantum Orbital & Crystal Lattice
// ---------------------------------------------------------------------------

/**
 * Evaluate normalized real spherical harmonics Y_l^m(theta, phi) with m = 0
 * (s, p_z, d_z2) and probability density |Y_l^m|^2.
 * Theta is polar angle from +z (mapped to vertical +Y in 3D view).
 */
export function realSphericalHarmonic(l, m, theta, phi = 0) {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  let value = 0;
  if (l === 0 && m === 0) {
    value = 1 / Math.sqrt(4 * Math.PI);
  } else if (l === 1 && m === 0) {
    value = Math.sqrt(3 / (4 * Math.PI)) * cosT;
  } else if (l === 1 && m === 1) {
    value = Math.sqrt(3 / (4 * Math.PI)) * sinT * Math.cos(phi);
  } else if (l === 2 && m === 0) {
    value = Math.sqrt(5 / (16 * Math.PI)) * (3 * cosT * cosT - 1);
  } else if (l === 2 && m === 1) {
    value = Math.sqrt(15 / (4 * Math.PI)) * sinT * cosT * Math.cos(phi);
  } else {
    throw new Error(`Unsupported spherical harmonic (l=${l}, m=${m})`);
  }
  return { value, density: value * value };
}

/** Deterministic midpoint integral of |Y_l^m|^2 over the unit sphere S^2. */
export function integrateSphericalHarmonicNorm(l, m, nTheta = 180, nPhi = 90) {
  const dTheta = Math.PI / nTheta;
  const dPhi = TAU / nPhi;
  let sum = 0;
  for (let i = 0; i < nTheta; i++) {
    const theta = (i + 0.5) * dTheta;
    const sinTheta = Math.sin(theta);
    for (let j = 0; j < nPhi; j++) {
      const phi = (j + 0.5) * dPhi;
      const { density } = realSphericalHarmonic(l, m, theta, phi);
      sum += density * sinTheta;
    }
  }
  return sum * dTheta * dPhi;
}

/**
 * Sample deterministic 3D angular probability cloud for d_z2 or p_z orbital
 * using golden-angle Fibonacci distribution weighted by |Y_l^m|^2.
 * Note: polar z maps to vertical Y axis in 3D scene coordinates [x, z, y].
 */
export function sampleOrbitalProbabilityCloud(orbital = 'dz2', count = 1000) {
  const isPz = orbital === 'pz';
  const l = isPz ? 1 : 2;
  const maxAmplitude = isPz ? Math.sqrt(3 / (4 * Math.PI)) : Math.sqrt(5 / (4 * Math.PI));
  const maxDensity = maxAmplitude * maxAmplitude;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const points = [];
  let candidate = 0;

  while (points.length < count && candidate < count * 14) {
    candidate++;
    // Stratified cosine polar coordinate for uniform sphere coverage
    const u = ((candidate * 0.6180339887498949) % 1);
    const cosTheta = 1 - 2 * u;
    const theta = Math.acos(clamp(cosTheta, -1, 1));
    const phi = (candidate * goldenAngle) % TAU;
    const { value, density } = realSphericalHarmonic(l, 0, theta, phi);

    // Deterministic rejection threshold via Van der Corput / fractional sequence
    const gate = ((candidate * 0.7548776662466927) % 1);
    if (gate > density / maxDensity) continue;

    // Radial probability shell distribution around Bohr-scaled lobe envelope
    const radialShell = 0.25 + 0.92 * Math.sqrt(density / maxDensity) * (0.72 + 0.36 * ((candidate * 0.5698402909980532) % 1));
    const sinT = Math.sin(theta);
    const x = radialShell * sinT * Math.cos(phi);
    const y = radialShell * cosTheta; // polar axis vertically upward
    const z = radialShell * sinT * Math.sin(phi);
    points.push({
      position: [x, y, z],
      density,
      phase: value >= 0 ? 1 : -1,
      theta,
      phi,
    });
  }
  return points;
}

/**
 * Sample parametric 3D nodal lobe grid for d_z2 or p_z orbitals.
 */
export function sampleQuantumOrbitalLobes(orbital = 'dz2', thetaSteps = 40, phiSteps = 48, scale = 1.18) {
  const isPz = orbital === 'pz';
  const l = isPz ? 1 : 2;
  const maxAmp = isPz ? Math.sqrt(3 / (4 * Math.PI)) : Math.sqrt(5 / (4 * Math.PI));
  const grid = [];

  for (let i = 0; i <= thetaSteps; i++) {
    const theta = (i / thetaSteps) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const ring = [];
    for (let j = 0; j <= phiSteps; j++) {
      const phi = (j / phiSteps) * TAU;
      const { value } = realSphericalHarmonic(l, 0, theta, phi);
      const r = scale * (Math.abs(value) / maxAmp);
      ring.push({
        position: [r * sinT * Math.cos(phi), r * cosT, r * sinT * Math.sin(phi)],
        phase: value >= 0 ? 1 : -1,
        amplitude: value,
      });
    }
    grid.push(ring);
  }
  return grid;
}

/**
 * Build cubic crystal lattice unit cell (FCC or BCC) centered at origin.
 * Provides exact nodes, unit-cell wireframe edges, nearest-neighbor coordination bonds,
 * atoms per unit cell (Z), coordination number, and packing efficiency.
 */
export function buildCrystalLattice(type = 'fcc', cellSize = 2.45) {
  const mode = type === 'bcc' ? 'bcc' : 'fcc';
  const h = cellSize * 0.5;
  const nodes = [];

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        nodes.push({ position: [sx * h, sy * h, sz * h], role: 'corner', weight: 1 / 8 });
      }
    }
  }

  if (mode === 'bcc') {
    nodes.push({ position: [0, 0, 0], role: 'body-center', weight: 1 });
  } else {
    const faces = [
      [h, 0, 0], [-h, 0, 0],
      [0, h, 0], [0, -h, 0],
      [0, 0, h], [0, 0, -h],
    ];
    for (const pos of faces) {
      nodes.push({ position: pos, role: 'face-center', weight: 0.5 });
    }
  }

  // 12 edges of the cubic unit cell (corner index bitmask: x=4, y=2, z=1)
  const edges = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      const j = i ^ bit;
      if (i < j) edges.push([nodes[i].position, nodes[j].position]);
    }
  }

  const nearestDist = mode === 'bcc' ? (SQRT3 * 0.5) * cellSize : cellSize / Math.SQRT2;
  const tol = cellSize * 1e-5;
  const coordinationBonds = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = norm3(sub3(nodes[i].position, nodes[j].position));
      if (Math.abs(d - nearestDist) <= tol) {
        coordinationBonds.push([nodes[i].position, nodes[j].position]);
      }
    }
  }

  const atomsPerUnitCell = nodes.reduce((sum, node) => sum + node.weight, 0);
  const coordinationNumber = mode === 'bcc' ? 8 : 12;
  const packingEfficiency = mode === 'bcc'
    ? (Math.PI * SQRT3) / 8
    : (Math.PI * Math.SQRT2) / 6;

  return {
    type: mode,
    cellSize,
    nodes,
    edges,
    coordinationBonds,
    atomsPerUnitCell,
    coordinationNumber,
    nearestNeighborDistance: nearestDist,
    packingEfficiency,
  };
}

// ---------------------------------------------------------------------------
// 3. Mathematics · 3D Complex & Hyperbolic Manifold
// ---------------------------------------------------------------------------

/**
 * Evaluate analytical surface z(x,y) along with exact gradient (dz/dx, dz/dy),
 * tangent basis vectors T_x, T_y, and unit surface normal n̂.
 */
export function evaluateManifold(surface = 'wave', x = 0, y = 0, {
  amplitude = 1,
  sigma = 1,
  k = 2,
  alpha = 1,
} = {}) {
  let z = 0;
  let dzdx = 0;
  let dzdy = 0;

  if (surface === 'saddle') {
    z = alpha * (x * x - y * y);
    dzdx = 2 * alpha * x;
    dzdy = -2 * alpha * y;
  } else {
    const r2 = x * x + y * y;
    const r = Math.sqrt(r2);
    const invSigma2 = 1 / (sigma * sigma);
    const env = amplitude * Math.exp(-0.5 * r2 * invSigma2);
    if (r <= 1e-12) {
      z = amplitude;
      dzdx = 0;
      dzdy = 0;
    } else {
      const cosKR = Math.cos(k * r);
      const sinKR = Math.sin(k * r);
      z = env * cosKR;
      const radialFactor = -env * (invSigma2 * cosKR + (k / r) * sinKR);
      dzdx = radialFactor * x;
      dzdy = radialFactor * y;
    }
  }

  const tangentX = normalize3([1, 0, dzdx]);
  const tangentY = normalize3([0, 1, dzdy]);
  const normal = normalize3([-dzdx, -dzdy, 1]);

  return { x, y, z, dzdx, dzdy, tangentX, tangentY, normal };
}

/** Isometric orientation mapping math (x, y, z_height) -> 3D view (x, z_height, -y) with det=+1. */
export function manifoldToWorld([x, y, z]) {
  return [x, z, -y];
}

export function buildManifoldMesh(surface = 'wave', {
  gridSize = 36,
  extent = 1.9,
  amplitude = 0.92,
  alpha = 0.34,
  baseY = -1.15,
} = {}) {
  const opts = { amplitude, alpha };
  const vertices = [];
  for (let iy = 0; iy <= gridSize; iy++) {
    const y = -extent + (2 * extent * iy) / gridSize;
    const row = [];
    for (let ix = 0; ix <= gridSize; ix++) {
      const x = -extent + (2 * extent * ix) / gridSize;
      const sample = evaluateManifold(surface, x, y, opts);
      row.push({
        math: [x, y, sample.z],
        world: manifoldToWorld([x, y, sample.z]),
        normalWorld: manifoldToWorld(sample.normal),
        z: sample.z,
      });
    }
    vertices.push(row);
  }

  const contourRibs = [];
  const ribStride = Math.max(2, Math.floor(gridSize / 9));
  for (let iy = 0; iy <= gridSize; iy += ribStride) {
    contourRibs.push(vertices[iy].map(v => v.world));
  }
  for (let ix = 0; ix <= gridSize; ix += ribStride) {
    const col = [];
    for (let iy = 0; iy <= gridSize; iy++) col.push(vertices[iy][ix].world);
    contourRibs.push(col);
  }

  const baseRings = [];
  for (const radius of [0.55, 1.1, 1.65]) {
    const ring = [];
    for (let s = 0; s <= 48; s++) {
      const a = (s / 48) * TAU;
      ring.push([radius * Math.cos(a), baseY, radius * Math.sin(a)]);
    }
    baseRings.push(ring);
  }

  return { surface, gridSize, extent, vertices, contourRibs, baseRings, options: opts };
}

export function manifoldProbeFrame(surface = 'wave', phase = 0, {
  amplitude = 0.92,
  alpha = 0.34,
  patchRadius = 0.34,
} = {}) {
  const x = 0.85 * Math.cos(phase);
  const y = 0.85 * Math.sin(phase * 0.7 + 0.45);
  const sample = evaluateManifold(surface, x, y, { amplitude, alpha });
  const originWorld = manifoldToWorld([sample.x, sample.y, sample.z]);
  const normalWorld = manifoldToWorld(sample.normal);
  const txWorld = manifoldToWorld(sample.tangentX);
  const tyWorld = manifoldToWorld(sample.tangentY);

  const patch = [
    add3(originWorld, add3(scale3(txWorld, -patchRadius), scale3(tyWorld, -patchRadius))),
    add3(originWorld, add3(scale3(txWorld, patchRadius), scale3(tyWorld, -patchRadius))),
    add3(originWorld, add3(scale3(txWorld, patchRadius), scale3(tyWorld, patchRadius))),
    add3(originWorld, add3(scale3(txWorld, -patchRadius), scale3(tyWorld, patchRadius))),
  ];

  return {
    sample,
    originWorld,
    normalWorld,
    tangentXWorld: txWorld,
    tangentYWorld: tyWorld,
    tangentPatch: patch,
  };
}

/**
 * Pure domain metadata and exact numeric telemetry summary for the dashboard UI.
 */
export function describePCMMode(mode, variant = 0) {
  if (mode === 'chemistry') {
    const isBcc = variant === 1;
    const lattice = buildCrystalLattice(isBcc ? 'bcc' : 'fcc', 1);
    const norm = integrateSphericalHarmonicNorm(isBcc ? 1 : 2, 0, 90, 45);
    return isBcc
      ? {
          mode: 'chemistry',
          variant: 1,
          title: 'p_z Orbital & BCC Crystal Lattice',
          subtitle: 'Antisymmetric dipolar p_z probability lobes inside a Body-Centered Cubic (Z = 2) unit cell.',
          formula: 'Y₁⁰ = √(3/4π) cosθ · d_min = (√3/2)a',
          readout: `Z = ${lattice.atomsPerUnitCell} · CN = ${lattice.coordinationNumber} · Packing ${(lattice.packingEfficiency * 100).toFixed(1)}% · ∫|Y₁⁰|²dΩ = ${norm.toFixed(3)}`,
          variants: ['d_z² + FCC', 'p_z + BCC'],
        }
      : {
          mode: 'chemistry',
          variant: 0,
          title: 'd_z² Orbital & FCC Crystal Lattice',
          subtitle: 'Quadrupolar |Y₂⁰(θ,φ)|² probability cloud with nodal cones inside a Face-Centered Cubic (Z = 4) cell.',
          formula: '|Y₂⁰|² = (5/16π)(3cos²θ − 1)² · d_min = a/√2',
          readout: `Z = ${lattice.atomsPerUnitCell} · CN = ${lattice.coordinationNumber} · Packing ${(lattice.packingEfficiency * 100).toFixed(1)}% · ∫|Y₂⁰|²dΩ = ${norm.toFixed(3)}`,
          variants: ['d_z² + FCC', 'p_z + BCC'],
        };
  }

  if (mode === 'mathematics') {
    const isSaddle = variant === 1;
    const probe = manifoldProbeFrame(isSaddle ? 'saddle' : 'wave', 0.65);
    const orthoErr = Math.max(
      Math.abs(dot3(probe.normalWorld, probe.tangentXWorld)),
      Math.abs(dot3(probe.normalWorld, probe.tangentYWorld)),
    );
    return isSaddle
      ? {
          mode: 'mathematics',
          variant: 1,
          title: 'Hyperbolic Saddle Manifold',
          subtitle: 'Saddle surface with opposing principal curvatures, orthogonal contour ribs, and unit normal n̂.',
          formula: 'z = α(x² − y²) · n̂ = (−∂ₓz, −∂ᵧz, 1) / ‖N‖',
          readout: `‖n̂‖ = ${norm3(probe.normalWorld).toFixed(3)} · |n̂·T| = ${orthoErr.toExponential(0)} · z = ${probe.sample.z.toFixed(2)}`,
          variants: ['Damped Wave', 'Hyperbolic Saddle'],
        }
      : {
          mode: 'mathematics',
          variant: 0,
          title: 'Damped Radial Wave Manifold',
          subtitle: 'Gaussian-modulated oscillatory manifold with live tangent plane and perpendicular surface normal n̂.',
          formula: 'z = e^(−r²/2) cos(2r) · n̂ ⊥ (Tₓ, Tᵧ)',
          readout: `‖n̂‖ = ${norm3(probe.normalWorld).toFixed(3)} · |n̂·T| = ${orthoErr.toExponential(0)} · z = ${probe.sample.z.toFixed(2)}`,
          variants: ['Damped Wave', 'Hyperbolic Saddle'],
        };
  }

  const e = variant === 1 ? 0.72 : 0.56;
  const state = keplerState(0.85, { a: 1.65, e, mu: 1.0 });
  return {
    mode: 'physics',
    variant: variant === 1 ? 1 : 0,
    title: 'Kepler Orbit & Larmor Precession',
    subtitle: 'Conic trajectory around a primary focus with swept areal velocity, tangential v⃗, and Lenz vector A⃗.',
    formula: 'r(θ) = a(1 − e²) / (1 + e cosθ) · dA/dt = h/2',
    readout: `e = ${e.toFixed(2)} · p = ${state.p.toFixed(2)} · dA/dt = ${state.arealVelocity.toFixed(3)} · v = ${state.speed.toFixed(2)}`,
    variants: ['Kepler e=0.56', 'Comet e=0.72'],
  };
}
