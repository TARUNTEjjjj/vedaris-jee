import { SUBJECTS, CHAPTERS } from '../questions/index.js';
import { restoreSession, gradeSession } from '../practice/session.js';

export const HISTORY_KEY = 'vedaris.history.v1';
export const MAX_HISTORY_SESSIONS = 50;
const MAX_HISTORY_BYTES = 2000000;
export function emptyHistory() { return { version: 1, sessions: [] }; }
const newestFirst = (a, b) => b.finishedAt - a.finishedAt || b.startedAt - a.startedAt || a.id.localeCompare(b.id);

function completed(value, now) {
  if (!value || value.finishedAt === null || value.finishedAt === undefined) throw new Error('Only completed sessions can enter history');
  const clean = restoreSession(JSON.stringify(value), now);
  if (!clean || clean.finishedAt === null) throw new Error('Invalid completed session');
  // Reconstruct keys and score now so errors cannot enter a seemingly valid
  // stored history. No totals or answer keys supplied in the backup survive.
  gradeSession(clean);
  return clean;
}

function normalize(history, now) {
  if (!Number.isSafeInteger(now) || now <= 0 || !history || history.version !== 1 || !Array.isArray(history.sessions) || history.sessions.length > MAX_HISTORY_SESSIONS) throw new Error('Invalid session history');
  const byId = new Map();
  for (const value of history.sessions) {
    const session = completed(value, now);
    if (!byId.has(session.id)) byId.set(session.id, session);
  }
  return { version: 1, sessions: [...byId.values()].sort(newestFirst) };
}

/** Re-recording an id never replaces its first saved, completed attempt. */
export function recordHistory(history, completedSession, now = Date.now()) {
  const clean = normalize(history, now);
  const session = completed(completedSession, now);
  if (clean.sessions.some(existing => existing.id === session.id)) return clean;
  return { version: 1, sessions: [...clean.sessions, session].sort(newestFirst).slice(0, MAX_HISTORY_SESSIONS) };
}

/** Null preserves the same recoverable-corruption contract as restoreSession. */
export function restoreHistory(raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > MAX_HISTORY_BYTES) return null;
  try { return normalize(JSON.parse(raw), now); }
  catch { return null; }
}

function groups(rows, metadata, key) {
  return metadata.map(info => {
    const matching = rows.filter(row => row.item[key] === info.id);
    const attempted = matching.filter(row => row.status !== 'skipped').length;
    const correct = matching.filter(row => row.status === 'correct').length;
    return { ...info, questionCount: matching.length, attempted, correct, incorrect: matching.filter(row => row.status === 'incorrect').length, partial: matching.filter(row => row.status === 'partial').length, skipped: matching.filter(row => row.status === 'skipped').length, score: matching.reduce((sum, row) => sum + row.score, 0), maxScore: matching.reduce((sum, row) => sum + row.maxScore, 0), accuracy: attempted ? correct / attempted * 100 : null, activeTimeMs: matching.some(row => row.timeSpentMs === null) ? null : matching.reduce((sum, row) => sum + row.timeSpentMs, 0) };
  }).filter(group => group.questionCount > 0);
}

/** These are session statistics, including retries; first-attempt learning
 * metrics remain the responsibility of progress.js. Accuracy uses answered
 * questions as its denominator, and unknown historical timing stays null. */
export function historyStats(history, now = Date.now()) {
  const clean = normalize(history, now);
  const sessions = clean.sessions.map(session => {
    const report = gradeSession(session);
    const questionCount = report.rows.length;
    const attempted = questionCount - report.skipped;
    return { id: session.id, session, report, questionCount, attempted, accuracy: attempted ? report.correct / attempted * 100 : null, completionRate: attempted / questionCount * 100, activeTimeMs: report.activeTimeMs, elapsedMs: report.elapsedMs, averageQuestionTimeMs: report.activeTimeMs === null ? null : report.activeTimeMs / questionCount, subjects: groups(report.rows, SUBJECTS, 'subject'), chapters: groups(report.rows, CHAPTERS, 'chapter') };
  });
  const rows = sessions.flatMap(entry => entry.report.rows);
  const attempted = rows.filter(row => row.status !== 'skipped').length;
  const correct = rows.filter(row => row.status === 'correct').length;
  return { sessionCount: sessions.length, questionCount: rows.length, attempted, correct, incorrect: rows.filter(row => row.status === 'incorrect').length, partial: rows.filter(row => row.status === 'partial').length, skipped: rows.filter(row => row.status === 'skipped').length, score: rows.reduce((sum, row) => sum + row.score, 0), maxScore: rows.reduce((sum, row) => sum + row.maxScore, 0), accuracy: attempted ? correct / attempted * 100 : null, activeTimeMs: sessions.some(entry => entry.activeTimeMs === null) ? null : sessions.reduce((sum, entry) => sum + entry.activeTimeMs, 0), knownTimingSessionCount: sessions.filter(entry => entry.activeTimeMs !== null).length, elapsedMs: sessions.reduce((sum, entry) => sum + entry.elapsedMs, 0), subjects: groups(rows, SUBJECTS, 'subject'), chapters: groups(rows, CHAPTERS, 'chapter'), sessions };
}

/** Spreadsheet-ready session summaries. Reconstruct scores from validated
 * question identities and responses; never trust totals stored in a backup.
 * Blank timing/accuracy means unknown or no attempts, not zero. */
export function historyCSV(history, now = Date.now()) {
  const stats = historyStats(history, now);
  const fields = ['session_id', 'completed_at_utc', 'mode', 'subject', 'questions',
    'attempted', 'correct', 'partial', 'incorrect', 'skipped', 'score', 'max_score',
    'accuracy_percent', 'active_time_ms', 'elapsed_time_ms'];
  const cell = value => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    // Quote every text field and neutralize spreadsheet formula prefixes.
    let text = String(value);
    if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = stats.sessions.map(entry => [entry.id,
    new Date(entry.session.finishedAt).toISOString(), entry.session.mode, entry.session.subject,
    entry.questionCount, entry.attempted, entry.report.correct, entry.report.partial,
    entry.report.incorrect, entry.report.skipped, entry.report.score, entry.report.maxScore,
    entry.accuracy, entry.activeTimeMs, entry.elapsedMs]);
  return [fields, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
