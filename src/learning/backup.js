import { generate } from '../questions/index.js';
import { restoreSession } from '../practice/session.js';
import { importProgress, emptyProgress, MAX_RECORDS } from './progress.js';
import { restoreHistory, emptyHistory, MAX_HISTORY_SESSIONS } from './history.js';
import { restoreNotebook, emptyNotebook, MAX_NOTEBOOK_ENTRIES, MAX_NOTE_LENGTH } from './notebook.js';
import { restoreHistoricalSession, restoreHistoricalWorkspace } from '../content/session.js';

/**
 * Complete browser-workspace backups.
 *
 * A backup is validated in full before anything is written. Stored totals,
 * grades and answer keys are never trusted: every record is rebuilt from its
 * exact question identity by the same validators the workspace uses on load.
 * Records whose identity no longer resolves in the installed content are held
 * verbatim, disclosed, re-exported, and re-checked on every later restore.
 */
export const BACKUP_FORMAT = 'vedaris-workspace-backup';
export const BACKUP_VERSION = 1;
export const SUPPORTED_BACKUP_VERSIONS = Object.freeze([1]);
export const MAX_BACKUP_BYTES = 12_000_000;
export const MAX_UNRESOLVED_ITEMS = 2000;
export const MAX_BOOKMARKS = 500;
export const MAX_PAPER_NOTES = 1000;
export const DAILY_GOALS = Object.freeze([5, 10, 20, 30]);

/** Persistent learner data, in export order. `slot` is the localStorage name: vedaris.<slot>.v1. */
export const BACKUP_STORES = Object.freeze([
  { name: 'progress', slot: 'progress', label: 'Original-practice first attempts' },
  { name: 'history', slot: 'history', label: 'Original-practice reports (latest 50)' },
  { name: 'session', slot: 'session', label: 'Active original-practice session' },
  { name: 'bookmarks', slot: 'bookmarks', label: 'Saved questions' },
  { name: 'notebook', slot: 'notebook', label: 'Revision notebook' },
  { name: 'goal', slot: 'goal', label: 'Daily goal preference' },
  { name: 'paperNotes', slot: 'paper-notes', label: 'Paper notes and paper timers' },
  { name: 'pyq', slot: 'pyq-workspace', label: 'PYQ active attempt and reports (latest 20)' },
  { name: 'unresolved', slot: 'unresolved', label: 'Held records that no longer resolve' },
].map(Object.freeze));
export const PRE_RESTORE_SLOT = 'pre-restore';
export const storageKey = slot => `vedaris.${slot}.v1`;
const STORE_NAMES = BACKUP_STORES.map(store => store.name);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };

export function emptyUnresolved() { return { version: 1, items: [] }; }
export function emptyWorkspaceStores() {
  return { progress: emptyProgress(), history: emptyHistory(), session: null, bookmarks: [], notebook: emptyNotebook(), goal: 10, paperNotes: {}, pyq: null, unresolved: emptyUnresolved() };
}

/** Sanity bounds for held records; their content is otherwise preserved byte-for-byte as JSON. */
export function restoreUnresolved(value) {
  try {
    if (typeof value === 'string') value = JSON.parse(value);
    if (!object(value) || value.version !== 1 || !Array.isArray(value.items) || value.items.length > MAX_UNRESOLVED_ITEMS) return null;
    for (const item of value.items) if (!object(item) || typeof item.store !== 'string' || !HELD_STORES.includes(item.store) || typeof item.reason !== 'string' || item.reason.length > 300 || !own(item, 'record') || !object(item.record)) return null;
    return { version: 1, items: clone(value.items) };
  } catch { return null; }
}
export function validPaperNotes(value) {
  return object(value) && Object.keys(value).length <= MAX_PAPER_NOTES && Object.entries(value).every(([id, note]) => id.length <= 200 && object(note)
    && Object.keys(note).every(field => ['text', 'deadline'].includes(field))
    && (note.text === undefined || (typeof note.text === 'string' && note.text.length <= 50000))
    && (note.deadline == null || Number.isFinite(note.deadline)));
}
const HELD_STORES = ['progress', 'history', 'session', 'bookmarks', 'notebook', 'pyq-session', 'pyq-workspace'];

