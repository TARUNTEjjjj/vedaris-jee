import { CHAPTERS, SUBJECTS } from '../src/questions/index.js';
import { MAX_GOALS } from '../src/learning/revision-plan.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const subjectTitle = id => SUBJECTS.find(subject => subject.id === id)?.title || id;
const reasonLabel = { goal: 'Your goal.', sparse: 'Limited evidence.', content: 'Content gap.' };
const levelLabel = { sufficient: 'Based on retained attempts', limited: 'Limited evidence', none: 'No attempts yet' };

function practiceLinks(item) {
  const links = [];
  if (item.practice.originalFamilies) links.push(`<a class="button small secondary" href="#practice?subject=${encodeURIComponent(item.subject)}&amp;chapter=${encodeURIComponent(item.chapter)}">Original practice · ${item.practice.originalFamilies} ${item.practice.originalFamilies === 1 ? 'family' : 'families'} ↗</a>`);
  if (item.practice.pyqQuestions) links.push(`<a class="button small secondary" href="#pyq?subject=${encodeURIComponent(item.subject)}&amp;chapter=${encodeURIComponent(item.chapter)}">Historical PYQs · ${item.practice.pyqQuestions} ↗</a>`);
  return links.join('');
}

function card(item, readOnly) {
  const action = item.kind === 'goal'
    ? `<button type="button" class="button small secondary" data-revision-action="remove-goal" data-chapter="${esc(item.chapter)}"${readOnly ? ' disabled' : ''}>Remove goal</button>`
    : item.dismissed
      ? `<button type="button" class="button small secondary" data-revision-action="undismiss" data-chapter="${esc(item.chapter)}"${readOnly ? ' disabled' : ''}>Show again</button>`
      : `<button type="button" class="button small secondary" data-revision-action="dismiss" data-chapter="${esc(item.chapter)}" data-signature="${esc(item.signature)}"${readOnly ? ' disabled' : ''}>Not now</button>`;
  const prerequisites = item.prerequisites.length
    ? `<details class="revision-prereqs"><summary>Prerequisites to check (${item.prerequisites.length}) · <span class="revision-draft">UNREVIEWED DRAFT</span></summary><ul>${item.prerequisites.map(p => `<li><strong>${esc(p.title)}</strong> <small>${esc(subjectTitle(p.subject))}</small><p>${esc(p.rationale)}</p><p>${esc(p.evidence)}</p></li>`).join('')}</ul></details>`
    : '<p class="analysis-note">No prerequisite links are drafted for this chapter.</p>';
  return `<article class="revision-card" data-revision-chapter="${esc(item.chapter)}" aria-labelledby="revision-${esc(item.chapter)}">
    <div class="revision-card-top"><span class="badge">${item.kind === 'goal' ? 'YOUR GOAL' : 'FROM YOUR ATTEMPTS'}</span><span class="analysis-tag">${esc(levelLabel[item.evidenceLevel])}</span></div>
    <h3 id="revision-${esc(item.chapter)}">${esc(item.title)} <small>${esc(subjectTitle(item.subject))}</small></h3>
    <ul class="revision-reasons">${item.reasons.map(reason => `<li data-reason-kind="${esc(reason.kind)}">${reasonLabel[reason.kind] ? `<b>${esc(reasonLabel[reason.kind])}</b> ` : ''}${esc(reason.text)}</li>`).join('')}</ul>
    ${prerequisites}
    <div class="revision-actions">${practiceLinks(item)}${action}</div>
  </article>`;
}

/**
 * Render revision suggestions. Callbacks persist the plan and return false to reject.
 * Nothing here starts practice: links only open the learner-chosen chapter setup.
 */
