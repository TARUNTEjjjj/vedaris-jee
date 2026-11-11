import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/questions/index.js';
import { emptyProgress, getStats } from '../src/learning/progress.js';
import { emptyNotebook, restoreNotebook, updateNotebook, notebookEntries, MAX_NOTEBOOK_ENTRIES, MAX_NOTE_LENGTH } from '../src/learning/notebook.js';
import { mountNotebook } from '../assets/notebook.js';

const now = 1_760_000_000_000;
const id = (templateId = 'phy-projectile-v1', seed = 123) => ({ templateId, seed });
const record = (question, response, answeredAt = now) => ({ ...question, response, answeredAt });
const progress = records => ({ version: 1, records });

test('notebook derives incorrect and partial first attempts and unions exact saved identities', () => {
  const wrong = id(), partial = id('phy-orbit-v1', 456), right = id('math-roots-v1', 22), saved = id('chem-gas-v1', 88);
  const history = progress([
    record(wrong, '99999'),
    record(partial, [generate(partial.templateId, partial.seed).answer[0]]),
    record(right, generate(right.templateId, right.seed).answer),
  ]);
  const rows = notebookEntries(history, [wrong, saved, saved], emptyNotebook());
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.id === `${wrong.templateId}:${wrong.seed}`).status, 'incorrect');
  assert.equal(rows.find(row => row.seed === partial.seed).status, 'partial');
  assert.equal(rows.find(row => row.seed === partial.seed).score, 1);
  assert.equal(rows.find(row => row.seed === saved.seed).status, 'unattempted');
  assert.equal(rows.find(row => row.seed === saved.seed).score, null);
  assert.equal(rows.find(row => row.seed === wrong.seed).bookmarked, true);
  assert.equal(rows.some(row => row.seed === right.seed), false);
  for (const row of rows) assert.deepEqual(row.item, generate(row.templateId, row.seed));
});

test('later retries do not replace first attempts, including raw duplicate records', () => {
  const question = id(), answer = generate(question.templateId, question.seed).answer;
  const earlierWrong = progress([record(question, answer, now + 1), record(question, '99999', now)]);
  assert.equal(notebookEntries(earlierWrong)[0].status, 'incorrect');
  assert.equal(notebookEntries(earlierWrong)[0].response, '99999');
  const earlierRight = progress([record(question, '99999', now + 1), record(question, answer, now)]);
  assert.deepEqual(notebookEntries(earlierRight), []);
  const savedRight = notebookEntries(earlierRight, [question]);
  assert.equal(savedRight[0].status, 'correct');
});

test('annotations merge immutably, survive missing history, and resolve and reopen independently of grades', () => {
  const question = id(), other = id('chem-gas-v1', 22);
  const blank = emptyNotebook();
  const noted = updateNotebook(blank, question, { cause: 'concept', note: 'Derive the equation before substituting.' });
  assert.deepEqual(blank, emptyNotebook());
  const withOther = updateNotebook(noted, other, { note: 'Check units.' });
  const resolved = updateNotebook(withOther, question, { resolved: true });
  assert.deepEqual(noted.entries[0], { ...question, cause: 'concept', note: 'Derive the equation before substituting.', resolved: false });
  assert.deepEqual(resolved.entries[1], withOther.entries[1]);
  assert.notEqual(resolved.entries[1], withOther.entries[1], 'returned metadata is detached from the source');
  const history = progress([record(question, '99999')]);
  const before = structuredClone(history);
  const row = notebookEntries(history, [], resolved).find(row => row.seed === question.seed);
  assert.equal(row.status, 'incorrect');
  assert.equal(row.resolved, true);
  assert.equal(getStats(history).incorrect, 1);
  assert.deepEqual(history, before);
  const reopened = updateNotebook(resolved, question, { resolved: false });
  assert.equal(notebookEntries(history, [], reopened).find(row => row.seed === question.seed).resolved, false);
  assert.equal(notebookEntries(emptyProgress(), [], reopened).length, 2, 'annotations survive removing bookmarks or older progress');
  assert.deepEqual(restoreNotebook(JSON.stringify(reopened)), reopened);
});

