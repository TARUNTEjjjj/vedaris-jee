import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, cp, rm, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {checkMockConfiguration, checkPlannedQuestions, emptyImportPlan, planReadiness, validateImportPlan} from '../scripts/import-plan.mjs';
import {renderStatus} from '../scripts/import-plan-status.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const readJSON = async path => JSON.parse(await readFile(join(repo, path), 'utf8'));
const archive = await readJSON('data/archive.json');
const committedPlan = await readJSON('content/historical-import-plan.json');
const PAPER = 'official-2021-paper-1-en';
const URL_2021 = 'https://jeeadv.ac.in/past_qps/2021_1_English.pdf';
const KEY = 'https://example.org/synthetic-final-key.pdf';
const SHA = 'a'.repeat(64);

// Synthetic, self-consistent records for gate tests. They reference no real
// question content; numbers and marks are arbitrary fixtures.
const decided = (status = 'granted') => ({status, basis: 'Synthetic test decision', evidenceUrl: 'https://example.org/permission', decidedBy: 'Test Owner', decidedAt: '2026-11-19'});
const review = kind => ({kind, reviewer: kind === 'human' ? 'Test Editor' : 'Codex (AI-assisted)', reviewedAt: '2026-11-19', evidenceUrl: KEY});
function testArchive() {
  const value = structuredClone(archive);
  const paper = value.papers.find(item => item.id === PAPER);
  Object.assign(paper, {questionCount: 3, maxMarks: 10});
  return value;
}
function readyPlan({human = true} = {}) {
  const plan = structuredClone(committedPlan);
  plan.tranches[0].ownerApproval = decided();
  const record = plan.papers.find(item => item.paperId === PAPER);
  record.stage = 'ready';
  record.source.questionPaper = {url: URL_2021, sha256: SHA, pageCount: 12, language: 'English', checkedBy: 'Test Checker', checkedAt: '2026-11-19'};
  record.source.finalKey = {status: 'verified', url: KEY, sha256: SHA, archivedOfficialOrigin: false};
  record.source.instructions = {status: 'recorded', pages: [1]};
  record.completeness = {status: 'complete', missingPages: [], checkedBy: 'Test Checker', checkedAt: '2026-11-19'};
  record.format = {questionCount: 3, maxMarks: 10, durationMinutes: 180, sections: [
    {id: 'section-1', subject: 'physics', type: 'single', questionNumbers: ['1'], marking: {correct: 4, incorrect: -1, unanswered: 0}, instructionPage: 1},
    {id: 'section-1', subject: 'chemistry', type: 'numerical', questionNumbers: ['1'], marking: {correct: 3, incorrect: 0, unanswered: 0}, instructionPage: 1},
    {id: 'section-1', subject: 'mathematics', type: 'numerical', questionNumbers: ['1'], marking: {correct: 3, incorrect: 0, unanswered: 0}, instructionPage: 1},
  ]};
  const reviews = () => Object.fromEntries(['transcript', 'answer', 'marking'].map(field => [field, human ? [review('ai-assisted'), review('human')] : [review('ai-assisted')]]));
  record.questions = ['physics', 'chemistry', 'mathematics'].map((subject, i) => ({subject, number: '1', section: 'section-1', pdfPage: 2 + i, status: 'staged', contentId: `2021_P1_${subject[0].toUpperCase()}${subject.slice(1)}_Q01-v1`, finalKey: {status: 'recorded', evidencePage: 1}, reviews: reviews()}));
  record.provenance = {transcriptSource: 'https://example.org/transcripts', transcriptRevision: 'synthetic', notes: ''};
  record.permissions = {questionText: decided(), figures: decided('not-required'), answerKey: decided(), explanations: decided('not-required')};
  return plan;
}

