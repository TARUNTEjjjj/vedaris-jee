export const WORKSPACE_LOCK_NAME = 'vedaris-workspace-v1';

function browserLocks() {
  try { return globalThis.navigator?.locks; }
  catch { return undefined; }
}

/**
 * Acquire the one browser-wide writer for this origin without waiting behind
 * another tab. The caller must prohibit persistence in reader and memory modes.
 * A reader may inspect saved work. Memory mode permits unsaved, exportable work
 * when the browser cannot provide an exclusive lock.
 *
 * The Web Lock remains held until release(). There is no clock-based lease:
 * suspended/background tabs cannot accidentally become a second writer.
 */
export async function acquireWorkspaceWriter({ locks = browserLocks(), onModeChange } = {}) {
  let mode = 'memory';
  let announced = false;
  let released = false;
  let decided = false;
  let resolveReady;
  let resolveHeld;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const held = new Promise(resolve => { resolveHeld = resolve; });

  function setMode(next) {
    if (announced && next === mode) return;
    mode = next;
    announced = true;
    // A presentation callback must not prevent acquisition cleanup or leave
    // the caller waiting forever. The live mode getter remains authoritative.
    if (typeof onModeChange === 'function') {
      try { onModeChange(next); } catch { /* Isolate consumer UI errors. */ }
    }
  }

  const controller = Object.freeze({
    get mode() { return mode; },
    release() {
      if (released) return;
      released = true;
      if (mode === 'writer') setMode('reader');
      resolveHeld();
    },
  });

  function decide(next) {
    setMode(next);
    if (!decided) { decided = true; resolveReady(controller); }
  }

  try {
    if (typeof locks?.request !== 'function') {
      decide('memory');
      return ready;
    }
    // ifAvailable is deliberate: a second tab becomes a reader immediately,
    // rather than queuing a hidden writer that can activate unexpectedly.
    const request = locks.request(WORKSPACE_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { decide('reader'); return; }
      if (released) { decide('reader'); return; }
      decide('writer');
      await held;
    });
    // Keep the request observed for its entire lifetime. Security restrictions
    // and browser API failures must degrade to memory, never another writer.
    Promise.resolve(request).then(
      () => {
        if (!decided || (!released && mode === 'writer')) decide('memory');
      },
      () => {
        if (!released) decide('memory');
        else if (!decided) decide('reader');
        resolveHeld();
      },
    );
  } catch {
    decide('memory');
    resolveHeld();
  }
  return ready;
}
