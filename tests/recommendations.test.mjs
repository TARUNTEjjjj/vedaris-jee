import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CHAPTERS, generate, listTemplates } from '../src/questions/index.js';
import { createSession, sessionItems, setResponse, finishSession, createRetrySession } from '../src/practice/session.js';
import { emptyProgress, recordSession, MAX_RECORDS } from '../src/learning/progress.js';
import { updateNotebook, emptyNotebook } from '../src/learning/notebook.js';
import { createHistoricalSession, answerHistorical, finishHistorical, emptyHistoricalWorkspace, saveHistoricalSession } from '../src/content/session.js';
import { TOPIC_RELATIONS, validateTopicRelations, prerequisitesOf, DRAFT_NOTICE } from '../src/learning/topic-relations.js';
import { emptyRevisionPlan, restoreRevisionPlan, addRevisionGoal, removeRevisionGoal, dismissRecommendation, undismissRecommendation, MAX_GOALS } from '../src/learning/revision-plan.js';
import { revisionRecommendations, MIN_CHAPTER_EVIDENCE, MIN_TOTAL_EVIDENCE } from '../src/learning/recommendations.js';

const NOW = 1_790_000_000_000;
const DAY = 86_400_000;

// A wrong response for any original item.
function wrong(item) {
  if (item.type === 'multiple') return [item.options.find(o => !item.answer.includes(o.id)).id];
  if (item.type === 'single') return item.options.find(o => o.id !== item.answer).id;
  return '999999';
}
/** Complete an original chapter session with chosen outcomes. */
function completed(chapter, outcomes, { seed = 1, now = NOW } = {}) {
  const subject = CHAPTERS.find(c => c.id === chapter).subject;
  let session = createSession({ subject, chapter, count: outcomes.length, seed, timed: false, now });
  const items = sessionItems(session);
  outcomes.forEach((outcome, index) => {
    if (outcome === 'skip') return;
    session = setResponse(session, index, outcome === 'correct' ? items[index].answer : wrong(items[index]), now + 1 + index);
  });
  return finishSession(session, now + 100);
}
const record = (progress, session) => recordSession(progress, session, session.finishedAt + 1);

// Synthetic PYQ registry: identities and keys are fixtures, not exam content.
const marking = { correct: 4, incorrect: -1, unanswered: 0 };
const options = ['A', 'B', 'C', 'D'].map(id => ({ id, text: `Option ${id}` }));
const pyqQuestions = [
  { id: 'SYN_P1_Physics_Q01-v1', subject: 'physics', chapters: ['phy-newton'] },
  { id: 'SYN_P1_Physics_Q02-v1', subject: 'physics', chapters: ['phy-newton', 'phy-work'] },
  { id: 'SYN_P1_Physics_Q03-v1', subject: 'physics', chapters: ['phy-newton'] },
  { id: 'SYN_P1_Physics_Q04-v1', subject: 'physics', chapters: ['phy-newton'] },
].map(q => ({ ...q, chapter: q.chapters[0], origin: 'pyq', status: 'practice-ready', type: 'single', options, answer: 'A', marking }));
const registry = { getQuestion(id) { const q = pyqQuestions.find(v => v.id === id); if (!q) throw new Error('Unknown reviewed content'); return q; } };
const BANK = 'synthetic-bank-v1';
function pyqReport(answers, now = NOW) {
  let s = createHistoricalSession(registry, { questionIds: Object.keys(answers), bankId: BANK, timed: false, seed: now % 1000, now });
  Object.values(answers).forEach((answer, index) => { s = answerHistorical(s, index, answer, registry, now + 1 + index); });
  return finishHistorical(s, now + 50);
}

