import { validateArchive, isReviewDate, isWebUrl } from '../archive/index.js';
import { validateQuestionCatalog } from '../archive/questions.js';
import { CHAPTERS } from '../questions/catalog.js';
import { parseNumber } from '../questions/grading.js';

const BASE_FIELDS = ['id', 'paperId', 'year', 'exam', 'subject', 'section', 'questionNumber', 'source', 'statement', 'options', 'answer', 'marking', 'review', 'status'];
const EXTRA_FIELDS = ['chapters', 'chapterReview', 'solution', 'assets', 'matchingLists'];
const TYPES = { 'single-choice': 'single', 'multiple-choice': 'multiple', numeric: 'numerical', bonus: 'bonus' };
const MAX_QUESTIONS = 20000;
const MAX_CONTENT_CHARS = 32000000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const stableId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value);
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const keyFor = selected => JSON.stringify([...selected].sort());
const sameNumber = (a, b) => a.n * b.d === b.n * a.d;
const compareNumber = (a, b) => a.n * b.d < b.n * a.d ? -1 : sameNumber(a, b) ? 0 : 1;

function keys(value, allowed, required, path, errors) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown field`);
  for (const key of required) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
}
function review(value, path, errors) {
  if (!object(value)) { errors.push(`${path}: an actual recorded review is required`); return; }
  keys(value, ['reviewer', 'reviewedAt', 'sourceUrl'], ['reviewer', 'reviewedAt', 'sourceUrl'], path, errors);
  if (!text(value.reviewer)) errors.push(`${path}.reviewer: required; do not invent a review identity`);
  if (!isReviewDate(value.reviewedAt)) errors.push(`${path}.reviewedAt: invalid review date`);
  if (!isWebUrl(value.sourceUrl)) errors.push(`${path}.sourceUrl: expected source evidence URL`);
}
function source(value, path, errors) {
  if (!object(value)) { errors.push(`${path}: expected source page`); return; }
  keys(value, ['url', 'page'], ['url', 'page'], path, errors);
  if (!isWebUrl(value.url) || !positiveInteger(value.page)) errors.push(`${path}: expected source URL and 1-based page`);
}
function assetUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  if (/^(?:assets\/|data\/content\/)[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(value) && !value.split('/').some(part => part === '..' || part === '.')) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function fail(errors) {
  if (errors.length) { const error = new Error(`Content validation failed:\n${errors.join('\n')}`); error.errors = errors; throw error; }
}
function subsets(values, count) {
  const result = [];
  function visit(start, selected) {
    if (selected.length === count) { result.push([...selected]); return; }
    for (let i = start; i < values.length; i++) { selected.push(values[i]); visit(i + 1, selected); selected.pop(); }
  }
  visit(0, []); return result;
}

/**
 * Publishable bundles extend the reviewed staging schema. No transcript,
 * answer, chapter, solution, marking review, or practice-ready status is
 * inferred. Schema validation is not evidence that those reviews occurred.
 * availableAssets is an inventory verified by the build/ingestion process;
 * this synchronous module performs no network fetch and claims no link check.
 */
export function createContentRegistry({ archive, bundles = [], papers = [], availableAssets = [] } = {}) {
  const errors = validateArchive(archive).map(error => `archive: ${error}`);
  if (!Array.isArray(bundles)) errors.push('bundles: expected an array');
  if (!Array.isArray(papers)) errors.push('papers: expected an array');
  if (!Array.isArray(availableAssets)) errors.push('availableAssets: expected verified asset URLs');
  fail(errors);
  const archiveCopy = copy(archive);
  const sourceMap = new Map(archiveCopy.sources.map(item => [item.id, item]));
  const archiveMap = new Map(archiveCopy.papers.map(item => [item.id, item]));
  const inventory = new Set();
  for (const value of availableAssets) {
    const url = assetUrl(value);
    if (!url) errors.push('availableAssets: unsafe or unsupported asset URL'); else inventory.add(url);
  }
  const rawQuestions = [];
  let contentSize = 0;
  bundles.forEach((bundle, bi) => {
    const bp = `bundles[${bi}]`;
    if (!object(bundle)) { errors.push(`${bp}: expected a bundle`); return; }
    keys(bundle, ['version', 'questions'], ['version', 'questions'], bp, errors);
    // Empty registries are supported, but a supplied bundle must be a real
    // reviewed batch accepted by the existing staging validator.
    if (!Array.isArray(bundle.questions)) { errors.push(`${bp}.questions: expected an array`); return; }
    const base = { version: bundle.version, questions: bundle.questions.map(q => {
      if (!object(q)) return q;
      const result = Object.fromEntries(BASE_FIELDS.filter(key => Object.hasOwn(q, key)).map(key => [key, q[key]]));
      if (object(result.answer)) result.answer = Object.fromEntries(Object.entries(result.answer).filter(([key]) => key !== 'acceptedValues'));
      return result;
    }) };
    const bonusExceptions = new Set();
    bundle.questions.forEach((q, index) => {
      if (q?.answer?.type !== 'bonus') return;
      bonusExceptions.add(`questions[${index}].answer.type: unsupported type; do not guess how to grade it`);
      bonusExceptions.add(`questions[${index}].marking.incorrect: must be zero or negative`);
      bonusExceptions.add(`questions[${index}].marking.unanswered: only explicit zero is supported`);
    });
    errors.push(...validateQuestionCatalog(base, archiveCopy).filter(error => !bonusExceptions.has(error)).map(error => `${bp}: ${error}`));
    bundle.questions.forEach((q, qi) => {
      const path = `${bp}.questions[${qi}]`;
      if (!object(q)) return;
      keys(q, [...BASE_FIELDS, ...EXTRA_FIELDS], [...BASE_FIELDS.filter(key => key !== 'options'), 'chapters', 'chapterReview', 'solution', 'assets'], path, errors);
      // The staging validator returns before catalog resolution if any format
      // is unsupported (including our explicit bonus extension). Resolve every
      // record here too, so a bonus cannot bypass provenance for its bundle.
      const sourcePaper = archiveMap.get(q.paperId);
      if (!sourcePaper) errors.push(`${path}.paperId: not found in the source catalog`);
      else {
        if (q.year !== sourcePaper.year || q.exam !== sourcePaper.exam || (sourcePaper.subject !== 'all' && q.subject !== sourcePaper.subject)) errors.push(`${path}: exam identity does not match its source paper`);
        try { if (![sourcePaper.url, sourcePaper.sourceUrl].map(url => new URL(url).href).includes(new URL(q.source.url).href)) errors.push(`${path}.source.url: must resolve to the catalog paper or its source listing`); }
        catch { errors.push(`${path}.source.url: invalid catalog provenance`); }
      }
      if (!stableId(q.id)) errors.push(`${path}.id: expected stable content ID`);
      if (object(q.answer)) keys(q.answer, ['type', 'value', 'acceptedRange', 'acceptedValues'], ['type', 'value'], `${path}.answer`, errors);
      if (q.matchingLists !== undefined) {
        const lists = q.matchingLists;
        if (!object(lists)) errors.push(`${path}.matchingLists: expected labelled left and right lists`);
        else {
          keys(lists, ['left', 'right'], ['left', 'right'], `${path}.matchingLists`, errors);
          for (const side of ['left', 'right']) {
            const entries = lists[side];
            if (!Array.isArray(entries) || entries.length < 2 || entries.length > 20) errors.push(`${path}.matchingLists.${side}: expected 2–20 source entries`);
            else {
              const labels = new Set();
              entries.forEach((entry, index) => {
                const ep = `${path}.matchingLists.${side}[${index}]`;
                if (!object(entry)) { errors.push(`${ep}: expected labelled source text`); return; }
                keys(entry, ['label', 'text'], ['label', 'text'], ep, errors);
                if (!text(entry.label) || labels.has(entry.label) || !text(entry.text)) errors.push(`${ep}: labels must be distinct and source text must be present`);
                labels.add(entry.label);
              });
            }
          }
        }
      }
      if (!Array.isArray(q.chapters) || !q.chapters.length || q.chapters.length > 10 || new Set(q.chapters).size !== q.chapters.length || q.chapters.some(id => !CHAPTERS.some(c => c.id === id && c.subject === q.subject))) errors.push(`${path}.chapters: expected distinct chapter IDs belonging to the question subject`);
      review(q.chapterReview, `${path}.chapterReview`, errors);
      if (!object(q.solution)) errors.push(`${path}.solution: a sourced reviewed solution is required`);
      else {
        keys(q.solution, ['steps', 'sourceUrl', 'review'], ['steps', 'sourceUrl', 'review'], `${path}.solution`, errors);
        if (!Array.isArray(q.solution.steps) || !q.solution.steps.length || q.solution.steps.length > 100 || q.solution.steps.some(step => !text(step) || step.length > 20000)) errors.push(`${path}.solution.steps: expected 1–100 nonempty reasoning steps`);
        if (!isWebUrl(q.solution.sourceUrl)) errors.push(`${path}.solution.sourceUrl: expected solution source URL`);
        review(q.solution.review, `${path}.solution.review`, errors);
      }
      if (!Array.isArray(q.assets) || q.assets.length > 40) errors.push(`${path}.assets: expected up to 40 declared image assets`);
      else {
        const ids = new Set();
        q.assets.forEach((asset, ai) => {
          const ap = `${path}.assets[${ai}]`;
          if (!object(asset)) { errors.push(`${ap}: expected image asset`); return; }
          keys(asset, ['id', 'url', 'alt', 'role', 'optionId', 'sourceUrl'], ['id', 'url', 'alt', 'role', 'sourceUrl'], ap, errors);
          if (!stableId(asset.id) || ids.has(asset.id)) errors.push(`${ap}.id: expected unique asset ID`);
          ids.add(asset.id);
          const url = assetUrl(asset.url);
          if (!url || !inventory.has(url)) errors.push(`${ap}.url: asset is unsafe or absent from the verified build inventory`);
          if (!text(asset.alt)) errors.push(`${ap}.alt: descriptive alternative text required`);
          if (!['statement', 'solution', 'option'].includes(asset.role)) errors.push(`${ap}.role: unsupported image location`);
          if (asset.role === 'option' ? !q.options?.some(option => option.id === asset.optionId) : asset.optionId !== undefined) errors.push(`${ap}.optionId: must identify the option only for an option image`);
          if (!isWebUrl(asset.sourceUrl)) errors.push(`${ap}.sourceUrl: original asset source is required`);
        });
      }
      if (q.answer?.type === 'numeric') {
        const answer = parseNumber(q.answer.value);
        if (!answer) errors.push(`${path}.answer.value: outside supported exact numeric grammar or length`);
        if (q.answer.acceptedRange !== undefined) {
          const range = q.answer.acceptedRange;
          const lo = Array.isArray(range) ? parseNumber(range[0]) : null;
          const hi = Array.isArray(range) ? parseNumber(range[1]) : null;
          if (!lo || !hi || !answer || compareNumber(lo, hi) > 0 || compareNumber(answer, lo) < 0 || compareNumber(answer, hi) > 0) errors.push(`${path}.answer.acceptedRange: exact bounds must contain the published answer`);
        }
        if (q.answer.acceptedValues !== undefined) {
          const values = q.answer.acceptedValues;
          const parsed = Array.isArray(values) ? values.map(value => typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? parseNumber(value) : null) : [];
          if (!Array.isArray(values) || values.length < 1 || values.length > 50 || parsed.some(value => !value) || !answer || !parsed.some(value => value && sameNumber(value, answer)) || q.answer.acceptedRange !== undefined) errors.push(`${path}.answer.acceptedValues: expected exact alternatives containing the key, without a continuous range`);
          if (parsed.some((value, index) => value && parsed.slice(0, index).some(previous => previous && sameNumber(previous, value)))) errors.push(`${path}.answer.acceptedValues: duplicate numerical alternative`);
        }
      } else if (q.answer?.acceptedValues !== undefined) errors.push(`${path}.answer.acceptedValues: only numeric answers can specify exact alternatives`);
      if (q.answer?.type === 'bonus') {
        if (q.answer.value !== null || q.answer.acceptedRange !== undefined) errors.push(`${path}.answer: bonus requires a null key and no range`);
        const m = q.marking;
        if (!m || !finite(m.correct) || m.correct <= 0 || m.correct !== m.incorrect || m.correct !== m.unanswered || m.partialCredits !== undefined) errors.push(`${path}.marking: bonus must explicitly award the same positive marks for every response`);
        const paper = archiveMap.get(q.paperId), authority = sourceMap.get(paper?.sourceId)?.authority;
        try {
          if (authority !== 'official' || new URL(q.review.answer.sourceUrl).origin !== new URL(paper.url).origin) errors.push(`${path}.review.answer: bonus requires official answer-key evidence on the paper source origin`);
        } catch { errors.push(`${path}.review.answer: missing official bonus evidence`); }
      }
      try { contentSize += JSON.stringify(q).length; } catch { errors.push(`${path}: content must be serializable`); }
      rawQuestions.push(q);
    });
  });
  if (rawQuestions.length > MAX_QUESTIONS || contentSize > MAX_CONTENT_CHARS) errors.push('content: exceeds bounded runtime capacity; split the registry into separately loaded collections');
  const ids = new Set(), identities = new Set();
  for (const q of rawQuestions) {
    const identity = JSON.stringify([q.paperId, q.subject, q.section, q.questionNumber]);
    if (ids.has(q.id)) errors.push(`content: duplicate ID ${q.id} across bundles`);
    if (identities.has(identity)) errors.push(`content: duplicate source question identity ${identity}`);
    ids.add(q.id); identities.add(identity);
  }
  fail(errors);

  const questions = freeze(rawQuestions.map(raw => {
    const q = copy(raw), paper = archiveMap.get(q.paperId);
    return { id: q.id, contentId: q.id, origin: 'pyq', paperId: q.paperId, paper: paper.paper, year: q.year, exam: q.exam, subject: q.subject, chapter: q.chapters[0], chapters: q.chapters, section: q.section, questionNumber: q.questionNumber, title: `${q.year} · ${paper.label} · Q${q.questionNumber}`, stem: q.statement, type: TYPES[q.answer.type], options: q.options ?? [], answer: q.answer.value, acceptedRange: q.answer.acceptedRange ?? null, acceptedValues: q.answer.acceptedValues ?? null, answerSpec: q.answer, marking: q.marking, solution: q.solution.steps, matchingLists: q.matchingLists ?? null, assets: q.assets.map(asset => ({ ...asset, url: assetUrl(asset.url) })), source: q.source, solutionSourceUrl: q.solution.sourceUrl, review: q.review, chapterReview: q.chapterReview, solutionReview: q.solution.review, status: q.status };
  }));
  const questionMap = new Map(questions.map(q => [q.id, q]));
  const configurations = new Map();
  papers.forEach((config, pi) => {
    const path = `papers[${pi}]`;
    if (!object(config)) { errors.push(`${path}: expected paper configuration`); return; }
    const fields = ['paperId', 'durationMinutes', 'expectedQuestionCount', 'maxMarks', 'sections', 'review'];
    keys(config, fields, fields, path, errors);
    if (!archiveMap.has(config.paperId)) errors.push(`${path}.paperId: unknown archive identity`);
    if (configurations.has(config.paperId)) errors.push(`${path}.paperId: duplicate configuration`);
    if (!positiveInteger(config.durationMinutes) || config.durationMinutes > 720) errors.push(`${path}.durationMinutes: expected 1–720 reviewed minutes`);
    if (!positiveInteger(config.expectedQuestionCount) || config.expectedQuestionCount > 500) errors.push(`${path}.expectedQuestionCount: expected 1–500 reviewed questions`);
    if (!finite(config.maxMarks) || config.maxMarks <= 0) errors.push(`${path}.maxMarks: expected positive reviewed total`);
    review(config.review, `${path}.review`, errors);
    const sectionIds = new Set(), questionIds = new Set();
    if (!Array.isArray(config.sections) || !config.sections.length || config.sections.length > 100) errors.push(`${path}.sections: expected ordered sections`);
    else config.sections.forEach((section, si) => {
      const sp = `${path}.sections[${si}]`;
      if (!object(section)) { errors.push(`${sp}: expected section configuration`); return; }
      const fields = ['id', 'title', 'subject', 'type', 'questionIds', 'marking', 'source', 'review'];
      keys(section, fields, fields, sp, errors);
      if (!text(section.id) || sectionIds.has(`${section.subject}:${section.id}`)) errors.push(`${sp}.id: duplicate or empty section identity within subject`);
      sectionIds.add(`${section.subject}:${section.id}`);
      if (!text(section.title)) errors.push(`${sp}.title: required`);
      if (!['physics', 'chemistry', 'mathematics'].includes(section.subject)) errors.push(`${sp}.subject: unsupported subject`);
      if (!['single', 'multiple', 'numerical'].includes(section.type)) errors.push(`${sp}.type: unsupported exam response format`);
      if (!Array.isArray(section.questionIds) || section.questionIds.length > 500 || section.questionIds.some(id => !stableId(id))) errors.push(`${sp}.questionIds: expected ordered stable question IDs`);
      else for (const id of section.questionIds) { if (questionIds.has(id)) errors.push(`${sp}.questionIds: question occurs twice in the paper`); questionIds.add(id); }
      source(section.source, `${sp}.source`, errors); review(section.review, `${sp}.review`, errors);
      const m = section.marking;
      if (!object(m)) errors.push(`${sp}.marking: explicit section marking is required`);
      else {
        keys(m, ['correct', 'incorrect', 'unanswered', 'partialCreditRules'], ['correct', 'incorrect', 'unanswered'], `${sp}.marking`, errors);
        if (!finite(m.correct) || m.correct <= 0 || !finite(m.incorrect) || m.incorrect > 0 || m.unanswered !== 0) errors.push(`${sp}.marking: expected positive full marks, nonpositive wrong marks, and zero unanswered marks`);
        if (m.partialCreditRules !== undefined) {
          if (section.type !== 'multiple' || !Array.isArray(m.partialCreditRules) || m.partialCreditRules.length > 100) errors.push(`${sp}.marking.partialCreditRules: only bounded explicit multiple-choice rules are supported`);
          else {
            const seen = new Set();
            m.partialCreditRules.forEach((rule, ri) => {
              const rp = `${sp}.marking.partialCreditRules[${ri}]`;
              if (!object(rule)) { errors.push(`${rp}: expected a rule`); return; }
              keys(rule, ['totalCorrect', 'selectedCorrect', 'marks'], ['totalCorrect', 'selectedCorrect', 'marks'], rp, errors);
              if (!positiveInteger(rule.totalCorrect) || rule.totalCorrect > 10 || !positiveInteger(rule.selectedCorrect) || rule.selectedCorrect >= rule.totalCorrect || !finite(rule.marks) || rule.marks <= 0 || rule.marks >= m.correct) errors.push(`${rp}: invalid correct-subset award`);
              const key = `${rule.totalCorrect}:${rule.selectedCorrect}`;
              if (seen.has(key)) errors.push(`${rp}: duplicate selection count`); seen.add(key);
            });
          }
        }
      }
    });
    if (questionIds.size > 500) errors.push(`${path}.sections: exceeds 500 ordered question identities`);
    configurations.set(config.paperId, copy(config));
  });
  fail(errors);

  function summarizePaper(paperId) {
    const paper = archiveMap.get(paperId), config = configurations.get(paperId);
    const loaded = questions.filter(q => q.paperId === paperId);
    const reasons = [];
    if (!config) reasons.push('No reviewed exam configuration is loaded.');
    if (paper.coverage !== 'full-paper') reasons.push('The source catalog does not establish a complete paper.');
    if (paper.questionCount === null || paper.maxMarks === null || paper.durationMinutes === null) reasons.push('Reviewed paper question count, total marks, and duration are not all established in the source catalog.');
    const orderedQuestionIds = config?.sections.flatMap(section => section.questionIds) ?? [];
    if (config) {
      if (config.expectedQuestionCount !== paper.questionCount || config.durationMinutes !== paper.durationMinutes || config.maxMarks !== paper.maxMarks) reasons.push('Exam configuration does not match the reviewed source catalog totals or duration.');
      if (orderedQuestionIds.length !== config.expectedQuestionCount) reasons.push('Ordered sections do not contain the expected number of questions.');
      const missing = orderedQuestionIds.filter(id => !questionMap.has(id));
      if (missing.length) reasons.push(`${missing.length} required question(s) are not loaded with reviewed solutions.`);
      if (loaded.length !== config.expectedQuestionCount || loaded.some(q => !orderedQuestionIds.includes(q.id))) reasons.push('Loaded questions do not exactly cover the configured paper.');
      if (paper.exam === 'jee-advanced' && !['physics', 'chemistry', 'mathematics'].every(subject => config.sections.some(section => section.subject === subject && section.questionIds.length))) reasons.push('A full JEE Advanced paper must include Physics, Chemistry and Mathematics sections.');
      let maximum = 0;
      for (const section of config.sections) {
        const sourceUrls = [paper.url, paper.sourceUrl].map(url => new URL(url).href);
        if (!sourceUrls.includes(new URL(section.source.url).href)) reasons.push(`Section ${section.id}: instruction source does not resolve to this paper.`);
        for (const id of section.questionIds) {
          const q = questionMap.get(id); if (!q) continue;
          maximum += q.marking.correct;
          if (q.paperId !== paperId || q.subject !== section.subject || q.section !== section.id || (q.type !== 'bonus' && q.type !== section.type)) reasons.push(`Question ${id}: paper, subject, section or response type does not match the configured order.`);
          if (q.marking.correct !== section.marking.correct || (q.type !== 'bonus' && (q.marking.incorrect !== section.marking.incorrect || q.marking.unanswered !== section.marking.unanswered))) reasons.push(`Question ${id}: marking differs from its source section.`);
          if (q.type === 'multiple') {
            const expected = new Map();
            for (const rule of section.marking.partialCreditRules ?? []) if (rule.totalCorrect === q.answer.length) for (const subset of subsets(q.answer, rule.selectedCorrect)) expected.set(keyFor(subset), rule.marks);
            const actual = new Map((q.marking.partialCredits ?? []).map(rule => [keyFor(rule.selected), rule.marks]));
            if (expected.size !== actual.size || [...expected].some(([key, marks]) => actual.get(key) !== marks)) reasons.push(`Question ${id}: explicit partial-credit selections do not match the section rules.`);
          }
        }
      }
      if (maximum !== config.maxMarks) reasons.push('The sum of question maximum marks does not match the reviewed paper total.');
    }
    return freeze({ paperId, year: paper.year, paper: paper.paper, exam: paper.exam, title: paper.label, sourceUrl: paper.url, loadedQuestionCount: loaded.length, expectedQuestionCount: config?.expectedQuestionCount ?? paper.questionCount, durationMinutes: config?.durationMinutes ?? paper.durationMinutes, maxMarks: config?.maxMarks ?? paper.maxMarks, status: reasons.length ? 'incomplete' : 'ready', complete: reasons.length === 0, reasons: [...new Set(reasons)], orderedQuestionIds, sections: config?.sections ?? [], review: config?.review ?? null });
  }
  const relevantPapers = [...new Set([...questions.map(q => q.paperId), ...configurations.keys()])];
  const summaries = freeze(relevantPapers.map(summarizePaper).sort((a,b) => b.year - a.year || (a.paper ?? 0) - (b.paper ?? 0) || a.paperId.localeCompare(b.paperId)));
  const summaryMap = new Map(summaries.map(paper => [paper.paperId, paper]));
  return Object.freeze({
    size: questions.length,
    getQuestion(id) { const q = questionMap.get(id); if (!q) throw new Error(`Unknown reviewed content ID: ${id}`); return q; },
    filterQuestions({ year, fromYear, toYear, subject = 'all', chapter = 'all', type = 'all', paperId, paper } = {}) {
      return freeze(questions.filter(q => (year == null || year === '' || q.year === Number(year)) && (fromYear == null || q.year >= Number(fromYear)) && (toYear == null || q.year <= Number(toYear)) && (subject === 'all' || q.subject === subject) && (chapter === 'all' || q.chapters.includes(chapter)) && (type === 'all' || q.type === type) && (paperId == null || q.paperId === paperId) && (paper == null || q.paper === Number(paper))));
    },
    listPapers() { return summaries; },
    getPaper(id) { if (!archiveMap.has(id)) throw new Error(`Unknown archive paper: ${id}`); return summaryMap.get(id) ?? summarizePaper(id); },
    getFullPaper(id) {
      if (!archiveMap.has(id)) throw new Error(`Unknown archive paper: ${id}`);
      const summary = summaryMap.get(id) ?? summarizePaper(id);
      if (!summary.complete) throw new Error(`This paper is not ready for a full mock: ${summary.reasons.join(' ')}`);
      return freeze({ ...summary, questions: summary.orderedQuestionIds.map(questionId => questionMap.get(questionId)) });
    },
  });
}

/** Grade a normalized reviewed question using only its explicit source rules. */
export function gradeContentQuestion(question, response) {
  const q = question, m = q?.marking;
  if (!q || q.origin !== 'pyq' || q.status !== 'practice-ready' || !Object.values(TYPES).includes(q.type) || !m || !finite(m.correct) || m.correct <= 0) throw new Error('Expected a normalized reviewed content question');
  const result = (score, status) => ({ score, maxScore: m.correct, status });
  if (q.type === 'bonus') {
    if (q.answer !== null || m.correct !== m.incorrect || m.correct !== m.unanswered) throw new Error('Invalid official bonus rule');
    return result(m.correct, 'bonus');
  }
  if (!finite(m.incorrect) || m.incorrect > 0 || m.unanswered !== 0) throw new Error('Invalid source marking scheme');
  if (response == null || response === '' || (Array.isArray(response) && !response.length) || (typeof response === 'string' && !response.trim())) return result(m.unanswered, 'skipped');
  if (q.type === 'numerical') {
    const value = parseNumber(response), answer = parseNumber(q.answer);
    if (!answer) throw new Error('Invalid reviewed numerical key');
    if (!value) return result(m.incorrect, 'incorrect');
    if (q.acceptedValues) return q.acceptedValues.some(candidate => { const alternative = parseNumber(candidate); if (!alternative) throw new Error('Invalid reviewed exact alternative'); return sameNumber(value, alternative); }) ? result(m.correct, 'correct') : result(m.incorrect, 'incorrect');
    if (q.acceptedRange) {
      const [lo, hi] = q.acceptedRange.map(parseNumber);
      if (!lo || !hi || compareNumber(lo, hi) > 0) throw new Error('Invalid reviewed answer range');
      return compareNumber(value, lo) >= 0 && compareNumber(value, hi) <= 0 ? result(m.correct, 'correct') : result(m.incorrect, 'incorrect');
    }
    return sameNumber(value, answer) ? result(m.correct, 'correct') : result(m.incorrect, 'incorrect');
  }
  const optionIds = new Set(q.options.map(option => option.id));
  if (q.type === 'single') return typeof response === 'string' && response === q.answer ? result(m.correct, 'correct') : result(m.incorrect, 'incorrect');
  if (!Array.isArray(response) || new Set(response).size !== response.length || response.some(id => !optionIds.has(id))) return result(m.incorrect, 'incorrect');
  if (keyFor(response) === keyFor(q.answer)) return result(m.correct, 'correct');
  const partial = (m.partialCredits ?? []).find(rule => keyFor(rule.selected) === keyFor(response));
  return partial ? result(partial.marks, 'partial') : result(m.incorrect, 'incorrect');
}
