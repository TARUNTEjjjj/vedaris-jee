import { CHAPTERS, SUBJECTS, createRng, generate, listTemplates } from '../questions/index.js';
import { gradeQuestion } from '../questions/grading.js';

export const SESSION_KEY = 'vedaris.session.v1';
const validTime = n => Number.isSafeInteger(n) && n > 0;
const validSeed = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const validIndex = (session, index) => Number.isInteger(index) && index >= 0 && index < session.questions.length;
const emptyResponse = q => q.type === 'multiple' ? [] : '';
export function validResponse(item, response) {
  if (item.type === 'multiple') return Array.isArray(response) && response.length <= item.options.length && new Set(response).size === response.length && response.every(a => typeof a === 'string' && item.options.some(o => o.id === a));
  if (typeof response !== 'string' || response.length > 96) return false;
  return item.type !== 'single' || response === '' || item.options.some(o => o.id === response);
}

function makeSession(items, { seed, subject, chapter, timed, minutes, now, mode = 'practice' }) {
  return { version: 1, id: `session-${now}-${seed}`, mode, seed, subject, chapter, timed, minutes: timed ? minutes : null, index: 0, questions: items.map(({ templateId, seed }) => ({ templateId, seed })), responses: items.map(emptyResponse), flags: items.map(() => false), startedAt: now, deadline: timed ? now + minutes * 60000 : null, finishedAt: null };
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
  return { ...session, finishedAt: session.timed ? Math.min(now, session.deadline) : now };
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
  return { ...session, index, responses };
}
export function toggleFlag(session, index, now = Date.now()) {
  if (!validIndex(session, index)) throw new Error('Question index is out of range');
  if (!writable(session, now)) return finishSession(session, now);
  return { ...session, flags: session.flags.map((v, i) => i === index ? !v : v) };
}

export function gradeSession(session) {
  const rows = sessionItems(session).map((item, index) => ({ item, response: session.responses[index], ...gradeQuestion(item, session.responses[index]), flagged: session.flags[index] }));
  const total = { score: 0, maxScore: 0, correct: 0, incorrect: 0, skipped: 0, partial: 0, rows };
  for (const row of rows) { total.score += row.score; total.maxScore += row.maxScore; total[row.status]++; }
  return total;
}

/** Reject corruption and re-create identities from the registry; stored keys/grades are never trusted. */
export function restoreSession(raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 100000 || !validTime(now)) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || v.version !== 1 || !validSeed(v.seed) || !['practice', 'retry'].includes(v.mode)) return null;
    if (!validTime(v.startedAt) || v.startedAt > now + 60000 || v.id !== `session-${v.startedAt}-${v.seed}`) return null;
    if (!['all', ...SUBJECTS.map(s => s.id)].includes(v.subject)) return null;
    if (v.chapter !== 'all' && !CHAPTERS.some(c => c.id === v.chapter && (v.subject === 'all' || c.subject === v.subject))) return null;
    if (typeof v.timed !== 'boolean' || (v.mode === 'retry' && v.timed)) return null;
    if (v.timed ? (!Number.isInteger(v.minutes) || v.minutes < 1 || v.minutes > 360 || v.deadline !== v.startedAt + v.minutes * 60000) : (v.minutes !== null || v.deadline !== null)) return null;
    if (v.finishedAt !== null && (!validTime(v.finishedAt) || v.finishedAt < v.startedAt || v.finishedAt > now + 60000 || (v.timed && v.finishedAt > v.deadline))) return null;
    if (!Array.isArray(v.questions) || v.questions.length < 1 || v.questions.length > 60 || !validIndex(v, v.index)) return null;
    const items = sessionItems(v), ids = new Set(items.map(q => q.id));
    if (ids.size !== items.length || items.some(q => (v.subject !== 'all' && q.subject !== v.subject) || (v.chapter !== 'all' && q.chapter !== v.chapter))) return null;
    if (!Array.isArray(v.responses) || v.responses.length !== items.length || v.responses.some((a, i) => !validResponse(items[i], a))) return null;
    if (!Array.isArray(v.flags) || v.flags.length !== items.length || v.flags.some(f => typeof f !== 'boolean')) return null;
    // Explicit copying discards injected fields such as answer keys and fake totals.
    const clean = { version: 1, id: v.id, mode: v.mode, seed: v.seed, subject: v.subject, chapter: v.chapter, timed: v.timed, minutes: v.minutes, index: v.index, questions: items.map(({ templateId, seed }) => ({ templateId, seed })), responses: v.responses.map(a => Array.isArray(a) ? [...a].sort() : a), flags: [...v.flags], startedAt: v.startedAt, deadline: v.deadline, finishedAt: v.finishedAt };
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