test('draft relationships use canonical chapters, have no cycles and never claim review', () => {
  assert.deepEqual(validateTopicRelations(TOPIC_RELATIONS), []);
  assert.equal(TOPIC_RELATIONS.reviewStatus, 'unreviewed-draft');
  assert.ok(TOPIC_RELATIONS.edges.every(edge => edge.review.status === 'unreviewed-draft' && edge.rationale));
  const ids = new Set(CHAPTERS.map(c => c.id));
  assert.ok(TOPIC_RELATIONS.edges.every(edge => ids.has(edge.from) && ids.has(edge.to)));
  const edge = TOPIC_RELATIONS.edges[0];
  const dataset = edges => ({ version: 1, reviewStatus: 'unreviewed-draft', edges });
  assert.match(validateTopicRelations(dataset([{ ...edge, review: { status: 'reviewed' } }])).join(), /needs reviewer, reviewedAt and evidence/);
  assert.deepEqual(validateTopicRelations(dataset([{ ...edge, review: { status: 'reviewed', reviewer: 'Named teacher', reviewedAt: '2026-11-19', evidence: 'Syllabus comparison notes' } }])), []);
  assert.match(validateTopicRelations(dataset([{ ...edge, review: { status: 'reviewed', reviewer: 'x', reviewedAt: '2026-02-30', evidence: 'y' } }])).join(), /reviewer/);
  assert.match(validateTopicRelations({ ...dataset([edge]), reviewStatus: 'reviewed' }).join(), /every edge is reviewed/);
  assert.match(validateTopicRelations(dataset([{ ...edge, to: 'phy-unknown' }])).join(), /unknown chapter/);
  assert.match(validateTopicRelations(dataset([{ ...edge, to: edge.from }])).join(), /self-prerequisite/);
  assert.match(validateTopicRelations(dataset([edge, edge])).join(), /duplicate/);
  assert.match(validateTopicRelations(dataset([edge, { ...edge, from: edge.to, to: edge.from }])).join(), /cycle/);
  assert.ok(prerequisitesOf('phy-newton').some(e => e.from === 'phy-kinematics'));
  assert.equal(prerequisitesOf('phy-newton', dataset([{ ...TOPIC_RELATIONS.edges.find(e => e.to === 'phy-newton'), review: { status: 'rejected' } }])).length, 0);
});

test('empty, deleted and sparse local data produce explicit states instead of guesses', () => {
  for (const input of [{}, { progress: null, notebook: null, plan: undefined }, { progress: emptyProgress(), plan: emptyRevisionPlan() }]) {
    const result = revisionRecommendations({ ...input, now: NOW });
    assert.equal(result.state, 'empty');
    assert.deepEqual(result.recommendations, []);
    assert.equal(result.relations.notice, DRAFT_NOTICE);
  }
  const progress = record(emptyProgress(), completed('phy-newton', ['incorrect', 'incorrect']));
  const sparse = revisionRecommendations({ progress, now: NOW + DAY });
  assert.equal(sparse.state, 'sparse');
  assert.ok(MIN_TOTAL_EVIDENCE > 2);
  assert.deepEqual(sparse.recommendations, [], 'no ranked suggestion from two attempts');
  assert.equal(sparse.limited.length, 1);
  assert.equal(sparse.limited[0].evidenceLevel, 'limited');
  assert.match(sparse.limited[0].reasons.find(r => r.kind === 'sparse').text, /Only 2 retained attempts/);
  assert.match(sparse.message, /not enough evidence/);
});