test('the committed plan is valid, selects a bounded first tranche and records no content', () => {
  assert.deepEqual(validateImportPlan(committedPlan, archive), []);
  assert.deepEqual(committedPlan.tranches.map(t => t.paperIds), [['official-2021-paper-1-en', 'official-2021-paper-2-en']]);
  assert.equal(committedPlan.tranches[0].ownerApproval.status, 'pending-owner');
  for (const record of committedPlan.papers) {
    for (const component of Object.values(record.permissions)) assert.equal(component.status, 'pending-owner', 'permissions are owner tasks');
    assert.equal(record.questions.length, 0, 'no questions are referenced before source inspection');
    const readiness = planReadiness(committedPlan, archive, record.paperId);
    assert.ok(readiness.publication.length && readiness.mock.length);
    assert.equal(readiness.certification, 'none');
  }
});

test('question content is refused anywhere in the plan', () => {
  const plan = structuredClone(committedPlan);
  plan.papers[0].notes = 'fine';
  plan.papers[0].questions = [{subject: 'physics', number: '1', section: 's', pdfPage: 1, status: 'pending', contentId: null, finalKey: {status: 'pending', evidencePage: null}, reviews: {transcript: [], answer: [], marking: []}, statement: 'copied text'}];
  assert.match(validateImportPlan(plan, archive).join('\n'), /statement: question content does not belong/);
});

test('owner decisions need basis, person and date, and pending ones carry none', () => {
  const plan = structuredClone(committedPlan);
  plan.papers[0].permissions.questionText = {status: 'granted', basis: null, evidenceUrl: null, decidedBy: null, decidedAt: null};
  plan.papers[0].permissions.figures = {status: 'pending-owner', basis: 'assumed fine', evidenceUrl: null, decidedBy: null, decidedAt: null};
  const errors = validateImportPlan(plan, archive).join('\n');
  assert.match(errors, /questionText.basis: a granted decision needs its basis/);
  assert.match(errors, /questionText.evidenceUrl: granted permission needs/);
  assert.match(errors, /figures.basis: must be null until the owner decides/);
});

test('AI-assisted review cannot be recorded as human certification', () => {
  const plan = readyPlan();
  plan.papers[0].questions[0].reviews.transcript[1].reviewer = 'Claude model check';
  assert.match(validateImportPlan(plan, testArchive()).join('\n'), /cannot be recorded as human certification/);
});

test('missing pages, withdrawn and missing questions must be tracked explicitly', () => {
  const plan = readyPlan();
  const record = plan.papers[0];
  record.completeness.missingPages = [7];
  record.questions[1].status = 'withdrawn';
  record.questions[2] = {...record.questions[2], status: 'missing', pdfPage: null, contentId: null};
  const errors = validateImportPlan(plan, testArchive()).join('\n');
  assert.match(errors, /a paper with missing pages is not complete/);
  assert.match(errors, /withdrawn question needs a withdrawn-question or bonus revision/);
  assert.match(errors, /missing question needs a missing-page revision/);
  record.completeness.status = 'incomplete';
  record.revisions = [
    {kind: 'bonus', questionRef: 'chemistry:1', page: null, evidenceUrl: KEY, recordedAt: '2026-11-19', resolution: 'resolved', disposition: {marksAwarded: 3, includesBlank: true}},
    {kind: 'missing-page', questionRef: 'mathematics:1', page: 7, evidenceUrl: URL_2021, recordedAt: '2026-11-19', resolution: 'open'},
  ];
  assert.deepEqual(validateImportPlan(plan, testArchive()), []);
  const mock = planReadiness(plan, testArchive(), PAPER).mock.join('\n');
  assert.match(mock, /Source completeness is incomplete/);
  assert.match(mock, /Missing pages: 7/);
  assert.match(mock, /mathematics Q1 is missing from the source/);
  assert.match(mock, /Open missing-page revision for mathematics:1/);
  assert.doesNotMatch(mock, /chemistry Q1/, 'a withdrawn question with an official disposition does not block');
});

test('mock gate passes only when every question, total and duration is established', () => {
  const plan = readyPlan();
  const catalog = testArchive();
  assert.deepEqual(validateImportPlan(plan, catalog), []);
  const ready = planReadiness(plan, catalog, PAPER);
  assert.deepEqual(ready.publication, []);
  assert.deepEqual(ready.mock, []);
  assert.equal(ready.certification, 'human-certified');
  const mismatch = structuredClone(catalog);
  mismatch.papers.find(p => p.id === PAPER).maxMarks = 11;
  assert.match(planReadiness(plan, mismatch, PAPER).mock.join('\n'), /catalog totals and duration do not match/);
  const short = readyPlan();
  short.papers[0].questions.pop();
  assert.match(planReadiness(short, catalog, PAPER).mock.join('\n'), /2 of 3 original questions are referenced/);
});

