import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalSession, answerHistorical, finishHistorical, visitHistorical, trackHistorical, toggleHistoricalFlag, gradeHistorical, restoreHistoricalSession, emptyHistoricalWorkspace, restoreHistoricalWorkspace, saveHistoricalSession, validHistoricalResponse } from '../src/content/session.js';

// Normalized synthetic fixtures exercise the session engine; no fixture is
// bundled as authentic exam content or as evidence of an editorial review.
const START=1_800_000_000_000, BANK='synthetic-bank-v1';
const options=['A','B','C','D'].map(id=>({id,text:`Synthetic ${id}`}));
const base={origin:'pyq',status:'practice-ready',options,marking:{correct:4,incorrect:-2,unanswered:0}};
const questions=[
 {...base,id:'single',subject:'physics',type:'single',answer:'B'},
 {...base,id:'multiple',subject:'chemistry',type:'multiple',answer:['A','B','C'],marking:{...base.marking,partialCredits:[{selected:['A'],marks:1},{selected:['A','C'],marks:2}]}},
 {...base,id:'numerical',subject:'mathematics',type:'numerical',options:[],answer:'0.31',acceptedRange:['0.30','0.32'],marking:{correct:3,incorrect:0,unanswered:0}},
 {...base,id:'bonus',subject:'physics',type:'bonus',options:[],answer:null,marking:{correct:3,incorrect:3,unanswered:3}},
];
const registry={
 getQuestion(id){const q=questions.find(q=>q.id===id);if(!q)throw new Error('Unknown reviewed content');return q;},
 getFullPaper(id){if(id!=='synthetic-paper')throw new Error('Full paper not ready');return {orderedQuestionIds:['numerical','single','bonus','multiple'],durationMinutes:180};},
};
const create=(options={})=>createHistoricalSession(registry,{questionIds:questions.map(q=>q.id),bankId:BANK,seed:7,timed:true,minutes:1,now:START,...options});
const restore=(s,now=START+60000)=>restoreHistoricalSession(s,registry,BANK,now);
const workspaceRestore=(w,now=START+60000)=>restoreHistoricalWorkspace(JSON.stringify(w),registry,BANK,now);

test('full-paper construction preserves catalog order and duration, ignoring custom set overrides',()=>{
 const s=create({paperId:'synthetic-paper',questionIds:['single'],timed:false,minutes:1});
 assert.equal(s.mode,'paper');assert.equal(s.paperId,'synthetic-paper');assert.equal(s.timed,true);assert.equal(s.minutes,180);
 assert.deepEqual(s.questionIds,['numerical','single','bonus','multiple']);assert.equal(s.deadline,START+180*60000);
 assert.deepEqual(s.responses,['','','',[]]);assert.deepEqual(s.visited,[false,false,false,false]);
 assert.throws(()=>create({paperId:'incomplete'}),/not ready/);
});

test('session setup rejects unknown, duplicate, empty and oversized sets and invalid timing',()=>{
 for(const questionIds of [[],['single','single'],['missing'],Array.from({length:501},(_,i)=>String(i))])assert.throws(()=>create({questionIds}));
 for(const options of [{bankId:''},{seed:-1},{seed:2**32},{timed:'yes'},{minutes:0},{minutes:721},{minutes:1.5},{now:NaN},{now:0}])assert.throws(()=>create(options));
 const untimed=create({timed:false,minutes:null});assert.equal(untimed.deadline,null);assert.equal(untimed.minutes,null);
});

test('answering, visiting and flagging return new state without mutating the previous attempt',()=>{
 const s=create();const supplied=['C','A'];const answered=answerHistorical(s,1,supplied,registry,START+100);
 assert.deepEqual(answered.responses[1],['A','C']);assert.deepEqual(s.responses[1],[]);assert.deepEqual(supplied,['C','A']);
 supplied.push('D');assert.deepEqual(answered.responses[1],['A','C']);
 assert.equal(answered.index,1);assert.equal(answered.visited[1],true);
 const visited=visitHistorical(answered,2,START+200);assert.equal(visited.index,2);assert.equal(visited.visited[2],true);assert.equal(answered.visited[2],false);
 const flagged=toggleHistoricalFlag(visited,0,START+300);assert.equal(flagged.flags[0],true);assert.equal(flagged.visited[0],true);assert.equal(visited.flags[0],false);
 assert.equal(toggleHistoricalFlag(flagged,0,START+400).flags[0],false);
});

test('responses are type-checked; invalid options, duplicates and oversized strings cannot enter storage',()=>{
 for(const [index,response] of [[0,'X'],[0,['B']],[1,'A'],[1,['A','A']],[1,['X']],[2,5],[2,'9'.repeat(97)],[3,'3']])assert.throws(()=>answerHistorical(create(),index,response,registry,START+1));
 assert.equal(validHistoricalResponse(questions[2],'1/0'),true); // Invalid arithmetic is a wrong answer, not executable input.
 for(const index of [-1,4,0.5])assert.throws(()=>visitHistorical(create(),index,START+1));
});

