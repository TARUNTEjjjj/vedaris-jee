import {
  add3,
  buildCrystalLattice,
  buildManifoldMesh,
  clamp,
  cross3,
  describePCMMode,
  keplerState,
  lookAtMatrix4,
  manifoldProbeFrame,
  mat4FromMat3,
  mat4Identity,
  mat4Mul,
  norm3,
  normalize3,
  orbitCameraEye,
  perspectiveMatrix4,
  projectPoint3D,
  rotationMatrix3,
  sampleKeplerOrbit,
  sampleOrbitalProbabilityCloud,
  samplePrecessionRings,
  sampleQuantumOrbitalLobes,
  scale3,
  sub3,
} from './pcm3d-math.js';

const TAU = Math.PI * 2;
const DEFAULT_CAMERA = {
  physics: { yaw: 0.58, pitch: 0.42, distance: 4.9 },
  chemistry: { yaw: 0.68, pitch: 0.34, distance: 4.8 },
  mathematics: { yaw: 0.72, pitch: 0.52, distance: 5.0 },
};

const MESH_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vColor;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  vColor = aColor;
  gl_Position = uViewProj * world;
}
`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vColor;
uniform vec3 uEyePos;
out vec4 outColor;
void main() {
  vec3 V = normalize(uEyePos - vWorldPos);
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 keyDir = normalize(vec3(0.65, 0.85, 0.55));
  vec3 rimDir = normalize(vec3(-0.75, 0.35, -0.65));
  float diffKey = max(dot(N, keyDir), 0.0);
  float diffRim = max(dot(N, rimDir), 0.0);
  vec3 H = normalize(keyDir + V);
  float spec = pow(max(dot(N, H), 0.0), 34.0);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.8);
  vec3 lit = vColor.rgb * (0.34 + 0.66 * diffKey)
           + vec3(0.32, 0.72, 0.68) * diffRim * 0.22
           + vec3(1.0, 0.94, 0.82) * spec * 0.42
           + vec3(0.55, 0.86, 0.78) * fresnel * 0.22;
  outColor = vec4(clamp(lit, 0.0, 1.0), vColor.a);
}
`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * (uModel * vec4(aPosition, 1.0));
}
`;

const LINE_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = vColor;
}
`;

const POINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aSize;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uDpr;
out vec4 vColor;
void main() {
  vec4 clip = uViewProj * (uModel * vec4(aPosition, 1.0));
  gl_Position = clip;
  float w = max(clip.w, 0.4);
  gl_PointSize = clamp((aSize * uDpr * 4.2) / w, 1.5, 22.0);
  vColor = aColor;
}
`;

const POINT_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float glow = exp(-3.4 * r2);
  outColor = vec4(vColor.rgb, vColor.a * glow);
}
`;

// ---------------------------------------------------------------------------
// Geometry Accumulation Buffers
// ---------------------------------------------------------------------------

function createSceneBuffers() {
  return {
    triPos: [],
    triNorm: [],
    triCol: [],
    triIdx: [],
    linePos: [],
    lineCol: [],
    ptPos: [],
    ptCol: [],
    ptSize: [],
    // Lightweight fallback primitives sorted by depth for 2D / SVG projection
    fallbackTris: [],
    fallbackLines: [],
    fallbackPoints: [],
  };
}

function addVertex(buf, pos, norm, col) {
  const idx = buf.triPos.length / 3;
  buf.triPos.push(pos[0], pos[1], pos[2]);
  buf.triNorm.push(norm[0], norm[1], norm[2]);
  buf.triCol.push(col[0], col[1], col[2], col[3] ?? 1);
  return idx;
}

function pushTriangle(buf, p0, p1, p2, n0, n1, n2, c0, c1 = c0, c2 = c0) {
  const i0 = addVertex(buf, p0, n0, c0);
  const i1 = addVertex(buf, p1, n1, c1);
  const i2 = addVertex(buf, p2, n2, c2);
  buf.triIdx.push(i0, i1, i2);
  buf.fallbackTris.push({ p0, p1, p2, c0 });
}

function pushLine(buf, a, b, colA, colB = colA) {
  buf.linePos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  buf.lineCol.push(colA[0], colA[1], colA[2], colA[3] ?? 1, colB[0], colB[1], colB[2], colB[3] ?? 1);
  buf.fallbackLines.push({ a, b, col: colA });
}

function pushPolyline(buf, points, colorFn, closed = false) {
  const count = points.length;
  if (count < 2) return;
  for (let i = 0; i < count - 1; i++) {
    const t0 = i / (count - 1);
    const t1 = (i + 1) / (count - 1);
    pushLine(buf, points[i], points[i + 1], colorFn(t0), colorFn(t1));
  }
  if (closed) pushLine(buf, points[count - 1], points[0], colorFn(1), colorFn(0));
}

