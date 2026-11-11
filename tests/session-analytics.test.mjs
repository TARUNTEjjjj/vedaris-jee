import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/questions/index.js';
import { createSession, sessionItems, setResponse, toggleFlag, finishSession, gradeSession, restoreSession, createRetrySession, visitQuestion, trackTime, questionStatus, createRevisionSession } from '../src/practice/session.js';
import { emptyHistory, recordHistory, restoreHistory, historyStats, MAX_HISTORY_SESSIONS } from '../src/learning/history.js';

const now = 1_770_000_000_000;
const create = (overrides = {}) => createSession({ seed: 17, now, count: 3, timed: false, ...overrides });
const legacy = session => { const value = structuredClone(session); delete value.timeSpentMs; delete value.visited; delete value.timingUpdatedAt; return value; };
function correctSession(seed, start) {
  let session = create({ seed, now: start });
  session = setResponse(session, 0, sessionItems(session)[0].answer, start + 1);
  return finishSession(session, start + 2);
}

test('new sessions distinguish unvisited, unanswered, answered and marked questions', () => {
  const original = create();
  assert.deepEqual(original.visited, [false, false, false]);
  assert.deepEqual(original.timeSpentMs, [0, 0, 0]);
  assert.equal(questionStatus(original, 0), 'not-visited');
  let session = visitQuestion(original, 1, now + 1);
  assert.equal(session.index, 1);
  assert.equal(questionStatus(session, 1), 'not-answered');
  assert.deepEqual(original.visited, [false, false, false]);
  session = toggleFlag(session, 1, now + 2);
  assert.equal(questionStatus(session, 1), 'marked-for-review');
  session = setResponse(session, 1, sessionItems(session)[1].answer, now + 3);
  assert.equal(questionStatus(session, 1), 'answered-and-marked');
  session = toggleFlag(session, 1, now + 4);
  assert.equal(questionStatus(session, 1), 'answered');
  session = setResponse(session, 2, sessionItems(session)[2].answer, now + 5);
  assert.equal(session.visited[2], true, 'answering proves that the question was visited');
  const report = gradeSession(session);
  assert.equal(report.visited, 2); assert.equal(report.notVisited, 1); assert.equal(report.visitUnknown, 0);
  assert.equal(report.rows[1].navigationStatus, 'answered');
  assert.equal(report.elapsedMs, null);
});

test('visible activity timing is immutable, excludes gaps and prevents overlapping double-counts', () => {
  const original = create();
  let session = visitQuestion(original, 0, now);
  session = trackTime(session, 2000, 0, now + 2000);
  assert.deepEqual(session.timeSpentMs, [2000, 0, 0]);
  assert.deepEqual(original.timeSpentMs, [0, 0, 0]);
  session = trackTime(session, 2000, 0, now + 2000);
  assert.deepEqual(session.timeSpentMs, [2000, 0, 0], 'the same wall interval cannot be recorded twice');
  session = visitQuestion(session, 1, now + 2000);
  // Eight seconds hidden, then 750 ms visible. Only the supplied visible
  // interval is counted; the wall-clock gap is not assumed active.
  session = trackTime(session, 750, 1, now + 10750);
  assert.deepEqual(session.timeSpentMs, [2000, 750, 0]);
  session = trackTime(session, 2000, 1, now + 11000);
  assert.deepEqual(session.timeSpentMs, [2000, 1000, 0], 'reported activity is capped to 250 newly elapsed ms');
  assert.equal(gradeSession(session).activeTimeMs, 3000);
  session = finishSession(session, now + 11000);
  assert.equal(gradeSession(session).elapsedMs, 11000);
  assert.deepEqual(trackTime(session, 1000, 1, now + 12000), session);
  assert.deepEqual(visitQuestion(session, 2, now + 12000), session);
  assert.deepEqual(restoreSession(JSON.stringify(session), now + 12000), session);
});