test('recommendations cite retained first attempts and keep evidence kinds separate', () => {
  let progress = emptyProgress();
  progress = record(progress, completed('phy-newton', ['incorrect', 'correct', 'incorrect', 'correct'], { seed: 3 }));
  progress = record(progress, completed('math-matrices', ['correct', 'correct', 'correct'], { seed: 4, now: NOW + 1000 }));
  const workspace = saveHistoricalSession(emptyHistoricalWorkspace(BANK), pyqReport({ 'SYN_P1_Physics_Q01-v1': 'B', 'SYN_P1_Physics_Q02-v1': 'A', 'SYN_P1_Physics_Q03-v1': 'A' }, NOW + 2000));
  const result = revisionRecommendations({ progress, pyqSessions: workspace.history, registry, bankId: BANK, chapterCounts: { 'phy-newton': 12 }, now: NOW + DAY });
  assert.equal(result.state, 'ready');
  assert.equal(result.evidence.originalAttempts, 7);
  assert.equal(result.evidence.pyqAttempts, 3);
  const newton = result.recommendations.find(item => item.chapter === 'phy-newton');
  assert.ok(newton);
  assert.equal(newton.kind, 'evidence');
  assert.deepEqual([newton.evidence.original.attempts, newton.evidence.original.incorrect, newton.evidence.original.partial], [4, 2, 0]);
  assert.deepEqual([newton.evidence.pyq.attempts, newton.evidence.pyq.incorrect], [3, 1]);
  const original = newton.reasons.find(r => r.kind === 'original').text;
  const pyq = newton.reasons.find(r => r.kind === 'pyq').text;
  assert.match(original, /^Original practice: 2 incorrect out of 4 retained first attempts/);
  for (const example of newton.evidence.original.examples) assert.ok(original.includes(example.id) && /phy-atwood-v1:\d+/.test(example.id));
  assert.match(pyq, /^Historical PYQ: 1 incorrect out of 3 retained first attempts in your saved PYQ reports\. Examples: SYN_P1_Physics_Q01-v1 incorrect/);
  assert.ok(!original.includes('SYN_') && !pyq.includes('phy-atwood'));
  assert.equal(newton.practice.originalFamilies, listTemplates({ chapter: 'phy-newton' }).length);
  assert.equal(newton.practice.pyqQuestions, 12);
  assert.ok(newton.prerequisites.length && newton.prerequisites.every(p => p.reviewStatus === 'unreviewed-draft'));
  assert.ok(!result.recommendations.some(item => item.chapter === 'math-matrices'), 'all-correct chapters are not suggested');
  const text = JSON.stringify(result).toLowerCase();
  for (const word of ['mastery score', 'percentile', 'predicted', 'rank:']) assert.ok(!text.includes(word), word);
  // A multi-chapter PYQ counts once in each tagged chapter.
  const work = [...result.recommendations, ...result.limited].find(item => item.chapter === 'phy-work');
  assert.equal(work, undefined, 'the correct multi-chapter answer gives no open miss in phy-work');
});

test('retries and later sessions never replace the first attempt that a suggestion cites', () => {
  const first = completed('phy-newton', ['incorrect', 'incorrect', 'correct', 'incorrect', 'correct'], { seed: 9 });
  let progress = record(emptyProgress(), first);
  const before = revisionRecommendations({ progress, now: NOW + DAY });
  let retry = createRetrySession(first, NOW + 500);
  sessionItems(retry).forEach((item, index) => { retry = setResponse(retry, index, item.answer, NOW + 501 + index); });
  retry = finishSession(retry, NOW + 900);
  progress = record(progress, retry);
  const after = revisionRecommendations({ progress, now: NOW + DAY });
  assert.deepEqual(after.recommendations, before.recommendations);
  assert.equal(after.recommendations[0].evidence.original.open, 3);
  // A PYQ retry in a later report likewise keeps the earliest retained answer.
  const early = pyqReport({ 'SYN_P1_Physics_Q01-v1': 'B' }, NOW);
  const late = pyqReport({ 'SYN_P1_Physics_Q01-v1': 'A' }, NOW + 5000);
  const pyq = revisionRecommendations({ pyqSessions: [late, early], registry, bankId: BANK, now: NOW + DAY });
  assert.equal(pyq.limited[0].evidence.pyq.incorrect, 1);
  assert.equal(pyq.limited[0].evidence.pyq.examples[0].answeredAt, early.finishedAt);
});

test('notebook resolution closes a cited miss without rewriting the attempt', () => {
  const session = completed('phy-newton', ['incorrect', 'incorrect', 'correct', 'correct', 'correct'], { seed: 21 });
  const progress = record(emptyProgress(), session);
  const missed = sessionItems(session).slice(0, 2);
  let notebook = updateNotebook(emptyNotebook(), missed[0], { resolved: true });
  notebook = updateNotebook(notebook, missed[1], { cause: 'calculation' });
  const result = revisionRecommendations({ progress, notebook, now: NOW + DAY });
  const item = result.recommendations[0];
  assert.equal(item.evidence.original.incorrect, 2);
  assert.equal(item.evidence.original.open, 1);
  assert.equal(item.evidence.original.resolved, 1);
  const text = item.reasons.find(r => r.kind === 'original').text;
  assert.match(text, /\(your note: calculation\)/);
  assert.match(text, /marked 1 of these resolved/);
  notebook = updateNotebook(notebook, missed[1], { resolved: true });
  assert.equal(revisionRecommendations({ progress, notebook, now: NOW + DAY }).recommendations.length, 0);
});