function pushPoint(buf, pos, col, size = 4.0) {
  buf.ptPos.push(pos[0], pos[1], pos[2]);
  buf.ptCol.push(col[0], col[1], col[2], col[3] ?? 1);
  buf.ptSize.push(size);
  buf.fallbackPoints.push({ pos, col, size });
}

function pushSphere(buf, center, radius, color, lat = 10, lon = 14) {
  const rings = [];
  for (let i = 0; i <= lat; i++) {
    const v = i / lat;
    const phi = v * Math.PI;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    const ring = [];
    for (let j = 0; j <= lon; j++) {
      const theta = (j / lon) * TAU;
      const nx = sinP * Math.cos(theta);
      const ny = cosP;
      const nz = sinP * Math.sin(theta);
      const pos = [center[0] + radius * nx, center[1] + radius * ny, center[2] + radius * nz];
      ring.push(addVertex(buf, pos, [nx, ny, nz], color));
    }
    rings.push(ring);
  }
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = rings[i][j];
      const b = rings[i + 1][j];
      const c = rings[i + 1][j + 1];
      const d = rings[i][j + 1];
      buf.triIdx.push(a, b, d, b, c, d);
    }
  }
  buf.fallbackPoints.push({ pos: center, col: color, size: Math.max(4, radius * 42) });
}

