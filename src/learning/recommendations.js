import { CHAPTERS, generate, listTemplates } from '../questions/index.js';
import { gradeQuestion } from '../questions/grading.js';
import { validResponse } from '../practice/session.js';
import { gradeContentQuestion } from '../content/catalog.js';
import { TOPIC_RELATIONS, prerequisitesOf } from './topic-relations.js';
import { emptyRevisionPlan, restoreRevisionPlan } from './revision-plan.js';

/**
 * Explainable revision suggestions from evidence retained in this browser.
 *
 * Evidence kinds stay separate and are never combined into one score:
 *  - `original`: first attempts at Vedaris original-practice questions
 *    (progress.js keeps the earliest attempt for each templateId:seed, up to
 *    1,000 records), with notebook resolution decisions;
 *  - `pyq`: the first retained attempt at each historical question ID across
 *    the saved PYQ reports (the PYQ workspace keeps its latest 20 reports).
 * Retries never replace a first attempt. Evidence that has aged out of those
 * stores, been deleted, or belongs to content this version no longer serves is
 * not reconstructed; unknown identities are counted as ignored instead.
 *
 * Output is ordering for study, not a mastery estimate, rank, percentile or
 * prediction. Suggestions are ordered by the count of open incorrect or
 * partial first attempts of both kinds, then by the most recent miss; the UI
 * states this rule. The learner decides what to practise; nothing starts here.
 */
