import { BACKUP_STORES, BACKUP_VERSION, countRecords } from '../src/learning/backup.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = iso => { const time = Date.parse(iso); return Number.isFinite(time) ? new Intl.DateTimeFormat('en-IN', {dateStyle:'medium', timeStyle:'short'}).format(time) : 'an unknown date'; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const SOURCE = {
  workspace: 'Complete Vedaris workspace backup',
  'legacy-progress': 'Older concept-practice progress backup',
  'legacy-pyq': 'Older PYQ backup',
};

/** Human-readable identity of a held record. Exact IDs are shown, never rewritten. */
export function heldIdentity(item) {
  const r = item.record || {};
  if (['progress', 'bookmarks', 'notebook'].includes(item.store)) return `${r.templateId} · seed ${r.seed}`;
  if (item.store === 'pyq-workspace') return `PYQ workspace for bank ${r.bankId}`;
  if (item.store === 'pyq-session') return `PYQ attempt ${r.id}`;
  if (item.store === 'pyq-exam') return `Two-paper exam ${r.id}`;
  return `Report ${r.id}`;
}

/**
 * Mount the complete-workspace backup panel. All validation and storage
 * happens in the callbacks; this module only presents the checked plan and
 * the learner's explicit choice. Nothing changes until "Restore" is pressed.
 */