/**
 * Build a versioned export. `stores` must be the already-validated in-memory
 * workspace. `preserved` carries raw text for stores that could not be read
 * or verified; it travels with the file but is never restored automatically.
 */
export function createWorkspaceBackup({ stores, preserved = {}, contentBankId = null, kind = 'export', now = Date.now() }) {
  const out = { format: BACKUP_FORMAT, version: BACKUP_VERSION, kind, exportedAt: new Date(now).toISOString(), contentBankId, stores: {}, preserved: {} };
  for (const name of STORE_NAMES) out.stores[name] = clone(stores[name] ?? emptyWorkspaceStores()[name]);
  for (const [name, entry] of Object.entries(preserved)) out.preserved[name] = { reason: String(entry.reason), raw: String(entry.raw) };
  return out;
}

const LEGACY_PROGRESS = 'legacy-progress', LEGACY_PYQ = 'legacy-pyq';

/** Parse and classify a backup file. Throws a learner-facing message; never writes. */
export function parseBackup(raw) {
  if (typeof raw !== 'string') fail('Choose a Vedaris backup file.');
  if (raw.length > MAX_BACKUP_BYTES) fail('This backup is larger than the 12 MB limit.');
  let value;
  try { value = JSON.parse(raw); } catch { fail('This file is not complete JSON. It may be truncated or damaged.'); }
  if (!object(value)) fail('This file is not a Vedaris backup.');
  if (own(value, 'format')) {
    if (value.format !== BACKUP_FORMAT) fail('This file is not a Vedaris workspace backup.');
    if (!SUPPORTED_BACKUP_VERSIONS.includes(value.version)) fail(`This backup uses format version ${JSON.stringify(value.version)}, which this release cannot read. Your current workspace was not changed.`);
    if (!object(value.stores)) fail('This backup has no saved stores.');
    const missing = STORE_NAMES.filter(name => !own(value.stores, name));
    if (missing.length) fail(`This backup is incomplete: it is missing ${missing.join(', ')}. Your current workspace was not changed.`);
    const unknown = Object.keys(value.stores).filter(name => !STORE_NAMES.includes(name));
    if (unknown.length) fail(`This backup contains unknown stores (${unknown.join(', ')}). It may come from a newer release.`);
    const preserved = value.preserved ?? {};
    if (!object(preserved) || Object.entries(preserved).some(([name, entry]) => !STORE_NAMES.includes(name) || !object(entry) || typeof entry.raw !== 'string' || typeof entry.reason !== 'string')) fail('This backup has an invalid preserved-data section.');
    return { source: 'workspace', version: value.version, kind: value.kind === 'pre-restore' ? 'pre-restore' : 'export', exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : null, stores: value.stores, included: [...STORE_NAMES], preserved };
  }
  // Older supported formats: the single-store exports earlier releases offered.
  if (value.version === 1 && Array.isArray(value.records) && !own(value, 'bankId') && (value.app === undefined || value.app === 'vedaris'))
    return { source: LEGACY_PROGRESS, version: 1, kind: 'export', exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : null, stores: { progress: { version: 1, records: value.records } }, included: ['progress'], preserved: {} };
  if (value.version === 1 && typeof value.bankId === 'string' && Array.isArray(value.history) && own(value, 'active'))
    return { source: LEGACY_PYQ, version: 1, kind: 'export', exportedAt: null, stores: { pyq: value }, included: ['pyq'], preserved: {} };
  fail('This file is not a recognised Vedaris backup version. Your current workspace was not changed.');
}