test('timing stops at the deadline and rejects malformed intervals or indices', () => {
  let session = create({ timed: true, minutes: 1 });
  session = trackTime(session, 59000, 0, now + 59000);
  session = trackTime(session, 5000, 1, now + 64000);
  assert.deepEqual(session.timeSpentMs, [59000, 1000, 0]);
  assert.equal(session.finishedAt, now + 60000);
  assert.equal(gradeSession(session).activeTimeMs, 60000);
  assert.equal(gradeSession(session).elapsedMs, 60000);
  const clean = create();
  for (const invalid of [-1, 0.5, NaN, Infinity, 60001, '10']) assert.throws(() => trackTime(clean, invalid, 0, now + 1000));
  assert.throws(() => trackTime(clean, 1000, 3, now + 1000));
  assert.throws(() => trackTime(clean, 1000, 0, now - 1));
  assert.throws(() => visitQuestion(clean, -1, now));
  assert.throws(() => finishSession(trackTime(clean, 1000, 0, now + 1000), now + 500), /precedes/);
});

test('legacy sessions retain unknown timings through restore, activity, finish, and history', () => {
  let old = create();
  old = setResponse(old, 1, sessionItems(old)[1].answer, now + 1);
  const restored = restoreSession(JSON.stringify(legacy(old)), now + 2);
  assert.deepEqual(restored.timeSpentMs, [null, null, null]);
  assert.deepEqual(restored.visited, [null, true, null]);
  assert.equal(restored.timingUpdatedAt, null);
  assert.equal(questionStatus(restored, 0), 'unknown');
  let session = visitQuestion(restored, 0, now + 3);
  session = trackTime(session, 2000, 0, now + 2003);
  assert.deepEqual(session.timeSpentMs, [null, null, null]);
  assert.deepEqual(session.visited, [true, true, null]);
  session = finishSession(session, now + 2004);
  assert.equal(gradeSession(session).activeTimeMs, null);
  assert.equal(gradeSession(session).visitUnknown, 1);
  const history = recordHistory(emptyHistory(), session, now + 2005);
  const stats = historyStats(history, now + 2005);
  assert.equal(stats.activeTimeMs, null);
  assert.equal(stats.sessions[0].activeTimeMs, null);
  assert.equal(stats.knownTimingSessionCount, 0);
  assert.deepEqual(restoreHistory(JSON.stringify(history), now + 2005), history);
});

test('restore refuses impossible time totals, partial schemas, and contradictory visits', () => {
  let session = create();
  session = trackTime(session, 1000, 0, now + 1000);
  for (const mutate of [
    value => { delete value.visited; },
    value => { value.timeSpentMs = [1000]; },
    value => { value.timeSpentMs[0] = -1; },
    value => { value.timeSpentMs[0] = 1.5; },
    value => { value.timeSpentMs[1] = null; },
    value => { value.timeSpentMs[0] = 1001; },
    value => { value.timingUpdatedAt = now - 1; },
    value => { value.timingUpdatedAt = now + 2001; },
    value => { value.visited[0] = false; },
    value => { value.visited[1] = 'yes'; },
    value => { value.visited[1] = null; },
    value => { value.flags[1] = true; },
    value => { value.responses[1] = sessionItems(value)[1].answer; },
  ]) {
    const copy = structuredClone(session); mutate(copy);
    assert.equal(restoreSession(JSON.stringify(copy), now + 2000), null);
  }
  assert.equal(restoreSession(JSON.stringify({ ...session, score: 999, activeTimeMs: 999999 }), now + 2000).score, undefined);
});

test('revision uses exact identities, restores safely and starts fresh analytics', () => {
  const identities = [{ templateId: 'phy-atwood-v1', seed: 7 }, { templateId: 'math-probability-v1', seed: 9 }];
  const session = createRevisionSession(identities, now);
  assert.equal(session.mode, 'revision'); assert.equal(session.timed, false); assert.equal(session.deadline, null);
  assert.equal(session.subject, 'all'); assert.equal(session.chapter, 'all');
  assert.deepEqual(session.questions, identities);
  assert.deepEqual(sessionItems(session), identities.map(identity => generate(identity.templateId, identity.seed)));
  assert.deepEqual(session.timeSpentMs, [0, 0]); assert.deepEqual(session.visited, [false, false]);
  assert.deepEqual(restoreSession(JSON.stringify(session), now), session);
  assert.deepEqual(createRevisionSession(identities, now), session);
  const one = createRevisionSession([identities[0]], now);
  assert.equal(one.subject, 'physics'); assert.equal(one.chapter, 'phy-newton');
  assert.throws(() => createRevisionSession([], now));
  assert.throws(() => createRevisionSession(Array(61).fill(identities[0]), now));
  assert.throws(() => createRevisionSession([identities[0], identities[0]], now));
  assert.throws(() => createRevisionSession([{ templateId: 'missing', seed: 7 }], now));
  assert.throws(() => createRevisionSession([{ templateId: 'phy-atwood-v1', seed: -1 }], now));
  const fakeTimed = { ...session, timed: true, minutes: 1, deadline: now + 60000 };
  assert.equal(restoreSession(JSON.stringify(fakeTimed), now), null);
});