test('retention limits: evidence outside retained stores is gone and explanations say retained', () => {
  // Progress keeps at most MAX_RECORDS first attempts; the engine reads only those.
  const records = [];
  for (let i = 0; i < MAX_RECORDS; i++) {
    const item = generate('phy-atwood-v1', i);
    records.push({ templateId: item.templateId, seed: item.seed, response: '999999', answeredAt: NOW - i });
  }
  const full = revisionRecommendations({ progress: { version: 1, records }, now: NOW + DAY });
  assert.equal(full.evidence.originalAttempts, MAX_RECORDS);
  assert.match(full.recommendations[0].reasons.find(r => r.kind === 'original').text, /1000 retained first attempts/);
  const oversized = revisionRecommendations({ progress: { version: 1, records: [...records, ...records.slice(0, 5)] }, now: NOW + DAY });
  assert.equal(oversized.evidence.originalAttempts, MAX_RECORDS, 'never reads beyond the store limit');
  // PYQ: only 20 reports are retained; the oldest report leaves when a 21st arrives.
  let workspace = emptyHistoricalWorkspace(BANK);
  workspace = saveHistoricalSession(workspace, pyqReport({ 'SYN_P1_Physics_Q04-v1': 'B' }, NOW));
  for (let i = 1; i <= 20; i++) workspace = saveHistoricalSession(workspace, pyqReport({ 'SYN_P1_Physics_Q01-v1': 'A' }, NOW + i * 1000));
  assert.equal(workspace.history.length, 20);
  const pyq = revisionRecommendations({ pyqSessions: workspace.history, registry, bankId: BANK, now: NOW + DAY });
  assert.equal(pyq.evidence.pyqAttempts, 1);
  assert.equal([...pyq.recommendations, ...pyq.limited].length, 0, 'the aged-out miss is not reconstructed');
});

test('content-version changes are ignored and counted, never crash or rewrite data', () => {
  const progress = record(emptyProgress(), completed('phy-newton', ['incorrect', 'incorrect', 'incorrect', 'incorrect'], { seed: 31 }));
  const stale = { version: 1, records: [...progress.records, { templateId: 'phy-retired-v1', seed: 1, response: '1', answeredAt: NOW }, { templateId: 'phy-atwood-v1', seed: 5, response: { bad: true }, answeredAt: NOW }] };
  const snapshot = structuredClone(stale);
  const notebook = { version: 1, entries: [{ templateId: 'phy-retired-v1', seed: 2, cause: 'concept', note: '', resolved: false }] };
  const reports = [
    pyqReport({ 'SYN_P1_Physics_Q01-v1': 'B' }, NOW),
    { ...pyqReport({ 'SYN_P1_Physics_Q02-v1': 'B' }, NOW + 10), bankId: 'older-bank-v0' },
    { ...pyqReport({ 'SYN_P1_Physics_Q03-v1': 'B' }, NOW + 20), questionIds: ['SYN_REMOVED_Q99-v1'] },
  ];
  const oddChapter = { getQuestion(id) { const q = registry.getQuestion(id); return id === 'SYN_P1_Physics_Q01-v1' ? { ...q, chapters: ['phy-newton', 'phy-retired-chapter'] } : q; } };
  const plan = { version: 1, goals: [{ chapter: 'phy-retired-chapter', addedAt: NOW }, { chapter: 'chem-redox', addedAt: NOW }], dismissed: [] };
  const result = revisionRecommendations({ progress: stale, notebook, plan, pyqSessions: reports, registry: oddChapter, bankId: BANK, now: NOW + DAY });
  assert.deepEqual(result.ignored, { originalRecords: 2, notebookEntries: 1, pyqSessions: 1, pyqQuestions: 1, unknownChapters: 1, planChapters: 1 });
  assert.deepEqual(stale, snapshot);
  assert.deepEqual(result.recommendations.map(item => item.chapter), ['chem-redox', 'phy-newton']);
  // Without a loaded registry the PYQ evidence is reported as not loaded, not as zero mistakes.
  const unloaded = revisionRecommendations({ progress, pyqSessions: reports, now: NOW + DAY });
  assert.equal(unloaded.evidence.pyqLoaded, false);
  assert.equal(unloaded.ignored.pyqSessions, 0);
});