test('restore validates bounded storage and strips forged grades, answers, and prototype keys', () => {
  const question = id();
  const hostile = JSON.parse(`{"version":1,"entries":[{"templateId":"${question.templateId}","seed":123,"cause":"misread","note":"<script>bad()</script>","resolved":true,"score":999,"status":"correct","answer":"forged","__proto__":{"polluted":true}}],"__proto__":{"polluted":true}}`);
  const clean = restoreNotebook(hostile);
  assert.deepEqual(clean, { version: 1, entries: [{ ...question, cause: 'misread', note: '<script>bad()</script>', resolved: true }] });
  assert.equal({}.polluted, undefined);
  const derived = notebookEntries(progress([record(question, '99999')]), [], clean)[0];
  assert.equal(derived.status, 'incorrect');
  assert.equal(derived.score, 0);
  assert.notEqual(derived.item.answer, 'forged');
  assert.deepEqual(restoreNotebook({ version: 1, entries: [question] }), { version: 1, entries: [{ ...question, cause: 'unclassified', note: '', resolved: false }] });
  for (const bad of [
    null, '{}', '{', 'x'.repeat(8_000_001), { version: 2, entries: [] },
    { version: 1, entries: [question, question] },
    { version: 1, entries: [{ ...question, cause: 'hacked' }] },
    { version: 1, entries: [{ ...question, note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }] },
    { version: 1, entries: [{ ...question, resolved: 'false' }] },
    { version: 1, entries: [{ ...question, seed: -1 }] },
    { version: 1, entries: [{ ...question, seed: 2 ** 32 }] },
    { version: 1, entries: [{ ...question, templateId: '__proto__' }] },
    { version: 1, entries: Array(MAX_NOTEBOOK_ENTRIES + 1).fill(question) },
  ]) assert.equal(restoreNotebook(bad), null);
  assert.throws(() => notebookEntries(emptyProgress(), Array(501).fill(question)), /saved questions/);
  assert.throws(() => notebookEntries(emptyProgress(), [{ ...question, seed: '123' }]), /seed/i);
});

test('patches reject identity/grade mutation, invalid metadata, and overflow without evicting notes', () => {
  const question = id();
  for (const patch of [
    {}, null, [], { cause: 'unknown' }, { note: 123 }, { resolved: 1 },
    { note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }, { templateId: 'chem-gas-v1' },
    { score: 999 }, { status: 'correct' }, JSON.parse('{"__proto__":{"polluted":true}}'),
    Object.create({ note: 'inherited' }),
  ]) assert.throws(() => updateNotebook(emptyNotebook(), question, patch));
  const full = { version: 1, entries: Array.from({ length: MAX_NOTEBOOK_ENTRIES }, (_, seed) => ({ ...id('phy-projectile-v1', seed), cause: 'time', note: `Keep ${seed}`, resolved: false })) };
  assert.throws(() => updateNotebook(full, id('phy-projectile-v1', 1000), { note: 'Overflow' }), /1,000/);
  const updated = updateNotebook(full, id('phy-projectile-v1', 500), { note: 'x'.repeat(MAX_NOTE_LENGTH) });
  assert.equal(updated.entries.length, MAX_NOTEBOOK_ENTRIES);
  assert.equal(updated.entries[500].note.length, MAX_NOTE_LENGTH);
  assert.equal(full.entries[500].note, 'Keep 500');
  assert.equal(updated.entries[999].note, 'Keep 999');
});

// Minimal component boundary: no browser dependencies, network, or localStorage.
// These events exercise the real rendering and callback paths using a dedicated root.
function component(config = {}) {
  const root = { innerHTML: '', contains: target => target.owner === root };
  const changes = [], retries = [];
  mountNotebook(root, { progress: emptyProgress(), bookmarks: [id()], notebook: emptyNotebook(), onChange: next => changes.push(next), onRetry: values => retries.push(values), ...config });
  function click(action, question = id(), disabled = false) {
    const target = { owner: root, disabled, dataset: { notebookAction: action, notebookId: `${question.templateId}:${question.seed}` }, closest: () => target };
    root.onclick({ target });
  }
  function filter(name, value) {
    const target = { owner: root, value, dataset: { notebookFilter: name }, closest: () => target };
    root.onchange({ target });
  }
  function form(question, cause, note, submit = true) {
    const target = { owner: root, dataset: { notebookEntry: `${question.templateId}:${question.seed}` }, elements: { namedItem: name => ({ value: name === 'cause' ? cause : note }) }, closest: () => target };
    if (submit) root.onsubmit({ target, preventDefault() {} });
    else root.oninput({ target });
  }
  return { root, changes, retries, click, filter, form };
}

