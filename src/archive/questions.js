import {isReviewDate, isWebUrl, validateArchive} from './index.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const decimal = value => typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
function keys(value, allowed, required, path, errors) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown field`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key}: required`);
}
function review(value, path, errors) {
  if (!object(value)) { errors.push(`${path}: expected a review record`); return; }
  keys(value, ['reviewer', 'reviewedAt', 'sourceUrl'], ['reviewer', 'reviewedAt', 'sourceUrl'], path, errors);
  if (!text(value.reviewer)) errors.push(`${path}.reviewer: required`);
  if (!isReviewDate(value.reviewedAt)) errors.push(`${path}.reviewedAt: expected real YYYY-MM-DD date`);
  if (!isWebUrl(value.sourceUrl)) errors.push(`${path}.sourceUrl: expected HTTP(S) evidence URL`);
}

/** Editorial validation is necessary, but does not prove the source or answer is correct. */
export function validateQuestionImport(bundle) {
  const errors = [];
  if (!object(bundle)) return ['import: expected an object'];
  keys(bundle, ['version', 'questions'], ['version', 'questions'], 'import', errors);
  if (bundle.version !== 1) errors.push('import.version: must be 1');
  if (!Array.isArray(bundle.questions) || bundle.questions.length < 1 || bundle.questions.length > 10000) return [...errors, 'import.questions: expected 1–10000 questions'];
  const ids = new Set();
  const identities = new Set();
  bundle.questions.forEach((q, index) => {
    const path = `questions[${index}]`;
    if (!object(q)) { errors.push(`${path}: expected an object`); return; }
    const fields = ['id', 'paperId', 'year', 'exam', 'subject', 'section', 'questionNumber', 'source', 'statement', 'options', 'answer', 'marking', 'review', 'status'];
    keys(q, fields, fields.filter(key => key !== 'options'), path, errors);
    for (const key of ['id', 'paperId', 'section', 'questionNumber', 'statement']) if (!text(q[key])) errors.push(`${path}.${key}: expected nonempty text`);
    if (typeof q.statement === 'string' && q.statement.length > 100000) errors.push(`${path}.statement: exceeds 100000 characters`);
    if (ids.has(q.id)) errors.push(`${path}.id: duplicate`);
    ids.add(q.id);
    if (!Number.isInteger(q.year) || q.year < 1961 || q.year > 2100) errors.push(`${path}.year: invalid year`);
    if (!['iit-jee', 'jee-advanced'].includes(q.exam) || (q.exam === 'iit-jee' && q.year >= 2013) || (q.exam === 'jee-advanced' && q.year < 2013)) errors.push(`${path}.exam: invalid exam era`);
    if (!['physics', 'chemistry', 'mathematics'].includes(q.subject)) errors.push(`${path}.subject: invalid subject`);
    const identity = JSON.stringify([q.paperId, q.subject, q.section, q.questionNumber]);
    if (identities.has(identity)) errors.push(`${path}: duplicate paper/subject/section/question identity`);
    identities.add(identity);
    if (!object(q.source)) errors.push(`${path}.source: required source record`);
    else {
      keys(q.source, ['url', 'page'], ['url', 'page'], `${path}.source`, errors);
      if (!isWebUrl(q.source.url)) errors.push(`${path}.source.url: expected HTTP(S) URL`);
      if (!Number.isInteger(q.source.page) || q.source.page < 1) errors.push(`${path}.source.page: expected 1-based positive page`);
    }
    const optionIds = new Set();
    if (q.options !== undefined) {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 20) errors.push(`${path}.options: expected 2–20 options`);
      else q.options.forEach((option, i) => {
        if (!object(option)) { errors.push(`${path}.options[${i}]: expected an object`); return; }
        keys(option, ['id', 'text'], ['id', 'text'], `${path}.options[${i}]`, errors);
        if (!text(option.id) || !text(option.text)) errors.push(`${path}.options[${i}]: id and text are required`);
        if (optionIds.has(option.id)) errors.push(`${path}.options[${i}].id: duplicate`);
        optionIds.add(option.id);
      });
    }
    if (!object(q.answer)) errors.push(`${path}.answer: required answer record`);
    else {
      keys(q.answer, ['type', 'value', 'acceptedRange', 'acceptedOptionSets'], ['type', 'value'], `${path}.answer`, errors);
      if (!['single-choice', 'multiple-choice', 'numeric'].includes(q.answer.type)) errors.push(`${path}.answer.type: unsupported type; do not guess how to grade it`);
      if (q.answer.type === 'single-choice' && (!text(q.answer.value) || !optionIds.has(q.answer.value))) errors.push(`${path}.answer.value: must identify an option`);
      if (q.answer.type === 'multiple-choice') {
        const value = q.answer.value;
        if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length || value.some(id => !optionIds.has(id))) errors.push(`${path}.answer.value: expected distinct correct option IDs`);
      }
      if (q.answer.acceptedOptionSets !== undefined) {
        const sets = q.answer.acceptedOptionSets;
        const primary = q.answer.type === 'single-choice' ? [q.answer.value] : q.answer.value;
        const key = set => JSON.stringify([...set].sort());
        const valid = ['single-choice', 'multiple-choice'].includes(q.answer.type) && Array.isArray(sets) && sets.length >= 2 && sets.length <= 20 && sets.every(set => Array.isArray(set) && set.length > 0 && (q.answer.type !== 'single-choice' || set.length === 1) && new Set(set).size === set.length && set.every(id => optionIds.has(id)));
        if (!valid || !Array.isArray(primary) || !sets.some(set => key(set) === key(primary)) || new Set(sets.map(key)).size !== sets.length) errors.push(`${path}.answer.acceptedOptionSets: expected distinct valid full-credit option sets containing the primary key`);
      }
      if (q.answer.type === 'numeric') {
        if (!decimal(q.answer.value)) errors.push(`${path}.answer.value: expected an exact decimal string`);
        if (q.options !== undefined) errors.push(`${path}.options: numeric questions cannot have options`);
        if (q.answer.acceptedRange !== undefined) {
          const range = q.answer.acceptedRange;
          if (!Array.isArray(range) || range.length !== 2 || !range.every(decimal) || Number(range[0]) > Number(range[1]) || Number(q.answer.value) < Number(range[0]) || Number(q.answer.value) > Number(range[1])) errors.push(`${path}.answer.acceptedRange: expected [minimum, maximum] decimal strings containing the answer`);
        }
      } else if (q.answer.acceptedRange !== undefined) errors.push(`${path}.answer.acceptedRange: only valid for numeric questions`);
    }
    if (!object(q.marking)) errors.push(`${path}.marking: required explicit marking scheme`);
    else {
      keys(q.marking, ['correct', 'incorrect', 'unanswered', 'partialCredits'], ['correct', 'incorrect', 'unanswered'], `${path}.marking`, errors);
      if (!finite(q.marking.correct) || q.marking.correct <= 0) errors.push(`${path}.marking.correct: must be positive and finite`);
      if (!finite(q.marking.incorrect) || q.marking.incorrect > 0) errors.push(`${path}.marking.incorrect: must be zero or negative`);
      if (q.marking.unanswered !== 0) errors.push(`${path}.marking.unanswered: only explicit zero is supported`);
      if (q.marking.partialCredits !== undefined) {
        if (q.answer?.type !== 'multiple-choice' || !Array.isArray(q.marking.partialCredits)) errors.push(`${path}.marking.partialCredits: only supported for multiple-choice with an explicit array`);
        else {
          const selections = new Set();
          q.marking.partialCredits.forEach((rule, i) => {
            const rulePath = `${path}.marking.partialCredits[${i}]`;
            if (!object(rule)) { errors.push(`${rulePath}: expected an object`); return; }
            keys(rule, ['selected', 'marks'], ['selected', 'marks'], rulePath, errors);
            const selected = rule.selected;
            const correctSets = Array.isArray(q.answer?.acceptedOptionSets) ? q.answer.acceptedOptionSets : [q.answer?.value];
            const properSubset = Array.isArray(selected) && selected.length > 0 && new Set(selected).size === selected.length && selected.every(id => optionIds.has(id)) && correctSets.some(set => Array.isArray(set) && selected.length < set.length && selected.every(id => set.includes(id))) && !correctSets.some(set => Array.isArray(set) && selected.length === set.length && selected.every(id => set.includes(id)));
            if (!properSubset) errors.push(`${rulePath}.selected: expected a nonempty proper subset of correct options, excluding every full-credit set`);
            if (!finite(rule.marks) || rule.marks <= 0 || rule.marks >= q.marking.correct) errors.push(`${rulePath}.marks: must be between zero and full credit`);
            if (Array.isArray(selected)) {
              const selection = JSON.stringify([...selected].sort());
              if (selections.has(selection)) errors.push(`${rulePath}.selected: duplicate partial-credit selection`);
              selections.add(selection);
            }
          });
        }
      }
    }
    if (!object(q.review)) errors.push(`${path}.review: required transcript, answer and marking reviews`);
    else {
      keys(q.review, ['transcript', 'answer', 'marking'], ['transcript', 'answer', 'marking'], `${path}.review`, errors);
      for (const field of ['transcript', 'answer', 'marking']) review(q.review[field], `${path}.review.${field}`, errors);
    }
    if (q.status !== 'practice-ready') errors.push(`${path}.status: only practice-ready submissions pass this staging gate`);
  });
  return errors;
}

/** Resolve staged records against the validated catalog; answer-key evidence is independent. */
export function validateQuestionCatalog(bundle, manifest) {
  const errors = [...validateQuestionImport(bundle), ...validateArchive(manifest).map(error => `catalog: ${error}`)];
  if (errors.length) return errors;
  const papers = new Map(manifest.papers.map(paper => [paper.id, paper]));
  bundle.questions.forEach((question, index) => {
    const path = `questions[${index}]`;
    const paper = papers.get(question.paperId);
    if (!paper) { errors.push(`${path}.paperId: not found in the source catalog`); return; }
    if (question.year !== paper.year) errors.push(`${path}.year: does not match catalog paper`);
    if (question.exam !== paper.exam) errors.push(`${path}.exam: does not match catalog paper`);
    if (paper.subject !== 'all' && question.subject !== paper.subject) errors.push(`${path}.subject: does not match catalog paper`);
    const allowedUrls = [paper.url, paper.sourceUrl].map(url => new URL(url).href);
    if (!allowedUrls.includes(new URL(question.source.url).href)) errors.push(`${path}.source.url: must match the catalog paper URL or source listing URL`);
  });
  return errors;
}
