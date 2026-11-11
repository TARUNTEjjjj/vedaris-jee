import { CHAPTERS, SUBJECTS, generate } from '../questions/index.js';
import { gradeQuestion } from '../questions/grading.js';
import { restoreSession, gradeSession, validResponse } from '../practice/session.js';

export const PROGRESS_KEY = 'vedaris.progress.v1';
export const MAX_RECORDS = 1000;
export function emptyProgress() { return { version: 1, records: [] }; }
function normalizeRecord(v, now) {
  if (!v || typeof v !== 'object' || !Number.isSafeInteger(v.answeredAt) || v.answeredAt <= 0 || v.answeredAt > now + 60000) throw new Error('Invalid progress timestamp');
  const item = generate(v.templateId, v.seed);
  if (!validResponse(item, v.response)) throw new Error('Invalid saved answer');
  const grade = gradeQuestion(item, v.response);
  if (grade.status === 'skipped') throw new Error('Unanswered items are not first attempts');
  return { templateId: item.templateId, seed: item.seed, response: Array.isArray(v.response) ? [...v.response].sort() : v.response, answeredAt: v.answeredAt };
}
function normalize(progress, now = Date.now()) {
  if (!progress || progress.version !== 1 || !Array.isArray(progress.records) || progress.records.length > MAX_RECORDS) throw new Error('Invalid progress backup');
  return { version: 1, records: progress.records.map(r => normalizeRecord(r, now)) };
}
function merge(a, b) {
  const earliest = new Map();
  // For equal timestamps, preserve the already-saved record.
  for (const row of [...a.records, ...b.records]) {
    const key = `${row.templateId}:${row.seed}`;
    const old = earliest.get(key);
    if (!old || row.answeredAt < old.answeredAt) earliest.set(key, row);
  }
  return { version: 1, records: [...earliest.values()].sort((a,b) => b.answeredAt-a.answeredAt || a.templateId.localeCompare(b.templateId) || a.seed-b.seed).slice(0, MAX_RECORDS) };
}
export function recordSession(progress, session, now = Date.now()) {
  const existing = normalize(progress, now);
  const clean = restoreSession(JSON.stringify(session), now);
  if (!clean || clean.finishedAt === null) throw new Error('Only completed sessions can enter progress');
  const records = gradeSession(clean).rows.filter(r => r.status !== 'skipped').map(r => ({ templateId: r.item.templateId, seed: r.item.seed, response: Array.isArray(r.response) ? [...r.response] : r.response, answeredAt: clean.finishedAt }));
  return merge(existing, { version: 1, records });
}
export function getStats(progress) {
  const clean = normalize(progress);
  const initial = (metadata = {}) => ({ ...metadata, attempted: 0, total: 0, correct: 0, incorrect: 0, partial: 0, score: 0, maxScore: 0, accuracy: 0 });
  const total = initial();
  const subjects = SUBJECTS.map(s => initial(s));
  const chapters = CHAPTERS.map(c => initial(c));
  const rows = [];
  for (const record of clean.records) {
    const item = generate(record.templateId, record.seed), grade = gradeQuestion(item, record.response);
    rows.push({ ...record, item, ...grade });
    for (const group of [total, subjects.find(s => s.id === item.subject), chapters.find(c => c.id === item.chapter)]) {
      group.attempted++; group.total++; group[grade.status]++; group.score += grade.score; group.maxScore += grade.maxScore;
    }
  }
  for (const group of [total, ...subjects, ...chapters]) group.accuracy = group.attempted ? group.correct / group.attempted * 100 : 0;
  return { ...total, subjects, chapters, rows };
}
export function exportProgress(progress) {
  return JSON.stringify({ app: 'vedaris', ...normalize(progress), exportedAt: new Date().toISOString() }, null, 2);
}
export function importProgress(raw, existing = emptyProgress(), now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 1000000) throw new Error('Backup must be JSON under 1 MB');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('This is not valid JSON'); }
  if (parsed.app !== undefined && parsed.app !== 'vedaris') throw new Error('Choose a Vedaris progress backup');
  return merge(normalize(existing, now), normalize(parsed, now));
}
