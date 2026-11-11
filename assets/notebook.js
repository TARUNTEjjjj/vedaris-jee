import { CHAPTERS, SUBJECTS } from '../src/questions/index.js';
import { emptyNotebook, restoreNotebook, updateNotebook, notebookEntries, NOTEBOOK_CAUSES, MAX_NOTE_LENGTH } from '../src/learning/notebook.js';

const esc = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const causes = { unclassified: 'Unclassified', concept: 'Concept gap', calculation: 'Calculation', misread: 'Misread question', time: 'Time pressure' };
const gradeLabels = { incorrect: 'Incorrect first attempt', partial: 'Partial first attempt', correct: 'Correct first attempt', unattempted: 'Not attempted' };
const identity = ({ templateId, seed }) => ({ templateId, seed });
const PAGE_SIZE = 20;
const options = (values, current) => values.map(([value, label]) => `<option value="${esc(value)}"${current === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
const responseText = response => Array.isArray(response) ? response.join(', ') : response;

/**
 * Mount in a dedicated element. onChange(next) persists synchronously; return false
 * or throw to reject a change. onRetry receives exact identities, at most 20.
 * No storage is written here. A read-only mount permits viewing and filtering only.
 */
export function mountNotebook(root, { progress, bookmarks = [], notebook = emptyNotebook(), onChange, onRetry, readOnly = false } = {}) {
  let current = restoreNotebook(notebook);
  let filters = { subject: 'all', status: 'open', cause: 'all' };
  let page = 0, message = '', error = false, entries = [], shown = [];
  const drafts = new Map();
  const locked = readOnly || typeof onChange !== 'function' || current === null;
  const retryLocked = readOnly || typeof onRetry !== 'function' || current === null;

  function render() {
    try { entries = notebookEntries(progress, bookmarks, current); }
    catch (problem) {
      root.innerHTML = `<section class="notebook notebook-empty"><h2>Notebook unavailable</h2><p role="alert">${esc(problem.message)}</p></section>`;
      return;
    }
    const filtered = entries.filter(entry => (filters.subject === 'all' || entry.item.subject === filters.subject)
      && (filters.cause === 'all' || entry.cause === filters.cause)
      && (filters.status === 'all' || (filters.status === 'open' && !entry.resolved) || (filters.status === 'resolved' && entry.resolved) || (filters.status === 'saved' && entry.bookmarked) || filters.status === entry.status));
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, pages - 1));
    shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const openCount = entries.filter(entry => !entry.resolved).length;
    root.innerHTML = `<section class="notebook" aria-label="Mistake notebook">
      <div class="notebook-overview"><div><span class="eyebrow">REVIEW WITH INTENTION</span><h2>Make the next attempt count.</h2><p>First-attempt errors and saved questions, in one place. These are original concept-practice questions, not JEE PYQs.</p></div><div class="notebook-count"><strong>${esc(openCount)}</strong><span>open for review</span><small>${esc(entries.length - openCount)} marked resolved</small></div></div>
      <div class="notebook-filters">
        <label>Subject<select data-notebook-filter="subject">${options([['all', 'All subjects'], ...SUBJECTS.map(subject => [subject.id, subject.title])], filters.subject)}</select></label>
        <label>Status<select data-notebook-filter="status">${options([['open', 'Open for review'], ['resolved', 'Marked resolved'], ['incorrect', 'Incorrect first attempt'], ['partial', 'Partial first attempt'], ['saved', 'Saved questions'], ['all', 'All questions']], filters.status)}</select></label>
        <label>Cause<select data-notebook-filter="cause">${options([['all', 'All causes'], ...NOTEBOOK_CAUSES.map(cause => [cause, causes[cause]])], filters.cause)}</select></label>
        <button type="button" class="button" data-notebook-action="retry-visible"${retryLocked || !shown.length ? ' disabled' : ''}>Retry visible questions (${esc(shown.length)}) →</button>
      </div>
      <p class="notebook-help">Resolution is your review decision; it never changes your first-attempt score. Notes stay in this browser. ${locked ? 'This view is read-only.' : 'Save your note before leaving this page.'}</p>
      <p class="notebook-message${error ? ' notebook-error' : ''}" role="${error ? 'alert' : 'status'}" aria-live="polite">${esc(message)}</p>
      <div class="notebook-list">${shown.length ? shown.map(card).join('') : `<div class="notebook-empty"><h3>${entries.length ? 'No questions match these filters.' : 'A fresh page for your progress.'}</h3><p>${entries.length ? 'Change a filter to see more of your notebook.' : 'Finish a practice session or save a question in the Question studio. Incorrect and partial first attempts appear here automatically.'}</p></div>`}</div>
      <div class="notebook-pagination"><span>${filtered.length ? `${esc(page * PAGE_SIZE + 1)}–${esc(Math.min((page + 1) * PAGE_SIZE, filtered.length))} of ${esc(filtered.length)} questions` : '0 questions'}</span><div><button type="button" class="button secondary small" data-notebook-action="previous"${page === 0 ? ' disabled' : ''}>← Previous</button><button type="button" class="button secondary small" data-notebook-action="next"${page + 1 >= pages ? ' disabled' : ''}>Next →</button></div></div>
    </section>`;
  }

  function card(entry) {
    const draft = drafts.get(entry.id) || entry;
    const subject = SUBJECTS.find(value => value.id === entry.item.subject)?.title || entry.item.subject;
    const chapter = CHAPTERS.find(value => value.id === entry.item.chapter)?.title || entry.item.chapter;
    return `<article class="notebook-card${entry.resolved ? ' notebook-resolved' : ''}" data-notebook-card="${esc(entry.id)}">
      <div class="notebook-card-top"><div class="notebook-badges"><span class="badge original">ORIGINAL PRACTICE</span><span class="notebook-grade notebook-grade-${esc(entry.status)}">${esc(gradeLabels[entry.status])}</span>${entry.bookmarked ? '<span class="notebook-saved">★ Saved</span>' : ''}</div><span class="notebook-state">${entry.resolved ? '✓ Marked resolved' : 'Open for review'}</span></div>
      <p class="notebook-subject">${esc(subject)} · ${esc(chapter)}</p><h3>${esc(entry.item.title)}</h3>
      <p class="notebook-stem">${esc(entry.item.stem)}</p>
      ${entry.item.options ? `<ul class="notebook-options">${entry.item.options.map(option => `<li><b>${esc(option.id)}</b><span>${esc(option.text)}</span></li>`).join('')}</ul>` : ''}
      <p class="notebook-attempt">${entry.status === 'unattempted' ? 'No scored first attempt is stored for this question.' : `First response: <strong>${esc(responseText(entry.response))}</strong><span>${esc(entry.score)} / ${esc(entry.maxScore)} marks</span>`}</p>
      <details class="notebook-solution"><summary>Reveal worked solution</summary><p><strong>Answer: ${esc(responseText(entry.item.answer))}</strong></p><ol>${entry.item.solution.map(step => `<li>${esc(step)}</li>`).join('')}</ol></details>
      <form class="notebook-annotation" data-notebook-entry="${esc(entry.id)}">
        <label>What needs work?<select name="cause"${locked ? ' disabled' : ''}>${options(NOTEBOOK_CAUSES.map(cause => [cause, causes[cause]]), draft.cause)}</select></label>
        <label class="notebook-note">Your next-step note<textarea name="note" rows="3" maxlength="${esc(MAX_NOTE_LENGTH)}" placeholder="What will you do differently next time?"${locked ? ' disabled' : ''}>${esc(draft.note)}</textarea><small>Up to ${esc(MAX_NOTE_LENGTH)} characters.</small></label>
        <div class="notebook-card-actions"><button type="submit" class="button secondary small"${locked ? ' disabled' : ''}>Save note</button><button type="button" class="button secondary small" data-notebook-action="resolve" data-notebook-id="${esc(entry.id)}"${locked ? ' disabled' : ''}>${entry.resolved ? 'Reopen for review' : 'Mark resolved'}</button><button type="button" class="button small" data-notebook-action="retry" data-notebook-id="${esc(entry.id)}"${retryLocked ? ' disabled' : ''}>Retry this question →</button></div>
      </form><p class="notebook-identity">Question variant ${esc(entry.seed)} · ${esc(entry.templateId)}</p>
    </article>`;
  }

  function save(entry, patch, success) {
    if (locked) return;
    try {
      const next = updateNotebook(current, identity(entry), patch);
      if (onChange(next) === false) throw new Error('The notebook change could not be saved. Your previous entry is unchanged.');
      current = next;
      if (Object.hasOwn(patch, 'note')) drafts.delete(entry.id);
      message = success; error = false;
    } catch (problem) { message = problem.message; error = true; }
    render();
  }

  // Dedicated root handlers are replaced on remount; no document listeners survive navigation.
  root.onchange = event => {
    const filter = event.target.closest('[data-notebook-filter]');
    if (filter && root.contains(filter) && Object.hasOwn(filters, filter.dataset.notebookFilter)) {
      filters = { ...filters, [filter.dataset.notebookFilter]: filter.value }; page = 0; render();
    } else rememberDraft(event);
  };
  function rememberDraft(event) {
    if (locked) return;
    const form = event.target.closest('form[data-notebook-entry]');
    if (form && root.contains(form) && entries.some(entry => entry.id === form.dataset.notebookEntry)) drafts.set(form.dataset.notebookEntry, { cause: form.elements.namedItem('cause').value, note: form.elements.namedItem('note').value });
  }
  root.oninput = rememberDraft;
  root.onsubmit = event => {
    const form = event.target.closest('form[data-notebook-entry]');
    if (!form || !root.contains(form)) return;
    event.preventDefault();
    const entry = entries.find(value => value.id === form.dataset.notebookEntry);
    if (entry) save(entry, { cause: form.elements.namedItem('cause').value, note: form.elements.namedItem('note').value }, 'Note saved. Keep the next step specific.');
  };
  root.onclick = event => {
    const button = event.target.closest('[data-notebook-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    const action = button.dataset.notebookAction;
    const entry = entries.find(value => value.id === button.dataset.notebookId);
    if (action === 'previous' || action === 'next') { page += action === 'next' ? 1 : -1; render(); }
    else if (action === 'resolve' && entry) save(entry, { resolved: !entry.resolved }, entry.resolved ? 'Reopened for review.' : 'Marked resolved. Your first-attempt record is unchanged.');
    else if (!retryLocked && (action === 'retry-visible' || (action === 'retry' && entry))) {
      const selected = action === 'retry-visible' ? shown : [entry];
      if (!selected.length) return;
      try { onRetry(selected.map(identity)); }
      catch (problem) { message = problem.message; error = true; render(); }
    }
  };
  render();
}
