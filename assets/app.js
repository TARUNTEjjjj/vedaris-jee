import { CHAPTERS, SUBJECTS, listTemplates, generate } from '../src/questions/index.js';
import { gradeQuestion } from '../src/questions/grading.js';
import { createSession, sessionItems, setResponse, toggleFlag, finishSession, gradeSession, restoreSession, remainingMs, createRetrySession, visitQuestion, trackTime, createRevisionSession } from '../src/practice/session.js';
import { emptyProgress, recordSession, getStats, exportProgress, importProgress } from '../src/learning/progress.js';
import { emptyHistory, recordHistory, restoreHistory } from '../src/learning/history.js';
import { emptyNotebook, restoreNotebook, updateNotebook } from '../src/learning/notebook.js';
import { mountDashboard, mountTestCenter } from './dashboard.js';
import { mountAnalysis } from './analysis.js';
import { mountNotebook } from './notebook.js';
import { mountReport } from './report.js';
import { mountPYQ } from './pyq.js';
import { loadContentManifest, loadContentBank } from './content-loader.js';
import { emptyHistoricalWorkspace, restoreHistoricalWorkspace } from '../src/content/session.js';
import { acquireWorkspaceWriter } from '../src/learning/storage.js';
import { archiveStats, filterPapers, validateArchive } from '../src/archive/index.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = name => `vedaris.${name}.v1`;
const blocked = new Set();
const main = $('#main');
let archive = {version:1,checkedAt:'2026-11-11',sources:[],papers:[]};
let archiveError = '';
let contentManifest = null, contentError = '', contentBank = null, contentLoading = null;
let historicalWorkspace = null, historicalBackupRaw = null, historicalMemory = false, disposePYQ = null, routeGeneration = 0;
let session = null;
let progress = emptyProgress();
let bookmarks = [];
let history = emptyHistory();
let notebook = emptyNotebook();
let dailyGoal = 10;
let timingCursor = performance.now();
let trackingActive = false;
let paperNotes = {};
let studioItem = null;
let studioResponse = '';
let studioResult = null;
let archiveLimit = 30;
let timerHandle;
let writer = {mode:'memory',release(){}};
let readerRefresh;
const subjectTitle = id => SUBJECTS.find(s => s.id === id)?.title || (id === 'all' ? 'All subjects' : id);
const chapterTitle = id => CHAPTERS.find(c => c.id === id)?.title || id;
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const link = (url, label, cls='') => `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const routeName = {overview:'Study dashboard',tests:'Test centre',analysis:'Performance analysis',mistakes:'Revision notebook',report:'Session analysis',chapters:'Chapter library',pyq:'PYQ practice',archive:'Paper sources',practice:'Practice session',bank:'Question studio',progress:'Your progress',sources:'Sources & methods',paper:'Paper workspace'};
const params = () => new URLSearchParams(location.hash.split('?')[1] || '');
const route = () => location.hash.replace(/^#/, '').split('?')[0].split('/')[0] || 'overview';
function notify(message, error=false) { $('#notice').innerHTML = message ? `<div class="notice${error?' error':''}">${esc(message)}</div>` : ''; }
function readLocal(name, fallback, validate = () => true) {
  try { const raw = localStorage.getItem(key(name)); if (!raw) return fallback; const value = JSON.parse(raw); if (!validate(value)) throw new Error('Invalid saved data'); return value; }
  catch { blocked.add(name); notify(`Saved ${name} could not be read. Export or clear browser data before replacing it; other workspace features remain available.`,true); return fallback; }
}
function saveLocal(name, value) {
  if(writer.mode!=='writer')return false;
  if (blocked.has(name)) { notify(`Saved ${name} is unreadable. It has been preserved instead of overwritten.`, true); return false; }
  try { localStorage.setItem(key(name), JSON.stringify(value)); return true; }
  catch { notify('This browser could not save your work. Keep this tab open and export your progress when possible.', true); return false; }
}
function download(name, content) { const a=document.createElement('a');const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function intro(title, subtitle, action='') { return `<div class="page-intro"><div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function stat(label, value, suffix='') { return `<div class="stat"><label>${label}</label><strong>${esc(value)}</strong>${suffix?`<small>${esc(suffix)}</small>`:''}</div>`; }
function empty(title, text) { return `<div class="empty"><h3>${title}</h3><p>${text}</p></div>`; }
function subjectOptions(selected='all', includeAll=true) { return `${includeAll?'<option value="all">All three subjects</option>':''}${SUBJECTS.map(s=>`<option value="${s.id}" ${selected===s.id?'selected':''}>${esc(s.title)}</option>`).join('')}`; }
function chapterOptions(subject='all', selected='all', supportedOnly=false) { return `<option value="all">All available chapters</option>${CHAPTERS.filter(c=>subject==='all'||c.subject===subject).filter(c=>!supportedOnly||listTemplates({chapter:c.id}).length).map(c=>`<option value="${c.id}" ${selected===c.id?'selected':''}>${esc(c.title)}</option>`).join('')}`; }
function showOverview() {
 mountDashboard(main,{progress,history,session,content:contentManifest,goal:dailyGoal,onGoalChange(value){if(writer.mode==='reader')return;dailyGoal=value;saveLocal('goal',value);showOverview();updateWriterUI();}});
}
function loadHistoricalState(){
 const fallback=emptyHistoricalWorkspace(contentManifest.bankId);
 try{const raw=localStorage.getItem(key('pyq-workspace'));historicalBackupRaw=raw;historicalMemory=false;historicalWorkspace=raw?restoreHistoricalWorkspace(raw,contentBank.registry,contentManifest.bankId):fallback;if(!historicalWorkspace){blocked.add('pyq-workspace');historicalWorkspace=fallback;notify('Your saved PYQ workspace could not be validated. It has been preserved; export the saved data before replacing it.',true);}}
 catch{historicalWorkspace??=fallback;historicalMemory=true;notify('This browser cannot access saved PYQ work. Practice is available in this tab; export a PYQ backup before closing it.',true);}
}
async function showPYQ(){
 const generation=routeGeneration;
 main.innerHTML=intro('Real questions. Careful reasoning.','Loading reviewed papers, diagrams and worked solutions…');
 try{
  if(!contentManifest)contentManifest=await loadContentManifest();
  if(!contentBank){contentLoading??=loadContentBank(contentManifest,archive).catch(error=>{contentLoading=null;throw error});contentBank=await contentLoading;loadHistoricalState();}
  if(generation!==routeGeneration||route()!=='pyq')return;
  disposePYQ=mountPYQ(main,{...contentBank,workspace:historicalWorkspace,backupRaw:blocked.has('pyq-workspace')?historicalBackupRaw:null,memoryMode:writer.mode==='memory'||historicalMemory,filters:Object.fromEntries(params()),readOnly:writer.mode==='reader'||blocked.has('pyq-workspace'),onChange(next){if(writer.mode==='reader'||blocked.has('pyq-workspace'))return false;if(writer.mode==='writer'&&!historicalMemory&&!saveLocal('pyq-workspace',next))return false;historicalWorkspace=next;return true;}});
  updateWriterUI();
 }catch(error){if(generation!==routeGeneration||route()!=='pyq')return;main.innerHTML=intro('The question bank could not load.',esc(error.message))+`<button class="button" id="reload-content">Try again →</button><a class="button secondary" href="#archive">Browse paper sources ↗</a>`;$('#reload-content').addEventListener('click',showPYQ);}
}
function canReplaceSession(){return !session||!!session.finishedAt||confirm('You have an unfinished session. Replace it with a new set? Its unfinished answers will be discarded.');}
function startSession(options){
 if(writer.mode==='reader'||!canReplaceSession())return;
 try { flushTime(); if(session?.finishedAt)recordCompleted(); const next=createSession({...options,seed:newSeed()});
 const order=next.questions.map((q,i)=>({q,i,subject:generate(q.templateId,q.seed).subject})).sort((a,b)=>SUBJECTS.findIndex(s=>s.id===a.subject)-SUBJECTS.findIndex(s=>s.id===b.subject));
 session={...next,questions:order.map(v=>v.q),responses:order.map(v=>next.responses[v.i]),flags:order.map(v=>next.flags[v.i]),visited:order.map(v=>next.visited[v.i]),timeSpentMs:order.map(v=>next.timeSpentMs[v.i])};persistSession();location.hash='practice';showQuestion();updateWriterUI();
 }catch(error){notify(error.message,true)}
}
function showTests(){mountTestCenter(main,{session,history,content:contentManifest,onStart:startSession});}
function showAnalysis(){mountAnalysis(main,{progress,history,onOpenReport:id=>{location.hash=`report?attempt=${encodeURIComponent(id)}`}});}
function showNotebook(){mountNotebook(main,{progress,bookmarks,notebook,readOnly:writer.mode==='reader',onChange(next){if(writer.mode==='reader')return false;if(writer.mode==='writer'&&!saveLocal('notebook',next))return false;notebook=next;return true;},onRetry(identities){if(writer.mode==='reader'||!canReplaceSession())return;try{flushTime();session=createRevisionSession(identities);persistSession();location.hash='practice';showQuestion();}catch(error){notify(error.message,true)}}});}
function flushTime(){
 const now=performance.now(), elapsed=Math.max(0,Math.min(60000,Math.floor(now-timingCursor)));timingCursor=now;
 if(trackingActive&&writer.mode!=='reader'&&session&&!session.finishedAt){session=trackTime(session,elapsed);persistSession();if(session.finishedAt){trackingActive=false;recordCompleted();}}
}
function showChapters() {
 const subject=params().get('subject')||'physics';
 main.innerHTML=intro('Every chapter, in perspective.','Find actual exam questions by chapter, alongside original concept practice.')+`<div class="filter-tabs">${SUBJECTS.map(s=>`<a class="tab ${subject===s.id?'active':''}" href="#chapters?subject=${s.id}">${esc(s.title)}</a>`).join('')}</div><div class="chapter-grid">${CHAPTERS.filter(c=>c.subject===subject).map((c,i)=>{const families=listTemplates({chapter:c.id}),pyqs=contentManifest?.chapterCounts?.[c.id]||0;return `<article class="chapter"><div class="chapter-num">${subjectTitle(c.subject).toUpperCase()} / ${String(i+1).padStart(2,'0')}</div><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p><div class="chapter-bottom"><span>${pyqs?`${pyqs} reviewed PYQs`:'PYQs being reviewed'}${families.length?` · ${families.length} original ${families.length===1?'family':'families'}`:''}</span>${pyqs?`<a class="button small" href="#pyq?subject=${c.subject}&chapter=${c.id}">Solve PYQs ↗</a>`:''}${families.length?`<a class="button small secondary" href="#practice?subject=${c.subject}&chapter=${c.id}">Practice ↗</a>`:`<a class="small-text inline-link" href="#archive?subject=${c.subject}">Find paper sources ↗</a>`}</div></article>`}).join('')}</div><div class="subtle-note">This is a study organisation map, not a claim of complete syllabus coverage. Confirm examinable topics against the official syllabus for your target year.</div>`;
}
function showArchive() {
 const p=params();const year=p.get('year')||'';const stats=archiveStats(archive);
 main.innerHTML=intro('The questions that shaped JEE.','Explore historical sources. Keep the original paper and its context together.')+`<div class="stats-strip">${stat('YEARS WITH SOURCES',stats.yearCount)}${stat('OFFICIAL PAPERS',stats.officialPaperCount)}${stat('PARTIAL COLLECTIONS',stats.partialCollectionCount)}${stat('PLAYABLE PYQs',contentManifest?.questionCount||0)}</div>${archiveError?`<div class="subtle-note">${esc(archiveError)}</div>`:''}<form class="filters" id="archive-filters"><div class="field search"><label for="archive-query">Find a paper</label><input id="archive-query" type="search" name="query" placeholder="Search year, paper, subject…"></div><div class="field"><label for="archive-year">Year</label><select id="archive-year" name="year"><option value="">Every year</option>${stats.yearsListed.slice().reverse().map(y=>`<option ${String(y)===year?'selected':''}>${y}</option>`).join('')}</select></div><div class="field"><label for="archive-subject">Subject</label><select id="archive-subject" name="subject">${subjectOptions(p.get('subject')||'all')}</select></div><div class="field"><label for="archive-source">Source</label><select id="archive-source" name="authority"><option value="all">All sources</option><option value="official">Official only</option><option value="third-party">Third-party only</option></select></div></form><div class="subtle-note">${stats.firstYear||1978}–${stats.lastYear||2026} is the span of linked sources. Older collections may be incomplete. These links are not a fully digitised, answer-verified PYQ bank.</div><div id="archive-results"></div>`;
 const form=$('#archive-filters');form.addEventListener('submit',e=>e.preventDefault());form.addEventListener('input',()=>{archiveLimit=30;renderPapers()});renderPapers();
}
function renderPapers() {
 const f=new FormData($('#archive-filters'));const y=f.get('year');
 const papers=filterPapers(archive.papers,{query:f.get('query'),subject:f.get('subject'),from:y,to:y,authority:f.get('authority'),sources:archive.sources}).sort((a,b)=>b.year-a.year||(a.paper||0)-(b.paper||0));
 $('#archive-results').innerHTML=`<div class="result-count">${papers.length} source records ${papers.length>archiveLimit?`· showing ${archiveLimit}`:''}</div><div class="paper-grid">${papers.slice(0,archiveLimit).map(p=>{const source=archive.sources.find(s=>s.id===p.sourceId);const official=source?.authority==='official';return `<article class="paper-card"><div class="paper-body"><span class="badge ${official?'':'third'}">${official?'● OFFICIAL SOURCE':'◌ THIRD-PARTY COLLECTION'}</span><div class="paper-year">${p.year}</div><div class="paper-title">${esc(p.label)}</div><div class="paper-details">${p.coverage==='full-paper'?'Full paper':p.coverage==='partial-collection'?'Selected questions · incomplete':'Completeness unverified'}${p.questionCount?` · ${p.questionCount} questions`:''}<br>${p.verification==='pdf-verified'?'PDF file checked':p.verification==='http-verified'?'Link responds':'Link observed at source'} · Source linked</div></div><div class="paper-actions"><a href="#paper/${encodeURIComponent(p.id)}">Open workspace ↗</a>${link(p.url,'Open source ↗')}</div></article>`}).join('')}</div>${!papers.length?empty('No papers match those filters.','Try a different year, subject, or source.'):''}${papers.length>archiveLimit?'<div class="spaced"><button id="load-papers" class="button secondary">Show more papers ↓</button></div>':''}`;
 $('#load-papers')?.addEventListener('click',()=>{archiveLimit+=30;renderPapers()});
}
function markingText(item) { const m=item.marking;return `Correct +${m.correct} · Incorrect ${m.incorrect} · Unanswered ${m.unanswered}${m.partial?` · Partial +${m.partial.perCorrect} per correct choice, only when no wrong choice is selected`:''}`; }
function answerInputs(item,response='',disabled=false) {
 if(item.type==='numerical')return `<div class="numeric-response"><label for="numeric-answer">Your numerical answer</label><input id="numeric-answer" type="text" inputmode="decimal" maxlength="80" autocomplete="off" value="${esc(response)}" ${disabled?'disabled':''} placeholder="Integer, decimal, or fraction"><small class="marking-note">Use a number or a fraction such as 3/2. No units.</small></div>`;
 const values=Array.isArray(response)?response:[response];return `<div class="answer-options">${item.options.map(o=>`<label class="answer-option"><input type="${item.type==='multiple'?'checkbox':'radio'}" name="answer" value="${esc(o.id)}" ${values.includes(o.id)?'checked':''} ${disabled?'disabled':''}><span class="choice-letter">${esc(o.id)}</span><span>${esc(o.text)}</span></label>`).join('')}</div>`;
}
function collectAnswer(item) { if(item.type==='numerical')return $('#numeric-answer')?.value||'';const selected=[...document.querySelectorAll('input[name="answer"]:checked')].map(n=>n.value);return item.type==='multiple'?selected:selected[0]||''; }
function solutionHTML(item) { return `<div class="solution"><h3>Worked reasoning</h3><p class="small-text"><strong>Answer: ${esc(Array.isArray(item.answer)?item.answer.join(', '):item.answer)}</strong></p><ol>${item.solution.map(step=>`<li>${esc(step)}</li>`).join('')}</ol></div>`; }
function showPractice() { if(['setup','subject','chapter','count'].some(key=>params().has(key)))return showSetup();if(session){if(!session.finishedAt&&session.deadline&&remainingMs(session)<=0){session=finishSession(session);persistSession();}return session.finishedAt?showReport():showQuestion();}showSetup(); }
function showSetup() {
 const p=params();const s=p.get('subject')||'all';const c=p.get('chapter')||'all';
 main.innerHTML=intro('Make room for focused practice.','Reproducible original questions, with clear scoring and worked solutions.')+`<div class="setup-grid"><section class="panel"><h3>Build your session</h3><form class="setup-form" id="session-form"><div class="field"><label for="session-subject">Subject</label><select id="session-subject" name="subject">${subjectOptions(s)}</select></div><div class="field"><label for="session-chapter">Chapter</label><select id="session-chapter" name="chapter">${chapterOptions(s,c,true)}</select></div><div class="field"><label for="session-count">Questions</label><select id="session-count" name="count"><option value="1">1 · Single question</option><option value="3" ${c!=='all'?'selected':''}>3 · Concept focus</option><option value="6" ${p.get('count')==='6'?'selected':''}>6 · Quick focus</option><option value="12" ${c==='all'&&p.get('count')!=='6'?'selected':''}>12 · Practice set</option><option value="30">30 · Extended set</option></select></div><div class="field"><label for="session-minutes">Time in minutes</label><input id="session-minutes" name="minutes" type="number" min="1" max="360" value="${c==='all'?(p.get('count')==='6'?18:36):9}" required></div><label class="check-field wide"><input type="checkbox" name="timed" checked> Use a countdown timer</label><button class="button wide" type="submit">Begin practice <span>→</span></button></form><p class="small-text muted spaced">Your answers and flags save on this device. The timer keeps running when you close the tab.</p></section><section class="panel prose"><span class="eyebrow">KNOW YOUR PRACTICE</span><h3>Reason first. Review carefully.</h3><p>These are Vedaris original question families. Seeded variants help you practise concepts; they are not previous-year questions or calibrated JEE mock tests.</p><p>Single-choice, multiple-correct and numerical responses use the marking rule shown on each question. Negative and partial marks apply only where specified.</p><p>For actual previous-year questions and complete historical mocks, open PYQ practice.</p><a class="button secondary spaced" href="#pyq">Solve real PYQs ↗</a></section></div>`;
 $('#session-subject').addEventListener('change',e=>{$('#session-chapter').innerHTML=chapterOptions(e.target.value,'all',true);updateSessionCounts()});
 $('#session-chapter').addEventListener('change',updateSessionCounts);
 $('#session-count').addEventListener('change',e=>$('#session-minutes').value=Number(e.target.value)*3);
 updateSessionCounts();
 $('#session-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);startSession({subject:f.get('subject'),chapter:f.get('chapter'),count:Number(f.get('count')),minutes:Number(f.get('minutes')),timed:f.has('timed')});});
}
function updateSessionCounts(){
 const select=$('#session-count'),chapter=$('#session-chapter').value,subject=$('#session-subject').value;
 for(const option of select.options){try{createSession({subject,chapter,count:Number(option.value),timed:false,seed:1});option.disabled=false;}catch{option.disabled=true;}}
 if(select.selectedOptions[0]?.disabled||chapter!=='all'){select.value='3';$('#session-minutes').value=9;}
}
function persistSession() { if(session)saveLocal('session',session);else if(writer.mode==='writer'&&!blocked.has('session')) try{localStorage.removeItem(key('session'));}catch{notify('Could not clear the saved session.',true);} }
function showQuestion() {
 flushTime();trackingActive=false;
 if(!session||session.finishedAt)return showPractice();
 const items=sessionItems(session);const i=Math.min(session.index||0,items.length-1);const item=items[i];
 if(writer.mode!=='reader'){session=visitQuestion(session,i);persistSession();}
 const answered=session.responses.filter(hasResponse).length,flags=session.flags.filter(Boolean).length;
 const palette=items.map((q,n)=>`<button aria-label="Question ${n+1}, ${hasResponse(session.responses[n])?'answered':session.visited?.[n]?'visited, unanswered':'not visited'}${session.flags[n]?', marked for review':''}" ${n===i?'aria-current="true"':''} class="nav-question ${n===i?'current':''} ${session.visited?.[n]?'visited':''} ${hasResponse(session.responses[n])?'answered':''} ${session.flags[n]?'flagged':''}" data-index="${n}">${n+1}</button>`);
 main.innerHTML=`<div class="page-intro exam-title"><div><span class="eyebrow dashboard-kicker">${session.mode==='revision'?'NOTEBOOK REVISION':session.mode==='retry'?'MISTAKE RETRY':'ORIGINAL CONCEPT PRACTICE'}</span><h1>Stay curious. Stay focused.</h1><p>${esc(chapterTitle(item.chapter))} · Your answers save as you work.</p></div><a class="button secondary" href="#tests">Test centre ↗</a></div><div class="exam-tabs" aria-label="Jump to subject">${SUBJECTS.filter(s=>items.some(q=>q.subject===s.id)).map(s=>`<button class="tab ${s.id===item.subject?'active':''}" data-subject-jump="${s.id}">${s.title}<small>${items.filter((q,n)=>q.subject===s.id&&hasResponse(session.responses[n])).length}/${items.filter(q=>q.subject===s.id).length}</small></button>`).join('')}</div><div class="session-layout"><section class="panel question-panel"><div class="question-top"><span class="badge original">${item.type==='multiple'?'MULTIPLE CORRECT':item.type==='single'?'SINGLE CORRECT':'NUMERICAL ANSWER'}</span><span class="small-text muted">Question ${i+1} / ${items.length}</span></div><div class="marking-note">${esc(markingText(item))}</div><h2 class="question-stem">${esc(item.stem)}</h2><div id="response-area">${answerInputs(item,session.responses[i])}</div><div class="question-controls"><button class="button secondary" id="previous" ${i===0?'disabled':''}>← Previous</button><button class="button secondary" id="flag">${session.flags[i]?'Unmark review':'Mark for review'}</button><button class="button secondary" id="clear-answer">Clear</button><button class="button" id="next">${i===items.length-1?'Review submission':'Save & next →'}</button></div><div class="exam-save-note"><span id="answer-save-state">${writer.mode==='memory'?'Answers held in this tab':'Answers saved on this device'}</span><span>Marked answers are included when you submit.</span></div><details class="exam-instructions"><summary>Session instructions</summary><ul><li>This session contains original concept questions, not historical PYQs or a calibrated mock paper.</li><li>Use the subject tabs or question palette to move freely. A response saves immediately.</li><li>Each question shows its own marking rule. All saved responses, including marked-for-review responses, are scored.</li><li>The countdown continues while you are away. Question timing counts only time with this practice screen visible.</li></ul></details></section><aside class="panel session-sidebar"><div><div class="timer" id="session-timer">${timerLabel()}</div><div class="timer-label">${session.deadline?'TIME REMAINING':'UNTIMED REVISION'}</div></div>${SUBJECTS.filter(s=>items.some(q=>q.subject===s.id)).map(s=>`<h3 class="palette-heading">${s.title}</h3><div class="navigator">${items.map((q,n)=>q.subject===s.id?palette[n]:'').join('')}</div>`).join('')}<div class="palette-legend"><span><i class="palette-dot answered"></i>Answered</span><span><i class="palette-dot visited"></i>Visited, unanswered</span><span><i class="palette-dot flagged"></i>Marked for review</span><span><i class="palette-dot"></i>Not visited</span></div><div class="palette-counts" id="palette-counts">${answered} answered · ${items.length-answered} unanswered<br>${flags} marked for review</div><button class="button" id="finish-session">Submit session →</button></aside></div><dialog class="submit-dialog" id="submit-dialog" aria-labelledby="submit-title"><h2 id="submit-title">Ready to review your work?</h2><p>All saved answers will be scored. You can return to any question before submitting.</p><dl id="submit-summary"></dl><div class="progress-actions"><button class="button secondary" id="continue-session">Keep practising</button><button class="button" id="confirm-submit">Submit & analyse →</button></div></dialog>`;
 trackingActive=writer.mode!=='reader'&&!document.hidden;timingCursor=performance.now();
 const go=n=>{flushTime();session=visitQuestion(session,n);persistSession();showQuestion();};
 const askSubmit=()=>{flushTime();if(session.finishedAt)return showReport();const answered=session.responses.filter(hasResponse).length;$('#submit-summary').innerHTML=`<dt>Answered</dt><dd>${answered}</dd><dt>Unanswered</dt><dd>${items.length-answered}</dd><dt>Marked for review</dt><dd>${session.flags.filter(Boolean).length}</dd><dt>Remaining time</dt><dd>${timerLabel()}</dd>`;$('#submit-dialog').showModal();};
 $('#response-area').addEventListener('input',()=>{try{flushTime();session=setResponse(session,i,collectAnswer(item));persistSession();if(session.finishedAt){showReport();return;}document.querySelectorAll('[data-index]').forEach(n=>{const j=Number(n.dataset.index);n.classList.toggle('answered',hasResponse(session.responses[j]));n.setAttribute('aria-label',`Question ${j+1}, ${hasResponse(session.responses[j])?'answered':session.visited?.[j]?'visited, unanswered':'not visited'}${session.flags[j]?', marked for review':''}`);});document.querySelectorAll('[data-subject-jump]').forEach(b=>{$('small',b).textContent=`${items.filter((q,n)=>q.subject===b.dataset.subjectJump&&hasResponse(session.responses[n])).length}/${items.filter(q=>q.subject===b.dataset.subjectJump).length}`});const count=session.responses.filter(hasResponse).length;$('#palette-counts').innerHTML=`${count} answered · ${items.length-count} unanswered<br>${session.flags.filter(Boolean).length} marked for review`;}catch(error){notify(error.message,true);showPractice()}});
 $('#flag').addEventListener('click',()=>{flushTime();session=toggleFlag(session,i);persistSession();showQuestion()});
 $('#clear-answer').addEventListener('click',()=>{flushTime();session=setResponse(session,i,item.type==='multiple'?[]:'');persistSession();showQuestion()});
 $('#previous').addEventListener('click',()=>go(i-1));$('#next').addEventListener('click',()=>i<items.length-1?go(i+1):askSubmit());
 document.querySelectorAll('[data-index]').forEach(b=>b.addEventListener('click',()=>go(Number(b.dataset.index))));
 document.querySelectorAll('[data-subject-jump]').forEach(b=>b.addEventListener('click',()=>go(items.findIndex(q=>q.subject===b.dataset.subjectJump))));
 $('#finish-session').addEventListener('click',askSubmit);
 $('#continue-session').addEventListener('click',()=>$('#submit-dialog').close());
 $('#confirm-submit').addEventListener('click',()=>{flushTime();session=finishSession(session);trackingActive=false;persistSession();showReport()});
 updateWriterUI();
}
function hasResponse(response) {return Array.isArray(response)?response.length>0:String(response??'').trim().length>0;}
function timerLabel() { if(!session?.deadline)return 'No timer';const seconds=Math.max(0,Math.ceil(remainingMs(session)/1000));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
function recordCompleted() { if(!session?.finishedAt||writer.mode==='reader')return;try{progress=recordSession(progress,session);saveLocal('progress',progress);history=recordHistory(history,session);saveLocal('history',history);}catch(error){notify(`Progress could not be recorded: ${error.message}`,true)} }
function showReport() {
 trackingActive=false;recordCompleted();const shown=route()==='report'?history.sessions.find(s=>s.id===params().get('attempt')):session;
 if(!shown?.finishedAt){main.innerHTML=empty('Session report not found.','Choose a completed session from Performance analysis.');return;}
 mountReport(main,{session:shown,bookmarks,readOnly:writer.mode==='reader',onRetry(source){if(writer.mode==='reader'||!canReplaceSession())return;try{session=createRetrySession(source);persistSession();location.hash='practice';showQuestion();}catch(error){notify(error.message,true)}},onNew(){location.hash='tests'},onBookmark(identity){const exists=bookmarks.some(b=>b.templateId===identity.templateId&&b.seed===identity.seed);bookmarks=exists?bookmarks.filter(b=>b.templateId!==identity.templateId||b.seed!==identity.seed):[...bookmarks,identity].slice(-500);saveLocal('bookmarks',bookmarks);return bookmarks;},onNotebook(identity){try{notebook=updateNotebook(notebook,identity,{});saveLocal('notebook',notebook);location.hash='mistakes';}catch(error){notify(error.message,true)}}});
 updateWriterUI();
}
function showBank() {
 const s=params().get('subject')||'all';
 main.innerHTML=intro('Explore an idea, one variant at a time.','Original concept practice with reproducible seeds and worked reasoning.')+`<form id="studio-form" class="filters"><div class="field"><label for="studio-subject">Subject</label><select id="studio-subject">${subjectOptions(s)}</select></div><div class="field search"><label for="studio-template">Question family</label><select id="studio-template"></select></div><div class="field"><label for="studio-seed">Seed</label><input id="studio-seed" type="number" min="0" max="4294967295" value="${newSeed()}" required></div><button class="button" type="submit">Generate →</button></form><div id="studio-question"></div><div class="subtle-note">Every variant is original authored practice. The same family and seed reproduce the same question. A finite template bank is not a guarantee of novel or exam-calibrated questions.</div>`;
 const update=()=>{$('#studio-template').innerHTML=listTemplates({subject:$('#studio-subject').value}).map(t=>`<option value="${esc(t.id)}">${esc(subjectTitle(t.subject))} · ${esc(t.title)}</option>`).join('')};update();$('#studio-subject').addEventListener('change',update);
 $('#studio-form').addEventListener('submit',e=>{e.preventDefault();try{studioItem=generate($('#studio-template').value,Number($('#studio-seed').value));studioResponse=studioItem.type==='multiple'?[]:'';studioResult=null;renderStudio()}catch(error){notify(error.message,true)}});
 if(studioItem)renderStudio();else {studioItem=generate($('#studio-template').value,Number($('#studio-seed').value));studioResponse=studioItem.type==='multiple'?[]:'';renderStudio()}
}
function renderStudio() {
 const q=studioItem;const saved=bookmarks.some(b=>b.templateId===q.templateId&&b.seed===q.seed);
 $('#studio-question').innerHTML=`<section class="panel question-panel"><div class="question-top"><span class="badge original">ORIGINAL · ${esc(q.type.toUpperCase())}</span><button id="bookmark-question" class="button small secondary">${saved?'★ Saved':'☆ Save question'}</button></div><div class="marking-note">${esc(markingText(q))}</div><h2 class="question-stem">${esc(q.stem)}</h2>${answerInputs(q,studioResponse,!!studioResult)}<div class="question-controls"><button class="button" id="check-studio" ${studioResult?'disabled':''}>Check answer →</button><button class="button secondary" id="next-variant">New variant ↻</button></div>${studioResult?`<div class="subtle-note">${esc(studioResult.status)} · ${studioResult.score} / ${studioResult.maxScore}. Question studio attempts do not enter timed-session progress.</div>${solutionHTML(q)}`:''}</section>`;
 $('#check-studio').addEventListener('click',()=>{try{studioResponse=collectAnswer(q);studioResult=gradeQuestion(q,studioResponse);renderStudio()}catch(error){notify(error.message,true)}});
 $('#next-variant').addEventListener('click',()=>{$('#studio-seed').value=newSeed();$('#studio-form').requestSubmit()});
 $('#bookmark-question').addEventListener('click',()=>{if(!studioResult)studioResponse=collectAnswer(q);bookmarks=saved?bookmarks.filter(b=>b.templateId!==q.templateId||b.seed!==q.seed):[...bookmarks,{templateId:q.templateId,seed:q.seed}].slice(-500);saveLocal('bookmarks',bookmarks);renderStudio()});
}
function showProgress() {
 const stats=getStats(progress);
 const records=Array.isArray(progress.records)?progress.records:Array.isArray(progress.attempts)?progress.attempts:[];
 const total=stats.attempted??stats.total??records.length;
 const correct=stats.correct??records.filter(r=>r.status==='correct').length;
 const accuracy=typeof stats.accuracy==='number'?stats.accuracy:(total?correct/total:0);
 main.innerHTML=intro('See the work adding up.','Original concept practice: first attempts stay first attempts. PYQ reports and backups live in PYQ practice.')+`<div class="stats-strip">${stat('DISTINCT ATTEMPTS',total)}${stat('CORRECT',correct)}${stat('FIRST-ATTEMPT ACCURACY',total?`${Math.round(accuracy)}%`:'—')}${stat('SAVED QUESTIONS',bookmarks.length)}</div><div class="progress-actions"><button id="export-progress" class="button">Export progress ↓</button><label class="button secondary upload-label">Restore progress ↑<input type="file" id="import-progress" accept="application/json,.json"></label><a class="button secondary" href="#practice">Keep practising →</a></div><div class="subtle-note">Saved on this browser only. Export before switching devices or clearing browser data. Backup restoration regrades question identities; browser storage is not a certified examination record.</div><div class="subject-grid">${SUBJECTS.map(s=>{const raw=stats.subjects?.find(row=>row.id===s.id)||{};const count=raw.attempted??raw.total??records.filter(r=>r.subject===s.id).length;const right=raw.correct??0;return `<section class="subject-card ${s.id}"><h3>${esc(s.title)}</h3><p>${count} distinct attempts · ${right} correct</p><div class="progress-bar"><span style="width:${count?Math.min(100,right/count*100):0}%"></span></div></section>`}).join('')}</div><div class="section-heading"><div><h2>Your saved questions</h2><p>Return to exactly the same family and seed.</p></div></div>${bookmarks.length?`<section class="panel table-wrap"><table><thead><tr><th>FAMILY</th><th>SUBJECT</th><th>SEED</th><th></th></tr></thead><tbody>${bookmarks.slice().reverse().map(b=>{const t=listTemplates().find(t=>t.id===b.templateId);return `<tr><td>${esc(t?.title||b.templateId)}</td><td>${esc(subjectTitle(t?.subject))}</td><td>${b.seed}</td><td><button class="button small secondary" data-bookmark="${esc(b.templateId)}" data-seed="${b.seed}">Open ↗</button></td></tr>`}).join('')}</tbody></table></section>`:empty('Leave a trail of good questions.','Save a question in the Question studio to find it here later.')}`;
 $('#export-progress').addEventListener('click',()=>download('vedaris-progress.json',exportProgress(progress)));
 $('#import-progress').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw new Error('Backup exceeds the 2 MB limit');const next=importProgress(await file.text(),progress);if(writer.mode==='memory'||saveLocal('progress',next)){progress=next;showProgress();notify(writer.mode==='memory'?'Progress restored and regraded in memory. Export before closing this tab.':'Progress restored and regraded.')}}catch(error){notify(`Could not restore backup: ${error.message}`,true)}});
 document.querySelectorAll('[data-bookmark]').forEach(b=>b.addEventListener('click',()=>{studioItem=generate(b.dataset.bookmark,Number(b.dataset.seed));studioResponse=studioItem.type==='multiple'?[]:'';studioResult=null;location.hash='bank'}));
}
function showSources() {
 const a=archiveStats(archive);
 main.innerHTML=intro('Good learning starts with clear sources.','What is in Vedaris, where it comes from, and what is still being built.')+`<div class="note-grid"><section class="panel prose"><span class="eyebrow">THE ARCHIVE TODAY</span><h3>${a.yearCount} years with linked sources</h3><p>${a.officialPaperCount} official paper records, ${a.partialCollectionCount} partial collections, and ${a.unknownCoverageCount} records whose completeness has not been established. Source metadata was checked on ${esc(archive.checkedAt)}.</p><p><strong>${contentManifest?.questionCount||0} actual PYQs are playable with worked solutions</strong>, covering ${(contentManifest?.years||[]).join(", ")||"no reviewed years yet"}. The wider 40+ year source archive is still being transcribed and reviewed.</p><p>Reviewed papers preserve diagrams, final answer keys, numerical acceptance rules and section-specific marking. Worked explanations are independently authored for Vedaris; they are not official IIT worked solutions.</p><a class="button secondary" href="#pyq">Open PYQ practice ↗</a></section><section class="panel prose"><span class="eyebrow">ORIGINAL PRACTICE</span><h3>${listTemplates().length} reproducible question families</h3><p>Authored practice covers selected concepts in Physics, Chemistry and Mathematics. Every generated question is labelled original. The ${CHAPTERS.length}-chapter map does not imply every chapter already has a practice family.</p><p>Session results are practice feedback. They do not predict rank, admission or official performance. Timings in custom practice are chosen by the learner.</p></section></div>${contentManifest?`<section class="panel prose spaced"><h3>Reviewed question bank attribution</h3><p>Question transcriptions and structure use the MIT-licensed propar2750/jee-advanced dataset, pinned to revision 2580e96f1e74343e1d478509187f16fe58dbab85. The dataset states that exam questions, keys and figures remain the work of the organising IITs. Vedaris independently checks source papers and final keys and authors its own explanations and chapter tags.</p><p>Reviews are performed with Codex and recorded question by question; they are not a claim of independent human editorial certification. Use the linked official paper and final key to investigate any discrepancy.</p>${link('https://huggingface.co/datasets/propar2750/jee-advanced/tree/2580e96f1e74343e1d478509187f16fe58dbab85','Pinned dataset & MIT attribution ↗')} · ${link('https://jeeadv.ac.in/archive.html','Official paper archive ↗')}</section>`:''}<div class="source-list">${archive.sources.map(s=>`<article><span class="badge ${s.authority==='official'?'':'third'}">${esc(s.authority.toUpperCase())}</span><h3 class="spaced">${esc(s.title)}</h3><p>${esc(s.notes)}</p>${link(s.url,'Visit original source ↗')}</article>`).join('')}</div><section class="panel prose spaced"><h3>Privacy and persistence</h3><p>Answers, active sessions, saved questions, and paper notes stay in this browser's local storage. There is no account sync, model grading, or remote tracking. Practice analysis is computed on your device. Fonts are served with this site; external papers have their own privacy policies. The concept-practice export backs up first-attempt answers. PYQ practice has its own backup for its active session and last 20 reports. Other concept test history, revision notes, paper notes, goals and bookmarks remain on this device.</p><h3>How content becomes practice-ready</h3><p>Each historical question needs a stable paper identity and original question number, source page, reviewed statement and diagrams, verified answer key, and explicit marking scheme. The repository includes a validation and staging workflow; staged imports are not silently added to practice.</p><h3>Independent by design</h3><p>Vedaris is an independent learning project by Tarun Tej. It is not affiliated with or endorsed by the IITs, JEE Advanced, or the external archive providers.</p></section>`;
}
function showPaper() {
 const id=decodeURIComponent(location.hash.split('?')[0].slice('#paper/'.length));const paper=archive.papers.find(p=>p.id===id);if(!paper){main.innerHTML=empty('Paper not found.','Return to the archive and choose an available source.');return}
 const source=archive.sources.find(s=>s.id===paper.sourceId);const note=paperNotes[id]||{};
 main.innerHTML=intro(`${paper.year} · ${esc(paper.label)}`,'A quiet companion for working with the original source.',`<a href="#archive?year=${paper.year}" class="button secondary">← Archive</a>`)+`<section class="paper-workspace"><div class="paper-hero"><div><span class="badge ${source.authority==='official'?'':'third'}">${esc(source.authority.toUpperCase())} SOURCE</span><h2 class="spaced">Keep the paper in view.</h2><p>${paper.coverage==='full-paper'?'Full paper linked from its source.':'This collection may contain only selected questions.'}<br>Open it in a second tab, and use this space for your working notes.</p></div>${link(paper.url,'Open paper source ↗','button')}</div><div class="note-grid"><section class="panel"><h3>Your paper timer</h3><p class="small-text muted spaced">${paper.durationMinutes?`Listed duration: ${paper.durationMinutes} minutes.`:'The source duration has not been verified. Choose your own study time.'} This companion does not automatically score the paper.</p><form id="paper-timer-form" class="filters spaced"><div class="field"><label for="paper-minutes">Study minutes</label><input id="paper-minutes" type="number" min="1" max="720" value="${paper.durationMinutes||60}" required></div><button class="button" type="submit">Start timer →</button></form><div class="timer" id="paper-clock">${paperClock(note.deadline)}</div><button class="button small secondary" id="paper-stop">Clear timer</button></section><section class="panel prose"><h3>About this record</h3><p>Source: ${esc(source.title)}<br>Verification: ${esc(paper.verification)}<br>Completeness: ${esc(paper.coverage)}<br>Questions: ${paper.questionCount||'Not verified'}<br>Maximum marks: ${paper.maxMarks||'Not verified'}</p><p>Follow the instructions printed on the original paper, including its answer format and marking rules.</p>${link(paper.sourceUrl,'View source listing ↗')}</section></div><section class="panel"><div class="panel-head"><h3>Your working notes</h3><span class="small-text muted" id="note-state">Saved on this device</span></div><label for="paper-notes" class="small-text muted">Record question numbers, approach, mistakes, and ideas to revisit.</label><textarea class="spaced" id="paper-notes" maxlength="50000" placeholder="Q1 — My approach…">${esc(note.text||'')}</textarea><button class="button small secondary spaced" id="export-notes">Export this paper's notes ↓</button></section></section>`;
 $('#paper-notes').addEventListener('input',e=>{paperNotes[id]={...paperNotes[id],text:e.target.value};$('#note-state').textContent=saveLocal('paper-notes',paperNotes)?'Saved on this device':'Could not save'});
 $('#paper-timer-form').addEventListener('submit',e=>{e.preventDefault();paperNotes[id]={...paperNotes[id],deadline:Date.now()+Number($('#paper-minutes').value)*60000};saveLocal('paper-notes',paperNotes);$('#paper-clock').textContent=paperClock(paperNotes[id].deadline)});
 $('#paper-stop').addEventListener('click',()=>{paperNotes[id]={...paperNotes[id],deadline:null};saveLocal('paper-notes',paperNotes);$('#paper-clock').textContent='No timer'});
 $('#export-notes').addEventListener('click',()=>download(`vedaris-${id}-notes.json`,JSON.stringify({paperId:id,source:paper.url,text:paperNotes[id]?.text||''},null,2)));
}
function paperClock(deadline) {if(!deadline)return 'No timer';const sec=Math.max(0,Math.ceil((deadline-Date.now())/1000));return sec?`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`:'Time complete';}
function updateWriterUI(){
 const bar=$('#storage-mode');
 if(writer.mode==='writer'){bar.innerHTML='';return;}
 bar.innerHTML=`<div class="notice ${writer.mode==='memory'?'error':''}">${writer.mode==='reader'?'Another Vedaris tab is editing this workspace. This tab is read-only. Close the other tab, then reload this one to continue.':'This browser cannot coordinate saved work safely. You can practise in this tab, but changes will stay in memory. Export progress before closing.'}</div>`;
 if(writer.mode==='reader'&&route()!=='pyq')main.querySelectorAll('button,input,textarea,select').forEach(control=>{if(!control.matches('[data-analysis-report],[data-report-filter],[data-notebook-filter],[data-notebook-action=previous],[data-notebook-action=next]')&&!['export-progress','export-notes','archive-query','archive-year','archive-subject','archive-source','load-papers'].includes(control.id))control.disabled=true;});
}
function render() {
 disposePYQ?.();disposePYQ=null;routeGeneration++;flushTime();trackingActive=false;main.onclick=main.oninput=main.onchange=main.onsubmit=null;
 const r=route();document.title=`${routeName[r]||'Workspace'} · Vedaris`;
 $('#route-title').textContent=routeName[r]||'Overview';document.querySelectorAll('[data-route]').forEach(a=>{const active=a.dataset.route===r||(r==='paper'&&a.dataset.route==='archive')||(r==='report'&&a.dataset.route==='analysis')||(r==='practice'&&a.dataset.route==='tests');a.classList.toggle('active',active);active?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current')});
 try { ({pyq:showPYQ,overview:showOverview,tests:showTests,analysis:showAnalysis,mistakes:showNotebook,report:showReport,chapters:showChapters,archive:showArchive,practice:showPractice,bank:showBank,progress:showProgress,sources:showSources,paper:showPaper}[r]||showOverview)(); }
 catch(error){main.innerHTML=empty('This view could not be loaded.','Your browser data has been preserved. Reload to retry, or choose another workspace section.');notify(error.message,true);console.error(error)}
 updateWriterUI();
}
function loadLearningState(){
 history=restoreHistory(JSON.stringify(readLocal('history',emptyHistory(),v=>!!restoreHistory(JSON.stringify(v)))))||emptyHistory();
 notebook=restoreNotebook(readLocal('notebook',emptyNotebook(),v=>!!restoreNotebook(v)))||emptyNotebook();
 dailyGoal=readLocal('goal',10,v=>[5,10,20,30].includes(v));
}
async function init() {
 window.addEventListener('storage',event=>{
  if(writer.mode!=='reader'||!event.key?.startsWith('vedaris.'))return;
  if(event.key===key('pyq-workspace')){if(contentBank){loadHistoricalState();disposePYQ?.updateWorkspace?.(historicalWorkspace);}return;}
  if(event.key===key('session')&&!['practice','overview','tests'].includes(route())){try{session=event.newValue?restoreSession(event.newValue):null;}catch{}return;}
  clearTimeout(readerRefresh);readerRefresh=setTimeout(()=>{
    try{const raw=localStorage.getItem(key('session'));session=raw?restoreSession(raw):null;const saved=localStorage.getItem(key('progress'));progress=saved?importProgress(saved,emptyProgress()):emptyProgress();}catch{notify('Saved work changed in another tab but could not be read. Reload to retry.',true);}
    loadLearningState();
    bookmarks=readLocal('bookmarks',[],v=>Array.isArray(v)&&v.length<=500);
    paperNotes=readLocal('paper-notes',{},v=>v&&typeof v==='object'&&!Array.isArray(v));
    if(route()!=='pyq')render();
  },100);
 });
 writer=await acquireWorkspaceWriter({onModeChange:()=>{if(document.readyState!=='loading')queueMicrotask(updateWriterUI)}});
 window.addEventListener('pagehide',()=>{disposePYQ?.();disposePYQ=null;flushTime();trackingActive=false;writer.release();});
 document.addEventListener('visibilitychange',()=>{flushTime();trackingActive=!document.hidden&&route()==='practice'&&!!$('#response-area')&&!!session&&!session.finishedAt&&writer.mode!=='reader';timingCursor=performance.now();});
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
 try {const response=await fetch(new URL('../data/archive.json',import.meta.url),{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('Archive download failed');const data=await response.json();const errors=validateArchive(data);if(errors.length)throw new Error('Archive metadata failed validation');archive=data;}catch(error){archiveError='The paper catalog could not load. Original practice is still available; reconnect and reload to try the archive again.';notify(archiveError,true)}
 try{contentManifest=await loadContentManifest();}catch(error){contentError=error.message;}
 try {const raw=localStorage.getItem(key('session'));if(raw){session=restoreSession(raw);if(!session){blocked.add('session');notify('The saved session could not be restored. It has been preserved. Start a new session in a different browser profile or clear that saved entry after backing it up.',true)}}}catch{notify('Browser storage is unavailable. Work in this tab may not persist.',true)}
 try {const raw=localStorage.getItem(key('progress'));if(raw)progress=importProgress(raw,emptyProgress());}catch{blocked.add('progress');notify('Saved progress could not be validated and has been preserved. New records will not overwrite it.',true)}
 loadLearningState();
 bookmarks=readLocal('bookmarks',[],value=>Array.isArray(value)&&value.length<=500&&value.every(b=>{try{generate(b.templateId,b.seed);return true}catch{return false}}));
 paperNotes=readLocal('paper-notes',{},v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.values(v).every(n=>n&&typeof n==='object'&&(n.text===undefined||typeof n.text==='string'&&n.text.length<=50000)&&(n.deadline==null||Number.isFinite(n.deadline))));
 if(session?.finishedAt&&writer.mode!=='reader'){persistSession();recordCompleted();}
 render();window.addEventListener('hashchange',()=>{archiveLimit=30;render();window.scrollTo(0,0)});
 timerHandle=setInterval(()=>{flushTime();if(writer.mode!=='reader'&&session&&!session.finishedAt&&session.deadline){if(remainingMs(session)<=0){session=finishSession(session);persistSession();recordCompleted();if(route()==='practice')showReport();else notify('Your practice timer finished. Your saved answers are ready for review.')}else if($('#session-timer'))$('#session-timer').textContent=timerLabel()}if(route()==='practice'&&!!$('#response-area')&&session?.finishedAt&&!$('#report-questions'))showReport();if(route()==='paper'){const id=decodeURIComponent(location.hash.split('?')[0].slice('#paper/'.length));if($('#paper-clock'))$('#paper-clock').textContent=paperClock(paperNotes[id]?.deadline)}},1000);
 if('serviceWorker' in navigator && !['localhost','127.0.0.1'].includes(location.hostname))navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).catch(()=>{});
}
$('.skip-link').addEventListener('click',event=>{event.preventDefault();main.focus();main.scrollIntoView();});
init();