/** Collapse byte-identical duplicates; conflicting records with one identity are rejected. */
function dedupe(list, identity, label, report) {
  const seen = new Map(), out = [];
  for (const record of list) {
    const id = identity(record), text = JSON.stringify(record);
    if (!seen.has(id)) { seen.set(id, text); out.push(record); continue; }
    if (seen.get(id) !== text) fail(`${label} contains two different records for the same question identity (${id}).`);
    report.duplicates[label] = (report.duplicates[label] || 0) + 1;
  }
  return out;
}
const originalId = value => {
  if (!object(value) || typeof value.templateId !== 'string' || value.templateId.length > 80 || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) fail('A saved record has a malformed question identity.');
  return `${value.templateId}:${value.seed}`;
};
function resolvesOriginal(identity) {
  try { generate(identity.templateId, identity.seed); return true; }
  catch (error) { if (/Unknown question family/.test(error.message)) return false; throw error; }
}
const sessionResolves = session => {
  if (!object(session) || !Array.isArray(session.questions)) fail('A saved original-practice session is malformed.');
  session.questions.forEach(originalId);
  return session.questions.every(resolvesOriginal);
};

/**
 * Validate every included store against the installed content and return a
 * restore plan. Throws on malformed data. `registry`/`bankId` are required when
 * the backup includes PYQ data; `archivePaperIds` (a Set) is optional.
 */
