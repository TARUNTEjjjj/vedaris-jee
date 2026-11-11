import {getStats, emptyProgress} from '../src/learning/progress.js';
import {gradeSession} from '../src/practice/session.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const percent = value => `${new Intl.NumberFormat('en-IN', {maximumFractionDigits: 1}).format(value)}%`;
const number = value => new Intl.NumberFormat('en-IN', {maximumFractionDigits: 1}).format(value);
const dateFormat = new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata'});
const subjectName = subject => ({physics: 'Physics', chemistry: 'Chemistry', mathematics: 'Mathematics', all: 'Mixed PCM'}[subject] || 'Mixed PCM');
const sessionModeLabel = mode => mode === 'revision' ? 'Notebook revision' : mode === 'retry' ? 'Mistake retry' : 'Original practice';
let mountSequence = 0;

function emptyState(title, description, action = 'Start a practice session', href = '#practice') {
  return `<div class="analysis-empty"><span class="analysis-empty-symbol" aria-hidden="true">↗</span><h3>${escape(title)}</h3><p>${escape(description)}</p><a class="button secondary" href="${escape(href)}">${escape(action)} →</a></div>`;
}
function metric(label, value, detail) {
  return `<div class="analysis-metric"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(detail)}</small></div>`;
}
function elapsedLabel(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Active time not recorded';
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s active`;
}
function sessionRows(history) {
  const rows = [];
  let omitted = 0;
  const ids = new Set();
  for (const session of Array.isArray(history?.sessions) ? history.sessions : []) {
    try {
      if (!session || typeof session.id !== 'string' || !session.id || !Number.isSafeInteger(session.finishedAt) || session.finishedAt <= 0 || !Number.isFinite(new Date(session.finishedAt).getTime()) || ids.has(session.id)) throw new Error('Invalid completed session');
      const report = gradeSession(session);
      if (!Number.isFinite(report.score) || !Number.isFinite(report.maxScore) || report.maxScore <= 0 || !Array.isArray(report.rows)) throw new Error('Invalid report');
      const attempted = report.rows.length - report.skipped;
      const activeTime = Number.isFinite(report.activeTimeMs) ? report.activeTimeMs : Array.isArray(session.timeSpentMs) && session.timeSpentMs.every(value => Number.isFinite(value) && value >= 0) ? session.timeSpentMs.reduce((sum, value) => sum + value, 0) : null;
      rows.push({session, report, attempted, activeTime, accuracy: attempted ? report.correct / attempted * 100 : null, scorePercent: report.score / report.maxScore * 100});
      ids.add(session.id);
    } catch { omitted++; }
  }
  rows.sort((a, b) => b.session.finishedAt - a.session.finishedAt || b.session.startedAt - a.session.startedAt || a.session.id.localeCompare(b.session.id));
  return {rows, omitted};
}
function trend(rows, id) {
  const recent = rows.slice(0, 10).reverse();
  if (!recent.length) return emptyState('Your next session starts the story.', 'Completed original-practice sessions will appear here. Your first-attempt progress is tracked separately.');
  const width = 720, height = 236, left = 55, right = 22, top = 22, bottom = 42;
  const minimum = Math.min(0, Math.floor(Math.min(...recent.map(row => row.scorePercent)) / 20) * 20);
  const maximum = 100;
  const x = index => recent.length === 1 ? (left + width - right) / 2 : left + index / (recent.length - 1) * (width - left - right);
  const y = value => top + (maximum - value) / (maximum - minimum) * (height - top - bottom);
  const ticks = [...new Set([minimum, 0, 50, 100])].sort((a, b) => a - b);
  const points = recent.map((row, index) => `${x(index).toFixed(2)},${y(row.scorePercent).toFixed(2)}`).join(' ');
  const first = recent[0].session.finishedAt, last = recent.at(-1).session.finishedAt;
  return `<figure class="analysis-trend"><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-trend-title ${id}-trend-desc"><title id="${id}-trend-title">Score percentage over your latest ${recent.length} completed practice sessions</title><desc id="${id}-trend-desc">Sessions run from oldest on the left to newest on the right. Exact scores are in the table below. Different question sets, mistake retries and notebook revisions are not directly comparable.</desc>${ticks.map(tick => `<line class="analysis-gridline ${tick === 0 ? 'analysis-zero-line' : ''}" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="analysis-axis-label" x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${tick}%</text>`).join('')}${recent.length > 1 ? `<polyline class="analysis-trend-line" points="${points}"/>` : ''}${recent.map((row, index) => `<circle class="analysis-trend-point" cx="${x(index)}" cy="${y(row.scorePercent)}" r="5"><title>${escape(`Session ${index + 1}: ${number(row.report.score)} of ${number(row.report.maxScore)} marks (${percent(row.scorePercent)}), ${sessionModeLabel(row.session.mode).toLowerCase()}`)}</title></circle><text class="analysis-axis-label" x="${x(index)}" y="${height - 16}" text-anchor="middle">${index + 1}</text>`).join('')}</svg><figcaption>Latest ${recent.length} sessions · ${escape(new Date(first).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata'}))}–${escape(new Date(last).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata'}))}. Score as a percentage of possible marks; negative marks are preserved.</figcaption></figure><details class="analysis-chart-data"><summary>View exact trend data</summary><div class="analysis-table-wrap" role="region" aria-label="Score trend data" tabindex="0"><table><caption>Latest sessions, oldest first</caption><thead><tr><th scope="col">Session</th><th scope="col">Completed (IST)</th><th scope="col">Mode</th><th scope="col">Marks</th><th scope="col">Score %</th></tr></thead><tbody>${recent.map((row, index) => `<tr><th scope="row">${index + 1}</th><td>${escape(dateFormat.format(new Date(row.session.finishedAt)))}</td><td>${escape(sessionModeLabel(row.session.mode))}</td><td>${number(row.report.score)} / ${number(row.report.maxScore)}</td><td>${percent(row.scorePercent)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function subjectCards(subjects) {
  return subjects.map(subject => {
    const value = subject.attempted ? subject.correct / subject.attempted * 100 : 0;
    return `<article class="analysis-subject"><div class="analysis-subject-title"><h3>${escape(subject.title)}</h3><strong>${subject.attempted ? percent(value) : '—'}</strong></div><div class="analysis-bar" role="img" aria-label="${escape(`${subject.title}: ${subject.correct} fully correct out of ${subject.attempted} distinct answered questions`)}"><span style="width:${Math.max(0, Math.min(100, value))}%"></span></div><p><b>${subject.correct} / ${subject.attempted}</b> fully correct first attempts</p><small>${subject.attempted ? `${subject.incorrect} incorrect · ${subject.partial} partial${subject.attempted < 5 ? ' · Small sample' : ''}` : 'Start a session to build this view.'}</small></article>`;
  }).join('');
}
function weakChapters(chapters) {
  const attempted = chapters.filter(chapter => chapter.attempted > 0);
  const weak = attempted.filter(chapter => chapter.correct < chapter.attempted).sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted || a.title.localeCompare(b.title)).slice(0, 8);
  if (!attempted.length) return emptyState('Find your next revision priority.', 'After you answer questions, chapters with incorrect or partially correct first attempts will appear here.', 'Explore chapters', '#chapters');
  if (!weak.length) return emptyState('Every recorded first attempt is correct.', 'Keep broadening your practice. This reflects the questions attempted so far, not complete chapter mastery.', 'Explore chapters', '#chapters');
  return `<p class="analysis-note">Up to eight chapters, ordered by first-attempt accuracy. Counts describe your current sample; they are not mastery ratings.</p><div class="analysis-table-wrap" role="region" aria-label="Chapters to revisit" tabindex="0"><table><thead><tr><th scope="col">Chapter</th><th scope="col">Fully correct</th><th scope="col">Accuracy</th><th scope="col">Review</th><th scope="col">Next step</th></tr></thead><tbody>${weak.map(chapter => `<tr><th scope="row"><strong>${escape(chapter.title)}</strong><small>${escape(subjectName(chapter.subject))}${chapter.attempted < 5 ? ' · Small sample' : ''}</small></th><td>${chapter.correct} / ${chapter.attempted}</td><td>${percent(chapter.correct / chapter.attempted * 100)}</td><td>${chapter.incorrect} incorrect<br>${chapter.partial} partial</td><td><a class="button small secondary" href="#practice?subject=${encodeURIComponent(chapter.subject)}&amp;chapter=${encodeURIComponent(chapter.id)}">Practise chapter ↗</a></td></tr>`).join('')}</tbody></table></div>`;
}
function historyTable(rows, callbackAvailable) {
  if (!rows.length) return emptyState('Completed sessions belong here.', 'Finish a session to keep its score and question-by-question report. Older first-attempt backups may not contain full session reports.');
  return `<div class="analysis-table-wrap" role="region" aria-label="Completed practice session history" tabindex="0"><table><thead><tr><th scope="col">Practice session</th><th scope="col">Completed (IST)</th><th scope="col">Marks</th><th scope="col">Answered</th><th scope="col">Accuracy</th><th scope="col">Report</th></tr></thead><tbody>${rows.map(row => `<tr><th scope="row"><strong>${escape(subjectName(row.session.subject))}</strong><small>${escape(sessionModeLabel(row.session.mode))} · ${row.report.rows.length} ${row.report.rows.length === 1 ? 'question' : 'questions'}</small><small>${escape(elapsedLabel(row.activeTime))}</small></th><td>${escape(dateFormat.format(new Date(row.session.finishedAt)))}</td><td><b>${number(row.report.score)}</b> / ${number(row.report.maxScore)}</td><td>${row.attempted} / ${row.report.rows.length}</td><td>${row.accuracy === null ? '—' : percent(row.accuracy)}<small>${row.report.correct} / ${row.attempted} fully correct</small></td><td><button type="button" class="button small secondary" data-analysis-report="${escape(row.session.id)}" aria-label="${escape(`Open ${subjectName(row.session.subject)} ${sessionModeLabel(row.session.mode).toLowerCase()} report completed ${dateFormat.format(new Date(row.session.finishedAt))}`)}" ${callbackAvailable ? '' : 'disabled'}>Open report ↗</button></td></tr>`).join('')}</tbody></table></div>`;
}

