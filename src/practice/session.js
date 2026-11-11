import { CHAPTERS, SUBJECTS, createRng, generate, listTemplates } from '../questions/index.js';
import { gradeQuestion } from '../questions/grading.js';

export const SESSION_KEY = 'vedaris.session.v1';
const validTime = n => Number.isSafeInteger(n) && n > 0;
const validSeed = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const validIndex = (session, index) => Number.isInteger(index) && index >= 0 && index < session.questions.length;
const emptyResponse = q => q.type === 'multiple' ? [] : '';
const answered = response => Array.isArray(response) ? response.length > 0 : typeof response === 'string' && response.trim().length > 0;
const sumTime = values => values.reduce((total, value) => total + (value ?? 0), 0);

// Legacy sessions predate measurement. Null means unknown, never zero seconds.
function analytics(session) {
  if (!Object.hasOwn(session, 'timeSpentMs')) return {
    timeSpentMs: session.questions.map(() => null),
    visited: session.questions.map((_, index) => answered(session.responses[index]) || session.flags[index] ? true : null),
    timingUpdatedAt: null,
  };
  return { timeSpentMs: [...session.timeSpentMs], visited: [...session.visited], timingUpdatedAt: session.timingUpdatedAt };
}

function markVisited(session, index) {
  const state = analytics(session);
  state.visited[index] = true;
  return { ...session, ...state };
}
export function validResponse(item, response) {
  if (item.type === 'multiple') return Array.isArray(response) && response.length <= item.options.length && new Set(response).size === response.length && response.every(a => typeof a === 'string' && item.options.some(o => o.id === a));
  if (typeof response !== 'string' || response.length > 96) return false;
  return item.type !== 'single' || response === '' || item.options.some(o => o.id === response);
}

function makeSession(items, { seed, subject, chapter, timed, minutes, now, mode = 'practice' }) {
  return { version: 1, id: `session-${now}-${seed}`, mode, seed, subject, chapter, timed, minutes: timed ? minutes : null, index: 0, questions: items.map(({ templateId, seed }) => ({ templateId, seed })), responses: items.map(emptyResponse), flags: items.map(() => false), visited: items.map(() => false), timeSpentMs: items.map(() => 0), timingUpdatedAt: now, startedAt: now, deadline: timed ? now + minutes * 60000 : null, finishedAt: null };
}

