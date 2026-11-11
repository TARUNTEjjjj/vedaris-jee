import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireWorkspaceWriter, WORKSPACE_LOCK_NAME } from '../src/learning/storage.js';

// A dependency-free model of the relevant Web Locks semantics. Successful
// requests keep ownership until their callback settles; ifAvailable readers
// receive null immediately and never enter a queue.
class TestLocks {
  active = false;
  calls = [];
  request(name, options, callback) {
    this.calls.push({ name, options });
    return Promise.resolve().then(async () => {
      if (this.active) return callback(null);
      this.active = true;
      try { return await callback({ name, mode: 'exclusive' }); }
      finally { this.active = false; }
    });
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('one tab holds the exclusive writer and a second immediately becomes a reader', async () => {
  const locks = new TestLocks();
  const events = [];
  const first = await acquireWorkspaceWriter({ locks, onModeChange: mode => events.push(mode) });
  assert.equal(first.mode, 'writer');
  assert.equal(locks.active, true);
  const second = await acquireWorkspaceWriter({ locks });
  assert.equal(second.mode, 'reader');
  assert.equal(first.mode, 'writer');
  assert.equal(locks.calls.length, 2);
  for (const call of locks.calls) assert.deepEqual(call, { name: WORKSPACE_LOCK_NAME, options: { mode: 'exclusive', ifAvailable: true } });
  second.release();
  await settle();
  assert.equal(locks.active, true, 'a reader cannot release the writer lock');
  first.release();
  assert.equal(first.mode, 'reader', 'disable persistence before relinquishing ownership');
  await settle();
  assert.equal(locks.active, false);
  assert.deepEqual(events, ['writer', 'reader']);
});

test('release is idempotent and reacquisition grants a fresh writer without promoting readers', async () => {
  const locks = new TestLocks();
  const first = await acquireWorkspaceWriter({ locks });
  const reader = await acquireWorkspaceWriter({ locks });
  first.release(); first.release();
  await settle();
  assert.equal(reader.mode, 'reader');
  const next = await acquireWorkspaceWriter({ locks });
  assert.equal(next.mode, 'writer');
  assert.equal(first.mode, 'reader');
  assert.equal(reader.mode, 'reader');
  next.release();
  await settle();
  assert.equal(locks.active, false);
});

test('missing, throwing, or denied Web Locks allow only memory mode', async () => {
  const broken = [
    null,
    {},
    { request() { throw new Error('SecurityError'); } },
    { request() { return Promise.reject(new Error('Denied')); } },
    { get request() { throw new Error('Unavailable'); } },
  ];
  for (const locks of broken) {
    const events = [];
    const guard = await acquireWorkspaceWriter({ locks, onModeChange: mode => events.push(mode) });
    assert.equal(guard.mode, 'memory');
    assert.deepEqual(events, ['memory']);
    guard.release(); guard.release();
    await settle();
    assert.equal(guard.mode, 'memory');
  }
});

test('lock remains held across asynchronous turns and UI callback failures', async () => {
  const locks = new TestLocks();
  const writer = await acquireWorkspaceWriter({ locks, onModeChange() { throw new Error('UI failed'); } });
  await settle(); await settle();
  assert.equal(locks.active, true);
  assert.equal((await acquireWorkspaceWriter({ locks })).mode, 'reader');
  writer.release();
  await settle();
  assert.equal(locks.active, false);
});

test('an unexpectedly failed active request revokes writer mode and notifies the caller', async () => {
  let fail;
  const events = [];
  const locks = { request(name, options, callback) {
    void callback({ name, mode: options.mode });
    return new Promise((resolve, reject) => { fail = reject; });
  } };
  const guard = await acquireWorkspaceWriter({ locks, onModeChange: mode => events.push(mode) });
  assert.equal(guard.mode, 'writer');
  fail(new Error('Browser lost the request'));
  await settle();
  assert.equal(guard.mode, 'memory');
  assert.deepEqual(events, ['writer', 'memory']);
  guard.release();
});

test('a malformed lock provider that settles without a callback cannot grant a writer', async () => {
  const guard = await acquireWorkspaceWriter({ locks: { request() { return Promise.resolve(); } } });
  assert.equal(guard.mode, 'memory');
  guard.release();
});
