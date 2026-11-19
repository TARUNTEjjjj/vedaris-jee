import {isReviewDate, isWebUrl, validateArchive} from '../src/archive/index.js';

/**
 * Reviewed import plan for historical papers that are not yet playable.
 *
 * The plan records *evidence about* a paper (source identity, completeness,
 * original references, final keys, section instructions, provenance, reuse
 * permission, review and revisions). It never contains question statements,
 * options, figures or solutions; those enter only through the staging CLI and
 * the content build, which consult this plan before accepting them.
 *
 * Schema validation shows that the record is well formed and internally
 * consistent. It cannot prove that a source is complete, that a transcription
 * is faithful or that reuse is permitted.
 */
export const PLAN_VERSION = 1;
// First year of the reviewed bank. The plan may widen its historical scope but
// never narrow it below this year: lowering the cut-off would silently move
// unplanned papers out of every gate.
export const HISTORICAL_CUTOFF = 2022;
export const PERMISSION_COMPONENTS = ['questionText', 'figures', 'answerKey', 'explanations'];
export const REVIEW_FIELDS = ['transcript', 'answer', 'marking'];
const STAGES = ['planned', 'source-review', 'transcription', 'review', 'ready', 'blocked'];
const PERMISSION_STATUS = ['pending-owner', 'granted', 'not-required', 'refused'];
const KEY_STATUS = ['not-located', 'located', 'verified'];
const COMPLETENESS = ['not-assessed', 'incomplete', 'complete'];
const QUESTION_STATUS = ['pending', 'staged', 'published', 'missing', 'withdrawn'];
const REVISION_KINDS = ['missing-page', 'revised-paper', 'revised-key', 'withdrawn-question', 'bonus', 'translation-discrepancy', 'other'];
const SECTION_TYPES = ['single', 'multiple', 'numerical', 'matching', 'paragraph', 'integer', 'subjective'];
const SUBJECTS = ['physics', 'chemistry', 'mathematics'];
const REVIEW_KINDS = ['ai-assisted', 'human'];
// A plan holds evidence only. Content-bearing fields are refused wherever they appear.
const CONTENT_FIELDS = ['statement', 'options', 'solution', 'passage', 'matchingLists', 'text', 'html', 'markup'];

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isInteger(value) && value > 0;
const nullable = (value, check) => value === null || check(value);
const number = value => typeof value === 'number' && Number.isFinite(value);
function keys(value, allowed, path, errors, required = allowed) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown field`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key}: required`);
}
function noContent(value, path, errors) {
  if (Array.isArray(value)) { value.forEach((item, i) => noContent(item, `${path}[${i}]`, errors)); return; }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (CONTENT_FIELDS.includes(key)) errors.push(`${path}.${key}: question content does not belong in the import plan`);
    else noContent(child, `${path}.${key}`, errors);
  }
}
function decision(value, path, errors) {
  if (!object(value)) { errors.push(`${path}: expected a decision record`); return; }
  keys(value, ['status', 'basis', 'evidenceUrl', 'decidedBy', 'decidedAt'], path, errors);
  if (!PERMISSION_STATUS.includes(value.status)) errors.push(`${path}.status: expected ${PERMISSION_STATUS.join(', ')}`);
  const decided = ['granted', 'not-required', 'refused'].includes(value.status);
  if (decided) {
    // Reuse permission is an owner decision, never an automated inference.
    if (!text(value.basis)) errors.push(`${path}.basis: a ${value.status} decision needs its basis`);
    if (!text(value.decidedBy)) errors.push(`${path}.decidedBy: a ${value.status} decision needs the deciding person`);
    if (!isReviewDate(value.decidedAt)) errors.push(`${path}.decidedAt: expected real YYYY-MM-DD date`);
    if (value.status === 'granted' && !isWebUrl(value.evidenceUrl)) errors.push(`${path}.evidenceUrl: granted permission needs an HTTP(S) evidence URL`);
  } else {
    for (const key of ['basis', 'evidenceUrl', 'decidedBy', 'decidedAt']) if (value[key] !== null) errors.push(`${path}.${key}: must be null until the owner decides`);
  }
  if (value.evidenceUrl !== null && value.evidenceUrl !== undefined && !isWebUrl(value.evidenceUrl)) errors.push(`${path}.evidenceUrl: expected HTTP(S) URL`);
}
function reviewList(value, path, errors) {
  if (!Array.isArray(value)) { errors.push(`${path}: expected an array of reviews`); return; }
  value.forEach((review, i) => {
    const at = `${path}[${i}]`;
    if (!object(review)) { errors.push(`${at}: expected a review record`); return; }
    keys(review, ['kind', 'reviewer', 'reviewedAt', 'evidenceUrl', 'notes'], at, errors, ['kind', 'reviewer', 'reviewedAt', 'evidenceUrl']);
    if (!REVIEW_KINDS.includes(review.kind)) errors.push(`${at}.kind: expected ai-assisted or human; the distinction must be explicit`);
    if (!text(review.reviewer)) errors.push(`${at}.reviewer: required`);
    if (!isReviewDate(review.reviewedAt)) errors.push(`${at}.reviewedAt: expected real YYYY-MM-DD date`);
    if (!isWebUrl(review.evidenceUrl)) errors.push(`${at}.evidenceUrl: expected HTTP(S) evidence URL`);
    if (review.kind === 'human' && /\b(ai|codex|claude|gpt|model|automated)\b/i.test(review.reviewer)) errors.push(`${at}.reviewer: an AI or automated reviewer cannot be recorded as human certification`);
  });
}

