import { createHistoricalSession, finishHistorical, gradeHistorical, restoreHistoricalSession, restoreHistoricalWorkspace, saveHistoricalSession, visitHistorical } from './session.js';

/**
 * Source-backed two-paper exam sessions.
 *
 * A configuration names the two reviewed papers of one year and the official
 * same-day schedule recorded by that year's Joint Implementation Committee
 * (JIC) report. Paper durations and the inter-paper break are derived from the
 * recorded clock times and must agree with each paper's reviewed duration.
 * Each paper keeps its own instructions, sections and marking from the
 * reviewed paper configuration; nothing here defines a scoring rule.
 *
 * Years without a configuration are unavailable. There is no universal JEE
 * timetable: a new year needs its own evidence.
 */
export const EXAM_CONFIG_VERSION = 1;
export const MAX_EXAM_HISTORY = 10;
const REVIEW = Object.freeze({ reviewer: 'Claude (AI-assisted source check of the official JIC report; not human review)', reviewedAt: '2026-11-19' });
const config = (year, date, page, sha256, method = 'PDF text extraction') => Object.freeze({
  id: `jee-advanced-${year}-two-paper-v1`, version: EXAM_CONFIG_VERSION, year,
  paperIds: Object.freeze([`official-${year}-paper-1-en`, `official-${year}-paper-2-en`]),
  schedule: Object.freeze({ date, timeZone: 'IST', papers: Object.freeze([Object.freeze({ start: '09:00', end: '12:00' }), Object.freeze({ start: '14:30', end: '17:30' })]) }),
  source: Object.freeze({ title: `JEE (Advanced) ${year} Joint Implementation Committee Report · Important Dates`, url: `https://jeeadv.ac.in/reports/${year}.pdf`, page, sha256, method, quoted: 'Paper 1: 09:00-12:00 IST; Paper 2: 14:30-17:30 IST' }),
  review: REVIEW,
});
export const EXAM_CONFIGS = Object.freeze([
  config(2022, '2022-08-28', 9, 'e29583466902cf46e27cb7286028c474fd2818b2194892499a38c13b6c62e6be'),
  config(2023, '2023-06-04', 9, '793a7350d9640dba44c56a8df97a0e7fa8037316986e01e8690412917f2d9ab3'),
  // The 2024 report prints its Important Dates table as an image; it was read with on-device OCR.
  config(2024, '2024-05-26', 10, '7247ffa2a08fb153de87f9ce87a561d95610c7ab3e43d3a561f87d4f32bcf395', 'OCR of the Important Dates table image'),
  config(2025, '2025-05-18', 10, '90363cf921ca96c8242f73ce6997ff017a7ffe578b6c0ac917239a5830e5ef7f'),
  config(2026, '2026-05-17', 10, '012452ffede297563cdca0548ed748509a4597b187b72e854552ce3921f02345'),
]);

const minutes = clock => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock); if (!m) throw new Error('Invalid schedule time'); return Number(m[1]) * 60 + Number(m[2]); };
const validTime = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Resolve a configuration against the installed registry. Throws with the
 * learner-facing reason it is unavailable. The break is the scheduled gap
 * between Paper 1's end and Paper 2's start; it never belongs to a paper.
 */
export function resolveExamConfig(configuration, registry) {
  if (!object(configuration) || configuration.version !== EXAM_CONFIG_VERSION || configuration.paperIds?.length !== 2) throw new Error('Unsupported exam session configuration.');
  const papers = configuration.paperIds.map((id, index) => {
    let paper;
    try { paper = registry.getFullPaper(id); } catch { throw new Error(`Paper ${index + 1} of ${configuration.year} is not a complete reviewed paper in this release.`); }
    if (paper.year !== configuration.year || paper.paper !== index + 1) throw new Error(`The configured Paper ${index + 1} does not belong to ${configuration.year}.`);
    return paper;
  });
  const slots = configuration.schedule.papers.map(slot => ({ start: minutes(slot.start), end: minutes(slot.end) }));
  slots.forEach((slot, index) => {
    if (slot.end - slot.start !== papers[index].durationMinutes) throw new Error(`The recorded schedule for Paper ${index + 1} does not match its reviewed ${papers[index].durationMinutes}-minute duration.`);
  });
  const breakMinutes = slots[1].start - slots[0].end;
  if (breakMinutes <= 0) throw new Error('The recorded papers overlap; no inter-paper break can be derived.');
  return Object.freeze({ config: configuration, papers, breakMinutes, maxMarks: papers.reduce((sum, paper) => sum + paper.maxMarks, 0) });
}