function pushTube(buf, points, radius, colorFn, radialSegs = 6, closed = false) {
  if (points.length < 2) return;
  const frames = [];
  let prevNormal = null;
  for (let i = 0; i < points.length; i++) {
    const pPrev = points[Math.max(0, i - 1)];
    const pNext = points[Math.min(points.length - 1, i + 1)];
    const tangent = normalize3(sub3(pNext, pPrev));
    let normal;
    if (!prevNormal) {
      const up = Math.abs(tangent[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
      normal = normalize3(cross3(up, tangent));
    } else {
      const proj = sub3(prevNormal, scale3(tangent, norm3(prevNormal) ? (prevNormal[0] * tangent[0] + prevNormal[1] * tangent[1] + prevNormal[2] * tangent[2]) : 0));
      normal = norm3(proj) > 1e-6 ? normalize3(proj) : normalize3(cross3([0, 1, 0], tangent));
    }
    prevNormal = normal;
    const binormal = normalize3(cross3(tangent, normal));
    frames.push({ pos: points[i], normal, binormal, t: i / (points.length - 1) });
  }

  const rings = [];
  for (const frame of frames) {
    const col = colorFn(frame.t);
    const ring = [];
    for (let j = 0; j <= radialSegs; j++) {
      const a = (j / radialSegs) * TAU;
      const dir = add3(scale3(frame.normal, Math.cos(a)), scale3(frame.binormal, Math.sin(a)));
      const p = add3(frame.pos, scale3(dir, radius));
      ring.push(addVertex(buf, p, dir, col));
    }
    rings.push(ring);
  }

  const limit = closed ? rings.length - 1 : rings.length - 1;
  for (let i = 0; i < limit; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = rings[i][j];
      const b = rings[i + 1][j];
      const c = rings[i + 1][j + 1];
      const d = rings[i][j + 1];
      buf.triIdx.push(a, b, d, b, c, d);
    }
  }
  pushPolyline(buf, points, colorFn, closed);
}

function pushArrow(buf, origin, vector, radius, color) {
  const len = norm3(vector);
  if (len <= 1e-4) return;
  const dir = scale3(vector, 1 / len);
  const headLen = Math.min(len * 0.32, 0.24);
  const shaftEnd = add3(origin, scale3(dir, Math.max(0.02, len - headLen)));
  const tip = add3(origin, vector);

  pushTube(buf, [origin, shaftEnd], radius, () => color, 6);

  const up = Math.abs(dir[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize3(cross3(up, dir));
  const v = normalize3(cross3(dir, u));
  const headRadius = radius * 2.55;
  const baseIdx = [];
  const segs = 10;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU;
    const radial = add3(scale3(u, Math.cos(a)), scale3(v, Math.sin(a)));
    const p = add3(shaftEnd, scale3(radial, headRadius));
    const n = normalize3(add3(radial, scale3(dir, 0.45)));
    baseIdx.push(addVertex(buf, p, n, color));
  }
  const tipIdx = addVertex(buf, tip, dir, color);
  for (let i = 0; i < segs; i++) {
    buf.triIdx.push(baseIdx[i], baseIdx[i + 1], tipIdx);
  }
  pushLine(buf, origin, tip, color);
}

// ---------------------------------------------------------------------------
// Scene Builders for JEE Physics, Chemistry & Mathematics
// ---------------------------------------------------------------------------

function buildPhysicsScene(variant, phase) {
  const buf = createSceneBuffers();
  const e = variant === 1 ? 0.72 : 0.56;
  const a = 1.62;
  const precession = phase * 0.16;
  const opts = { a, e, mu: 1.0, inclination: 0.48, precession };

  // Larmor / nodal precession rings around central dipole axis
  const rings = samplePrecessionRings(3, 64, 1.95);
  rings.forEach((ring, idx) => {
    const alpha = idx === 1 ? 0.34 : 0.2;
    pushPolyline(buf, ring, () => [0.46, 0.82, 0.72, alpha]);
  });

  // Dipole B-field axis
  pushLine(buf, [0, -1.55, 0], [0, 1.55, 0], [0.55, 0.85, 0.76, 0.38]);

  // Glowing Keplerian elliptical trajectory
  const orbitPts = sampleKeplerOrbit(96, opts);
  pushTube(buf, orbitPts, 0.022, t => {
    const pulse = 0.5 + 0.5 * Math.cos(t * TAU);
    return [0.35 + 0.58 * pulse, 0.78 - 0.1 * pulse, 0.68 - 0.32 * pulse, 0.96];
  }, 6, true);

  // Swept equal-area sector fan visualizing Kepler's Second Law
  const sweepSpan = 0.34;
  const sweepSteps = 12;
  for (let s = 0; s < sweepSteps; s++) {
    const m0 = phase + (s / sweepSteps) * sweepSpan;
    const m1 = phase + ((s + 1) / sweepSteps) * sweepSpan;
    const p0 = keplerState(m0, opts).position;
    const p1 = keplerState(m1, opts).position;
    pushTriangle(
      buf,
      [0, 0, 0],
      p0,
      p1,
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0.86, 0.58, 0.28, 0.24],
    );
  }

  // Primary focus attractor & empty second focus beacon
  const state = keplerState(phase, opts);
  pushSphere(buf, [0, 0, 0], 0.16, [0.95, 0.72, 0.36, 1], 12, 16);
  pushSphere(buf, state.secondFocus, 0.06, [0.45, 0.78, 0.74, 0.85], 8, 10);

  // Orbiting mass/charge + dynamic vectors: focal r, tangential velocity v, Lenz A
  pushSphere(buf, state.position, 0.095, [0.96, 0.94, 0.86, 1], 10, 14);
  pushLine(buf, [0, 0, 0], state.position, [0.48, 0.88, 0.78, 0.85]);

  const velScaled = scale3(normalize3(state.velocity), clamp(state.speed * 0.52, 0.42, 1.05));
  pushArrow(buf, state.position, velScaled, 0.02, [0.92, 0.66, 0.32, 1]);

  const lenzDir = scale3(normalize3(state.lenzVector), 0.78);
  pushArrow(buf, [0, 0, 0], lenzDir, 0.017, [0.44, 0.86, 0.68, 0.95]);

  // Orbital trail particles behind the particle
  for (let k = 1; k <= 28; k++) {
    const past = keplerState(phase - k * 0.065, opts);
    const fade = 1 - k / 29;
    pushPoint(buf, past.position, [0.92, 0.74, 0.42, fade * 0.85], 2.4 + fade * 3.2);
  }

  return { buffers: buf, modelRotation: [0, 0, 0] };
}

function buildChemistryScene(variant, phase) {
  const buf = createSceneBuffers();
  const isBcc = variant === 1;
  const orbital = isBcc ? 'pz' : 'dz2';
  const lattice = buildCrystalLattice(isBcc ? 'bcc' : 'fcc', 2.45);

  // Unit cell wireframe struts
  for (const [a, b] of lattice.edges) {
    pushTube(buf, [a, b], 0.016, () => [0.54, 0.78, 0.68, 0.78], 5);
  }

  // Nearest-neighbor coordination bonds
  for (const [a, b] of lattice.coordinationBonds) {
    pushLine(buf, a, b, [0.88, 0.66, 0.38, 0.35]);
  }

  // Specular lattice spheres
  for (const node of lattice.nodes) {
    if (node.role === 'corner') {
      pushSphere(buf, node.position, 0.11, [0.85, 0.91, 0.86, 1], 10, 12);
    } else {
      pushSphere(buf, node.position, 0.135, [0.9, 0.62, 0.32, 1], 10, 14);
    }
  }

  // Spherical harmonic orbital surface lobes (d_z2 or p_z)
  const grid = sampleQuantumOrbitalLobes(orbital, 30, 38, 1.05);
  for (let i = 0; i < grid.length - 1; i++) {
    for (let j = 0; j < grid[i].length - 1; j++) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j + 1];
      const d = grid[i][j + 1];
      if (norm3(a.position) < 0.02 && norm3(b.position) < 0.02 && norm3(c.position) < 0.02) continue;
      const phaseSign = (a.phase + b.phase + c.phase + d.phase) >= 0;
      const col = phaseSign ? [0.91, 0.62, 0.3, 0.86] : [0.32, 0.76, 0.72, 0.86];
      const n0 = normalize3(sub3(b.position, a.position).some(Boolean) && sub3(d.position, a.position).some(Boolean)
        ? cross3(sub3(b.position, a.position), sub3(d.position, a.position))
        : a.position);
      const safeN = norm3(n0) > 1e-4 ? n0 : [0, 1, 0];
      pushTriangle(buf, a.position, b.position, d.position, safeN, safeN, safeN, col);
      pushTriangle(buf, b.position, c.position, d.position, safeN, safeN, safeN, col);
    }
  }

  // Volumetric |Y_l^m|^2 probability cloud
  const cloud = sampleOrbitalProbabilityCloud(orbital, 680);
  for (const pt of cloud) {
    const col = pt.phase > 0 ? [0.96, 0.76, 0.44, 0.72] : [0.46, 0.88, 0.84, 0.72];
    pushPoint(buf, pt.position, col, 2.5);
  }

  return { buffers: buf, modelRotation: [0, phase * 0.24, 0] };
}