export function mountRevision(root, { result, plan, readOnly = false, onAddGoal, onRemoveGoal, onDismiss, onUndismiss, onLoadPyq, pyqLoading = false, pyqError = '' }) {
  const goals = new Set((plan?.goals || []).map(goal => goal.chapter));
  const ignoredCount = Object.values(result.ignored).reduce((a, b) => a + b, 0);
  root.innerHTML = `<section class="analysis-page revision-page" aria-labelledby="revision-title">
    <header class="analysis-intro"><div><span class="eyebrow">YOU CHOOSE WHAT COMES NEXT</span><h1 id="revision-title">Revision suggestions, with reasons.</h1><p>Each suggestion cites the attempts this browser has retained or a goal you set. Nothing starts until you choose.</p></div><a class="button secondary" href="#mistakes">Revision notebook ↗</a></header>
    <p class="analysis-warning" role="note"><strong>${esc(result.relations.status === 'reviewed' ? 'Reviewed relationships.' : 'Unreviewed draft relationships.')}</strong> ${esc(result.relations.notice)} Suggestions order chapters for study; they are not a mastery estimate, rank, percentile or prediction.</p>
    ${result.planError ? '<p class="analysis-warning" role="alert">Your saved revision plan could not be read. It has been preserved and is not used here.</p>' : ''}
    <section class="analysis-card" aria-labelledby="revision-goals-heading"><div class="analysis-card-heading"><div><span class="eyebrow">DECLARED GOALS</span><h2 id="revision-goals-heading">Add a chapter you want to revise</h2></div><span class="analysis-tag">${goals.size} / ${MAX_GOALS}</span></div>
      <form class="filters" data-revision-goal-form><div class="field"><label for="revision-goal">Chapter</label><select id="revision-goal" name="chapter"${readOnly ? ' disabled' : ''}>${SUBJECTS.map(subject => `<optgroup label="${esc(subject.title)}">${CHAPTERS.filter(c => c.subject === subject.id && !goals.has(c.id)).map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</optgroup>`).join('')}</select></div><button class="button" type="submit"${readOnly || goals.size >= MAX_GOALS ? ' disabled' : ''}>Add goal →</button></form>
      <p class="analysis-note" data-revision-status role="status" aria-live="polite"></p></section>
    <section class="analysis-card" aria-labelledby="revision-list-heading"><div class="analysis-card-heading"><div><span class="eyebrow">SUGGESTIONS</span><h2 id="revision-list-heading">What your evidence points to</h2></div><span class="analysis-tag">${result.recommendations.length} shown</span></div>
      <p class="analysis-note">${esc(result.message)} Original practice: ${result.evidence.originalAttempts} retained first attempts. Historical PYQ: ${result.evidence.pyqLoaded ? `${result.evidence.pyqAttempts} retained first attempts from saved PYQ reports` : 'saved PYQ reports not loaded'}. The two kinds of evidence are listed separately and never combined into one score.</p>
      ${result.evidence.pyqLoaded ? '' : `<p class="analysis-note"><button type="button" class="button small secondary" data-revision-load-pyq${pyqLoading ? ' disabled' : ''}>${pyqLoading ? 'Loading PYQ reports…' : 'Include saved PYQ reports ↓'}</button> Downloads the reviewed question bank to grade your saved PYQ reports on this device.</p>`}
      ${pyqError ? `<p class="analysis-warning" role="alert">${esc(pyqError)}</p>` : ''}
      ${ignoredCount ? `<p class="analysis-note">${ignoredCount} saved ${ignoredCount === 1 ? 'item refers' : 'items refer'} to questions, chapters or reports this version cannot resolve (for example after a content update). They are ignored here and left unchanged in storage.</p>` : ''}
      <div class="revision-list">${result.recommendations.length ? result.recommendations.map(item => card(item, readOnly)).join('') : `<div class="analysis-empty"><h3>No suggestion yet.</h3><p>${esc(result.state === 'ready' ? 'No chapter has open incorrect or partial first attempts. Add a goal or broaden your practice.' : result.message)}</p></div>`}</div>
    </section>
    ${result.limited.length ? `<section class="analysis-card" aria-labelledby="revision-limited-heading"><div class="analysis-card-heading"><div><span class="eyebrow">NOT ENOUGH EVIDENCE TO RANK</span><h2 id="revision-limited-heading">Observations from a few attempts</h2></div></div><p class="analysis-note">These chapters have open mistakes but too few retained attempts to suggest a priority. Review them if you wish.</p><div class="revision-list">${result.limited.map(item => card(item, readOnly)).join('')}</div></section>` : ''}
    ${result.dismissed.length ? `<details class="analysis-card"><summary>Hidden suggestions (${result.dismissed.length})</summary><p class="analysis-note">A hidden suggestion returns when its retained evidence changes.</p><div class="revision-list">${result.dismissed.map(item => card(item, readOnly)).join('')}</div></details>` : ''}
  </section>`;
  const status = root.querySelector('[data-revision-status]');
  const attempt = (callback, value, message) => {
    try { if (callback?.(...value) === false) throw new Error('The revision plan could not be saved. Nothing was changed.'); if (status) status.textContent = message; }
    catch (error) { if (status) status.textContent = error.message; }
  };
  root.querySelector('[data-revision-goal-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    if (readOnly) return;
    attempt(onAddGoal, [event.target.elements.namedItem('chapter').value], 'Goal added.');
  });
  root.querySelectorAll('[data-revision-action]').forEach(button => button.addEventListener('click', () => {
    if (readOnly) return;
    const chapter = button.dataset.chapter;
    if (button.dataset.revisionAction === 'remove-goal') attempt(onRemoveGoal, [chapter], 'Goal removed.');
    else if (button.dataset.revisionAction === 'dismiss') attempt(onDismiss, [chapter, button.dataset.signature], 'Hidden until your evidence changes.');
    else attempt(onUndismiss, [chapter], 'Suggestion restored.');
  }));
  root.querySelector('[data-revision-load-pyq]')?.addEventListener('click', () => onLoadPyq?.());
}
