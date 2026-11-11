import { gradeContentQuestion } from './catalog.js';

const validTime = value => Number.isSafeInteger(value) && value > 0;
const validSeed = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const hasAnswer = value => Array.isArray(value) ? value.length > 0 : typeof value === 'string' && !!value.trim();
const clone = value => JSON.parse(JSON.stringify(value));
const indexOK = (session,index) => Number.isInteger(index) && index >= 0 && index < session.questionIds.length;

export function validHistoricalResponse(question,response) {
  if(question.type==='bonus')return response==='';
  if(question.type==='multiple')return Array.isArray(response)&&response.length<=question.options.length&&new Set(response).size===response.length&&response.every(id=>question.options.some(option=>option.id===id));
  if(typeof response!=='string'||response.length>96)return false;
  return question.type==='numerical'||response===''||question.options.some(option=>option.id===response);
}

export function createHistoricalSession(registry,{questionIds,paperId=null,bankId,seed=Date.now()>>>0,timed=true,minutes=30,now=Date.now()}={}) {
  if(typeof bankId!=='string'||!bankId||bankId.length>100||!validTime(now)||!validSeed(seed)||typeof timed!=='boolean')throw new Error('Invalid historical practice setup');
  if(paperId){const paper=registry.getFullPaper(paperId);questionIds=paper.orderedQuestionIds;timed=true;minutes=paper.durationMinutes;}
  if(!Array.isArray(questionIds)||!questionIds.length||questionIds.length>500||new Set(questionIds).size!==questionIds.length)throw new Error('Choose 1–500 distinct reviewed questions');
  const questions=questionIds.map(id=>registry.getQuestion(id));
  if(timed&&(!Number.isInteger(minutes)||minutes<1||minutes>720))throw new Error('Choose a duration from 1 to 720 minutes');
  return {version:1,id:`pyq-${now}-${seed}`,bankId,seed,mode:paperId?'paper':'chapter',paperId,questionIds:[...questionIds],responses:questions.map(q=>q.type==='multiple'?[]:''),flags:questions.map(()=>false),visited:questions.map(()=>false),timeSpentMs:questions.map(()=>0),index:0,timed,minutes:timed?minutes:null,startedAt:now,deadline:timed?now+minutes*60000:null,finishedAt:null,timingUpdatedAt:now};
}

export function finishHistorical(session,now=Date.now()) {
  if(!validTime(now)||now<session.startedAt)throw new Error('Invalid finish time');
  if(session.finishedAt!==null)return session;
  const finishedAt=session.deadline?Math.min(now,session.deadline):now;
  if(session.timingUpdatedAt>finishedAt)throw new Error('Finish time precedes recorded activity');
  return {...session,finishedAt};
}
function active(session,now){
  if(!validTime(now)||now<session.startedAt)throw new Error('Invalid activity time');
  return session.finishedAt===null&&(!session.deadline||now<session.deadline);
}
export function answerHistorical(session,index,response,registry,now=Date.now()) {
  if(!indexOK(session,index))throw new Error('Question index is out of range');
  if(!active(session,now))return finishHistorical(session,now);
  if(!validHistoricalResponse(registry.getQuestion(session.questionIds[index]),response))throw new Error('Invalid response');
  return {...session,index,responses:session.responses.map((v,i)=>i===index?(Array.isArray(response)?[...response].sort():response):v),visited:session.visited.map((v,i)=>i===index||v)};
}
export function visitHistorical(session,index,now=Date.now()) {
  if(!indexOK(session,index))throw new Error('Question index is out of range');
  if(!active(session,now))return finishHistorical(session,now);
  return {...session,index,visited:session.visited.map((v,i)=>i===index||v)};
}
export function toggleHistoricalFlag(session,index,now=Date.now()) {
  if(!indexOK(session,index))throw new Error('Question index is out of range');
  if(!active(session,now))return finishHistorical(session,now);
  return {...session,flags:session.flags.map((v,i)=>i===index?!v:v),visited:session.visited.map((v,i)=>i===index||v)};
}
export function trackHistorical(session,elapsedMs,now=Date.now()) {
  if(!Number.isInteger(elapsedMs)||elapsedMs<0||elapsedMs>60000||!validTime(now)||now<session.startedAt)throw new Error('Invalid visible activity interval');
  if(session.finishedAt!==null)return session;
  const end=session.deadline?Math.min(now,session.deadline):now;
  const amount=Math.max(0,Math.min(elapsedMs,end-session.timingUpdatedAt));
  const next={...session,timeSpentMs:session.timeSpentMs.map((v,i)=>v+(i===session.index?amount:0)),timingUpdatedAt:Math.max(end,session.timingUpdatedAt)};
  return session.deadline&&now>=session.deadline?finishHistorical(next,now):next;
}