test('deadline is exclusive: late answers, visits and flags finish at deadline without changing responses',()=>{
 const before=answerHistorical(create(),0,'B',registry,START+59999);
 const late=answerHistorical(before,0,'A',registry,START+60000);
 assert.equal(late.finishedAt,START+60000);assert.equal(late.responses[0],'B');
 for(const next of [visitHistorical(before,2,START+60001),toggleHistoricalFlag(before,1,START+100000)]){
  assert.equal(next.finishedAt,START+60000);assert.equal(next.index,0);assert.deepEqual(next.flags,[false,false,false,false]);
 }
 assert.equal(finishHistorical(late,START+80000),late);
 assert.equal(answerHistorical(late,0,'A',registry,START+80000),late);
});

test('timing counts only explicit bounded calls, caps against wall time and cannot count one interval twice',()=>{
 const original=create({timed:false});let s=visitHistorical(original,0,START);
 s=trackHistorical(s,5000,START+1000);assert.deepEqual(s.timeSpentMs,[1000,0,0,0]);
 s=trackHistorical(s,5000,START+1000);assert.equal(s.timeSpentMs[0],1000);
 s=visitHistorical(s,1,START+1000);s=trackHistorical(s,4000,START+5000);assert.deepEqual(s.timeSpentMs,[1000,4000,0,0]);
 s=trackHistorical(s,1000,START+3000);assert.deepEqual(s.timeSpentMs,[1000,4000,0,0]);assert.equal(s.timingUpdatedAt,START+5000);
 s=trackHistorical(s,1000,START+105000);assert.deepEqual(s.timeSpentMs,[1000,5000,0,0]); // Hidden/idle gap is not charged.
 assert.deepEqual(original.timeSpentMs,[0,0,0,0]);assert.equal(restore(s,START+105000).timeSpentMs[1],5000);
 for(const elapsed of [-1,0.5,60001,NaN,Infinity])assert.throws(()=>trackHistorical(s,elapsed,START+105000));
});

test('timing at expiry charges only time before deadline and freezes after finish',()=>{
 let s=trackHistorical(create(),50000,START+50000);
 s=trackHistorical(s,20000,START+70000);
 assert.equal(s.finishedAt,START+60000);assert.equal(s.timingUpdatedAt,START+60000);assert.equal(s.timeSpentMs[0],60000);
 assert.equal(trackHistorical(s,60000,START+130000),s);
 assert.throws(()=>finishHistorical(trackHistorical(create({timed:false}),1000,START+1000),START+500),/precedes recorded/);
});

test('grading recomputes score, subject totals, partial credit and bonuses without counting bonus as accuracy',()=>{
 let s=create();s=answerHistorical(s,0,'A',registry,START+1);s=answerHistorical(s,1,['A','C'],registry,START+2);s=answerHistorical(s,2,'31/100',registry,START+3);
 s=trackHistorical(s,4000,START+4000);s=finishHistorical(s,START+5000);
 s.score=999;s.maxScore=999;s.correct=999;
 const r=gradeHistorical(s,registry);
 assert.equal(r.score,6);assert.equal(r.maxScore,14);assert.equal(r.correct,1);assert.equal(r.incorrect,1);assert.equal(r.partial,1);assert.equal(r.bonus,1);assert.equal(r.skipped,0);assert.equal(r.attempted,3);assert.equal(r.accuracy,100/3);
 assert.equal(r.activeTimeMs,4000);assert.equal(r.elapsedMs,5000);assert.equal(r.rows[1].score,2);assert.equal(r.rows[3].status,'bonus');
 assert.deepEqual(r.subjects.map(s=>[s.subject,s.score,s.maxScore,s.attempted]),[['physics',1,7,1],['chemistry',2,4,1],['mathematics',3,3,1]]);
 const blank=gradeHistorical(create(),registry);assert.equal(blank.accuracy,null);assert.equal(blank.skipped,3);assert.equal(blank.bonus,1);assert.equal(blank.score,3);
});

test('restore expires active timed attempts and preserves active untimed attempts',()=>{
 let s=answerHistorical(create(),0,'B',registry,START+10);
 assert.equal(restore(s,START+59999).finishedAt,null);assert.equal(restore(s,START+60001).finishedAt,START+60000);
 const untimed=create({timed:false});assert.equal(restore(untimed,START+100000000).finishedAt,null);
 const restored=restore(s,START+100);assert.notEqual(restored,s);restored.responses[0]='A';assert.equal(s.responses[0],'B');
});