function buildMathematicsScene(variant, phase) {
  const buf = createSceneBuffers();
  const surface = variant === 1 ? 'saddle' : 'wave';
  const mesh = buildManifoldMesh(surface, { gridSize: 30, extent: 1.75, amplitude: 0.92, alpha: 0.34, baseY: -1.12 });
  const { vertices, contourRibs, baseRings } = mesh;

  // Color-graded analytical surface triangles
  for (let iy = 0; iy < vertices.length - 1; iy++) {
    for (let ix = 0; ix < vertices[iy].length - 1; ix++) {
      const v00 = vertices[iy][ix];
      const v10 = vertices[iy][ix + 1];
      const v11 = vertices[iy + 1][ix + 1];
      const v01 = vertices[iy + 1][ix];
      const colorFor = z => {
        const t = clamp((z + 0.85) / 1.7, 0, 1);
        return [
          0.22 + 0.68 * t,
          0.52 + 0.22 * Math.sin(t * Math.PI),
          0.58 - 0.32 * t,
          0.92,
        ];
      };
      const c00 = colorFor(v00.z);
      const c10 = colorFor(v10.z);
      const c11 = colorFor(v11.z);
      const c01 = colorFor(v01.z);
      pushTriangle(buf, v00.world, v10.world, v01.world, v00.normalWorld, v10.normalWorld, v01.normalWorld, c00, c10, c01);
      pushTriangle(buf, v10.world, v11.world, v01.world, v10.normalWorld, v11.normalWorld, v01.normalWorld, c10, c11, c01);
    }
  }

  // Orthogonal contour ribs slightly offset along surface normal
  for (const rib of contourRibs) {
    const lifted = rib.map(p => [p[0], p[1] + 0.012, p[2]]);
    pushPolyline(buf, lifted, () => [0.94, 0.96, 0.88, 0.45]);
  }

  // Base projection contour rings + axes
  for (const ring of baseRings) {
    pushPolyline(buf, ring, () => [0.46, 0.78, 0.72, 0.32]);
  }
  pushLine(buf, [-1.9, -1.12, 0], [1.9, -1.12, 0], [0.68, 0.82, 0.75, 0.35]);
  pushLine(buf, [0, -1.12, -1.9], [0, -1.12, 1.9], [0.68, 0.82, 0.75, 0.35]);

  // Live probe point, tangent plane patch, tangent basis vectors & unit normal n̂
  const probe = manifoldProbeFrame(surface, phase, { amplitude: 0.92, alpha: 0.34, patchRadius: 0.36 });
  const [p0, p1, p2, p3] = probe.tangentPatch.map(p => add3(p, scale3(probe.normalWorld, 0.018)));
  pushTriangle(buf, p0, p1, p2, probe.normalWorld, probe.normalWorld, probe.normalWorld, [0.96, 0.88, 0.62, 0.34]);
  pushTriangle(buf, p0, p2, p3, probe.normalWorld, probe.normalWorld, probe.normalWorld, [0.96, 0.88, 0.62, 0.34]);
  pushPolyline(buf, [p0, p1, p2, p3], () => [0.98, 0.86, 0.48, 0.9], true);

  pushSphere(buf, probe.originWorld, 0.065, [0.98, 0.96, 0.88, 1], 8, 10);
  pushArrow(buf, probe.originWorld, scale3(probe.normalWorld, 0.82), 0.019, [0.96, 0.64, 0.3, 1]);
  pushArrow(buf, probe.originWorld, scale3(probe.tangentXWorld, 0.56), 0.013, [0.48, 0.9, 0.8, 0.95]);
  pushArrow(buf, probe.originWorld, scale3(probe.tangentYWorld, 0.56), 0.013, [0.76, 0.88, 0.58, 0.95]);

  return { buffers: buf, modelRotation: [0, phase * 0.14, 0] };
}