test('component escapes user notes, keeps worked solutions collapsed, and retries exact identities', () => {
  const note = '</textarea><img src=x onerror="alert(1)"><script>bad()</script>';
  const notebook = updateNotebook(emptyNotebook(), id(), { cause: 'misread', note });
  const ui = component({ notebook });
  assert.ok(ui.root.innerHTML.includes('&lt;/textarea&gt;&lt;img'));
  assert.ok(!ui.root.innerHTML.includes('<img'));
  assert.ok(!ui.root.innerHTML.includes('<script>'));
  assert.match(ui.root.innerHTML, /<details class="notebook-solution">/);
  assert.doesNotMatch(ui.root.innerHTML, /<details[^>]*\bopen(?:\s|=|>)/);
  assert.ok(ui.root.innerHTML.includes('original concept-practice questions, not JEE PYQs'));
  ui.click('retry');
  assert.deepEqual(ui.retries, [[id()]]);
  ui.click('retry', id('missing', 9));
  assert.equal(ui.retries.length, 1);
  ui.form(id(), 'calculation', 'Use consistent units.');
  assert.equal(ui.changes.length, 1);
  assert.equal(ui.changes[0].entries[0].note, 'Use consistent units.');
  assert.equal(ui.changes[0].entries[0].cause, 'calculation');
  ui.click('resolve');
  assert.equal(ui.changes[1].entries[0].resolved, true);
  assert.ok(ui.root.innerHTML.includes('No questions match these filters.'));
  ui.filter('status', 'resolved');
  assert.ok(ui.root.innerHTML.includes('Reopen for review'));
  ui.click('resolve');
  assert.equal(ui.changes[2].entries[0].resolved, false);
});

test('component filters subject, cause, status and paginates bounded retry batches', () => {
  const bookmarks = Array.from({ length: 25 }, (_, seed) => id('phy-projectile-v1', seed));
  bookmarks.push(id('chem-gas-v1', 999));
  const notebook = updateNotebook(emptyNotebook(), bookmarks[0], { cause: 'concept' });
  const ui = component({ bookmarks, notebook });
  ui.click('retry-visible');
  assert.equal(ui.retries[0].length, 20);
  assert.equal(new Set(ui.retries[0].map(value => `${value.templateId}:${value.seed}`)).size, 20);
  ui.click('next');
  ui.click('retry-visible');
  assert.equal(ui.retries[1].length, 6);
  ui.filter('subject', 'chemistry');
  ui.click('retry-visible');
  assert.deepEqual(ui.retries[2], [id('chem-gas-v1', 999)]);
  ui.filter('subject', 'physics');
  ui.filter('cause', 'concept');
  ui.click('retry-visible');
  assert.deepEqual(ui.retries[3], [id('phy-projectile-v1', 0)]);
  ui.filter('status', 'incorrect');
  ui.click('retry-visible');
  assert.equal(ui.retries.length, 4, 'empty filtered views do not start sessions');
});

test('component preserves drafts on rerender and handles rejected saves without a false success', () => {
  const ui = component({ onChange: () => false });
  ui.form(id(), 'time', 'Draft survives a filter.', false);
  ui.filter('cause', 'all');
  assert.ok(ui.root.innerHTML.includes('Draft survives a filter.'));
  ui.form(id(), 'time', 'Draft survives a filter.');
  assert.ok(ui.root.innerHTML.includes('could not be saved'));
  assert.ok(ui.root.innerHTML.includes('Draft survives a filter.'));
  assert.ok(!ui.root.innerHTML.includes('Note saved.'));
});

test('read-only notebook blocks all writes and retries even if events are invoked directly', () => {
  const ui = component({ readOnly: true });
  ui.form(id(), 'concept', 'Should not save');
  ui.click('resolve');
  ui.click('retry');
  ui.click('retry-visible');
  assert.deepEqual(ui.changes, []);
  assert.deepEqual(ui.retries, []);
  assert.ok(ui.root.innerHTML.includes('This view is read-only.'));
  ui.filter('status', 'all');
  assert.ok(ui.root.innerHTML.includes('phy-projectile-v1'));
});