test('retry preserves missed identities but resets visit and timing data', () => {
  let session = create();
  session = trackTime(session, 5000, 0, now + 5000);
  session = setResponse(session, 0, sessionItems(session)[0].answer, now + 5000);
  session = toggleFlag(session, 1, now + 5001);
  session = finishSession(session, now + 5002);
  const retry = createRetrySession(session, now + 5003);
  assert.equal(retry.questions.length, 2);
  assert.deepEqual(retry.questions, session.questions.slice(1));
  assert.deepEqual(retry.timeSpentMs, [0, 0]); assert.deepEqual(retry.visited, [false, false]);
  assert.deepEqual(retry.flags, [false, false]);
  assert.equal(retry.timingUpdatedAt, now + 5003);
  assert.deepEqual(restoreSession(JSON.stringify(retry), now + 5003), retry);
});

test('history deduplicates completed ids, regrades records and refuses active or corrupt sessions', () => {
  const session = correctSession(70, now);
  let history = recordHistory(emptyHistory(), session, now + 10);
  const altered = structuredClone(session);
  altered.responses[0] = '';
  altered.score = 999;
  history = recordHistory(history, altered, now + 10);
  assert.equal(history.sessions.length, 1);
  assert.equal(historyStats(history, now + 10).correct, 1, 'first completed record is retained');
  const forged = JSON.parse(JSON.stringify(history));
  forged.score = 900;
  forged.sessions[0].score = 900;
  forged.sessions[0].questions[0].answer = 'not-a-key';
  const clean = restoreHistory(JSON.stringify(forged), now + 10);
  assert.equal(clean.score, undefined);
  assert.equal(clean.sessions[0].score, undefined);
  assert.equal(clean.sessions[0].questions[0].answer, undefined);
  assert.equal(historyStats(clean, now + 10).sessions[0].report.correct, 1);
  assert.throws(() => recordHistory(history, create(), now + 10));
  assert.equal(restoreHistory(JSON.stringify({version:1,sessions:[create({timed:true,minutes:1})]}), now + 100000), null, 'overdue active records are not silently completed by import');
  assert.equal(restoreHistory('{', now), null);
  assert.equal(restoreHistory('x'.repeat(2000001), now), null);
  const broken = structuredClone(history); broken.sessions[0].questions[0].seed = -1;
  assert.equal(restoreHistory(JSON.stringify(broken), now + 10), null);
  assert.equal(history.sessions.length, 1, 'failed restores do not mutate existing data');
});

test('history keeps the latest fifty sessions and computes per-session subject analytics', () => {
  let history = emptyHistory();
  for (let i = 0; i < 55; i++) history = recordHistory(history, correctSession(i, now + i * 1000), now + 60000);
  assert.equal(history.sessions.length, MAX_HISTORY_SESSIONS);
  assert.equal(history.sessions[0].startedAt, now + 54000);
  assert.equal(history.sessions.at(-1).startedAt, now + 5000);
  const stats = historyStats(history, now + 60000);
  assert.equal(stats.sessionCount, 50); assert.equal(stats.questionCount, 150);
  assert.equal(stats.attempted, 50); assert.equal(stats.correct, 50); assert.equal(stats.skipped, 100);
  assert.equal(stats.accuracy, 100); assert.equal(stats.knownTimingSessionCount, 50);
  assert.ok(Math.abs(stats.sessions[0].completionRate - 100/3) < 1e-10);
  assert.equal(stats.sessions[0].subjects.reduce((sum, group) => sum + group.questionCount, 0), 3);
  assert.equal(stats.sessions[0].chapters.reduce((sum, group) => sum + group.maxScore, 0), stats.sessions[0].report.maxScore);
  assert.deepEqual(restoreHistory(JSON.stringify(history), now + 60000), history);
  const oversized = { version: 1, sessions: [...history.sessions, history.sessions[0]] };
  assert.equal(restoreHistory(JSON.stringify(oversized), now + 60000), null);
});