export function analyzeBackup(parsed, { registry = null, bankId = null, archivePaperIds = null, now = Date.now() } = {}) {
  const report = { duplicates: {}, unresolved: [], notes: [], counts: {}, unlinkedPaperNotes: [] };
  const stores = {};
  const held = [];
  const hold = (store, reason, record) => held.push({ store, reason, record: clone(record) });
  const incoming = parsed.stores;
  const included = new Set(parsed.included);
  // Previously held records are re-checked; any that now resolve rejoin their store.
  const reentry = { progress: [], history: [], session: [], bookmarks: [], notebook: [], 'pyq-session': [], 'pyq-workspace': [] };
  if (included.has('unresolved')) {
    const clean = restoreUnresolved(incoming.unresolved);
    if (!clean) fail('The held unresolved records in this backup are malformed.');
    for (const item of clean.items) reentry[item.store].push(item);
  }
  const anyOriginal = ['progress', 'history', 'session', 'bookmarks', 'notebook'];

  if (included.has('progress')) {
    const value = incoming.progress;
    if (!object(value) || value.version !== 1 || !Array.isArray(value.records)) fail('Original-practice progress in this backup is malformed.');
    const candidates = dedupe([...value.records, ...reentry.progress.map(item => item.record)], originalId, 'Original-practice progress', report);
    const keep = [];
    for (const record of candidates) resolvesOriginal(record) ? keep.push(record) : hold('progress', 'Unknown original question family in this release', record);
    if (keep.length > MAX_RECORDS) fail('Original-practice progress exceeds the 1,000-record limit.');
    try { stores.progress = importProgress(JSON.stringify({ version: 1, records: keep }), emptyProgress(), now); }
    catch (error) { fail(`Original-practice progress failed validation: ${error.message}.`); }
  }
  if (included.has('history')) {
    const value = incoming.history;
    if (!object(value) || value.version !== 1 || !Array.isArray(value.sessions)) fail('Original-practice reports in this backup are malformed.');
    const candidates = dedupe([...value.sessions, ...reentry.history.map(item => item.record)], s => object(s) && typeof s.id === 'string' ? s.id : fail('A saved report has no identity.'), 'Original-practice reports', report);
    const keep = [];
    for (const session of candidates) sessionResolves(session) ? keep.push(session) : hold('history', 'A question family in this report is not in this release', session);
    if (keep.length > MAX_HISTORY_SESSIONS) fail('Original-practice reports exceed the 50-report limit.');
    if (keep.some(s => s.finishedAt == null)) fail('Original-practice reports include an unfinished session.');
    const clean = restoreHistory(JSON.stringify({ version: 1, sessions: keep }), now);
    if (!clean) fail('Original-practice reports failed validation (timing, answers or identities are inconsistent).');
    stores.history = clean;
  }
  if (included.has('session')) {
    let value = incoming.session;
    if (value === null && reentry.session.length) value = reentry.session.shift().record;
    for (const item of reentry.session) held.push(item);
    if (value === null) stores.session = null;
    else if (!sessionResolves(value)) { hold('session', 'A question family in this session is not in this release', value); stores.session = null; }
    else {
      const clean = restoreSession(JSON.stringify(value), now);
      if (!clean) fail('The active original-practice session failed validation.');
      stores.session = clean;
    }
  }
  if (included.has('bookmarks')) {
    const value = incoming.bookmarks;
    if (!Array.isArray(value)) fail('Saved questions in this backup are malformed.');
    const candidates = dedupe([...value, ...reentry.bookmarks.map(item => item.record)], originalId, 'Saved questions', report);
    const keep = [];
    for (const record of candidates) {
      if (Object.keys(record).some(key => !['templateId', 'seed'].includes(key))) fail('A saved question has unexpected fields.');
      resolvesOriginal(record) ? keep.push({ templateId: record.templateId, seed: record.seed }) : hold('bookmarks', 'Unknown original question family in this release', record);
    }
    if (keep.length > MAX_BOOKMARKS) fail('Saved questions exceed the 500-question limit.');
    stores.bookmarks = keep;
  }
  if (included.has('notebook')) {
    const value = incoming.notebook;
    if (!object(value) || value.version !== 1 || !Array.isArray(value.entries)) fail('The revision notebook in this backup is malformed.');
    const candidates = dedupe([...value.entries, ...reentry.notebook.map(item => item.record)], originalId, 'Revision notebook', report);
    const keep = [];
    for (const entry of candidates) resolvesOriginal(entry) ? keep.push(entry) : hold('notebook', 'Unknown original question family in this release', entry);
    if (keep.length > MAX_NOTEBOOK_ENTRIES) fail('The revision notebook exceeds its 1,000-entry limit.');
    const clean = restoreNotebook({ version: 1, entries: keep });
    if (!clean) fail(`The revision notebook failed validation (causes, notes up to ${MAX_NOTE_LENGTH} characters and resolution flags are checked).`);
    stores.notebook = clean;
  }
  if (included.has('goal')) {
    if (!DAILY_GOALS.includes(incoming.goal)) fail('The daily goal preference in this backup is invalid.');
    stores.goal = incoming.goal;
  }
  if (included.has('paperNotes')) {
    if (!validPaperNotes(incoming.paperNotes)) fail('Paper notes in this backup are malformed.');
    stores.paperNotes = clone(incoming.paperNotes);
    // Notes are the learner's own text: they are kept even when a paper record moved.
    if (archivePaperIds) report.unlinkedPaperNotes = Object.keys(stores.paperNotes).filter(id => !archivePaperIds.has(id));
  }
  if (included.has('pyq') || reentry['pyq-session'].length || reentry['pyq-workspace'].length) {
    const hasPYQ = (included.has('pyq') && incoming.pyq !== null) || reentry['pyq-session'].length || reentry['pyq-workspace'].length;
    if (hasPYQ && (!registry || typeof bankId !== 'string')) {
      const error = new Error('PYQ reports in this backup can only be checked after the reviewed question bank loads. Reconnect and try again; nothing was changed.');
      error.code = 'content-unavailable';
      throw error;
    }
    const sessions = [];
    const workspaces = [];
    if (included.has('pyq') && incoming.pyq !== null) {
      const value = incoming.pyq;
      if (!object(value) || value.version !== 1 || typeof value.bankId !== 'string' || !Array.isArray(value.history) || !own(value, 'active')) fail('PYQ data in this backup is malformed.');
      workspaces.push(value);
    }
    for (const item of reentry['pyq-workspace']) workspaces.push(item.record);
    for (const workspace of workspaces) {
      if (workspace.bankId !== bankId) { hold('pyq-workspace', `Recorded for reviewed bank ${String(workspace.bankId).slice(0, 100)}, not the installed bank`, workspace); continue; }
      if (!Array.isArray(workspace.history) || !own(workspace, 'active')) fail('PYQ data in this backup is malformed.');
      if (workspace.active !== null) sessions.push(workspace.active);
      sessions.push(...workspace.history);
    }
    for (const item of reentry['pyq-session']) sessions.push(item.record);
    const unique = dedupe(sessions, s => object(s) && typeof s.id === 'string' ? s.id : fail('A saved PYQ attempt has no identity.'), 'PYQ attempts', report);
    let active = null; const history = [];
    for (const session of unique) {
      if (!Array.isArray(session.questionIds)) fail('A saved PYQ attempt is malformed.');
      const resolves = session.questionIds.every(id => { try { registry.getQuestion(id); return true; } catch { return false; } })
        && (session.mode !== 'paper' || (() => { try { registry.getFullPaper(session.paperId); return true; } catch { return false; } })());
      if (!resolves) { hold('pyq-session', 'A question or paper in this attempt is not in the installed reviewed bank', session); continue; }
      const clean = restoreHistoricalSession(session, registry, bankId, now);
      if (!clean) fail('A saved PYQ attempt failed validation (responses, timing or identity are inconsistent).');
      // Keep the validated form: a timed attempt whose deadline passed after the
      // export is submitted at its own deadline and becomes a report.
      if (clean.finishedAt === null) {
        if (active) { report.notes.push('Two unfinished PYQ attempts were found; the later one is held, not discarded.'); hold('pyq-session', 'A second unfinished attempt', session); }
        else active = clean;
      } else {
        if (session.finishedAt === null) report.notes.push('An unfinished timed PYQ attempt reached its deadline after this backup was made; it is restored as submitted at that deadline.');
        history.push(clean);
      }
    }
    history.sort((a, b) => b.finishedAt - a.finishedAt);
    if (history.length > 20) fail('PYQ reports exceed the 20-report limit.');
    if (!workspaces.length && !sessions.length) stores.pyq = null;
    else {
      const clean = restoreHistoricalWorkspace(JSON.stringify({ version: 1, bankId, active, history }), registry, bankId, now);
      if (!clean) fail('PYQ data in this backup failed validation.');
      stores.pyq = clean;
    }
    if (!included.has('pyq')) delete stores.pyq;
  }
  for (const name of anyOriginal) if (!included.has(name)) for (const item of reentry[name]) held.push(item);
  if (included.has('unresolved') || held.length) {
    const unique = new Map(held.map(item => [JSON.stringify([item.store, item.record]), item]));
    if (unique.size > MAX_UNRESOLVED_ITEMS) fail('This backup holds more unresolved records than this release can keep.');
    stores.unresolved = { version: 1, items: [...unique.values()] };
  }
  report.unresolved = stores.unresolved?.items ?? [];
  for (const [name, value] of Object.entries(stores)) report.counts[name] = countRecords(name, value);
  return { source: parsed.source, kind: parsed.kind, exportedAt: parsed.exportedAt, included: Object.keys(stores), stores, preserved: parsed.preserved, report };
}