/** One row per playable year; years without evidence stay unavailable with a reason. */
export function examAvailability(registry, configs = EXAM_CONFIGS) {
  const years = [...new Set(registry.listPapers().map(paper => paper.year))].sort((a, b) => b - a);
  return years.map(year => {
    const configuration = configs.find(item => item.year === year);
    if (!configuration) return { year, available: false, reason: `No source-backed two-paper schedule is recorded for ${year}. Each paper remains available on its own.` };
    try { return { year, available: true, ...resolveExamConfig(configuration, registry) }; }
    catch (error) { return { year, available: false, reason: error.message, config: configuration }; }
  });
}
export function getExamConfig(id, configs = EXAM_CONFIGS) {
  const found = configs.find(item => item.id === id);
  if (!found) throw new Error('This exam session configuration is not available in this release.');
  return found;
}

export const examInProgress = workspace => !!workspace?.exam;
const withVersion = workspace => ({ ...workspace, version: workspace.exam || workspace.exams?.length ? 2 : 1 });

/** Start Paper 1. The exam clock is Paper 1's own clock; no other attempt may be active. */
export function startExam(workspace, registry, configId, { seed, now = Date.now(), configs = EXAM_CONFIGS } = {}) {
  if (workspace.active || workspace.exam) throw new Error('Finish or end the current attempt before starting a two-paper exam.');
  const resolved = resolveExamConfig(getExamConfig(configId, configs), registry);
  let paper = createHistoricalSession(registry, { paperId: resolved.config.paperIds[0], bankId: workspace.bankId, seed, now });
  paper = visitHistorical(paper, 0, now);
  const exam = { version: 1, id: `exam-${now}-${seed}`, configId, bankId: workspace.bankId, seed, startedAt: now, phase: 'paper1', papers: [null, null], activeSessionId: paper.id, breakStartedAt: null, breakEndedAt: null, finishedAt: null };
  return withVersion({ ...saveHistoricalSession({ exams: [], ...workspace }, paper), exam });
}

const record = (workspace, exam) => withVersion({ ...workspace, exam: null, exams: [exam, ...(workspace.exams ?? []).filter(e => e.id !== exam.id)].slice(0, MAX_EXAM_HISTORY) });

/**
 * Derive the next phase from the stored paper attempts. A paper submitted or
 * expired (even while the tab was closed) ends at its own finish time, and the
 * break starts exactly then. Idempotent; safe after every save and on reload.
 */
export function advanceExam(workspace) {
  const exam = workspace.exam;
  if (!exam || !['paper1', 'paper2'].includes(exam.phase)) return workspace;
  if (workspace.active?.id === exam.activeSessionId) return workspace;
  const finished = workspace.history.find(session => session.id === exam.activeSessionId);
  if (!finished) throw new Error('The current exam paper is missing from this workspace.');
  if (exam.phase === 'paper1') return withVersion({ ...workspace, exam: { ...exam, phase: 'break', papers: [finished, null], activeSessionId: null, breakStartedAt: finished.finishedAt } });
  return record(workspace, { ...exam, phase: 'complete', papers: [exam.papers[0], finished], activeSessionId: null, finishedAt: finished.finishedAt });
}