test('AI-only review is distinguished and does not unlock a mock while human certification is required', () => {
  const plan = readyPlan({human: false});
  const readiness = planReadiness(plan, testArchive(), PAPER);
  assert.equal(readiness.certification, 'ai-assisted-only');
  assert.match(readiness.mock.join('\n'), /lacks human-certified transcript, answer and marking reviews/);
  plan.policy.requireHumanCertificationForMock = false;
  assert.deepEqual(planReadiness(plan, testArchive(), PAPER).mock, []);
  assert.equal(planReadiness(plan, testArchive(), PAPER).certification, 'ai-assisted-only');
});

test('staging refuses historical questions until the plan permits them', () => {
  const question = {id: '2021_P1_Physics_Q01-v1', paperId: PAPER, subject: 'physics', questionNumber: '1'};
  assert.match(checkPlannedQuestions(emptyImportPlan(), archive, [question]).join('\n'), /not in the reviewed import plan/);
  assert.match(checkPlannedQuestions(committedPlan, archive, [question]).join('\n'), /Owner approval of tranche-1 is pending-owner/);
  assert.deepEqual(checkPlannedQuestions(readyPlan(), testArchive(), [question]), []);
  assert.match(checkPlannedQuestions(readyPlan(), testArchive(), [{...question, questionNumber: '9'}]).join('\n'), /not referenced in the import plan/);
  // Reviewed 2022+ papers are outside the historical plan.
  assert.deepEqual(checkPlannedQuestions(emptyImportPlan(), archive, [{...question, paperId: 'official-2023-paper-1-en'}]), []);
});

test('the plan cannot narrow its historical scope to move papers out of the gates', () => {
  const plan = structuredClone(committedPlan);
  plan.policy.appliesBeforeYear = 2020;
  plan.papers = []; plan.tranches = [];
  assert.match(validateImportPlan(plan, archive).join('\n'), /appliesBeforeYear: cannot be below 2022/);
  // Even an unvalidated narrowed plan keeps 2021 in scope.
  assert.match(checkPlannedQuestions(plan, archive, [{id: '2021_P1_Physics_Q01-v1', paperId: PAPER, subject: 'physics', questionNumber: '1'}]).join('\n'), /not in the reviewed import plan/);
});

test('publication pins stable content IDs and staged status; withdrawn questions publish only as bonus records', () => {
  const question = {id: '2021_P1_Physics_Q01-v1', paperId: PAPER, subject: 'physics', questionNumber: '1', answer: {type: 'single-choice', value: 'A'}};
  const plan = readyPlan();
  assert.deepEqual(checkPlannedQuestions(plan, testArchive(), [question], {stage: 'publication'}), []);
  assert.match(checkPlannedQuestions(plan, testArchive(), [{...question, id: '2021_P1_Physics_Q01-v2'}], {stage: 'publication'}).join('\n'), /records physics Q1 as 2021_P1_Physics_Q01-v1, not 2021_P1_Physics_Q01-v2/);
  const pending = readyPlan();
  Object.assign(pending.papers[0].questions[0], {status: 'pending', contentId: null});
  assert.deepEqual(checkPlannedQuestions(pending, testArchive(), [question], {stage: 'staging'}), []);
  const refused = checkPlannedQuestions(pending, testArchive(), [question], {stage: 'publication'}).join('\n');
  assert.match(refused, /physics Q1 as pending; publish only staged questions/);
  assert.match(refused, /does not pin a content ID/);
  const withdrawn = readyPlan();
  withdrawn.papers[0].questions[0].status = 'withdrawn';
  withdrawn.papers[0].revisions = [{kind: 'bonus', questionRef: 'physics:1', page: null, evidenceUrl: KEY, recordedAt: '2026-11-19', resolution: 'resolved', disposition: {marksAwarded: 4, includesBlank: true}}];
  assert.deepEqual(validateImportPlan(withdrawn, testArchive()), []);
  assert.match(checkPlannedQuestions(withdrawn, testArchive(), [question], {stage: 'publication'}).join('\n'), /records physics Q1 as withdrawn/);
  assert.deepEqual(checkPlannedQuestions(withdrawn, testArchive(), [{...question, answer: {type: 'bonus'}}], {stage: 'publication'}), []);
});