export function mountWorkspaceBackup(root, {mode = 'writer', current, blocked = [], preRestore = null, onExport, onAnalyze, onApply, onDownloadPreRestore, onLoadPreRestore, onRestored = null, message: initialMessage = ''}) {
  let state = 'idle', plan = null, message = initialMessage, error = false, busy = false, choice = 'merge', focusNext = null;
  const readOnly = mode === 'reader';

  function inventory() {
    return `<table class="backup-table"><thead><tr><th>STORE</th><th>${plan ? 'IN THIS BACKUP' : 'RECORDS'}</th>${plan ? '<th>ON THIS BROWSER</th>' : ''}</tr></thead><tbody>${BACKUP_STORES.map(store => {
      const now = blocked.includes(store.slot) ? 'Unreadable (preserved)' : countRecords(store.name, current()[store.name]);
      if (!plan) return `<tr><td>${esc(store.label)}</td><td>${esc(store.name === 'goal' ? `${current().goal} a day` : now)}</td></tr>`;
      const inBackup = plan.preserved[store.name] ? 'Preserved text only — not restored' : plan.included.includes(store.name) ? (store.name === 'goal' ? `${plan.stores.goal} a day` : plan.report.counts[store.name]) : 'Not included — left unchanged';
      return `<tr><td>${esc(store.label)}</td><td>${esc(inBackup)}</td><td>${esc(store.name === 'goal' ? `${current().goal} a day` : now)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function disclosures() {
    const r = plan.report, items = [];
    for (const [label, n] of Object.entries(r.duplicates)) items.push(`<li>${esc(label)}: ${plural(n, 'exact duplicate')} collapsed into one record.</li>`);
    if (r.unresolved.length) items.push(`<li><strong>${plural(r.unresolved.length, 'record')} no longer ${r.unresolved.length === 1 ? 'resolves' : 'resolve'} in this release.</strong> ${r.unresolved.length === 1 ? 'It is' : 'They are'} kept exactly as saved in a held list, included in future exports, and re-checked on every restore. They do not appear in practice, reports or progress until their questions are available again.<ul class="backup-held">${r.unresolved.slice(0, 50).map(item => `<li><code>${esc(heldIdentity(item))}</code> — ${esc(item.reason)}</li>`).join('')}${r.unresolved.length > 50 ? `<li>…and ${r.unresolved.length - 50} more</li>` : ''}</ul></li>`);
    if (r.unlinkedPaperNotes.length) items.push(`<li>${plural(r.unlinkedPaperNotes.length, 'paper note')} ${r.unlinkedPaperNotes.length === 1 ? 'refers' : 'refer'} to paper records not in the current source archive (<code>${r.unlinkedPaperNotes.slice(0, 10).map(esc).join('</code>, <code>')}</code>). The notes are kept unchanged.</li>`);
    for (const [name, entry] of Object.entries(plan.preserved)) items.push(`<li>The ${esc(BACKUP_STORES.find(s => s.name === name)?.label || name)} section was saved as unverified text (${esc(entry.reason)}). It is not restored; that store on this browser is left unchanged.</li>`);
    for (const note of r.notes) items.push(`<li>${esc(note)}</li>`);
    if (plan.stores.pyq?.exam) items.push(`<li>A two-paper exam is in progress (${plan.stores.pyq.exam.phase === 'break' ? 'on the inter-paper break' : `Paper ${plan.stores.pyq.exam.phase === 'paper1' ? 1 : 2}`}). It resumes exactly where it stands: a paper keeps its own deadline, the break is never charged to a paper, and Paper 2’s clock starts only when you begin it.</li>`);
    if (plan.stores.session?.deadline || plan.stores.pyq?.active?.deadline) items.push('<li>Timed attempts keep their original deadlines. Restoring never adds time; an attempt whose deadline has passed is submitted at its deadline.</li>');
    return items.length ? `<h4>What this backup contains that needs your attention</h4><ul class="backup-disclosures">${items.join('')}</ul>` : '<p class="small-text muted">Every record resolved against the installed questions. No duplicates or unresolved references were found.</p>';
  }
  function previewHTML() {
    const partial = plan.source !== 'workspace';
    return `<section class="backup-preview" aria-labelledby="backup-preview-title"><span class="eyebrow">CHECKED · NOTHING HAS CHANGED YET</span><h3 id="backup-preview-title" tabindex="-1">${esc(SOURCE[plan.source])}${plan.kind === 'pre-restore' ? ' (pre-restore copy)' : ''}</h3><p class="small-text muted">${plan.exportedAt ? `Exported ${esc(when(plan.exportedAt))}. ` : ''}${partial ? 'This older format holds only one store. Stores it does not include are left exactly as they are.' : `Format version ${plan.version}. Scores, keys and totals are recalculated from exact question identities; none are taken from the file.`}</p>${inventory()}${disclosures()}
      <fieldset class="backup-mode"><legend>How should this backup be applied?</legend>
      <label><input type="radio" name="backup-mode" value="merge" ${choice === 'merge' ? 'checked' : ''}> <span><strong>Merge</strong> — add records this browser does not have. Existing records are never edited: for the same question or report, this browser’s version is kept, and the earlier first attempt stays the first attempt. Your active sessions and daily goal are kept. Size limits keep the newest 50 concept reports and 20 PYQ reports.</span></label>
      <label><input type="radio" name="backup-mode" value="replace" ${choice === 'replace' ? 'checked' : ''}> <span><strong>Replace</strong> — make ${partial ? 'the included store' : 'every included store'} match the backup exactly. Current records in ${partial ? 'that store' : 'those stores'} that the backup lacks are removed from this browser.</span></label></fieldset>
      <p class="small-text">Before either change is written, a <strong>pre-restore copy</strong> of this browser’s current workspace is kept on this device. You can download it or return to it from this page.</p>
      ${choice === 'replace' ? '<label class="check-field"><input type="checkbox" data-backup-confirm> I understand that replace removes current records in the included stores.</label>' : ''}
      <div class="progress-actions"><button class="button" data-backup-action="apply" ${busy || readOnly || choice === 'replace' ? 'disabled' : ''}>${choice === 'replace' ? 'Replace with backup' : 'Merge backup'} →</button><button class="button secondary" data-backup-action="cancel" ${busy ? 'disabled' : ''}>Cancel — keep everything as it is</button></div></section>`;
  }
  function render() {
    const held = current().unresolved.items.length;
    if (!root.querySelector('[data-backup-body]')) {
      // The heading, live region and body are created once. Only the body is
      // re-rendered, so the status region persists and announces each change.
      root.innerHTML = `<section class="panel backup-panel" aria-labelledby="backup-title"><div class="panel-head"><h3 id="backup-title">Complete workspace backup</h3><span class="small-text muted">Format version ${BACKUP_VERSION}</span></div>
      <p class="small-text muted">One file for everything this browser keeps for you: concept-practice progress and reports, the active session, saved questions, revision notes, paper notes and timers, your daily goal, and PYQ attempts and reports. No account or cloud service is involved.</p>
      <div class="backup-message" role="status" aria-live="polite" tabindex="-1"></div><div data-backup-body></div></section>`;
    }
    const status = root.querySelector('.backup-message');
    status.innerHTML = message ? `<p class="${error ? 'error-text' : ''}">${esc(message)}</p>` : '';
    // Re-rendering replaces controls; keep keyboard focus on the equivalent control.
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active ? controlSelector(active) : null;
    root.querySelector('[data-backup-body]').innerHTML = `
      ${state === 'preview' ? '' : inventory()}
      ${held ? `<p class="small-text"><strong>${plural(held, 'held record')}</strong> from earlier restores ${held === 1 ? 'no longer resolves' : 'no longer resolve'} in this release. ${held === 1 ? 'It is' : 'They are'} kept and exported unchanged.</p>` : ''}
      ${blocked.length ? `<p class="small-text error-text">Some saved data could not be read. Its exact text is included in exports, but restoring into an unreadable store is blocked so it is never overwritten.</p>` : ''}
      ${state === 'preview' && plan ? previewHTML() : `<div class="progress-actions"><button class="button" data-backup-action="export" ${busy ? 'disabled' : ''}>Export workspace backup ↓</button><label class="button secondary upload-label ${readOnly || busy ? 'is-disabled' : ''}">Check a backup to restore ↑<input type="file" data-backup-file accept="application/json,.json" ${readOnly || busy ? 'disabled' : ''}></label></div>`}
      ${preRestore ? `<div class="backup-prerestore"><p class="small-text"><strong>Pre-restore copy</strong> saved ${esc(when(preRestore.exportedAt))}${mode === 'memory' ? ' in this tab only' : ' on this device'}.</p><div class="progress-actions"><button class="button small secondary" data-backup-action="download-pre">Download pre-restore copy ↓</button><button class="button small secondary" data-backup-action="load-pre" ${readOnly || busy ? 'disabled' : ''}>Return to this copy…</button></div></div>` : ''}
      ${readOnly ? '<p class="small-text muted">This tab is read-only. Export is available; restore from the tab that is editing this workspace.</p>' : mode === 'memory' ? '<p class="small-text muted">This browser cannot save safely, so a restore stays in this tab. Export before closing it.</p>' : ''}`;
    const target = focusNext ? root.querySelector(focusNext) : focusKey ? root.querySelector(focusKey) : null;
    if (focusNext || focusKey) {
      focusNext = null;
      if (target && !target.disabled) target.focus();
      else status.focus();
    }
  }
  function controlSelector(el) {
    if (el.dataset.backupAction) return `[data-backup-action="${el.dataset.backupAction}"]`;
    if (el.name === 'backup-mode') return `input[name="backup-mode"][value="${el.value === 'replace' ? 'replace' : 'merge'}"]`;
    if (el.matches('[data-backup-confirm]')) return '[data-backup-confirm]';
    if (el.matches('[data-backup-file]')) return '[data-backup-file]';
    if (el.matches('#backup-preview-title')) return '#backup-preview-title';
    return el === root.querySelector('.backup-message') ? '.backup-message' : null;
  }
  function show(text, isError = false) { message = text; error = isError; }
  async function run(task) {
    if (busy) return;
    busy = true; render();
    try { await task(); } catch (problem) { show(problem.message || 'That did not work. Nothing was changed.', true); }
    finally { busy = false; render(); }
  }
  async function check(raw) {
    plan = await onAnalyze(raw); choice = 'merge'; state = 'preview';
    // Move keyboard and screen-reader users to the checked summary they must review.
    focusNext = '#backup-preview-title';
    show('Backup checked. Review it, then choose merge or replace.');
  }
  root.onclick = event => {
    const action = event.target.closest?.('[data-backup-action]')?.dataset.backupAction;
    if (!action || busy) return;
    if (action === 'export') run(async () => { await onExport(); show('Workspace backup exported. Keep the file somewhere safe.'); });
    if (action === 'cancel') { state = 'idle'; plan = null; focusNext = '[data-backup-file]'; show('Restore cancelled. Nothing was changed.'); render(); }
    if (action === 'download-pre') run(async () => { await onDownloadPreRestore(); });
    if (action === 'load-pre') run(async () => check(await onLoadPreRestore()));
    if (action === 'apply' && plan) run(async () => {
      const result = await onApply(plan, choice);
      preRestore = result.preRestore ?? preRestore;
      state = 'idle'; plan = null;
      show(`${choice === 'replace' ? 'Backup restored (replace).' : 'Backup merged.'} ${result.notes.length ? result.notes.join(' ') + ' ' : ''}A pre-restore copy of your previous workspace is kept below.`);
      // Let the page refresh its own summaries; it remounts this panel with the message.
      if (onRestored) setTimeout(() => onRestored(message), 0);
    });
  };
  root.onchange = event => {
    const el = event.target;
    if (el.matches('[data-backup-file]')) {
      const file = el.files?.[0]; if (!file) return;
      run(async () => {
        if (file.size > 12_000_000) throw new Error('This backup is larger than the 12 MB limit.');
        await check(await file.text());
      });
    }
    if (el.matches('input[name="backup-mode"]')) { choice = el.value; render(); }
    if (el.matches('[data-backup-confirm]')) { const apply = root.querySelector('[data-backup-action="apply"]'); if (apply) apply.disabled = busy || readOnly || !el.checked; }
  };
  render();
  // Remounted after a restore with its result: put focus on the result so it is read and keyboard position is kept.
  if (initialMessage) root.querySelector('.backup-message')?.focus();
  return () => { root.onclick = root.onchange = null; };
}