/** End the break. Paper 2's full duration starts now, never earlier. */
export function startSecondPaper(workspace, registry, { seed, now = Date.now(), configs = EXAM_CONFIGS } = {}) {
  const exam = workspace.exam;
  if (!exam || exam.phase !== 'break') throw new Error('Paper 2 can start only from the inter-paper break.');
  if (workspace.active) throw new Error('Another attempt is active.');
  if (!validTime(now) || now < exam.breakStartedAt) throw new Error('Paper 2 cannot start before the break begins.');
  const resolved = resolveExamConfig(getExamConfig(exam.configId, configs), registry);
  let paper = createHistoricalSession(registry, { paperId: resolved.config.paperIds[1], bankId: workspace.bankId, seed, now });
  paper = visitHistorical(paper, 0, now);
  return withVersion({ ...saveHistoricalSession(workspace, paper), exam: { ...exam, phase: 'paper2', activeSessionId: paper.id, breakEndedAt: now } });
}

/** End early. The paper on screen is submitted now; a paper never started stays unattempted. */
export function cancelExam(workspace, now = Date.now()) {
  const exam = workspace.exam;
  if (!exam) throw new Error('No exam is in progress.');
  let next = workspace, papers = [...exam.papers];
  if (workspace.active && workspace.active.id === exam.activeSessionId) {
    const finished = finishHistorical(workspace.active, now);
    next = saveHistoricalSession(workspace, finished);
    papers[exam.phase === 'paper1' ? 0 : 1] = finished;
  }
  const endedAt = Math.max(now, ...papers.filter(Boolean).map(p => p.finishedAt));
  return record(next, { ...exam, phase: 'cancelled', papers, activeSessionId: null, breakEndedAt: exam.phase === 'break' ? null : exam.breakEndedAt, finishedAt: endedAt });
}

/** Per-paper results and their combined total, all regraded from reviewed keys. */
export function examReport(exam, registry, configs = EXAM_CONFIGS) {
  const configuration = getExamConfig(exam.configId, configs);
  const papers = configuration.paperIds.map((paperId, index) => {
    const session = exam.papers[index];
    const paper = registry.getFullPaper(paperId);
    if (!session) return { index, paperId, paper, session: null, report: null, status: 'not attempted', maxScore: paper.maxMarks };
    const report = gradeHistorical(session, registry);
    return { index, paperId, paper, session, report, status: 'completed', score: report.score, maxScore: report.maxScore };
  });
  const attempted = papers.filter(p => p.report);
  const subjects = ['physics', 'chemistry', 'mathematics'].map(subject => {
    const rows = attempted.map(p => p.report.subjects.find(s => s.subject === subject)).filter(Boolean);
    return { subject, score: rows.reduce((n, s) => n + s.score, 0), maxScore: rows.reduce((n, s) => n + s.maxScore, 0), byPaper: papers.map(p => p.report?.subjects.find(s => s.subject === subject) ?? null) };
  }).filter(s => s.maxScore);
  const breakMs = exam.breakStartedAt !== null && exam.breakEndedAt !== null ? exam.breakEndedAt - exam.breakStartedAt : null;
  return {
    exam, config: configuration, papers, subjects, complete: exam.phase === 'complete',
    combined: { score: attempted.reduce((n, p) => n + p.report.score, 0), maxScore: attempted.reduce((n, p) => n + p.report.maxScore, 0), fullMaxScore: papers.reduce((n, p) => n + p.maxScore, 0), papersIncluded: attempted.length },
    breakMs, scheduledBreakMs: resolveExamConfig(configuration, registry).breakMinutes * 60000,
  };
}