export function gradeHistorical(session,registry) {
  const rows=session.questionIds.map((id,index)=>{const item=registry.getQuestion(id);return {item,response:session.responses[index],...gradeContentQuestion(item,session.responses[index]),flagged:session.flags[index],visited:session.visited[index],timeSpentMs:session.timeSpentMs[index]};});
  const report={score:0,maxScore:0,correct:0,incorrect:0,partial:0,skipped:0,bonus:0,rows,activeTimeMs:session.timeSpentMs.reduce((a,b)=>a+b,0),elapsedMs:session.finishedAt===null?null:session.finishedAt-session.startedAt};
  for(const row of rows){report.score+=row.score;report.maxScore+=row.maxScore;report[row.status]++;}
  report.attempted=report.correct+report.incorrect+report.partial;
  report.accuracy=report.attempted?100*report.correct/report.attempted:null;
  report.subjects=['physics','chemistry','mathematics'].map(subject=>{const group=rows.filter(row=>row.item.subject===subject);return {subject,score:group.reduce((n,r)=>n+r.score,0),maxScore:group.reduce((n,r)=>n+r.maxScore,0),correct:group.filter(r=>r.status==='correct').length,attempted:group.filter(r=>!['skipped','bonus'].includes(r.status)).length,total:group.length,timeSpentMs:group.reduce((n,r)=>n+r.timeSpentMs,0)};}).filter(row=>row.total);
  return report;
}

export function restoreHistoricalSession(value,registry,bankId,now=Date.now()) {
  try {
    const v=typeof value==='string'?JSON.parse(value):value;
    if(!v||v.version!==1||v.bankId!==bankId||!validSeed(v.seed)||!validTime(v.startedAt)||v.startedAt>now+60000||!validTime(now)||v.id!==`pyq-${v.startedAt}-${v.seed}`)return null;
    if(!['paper','chapter'].includes(v.mode)||typeof v.timed!=='boolean'||!Array.isArray(v.questionIds)||!v.questionIds.length||v.questionIds.length>500||new Set(v.questionIds).size!==v.questionIds.length||!indexOK(v,v.index))return null;
    const questions=v.questionIds.map(id=>registry.getQuestion(id));
    if(v.mode==='paper'){
      const paper=registry.getFullPaper(v.paperId);
      if(!v.timed||v.minutes!==paper.durationMinutes||JSON.stringify(v.questionIds)!==JSON.stringify(paper.orderedQuestionIds))return null;
    }else if(v.paperId!==null)return null;
    if(v.timed?(!Number.isInteger(v.minutes)||v.minutes<1||v.minutes>720||v.deadline!==v.startedAt+v.minutes*60000):(v.minutes!==null||v.deadline!==null))return null;
    if(v.finishedAt!==null&&(!validTime(v.finishedAt)||v.finishedAt<v.startedAt||v.finishedAt>now+60000||(v.deadline&&v.finishedAt>v.deadline)))return null;
    if(!Array.isArray(v.responses)||v.responses.length!==questions.length||v.responses.some((r,i)=>!validHistoricalResponse(questions[i],r)))return null;
    if(!Array.isArray(v.flags)||v.flags.length!==questions.length||v.flags.some(v=>typeof v!=='boolean'))return null;
    if(!Array.isArray(v.visited)||v.visited.length!==questions.length||v.visited.some(v=>typeof v!=='boolean')||v.visited.some((visited,i)=>!visited&&(hasAnswer(v.responses[i])||v.flags[i])))return null;
    const end=v.finishedAt??(v.deadline?Math.min(now+60000,v.deadline):now+60000);
    if(!validTime(v.timingUpdatedAt)||v.timingUpdatedAt<v.startedAt||v.timingUpdatedAt>end||!Array.isArray(v.timeSpentMs)||v.timeSpentMs.length!==questions.length||v.timeSpentMs.some(t=>!Number.isSafeInteger(t)||t<0)||v.timeSpentMs.reduce((a,b)=>a+b,0)>v.timingUpdatedAt-v.startedAt)return null;
    const fields=['version','id','bankId','seed','mode','paperId','questionIds','responses','flags','visited','timeSpentMs','index','timed','minutes','startedAt','deadline','finishedAt','timingUpdatedAt'];
    const clean=clone(Object.fromEntries(fields.map(key=>[key,v[key]])));
    return clean.finishedAt===null&&clean.deadline&&now>=clean.deadline?finishHistorical(clean,now):clean;
  }catch{return null;}
}

export function emptyHistoricalWorkspace(bankId){return {version:1,bankId,active:null,history:[]};}
export function restoreHistoricalWorkspace(raw,registry,bankId,now=Date.now()) {
  if(typeof raw!=='string'||raw.length>2000000)return null;
  try {
    const v=JSON.parse(raw);
    if(!v||v.version!==1||v.bankId!==bankId||!Array.isArray(v.history)||v.history.length>20||v.history.some(s=>!s||s.finishedAt===null))return null;
    const active=v.active===null?null:restoreHistoricalSession(v.active,registry,bankId,now);
    if(v.active!==null&&!active)return null;
    const history=v.history.map(s=>restoreHistoricalSession(s,registry,bankId,now));
    if(history.some(s=>!s||s.finishedAt===null)||new Set(history.map(s=>s.id)).size!==history.length)return null;
    const clean={version:1,bankId,active,history:history.sort((a,b)=>b.finishedAt-a.finishedAt)};
    return active?.finishedAt?saveHistoricalSession(clean,active):clean;
  }catch{return null;}
}
export function saveHistoricalSession(workspace,session) {
  if(session.bankId!==workspace.bankId)throw new Error('Question bank version does not match this session');
  const history=session.finishedAt!==null&&!workspace.history.some(s=>s.id===session.id)?[session,...workspace.history].sort((a,b)=>b.finishedAt-a.finishedAt).slice(0,20):workspace.history;
  return {...workspace,active:session.finishedAt===null?session:null,history};
}
