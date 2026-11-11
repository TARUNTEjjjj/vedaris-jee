const SUBJECTS = ['all', 'physics', 'chemistry', 'mathematics'];
const ERAS = ['iit-jee', 'jee-advanced'];
const COVERAGE = ['full-paper', 'partial-collection', 'unknown'];
const VERIFICATION = ['link-observed', 'http-verified', 'pdf-verified'];
const AUTHORITIES = ['official', 'third-party'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
export function isWebUrl(value) {
  if (!text(value)) return false;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
export function isReviewDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function checkKeys(value, allowed, required, path, errors) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown field`);
  for (const key of required) if (!own(value, key)) errors.push(`${path}.${key}: required`);
}

/** Validates source metadata only. It does not certify remote document content. */
export function validateArchive(manifest) {
  const errors = [];
  if (!object(manifest)) return ['archive: expected an object'];
  checkKeys(manifest, ['version', 'checkedAt', 'sources', 'papers'], ['version', 'checkedAt', 'sources', 'papers'], 'archive', errors);
  if (manifest.version !== 1) errors.push('archive.version: must be 1');
  if (!isReviewDate(manifest.checkedAt)) errors.push('archive.checkedAt: expected a real YYYY-MM-DD date');
  if (!Array.isArray(manifest.sources)) errors.push('archive.sources: expected an array');
  if (!Array.isArray(manifest.papers)) errors.push('archive.papers: expected an array');
  if (!Array.isArray(manifest.sources) || !Array.isArray(manifest.papers)) return errors;
  const sourceIds = new Set();
  const paperIds = new Set();
  manifest.sources.forEach((source, i) => {
    const path = `sources[${i}]`;
    if (!object(source)) { errors.push(`${path}: expected an object`); return; }
    checkKeys(source, ['id', 'title', 'url', 'authority', 'notes'], ['id', 'title', 'url', 'authority', 'notes'], path, errors);
    for (const key of ['id', 'title']) if (!text(source[key])) errors.push(`${path}.${key}: expected nonempty text`);
    if (sourceIds.has(source.id)) errors.push(`${path}.id: duplicate ${source.id}`);
    sourceIds.add(source.id);
    if (!isWebUrl(source.url)) errors.push(`${path}.url: expected HTTP(S) URL without credentials`);
    if (!AUTHORITIES.includes(source.authority)) errors.push(`${path}.authority: invalid authority`);
    if (typeof source.notes !== 'string') errors.push(`${path}.notes: expected text`);
  });
  const fields = ['id', 'year', 'exam', 'label', 'subject', 'paper', 'sourceId', 'url', 'sourceUrl', 'verification', 'coverage', 'questionCount', 'durationMinutes', 'maxMarks', 'transcriptionStatus'];
  manifest.papers.forEach((paper, i) => {
    const path = `papers[${i}]`;
    if (!object(paper)) { errors.push(`${path}: expected an object`); return; }
    checkKeys(paper, fields, fields, path, errors);
    for (const key of ['id', 'label', 'sourceId']) if (!text(paper[key])) errors.push(`${path}.${key}: expected nonempty text`);
    if (paperIds.has(paper.id)) errors.push(`${path}.id: duplicate ${paper.id}`);
    paperIds.add(paper.id);
    if (!sourceIds.has(paper.sourceId)) errors.push(`${path}.sourceId: unknown source`);
    if (!Number.isInteger(paper.year) || paper.year < 1961 || paper.year > 2100) errors.push(`${path}.year: expected a year from 1961 to 2100`);
    if (isReviewDate(manifest.checkedAt) && paper.year > Number(manifest.checkedAt.slice(0, 4))) errors.push(`${path}.year: later than archive.checkedAt`);
    if (!ERAS.includes(paper.exam)) errors.push(`${path}.exam: invalid exam era`);
    if (paper.exam === 'jee-advanced' && paper.year < 2013) errors.push(`${path}.exam: JEE Advanced starts in 2013`);
    if (paper.exam === 'iit-jee' && paper.year >= 2013) errors.push(`${path}.exam: use jee-advanced for 2013 onwards`);
    if (!SUBJECTS.includes(paper.subject)) errors.push(`${path}.subject: invalid subject`);
    if (![null, 1, 2].includes(paper.paper)) errors.push(`${path}.paper: must be null, 1 or 2`);
    for (const key of ['url', 'sourceUrl']) if (!isWebUrl(paper[key])) errors.push(`${path}.${key}: expected HTTP(S) URL without credentials`);
    if (!VERIFICATION.includes(paper.verification)) errors.push(`${path}.verification: invalid verification level`);
    if (!COVERAGE.includes(paper.coverage)) errors.push(`${path}.coverage: invalid coverage`);
    for (const key of ['questionCount', 'durationMinutes']) if (paper[key] !== null && (!Number.isInteger(paper[key]) || paper[key] <= 0)) errors.push(`${path}.${key}: must be null or a positive integer`);
    if (paper.maxMarks !== null && (typeof paper.maxMarks !== 'number' || !Number.isFinite(paper.maxMarks) || paper.maxMarks <= 0)) errors.push(`${path}.maxMarks: must be null or a positive finite number`);
    if (paper.transcriptionStatus !== 'source-linked') errors.push(`${path}.transcriptionStatus: this catalog accepts source-linked records only`);
  });
  return errors;
}

/** All filters are conjunctive; the input list and objects are never mutated. */
export function filterPapers(papers, {query = '', era = 'all', subject = 'all', from, to, authority = 'all', sources = []} = {}) {
  const needle = String(query).trim().toLocaleLowerCase('en');
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  return papers.filter(paper => {
    const source = sourceMap.get(paper.sourceId);
    return (era === 'all' || !era || paper.exam === era)
      && (subject === 'all' || !subject || paper.subject === 'all' || paper.subject === subject)
      && (from === undefined || from === null || from === '' || paper.year >= Number(from))
      && (to === undefined || to === null || to === '' || paper.year <= Number(to))
      && (authority === 'all' || !authority || source?.authority === authority)
      && (!needle || [paper.label, paper.id, paper.year, paper.exam, paper.subject, source?.title].join(' ').toLocaleLowerCase('en').includes(needle));
  });
}

/** Year coverage means distinct listed years, never a complete-paper claim. */
export function archiveStats(manifest) {
  const papers = manifest.papers;
  const sourceMap = new Map(manifest.sources.map(source => [source.id, source]));
  const yearsListed = [...new Set(papers.map(paper => paper.year))].sort((a, b) => a - b);
  return {
    paperCount: papers.length, yearsListed, yearCount: yearsListed.length,
    firstYear: yearsListed[0] ?? null, lastYear: yearsListed.at(-1) ?? null,
    fullPaperCount: papers.filter(paper => paper.coverage === 'full-paper').length,
    partialCollectionCount: papers.filter(paper => paper.coverage === 'partial-collection').length,
    unknownCoverageCount: papers.filter(paper => paper.coverage === 'unknown').length,
    officialPaperCount: papers.filter(paper => sourceMap.get(paper.sourceId)?.authority === 'official').length,
    thirdPartyPaperCount: papers.filter(paper => sourceMap.get(paper.sourceId)?.authority === 'third-party').length,
    pdfVerifiedCount: papers.filter(paper => paper.verification === 'pdf-verified').length,
    sourceLinkedCount: papers.filter(paper => paper.transcriptionStatus === 'source-linked').length,
    practiceReadyCount: 0,
  };
}
