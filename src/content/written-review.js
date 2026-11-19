import { isReviewDate, isWebUrl, validateArchive } from '../archive/index.js';

/**
 * Source-backed review of historical written-answer (subjective) questions.
 *
 * This engine never decides whether a derivation is correct. Marks exist only
 * when a learner (self review) or a named expert records them against a rubric
 * criterion whose marks come from the paper's recorded marking instructions.
 * Automated assistance may attach annotations, but cannot award marks, change
 * status or state a verdict. Unknown marks stay null; they are never zero.
 * Pure module: no DOM, network or storage access.
 */

export const WRITTEN_REVIEW_VERSION = 1;
export const REVIEW_KINDS = Object.freeze(['self', 'expert', 'automated-assist']);
export const REVIEW_STATUSES = Object.freeze(['unreviewed', 'self-reviewed', 'expert-reviewed']);
export const RESPONSE_FORMATS = Object.freeze(['written-derivation', 'written-short-answer']);
export const EXPLANATION_REVIEW = Object.freeze(['unreviewed', 'ai-assisted', 'expert-reviewed']);
export const MAX_WORK_LENGTH = 20000;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_REVIEWS_PER_QUESTION = 50;
const MAX_RAW_LENGTH = 2_000_000;
const SCORING_FIELDS = ['criteria', 'marks', 'awardedMarks', 'score', 'status', 'verdict', 'correct', 'isCorrect', 'grade'];
export const NO_AUTOMATIC_JUDGMENT = 'Vedaris does not judge written answers automatically. Marks shown here were recorded by the learner (self review) or by a named expert reviewer against the source-backed rubric. Automated assistance, if any, is limited to non-scoring annotations.';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const page = value => Number.isInteger(value) && value >= 1;
const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validTime = value => Number.isSafeInteger(value) && value > 0;
function keys(value, allowed, required, path, errors) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown field`);
  for (const key of required) if (!own(value, key)) errors.push(`${path}.${key}: required`);
}
function evidence(value, path, errors) {
  if (!object(value)) { errors.push(`${path}: expected {url, page}`); return; }
  keys(value, ['url', 'page'], ['url', 'page'], path, errors);
  if (!isWebUrl(value.url)) errors.push(`${path}.url: expected HTTP(S) URL`);
  if (!page(value.page)) errors.push(`${path}.page: expected 1-based positive page`);
}

/**
 * Whether an archive link record could even be considered for written review.
 * A link record never qualifies alone: it also needs a written-review record
 * with marking provenance (validateWrittenPaper). Returns blocking reasons.
 */
export function archiveWrittenReviewBlockers(paper, source) {
  const reasons = [];
  if (!object(paper)) return ['archive record is missing'];
  if (paper.coverage !== 'full-paper') reasons.push(`coverage is ${paper.coverage}, not a complete paper`);
  if (paper.verification !== 'pdf-verified') reasons.push(`verification is ${paper.verification}; the original pages have not been inspected`);
  if (paper.maxMarks === null || paper.maxMarks === undefined) reasons.push('maximum marks are not recorded');
  if (paper.durationMinutes === null || paper.durationMinutes === undefined) reasons.push('duration is not recorded');
  if (!source) reasons.push('source record is missing');
  return reasons;
}

/** Validate a source-backed written paper. Schema validity does not prove the source is transcribed faithfully. */
export function validateWrittenPaper(record, archive) {
  const errors = [];
  if (!object(record)) return ['paper: expected an object'];
  keys(record, ['version', 'paperId', 'responseFormat', 'marking', 'questions'], ['version', 'paperId', 'responseFormat', 'marking', 'questions'], 'paper', errors);
  if (record.version !== WRITTEN_REVIEW_VERSION) errors.push('paper.version: must be 1');
  if (!text(record.paperId)) errors.push('paper.paperId: expected nonempty text');
  const archiveErrors = archive === undefined ? ['archive is required to resolve the paper'] : validateArchive(archive);
  if (archiveErrors.length) errors.push(...archiveErrors.map(error => `archive: ${error}`));
  else {
    const paper = archive.papers.find(value => value.id === record.paperId);
    if (!paper) errors.push('paper.paperId: not found in the source archive');
    else for (const reason of archiveWrittenReviewBlockers(paper, archive.sources.find(value => value.id === paper.sourceId))) errors.push(`paper.paperId: ${reason}`);
  }
  // Original response format, with the page where the paper states it.
  if (!object(record.responseFormat)) errors.push('paper.responseFormat: required');
  else {
    keys(record.responseFormat, ['kind', 'description', 'source'], ['kind', 'description', 'source'], 'paper.responseFormat', errors);
    if (!RESPONSE_FORMATS.includes(record.responseFormat.kind)) errors.push('paper.responseFormat.kind: unsupported written response format');
    if (!text(record.responseFormat.description)) errors.push('paper.responseFormat.description: required');
    evidence(record.responseFormat.source, 'paper.responseFormat.source', errors);
  }
  // Marking-instruction provenance: where the instructions are and who recorded them.
  if (!object(record.marking)) errors.push('paper.marking: required source-backed marking instructions');
  else {
    keys(record.marking, ['instructions', 'source', 'recordedBy', 'recordedAt'], ['instructions', 'source', 'recordedBy', 'recordedAt'], 'paper.marking', errors);
    if (!text(record.marking.instructions)) errors.push('paper.marking.instructions: required');
    evidence(record.marking.source, 'paper.marking.source', errors);
    if (!text(record.marking.recordedBy)) errors.push('paper.marking.recordedBy: required');
    if (!isReviewDate(record.marking.recordedAt)) errors.push('paper.marking.recordedAt: expected real YYYY-MM-DD date');
  }
  if (!Array.isArray(record.questions) || record.questions.length < 1 || record.questions.length > 500) return [...errors, 'paper.questions: expected 1–500 questions'];
  const ids = new Set(), numbers = new Set();
  record.questions.forEach((q, index) => {
    const path = `paper.questions[${index}]`;
    if (!object(q)) { errors.push(`${path}: expected an object`); return; }
    keys(q, ['id', 'questionNumber', 'subject', 'source', 'statement', 'maxMarks', 'rubric', 'explanation'], ['id', 'questionNumber', 'subject', 'source', 'statement', 'maxMarks', 'rubric', 'explanation'], path, errors);
    if (!text(q.id) || q.id.length > 120) errors.push(`${path}.id: expected stable identity`);
    if (ids.has(q.id)) errors.push(`${path}.id: duplicate`);
    ids.add(q.id);
    if (!text(q.questionNumber)) errors.push(`${path}.questionNumber: expected original printed number`);
    const number = JSON.stringify([q.subject, q.questionNumber]);
    if (numbers.has(number)) errors.push(`${path}.questionNumber: duplicate within subject`);
    numbers.add(number);
    if (!['physics', 'chemistry', 'mathematics'].includes(q.subject)) errors.push(`${path}.subject: invalid subject`);
    evidence(q.source, `${path}.source`, errors);
    if (!text(q.statement) || q.statement.length > 100000) errors.push(`${path}.statement: expected complete statement`);
    if (!finitePositive(q.maxMarks)) errors.push(`${path}.maxMarks: must be positive`);
    rubric(q, `${path}.rubric`, errors);
    explanation(q.explanation, `${path}.explanation`, errors);
  });
  return errors;
}

function rubric(q, path, errors) {
  const r = q.rubric;
  if (!object(r)) { errors.push(`${path}: required source-backed rubric`); return; }
  keys(r, ['source', 'partialMarksSource', 'criteria'], ['source', 'partialMarksSource', 'criteria'], path, errors);
  evidence(r.source, `${path}.source`, errors);
  // Partial marks are allowed only where the source states how they are given.
  if (r.partialMarksSource !== null) evidence(r.partialMarksSource, `${path}.partialMarksSource`, errors);
  if (!Array.isArray(r.criteria) || r.criteria.length < 1 || r.criteria.length > 30) { errors.push(`${path}.criteria: expected 1–30 criteria`); return; }
  const ids = new Set();
  let total = 0;
  r.criteria.forEach((c, i) => {
    const cPath = `${path}.criteria[${i}]`;
    if (!object(c)) { errors.push(`${cPath}: expected an object`); return; }
    keys(c, ['id', 'description', 'marks', 'partialAllowed'], ['id', 'description', 'marks', 'partialAllowed'], cPath, errors);
    if (!text(c.id) || ids.has(c.id)) errors.push(`${cPath}.id: expected unique id`);
    ids.add(c.id);
    if (!text(c.description)) errors.push(`${cPath}.description: required`);
    if (!finitePositive(c.marks)) errors.push(`${cPath}.marks: must be positive`);
    else total += c.marks;
    if (typeof c.partialAllowed !== 'boolean') errors.push(`${cPath}.partialAllowed: expected boolean`);
    else if (c.partialAllowed && r.partialMarksSource === null) errors.push(`${cPath}.partialAllowed: partial marks need a recorded partialMarksSource`);
  });
  if (finitePositive(q.maxMarks) && Math.abs(total - q.maxMarks) > 1e-9) errors.push(`${path}.criteria: marks must sum to maxMarks`);
}

function explanation(value, path, errors) {
  if (!object(value)) { errors.push(`${path}: required worked explanation`); return; }
  keys(value, ['steps', 'author', 'review'], ['steps', 'author', 'review'], path, errors);
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.some(step => !text(step))) errors.push(`${path}.steps: expected nonempty steps`);
  if (!text(value.author)) errors.push(`${path}.author: required`);
  if (!object(value.review)) { errors.push(`${path}.review: required`); return; }
  keys(value.review, ['status', 'reviewer', 'reviewedAt'], ['status'], `${path}.review`, errors);
  if (!EXPLANATION_REVIEW.includes(value.review.status)) errors.push(`${path}.review.status: invalid`);
  else if (value.review.status !== 'unreviewed' && (!text(value.review.reviewer) || !isReviewDate(value.review.reviewedAt))) errors.push(`${path}.review: reviewed explanations need reviewer and date`);
}

/** Publication gate: only fully valid, source-backed records may be offered to learners. */
export function writtenPaperGate(record, archive) {
  const errors = validateWrittenPaper(record, archive);
  return { publishable: errors.length === 0, errors };
}

function requirePaper(paper, archive) {
  const errors = validateWrittenPaper(paper, archive);
  if (errors.length) throw new Error(`Written paper is not source-backed: ${errors[0]}`);
  return new Map(paper.questions.map(q => [q.id, q]));
}

export function emptyWrittenWorkspace(paperId) {
  if (!text(paperId)) throw new Error('A paper identity is required');
  return { version: WRITTEN_REVIEW_VERSION, paperId, entries: [] };
}

function cleanCriteria(question, values, path) {
  if (!Array.isArray(values) || values.length !== question.rubric.criteria.length) throw new Error(`${path}: record every rubric criterion (null when unknown)`);
  const byId = new Map(question.rubric.criteria.map(c => [c.id, c]));
  const seen = new Set();
  return values.map(value => {
    if (!object(value) || !byId.has(value.criterionId) || seen.has(value.criterionId)) throw new Error(`${path}: unknown or repeated criterion`);
    seen.add(value.criterionId);
    const criterion = byId.get(value.criterionId);
    const marks = own(value, 'marks') ? value.marks : null;
    if (marks !== null) {
      if (typeof marks !== 'number' || !Number.isFinite(marks) || marks < 0 || marks > criterion.marks) throw new Error(`${path}: marks for ${criterion.id} must be from 0 to ${criterion.marks}`);
      if (!criterion.partialAllowed && marks !== 0 && marks !== criterion.marks) throw new Error(`${path}: the source does not permit partial marks for ${criterion.id}`);
    }
    const note = own(value, 'note') ? value.note : '';
    if (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH) throw new Error(`${path}: note is too long`);
    return { criterionId: criterion.id, marks, note };
  }).sort((a, b) => question.rubric.criteria.findIndex(c => c.id === a.criterionId) - question.rubric.criteria.findIndex(c => c.id === b.criterionId));
}

/** Copy exactly the permitted fields of one review; throw on contract violations. */
function cleanReview(question, value, now, path) {
  if (!object(value) || !REVIEW_KINDS.includes(value.kind)) throw new Error(`${path}: unknown review kind`);
  if (!validTime(value.createdAt) || value.createdAt > now + 60000) throw new Error(`${path}: invalid time`);
  if (value.kind === 'automated-assist') {
    if (SCORING_FIELDS.some(field => own(value, field))) throw new Error(`${path}: automated assistance cannot award marks, set status or judge correctness`);
    if (!object(value.tool) || !text(value.tool.name) || !text(value.tool.version)) throw new Error(`${path}: automated assistance must name its tool and version`);
    if (!Array.isArray(value.annotations) || value.annotations.length < 1 || value.annotations.length > 20 || value.annotations.some(note => !text(note) || note.length > MAX_NOTE_LENGTH)) throw new Error(`${path}: expected 1–20 bounded annotations`);
    return { kind: 'automated-assist', createdAt: value.createdAt, tool: { name: value.tool.name, version: value.tool.version }, annotations: [...value.annotations] };
  }
  const criteria = cleanCriteria(question, value.criteria, path);
  const comment = own(value, 'comment') ? value.comment : '';
  if (typeof comment !== 'string' || comment.length > MAX_NOTE_LENGTH) throw new Error(`${path}: comment is too long`);
  if (value.kind === 'self') return { kind: 'self', createdAt: value.createdAt, criteria, comment };
  if (!object(value.reviewer) || !text(value.reviewer.name) || value.reviewer.name.length > 200 || (own(value.reviewer, 'qualification') && (typeof value.reviewer.qualification !== 'string' || value.reviewer.qualification.length > 200))) throw new Error(`${path}: an expert review must name its reviewer`);
  if (!isReviewDate(value.reviewedAt)) throw new Error(`${path}: an expert review needs a real YYYY-MM-DD date`);
  if (!text(value.evidence) || value.evidence.length > MAX_NOTE_LENGTH) throw new Error(`${path}: an expert review needs evidence of how it was carried out`);
  return { kind: 'expert', createdAt: value.createdAt, reviewer: { name: value.reviewer.name, qualification: value.reviewer.qualification ?? '' }, reviewedAt: value.reviewedAt, evidence: value.evidence, criteria, comment };
}

function cleanEntry(question, value, now, path) {
  if (!object(value)) throw new Error(`${path}: expected an object`);
  const work = value.work;
  if (!object(work) || typeof work.text !== 'string' || work.text.length > MAX_WORK_LENGTH || !validTime(work.updatedAt) || work.updatedAt > now + 60000) throw new Error(`${path}: invalid recorded work`);
  if (!Array.isArray(value.reviews) || value.reviews.length > MAX_REVIEWS_PER_QUESTION) throw new Error(`${path}: invalid reviews`);
  return { questionId: question.id, work: { text: work.text, updatedAt: work.updatedAt }, reviews: value.reviews.map((review, i) => cleanReview(question, review, now, `${path}.reviews[${i}]`)) };
}

/** Invalid or tampered storage returns null so callers can preserve it. Stored totals and statuses are discarded. */
export function restoreWrittenWorkspace(raw, paper, archive, now = Date.now()) {
  try {
    const questions = requirePaper(paper, archive);
    if (typeof raw === 'string') {
      if (raw.length > MAX_RAW_LENGTH) return null;
      raw = JSON.parse(raw);
    }
    if (!object(raw) || raw.version !== WRITTEN_REVIEW_VERSION || raw.paperId !== paper.paperId || !Array.isArray(raw.entries) || raw.entries.length > questions.size) return null;
    const seen = new Set();
    const entries = raw.entries.map((entry, i) => {
      const question = object(entry) ? questions.get(entry.questionId) : undefined;
      if (!question || seen.has(question.id)) throw new Error('Unknown or duplicate question identity');
      seen.add(question.id);
      return cleanEntry(question, entry, now, `entries[${i}]`);
    });
    return { version: WRITTEN_REVIEW_VERSION, paperId: paper.paperId, entries };
  } catch { return null; }
}

function update(workspace, paper, archive, questionId, now, change) {
  const questions = requirePaper(paper, archive);
  if (!validTime(now)) throw new Error('Invalid time');
  const clean = restoreWrittenWorkspace(workspace, paper, archive, now);
  if (!clean) throw new Error('The saved written-review workspace could not be read; it has been preserved');
  const question = questions.get(questionId);
  if (!question) throw new Error('Unknown question identity');
  const index = clean.entries.findIndex(entry => entry.questionId === questionId);
  const previous = index === -1 ? { questionId, work: { text: '', updatedAt: now }, reviews: [] } : clean.entries[index];
  const next = change(previous, question);
  if (index === -1) clean.entries.push(next); else clean.entries[index] = next;
  return clean;
}

/** Record or replace the learner's own written work. Earlier reviews stay attached to the question. */
export function saveWrittenWork(workspace, paper, archive, questionId, workText, now = Date.now()) {
  if (typeof workText !== 'string' || workText.length > MAX_WORK_LENGTH) throw new Error(`Written work must be text up to ${MAX_WORK_LENGTH} characters`);
  return update(workspace, paper, archive, questionId, now, previous => ({ ...previous, work: { text: workText, updatedAt: now } }));
}

/** Append a self, expert or automated-assist record. Reviews are never edited in place. */
export function addWrittenReview(workspace, paper, archive, questionId, review, now = Date.now()) {
  return update(workspace, paper, archive, questionId, now, (previous, question) => {
    if (previous.reviews.length >= MAX_REVIEWS_PER_QUESTION) throw new Error(`A question holds up to ${MAX_REVIEWS_PER_QUESTION} review records`);
    return { ...previous, reviews: [...previous.reviews, cleanReview(question, { ...review, createdAt: now }, now, 'review')] };
  });
}

/**
 * Status and marks come from the latest expert review, otherwise the latest
 * self review. Automated assistance never contributes. A total is reported
 * only when every criterion has recorded marks; otherwise it is null.
 */
export function writtenQuestionReport(workspace, paper, archive, questionId, now = Date.now()) {
  const questions = requirePaper(paper, archive);
  const question = questions.get(questionId);
  if (!question) throw new Error('Unknown question identity');
  const clean = restoreWrittenWorkspace(workspace, paper, archive, now);
  if (!clean) throw new Error('The saved written-review workspace could not be read; it has been preserved');
  const entry = clean.entries.find(value => value.questionId === questionId) || null;
  const reviews = entry?.reviews || [];
  const latest = kind => reviews.filter(review => review.kind === kind).at(-1) || null;
  const basis = latest('expert') || latest('self');
  const status = basis?.kind === 'expert' ? 'expert-reviewed' : basis ? 'self-reviewed' : 'unreviewed';
  const criteria = question.rubric.criteria.map(criterion => {
    const recorded = basis?.criteria.find(value => value.criterionId === criterion.id);
    return { criterionId: criterion.id, description: criterion.description, maxMarks: criterion.marks, partialAllowed: criterion.partialAllowed, marks: recorded ? recorded.marks : null };
  });
  const unknownCriteria = criteria.filter(c => c.marks === null).length;
  return {
    questionId, questionNumber: question.questionNumber, subject: question.subject, maxMarks: question.maxMarks,
    status, markedBy: basis ? basis.kind : null,
    awardedMarks: basis && unknownCriteria === 0 ? criteria.reduce((sum, c) => sum + c.marks, 0) : null,
    recordedMarks: criteria.reduce((sum, c) => sum + (c.marks ?? 0), 0), unknownCriteria, criteria,
    hasWork: Boolean(entry?.work.text.trim()),
    reviewKinds: { self: reviews.filter(r => r.kind === 'self').length, expert: reviews.filter(r => r.kind === 'expert').length, automatedAssist: reviews.filter(r => r.kind === 'automated-assist').length },
    automaticCorrectnessJudgment: false,
  };
}

/** Spreadsheet-independent JSON export. Recomputes every status; carries identity and provenance. */
export function exportWrittenReview(workspace, paper, archive, now = Date.now()) {
  const questions = requirePaper(paper, archive);
  const clean = restoreWrittenWorkspace(workspace, paper, archive, now);
  if (!clean) throw new Error('The saved written-review workspace could not be read; it has been preserved');
  return JSON.stringify({
    app: 'vedaris', kind: 'written-review-report', version: WRITTEN_REVIEW_VERSION, exportedAt: new Date(now).toISOString(),
    notice: NO_AUTOMATIC_JUDGMENT,
    paper: { paperId: paper.paperId, responseFormat: paper.responseFormat, marking: paper.marking },
    questions: [...questions.values()].map(question => {
      const entry = clean.entries.find(value => value.questionId === question.id);
      return {
        ...writtenQuestionReport(clean, paper, archive, question.id, now),
        source: question.source, rubricSource: question.rubric.source, partialMarksSource: question.rubric.partialMarksSource,
        explanationReview: question.explanation.review,
        work: entry ? entry.work : null, reviews: entry ? entry.reviews : [],
      };
    }),
  }, null, 2);
}