/** Mount a read-only analysis view. Data mutations and individual reports belong to the host. */
export function mountAnalysis(root, {progress = emptyProgress(), history = {sessions: []}, onOpenReport} = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') throw new TypeError('mountAnalysis requires a DOM container');
  const id = `vedaris-analysis-${++mountSequence}`;
  let stats, progressError = false;
  try { stats = getStats(progress); }
  catch { stats = getStats(emptyProgress()); progressError = true; }
  const {rows, omitted} = sessionRows(history);
  root.innerHTML = `<section class="analysis-page" aria-labelledby="${id}-title"><header class="analysis-intro"><div><span class="eyebrow">YOUR PRACTICE, IN PERSPECTIVE</span><h1 id="${id}-title">See what the work is telling you.</h1><p>Review your accuracy, revisit chapters, and return to any saved test report.</p></div><a class="button secondary" href="#practice">Start practice ↗</a></header>${progressError ? '<p class="analysis-warning" role="status">First-attempt progress could not be read. It has not been changed. Saved session reports remain available below.</p>' : ''}${omitted ? `<p class="analysis-warning" role="status">${omitted} saved ${omitted === 1 ? 'entry could' : 'entries could'} not be shown as a valid completed session. Your stored history has not been changed.</p>` : ''}<div class="analysis-metrics">${metric('FIRST-ATTEMPT ACCURACY', stats.attempted ? percent(stats.correct / stats.attempted * 100) : '—', `${stats.correct} fully correct / ${stats.attempted} answered`)}${metric('DISTINCT ANSWERED QUESTIONS', number(stats.attempted), `${stats.incorrect} incorrect · ${stats.partial} partial`)}${metric('SAVED COMPLETED SESSIONS', number(rows.length), `Mistake retries: ${rows.filter(row => row.session.mode === 'retry').length} · Notebook revisions: ${rows.filter(row => row.session.mode === 'revision').length}`)}${metric('CHAPTERS PRACTISED', number(stats.chapters.filter(chapter => chapter.attempted > 0).length), 'Chapters with at least one first attempt')}</div><div class="analysis-columns"><section class="analysis-card" aria-labelledby="${id}-trend-heading"><div class="analysis-card-heading"><div><span class="eyebrow">SESSION RESULTS</span><h2 id="${id}-trend-heading">Your recent score trend</h2></div><span class="analysis-tag">Latest 10</span></div><p class="analysis-note">Different sets have different questions and totals. This includes mistake retries and notebook revisions, and is not a prediction of exam performance.</p>${trend(rows, id)}</section><section class="analysis-card" aria-labelledby="${id}-subjects-heading"><div class="analysis-card-heading"><div><span class="eyebrow">DISTINCT FIRST ATTEMPTS</span><h2 id="${id}-subjects-heading">Accuracy by subject</h2></div></div>${subjectCards(stats.subjects)}<p class="analysis-note analysis-footnote">Accuracy means fully correct ÷ answered. Partial-credit answers stay separate; skipped questions are excluded. Retrying does not replace a first attempt.</p></section></div><section class="analysis-card" aria-labelledby="${id}-chapters-heading"><div class="analysis-card-heading"><div><span class="eyebrow">TURN REVIEW INTO ACTION</span><h2 id="${id}-chapters-heading">Chapters to revisit</h2></div><a class="analysis-text-link" href="#chapters">All chapters ↗</a></div>${weakChapters(stats.chapters)}</section><section class="analysis-card" aria-labelledby="${id}-history-heading"><div class="analysis-card-heading"><div><span class="eyebrow">COMPLETED SESSION REPORTS</span><h2 id="${id}-history-heading">Your test history</h2></div><span class="analysis-tag">${rows.length} saved</span></div><p class="analysis-note">Newest first. Session results include every response in that test; first-attempt statistics above count each retained question identity once. All current sessions use Vedaris original practice questions.</p>${historyTable(rows, typeof onOpenReport === 'function')}</section></section>`;
  root.querySelectorAll('[data-analysis-report]').forEach(button => button.addEventListener('click', () => {
    if (typeof onOpenReport === 'function') onOpenReport(button.dataset.analysisReport);
  }));
}