function validExam(v, workspace, registry, bankId, now, configs) {
  if (!object(v) || v.version !== 1 || v.bankId !== bankId || typeof v.id !== 'string' || v.id !== `exam-${v.startedAt}-${v.seed}` || !validTime(v.startedAt) || v.startedAt > now + 60000) return null;
  if (!['paper1', 'break', 'paper2', 'complete', 'cancelled'].includes(v.phase) || !Array.isArray(v.papers) || v.papers.length !== 2) return null;
  let configuration;
  try { configuration = getExamConfig(v.configId, configs); resolveExamConfig(configuration, registry); } catch { return null; }
  const papers = v.papers.map((paper, index) => {
    if (paper === null) return null;
    const clean = restoreHistoricalSession(paper, registry, bankId, now);
    return clean && clean.finishedAt !== null && clean.mode === 'paper' && clean.paperId === configuration.paperIds[index] ? clean : undefined;
  });
  if (papers.includes(undefined)) return null;
  const time = value => value === null || validTime(value);
  if (![v.breakStartedAt, v.breakEndedAt, v.finishedAt].every(time)) return null;
  const active = workspace.active, current = v.activeSessionId;
  const inPlay = id => active?.id === id || workspace.history.some(s => s.id === id);
  const sessionFor = id => active?.id === id ? active : workspace.history.find(s => s.id === id);
  if (v.phase === 'paper1') {
    const p = sessionFor(current);
    if (papers[0] || papers[1] || !p || p.paperId !== configuration.paperIds[0] || p.startedAt !== v.startedAt || v.breakStartedAt !== null) return null;
  } else if (v.phase === 'break') {
    if (!papers[0] || papers[1] || current !== null || active || v.breakStartedAt !== papers[0].finishedAt || v.breakEndedAt !== null) return null;
  } else if (v.phase === 'paper2') {
    const p = sessionFor(current);
    if (!papers[0] || papers[1] || !p || p.paperId !== configuration.paperIds[1] || v.breakStartedAt !== papers[0].finishedAt || p.startedAt !== v.breakEndedAt || v.breakEndedAt < v.breakStartedAt) return null;
  } else {
    if (current !== null || !validTime(v.finishedAt)) return null;
    if (v.phase === 'complete' && (!papers[0] || !papers[1] || v.finishedAt !== papers[1].finishedAt)) return null;
  }
  if (['paper1', 'paper2'].includes(v.phase) && !inPlay(current)) return null;
  if (papers[0] && papers[0].startedAt !== v.startedAt) return null;
  if (papers[1] && (v.breakEndedAt === null || papers[1].startedAt !== v.breakEndedAt)) return null;
  return { version: 1, id: v.id, configId: v.configId, bankId, seed: v.seed, startedAt: v.startedAt, phase: v.phase, papers, activeSessionId: current ?? null, breakStartedAt: v.breakStartedAt, breakEndedAt: v.breakEndedAt, finishedAt: v.finishedAt };
}

/**
 * Restore a PYQ workspace including its exam state. Version 1 (no exam fields)
 * remains valid; version 2 adds `exam` and `exams`. An expired paper is
 * submitted at its own deadline and the break begins exactly then, so a reload
 * neither grants time nor charges the break to a paper.
 */
export function restoreExamWorkspace(raw, registry, bankId, now = Date.now(), configs = EXAM_CONFIGS) {
  if (typeof raw !== 'string' || raw.length > 4000000) return null;
  try {
    const v = JSON.parse(raw);
    if (!object(v) || ![1, 2].includes(v.version)) return null;
    // Version 1 may carry the empty exam fields, which older releases ignore.
    if (v.version === 1 && ((v.exam ?? null) !== null || (v.exams ?? []).length)) return null;
    const { exam = null, exams = [], ...rest } = v;
    // A paper attempt already moved to history by an older save still validates.
    const base = restoreHistoricalWorkspace(JSON.stringify({ ...rest, version: 1 }), registry, bankId, now);
    if (!base) return null;
    if (!Array.isArray(exams) || exams.length > MAX_EXAM_HISTORY) return null;
    const cleanExams = exams.map(e => validExam(e, { active: null, history: [] }, registry, bankId, now, configs));
    if (cleanExams.some(e => !e || !['complete', 'cancelled'].includes(e.phase)) || new Set(cleanExams.map(e => e.id)).size !== cleanExams.length) return null;
    let workspace = { ...base, exam: null, exams: cleanExams };
    if (exam !== null) {
      const clean = validExam(exam, workspace, registry, bankId, now, configs);
      if (!clean || ['complete', 'cancelled'].includes(clean.phase) || cleanExams.some(e => e.id === clean.id)) return null;
      workspace = advanceExam({ ...workspace, exam: clean });
    }
    if (workspace.exam && workspace.active && workspace.active.id !== workspace.exam.activeSessionId) return null;
    return withVersion(workspace);
  } catch { return null; }
}