test('learner goals and dismissals are validated, bounded and under learner control', () => {
  let plan = addRevisionGoal(emptyRevisionPlan(), 'phy-units', NOW);
  assert.deepEqual(addRevisionGoal(plan, 'phy-units', NOW + 1), plan, 'duplicate goal is a no-op');
  assert.throws(() => addRevisionGoal(plan, 'phy-unknown', NOW), /chapter list/);
  for (const chapter of CHAPTERS.slice(1, MAX_GOALS).map(c => c.id)) plan = addRevisionGoal(plan, chapter, NOW);
  assert.equal(plan.goals.length, MAX_GOALS);
  assert.throws(() => addRevisionGoal(plan, CHAPTERS[MAX_GOALS + 1].id, NOW), /up to 12/);
  plan = removeRevisionGoal(plan, 'phy-units', NOW);
  assert.equal(plan.goals.length, MAX_GOALS - 1);
  // Goals without evidence explain that and flag missing practice content.
  const goalOnly = revisionRecommendations({ plan: addRevisionGoal(emptyRevisionPlan(), 'phy-units', NOW), chapterCounts: {}, now: NOW + DAY });
  assert.equal(goalOnly.state, 'sparse');
  const units = goalOnly.recommendations[0];
  assert.equal(units.kind, 'goal');
  assert.match(units.reasons[0].text, /revision goal on \d{4}-\d{2}-\d{2}/);
  assert.equal(units.practice.available, false);
  assert.match(units.reasons.find(r => r.kind === 'content').text, /No original-practice family or published PYQ/);
  assert.equal(revisionRecommendations({ plan: addRevisionGoal(emptyRevisionPlan(), 'phy-units', NOW), now: NOW + DAY }).recommendations[0].practice.pyqCountKnown, false);

  // Dismissal hides a suggestion until its evidence changes.
  let progress = record(emptyProgress(), completed('phy-newton', ['incorrect', 'incorrect', 'correct', 'correct', 'correct'], { seed: 40 }));
  const shown = revisionRecommendations({ progress, now: NOW + DAY }).recommendations[0];
  let dismissed = dismissRecommendation(emptyRevisionPlan(), shown.chapter, shown.signature, NOW + DAY);
  let result = revisionRecommendations({ progress, plan: dismissed, now: NOW + DAY });
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.dismissed[0].chapter, 'phy-newton');
  assert.equal(revisionRecommendations({ progress, plan: undismissRecommendation(dismissed, 'phy-newton', NOW + DAY), now: NOW + DAY }).recommendations.length, 1);
  progress = record(progress, completed('phy-newton', ['incorrect'], { seed: 41, now: NOW + 2 * DAY }));
  result = revisionRecommendations({ progress, plan: dismissed, now: NOW + 3 * DAY });
  assert.equal(result.recommendations[0]?.chapter, 'phy-newton', 'new evidence brings it back');
  // Adding a goal clears any dismissal for that chapter.
  assert.deepEqual(addRevisionGoal(dismissed, 'phy-newton', NOW + DAY).dismissed, []);
});

test('corrupted plan storage is rejected and reported, not silently replaced', () => {
  for (const raw of ['{', '[]', JSON.stringify({ version: 2, goals: [], dismissed: [] }), JSON.stringify({ version: 1, goals: [{ chapter: 'phy-units', addedAt: NOW }, { chapter: 'phy-units', addedAt: NOW }], dismissed: [] }), JSON.stringify({ version: 1, goals: [{ chapter: '<script>', addedAt: NOW }], dismissed: [] }), JSON.stringify({ version: 1, goals: [{ chapter: 'phy-units', addedAt: NOW + DAY * 400 }], dismissed: [] }), 'x'.repeat(50001)]) {
    assert.equal(restoreRevisionPlan(raw, NOW), null, raw.slice(0, 40));
  }
  assert.throws(() => addRevisionGoal({ version: 1, goals: 'bad', dismissed: [] }, 'phy-units', NOW), /preserved/);
  const result = revisionRecommendations({ plan: { version: 1, goals: 'bad' }, now: NOW });
  assert.equal(result.planError, true);
  assert.deepEqual(restoreRevisionPlan(JSON.stringify({ version: 1, goals: [{ chapter: 'phy-units', addedAt: NOW, extra: 1 }], dismissed: [] }), NOW), { version: 1, goals: [{ chapter: 'phy-units', addedAt: NOW }], dismissed: [] });
});