function buildModeScene(mode, variant, phase) {
  if (mode === 'chemistry') return buildChemistryScene(variant, phase);
  if (mode === 'mathematics') return buildMathematicsScene(variant, phase);
  return buildPhysicsScene(variant, phase);
}

// ---------------------------------------------------------------------------
// WebGL2 Renderer
// ---------------------------------------------------------------------------

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function linkProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${info}`);
  }
  return prog;
}

function createWebGL2Backend(canvas) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }
  if (!gl) return null;

  let meshProg, lineProg, pointProg;
  try {
    meshProg = linkProgram(gl, MESH_VS, MESH_FS);
    lineProg = linkProgram(gl, LINE_VS, LINE_FS);
    pointProg = linkProgram(gl, POINT_VS, POINT_FS);
  } catch {
    return null;
  }

  const buffers = [];
  const makeBuffer = () => { const b = gl.createBuffer(); buffers.push(b); return b; };
  const meshVao = gl.createVertexArray();
  const lineVao = gl.createVertexArray();
  const pointVao = gl.createVertexArray();

  const bTriPos = makeBuffer(), bTriNorm = makeBuffer(), bTriCol = makeBuffer(), bTriIdx = makeBuffer();
  const bLinePos = makeBuffer(), bLineCol = makeBuffer();
  const bPtPos = makeBuffer(), bPtCol = makeBuffer(), bPtSize = makeBuffer();

  gl.bindVertexArray(meshVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, bTriPos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bTriNorm);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bTriCol);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bTriIdx);

  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, bLinePos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bLineCol);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, bPtPos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bPtCol);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bPtSize);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const meshLoc = {
    viewProj: gl.getUniformLocation(meshProg, 'uViewProj'),
    model: gl.getUniformLocation(meshProg, 'uModel'),
    eyePos: gl.getUniformLocation(meshProg, 'uEyePos'),
  };
  const lineLoc = {
    viewProj: gl.getUniformLocation(lineProg, 'uViewProj'),
    model: gl.getUniformLocation(lineProg, 'uModel'),
  };
  const pointLoc = {
    viewProj: gl.getUniformLocation(pointProg, 'uViewProj'),
    model: gl.getUniformLocation(pointProg, 'uModel'),
    dpr: gl.getUniformLocation(pointProg, 'uDpr'),
  };

  let disposed = false;

  return {
    kind: 'webgl2',
    isLost: () => disposed || gl.isContextLost(),
    render({ scene, viewProj, modelMat, eye, width, height, dpr }) {
      if (disposed || gl.isContextLost()) return;
      const { buffers: geom } = scene;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0.045, 0.115, 0.11, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (geom.triIdx.length) {
        gl.useProgram(meshProg);
        gl.uniformMatrix4fv(meshLoc.viewProj, false, viewProj);
        gl.uniformMatrix4fv(meshLoc.model, false, modelMat);
        gl.uniform3f(meshLoc.eyePos, eye[0], eye[1], eye[2]);
        gl.bindVertexArray(meshVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, bTriPos);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.triPos), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bTriNorm);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.triNorm), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bTriCol);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.triCol), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bTriIdx);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geom.triIdx), gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, geom.triIdx.length, gl.UNSIGNED_SHORT, 0);
      }

      if (geom.linePos.length) {
        gl.useProgram(lineProg);
        gl.uniformMatrix4fv(lineLoc.viewProj, false, viewProj);
        gl.uniformMatrix4fv(lineLoc.model, false, modelMat);
        gl.bindVertexArray(lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, bLinePos);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.linePos), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bLineCol);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.lineCol), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, geom.linePos.length / 3);
      }

      if (geom.ptPos.length) {
        gl.depthMask(false);
        gl.useProgram(pointProg);
        gl.uniformMatrix4fv(pointLoc.viewProj, false, viewProj);
        gl.uniformMatrix4fv(pointLoc.model, false, modelMat);
        gl.uniform1f(pointLoc.dpr, dpr);
        gl.bindVertexArray(pointVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, bPtPos);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.ptPos), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bPtCol);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.ptCol), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bPtSize);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.ptSize), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.POINTS, 0, geom.ptPos.length / 3);
        gl.depthMask(true);
      }
      gl.bindVertexArray(null);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const b of buffers) gl.deleteBuffer(b);
      gl.deleteVertexArray(meshVao);
      gl.deleteVertexArray(lineVao);
      gl.deleteVertexArray(pointVao);
      gl.deleteProgram(meshProg);
      gl.deleteProgram(lineProg);
      gl.deleteProgram(pointProg);
    },
  };
}

// ---------------------------------------------------------------------------
// Canvas2D Software 3D Projection Fallback
// ---------------------------------------------------------------------------

function rgba(c) {
  return `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${(c[3] ?? 1).toFixed(3)})`;
}

function createCanvas2DBackend(canvas) {
  let ctx = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;

  return {
    kind: 'canvas2d',
    isLost: () => false,
    render({ scene, mvp, width, height, dpr }) {
      const { buffers: geom } = scene;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const grad = ctx.createRadialGradient(width * 0.36, height * 0.3, width * 0.05, width * 0.5, height * 0.5, width * 0.72);
      grad.addColorStop(0, '#1a3f3b');
      grad.addColorStop(0.6, '#102725');
      grad.addColorStop(1, '#0b1b1a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      const drawList = [];

      for (const tri of geom.fallbackTris) {
        const a = projectPoint3D(tri.p0, mvp, width, height);
        const b = projectPoint3D(tri.p1, mvp, width, height);
        const c = projectPoint3D(tri.p2, mvp, width, height);
        if (!a.visible || !b.visible || !c.visible) continue;
        drawList.push({ type: 'tri', depth: (a.depth + b.depth + c.depth) / 3, a, b, c, col: tri.c0 });
      }
      for (const line of geom.fallbackLines) {
        const a = projectPoint3D(line.a, mvp, width, height);
        const b = projectPoint3D(line.b, mvp, width, height);
        if (!a.visible && !b.visible) continue;
        drawList.push({ type: 'line', depth: (a.depth + b.depth) * 0.5, a, b, col: line.col });
      }
      for (const pt of geom.fallbackPoints) {
        const p = projectPoint3D(pt.pos, mvp, width, height);
        if (!p.visible) continue;
        drawList.push({ type: 'pt', depth: p.depth, p, col: pt.col, size: pt.size * dpr });
      }

      drawList.sort((u, v) => v.depth - u.depth);
      for (const item of drawList) {
        if (item.type === 'tri') {
          ctx.beginPath();
          ctx.moveTo(item.a.x, item.a.y);
          ctx.lineTo(item.b.x, item.b.y);
          ctx.lineTo(item.c.x, item.c.y);
          ctx.closePath();
          ctx.fillStyle = rgba(item.col);
          ctx.fill();
        } else if (item.type === 'line') {
          ctx.beginPath();
          ctx.moveTo(item.a.x, item.a.y);
          ctx.lineTo(item.b.x, item.b.y);
          ctx.strokeStyle = rgba(item.col);
          ctx.lineWidth = Math.max(1, 1.35 * dpr);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(item.p.x, item.p.y, Math.max(1.5, item.size * 0.45), 0, TAU);
          ctx.fillStyle = rgba(item.col);
          ctx.fill();
        }
      }
    },
    dispose() {},
  };
}

function createSVGBackend(svgElement) {
  return {
    kind: 'svg',
    isLost: () => false,
    render({ scene, mvp, width, height }) {
      const w = Math.max(240, width);
      const h = Math.max(200, height);
      svgElement.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const parts = [];
      for (const line of scene.buffers.fallbackLines) {
        const a = projectPoint3D(line.a, mvp, w, h);
        const b = projectPoint3D(line.b, mvp, w, h);
        if (!a.visible && !b.visible) continue;
        parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${rgba(line.col)}" stroke-width="1.4"/>`);
      }
      for (const pt of scene.buffers.fallbackPoints.slice(0, 120)) {
        const p = projectPoint3D(pt.pos, mvp, w, h);
        if (!p.visible) continue;
        parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${Math.max(2, pt.size * 0.45).toFixed(1)}" fill="${rgba(pt.col)}"/>`);
      }
      svgElement.innerHTML = parts.join('');
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------------------
// Interactive Controller
// ---------------------------------------------------------------------------