test('a historical mock configuration must reproduce the recorded duration, marks, questions and marking', () => {
  const plan = readyPlan();
  const ids = plan.papers[0].questions.map(q => q.contentId);
  const sections = plan.papers[0].format.sections.map((section, i) => ({id: section.id, subject: section.subject, type: section.type, questionIds: [ids[i]], marking: {...section.marking}}));
  const config = {paperId: PAPER, durationMinutes: 180, maxMarks: 10, expectedQuestionCount: 3, sections};
  assert.deepEqual(checkMockConfiguration(plan, testArchive(), config), []);
  const altered = structuredClone(config);
  Object.assign(altered, {durationMinutes: 200, maxMarks: 12, expectedQuestionCount: 2});
  altered.sections[0].marking.incorrect = 0;
  altered.sections[2].questionIds = [];
  const errors = checkMockConfiguration(plan, testArchive(), altered).join('\n');
  assert.match(errors, /duration 200 differs from the recorded original 180/);
  assert.match(errors, /maximum marks 12 differ/);
  assert.match(errors, /question count 2 differs/);
  assert.match(errors, /physics Q1 marking differs/);
  assert.match(errors, /mathematics Q1 is not in the configured question order/);
  assert.deepEqual(checkMockConfiguration(plan, testArchive(), {...config, paperId: 'official-2023-paper-1-en', durationMinutes: 1}), [], 'reviewed 2022+ papers are outside the plan');
});