/** Records in one store, for previews and disclosures. */
export function countRecords(name, value) {
  if (value == null) return 0;
  if (name === 'progress') return value.records.length;
  if (name === 'history') return value.sessions.length;
  if (name === 'session') return 1;
  if (name === 'bookmarks') return value.length;
  if (name === 'notebook') return value.entries.length;
  if (name === 'goal') return 1;
  if (name === 'paperNotes') return Object.keys(value).length;
  if (name === 'pyq') return value.history.length + (value.active ? 1 : 0);
  if (name === 'unresolved') return value.items.length;
  return 0;
}

const byIdentity = value => `${value.templateId}:${value.seed}`;
/**
 * Combine validated stores. Merge never edits an existing record: on an
 * identity conflict the current browser's record wins, and size limits drop
 * the oldest reports. Every such effect is listed in `notes`.
 */
export function mergeWorkspace(current, incoming, { registry = null, bankId = null, now = Date.now() } = {}) {
  const out = clone(current), notes = [];
  if (incoming.progress) {
    const before = current.progress.records.length;
    out.progress = importProgress(JSON.stringify(incoming.progress), current.progress, now);
    const kept = out.progress.records.length;
    const keys = new Set(current.progress.records.map(byIdentity));
    const overlap = incoming.progress.records.filter(r => keys.has(byIdentity(r))).length;
    if (overlap) notes.push(`${overlap} first attempt${overlap === 1 ? '' : 's'} existed on both sides; the earlier attempt is kept as the first attempt.`);
    if (before + incoming.progress.records.length - overlap > kept) notes.push(`${before + incoming.progress.records.length - overlap - kept} oldest first attempts exceed the 1,000-record limit and are not kept.`);
  }
  if (incoming.history) {
    const ids = new Set(current.history.sessions.map(s => s.id));
    const added = incoming.history.sessions.filter(s => !ids.has(s.id));
    const all = [...current.history.sessions, ...added].sort((a, b) => b.finishedAt - a.finishedAt || b.startedAt - a.startedAt || a.id.localeCompare(b.id));
    out.history = { version: 1, sessions: all.slice(0, MAX_HISTORY_SESSIONS) };
    if (all.length > MAX_HISTORY_SESSIONS) notes.push(`${all.length - MAX_HISTORY_SESSIONS} oldest original-practice reports exceed the 50-report limit and are not kept.`);
  }
  if (own(incoming, 'session') && incoming.session) {
    if (!current.session) out.session = incoming.session;
    else if (current.session.id !== incoming.session.id) notes.push('This browser already has an active original-practice session, so the backup’s active session is not merged.');
  }
  if (incoming.bookmarks) {
    const keys = new Set(current.bookmarks.map(byIdentity));
    const all = [...current.bookmarks, ...incoming.bookmarks.filter(b => !keys.has(byIdentity(b)))];
    out.bookmarks = all.slice(-MAX_BOOKMARKS);
    if (all.length > MAX_BOOKMARKS) notes.push(`${all.length - MAX_BOOKMARKS} earliest saved questions exceed the 500-question limit and are not kept.`);
  }
  if (incoming.notebook) {
    const keys = new Set(current.notebook.entries.map(byIdentity));
    const conflicts = incoming.notebook.entries.filter(e => keys.has(byIdentity(e)) && JSON.stringify(e) !== JSON.stringify(current.notebook.entries.find(c => byIdentity(c) === byIdentity(e)))).length;
    const added = incoming.notebook.entries.filter(e => !keys.has(byIdentity(e)));
    const room = Math.max(0, MAX_NOTEBOOK_ENTRIES - current.notebook.entries.length);
    out.notebook = { version: 1, entries: [...current.notebook.entries, ...added.slice(0, room)] };
    if (conflicts) notes.push(`${conflicts} revision note${conflicts === 1 ? '' : 's'} differ between this browser and the backup; this browser’s notes are kept.`);
    if (added.length > room) notes.push(`${added.length - room} backup revision notes exceed the 1,000-entry limit and are not kept.`);
  }
  if (own(incoming, 'goal') && incoming.goal !== current.goal) notes.push('This browser’s daily goal is kept.');
  if (incoming.paperNotes) {
    const conflicts = Object.keys(incoming.paperNotes).filter(id => own(current.paperNotes, id) && JSON.stringify(current.paperNotes[id]) !== JSON.stringify(incoming.paperNotes[id]));
    out.paperNotes = { ...clone(incoming.paperNotes), ...clone(current.paperNotes) };
    if (Object.keys(out.paperNotes).length > MAX_PAPER_NOTES) fail('Merged paper notes would exceed the 1,000-paper limit. Choose replace instead, or remove notes first.');
    if (conflicts.length) notes.push(`${conflicts.length} paper note${conflicts.length === 1 ? '' : 's'} differ; this browser’s notes are kept.`);
  }
  if (own(incoming, 'pyq') && incoming.pyq) {
    if (!current.pyq) out.pyq = incoming.pyq;
    else {
      const ids = new Set(current.pyq.history.map(s => s.id));
      const all = [...current.pyq.history, ...incoming.pyq.history.filter(s => !ids.has(s.id) && s.id !== current.pyq.active?.id)].sort((a, b) => b.finishedAt - a.finishedAt);
      let active = current.pyq.active;
      if (!active && incoming.pyq.active && !ids.has(incoming.pyq.active.id)) active = incoming.pyq.active;
      else if (incoming.pyq.active && incoming.pyq.active.id !== current.pyq.active?.id) notes.push('This browser already has an unfinished PYQ attempt, so the backup’s unfinished attempt is not merged.');
      const candidate = { version: 1, bankId: current.pyq.bankId, active, history: all.slice(0, 20) };
      out.pyq = registry ? restoreHistoricalWorkspace(JSON.stringify(candidate), registry, bankId, now) ?? fail('Merged PYQ data failed validation.') : candidate;
      if (all.length > 20) notes.push(`${all.length - 20} oldest PYQ reports exceed the 20-report limit and are not kept.`);
    }
  }
  if (incoming.unresolved) {
    const unique = new Map([...current.unresolved.items, ...incoming.unresolved.items].map(item => [JSON.stringify([item.store, item.record]), item]));
    if (unique.size > MAX_UNRESOLVED_ITEMS) fail('Too many held unresolved records to merge.');
    out.unresolved = { version: 1, items: [...unique.values()] };
  }
  return { stores: out, notes };
}

