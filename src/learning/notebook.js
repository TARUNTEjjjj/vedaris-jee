import { generate } from '../questions/index.js';
import { emptyProgress, getStats } from './progress.js';

export const NOTEBOOK_CAUSES = Object.freeze(['unclassified', 'concept', 'calculation', 'misread', 'time']);
export const MAX_NOTEBOOK_ENTRIES = 1000;
export const MAX_NOTE_LENGTH = 1000;
const MAX_RAW_LENGTH = 8_000_000;
const MAX_BOOKMARKS = 500;
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function emptyNotebook() { return { version: 1, entries: [] }; }

function identity(value) {
  if (!object(value) || !own(value, 'templateId') || !own(value, 'seed') || typeof value.templateId !== 'string' || value.templateId.length > 80) throw new Error('Invalid notebook question identity');
  const item = generate(value.templateId, value.seed);
  return { templateId: item.templateId, seed: item.seed };
}
const key = value => `${value.templateId}:${value.seed}`;

function metadata(value) {
  const cause = own(value, 'cause') ? value.cause : 'unclassified';
  const note = own(value, 'note') ? value.note : '';
  const resolved = own(value, 'resolved') ? value.resolved : false;
  if (!NOTEBOOK_CAUSES.includes(cause) || typeof note !== 'string' || note.length > MAX_NOTE_LENGTH || typeof resolved !== 'boolean') throw new Error('Invalid notebook annotation');
  return { cause, note, resolved };
}

/** Invalid storage returns null so callers can preserve it instead of overwriting it. */
export function restoreNotebook(raw) {
  try {
    if (typeof raw === 'string') {
      if (raw.length > MAX_RAW_LENGTH) return null;
      raw = JSON.parse(raw);
    }
    if (!object(raw) || !own(raw, 'version') || raw.version !== 1 || !own(raw, 'entries') || !Array.isArray(raw.entries) || raw.entries.length > MAX_NOTEBOOK_ENTRIES) return null;
    const seen = new Set();
    const entries = raw.entries.map(value => {
      const entry = { ...identity(value), ...metadata(value) };
      if (seen.has(key(entry))) throw new Error('Duplicate notebook identity');
      seen.add(key(entry));
      return entry;
    });
    return { version: 1, entries };
  } catch { return null; }
}

/** Immutable metadata patch. Identity, answers, and grades cannot be patched. */
export function updateNotebook(notebook, questionIdentity, patch) {
  const clean = restoreNotebook(notebook);
  if (!clean) throw new Error('The saved notebook could not be read; it has been preserved');
  const question = identity(questionIdentity);
  if (!object(patch) || ![Object.prototype, null].includes(Object.getPrototypeOf(patch)) || !Object.keys(patch).length || Object.keys(patch).some(field => !['cause', 'note', 'resolved'].includes(field))) throw new Error('Only cause, note, and resolved can be updated');
  const index = clean.entries.findIndex(entry => key(entry) === key(question));
  if (index === -1 && clean.entries.length === MAX_NOTEBOOK_ENTRIES) throw new Error('The notebook holds up to 1,000 annotations. Existing entries can still be edited.');
  const previous = index === -1 ? metadata({}) : clean.entries[index];
  const next = { ...question, ...metadata({ ...previous, ...patch }) };
  if (index === -1) clean.entries.push(next);
  else clean.entries[index] = next;
  return clean;
}

/**
 * Rebuild the review list from first attempts, bookmarks, and preserved annotations.
 * Only annotations persist; every item and grade comes from the current generator.
 * Returned status is incorrect | partial | correct | unattempted; resolved is manual.
 */
export function notebookEntries(progress = emptyProgress(), bookmarks = [], notebook = emptyNotebook()) {
  const clean = restoreNotebook(notebook);
  if (!clean) throw new Error('The saved notebook could not be read; it has been preserved');
  if (!Array.isArray(bookmarks) || bookmarks.length > MAX_BOOKMARKS) throw new Error('Invalid saved questions');
  const saved = new Map(bookmarks.map(value => { const entry = identity(value); return [key(entry), entry]; }));
  const annotations = new Map(clean.entries.map(entry => [key(entry), entry]));
  const first = new Map();
  for (const row of getStats(progress).rows) {
    const previous = first.get(key(row));
    // Progress normally deduplicates already. Keep the earliest if supplied a raw object.
    if (!previous || row.answeredAt < previous.answeredAt) first.set(key(row), row);
  }
  const identities = new Map();
  for (const row of first.values()) if (row.status === 'incorrect' || row.status === 'partial') identities.set(key(row), identity(row));
  for (const [id, question] of saved) identities.set(id, question);
  // Keep notes and resolution decisions if a bookmark is removed or old progress expires.
  for (const [id, entry] of annotations) identities.set(id, identity(entry));
  return [...identities].map(([id, question]) => {
    const row = first.get(id);
    return {
      id, ...question, item: generate(question.templateId, question.seed),
      ...metadata(annotations.get(id) || {}), bookmarked: saved.has(id),
      status: row?.status || 'unattempted', answeredAt: row?.answeredAt ?? null,
      response: row ? (Array.isArray(row.response) ? [...row.response] : row.response) : null,
      score: row?.score ?? null, maxScore: row?.maxScore ?? null,
    };
  }).sort((a, b) => Number(a.resolved) - Number(b.resolved) || (b.answeredAt ?? 0) - (a.answeredAt ?? 0) || a.id.localeCompare(b.id));
}