export const MIN_CHAPTER_EVIDENCE = 3;
export const MIN_TOTAL_EVIDENCE = 5;
const EXAMPLES = 3;
const chapterInfo = new Map(CHAPTERS.map((chapter, index) => [chapter.id, { ...chapter, order: index }]));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const day = time => new Date(time).toISOString().slice(0, 10);
const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`;

function blank() {
  return { attempts: 0, correct: 0, incorrect: 0, partial: 0, open: 0, resolved: 0, latestMissAt: null, examples: [] };
}
function bucket(map, chapter) {
  if (!map.has(chapter)) map.set(chapter, { original: blank(), pyq: blank() });
  return map.get(chapter);
}

function notebookDecisions(notebook, ignored) {
  const decisions = new Map();
  const entries = object(notebook) && Array.isArray(notebook.entries) ? notebook.entries.slice(0, 1000) : [];
  for (const entry of entries) {
    try {
      const item = generate(entry.templateId, entry.seed);
      decisions.set(item.id, { resolved: entry.resolved === true, cause: typeof entry.cause === 'string' ? entry.cause : 'unclassified' });
    } catch { ignored.notebookEntries++; }
  }
  return decisions;
}

function originalEvidence(progress, decisions, chapters, ignored, now) {
  const earliest = new Map();
  const records = object(progress) && Array.isArray(progress.records) ? progress.records.slice(0, 1000) : [];
  for (const record of records) {
    try {
      if (!object(record) || !Number.isSafeInteger(record.answeredAt) || record.answeredAt <= 0 || record.answeredAt > now + 60000) throw new Error('Invalid record');
      const item = generate(record.templateId, record.seed);
      if (!validResponse(item, record.response)) throw new Error('Invalid response');
      const grade = gradeQuestion(item, record.response);
      if (grade.status === 'skipped') throw new Error('Not an attempt');
      const previous = earliest.get(item.id);
      if (!previous || record.answeredAt < previous.answeredAt) earliest.set(item.id, { item, status: grade.status, answeredAt: record.answeredAt });
    } catch { ignored.originalRecords++; }
  }
  for (const row of earliest.values()) {
    if (!chapterInfo.has(row.item.chapter)) { ignored.unknownChapters++; continue; }
    const value = bucket(chapters, row.item.chapter).original;
    value.attempts++;
    value[row.status]++;
    if (row.status === 'incorrect' || row.status === 'partial') {
      const decision = decisions.get(row.item.id);
      if (decision?.resolved) value.resolved++;
      else {
        value.open++;
        value.latestMissAt = Math.max(value.latestMissAt ?? 0, row.answeredAt);
        value.examples.push({ id: row.item.id, templateId: row.item.templateId, seed: row.item.seed, status: row.status, answeredAt: row.answeredAt, cause: decision?.cause ?? null });
      }
    }
  }
  return earliest.size;
}

function pyqEvidence(sessions, registry, bankId, chapters, ignored) {
  if (!registry || typeof registry.getQuestion !== 'function') return { loaded: false, attempts: 0 };
  const earliest = new Map();
  const list = Array.isArray(sessions) ? sessions.slice(0, 20) : [];
  for (const session of list) {
    if (!object(session) || !Number.isSafeInteger(session.finishedAt) || !Array.isArray(session.questionIds) || !Array.isArray(session.responses) || session.questionIds.length !== session.responses.length || (bankId && session.bankId !== bankId)) { ignored.pyqSessions++; continue; }
    session.questionIds.forEach((id, index) => {
      try {
        const item = registry.getQuestion(id);
        const grade = gradeContentQuestion(item, session.responses[index]);
        if (grade.status === 'skipped' || grade.status === 'bonus') return;
        const previous = earliest.get(item.id);
        if (!previous || session.finishedAt < previous.answeredAt) earliest.set(item.id, { item, status: grade.status, answeredAt: session.finishedAt });
      } catch { ignored.pyqQuestions++; }
    });
  }
  for (const row of earliest.values()) {
    const tagged = (Array.isArray(row.item.chapters) ? row.item.chapters : [row.item.chapter]).filter(id => {
      if (chapterInfo.has(id)) return true;
      ignored.unknownChapters++;
      return false;
    });
    for (const chapter of tagged) {
      const value = bucket(chapters, chapter).pyq;
      value.attempts++;
      value[row.status]++;
      if (row.status === 'incorrect' || row.status === 'partial') {
        value.open++;
        value.latestMissAt = Math.max(value.latestMissAt ?? 0, row.answeredAt);
        value.examples.push({ id: row.item.id, status: row.status, answeredAt: row.answeredAt });
      }
    }
  }
  return { loaded: true, attempts: earliest.size };
}

const newestFirst = (a, b) => b.answeredAt - a.answeredAt || a.id.localeCompare(b.id);
function evidenceSentence(kind, value) {
  const label = kind === 'original' ? 'Original practice' : 'Historical PYQ';
  const store = kind === 'original' ? 'retained first attempts' : 'retained first attempts in your saved PYQ reports';
  if (!value.attempts) return null;
  const misses = [value.incorrect && `${value.incorrect} incorrect`, value.partial && `${value.partial} partial`].filter(Boolean).join(' and ');
  const examples = value.examples.slice().sort(newestFirst).slice(0, EXAMPLES).map(row => `${row.id} ${row.status} on ${day(row.answeredAt)}${row.cause && row.cause !== 'unclassified' ? ` (your note: ${row.cause})` : ''}`);
  let sentence = `${label}: ${misses || 'none incorrect or partial'} out of ${value.attempts} ${store}.`;
  if (examples.length) sentence += ` Examples: ${examples.join('; ')}.`;
  if (value.resolved) sentence += ` You marked ${value.resolved} of these resolved in your notebook; they are not counted as open.`;
  return sentence;
}

function summary(value) {
  return { attempts: value.attempts, correct: value.correct, incorrect: value.incorrect, partial: value.partial, open: value.open, resolved: value.resolved, latestMissAt: value.latestMissAt, examples: value.examples.slice().sort(newestFirst).slice(0, EXAMPLES) };
}
export function evidenceSignature(entry) {
  const o = entry?.original ?? blank(), p = entry?.pyq ?? blank();
  return `o${o.attempts}/${o.open}/${o.resolved}|p${p.attempts}/${p.open}`;
}

/**
 * @param {object} input
 * @param {object} [input.progress] original-practice first-attempt store (progress.js shape)
 * @param {object} [input.notebook] notebook annotations (notebook.js shape)
 * @param {object} [input.plan] revision plan (revision-plan.js shape)
 * @param {object[]} [input.pyqSessions] completed PYQ reports (content/session.js shape)
 * @param {object} [input.registry] loaded PYQ registry; omitted means PYQ evidence is not loaded
 * @param {string} [input.bankId] current PYQ bank identity
 * @param {object} [input.chapterCounts] published PYQ counts by chapter, or null if unknown
 */
export function revisionRecommendations({ progress = null, notebook = null, plan = emptyRevisionPlan(), pyqSessions = [], registry = null, bankId = null, chapterCounts = null, relations = TOPIC_RELATIONS, now = Date.now() } = {}) {
  const ignored = { originalRecords: 0, notebookEntries: 0, pyqSessions: 0, pyqQuestions: 0, unknownChapters: 0, planChapters: 0 };
  const cleanPlan = restoreRevisionPlan(plan, now);
  const planError = plan !== null && plan !== undefined && cleanPlan === null;
  const usablePlan = cleanPlan ?? emptyRevisionPlan();
  const chapters = new Map();
  const decisions = notebookDecisions(notebook, ignored);
  const originalAttempts = originalEvidence(progress, decisions, chapters, ignored, now);
  const pyq = pyqEvidence(pyqSessions, registry, bankId, chapters, ignored);
  const totalAttempts = originalAttempts + pyq.attempts;

  const goals = usablePlan.goals.filter(goal => {
    if (chapterInfo.has(goal.chapter)) return true;
    ignored.planChapters++;
    return false;
  });
  const goalSet = new Set(goals.map(goal => goal.chapter));
  const dismissals = new Map(usablePlan.dismissed.map(entry => [entry.chapter, entry]));

  const practice = id => {
    const original = listTemplates({ chapter: id }).length;
    const published = object(chapterCounts) ? (Number.isSafeInteger(chapterCounts[id]) ? chapterCounts[id] : 0) : null;
    return { originalFamilies: original, pyqQuestions: published, available: original > 0 || (published ?? 0) > 0, pyqCountKnown: published !== null };
  };

  function prerequisites(id) {
    return prerequisitesOf(id, relations).map(edge => {
      const info = chapterInfo.get(edge.from);
      const entry = chapters.get(edge.from);
      const o = entry?.original ?? blank(), p = entry?.pyq ?? blank();
      const parts = [];
      if (o.attempts) parts.push(`original practice ${o.open} open of ${o.attempts} retained first attempts`);
      if (p.attempts) parts.push(`historical PYQ ${p.open} incorrect or partial of ${p.attempts} retained first attempts`);
      return { chapter: edge.from, title: info.title, subject: info.subject, rationale: edge.rationale, reviewStatus: edge.review.status, openMisses: { original: o.open, pyq: p.open }, evidence: parts.length ? `Your evidence: ${parts.join('; ')}.` : 'No retained attempts in this chapter.', practice: practice(edge.from) };
    });
  }

  function build(id, kind) {
    const info = chapterInfo.get(id);
    const entry = chapters.get(id) ?? { original: blank(), pyq: blank() };
    const attempts = entry.original.attempts + entry.pyq.attempts;
    const evidenceLevel = attempts >= MIN_CHAPTER_EVIDENCE ? 'sufficient' : attempts ? 'limited' : 'none';
    const reasons = [];
    const goal = goals.find(value => value.chapter === id);
    if (goal) reasons.push({ kind: 'goal', text: `You added this chapter as a revision goal on ${day(goal.addedAt)}.` });
    const originalText = evidenceSentence('original', entry.original);
    if (originalText) reasons.push({ kind: 'original', text: originalText });
    const pyqText = evidenceSentence('pyq', entry.pyq);
    if (pyqText) reasons.push({ kind: 'pyq', text: pyqText });
    if (evidenceLevel === 'none') reasons.push({ kind: 'sparse', text: pyq.loaded ? 'No retained attempts in this chapter yet, so this suggestion rests only on your goal.' : 'No retained original-practice attempts in this chapter yet. Saved PYQ reports have not been loaded.' });
    else if (evidenceLevel === 'limited') reasons.push({ kind: 'sparse', text: `Only ${plural(attempts, 'retained attempt')} in this chapter: too few to suggest a priority on their own.` });
    const available = practice(id);
    if (!available.available) reasons.push({ kind: 'content', text: available.pyqCountKnown ? 'No original-practice family or published PYQ is available for this chapter yet. Use the paper sources or your own material.' : 'No original-practice family is available for this chapter yet, and the PYQ catalog has not loaded.' });
    const signature = evidenceSignature(entry);
    const dismissal = dismissals.get(id);
    return {
      chapter: id, title: info.title, subject: info.subject, kind, evidenceLevel, reasons,
      evidence: { original: summary(entry.original), pyq: summary(entry.pyq) },
      prerequisites: prerequisites(id), relationsStatus: relations.reviewStatus,
      practice: available, signature,
      dismissed: kind === 'evidence' && dismissal?.signature === signature,
    };
  }

  const items = goals.map(goal => build(goal.chapter, 'goal'));
  const candidates = [...chapters.entries()].filter(([id, entry]) => !goalSet.has(id) && entry.original.open + entry.pyq.open > 0).map(([id]) => build(id, 'evidence'));
  const order = (a, b) => (b.evidence.original.open + b.evidence.pyq.open) - (a.evidence.original.open + a.evidence.pyq.open)
    || Math.max(b.evidence.original.latestMissAt ?? 0, b.evidence.pyq.latestMissAt ?? 0) - Math.max(a.evidence.original.latestMissAt ?? 0, a.evidence.pyq.latestMissAt ?? 0)
    || chapterInfo.get(a.chapter).order - chapterInfo.get(b.chapter).order;
  const sufficient = candidates.filter(item => item.evidenceLevel === 'sufficient').sort(order);
  const limited = candidates.filter(item => item.evidenceLevel !== 'sufficient').sort(order);

  const state = totalAttempts === 0 && !goals.length ? 'empty' : totalAttempts < MIN_TOTAL_EVIDENCE ? 'sparse' : 'ready';
  return {
    state,
    message: state === 'empty' ? 'No retained attempts or revision goals yet. Finish a practice session or add a goal to get suggestions.'
      : state === 'sparse' ? `Only ${plural(totalAttempts, 'retained attempt')} so far. That is not enough evidence to rank chapters, so only your goals and clearly limited observations are shown.`
        : `${plural(totalAttempts, 'retained first attempt')} considered.`,
    recommendations: [...items, ...(state === 'ready' ? sufficient.filter(item => !item.dismissed) : [])],
    limited: state === 'ready' ? limited.filter(item => !item.dismissed) : [...sufficient, ...limited].filter(item => !item.dismissed),
    dismissed: [...sufficient, ...limited].filter(item => item.dismissed),
    evidence: { originalAttempts, pyqAttempts: pyq.attempts, pyqLoaded: pyq.loaded, totalAttempts },
    ignored, planError,
    relations: { status: relations.reviewStatus, notice: relations.notice },
  };
}
