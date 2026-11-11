import { CHAPTERS, SUBJECTS } from '../src/questions/catalog.js';
import { createHistoricalSession, answerHistorical, finishHistorical, visitHistorical, trackHistorical, toggleHistoricalFlag, saveHistoricalSession, gradeHistorical, restoreHistoricalWorkspace } from '../src/content/session.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = Object.fromEntries(SUBJECTS.map(s => [s.id, s.title]));
const chapters = new Map(CHAPTERS.map(c => [c.id, c]));
const types = {single:'Single correct', multiple:'Multiple correct', numerical:'Numerical answer', bonus:'Official bonus'};
const answered = value => Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== '';
const format = n => new Intl.NumberFormat('en-IN', {maximumFractionDigits:2}).format(n);
const duration = ms => `${Math.floor(Math.max(0, ms || 0) / 60000)}m ${Math.floor(Math.max(0, ms || 0) / 1000) % 60}s`;
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2,'0')}:${String(Math.floor(s / 60) % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`; };
const date = ms => new Intl.DateTimeFormat('en-IN', {dateStyle:'medium',timeStyle:'short'}).format(ms);
const seed = () => globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] : Date.now() % 4294967296;
const option = (value,label,selected) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
let mountId = 0;

// These are section-wide instructions, never the number of correct choices
// for the question currently on screen.
export function partialRuleText(marking) {
  const rules = marking?.partialCreditRules ?? [];
  if (!rules.length) return 'No partial-credit rule is declared for this section.';
  return rules.map(rule => `+${format(rule.marks)} when exactly ${rule.totalCorrect} options are correct and you select only ${rule.selectedCorrect} of them`).join('; ') + '. Every selected option must be correct. A complete accepted answer earns full marks; otherwise the wrong-answer penalty applies. Blank responses earn 0.';
}

export function historicalSectionNavigation(questions,subject) {
  const groups=new Map(),mixed=new Set(questions.map(q=>q.paperId)).size>1;
  questions.forEach((q,index)=>{
    const key=`${q.paperId}:${q.section}`;
    if(q.subject===subject&&!groups.has(key))groups.set(key,{key,index,label:mixed?`${q.year} P${q.paper} · ${q.section}`:q.section});
  });
  return [...groups.values()];
}

/** Mount an independent, source-backed PYQ workspace. Cleanup flushes visible question time. */
export function mountPYQ(root, {registry, markup = {}, workspace, onChange, readOnly = false, filters = {}, backupRaw = null, memoryMode = false} = {}) {
  if (!root || !registry || !workspace || typeof onChange !== 'function') throw new TypeError('PYQ requires a container, registry, workspace and persistence callback.');
  const uid = `pyq-${++mountId}`;
  let state = workspace, view = 'hub', displayIndex = state.active?.index || 0, reportId = null;
  let pending = null, confirmSubmit = false, reportFilter = 'all', page = 1, notice = '', disposed = false, committing = false;
  let clockAt = Date.now(), failure = false, visible = !document.hidden;
  const all = registry.filterQuestions(), papers = registry.listPapers();
  const years = [...new Set(all.map(q => q.year))].sort((a,b) => b-a);
  const filter = {year:filters.year || '', subject:filters.subject || 'all', chapter:filters.chapter || 'all', type:filters.type || 'all'};
  let setCount = '5', setTimed = false, setMinutes = '30';
  if (!SUBJECTS.some(s => s.id === filter.subject)) filter.subject = 'all';
  if (!chapters.has(filter.chapter)) filter.chapter = 'all';
  if (!Object.hasOwn(types, filter.type)) filter.type = 'all';
  if (!years.includes(Number(filter.year))) filter.year = '';

  function writeNotice(message) {
    notice = message;
    const node = root.querySelector('[data-pyq-notice]');
    if (node) { node.textContent = message; node.hidden = !message; }
  }
  function commit(next) {
    if (readOnly || disposed || committing) return false;
    let accepted = false;
    committing = true;
    try { accepted = onChange(next) !== false; }
    catch { accepted = false; }
    finally { committing = false; }
    if (!accepted) {
      failure = true;
      writeNotice('Your latest change could not be saved. It has not replaced your saved session. Try again after restoring browser storage.');
      return false;
    }
    state = next;
    if (failure) { failure = false; writeNotice('Saving is working again. Your latest change is saved.'); }
    return true;
  }
  function storeSession(session) { return commit(saveHistoricalSession(state, session)); }
  function afterCompletion(session) {
    if (!session.finishedAt) return;
    if (view === 'session') { reportId = session.id; view = 'report'; confirmSubmit = false; render(); }
    else if (view === 'hub' || view === 'instructions') render();
  }
  function flushTime() {
    const now = Date.now(), elapsed = view === 'session' && visible ? Math.min(60000, Math.max(0, now - clockAt)) : 0;
    clockAt = now;
    const active = state.active;
    if (readOnly || !active || active.finishedAt || committing || disposed) return true;
    try {
      let next = elapsed > 0 ? trackHistorical(active, elapsed, now) : active;
      if (!next.finishedAt && next.deadline != null && now >= next.deadline) next = finishHistorical(next, now);
      if (next === active) return true;
      if (!storeSession(next)) return false;
      afterCompletion(next);
      return true;
    } catch (error) { writeNotice(error.message || 'The session could not be updated.'); return false; }
  }
  function updateSession(fn, rerender = true) {
    if (readOnly || !flushTime() || !state.active || state.active.finishedAt) return false;
    try {
      const next = fn(state.active, Date.now());
      if (!storeSession(next)) return false;
      displayIndex = next.index;
      if (next.finishedAt) afterCompletion(next); else if (rerender) render();
      return true;
    } catch (error) { writeNotice(error.message || 'That response could not be saved.'); return false; }
  }
  function changeView(next) {
    flushTime();
    view = next; confirmSubmit = false; clockAt = Date.now(); render();
  }
  function assetHTML(asset) {
    let url;
    try { url = new URL(/^https:\/\//.test(asset.url) ? asset.url : `../${asset.url}`, import.meta.url).href; }
    catch { return '<span class="pyq-asset-missing">Figure unavailable</span>'; }
    return `<span class="pyq-figure"><img src="${esc(url)}" alt="${esc(asset.alt)}" loading="lazy" decoding="async"><span class="pyq-figure-caption">${esc(asset.alt)}</span></span>`;
  }
  function withFigures(html, question, used) {
    return html.replace(/\[(P?FIG_[A-Z0-9_]+)\]/g, (placeholder, id) => {
      const asset = question.assets.find(a => a.id === id);
      if (!asset) return `<span class="pyq-asset-missing">${esc(placeholder)} — figure unavailable</span>`;
      used.add(id); return assetHTML(asset);
    });
  }
  function questionHTML(q, {response = null, interactive = false, solution = false, solutionOnly = false} = {}) {
    const m = markup[q.id] || {}, used = new Set();
    const rendered = (html, fallback) => withFigures(typeof html === 'string' ? html : `<p>${esc(fallback)}</p>`, q, used);
    const stem = rendered(m.statement, q.stem);
    const lists = q.matchingLists ? `<div class="pyq-matching">${['left','right'].map((side,i) => `<section><h4>List ${i ? 'II' : 'I'}</h4><dl>${q.matchingLists[side].map((entry,index) => `<div><dt>${esc(entry.label)}</dt><dd>${rendered(m.matchingLists?.[side]?.[index]?.html, entry.text)}</dd></div>`).join('')}</dl></section>`).join('')}</div>` : '';
    const choices = q.options?.length ? `<div class="pyq-options" ${interactive ? `role="group" aria-label="${q.type === 'multiple' ? 'Select all correct options' : 'Choose one option'}"` : ''}>${q.options.map(o => {
      const selected = Array.isArray(response) ? response.includes(o.id) : response === o.id;
      const text = rendered(m.options?.[o.id], o.text);
      return interactive ? `<label class="pyq-option ${selected ? 'is-selected' : ''}"><input data-pyq-choice="${esc(o.id)}" type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="${uid}-answer" value="${esc(o.id)}" ${selected ? 'checked' : ''} ${readOnly || q.type === 'bonus' ? 'disabled' : ''}><span class="pyq-choice-letter">${esc(o.id)}</span><span class="pyq-rich">${text}</span></label>` : `<div class="pyq-option"><b class="pyq-choice-letter">${esc(o.id)}</b><div class="pyq-rich">${text}</div></div>`;
    }).join('')}</div>` : '';
    const extra = q.assets.filter(a => a.role === 'statement' && !used.has(a.id)).map(assetHTML).join('');
    const numeric = interactive && q.type === 'numerical' ? `<div class="pyq-numeric"><label for="${uid}-numeric">Your numerical answer</label><input id="${uid}-numeric" data-pyq-numeric type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="96" value="${esc(response ?? '')}" placeholder="Enter your answer" ${readOnly ? 'disabled' : ''}><small>Saved as you type. Leave the field empty to skip.</small></div>` : '';
    const reasoning = solution ? `<section class="pyq-solution"><h4>Worked solution</h4><p class="pyq-caption">Original Vedaris explanation · checked against the source answer</p><ol>${q.solution.map((step,i) => `<li class="pyq-rich">${rendered(m.solution?.[i],step)}</li>`).join('')}</ol>${q.assets.filter(a => a.role === 'solution' && !used.has(a.id)).map(assetHTML).join('')}</section>` : '';
    return solutionOnly ? reasoning : `<div class="pyq-stem pyq-rich">${stem}</div>${lists}${extra}${choices}${numeric}${reasoning}`;
  }
  function header(kicker, title, description, actions = '') {
    return `<header class="pyq-heading"><div><span class="eyebrow">${esc(kicker)}</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${actions ? `<div class="pyq-heading-actions">${actions}</div>` : ''}</header>`;
  }
  function button(action, label, {secondary = false, disabled = false, value = '', small = false} = {}) {
    return `<button type="button" class="button ${secondary ? 'secondary' : ''} ${small ? 'small' : ''}" data-pyq-action="${action}" ${value ? `data-value="${esc(value)}"` : ''} ${disabled ? 'disabled' : ''}>${label}</button>`;
  }
  function marking(q) {
    if(q.type==='bonus')return `<span class="pyq-marking">Officially dropped · +${format(q.marking.correct)} awarded to everyone, including blank responses</span>`;
    return `<span class="pyq-marking">+${format(q.marking.correct)} correct · ${format(q.marking.incorrect)} incorrect · ${format(q.marking.unanswered)} blank${q.type === 'multiple' ? ' · Partial credit follows the original section rules' : ''}</span>`;
  }
  function sourceSection(q) {
    return registry.getPaper?.(q.paperId)?.sections.find(section => section.subject === q.subject && section.id === q.section);
  }
  function partialInstructions(rules) {
    const distinct = [...new Map(rules.filter(section => section.type === 'multiple').map(section => [JSON.stringify(section.marking), section])).values()];
    return distinct.map(section => `<div class="pyq-rule-note"><b>Multiple-correct sections · +${format(section.marking.correct)} full · ${format(section.marking.incorrect)} wrong · ${format(section.marking.unanswered)} blank</b><p>${esc(partialRuleText(section.marking))}</p></div>`).join('');
  }
  function coverageHTML() {
    const coverage = registry.coverageByYear?.() ?? [];
    if (!coverage.length) return '';
    return `<details class="pyq-card"><summary>Year-by-year coverage · Physics, Chemistry and Mathematics</summary><p class="pyq-caption">Counts are questions with worked explanations available for practice. A source link alone does not count. Zero means that subject has not been loaded for that year.</p><div class="pyq-table-scroll"><table><thead><tr><th>Year</th><th>Physics</th><th>Chemistry</th><th>Maths</th><th>Full mocks</th></tr></thead><tbody>${coverage.map(row=>`<tr><th>${row.year}</th><td>${row.physics}</td><td>${row.chemistry}</td><td>${row.mathematics}</td><td>${row.fullPapers}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function selectedQuestions() { return registry.filterQuestions(filter); }
  function hubHTML() {
    const selected = selectedQuestions(), pages = Math.max(1, Math.ceil(selected.length / 10));
    page = Math.min(page, pages);
    const visible = selected.slice((page-1)*10,page*10), complete = papers.filter(p => p.complete);
    const offeredChapters = CHAPTERS.filter(c => (filter.subject === 'all' || c.subject === filter.subject) && all.some(q => q.chapters.includes(c.id)));
    const active = state.active;
    return `${header('AUTHENTIC EXAM QUESTIONS', 'The PYQ workspace.', 'Practise the questions that appeared in JEE Advanced, with source marking and worked explanations.')}
      <div class="pyq-coverage"><div><strong>${format(all.length)}</strong><span>playable questions</span></div><div><strong>${years.length}</strong><span>exam ${years.length === 1 ? 'year' : 'years'} in this bank</span></div><div><strong>${complete.length}</strong><span>complete ${complete.length === 1 ? 'paper' : 'papers'} ready</span></div><p>This playable bank covers ${years.length ? years.join(', ') : 'no years yet'}. The wider <a href="#archive">paper archive</a> contains source links; those links are not counted as playable questions.</p></div>
      ${coverageHTML()}${active ? `<section class="pyq-resume"><div><span class="eyebrow">SAVED IN PROGRESS</span><h2>${active.mode === 'paper' ? 'Continue your paper.' : 'Continue your question set.'}</h2><p>${active.responses.filter(answered).length} of ${active.questionIds.length} answered${active.deadline ? ` · <span data-pyq-resume-clock>${clock(active.deadline - Date.now())}</span> remaining` : ' · Untimed'}.</p></div>${button('resume','Resume session →')}</section>` : ''}
      <div class="pyq-hub-grid"><section class="pyq-card"><div class="pyq-section-heading"><div><span class="eyebrow">CHAPTERWISE PRACTICE</span><h2>Build your next set</h2></div><span class="pyq-pill">${selected.length} match</span></div>
      <div class="pyq-filters"><label>Exam year<select data-pyq-filter="year">${option('','All loaded years',filter.year)}${years.map(y => option(y,y,filter.year)).join('')}</select></label><label>Subject<select data-pyq-filter="subject">${option('all','All subjects',filter.subject)}${SUBJECTS.map(s => option(s.id,s.title,filter.subject)).join('')}</select></label><label>Chapter<select data-pyq-filter="chapter">${option('all','All loaded chapters',filter.chapter)}${offeredChapters.map(c => option(c.id,`${c.title}${filter.subject === 'all' ? ` · ${names[c.subject]}` : ''}`,filter.chapter)).join('')}</select></label><label>Question type<select data-pyq-filter="type">${option('all','All types',filter.type)}${Object.entries(types).filter(([t]) => all.some(q => q.type === t)).map(([t,label]) => option(t,label,filter.type)).join('')}</select></label></div>
      <div class="pyq-set-options"><label>Questions<select data-pyq-set="count">${[['1','1 question'],['5','5 questions'],['10','10 questions'],['all',selected.length>500?'500 from matches':'All matches']].map(([v,l]) => option(v,l,setCount)).join('')}</select></label><label class="pyq-checkbox"><input type="checkbox" data-pyq-set="timed" ${setTimed ? 'checked' : ''}>Timed practice</label><label ${setTimed ? '' : 'hidden'}>Minutes<input data-pyq-set="minutes" type="number" min="1" max="720" value="${esc(setMinutes)}"></label></div>
      <div class="pyq-start-row">${button('prepare-set','Review set & start →',{disabled:readOnly || !selected.length})}<small>${selected.length ? `${setCount === 'all' ? Math.min(500,selected.length) : Math.min(Number(setCount),selected.length)} actual questions · original marking rules` : 'No loaded questions match these filters.'}</small></div>
      <div class="pyq-bank-list">${visible.length ? visible.map(q => `<article><div><span class="pyq-caption">${q.year} · Paper ${q.paper} · ${esc(names[q.subject])}</span><h3>Question ${esc(q.questionNumber)} <span>${esc(types[q.type])}</span></h3><p>${q.chapters.map(c => esc(chapters.get(c)?.title || c)).join(' · ')}</p></div>${button('prepare-one','Practise ↗',{secondary:true,small:true,disabled:readOnly,value:q.id})}</article>`).join('') : '<div class="pyq-empty"><h3>No questions in this selection.</h3><p>Try another chapter, subject or question type. Only questions loaded into this bank appear here.</p></div>'}</div>
      ${pages > 1 ? `<div class="pyq-pagination">${button('bank-prev','← Previous',{secondary:true,small:true,disabled:page === 1})}<span>Page ${page} of ${pages}</span>${button('bank-next','Next →',{secondary:true,small:true,disabled:page === pages})}</div>` : ''}</section>
      <aside class="pyq-hub-aside"><section class="pyq-paper-card"><span class="eyebrow">FULL HISTORICAL MOCKS</span><h2>The whole paper.<br>The original challenge.</h2><p>Complete papers keep their original question order, section rules and duration.</p>${papers.length ? papers.map(p => `<article class="pyq-paper-entry"><div><h3>${p.year} · Paper ${p.paper}</h3><span>${p.complete ? `${p.expectedQuestionCount} questions · ${p.maxMarks} marks · ${p.durationMinutes} minutes` : `${p.loadedQuestionCount} questions loaded · incomplete paper`}</span></div>${p.complete ? button('prepare-paper','Read instructions →',{value:p.paperId,disabled:readOnly}) : `<p class="pyq-caption">${esc(p.reasons.join(' '))}</p>`}</article>`).join('') : '<p>No complete historical mock is loaded yet.</p>'}</section>
      <section class="pyq-card pyq-history"><span class="eyebrow">YOUR LOCAL TEST HISTORY</span><h2>Return to a report</h2><p class="pyq-caption">Latest 20 completed PYQ sessions on this browser.</p>${state.history.length ? state.history.map(s => {let r;try {r=gradeHistorical(s,registry);}catch{return '';}return `<button type="button" data-pyq-action="history" data-value="${esc(s.id)}"><span><b>${s.mode === 'paper' ? 'Full paper' : 'PYQ practice'}</b><small>${esc(date(s.finishedAt))} · ${s.questionIds.length} questions</small></span><strong>${format(r.score)}<small> / ${format(r.maxScore)}</small></strong></button>`;}).join('') : '<p class="pyq-empty-copy">Finish a paper or chapter set to keep its score and solutions here.</p>'}</section><section class="pyq-card"><h3>Your PYQ backup</h3><p class="pyq-caption">Export your active attempt and last 20 reports before switching devices or clearing browser data.</p><div class="pyq-start-row">${button('export','Export backup ↓',{secondary:true,small:true})}<label class="button secondary small">Restore backup ↑<input data-pyq-import type="file" accept="application/json,.json" hidden ${readOnly?'disabled':''}></label></div></section></aside></div>`;
  }
  function instructionsHTML() {
    const chosen = pending.questionIds.map(id => registry.getQuestion(id));
    const subjectGroups = SUBJECTS.map(s => ({...s,questions:chosen.filter(q => q.subject === s.id)})).filter(s => s.questions.length);
    const total = chosen.reduce((sum,q) => sum+q.marking.correct,0);
    const paper = pending.paperId ? registry.getFullPaper(pending.paperId) : null;
    const rules = paper ? paper.sections : [...new Map(chosen.map(q => [`${q.paperId}:${q.subject}:${q.section}:${q.type}`,{subject:q.subject,id:q.section,title:`${q.year} · Paper ${q.paper} · ${q.section}`,type:q.type,questionIds:chosen.filter(other => other.paperId===q.paperId && other.subject===q.subject && other.section===q.section && other.type===q.type).map(other=>other.id),marking:q.type==='bonus'?q.marking:(sourceSection(q)?.marking ?? q.marking)}])).values()];
    return `${header('BEFORE YOU BEGIN',paper ? `${paper.year} · JEE Advanced Paper ${paper.paper}` : 'Your historical question set',paper ? 'A complete source-backed paper, with the original duration and marking.' : 'A selection of actual exam questions, with their source marking.',button('hub','← Back to bank',{secondary:true}))}<section class="pyq-card pyq-instructions"><div class="pyq-summary-grid"><div><strong>${chosen.length}</strong><span>questions</span></div><div><strong>${format(total)}</strong><span>maximum marks</span></div><div><strong>${pending.timed ? `${pending.minutes} min` : 'Untimed'}</strong><span>${pending.timed ? 'Wall-clock timer' : 'Self-paced practice'}</span></div></div><div class="pyq-instruction-copy"><h2>Make this an honest attempt.</h2><ul><li>Answers and worked explanations appear after you submit.</li><li>You can move between subjects, flag questions and change responses before submitting.</li><li>Every response is saved to this browser. Keep this device and browser for resuming.</li>${pending.timed ? '<li>The timer continues if you leave this screen or close the tab. The paper is submitted when the deadline is reached.</li>' : '<li>This set has no time limit. Your active question time is recorded while the question screen is visible.</li>'}<li>Multiple-correct questions can carry partial credit. Selecting a wrong option may incur negative marks. Read the displayed section rule.</li></ul></div><div class="pyq-subject-summary">${subjectGroups.map(s => `<span><b>${esc(s.title)}</b>${s.questions.length} questions · ${format(s.questions.reduce((n,q)=>n+q.marking.correct,0))} marks</span>`).join('')}</div>${chosen.some(q=>q.type==='bonus')?`<div class="pyq-rule-note"><b>Official final-key adjustment</b><p>${chosen.filter(q=>q.type==='bonus').map(q=>`${q.year} Paper ${q.paper} ${names[q.subject]} Q${q.questionNumber}: +${format(q.marking.correct)}`).join('; ')}. These officially dropped questions award the stated marks to everyone, including when unanswered, and are excluded from accuracy.</p></div>`:''}<h3>Section marking</h3><div class="pyq-table-scroll"><table><thead><tr><th>Subject / section</th><th>Questions</th><th>Full</th><th>Wrong</th><th>Blank</th></tr></thead><tbody>${rules.map(s => `<tr><th>${esc(names[s.subject])}<small>${esc(s.title)} · ${esc(types[s.type] || s.type)}</small></th><td>${s.questionIds.length}</td><td>+${format(s.marking.correct)}</td><td>${format(s.marking.incorrect)}</td><td>${format(s.marking.unanswered)}</td></tr>`).join('')}</tbody></table></div>${partialInstructions(rules)}${state.active ? `<div class="pyq-replace"><h3>An unfinished session is saved.</h3><p>Starting this set replaces its ${state.active.questionIds.length} questions and saved responses. To keep that attempt, return to the bank and resume it.</p><label class="pyq-checkbox"><input type="checkbox" data-pyq-replace>Replace the unfinished session</label></div>` : ''}<div class="pyq-start-row">${button('start',paper ? 'Begin full paper →' : 'Begin PYQ practice →',{disabled:readOnly || !!state.active})}<small>${readOnly ? 'This tab is in read-only mode.' : 'No rank or percentile is estimated.'}</small></div></section>`;
  }
  function paletteHTML(session) {
    return `<div class="pyq-palette">${session.questionIds.map((id,index) => {
      const q = registry.getQuestion(id), done = answered(session.responses[index]), flag = session.flags[index], visit = session.visited[index];
      return `<button type="button" data-pyq-action="question" data-value="${index}" class="${done ? 'is-answered' : visit ? 'is-visited' : ''} ${flag ? 'is-flagged' : ''} ${index===displayIndex ? 'is-current' : ''}" aria-label="${esc(`${names[q.subject]} Q${q.questionNumber}, ${done ? 'answered' : visit ? 'visited, unanswered' : 'not visited'}${flag ? ', flagged for review' : ''}`)}" ${index===displayIndex ? 'aria-current="true"' : ''}>${index+1}${flag ? '<span aria-hidden="true">★</span>' : ''}</button>`;
    }).join('')}</div>`;
  }
  function sessionHTML() {
    const s = state.active;
    if (!s) { view='hub'; return hubHTML(); }
    displayIndex = Math.max(0,Math.min(displayIndex,s.questionIds.length-1));
    const q = registry.getQuestion(s.questionIds[displayIndex]);
    const groups = SUBJECTS.map(subject => ({...subject,index:s.questionIds.findIndex(id=>registry.getQuestion(id).subject===subject.id)})).filter(subject=>subject.index>=0);
    const sections = historicalSectionNavigation(s.questionIds.map(id=>registry.getQuestion(id)),q.subject);
    return `${header('ACTUAL JEE ADVANCED · IN PROGRESS', s.mode==='paper' ? `${q.year} · Paper ${q.paper}` : 'Your PYQ practice',`${s.questionIds.length} source questions · responses saved on this browser`,button('hub','← Bank & history',{secondary:true}))}<div class="pyq-exam-toolbar"><nav aria-label="Jump to subject">${groups.map(subject=>`<button type="button" data-pyq-action="question" data-value="${subject.index}" class="${subject.id===q.subject?'active':''}" ${subject.id===q.subject?'aria-current="true"':''}>${esc(subject.title)}</button>`).join('')}</nav><div class="pyq-time"><span>${s.deadline ? 'TIME REMAINING' : 'ACTIVE TIME'}</span><strong data-pyq-clock>${s.deadline ? clock(s.deadline-Date.now()) : duration(s.timeSpentMs.reduce((sum,n)=>sum+(n||0),0))}</strong></div></div>${confirmSubmit ? `<section class="pyq-submit-confirm" role="region" aria-label="Confirm submission"><div><h2>Submit this attempt?</h2><p>${s.responses.filter(answered).length} answered · ${s.responses.filter(r=>!answered(r)).length} unanswered · ${s.flags.filter(Boolean).length} flagged. Submission ends the attempt and reveals answers.</p></div><div>${button('finish','Submit & see report',{disabled:readOnly})}${button('cancel-submit','Keep working',{secondary:true})}</div></section>` : ''}<div class="pyq-exam-grid"><section class="pyq-card pyq-question"><div class="pyq-question-meta"><span class="pyq-pill">${esc(names[q.subject])} · Q${esc(q.questionNumber)}</span><span>${displayIndex+1} / ${s.questionIds.length}</span></div><div class="pyq-section-jumps" aria-label="Jump to section">${sections.map(section=>`<button type="button" data-pyq-action="question" data-value="${section.index}" class="${section.key===`${q.paperId}:${q.section}`?'active':''}">${esc(section.label)}</button>`).join('')}</div><div class="pyq-question-caption"><span>${esc(types[q.type])}${q.matchingLists ? ' · Matching lists' : ''}</span>${marking(q)}</div>${q.type==='multiple' ? `<details class="pyq-rule-note"><summary>Section partial-credit rules</summary><p>${esc(partialRuleText(sourceSection(q)?.marking))}</p></details>` : ''}${questionHTML(q,{response:s.responses[displayIndex],interactive:true})}<p class="pyq-caption">Source: ${q.year}, Paper ${q.paper}, ${esc(names[q.subject])} Q${esc(q.questionNumber)} · PDF page ${q.source.page}</p><div class="pyq-question-actions">${button('previous','← Previous',{secondary:true,disabled:displayIndex===0})}${button('next',displayIndex===s.questionIds.length-1?'Last question':readOnly?'Next →':'Save & next →',{disabled:displayIndex===s.questionIds.length-1})}${button('flag',s.flags[displayIndex]?'★ Unflag':'☆ Flag for review',{secondary:true,disabled:readOnly})}${button('clear','Clear response',{secondary:true,disabled:readOnly || !answered(s.responses[displayIndex])})}</div></section><aside class="pyq-card pyq-exam-aside"><div class="pyq-section-heading"><h2>Your paper</h2><span data-pyq-answered>${s.responses.filter(answered).length} answered</span></div>${paletteHTML(s)}<div class="pyq-palette-key"><span><i class="answered"></i>Answered</span><span><i class="visited"></i>Visited</span><span><i></i>Not visited</span><span>★ Flagged</span></div>${button('submit','Submit attempt →',{disabled:readOnly})}<p class="pyq-caption">${readOnly?'Browsing only in this tab. Responses cannot be changed.':'Your responses are saved automatically. Leaving this screen preserves the attempt.'}</p></aside></div>`;
  }
  function reportHTML() {
    const session = state.history.find(s=>s.id===reportId);
    if (!session) { view='hub'; return hubHTML(); }
    const report = gradeHistorical(session,registry);
    const rows = report.rows.map((r,i)=>({...r,index:i,item:r.item || r.question || registry.getQuestion(r.questionId || session.questionIds[i]),response:r.response ?? session.responses[i],flagged:r.flagged ?? session.flags[i],timeSpentMs:r.timeSpentMs ?? session.timeSpentMs[i]}));
    const attempted = rows.filter(r=>r.status!=='skipped' && r.status!=='bonus').length, correct=rows.filter(r=>r.status==='correct').length;
    const counts=Object.fromEntries(['correct','partial','incorrect','skipped','bonus'].map(status=>[status,rows.filter(r=>r.status===status).length]));
    const visible=rows.filter(r=>reportFilter==='all'||(reportFilter==='flagged'?r.flagged:r.status===reportFilter));
    const missed=rows.filter(r=>!['correct','bonus'].includes(r.status));
    const activeTime=session.timeSpentMs.reduce((sum,n)=>sum+(n||0),0);
    const title=session.mode==='paper' ? `${rows[0]?.item.year} · Paper ${rows[0]?.item.paper}` : 'Historical practice report';
    return `${header('YOUR COMPLETED PYQ ATTEMPT',title,`${date(session.finishedAt)} · actual exam questions`,button('hub','← Bank & history',{secondary:true}))}<section class="pyq-result-hero"><div><span class="eyebrow">MARKS EARNED</span><strong>${format(report.score)}<small> / ${format(report.maxScore)}</small></strong><p>${counts.correct} correct · ${counts.partial} partial · ${counts.incorrect} incorrect · ${counts.skipped} skipped${counts.bonus ? ` · ${counts.bonus} official bonus` : ''}</p></div><div>${button('retry','Retry exact missed questions →',{disabled:readOnly||!missed.length})}<p>${missed.length} questions to revisit · no generated replacements</p></div></section><div class="pyq-report-metrics"><article><span>Attempt accuracy</span><strong>${attempted ? `${format(correct/attempted*100)}%` : '—'}</strong><small>${correct} fully correct / ${attempted} attempted</small></article><article><span>Active question time</span><strong>${duration(activeTime)}</strong><small>Visible question screen</small></article><article><span>Elapsed time</span><strong>${duration(session.finishedAt-session.startedAt)}</strong><small>Includes time away</small></article><article><span>Negative marks</span><strong>${format(rows.reduce((sum,r)=>sum+Math.max(0,-r.score),0))}</strong><small>From this attempt</small></article></div><div class="pyq-report-subjects">${SUBJECTS.map(subject=>{const group=rows.filter(r=>r.item.subject===subject.id);if(!group.length)return '';return `<section class="pyq-card"><h3>${esc(subject.title)}</h3><strong>${format(group.reduce((sum,r)=>sum+r.score,0))}<small> / ${format(group.reduce((sum,r)=>sum+r.maxScore,0))}</small></strong><p>${group.filter(r=>r.status==='correct').length} correct · ${group.filter(r=>!['skipped','bonus'].includes(r.status)).length} answered · ${group.length} total</p></section>`;}).join('')}</div><section class="pyq-card"><div class="pyq-section-heading"><div><span class="eyebrow">UNDERSTAND EVERY ATTEMPT</span><h2>Question review & solutions</h2></div></div><div class="pyq-report-filters" role="group" aria-label="Filter review questions">${[['all','All',rows.length],['incorrect','Incorrect',counts.incorrect],['partial','Partial',counts.partial],['skipped','Skipped',counts.skipped],['correct','Correct',counts.correct],['flagged','Flagged',rows.filter(r=>r.flagged).length]].map(([key,label,count])=>`<button type="button" data-pyq-action="report-filter" data-value="${key}" class="${reportFilter===key?'active':''}" aria-pressed="${reportFilter===key}">${label} <b>${count}</b></button>`).join('')}</div><div class="pyq-review-list">${visible.length ? visible.map(r=>{const q=r.item;const key=q.type==='bonus'?'Official bonus awarded to all':q.acceptedOptionSets?.length?q.acceptedOptionSets.map(set=>set.join(', ')).join(' OR '):q.acceptedValues?.length?q.acceptedValues.join(' or '):q.acceptedRanges?.length?q.acceptedRanges.map(range=>`${range[0]} to ${range[1]}`).join(' OR '):q.acceptedRange?`${q.answer} (accepted ${q.acceptedRange[0]} to ${q.acceptedRange[1]})`:Array.isArray(q.answer)?q.answer.join(', '):q.answer;const response=answered(r.response)?Array.isArray(r.response)?r.response.join(', '):r.response:'Unanswered';return `<details class="pyq-review"><summary><span class="pyq-result-status ${esc(r.status)}">${esc(r.status)}</span><span><b>${esc(names[q.subject])} · Q${esc(q.questionNumber)}</b><small>${q.chapters.map(c=>esc(chapters.get(c)?.title||c)).join(' · ')}</small></span><strong>${format(r.score)} / ${format(r.maxScore)}<small>${duration(r.timeSpentMs)}</small></strong></summary><div class="pyq-review-body">${questionHTML(q)}<div class="pyq-review-answer"><p>Your answer<strong>${esc(response)}</strong></p><p>Accepted answer<strong>${esc(key)}</strong></p></div>${questionHTML(q,{solution:true,solutionOnly:true})}<p class="pyq-source-link"><a href="${esc(q.source.url)}#page=${q.source.page}" target="_blank" rel="noopener noreferrer">Original paper · PDF page ${q.source.page} ↗</a> · Solution: Vedaris original explanation</p></div></details>`;}).join('') : '<div class="pyq-empty"><h3>No questions in this filter.</h3><p>Choose another result category above.</p></div>'}</div></section><p class="pyq-caption pyq-report-footnote">This report covers this attempt only. Retries use the exact source questions and create a separate report. No rank, percentile or mastery score is inferred.</p>`;
  }
  function render() {
    if (disposed) return;
    const body = view==='instructions' && pending ? instructionsHTML() : view==='session' ? sessionHTML() : view==='report' ? reportHTML() : hubHTML();
    root.innerHTML = `<div class="pyq-page">${memoryMode?'<div class="pyq-readonly" role="status">Memory-only practice: this browser cannot save your work. Export a PYQ backup before closing or reloading this tab.</div>':''}${readOnly?'<div class="pyq-readonly" role="status">Read-only tab: browse questions and saved reports here. Use the active tab to save responses or start an attempt.</div>':''}<div class="pyq-notice" data-pyq-notice role="status" ${notice?'':'hidden'}>${esc(notice)}</div>${body}</div>`;
  }
  function refreshSessionStatus() {
    const s=state.active;if(!s)return;
    root.querySelectorAll('[data-pyq-clock]').forEach(el=>{el.textContent=s.deadline?clock(s.deadline-Date.now()):duration(s.timeSpentMs.reduce((sum,n)=>sum+(n||0),0));});
    root.querySelectorAll('[data-pyq-resume-clock]').forEach(el=>{el.textContent=clock(s.deadline-Date.now());});
    const count=root.querySelector('[data-pyq-answered]');if(count)count.textContent=`${s.responses.filter(answered).length} answered`;
    root.querySelectorAll('.pyq-palette button').forEach(el=>{const i=Number(el.dataset.value),q=registry.getQuestion(s.questionIds[i]),done=answered(s.responses[i]);el.classList.toggle('is-answered',done);el.classList.toggle('is-visited',!!s.visited[i]&&!done);el.setAttribute('aria-label',`${names[q.subject]} Q${q.questionNumber}, ${done?'answered':s.visited[i]?'visited, unanswered':'not visited'}${s.flags[i]?', flagged for review':''}`);});
    const clear=root.querySelector('[data-pyq-action="clear"]');if(clear)clear.disabled=readOnly||!answered(s.responses[displayIndex]);
    root.querySelectorAll('.pyq-option').forEach(el=>el.classList.toggle('is-selected',!!el.querySelector('input:checked')));
  }
  function prepare(spec) {
    if(readOnly)return;
    flushTime();pending=spec;view='instructions';clockAt=Date.now();render();
  }
  function goto(index) {
    if(!state.active)return;
    const target=Math.max(0,Math.min(index,state.active.questionIds.length-1));
    if(readOnly){displayIndex=target;render();return;}
    if(updateSession((s,now)=>visitHistorical(s,target,now),false)){displayIndex=target;render();root.querySelector('.pyq-question')?.scrollIntoView({block:'start',behavior:'instant'});}
  }
  function click(event) {
    const b=event.target.closest?.('[data-pyq-action]');if(!b||!root.contains(b)||b.disabled)return;
    const action=b.dataset.pyqAction,value=b.dataset.value;
    if(action==='export'){flushTime();const data=backupRaw??JSON.stringify(state,null,2),url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='vedaris-pyq-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
    if(action==='hub'){changeView('hub');return;}
    if(action==='resume'){if(!state.active)return;view='session';displayIndex=state.active.index;clockAt=Date.now();if(!readOnly)updateSession((s,now)=>visitHistorical(s,s.index,now));render();return;}
    if(action==='bank-prev'||action==='bank-next'){page+=action==='bank-prev'?-1:1;render();return;}
    if(action==='history'){flushTime();reportId=value;reportFilter='all';view='report';render();return;}
    if(action==='report-filter'){reportFilter=value;render();return;}
    if(action==='question'){goto(Number(value));return;}
    if(action==='previous'||action==='next'){goto(displayIndex+(action==='next'?1:-1));return;}
    if(action==='cancel-submit'){confirmSubmit=false;render();return;}
    if(readOnly)return;
    if(action==='prepare-set'){
      const selected=selectedQuestions();if(!selected.length)return;
      const count=setCount==='all'?Math.min(500,selected.length):Math.min(Number(setCount),selected.length);
      const start=Math.floor(seed()/4294967296*Math.max(1,selected.length));
      const ids=Array.from({length:count},(_,i)=>selected[(start+i)%selected.length].id);
      const minutes=Number(setMinutes);if(setTimed&&(!Number.isInteger(minutes)||minutes<1||minutes>720)){writeNotice('Choose a whole number of minutes between 1 and 720.');return;}
      prepare({questionIds:ids,paperId:null,timed:setTimed,minutes:setTimed?minutes:null});return;
    }
    if(action==='prepare-one'){prepare({questionIds:[value],paperId:null,timed:false,minutes:null});return;}
    if(action==='prepare-paper'){try{const paper=registry.getFullPaper(value);prepare({questionIds:paper.orderedQuestionIds,paperId:value,timed:true,minutes:paper.durationMinutes});}catch(error){writeNotice(error.message);}return;}
    if(action==='retry'){
      const s=state.history.find(item=>item.id===reportId);if(!s)return;
      const r=gradeHistorical(s,registry);const ids=r.rows.map((row,i)=>({row,id:s.questionIds[i]})).filter(({row})=>!['correct','bonus'].includes(row.status)).map(({id})=>id);
      if(ids.length)prepare({questionIds:ids,paperId:null,timed:false,minutes:null});return;
    }
    if(action==='start'){
      if(!pending)return;
      if(state.active&&!root.querySelector('[data-pyq-replace]')?.checked){writeNotice('Confirm replacing the unfinished session, or return to resume it.');return;}
      if(!flushTime())return;
      try{
        let s=createHistoricalSession(registry,{...pending,bankId:state.bankId,seed:seed(),now:Date.now()});
        s=visitHistorical(s,0,Date.now());
        if(!storeSession(s))return;
        displayIndex=0;view='session';pending=null;confirmSubmit=false;clockAt=Date.now();render();
      }catch(error){writeNotice(error.message);}return;
    }
    if(action==='flag'){updateSession((s,now)=>toggleHistoricalFlag(s,displayIndex,now));return;}
    if(action==='clear'){updateSession((s,now)=>answerHistorical(s,displayIndex,registry.getQuestion(s.questionIds[displayIndex]).type==='multiple'?[]:'',registry,now));return;}
    if(action==='submit'){if(!flushTime()||!state.active)return;confirmSubmit=true;render();root.querySelector('[data-pyq-action="finish"]')?.focus();return;}
    if(action==='finish'){updateSession((s,now)=>finishHistorical(s,now));return;}
  }
  async function change(event) {
    const el=event.target;
    if(el.matches('[data-pyq-import]')){
      const file=el.files?.[0];if(!file||readOnly)return;
      try{if(file.size>2000000)throw new Error('Backup exceeds the 2 MB limit.');const imported=restoreHistoricalWorkspace(await file.text(),registry,state.bankId);if(!imported)throw new Error('This backup does not match the reviewed question bank or contains invalid saved data.');if(disposed)return;if((state.active||state.history.length)&&!confirm('Replace this browser’s active PYQ attempt and saved reports with this backup? Export the current backup first if you want to keep it.'))return;if(commit(imported)){view='hub';render();writeNotice('PYQ backup restored. Scores are recalculated from the reviewed answer keys.');}}
      catch(error){writeNotice(error.message);}return;
    }
    if(el.matches('[data-pyq-filter]')){
      filter[el.dataset.pyqFilter]=el.value;if(el.dataset.pyqFilter==='subject')filter.chapter='all';page=1;
      const focus=el.dataset.pyqFilter;render();root.querySelector(`[data-pyq-filter="${focus}"]`)?.focus();return;
    }
    if(el.matches('[data-pyq-set]')){
      const key=el.dataset.pyqSet;if(key==='count')setCount=el.value;if(key==='minutes')setMinutes=el.value;if(key==='timed'){setTimed=el.checked;render();}return;
    }
    if(el.matches('[data-pyq-replace]')){const start=root.querySelector('[data-pyq-action="start"]');if(start)start.disabled=readOnly||!el.checked;return;}
    if(el.matches('[data-pyq-choice]')){
      if(readOnly||!state.active)return;
      const q=registry.getQuestion(state.active.questionIds[displayIndex]);
      const value=q.type==='multiple'?[...root.querySelectorAll('[data-pyq-choice]:checked')].map(n=>n.value):el.value;
      if(!updateSession((s,now)=>answerHistorical(s,displayIndex,value,registry,now),false))render();else refreshSessionStatus();
    }
  }
  function input(event) {
    const el=event.target;
    if(el.matches('[data-pyq-set="minutes"]')){setMinutes=el.value;return;}
    if(!el.matches('[data-pyq-numeric]')||readOnly||!state.active)return;
    const value=el.value;
    if(!updateSession((s,now)=>answerHistorical(s,displayIndex,value,registry,now),false)){
      if(root.contains(el)&&state.active)el.value=String(state.active.responses[displayIndex]??'');
    }else refreshSessionStatus();
  }
  function visibility(){flushTime();visible=!document.hidden;clockAt=Date.now();refreshSessionStatus();}
  function pagehide(){flushTime();}
  root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',input);
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);
  render();
  // Expiry is checked on mount even when the visitor is browsing the bank.
  flushTime();
  const interval=setInterval(()=>{if(!failure)flushTime();refreshSessionStatus();},1000);
  const cleanup=()=>{if(disposed)return;flushTime();disposed=true;clearInterval(interval);root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',input);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);};
  cleanup.updateWorkspace=next=>{
    if(!readOnly||disposed)return;
    const signature=s=>JSON.stringify(s?{id:s.id,responses:s.responses,flags:s.flags,visited:s.visited}:null);
    const changed=signature(state.active)!==signature(next.active)||state.history.map(s=>s.id).join()!==next.history.map(s=>s.id).join();
    const previous=state.active;state=next;
    if(view==='session'&&previous&&!state.active){reportId=previous.id;view=state.history.some(s=>s.id===reportId)?'report':'hub';render();}
    else if(view!=='report'&&changed)render();
    else if(view==='report'&&!state.history.some(s=>s.id===reportId)){view='hub';render();}
    else refreshSessionStatus();
  };
  return cleanup;
}