test('restore refuses identity, bank, question, response, timing and ordering tampering',()=>{
 const mutations=[
 s=>s.version=2,s=>s.id='forged',s=>s.bankId='different',s=>s.seed=-1,s=>s.startedAt+=1,s=>s.mode='fake',s=>s.paperId='synthetic-paper',
 s=>s.questionIds[0]='unknown',s=>s.questionIds[1]=s.questionIds[0],s=>s.index=-1,s=>s.index=4,s=>s.responses.pop(),s=>s.responses[0]='X',s=>s.responses[1]=['A','A'],
 s=>s.responses[0]='B', // An answer without a recorded visit is inconsistent.
 s=>s.flags[0]=true,s=>s.visited[0]=1,s=>s.flags[0]='false',s=>s.timeSpentMs.pop(),s=>s.timeSpentMs[0]=-1,s=>s.timeSpentMs[0]=0.1,s=>s.timeSpentMs[0]=1,
 s=>s.timingUpdatedAt=START-1,s=>s.timingUpdatedAt=START+60001,s=>s.deadline+=1,s=>s.minutes=0,s=>s.finishedAt=START-1,s=>s.finishedAt=START+60001,
 ];
 for(const mutate of mutations){const s=create();mutate(s);assert.equal(restore(s),null,mutate.toString());}
 for(const raw of ['{','null','[]','"hello"'])assert.equal(restore(raw),null);
 const paper=create({paperId:'synthetic-paper'});paper.questionIds.reverse();assert.equal(restore(paper),null);
 const custom=create({timed:false});custom.deadline=START+60000;assert.equal(restore(custom),null);
});

test('restore strips forged totals and regrades canonical answers',()=>{
 const s=finishHistorical(answerHistorical(create(),0,'B',registry,START+1),START+2);
 const restored=restore({...s,score:1000,report:{correct:4},questions:[{answer:'A'}]});
 assert.ok(restored);assert.equal('score' in restored,false);assert.equal('report' in restored,false);assert.equal('questions' in restored,false);
 assert.equal(gradeHistorical(restored,registry).score,7);
});

test('workspace saving separates active attempts from completed history and deduplicates by stable ID',()=>{
 const empty=emptyHistoricalWorkspace(BANK);const active=create();const w=saveHistoricalSession(empty,active);
 assert.equal(w.active,active);assert.deepEqual(w.history,[]);assert.equal(empty.active,null);
 const complete=finishHistorical(active,START+1);const done=saveHistoricalSession(w,complete);
 assert.equal(done.active,null);assert.equal(done.history.length,1);assert.equal(done.history[0],complete);
 const again=saveHistoricalSession(done,{...complete,responses:['A',[],'','']});assert.equal(again.history.length,1);assert.deepEqual(again.history[0].responses,complete.responses);
 assert.throws(()=>saveHistoricalSession(done,{...complete,bankId:'different'}),/does not match/);
});

test('history retains latest 20 completed sessions sorted by finish time',()=>{
 let w=emptyHistoricalWorkspace(BANK);
 for(let i=0;i<25;i++){const s=create({now:START+i*1000,seed:i});w=saveHistoricalSession(w,finishHistorical(s,START+i*1000+100));}
 assert.equal(w.history.length,20);assert.equal(w.history[0].seed,24);assert.equal(w.history.at(-1).seed,5);assert.equal(w.active,null);
 const restored=workspaceRestore(w,START+30000);assert.equal(restored.history.length,20);assert.equal(restored.history[0].seed,24);
});

test('workspace restore moves a newly expired active session into history exactly once',()=>{
 const s=create();const w=saveHistoricalSession(emptyHistoricalWorkspace(BANK),s);
 const restored=workspaceRestore(w,START+60000);assert.equal(restored.active,null);assert.equal(restored.history.length,1);assert.equal(restored.history[0].finishedAt,START+60000);
 assert.equal(workspaceRestore(restored,START+90000).history.length,1);
});

test('workspace restores must reject corrupt, oversized, mismatched, duplicate or unfinished history',()=>{
 const s=finishHistorical(create(),START+1);const w=saveHistoricalSession(emptyHistoricalWorkspace(BANK),s);
 for(const mutate of [x=>x.version=2,x=>x.bankId='wrong',x=>x.history.push(s),x=>x.history[0].finishedAt=null,x=>x.history=Array(21).fill(s),x=>x.active={bad:true},x=>x.history[0].questionIds[0]='unknown']){
  const copy=structuredClone(w);mutate(copy);assert.equal(workspaceRestore(copy),null,mutate.toString());
 }
 for(const raw of ['{','null','[]',' '.repeat(2000001)])assert.equal(restoreHistoricalWorkspace(raw,registry,BANK,START+60000),null);
});

test('exact-question retry can use only missed IDs without carrying responses, flags or timing',()=>{
 let original=create({paperId:'synthetic-paper'});
 original=answerHistorical(original,0,'.31',registry,START+1);
 original=answerHistorical(original,1,'A',registry,START+2);
 original=finishHistorical(original,START+1000);
 const missed=gradeHistorical(original,registry).rows.filter(r=>!['correct','bonus'].includes(r.status)).map(r=>r.item.id);
 const retry=create({questionIds:missed,timed:false,now:START+2000,seed:8});
 assert.deepEqual(retry.questionIds,['single','multiple']);assert.deepEqual(retry.responses,['',[]]);assert.deepEqual(retry.flags,[false,false]);assert.deepEqual(retry.timeSpentMs,[0,0]);assert.equal(retry.mode,'chapter');assert.notEqual(retry.id,original.id);
 assert.ok(restore(retry,START+2000));
});