function validatePaper(record, path, catalogPaper, trancheIds, errors) {
  if (!object(record)) { errors.push(`${path}: expected a paper record`); return; }
  keys(record, ['paperId', 'tranche', 'stage', 'source', 'completeness', 'format', 'questions', 'revisions', 'assets', 'provenance', 'permissions', 'notes'], path, errors, ['paperId', 'tranche', 'stage', 'source', 'completeness', 'format', 'questions', 'revisions', 'assets', 'provenance', 'permissions']);
  if (!catalogPaper) { errors.push(`${path}.paperId: not found in the source catalog`); return; }
  if (!trancheIds.has(record.tranche)) errors.push(`${path}.tranche: unknown tranche`);
  if (!STAGES.includes(record.stage)) errors.push(`${path}.stage: expected ${STAGES.join(', ')}`);

  const source = record.source;
  if (!object(source)) errors.push(`${path}.source: required`);
  else {
    keys(source, ['questionPaper', 'finalKey', 'instructions'], `${path}.source`, errors);
    const paper = source.questionPaper;
    if (!object(paper)) errors.push(`${path}.source.questionPaper: required`);
    else {
      keys(paper, ['url', 'sha256', 'pageCount', 'language', 'checkedBy', 'checkedAt'], `${path}.source.questionPaper`, errors);
      if (paper.url !== catalogPaper.url) errors.push(`${path}.source.questionPaper.url: must equal the catalog paper URL`);
      if (!nullable(paper.sha256, sha256)) errors.push(`${path}.source.questionPaper.sha256: expected null or lowercase SHA-256`);
      if (!nullable(paper.pageCount, positive)) errors.push(`${path}.source.questionPaper.pageCount: expected null or a positive integer`);
      if (!text(paper.language)) errors.push(`${path}.source.questionPaper.language: required`);
      if (!nullable(paper.checkedBy, text) || !nullable(paper.checkedAt, isReviewDate) || (paper.checkedBy === null) !== (paper.checkedAt === null)) errors.push(`${path}.source.questionPaper: checkedBy and checkedAt are recorded together`);
      if ((paper.sha256 !== null || paper.pageCount !== null) && paper.checkedBy === null) errors.push(`${path}.source.questionPaper: a recorded hash or page count needs checkedBy/checkedAt`);
    }
    const key = source.finalKey;
    if (!object(key)) errors.push(`${path}.source.finalKey: required`);
    else {
      keys(key, ['status', 'url', 'sha256', 'archivedOfficialOrigin'], `${path}.source.finalKey`, errors);
      if (!KEY_STATUS.includes(key.status)) errors.push(`${path}.source.finalKey.status: expected ${KEY_STATUS.join(', ')}`);
      if (key.status === 'not-located' && (key.url !== null || key.sha256 !== null)) errors.push(`${path}.source.finalKey: a not-located key has no URL or hash`);
      if (key.status !== 'not-located' && !isWebUrl(key.url)) errors.push(`${path}.source.finalKey.url: expected HTTP(S) URL`);
      if (key.status === 'verified' && !sha256(key.sha256)) errors.push(`${path}.source.finalKey.sha256: a verified key needs its SHA-256`);
      if (!nullable(key.sha256, sha256)) errors.push(`${path}.source.finalKey.sha256: expected null or lowercase SHA-256`);
      if (typeof key.archivedOfficialOrigin !== 'boolean') errors.push(`${path}.source.finalKey.archivedOfficialOrigin: expected boolean`);
    }
    const instructions = source.instructions;
    if (!object(instructions)) errors.push(`${path}.source.instructions: required`);
    else {
      keys(instructions, ['status', 'pages'], `${path}.source.instructions`, errors);
      if (!['not-recorded', 'recorded'].includes(instructions.status)) errors.push(`${path}.source.instructions.status: expected not-recorded or recorded`);
      if (!Array.isArray(instructions.pages) || !instructions.pages.every(positive)) errors.push(`${path}.source.instructions.pages: expected positive page numbers`);
      else if (instructions.status === 'recorded' && !instructions.pages.length) errors.push(`${path}.source.instructions.pages: recorded instructions need their pages`);
    }
  }

  const completeness = record.completeness;
  if (!object(completeness)) errors.push(`${path}.completeness: required`);
  else {
    keys(completeness, ['status', 'missingPages', 'checkedBy', 'checkedAt'], `${path}.completeness`, errors);
    if (!COMPLETENESS.includes(completeness.status)) errors.push(`${path}.completeness.status: expected ${COMPLETENESS.join(', ')}`);
    if (!Array.isArray(completeness.missingPages) || !completeness.missingPages.every(positive)) errors.push(`${path}.completeness.missingPages: expected positive page numbers`);
    else if (completeness.status === 'complete' && completeness.missingPages.length) errors.push(`${path}.completeness: a paper with missing pages is not complete`);
    if (completeness.status !== 'not-assessed' && (!text(completeness.checkedBy) || !isReviewDate(completeness.checkedAt))) errors.push(`${path}.completeness: an assessment needs checkedBy and checkedAt`);
    if (completeness.status === 'not-assessed' && (completeness.checkedBy !== null || completeness.checkedAt !== null)) errors.push(`${path}.completeness: not-assessed records have null checkedBy/checkedAt`);
  }

  const format = record.format;
  const sectionOf = new Map();
  if (!object(format)) errors.push(`${path}.format: required`);
  else {
    keys(format, ['questionCount', 'maxMarks', 'durationMinutes', 'sections'], `${path}.format`, errors);
    if (!nullable(format.questionCount, positive)) errors.push(`${path}.format.questionCount: expected null or a positive integer`);
    if (!nullable(format.maxMarks, value => number(value) && value > 0)) errors.push(`${path}.format.maxMarks: expected null or a positive number`);
    if (!nullable(format.durationMinutes, positive)) errors.push(`${path}.format.durationMinutes: expected null or a positive integer`);
    if (!Array.isArray(format.sections)) errors.push(`${path}.format.sections: expected an array`);
    else format.sections.forEach((section, i) => {
      const at = `${path}.format.sections[${i}]`;
      if (!object(section)) { errors.push(`${at}: expected a section`); return; }
      keys(section, ['id', 'subject', 'type', 'questionNumbers', 'marking', 'instructionPage'], at, errors);
      if (!text(section.id)) errors.push(`${at}.id: required`);
      if (!SUBJECTS.includes(section.subject)) errors.push(`${at}.subject: invalid subject`);
      if (!SECTION_TYPES.includes(section.type)) errors.push(`${at}.type: expected ${SECTION_TYPES.join(', ')}`);
      if (!positive(section.instructionPage)) errors.push(`${at}.instructionPage: expected the 1-based PDF page of its instructions`);
      if (!object(section.marking) || !number(section.marking.correct) || section.marking.correct <= 0 || !number(section.marking.incorrect) || section.marking.incorrect > 0 || section.marking.unanswered !== 0) errors.push(`${at}.marking: expected explicit correct (>0), incorrect (<=0) and unanswered (0) marks`);
      if (!Array.isArray(section.questionNumbers) || !section.questionNumbers.length || !section.questionNumbers.every(text)) errors.push(`${at}.questionNumbers: expected original printed question numbers`);
      else for (const n of section.questionNumbers) {
        const ref = `${section.subject}:${n}`;
        if (sectionOf.has(ref)) errors.push(`${at}.questionNumbers: ${ref} appears in more than one section`);
        sectionOf.set(ref, section);
      }
    });
  }

  const questionRefs = new Set();
  if (!Array.isArray(record.questions)) errors.push(`${path}.questions: expected an array`);
  else record.questions.forEach((question, i) => {
    const at = `${path}.questions[${i}]`;
    if (!object(question)) { errors.push(`${at}: expected a question reference`); return; }
    keys(question, ['subject', 'number', 'section', 'pdfPage', 'status', 'contentId', 'finalKey', 'reviews', 'notes'], at, errors, ['subject', 'number', 'section', 'pdfPage', 'status', 'contentId', 'finalKey', 'reviews']);
    if (!SUBJECTS.includes(question.subject)) errors.push(`${at}.subject: invalid subject`);
    if (!text(question.number)) errors.push(`${at}.number: expected the original printed number`);
    const ref = `${question.subject}:${question.number}`;
    if (questionRefs.has(ref)) errors.push(`${at}: duplicate original question reference ${ref}`);
    questionRefs.add(ref);
    if (!QUESTION_STATUS.includes(question.status)) errors.push(`${at}.status: expected ${QUESTION_STATUS.join(', ')}`);
    if (question.status !== 'missing' && !positive(question.pdfPage)) errors.push(`${at}.pdfPage: expected the 1-based page of the original question`);
    if (question.status === 'missing' && question.pdfPage !== null) errors.push(`${at}.pdfPage: a missing question has no page`);
    if (sectionOf.size && sectionOf.get(ref)?.id !== question.section) errors.push(`${at}.section: does not match the section listing ${ref}`);
    // A withdrawn (officially dropped) question may still be published as a bonus record.
    if (question.status === 'withdrawn' ? !nullable(question.contentId, text) : ['staged', 'published'].includes(question.status) ? !text(question.contentId) : question.contentId !== null) errors.push(`${at}.contentId: required once staged and null before`);
    if (!object(question.finalKey)) errors.push(`${at}.finalKey: required`);
    else {
      keys(question.finalKey, ['status', 'evidencePage'], `${at}.finalKey`, errors);
      if (!['pending', 'recorded', 'bonus', 'withdrawn'].includes(question.finalKey.status)) errors.push(`${at}.finalKey.status: expected pending, recorded, bonus or withdrawn`);
      if (question.finalKey.status !== 'pending' && !positive(question.finalKey.evidencePage)) errors.push(`${at}.finalKey.evidencePage: a recorded key needs its evidence page`);
    }
    if (!object(question.reviews)) errors.push(`${at}.reviews: required`);
    else {
      keys(question.reviews, REVIEW_FIELDS, `${at}.reviews`, errors);
      for (const field of REVIEW_FIELDS) reviewList(question.reviews[field], `${at}.reviews.${field}`, errors);
    }
    if (question.status === 'withdrawn' && !record.revisions?.some?.(revision => ['withdrawn-question', 'bonus'].includes(revision.kind) && revision.questionRef === ref)) errors.push(`${at}: a withdrawn question needs a withdrawn-question or bonus revision with evidence`);
    if (question.status === 'missing' && !record.revisions?.some?.(revision => revision.kind === 'missing-page' && revision.questionRef === ref)) errors.push(`${at}: a missing question needs a missing-page revision record`);
  });

  if (!Array.isArray(record.revisions)) errors.push(`${path}.revisions: expected an array`);
  else record.revisions.forEach((revision, i) => {
    const at = `${path}.revisions[${i}]`;
    if (!object(revision)) { errors.push(`${at}: expected a revision record`); return; }
    keys(revision, ['kind', 'questionRef', 'page', 'evidenceUrl', 'recordedAt', 'resolution', 'disposition', 'notes'], at, errors, ['kind', 'questionRef', 'page', 'evidenceUrl', 'recordedAt', 'resolution']);
    if (!REVISION_KINDS.includes(revision.kind)) errors.push(`${at}.kind: expected ${REVISION_KINDS.join(', ')}`);
    if (revision.questionRef !== null && !questionRefs.has(revision.questionRef)) errors.push(`${at}.questionRef: unknown question reference`);
    if (!nullable(revision.page, positive)) errors.push(`${at}.page: expected null or a positive page`);
    if (revision.questionRef === null && revision.page === null) errors.push(`${at}: identify a question or page`);
    if (!isWebUrl(revision.evidenceUrl)) errors.push(`${at}.evidenceUrl: expected HTTP(S) evidence URL`);
    if (!isReviewDate(revision.recordedAt)) errors.push(`${at}.recordedAt: expected real YYYY-MM-DD date`);
    if (!['open', 'resolved'].includes(revision.resolution)) errors.push(`${at}.resolution: expected open or resolved`);
    if (['withdrawn-question', 'bonus'].includes(revision.kind) && !(object(revision.disposition) && number(revision.disposition.marksAwarded) && typeof revision.disposition.includesBlank === 'boolean')) errors.push(`${at}.disposition: a withdrawn or bonus question records its official marks and whether blank responses receive them`);
  });

  if (!Array.isArray(record.assets)) errors.push(`${path}.assets: expected an array`);
  else {
    const ids = new Set();
    record.assets.forEach((asset, i) => {
      const at = `${path}.assets[${i}]`;
      if (!object(asset)) { errors.push(`${at}: expected an asset record`); return; }
      keys(asset, ['path', 'questionRef', 'sourcePage', 'sha256', 'derivedFrom'], at, errors);
      if (typeof asset.path !== 'string' || !/^assets\/content\/[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(asset.path) || asset.path.split('/').some(part => part === '.' || part === '..')) errors.push(`${at}.path: expected a safe assets/content/ image path`);
      if (ids.has(asset.path)) errors.push(`${at}.path: duplicate`);
      ids.add(asset.path);
      if (!questionRefs.has(asset.questionRef)) errors.push(`${at}.questionRef: unknown question reference`);
      if (!positive(asset.sourcePage)) errors.push(`${at}.sourcePage: expected the original page`);
      if (!sha256(asset.sha256)) errors.push(`${at}.sha256: every asset is checksummed`);
      if (!text(asset.derivedFrom)) errors.push(`${at}.derivedFrom: record how the figure was produced`);
    });
  }

  const provenance = record.provenance;
  if (!object(provenance)) errors.push(`${path}.provenance: required`);
  else {
    keys(provenance, ['transcriptSource', 'transcriptRevision', 'notes'], `${path}.provenance`, errors);
    if (!nullable(provenance.transcriptSource, isWebUrl)) errors.push(`${path}.provenance.transcriptSource: expected null or HTTP(S) URL`);
    if (!nullable(provenance.transcriptRevision, text)) errors.push(`${path}.provenance.transcriptRevision: expected null or text`);
    if (provenance.transcriptRevision !== null && provenance.transcriptSource === null) errors.push(`${path}.provenance.transcriptRevision: needs transcriptSource`);
  }

  if (!object(record.permissions)) errors.push(`${path}.permissions: required`);
  else {
    keys(record.permissions, PERMISSION_COMPONENTS, `${path}.permissions`, errors);
    for (const component of PERMISSION_COMPONENTS) decision(record.permissions[component], `${path}.permissions.${component}`, errors);
  }
}

/** A plan that selects nothing: every historical paper stays outside staging and publication. */
export function emptyImportPlan(updatedAt = '2026-11-19') {
  return {version: PLAN_VERSION, updatedAt, policy: {appliesBeforeYear: 2022, requireHumanCertificationForMock: true}, tranches: [], papers: []};
}

/** Validate the whole plan against the source catalog. Returns a list of errors. */
export function validateImportPlan(plan, archive) {
  const errors = validateArchive(archive).map(error => `catalog: ${error}`);
  if (!object(plan)) return [...errors, 'plan: expected an object'];
  keys(plan, ['version', 'updatedAt', 'policy', 'tranches', 'papers'], 'plan', errors);
  if (plan.version !== PLAN_VERSION) errors.push(`plan.version: must be ${PLAN_VERSION}`);
  if (!isReviewDate(plan.updatedAt)) errors.push('plan.updatedAt: expected real YYYY-MM-DD date');
  noContent(plan, 'plan', errors);
  if (!object(plan.policy)) errors.push('plan.policy: required');
  else {
    keys(plan.policy, ['appliesBeforeYear', 'requireHumanCertificationForMock'], 'plan.policy', errors);
    if (!Number.isInteger(plan.policy.appliesBeforeYear) || plan.policy.appliesBeforeYear > 2100) errors.push('plan.policy.appliesBeforeYear: expected a year');
    else if (plan.policy.appliesBeforeYear < HISTORICAL_CUTOFF) errors.push(`plan.policy.appliesBeforeYear: cannot be below ${HISTORICAL_CUTOFF}; narrowing the historical scope would bypass the import gates`);
    if (typeof plan.policy.requireHumanCertificationForMock !== 'boolean') errors.push('plan.policy.requireHumanCertificationForMock: expected boolean');
  }
  const catalog = new Map((Array.isArray(archive?.papers) ? archive.papers : []).map(paper => [paper.id, paper]));
  const trancheIds = new Set(), planned = new Set();
  if (!Array.isArray(plan.tranches)) errors.push('plan.tranches: expected an array');
  else plan.tranches.forEach((tranche, i) => {
    const at = `plan.tranches[${i}]`;
    if (!object(tranche)) { errors.push(`${at}: expected a tranche`); return; }
    keys(tranche, ['id', 'title', 'selectedAt', 'selectedBy', 'rationale', 'ownerApproval', 'paperIds', 'nextCandidates'], at, errors);
    if (!text(tranche.id) || trancheIds.has(tranche.id)) errors.push(`${at}.id: expected a distinct id`);
    trancheIds.add(tranche.id);
    for (const key of ['title', 'selectedBy', 'rationale']) if (!text(tranche[key])) errors.push(`${at}.${key}: required`);
    if (!isReviewDate(tranche.selectedAt)) errors.push(`${at}.selectedAt: expected real YYYY-MM-DD date`);
    decision(tranche.ownerApproval, `${at}.ownerApproval`, errors);
    if (!Array.isArray(tranche.paperIds) || !tranche.paperIds.length) errors.push(`${at}.paperIds: expected the selected papers`);
    else for (const id of tranche.paperIds) {
      if (!catalog.has(id)) errors.push(`${at}.paperIds: ${id} is not in the source catalog`);
      if (planned.has(id)) errors.push(`${at}.paperIds: ${id} is selected twice`);
      planned.add(id);
    }
    if (!Array.isArray(tranche.nextCandidates) || tranche.nextCandidates.some(id => !catalog.has(id))) errors.push(`${at}.nextCandidates: expected catalog paper IDs`);
  });
  const recorded = new Set();
  if (!Array.isArray(plan.papers)) errors.push('plan.papers: expected an array');
  else plan.papers.forEach((record, i) => {
    const at = `plan.papers[${i}]`;
    const catalogPaper = catalog.get(record?.paperId);
    if (recorded.has(record?.paperId)) errors.push(`${at}.paperId: duplicate record`);
    recorded.add(record?.paperId);
    validatePaper(record, at, catalogPaper, trancheIds, errors);
    if (catalogPaper && object(plan.policy) && catalogPaper.year >= plan.policy.appliesBeforeYear) errors.push(`${at}.paperId: ${catalogPaper.year} is outside the historical plan scope`);
    if (catalogPaper && object(record) && !plan.tranches?.find?.(tranche => tranche.id === record.tranche)?.paperIds?.includes(record.paperId)) errors.push(`${at}.tranche: the tranche does not select this paper`);
  });
  for (const id of planned) if (!recorded.has(id)) errors.push(`plan.papers: selected paper ${id} has no record`);
  return errors;
}

const approved = component => ['granted', 'not-required'].includes(component?.status);
const reviewed = (reviews, requireHuman) => REVIEW_FIELDS.every(field => Array.isArray(reviews?.[field]) && reviews[field].length && (!requireHuman || reviews[field].some(review => review.kind === 'human')));

/**
 * Explain what still blocks a planned paper. `publication` lists blockers for
 * staging or publishing any of its questions; `mock` lists blockers for a full
 * historical mock. Nothing here is inferred: every unknown value is a blocker.
 */
export function planReadiness(plan, archive, paperId) {
  const record = plan.papers.find(item => item.paperId === paperId);
  const paper = archive.papers.find(item => item.id === paperId);
  if (!record || !paper) return {paperId, planned: false, publication: ['The paper is not selected in the reviewed import plan.'], mock: ['The paper is not selected in the reviewed import plan.'], counts: null, certification: 'none'};
  const tranche = plan.tranches.find(item => item.id === record.tranche);
  const publication = [];
  if (!approved(tranche?.ownerApproval)) publication.push(`Owner approval of ${record.tranche} is ${tranche?.ownerApproval?.status ?? 'missing'}.`);
  for (const component of ['questionText', 'answerKey', 'explanations']) if (!approved(record.permissions[component])) publication.push(`Reuse permission for ${component} is ${record.permissions[component].status}.`);
  if (record.assets.length && !approved(record.permissions.figures)) publication.push(`Reuse permission for figures is ${record.permissions.figures.status}.`);
  if (!record.source.questionPaper.sha256 || !record.source.questionPaper.pageCount) publication.push('The question paper hash and page count are not recorded.');
  if (record.provenance.transcriptSource === null) publication.push('Transcript provenance is not recorded.');

  const mock = [...publication];
  const {format, completeness} = record;
  if (completeness.status !== 'complete') mock.push(`Source completeness is ${completeness.status}.`);
  if (completeness.missingPages.length) mock.push(`Missing pages: ${completeness.missingPages.join(', ')}.`);
  if (record.source.finalKey.status !== 'verified') mock.push(`The final answer key is ${record.source.finalKey.status}.`);
  if (record.source.instructions.status !== 'recorded') mock.push('Section instructions are not recorded.');
  if (format.questionCount === null || format.maxMarks === null || format.durationMinutes === null) mock.push('Question count, maximum marks and duration are not all recorded.');
  else {
    if (paper.questionCount !== format.questionCount || paper.maxMarks !== format.maxMarks || paper.durationMinutes !== format.durationMinutes) mock.push('The source catalog totals and duration do not match the recorded format.');
    const listed = format.sections.reduce((sum, section) => sum + section.questionNumbers.length, 0);
    if (listed !== format.questionCount) mock.push(`Sections list ${listed} of ${format.questionCount} questions.`);
    const marks = format.sections.reduce((sum, section) => sum + section.questionNumbers.length * section.marking.correct, 0);
    if (marks !== format.maxMarks) mock.push(`Section marks total ${marks}, not ${format.maxMarks}.`);
    if (paper.exam === 'jee-advanced' && !SUBJECTS.every(subject => format.sections.some(section => section.subject === subject))) mock.push('Physics, Chemistry and Mathematics sections are not all recorded.');
    if (record.questions.length !== format.questionCount) mock.push(`${record.questions.length} of ${format.questionCount} original questions are referenced.`);
  }
  const requireHuman = plan.policy.requireHumanCertificationForMock;
  const counts = {referenced: record.questions.length, staged: 0, published: 0, pending: 0, missing: 0, withdrawn: 0, aiReviewed: 0, humanCertified: 0};
  for (const question of record.questions) {
    counts[question.status] += 1;
    if (reviewed(question.reviews, false)) counts.aiReviewed += 1;
    if (reviewed(question.reviews, true)) counts.humanCertified += 1;
    const ref = `${question.subject} Q${question.number}`;
    if (question.status === 'missing') mock.push(`${ref} is missing from the source.`);
    else if (question.status === 'pending') mock.push(`${ref} is not yet staged.`);
    else if (question.status !== 'withdrawn') {
      if (question.finalKey.status === 'pending') mock.push(`${ref} has no recorded final key.`);
      if (!reviewed(question.reviews, requireHuman)) mock.push(`${ref} lacks ${requireHuman ? 'human-certified ' : ''}transcript, answer and marking reviews.`);
    }
  }
  for (const revision of record.revisions) if (revision.resolution === 'open') mock.push(`Open ${revision.kind} revision${revision.questionRef ? ` for ${revision.questionRef}` : ''}.`);
  const certification = !record.questions.length ? 'none' : counts.humanCertified === record.questions.filter(q => !['missing', 'withdrawn'].includes(q.status)).length ? 'human-certified' : counts.aiReviewed ? 'ai-assisted-only' : 'none';
  return {paperId, planned: true, stage: record.stage, publication: [...new Set(publication)], mock: [...new Set(mock)], counts, certification};
}

/** Papers inside the plan's historical scope must be planned before staging or publication. */
export function inHistoricalScope(plan, archive, paperId) {
  const paper = archive.papers.find(item => item.id === paperId);
  return !!paper && paper.year < Math.max(HISTORICAL_CUTOFF, Number.isInteger(plan?.policy?.appliesBeforeYear) ? plan.policy.appliesBeforeYear : HISTORICAL_CUTOFF);
}

/**
 * Gate used by the staging CLI and the content build. Returns errors for any
 * question that belongs to a historical paper whose plan does not yet permit
 * publication, or that is not referenced by the plan.
 */
export function checkPlannedQuestions(plan, archive, questions, {stage = 'staging'} = {}) {
  const errors = [];
  for (const [index, question] of questions.entries()) {
    if (!inHistoricalScope(plan, archive, question.paperId)) continue;
    const readiness = planReadiness(plan, archive, question.paperId);
    const where = `questions[${index}] (${question.id})`;
    if (!readiness.planned) { errors.push(`${where}: ${question.paperId} is a historical paper that is not in the reviewed import plan`); continue; }
    for (const blocker of readiness.publication) errors.push(`${where}: ${stage} blocked: ${blocker}`);
    const record = plan.papers.find(item => item.paperId === question.paperId);
    const number = String(question.questionNumber).replace(/^Q0*/i, '');
    const reference = record.questions.find(item => item.subject === question.subject && String(item.number).replace(/^0+/, '') === number);
    if (!reference) { errors.push(`${where}: ${question.subject} Q${question.questionNumber} is not referenced in the import plan`); continue; }
    // An officially withdrawn question may only appear as an explicit bonus record.
    if (reference.status === 'missing' || (reference.status === 'withdrawn' && question.answer?.type !== 'bonus')) errors.push(`${where}: the plan records ${question.subject} Q${question.questionNumber} as ${reference.status}`);
    // Stable identity: the plan pins the content ID once a question is staged.
    if (reference.contentId !== null && reference.contentId !== question.id) errors.push(`${where}: the plan records ${question.subject} Q${question.questionNumber} as ${reference.contentId}, not ${question.id}`);
    if (stage === 'publication' && !['staged', 'published', 'withdrawn'].includes(reference.status)) errors.push(`${where}: the plan records ${question.subject} Q${question.questionNumber} as ${reference.status}; publish only staged questions`);
    if (stage === 'publication' && reference.contentId === null) errors.push(`${where}: the plan does not pin a content ID for ${question.subject} Q${question.questionNumber}`);
  }
  return errors;
}

/**
 * A historical full-mock configuration must reproduce the plan's recorded
 * original format: duration, total marks, question count, every referenced
 * question (by its pinned content ID) and each section's marking.
 */
export function checkMockConfiguration(plan, archive, config) {
  if (!inHistoricalScope(plan, archive, config?.paperId)) return [];
  const record = plan.papers.find(item => item.paperId === config.paperId);
  if (!record) return [`Full mock ${config.paperId}: the paper is not selected in the reviewed import plan`];
  const errors = [], at = `Full mock ${config.paperId}`, {format} = record;
  if (config.durationMinutes !== format.durationMinutes) errors.push(`${at}: duration ${config.durationMinutes} differs from the recorded original ${format.durationMinutes}`);
  if (config.maxMarks !== format.maxMarks) errors.push(`${at}: maximum marks ${config.maxMarks} differ from the recorded original ${format.maxMarks}`);
  if (config.expectedQuestionCount !== format.questionCount) errors.push(`${at}: question count ${config.expectedQuestionCount} differs from the recorded original ${format.questionCount}`);
  const configured = new Map();
  for (const section of Array.isArray(config.sections) ? config.sections : []) for (const id of section?.questionIds ?? []) configured.set(id, section);
  for (const question of record.questions) {
    if (question.status === 'missing') continue;
    const ref = `${question.subject} Q${question.number}`;
    const section = question.contentId === null ? undefined : configured.get(question.contentId);
    if (!section) { errors.push(`${at}: ${ref} is not in the configured question order`); continue; }
    const planned = format.sections.find(item => item.id === question.section && item.subject === question.subject);
    if (planned && (section.marking?.correct !== planned.marking.correct || section.marking?.incorrect !== planned.marking.incorrect)) errors.push(`${at}: ${ref} marking differs from the recorded section ${planned.id}`);
  }
  return errors;
}