/** Replace exactly the stores the backup includes. Older single-store backups leave the rest untouched. */
export function replaceWorkspace(current, incoming) {
  const out = clone(current);
  for (const name of Object.keys(incoming)) out[name] = clone(incoming[name]);
  return { stores: out, notes: [] };
}

/**
 * Write changed stores as one unit. The pre-restore copy is written first; if
 * that fails nothing else is touched. If any store write fails, every store
 * already written is returned to its exact previous bytes.
 */
export function writeWorkspaceStores(storage, stores, { names = STORE_NAMES, preRestore = null } = {}) {
  const keys = names.map(name => storageKey(BACKUP_STORES.find(store => store.name === name).slot));
  const previous = new Map();
  try { for (const key of keys) previous.set(key, storage.getItem(key)); }
  catch { fail('Browser storage could not be read. Nothing was changed.'); }
  if (preRestore !== null) {
    try { storage.setItem(storageKey(PRE_RESTORE_SLOT), JSON.stringify(preRestore)); }
    catch { fail('There was not enough browser storage to keep a pre-restore copy, so nothing was restored. Export your current workspace, free space, and try again.'); }
  }
  const written = [];
  try {
    names.forEach((name, index) => {
      const key = keys[index], value = stores[name];
      const empty = value === null || (name === 'unresolved' && !value.items.length);
      written.push(key);
      if (empty) storage.removeItem(key); else storage.setItem(key, JSON.stringify(value));
    });
  } catch {
    let rolledBack = true;
    for (const key of written.reverse()) {
      try { const old = previous.get(key); if (old === null) storage.removeItem(key); else storage.setItem(key, old); }
      catch { rolledBack = false; }
    }
    fail(rolledBack
      ? 'The browser refused to save the restored workspace (storage may be full). Every store was returned to its previous saved state.'
      : 'The browser refused to save the restored workspace and could not fully undo the partial write. Download the pre-restore copy now; it holds your previous workspace.');
  }
}