export function createSession({ subject = 'all', chapter = 'all', count = 12, seed, timed = true, minutes = 36, now = Date.now() } = {}) {
  if (!validSeed(seed) || !validTime(now) || !Number.isInteger(count) || count < 1 || count > 60 || typeof timed !== 'boolean') throw new Error('Invalid practice setup');
  if (!['all', ...SUBJECTS.map(s => s.id)].includes(subject)) throw new Error('Unknown subject');
  if (chapter !== 'all' && !CHAPTERS.some(c => c.id === chapter && (subject === 'all' || c.subject === subject))) throw new Error('Choose a chapter in this subject');
  if (timed && (!Number.isInteger(minutes) || minutes < 1 || minutes > 360)) throw new Error('Choose a duration from 1 to 360 minutes');
  let pool = listTemplates({ subject, chapter });
  if (!pool.length) throw new Error('Original practice is not yet available for this chapter. Explore its PYQ papers instead.');
  const rng = createRng(seed);
  // Fisher–Yates avoids order-dependent sort comparators and makes a seed reproducible.
  for (let i = pool.length - 1; i > 0; i--) { const j = rng.int(0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  if (subject === 'all' && chapter === 'all') {
    const groups = SUBJECTS.map(s => pool.filter(f => f.subject === s.id));
    pool = [];
    for (let i = 0; i < Math.max(...groups.map(g => g.length)); i++) for (const group of groups) if (group[i]) pool.push(group[i]);
  }
  const items = [], stems = new Set();
  const bound = Math.max(5000, count * pool.length * 100);
  for (let attempt = 0; items.length < count && attempt < bound; attempt++) {
    const q = generate(pool[attempt % pool.length].id, rng.int(0, 0xffffffff));
    if (stems.has(q.stem)) continue;
    stems.add(q.stem); items.push(q);
  }
  if (items.length < count) throw new Error('Not enough distinct questions for this chapter. Choose a smaller set or a broader subject.');
  return makeSession(items, { seed, subject, chapter, timed, minutes, now });
}

export function sessionItems(session) { return session.questions.map(q => generate(q.templateId, q.seed)); }
export function remainingMs(session, now = Date.now()) {
  if (!validTime(now)) throw new Error('Invalid time');
  if (!session.timed) return null;
  return Math.max(0, session.deadline - (session.finishedAt ?? now));
}
export function finishSession(session, now = Date.now()) {
  if (!validTime(now) || now < session.startedAt) throw new Error('Invalid finish time');
  if (session.finishedAt !== null) return session;
  const state = analytics(session);
  const finishedAt = session.timed ? Math.min(now, session.deadline) : now;
  if (state.timingUpdatedAt !== null && state.timingUpdatedAt > finishedAt) throw new Error('Finish time precedes recorded activity');
  return { ...session, ...state, finishedAt };
}
function writable(session, now) {
  if (!validTime(now) || now < session.startedAt) throw new Error('Invalid response time');
  if (session.finishedAt !== null) return false;
  return !session.timed || now < session.deadline;
}
export function setResponse(session, index, response, now = Date.now()) {
  if (!validIndex(session, index)) throw new Error('Question index is out of range');
  if (!writable(session, now)) return finishSession(session, now);
  const item = generate(session.questions[index].templateId, session.questions[index].seed);
  if (!validResponse(item, response)) throw new Error('Invalid response');
  const responses = session.responses.map((a, i) => i === index ? (Array.isArray(response) ? [...response].sort() : response) : (Array.isArray(a) ? [...a] : a));
  return markVisited({ ...session, index, responses }, index);
}
export function toggleFlag(session, index, now = Date.now()) {
  if (!validIndex(session, index)) throw new Error('Question index is out of range');
  if (!writable(session, now)) return finishSession(session, now);
  return markVisited({ ...session, flags: session.flags.map((v, i) => i === index ? !v : v) }, index);
}

/** Mark a displayed question. The UI should flush its previous timing interval first. */
export function visitQuestion(session, index, now = Date.now()) {
  if (!validIndex(session, index)) throw new Error('Question index is out of range');
  if (!writable(session, now)) return finishSession(session, now);
  return markVisited({ ...session, index }, index);
}

/**
 * Record a measured interval only while a question is visible in the practice
 * view. Callers use a monotonic clock for elapsedMs, flush before switching
 * questions/submitting, and reset their clock when the page becomes hidden.
 * Wall-clock caps prevent overlapping intervals or time beyond the deadline.
 */
export function trackTime(session, elapsedMs, index = session.index, now = Date.now()) {
  if (!validIndex(session, index)) throw new Error('Question index is out of range');
  if (!Number.isInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 60000) throw new Error('Activity interval must be an integer from 0 to 60000 ms');
  if (!validTime(now) || now < session.startedAt) throw new Error('Invalid activity time');
  if (session.finishedAt !== null) return session;
  const state = analytics(session);
  const end = session.timed ? Math.min(now, session.deadline) : now;
  // Unknown historic activity cannot be reconstructed by starting a counter
  // midway through a legacy session. Its visits can still become known.
  if (state.timingUpdatedAt !== null && end >= state.timingUpdatedAt) {
    const amount = Math.min(elapsedMs, end - state.timingUpdatedAt, Math.max(0, end - session.startedAt - sumTime(state.timeSpentMs)));
    state.timeSpentMs[index] += amount;
    state.timingUpdatedAt = end;
  }
  if (elapsedMs > 0) state.visited[index] = true;
  const next = { ...session, ...state };
  return session.timed && now >= session.deadline ? finishSession(next, now) : next;
}

export function questionStatus(session, index) {
  if (!validIndex(session, index)) throw new Error('Question index is out of range');
  if (answered(session.responses[index])) return session.flags[index] ? 'answered-and-marked' : 'answered';
  if (session.flags[index]) return 'marked-for-review';
  const visited = session.visited?.[index];
  return visited === true ? 'not-answered' : visited === false ? 'not-visited' : 'unknown';
}

export function gradeSession(session) {
  const state = analytics(session);
  const rows = sessionItems(session).map((item, index) => ({ item, response: session.responses[index], ...gradeQuestion(item, session.responses[index]), flagged: session.flags[index], visited: state.visited[index], timeSpentMs: state.timeSpentMs[index], navigationStatus: questionStatus({ ...session, visited: state.visited }, index) }));
  const total = { score: 0, maxScore: 0, correct: 0, incorrect: 0, skipped: 0, partial: 0, activeTimeMs: state.timeSpentMs.some(value => value === null) ? null : sumTime(state.timeSpentMs), elapsedMs: session.finishedAt === null ? null : session.finishedAt - session.startedAt, visited: state.visited.filter(value => value === true).length, notVisited: state.visited.filter(value => value === false).length, visitUnknown: state.visited.filter(value => value === null).length, rows };
  for (const row of rows) { total.score += row.score; total.maxScore += row.maxScore; total[row.status]++; }
  return total;
}

/** Reject corruption and re-create identities from the registry; stored keys/grades are never trusted. */
export function restoreSession(raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 100000 || !validTime(now)) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || v.version !== 1 || !validSeed(v.seed) || !['practice', 'retry', 'revision'].includes(v.mode)) return null;
    if (!validTime(v.startedAt) || v.startedAt > now + 60000 || v.id !== `session-${v.startedAt}-${v.seed}`) return null;
    if (!['all', ...SUBJECTS.map(s => s.id)].includes(v.subject)) return null;
    if (v.chapter !== 'all' && !CHAPTERS.some(c => c.id === v.chapter && (v.subject === 'all' || c.subject === v.subject))) return null;
    if (typeof v.timed !== 'boolean' || (['retry', 'revision'].includes(v.mode) && v.timed)) return null;
    if (v.timed ? (!Number.isInteger(v.minutes) || v.minutes < 1 || v.minutes > 360 || v.deadline !== v.startedAt + v.minutes * 60000) : (v.minutes !== null || v.deadline !== null)) return null;
    if (v.finishedAt !== null && (!validTime(v.finishedAt) || v.finishedAt < v.startedAt || v.finishedAt > now + 60000 || (v.timed && v.finishedAt > v.deadline))) return null;
    if (!Array.isArray(v.questions) || v.questions.length < 1 || v.questions.length > 60 || !validIndex(v, v.index)) return null;
    const items = sessionItems(v), ids = new Set(items.map(q => q.id));
    if (ids.size !== items.length || items.some(q => (v.subject !== 'all' && q.subject !== v.subject) || (v.chapter !== 'all' && q.chapter !== v.chapter))) return null;
    if (!Array.isArray(v.responses) || v.responses.length !== items.length || v.responses.some((a, i) => !validResponse(items[i], a))) return null;
    if (!Array.isArray(v.flags) || v.flags.length !== items.length || v.flags.some(f => typeof f !== 'boolean')) return null;
    const timingKeys = ['timeSpentMs', 'visited', 'timingUpdatedAt'];
    const hasTiming = timingKeys.some(key => Object.hasOwn(v, key));
    if (hasTiming) {
      if (!timingKeys.every(key => Object.hasOwn(v, key))) return null;
      if (!Array.isArray(v.timeSpentMs) || v.timeSpentMs.length !== items.length || !Array.isArray(v.visited) || v.visited.length !== items.length) return null;
      if (v.visited.some(value => value !== null && typeof value !== 'boolean')) return null;
      const allUnknown = v.timeSpentMs.every(value => value === null);
      if (allUnknown ? v.timingUpdatedAt !== null : v.timeSpentMs.some(value => !Number.isSafeInteger(value) || value < 0)) return null;
      if (!allUnknown) {
        const end = v.finishedAt ?? (v.timed ? Math.min(now, v.deadline) : now);
        if (!validTime(v.timingUpdatedAt) || v.timingUpdatedAt < v.startedAt || v.timingUpdatedAt > Math.max(v.startedAt, end)) return null;
        if (v.visited.some(value => value === null)) return null;
        const totalTime = sumTime(v.timeSpentMs);
        if (!Number.isSafeInteger(totalTime) || totalTime > Math.max(0, v.timingUpdatedAt - v.startedAt)) return null;
        if (v.timeSpentMs.some((value, index) => value > 0 && v.visited[index] !== true)) return null;
      }
      if (v.visited.some((value, index) => value === false && (answered(v.responses[index]) || v.flags[index]))) return null;
    }
    const state = analytics(v);
    // Explicit copying discards injected fields such as answer keys and fake totals.
    const clean = { version: 1, id: v.id, mode: v.mode, seed: v.seed, subject: v.subject, chapter: v.chapter, timed: v.timed, minutes: v.minutes, index: v.index, questions: items.map(({ templateId, seed }) => ({ templateId, seed })), responses: v.responses.map(a => Array.isArray(a) ? [...a].sort() : a), flags: [...v.flags], ...state, startedAt: v.startedAt, deadline: v.deadline, finishedAt: v.finishedAt };
    return clean.finishedAt === null && clean.timed && now >= clean.deadline ? finishSession(clean, now) : clean;
  } catch { return null; }
}