/**
 * Mount the interactive WebGL2 3D PCM Field Lab into `root`.
 * Supports pointer orbit, Arrow-key orbit, zoom, Pause/Resume, and
 * auto-pauses continuously animated motion under `prefers-reduced-motion: reduce`.
 */
export function mountPCM3D(root, {
  initialMode = 'physics',
  initialVariant = 0,
  initialPaused = false,
  onStateChange = null,
} = {}) {
  const stage = root.querySelector('.pcm-stage-frame');
  const canvas = root.querySelector('.pcm-canvas');
  const svgFallback = root.querySelector('.pcm-fallback-svg');
  const rendererBadge = root.querySelector('[data-pcm-renderer-badge]');
  const motionBadge = root.querySelector('[data-pcm-motion-badge]');
  const motionBtn = root.querySelector('[data-pcm-action="toggle-motion"]');

  let mode = ['physics', 'chemistry', 'mathematics'].includes(initialMode) ? initialMode : 'physics';
  let variant = initialVariant === 1 ? 1 : 0;
  let camera = { ...DEFAULT_CAMERA[mode] };
  let phase = 0.68;
  let userPaused = Boolean(initialPaused);
  let rafId = 0;
  let lastTime = 0;
  let disposed = false;

  const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  let reducedMotion = !!mediaQuery?.matches;

  let backend = canvas ? createWebGL2Backend(canvas) : null;
  if (!backend && canvas) backend = createCanvas2DBackend(canvas);
  if (!backend && svgFallback) {
    canvas?.setAttribute('hidden', '');
    svgFallback.removeAttribute('hidden');
    backend = createSVGBackend(svgFallback);
  }

  function effectivePaused() {
    return reducedMotion || userPaused;
  }

  function syncAttributes() {
    const paused = effectivePaused();
    root.dataset.mode = mode;
    root.dataset.variant = String(variant);
    root.dataset.renderer = backend?.kind || 'none';
    root.dataset.motion = paused ? 'paused' : 'running';
    root.dataset.reducedMotion = reducedMotion ? 'true' : 'false';

    if (rendererBadge) {
      rendererBadge.textContent = backend?.kind === 'webgl2'
        ? 'WebGL2 3D'
        : backend?.kind === 'canvas2d'
          ? 'Canvas 2D'
          : 'Vector 2D';
    }
    if (motionBadge) {
      motionBadge.textContent = reducedMotion ? 'Static (reduced motion)' : paused ? 'Paused' : 'Live orbit';
    }
    if (motionBtn) {
      motionBtn.setAttribute('aria-pressed', String(paused));
      motionBtn.textContent = paused ? 'Resume motion' : 'Pause motion';
      motionBtn.disabled = reducedMotion;
    }

    root.querySelectorAll('[data-pcm-mode]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.pcmMode === mode));
    });

    const info = describePCMMode(mode, variant);
    const titleEl = root.querySelector('#pcm-lab-title');
    const descEl = root.querySelector('#pcm-lab-desc');
    const formulaEl = root.querySelector('#pcm-lab-formula');
    const readoutEl = root.querySelector('#pcm-lab-readout');
    if (titleEl) titleEl.textContent = info.title;
    if (descEl) descEl.textContent = info.subtitle;
    if (formulaEl) formulaEl.textContent = info.formula;
    if (readoutEl) readoutEl.textContent = info.readout;

    root.querySelectorAll('[data-pcm-variant]').forEach((btn, index) => {
      if (info.variants[index]) btn.textContent = info.variants[index];
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.pcmVariant) === variant));
    });
  }

  function drawFrame() {
    if (disposed || !backend) return;
    if (backend.isLost() && canvas) {
      backend.dispose();
      backend = createCanvas2DBackend(canvas) || (svgFallback ? createSVGBackend(svgFallback) : null);
      syncAttributes();
    }

    const rect = (stage || root).getBoundingClientRect();
    const cssW = Math.max(220, Math.round(stage ? stage.clientWidth || rect.width || 360 : rect.width || 360));
    const cssH = Math.max(200, Math.round(stage ? stage.clientHeight || rect.height || 270 : rect.height || 270));
    const dpr = Math.min(2, typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1);
    const width = Math.round(cssW * dpr);
    const height = Math.round(cssH * dpr);

    if (canvas && (canvas.width !== width || canvas.height !== height)) {
      canvas.width = width;
      canvas.height = height;
    }

    const scene = buildModeScene(mode, variant, phase);
    const eye = orbitCameraEye(camera.yaw, camera.pitch, camera.distance);
    const view = lookAtMatrix4(eye, [0, 0, 0], [0, 1, 0]);
    const proj = perspectiveMatrix4(0.68, width / Math.max(1, height), 0.1, 35);
    const viewProj = mat4Mul(proj, view);
    const [rx, ry, rz] = scene.modelRotation;
    const modelMat = (rx || ry || rz) ? mat4FromMat3(rotationMatrix3(ry, rx, rz)) : mat4Identity();
    const mvp = mat4Mul(viewProj, modelMat);

    backend.render({ scene, viewProj, modelMat, mvp, eye, width, height, dpr });
  }

  function scheduleLoop() {
    if (disposed || rafId || effectivePaused()) return;
    lastTime = performance.now();
    const tick = now => {
      rafId = 0;
      if (disposed || effectivePaused()) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
      lastTime = now;
      phase += dt * 0.85;
      camera.yaw += dt * 0.14;
      drawFrame();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function notifyChange() {
    onStateChange?.({ mode, variant, paused: userPaused });
  }

  function setMode(nextMode, nextVariant = 0) {
    if (!DEFAULT_CAMERA[nextMode]) return;
    mode = nextMode;
    variant = nextVariant === 1 ? 1 : 0;
    camera = { ...DEFAULT_CAMERA[mode] };
    syncAttributes();
    drawFrame();
    notifyChange();
  }

  function setVariant(nextVariant) {
    variant = nextVariant === 1 ? 1 : 0;
    syncAttributes();
    drawFrame();
    notifyChange();
  }

  function toggleMotion() {
    if (reducedMotion) return;
    userPaused = !userPaused;
    syncAttributes();
    if (effectivePaused()) {
      stopLoop();
      drawFrame();
    } else {
      scheduleLoop();
    }
    notifyChange();
  }

  function zoom(delta) {
    camera.distance = clamp(camera.distance + delta, 2.5, 8.2);
    drawFrame();
  }

  function resetView() {
    camera = { ...DEFAULT_CAMERA[mode] };
    phase = 0.68;
    drawFrame();
  }

  // Pointer drag-to-orbit on the 3D stage
  let dragging = false;
  let lastPointer = null;

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    dragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    stage?.classList.add('is-dragging');
    stage?.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragging || !lastPointer) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    camera.yaw -= dx * 0.0085;
    camera.pitch = clamp(camera.pitch + dy * 0.0075, -1.35, 1.35);
    drawFrame();
  }

  function onPointerUp(event) {
    if (!dragging) return;
    dragging = false;
    lastPointer = null;
    stage?.classList.remove('is-dragging');
    stage?.releasePointerCapture?.(event.pointerId);
  }

  function onKeyDown(event) {
    const step = 0.14;
    if (event.key === 'ArrowLeft') { event.preventDefault(); camera.yaw -= step; drawFrame(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); camera.yaw += step; drawFrame(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); camera.pitch = clamp(camera.pitch + step, -1.35, 1.35); drawFrame(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); camera.pitch = clamp(camera.pitch - step, -1.35, 1.35); drawFrame(); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(-0.45); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoom(0.45); }
    else if (event.key === ' ') { event.preventDefault(); toggleMotion(); }
    else if (event.key === 'r' || event.key === 'R' || event.key === '0') { event.preventDefault(); resetView(); }
  }

  function onMediaChange(event) {
    reducedMotion = !!event.matches;
    syncAttributes();
    if (reducedMotion) {
      stopLoop();
      phase = 0.68;
      drawFrame();
    } else if (!userPaused) {
      scheduleLoop();
    }
  }

  function onContextLost(event) {
    event.preventDefault();
    stopLoop();
    if (canvas) {
      backend?.dispose();
      backend = createCanvas2DBackend(canvas) || (svgFallback ? createSVGBackend(svgFallback) : null);
      syncAttributes();
      drawFrame();
    }
  }

  const onClick = event => {
    const modeBtn = event.target.closest?.('[data-pcm-mode]');
    if (modeBtn) {
      setMode(modeBtn.dataset.pcmMode, 0);
      return;
    }
    const varBtn = event.target.closest?.('[data-pcm-variant]');
    if (varBtn) {
      setVariant(Number(varBtn.dataset.pcmVariant));
      return;
    }
    const actionBtn = event.target.closest?.('[data-pcm-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.pcmAction;
    if (action === 'toggle-motion') toggleMotion();
    else if (action === 'zoom-in') zoom(-0.5);
    else if (action === 'zoom-out') zoom(0.5);
    else if (action === 'reset-view') resetView();
  };

  root.addEventListener('click', onClick);
  stage?.addEventListener('pointerdown', onPointerDown);
  stage?.addEventListener('pointermove', onPointerMove);
  stage?.addEventListener('pointerup', onPointerUp);
  stage?.addEventListener('pointercancel', onPointerUp);
  stage?.addEventListener('keydown', onKeyDown);
  canvas?.addEventListener('webglcontextlost', onContextLost);
  mediaQuery?.addEventListener?.('change', onMediaChange);

  let resizeRaf = 0;
  const resizeObserver = typeof ResizeObserver === 'function' && stage
    ? new ResizeObserver(() => {
        if (resizeRaf || disposed) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          if (!disposed) drawFrame();
        });
      })
    : null;
  resizeObserver?.observe(stage);

  syncAttributes();
  drawFrame();
  if (!effectivePaused()) scheduleLoop();

  return function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = 0;
    }
    resizeObserver?.disconnect();
    root.removeEventListener('click', onClick);
    stage?.removeEventListener('pointerdown', onPointerDown);
    stage?.removeEventListener('pointermove', onPointerMove);
    stage?.removeEventListener('pointerup', onPointerUp);
    stage?.removeEventListener('pointercancel', onPointerUp);
    stage?.removeEventListener('keydown', onKeyDown);
    canvas?.removeEventListener('webglcontextlost', onContextLost);
    mediaQuery?.removeEventListener?.('change', onMediaChange);
    backend?.dispose();
  };
}