test('the content build refuses unplanned historical bundles and locks their full mocks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vedaris-plan-build-'));
  try {
    const {prepareContent} = await import('../scripts/build-content.mjs');
    await mkdir(join(root, 'content'), {recursive: true});
    const bundle = {version: 1, questions: [{id: '2021_P1_Physics_Q01-v1', paperId: PAPER, year: 2021, subject: 'physics', questionNumber: '1'}]};
    await writeFile(join(root, 'content/2021-p1.json'), JSON.stringify(bundle));
    await writeFile(join(root, 'content/catalog.json'), JSON.stringify({version: 1, bankId: 'vedaris-reviewed-jee-v1', bundles: [{path: 'content/2021-p1.json'}], papers: [{paperId: PAPER}], attributions: [], coverageNotes: []}));
    await assert.rejects(prepareContent(root, archive, []), /not in the reviewed import plan[\s\S]*Full mock official-2021-paper-1-en stays locked/);
    await writeFile(join(root, 'content/historical-import-plan.json'), JSON.stringify(committedPlan));
    await assert.rejects(prepareContent(root, archive, []), /publication blocked: Owner approval/);
    const invalid = structuredClone(committedPlan);
    invalid.papers[0].source.questionPaper.url = 'https://example.org/other.pdf';
    await writeFile(join(root, 'content/historical-import-plan.json'), JSON.stringify(invalid));
    await assert.rejects(prepareContent(root, archive, []), /Historical import plan is invalid/);
    // A plan whose mock gate passes still refuses a configuration that changes the original format.
    await writeFile(join(root, 'content/historical-import-plan.json'), JSON.stringify(readyPlan()));
    await writeFile(join(root, 'content/catalog.json'), JSON.stringify({version: 1, bankId: 'vedaris-reviewed-jee-v1', bundles: [{path: 'content/2021-p1.json'}], papers: [{paperId: PAPER, durationMinutes: 240, maxMarks: 10, expectedQuestionCount: 3, sections: []}], attributions: [], coverageNotes: []}));
    await assert.rejects(prepareContent(root, testArchive(), []), /Full mock official-2021-paper-1-en: duration 240 differs from the recorded original 180/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('planned figures must match their recorded SHA-256 at build time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vedaris-plan-asset-'));
  try {
    const {prepareContent} = await import('../scripts/build-content.mjs');
    await mkdir(join(root, 'content'), {recursive: true});
    await mkdir(join(root, 'assets/content/2021-p1'), {recursive: true});
    const bytes = Buffer.from('synthetic image bytes');
    await writeFile(join(root, 'assets/content/2021-p1/fig.png'), bytes);
    const plan = readyPlan();
    plan.papers[0].assets = [{path: 'assets/content/2021-p1/fig.png', questionRef: 'physics:1', sourcePage: 2, sha256: createHash('sha256').update('different').digest('hex'), derivedFrom: 'synthetic crop'}];
    await writeFile(join(root, 'content/historical-import-plan.json'), JSON.stringify(plan));
    const bundle = {version: 1, questions: [{id: '2021_P1_Physics_Q01-v1', paperId: PAPER, year: 2021, subject: 'physics', questionNumber: '1', assets: [{url: 'assets/content/2021-p1/fig.png'}]}]};
    await writeFile(join(root, 'content/2021-p1.json'), JSON.stringify(bundle));
    await writeFile(join(root, 'content/catalog.json'), JSON.stringify({version: 1, bankId: 'vedaris-reviewed-jee-v1', bundles: [{path: 'content/2021-p1.json'}], papers: [], attributions: [], coverageNotes: []}));
    await assert.rejects(prepareContent(root, testArchive(), ['assets/content/2021-p1/fig.png']), /does not match its recorded SHA-256/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('staging CLI refuses a historical batch without plan permission and writes nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vedaris-plan-cli-'));
  try {
    await mkdir(join(root, 'scripts'), {recursive: true});
    await cp(join(repo, 'src/archive'), join(root, 'src/archive'), {recursive: true});
    await cp(join(repo, 'scripts/import-pyq.mjs'), join(root, 'scripts/import-pyq.mjs'));
    await cp(join(repo, 'scripts/import-plan.mjs'), join(root, 'scripts/import-plan.mjs'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await mkdir(join(root, 'data'), {recursive: true});
    await cp(join(repo, 'data/archive.json'), join(root, 'data/archive.json'));
    const r = {reviewer: 'Editorial reviewer', reviewedAt: '2026-11-19', sourceUrl: KEY};
    const batch = {version: 1, questions: [{id: '2021_P1_Physics_Q01-v1', paperId: PAPER, year: 2021, exam: 'jee-advanced', subject: 'physics', section: 'section-1', questionNumber: '1', source: {url: URL_2021, page: 2},
      statement: 'Synthetic schema fixture, not an official question.', options: [{id: 'A', text: 'one'}, {id: 'B', text: 'two'}], answer: {type: 'single-choice', value: 'A'}, marking: {correct: 4, incorrect: -1, unanswered: 0}, review: {transcript: r, answer: r, marking: r}, status: 'practice-ready'}]};
    await writeFile(join(root, 'batch.json'), JSON.stringify(batch));
    let result = spawnSync(process.execPath, ['scripts/import-pyq.mjs', 'batch.json'], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not in the reviewed import plan/);
    await mkdir(join(root, 'content'), {recursive: true});
    await writeFile(join(root, 'content/historical-import-plan.json'), JSON.stringify(committedPlan));
    result = spawnSync(process.execPath, ['scripts/import-pyq.mjs', 'batch.json'], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /staging blocked: Reuse permission for questionText is pending-owner/);
    await assert.rejects(readdir(join(root, 'data/imports/validated')), {code: 'ENOENT'});
    result = spawnSync(process.execPath, ['scripts/import-pyq.mjs', 'batch.json', '--bogus', 'x'], {cwd: root, encoding: 'utf8'});
    assert.match(result.stderr, /Usage/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('the documented coverage and remaining gaps match the plan and bank', async () => {
  const doc = await readFile(join(repo, 'docs/HISTORICAL-IMPORT-PLAN.md'), 'utf8');
  const status = await renderStatus();
  assert.ok(doc.includes(status), 'docs/HISTORICAL-IMPORT-PLAN.md is stale; run node scripts/import-plan-status.mjs --write');
});