test('the revision route is wired with a visible unreviewed-draft notice', async () => {
  const [app, ui, html] = await Promise.all(['../assets/app.js', '../assets/revision.js', '../index.html'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.match(html, /href="#revise" data-route="revise"/);
  assert.match(html, /assets\/revision\.css/);
  assert.match(app, /revise:showRevision/);
  assert.match(app, /readLocal\('revision-plan'/);
  assert.match(ui, /Unreviewed draft relationships\./);
  assert.match(ui, /UNREVIEWED DRAFT/);
  assert.match(ui, /never combined into one score/);
  assert.ok(MIN_CHAPTER_EVIDENCE >= 3);
});

test('published PYQ identities and chapter counts connect through canonical chapter IDs', async () => {
  const { prepareContent } = await import('../scripts/build-content.mjs');
  const { createContentRegistry } = await import('../src/content/catalog.js');
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../', import.meta.url).pathname;
  const walk = async path => (await Promise.all((await readdir(root + path, { withFileTypes: true })).map(row => row.isDirectory() ? walk(`${path}/${row.name}`) : [`${path}/${row.name}`]))).flat();
  const archive = JSON.parse(await readFile(root + 'data/archive.json', 'utf8'));
  const compiled = await prepareContent(root, archive, await walk('assets'));
  const decoded = compiled.manifest.bundles.map(({ path }) => JSON.parse(compiled.inputs.get(path)));
  const bank = createContentRegistry({ archive, bundles: decoded.map(row => row.bundle), papers: compiled.manifest.papers, availableAssets: compiled.manifest.availableAssets });
  const known = new Set(CHAPTERS.map(c => c.id));
  assert.ok(Object.keys(compiled.manifest.chapterCounts).every(id => known.has(id)));
  const plainSingle = q => q.type === 'single' && !q.acceptedOptionSets;
  const chapter = CHAPTERS.find(c => bank.filterQuestions({ chapter: c.id }).filter(plainSingle).length >= 3).id;
  const physics = bank.filterQuestions({ chapter }).filter(plainSingle).slice(0, 3);
  let session = createHistoricalSession(bank, { questionIds: physics.map(q => q.id), bankId: compiled.manifest.bankId, timed: false, now: NOW, seed: 1 });
  physics.forEach((question, index) => {
    const wrongOption = question.options.find(o => !(Array.isArray(question.answer) ? question.answer : [question.answer]).includes(o.id)).id;
    session = answerHistorical(session, index, question.type === 'multiple' ? [wrongOption] : wrongOption, bank, NOW + 1 + index);
  });
  session = finishHistorical(session, NOW + 100);
  const progress = record(emptyProgress(), completed('math-matrices', ['incorrect', 'correct'], { seed: 77 }));
  const result = revisionRecommendations({ progress, pyqSessions: [session], registry: bank, bankId: compiled.manifest.bankId, chapterCounts: compiled.manifest.chapterCounts, now: NOW + DAY });
  const item = result.recommendations.find(value => value.chapter === chapter);
  assert.ok(item, chapter);
  assert.equal(item.evidence.pyq.incorrect, 3);
  assert.equal(item.practice.pyqQuestions, compiled.manifest.chapterCounts[chapter]);
  assert.match(item.reasons.find(r => r.kind === 'pyq').text, /\d{4}_P\d_(Physics|Chemistry|Mathematics)_Q\d+-v\d/);
  assert.equal(item.evidence.original.attempts + item.evidence.pyq.attempts >= 3, true);
});