export function createRetrySession(source, now = Date.now()) {
  const clean = restoreSession(JSON.stringify(source), now);
  if (!clean || clean.finishedAt === null) throw new Error('Finish the session before retrying');
  const items = gradeSession(clean).rows.filter(row => row.status !== 'correct').map(row => row.item);
  if (!items.length) throw new Error('Every answer was correct. Start a new set.');
  return makeSession(items, { seed: clean.seed, subject: clean.subject, chapter: clean.chapter, timed: false, minutes: null, now, mode: 'retry' });
}

/** Create an untimed set from exact original identities selected for revision. */
export function createRevisionSession(identities, now = Date.now()) {
  if (!validTime(now) || !Array.isArray(identities) || identities.length < 1 || identities.length > 60) throw new Error('Choose 1 to 60 original questions for revision');
  const items = identities.map(identity => {
    if (!identity || typeof identity !== 'object') throw new Error('Invalid question identity');
    return generate(identity.templateId, identity.seed);
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Revision questions must have distinct identities');
  let seed = 2166136261;
  for (const character of items.map(item => item.id).join('\n')) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const subject = items.every(item => item.subject === items[0].subject) ? items[0].subject : 'all';
  const chapter = items.every(item => item.chapter === items[0].chapter) ? items[0].chapter : 'all';
  return makeSession(items, { seed, subject, chapter, timed: false, minutes: null, now, mode: 'revision' });
}
