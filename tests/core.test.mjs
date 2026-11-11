import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, SUBJECTS, generate, listTemplates } from '../src/questions/index.js';
import { gradeQuestion, parseNumber, numbersEqual } from '../src/questions/grading.js';
import { createSession, sessionItems, setResponse, toggleFlag, finishSession, gradeSession, restoreSession, remainingMs, createRetrySession } from '../src/practice/session.js';
import { emptyProgress, recordSession, getStats, exportProgress, importProgress } from '../src/learning/progress.js';

const now = 1_760_000_000_000;
const numeric = value => { const p = parseNumber(value); assert.ok(p, `Invalid number ${value}`); return Number(p.n) / Number(p.d); };
const near = (a, b) => assert.ok(Math.abs(a-b) < 1e-9, `${a} differs from ${b}`);
const template = (id, seed=123) => generate(id, seed);

test('exact numeric input accepts decimal/fraction equivalents and rejects executable/non-finite syntax', () => {
  for (const [a,b] of [['0.125','1/8'], ['-2/-4','+.5'], ['1.2500','5/4'], ['-0','0'], ['3.','3'], [' 2 / -6 ','-1/3']]) assert.ok(numbersEqual(a,b));
  for (const value of ['', ' ', 'NaN', 'Infinity', '1/0', '2**3', '2e3', '1 + 2', '<script>', '1/2/3', '0'.repeat(97)]) assert.equal(parseNumber(value), null, value);
  assert.equal(numbersEqual('0.3333333333333333','1/3'), false);
  assert.equal(numbersEqual('9007199254740992','9007199254740993'), false);
});

test('question grading honours explicit negative, partial, skipped and exact numeric marks', () => {
  const multi = template('phy-orbit-v1');
  const wrong = multi.options.find(o => !multi.answer.includes(o.id)).id;
  assert.deepEqual(gradeQuestion(multi, [...multi.answer].reverse()), { score:4,maxScore:4,status:'correct' });
  assert.deepEqual(gradeQuestion(multi, [multi.answer[0]]), { score:1,maxScore:4,status:'partial' });
  assert.equal(gradeQuestion(multi, [multi.answer[0],wrong]).score,-2);
  assert.equal(gradeQuestion(multi, [multi.answer[0],multi.answer[0]]).status,'incorrect');
  assert.equal(gradeQuestion(multi, []).status,'skipped');
  assert.equal(gradeQuestion(multi, ['Z']).status,'incorrect');
  const single=template('phy-shm-v1');
  assert.equal(gradeQuestion(single,single.answer).score,3);
  assert.equal(gradeQuestion(single,single.options.find(o=>o.id!==single.answer).id).score,-1);
  const num=template('chem-limiting-v1');
  assert.equal(gradeQuestion(num,String(numeric(num.answer))).status,'correct');
  assert.equal(gradeQuestion(num,'__proto__').score,0);
  assert.equal(gradeQuestion(num,' ').status,'skipped');
  assert.throws(()=>gradeQuestion({...num, answer:'broken'},'12'),/answer key/);
});

test('catalog exposes 54 chapter routes and 30 reproducible original families', () => {
  assert.equal(CHAPTERS.length,54);
  assert.equal(listTemplates().length,30);
  assert.equal(new Set(CHAPTERS.map(c=>c.id)).size,54);
  for(const subject of SUBJECTS) assert.equal(listTemplates({subject:subject.id}).length,10);
  for(const f of listTemplates()) {
    assert.ok(CHAPTERS.some(c=>c.id===f.chapter && c.subject===f.subject));
    for(let i=0;i<400;i++) {
      const seed=Math.imul(i+1,2654435761)>>>0;
      const q=generate(f.id,seed);
      assert.deepEqual(generate(f.id,seed),q);
      assert.equal(q.origin,'original');
      assert.equal(q.id,`${f.id}:${seed}`);
      assert.equal(gradeQuestion(q,q.answer).status,'correct');
      assert.ok(q.solution.length>=3);
      assert.ok(!q.stem.includes('undefined'));
      if(q.options) {
        assert.equal(new Set(q.options.map(o=>o.text)).size,q.options.length,`${q.id} duplicates a choice`);
        assert.equal(new Set(q.options.map(o=>o.id)).size,q.options.length);
      }
    }
  }
  assert.throws(()=>generate('missing',0));
  assert.throws(()=>generate('phy-projectile-v1',-1));
  assert.throws(()=>generate('phy-projectile-v1',2**32));
});

test('independent numerical audits recover values from question statements', () => {
  for(let i=0;i<300;i++) {
    const seed=Math.imul(i+17,2246822519)>>>0;
    let q=template('phy-projectile-v1',seed), [u,h]=q.stem.match(/speed (\d+) m\/s.*height (\d+) m/).slice(1).map(Number);
    // Quadratic root separation, independent of the construction's chosen times.
    near(numeric(q.answer),Math.sqrt(u*u-20*h)/5);
    q=template('phy-atwood-v1',seed); let m=q.stem.match(/Masses (\d+) kg and (\d+) kg/).slice(1).map(Number);
    const accel=numeric(q.answer), tension=m[0]*(10+accel); near(tension,m[1]*(10-accel));
    q=template('phy-work-spring-v1',seed); m=q.stem.match(/A (\d+) kg.*constant (\d+) N\/m, compressed by ([\d.]+) m/).slice(1).map(Number);
    near(m[0]*numeric(q.answer)**2,m[1]*m[2]**2);
    q=template('phy-collision-v1',seed);m=q.stem.match(/A (\d+) kg body travelling at (\d+) m\/s strikes a stationary (\d+) kg/).slice(1).map(Number);
    near((m[0]+m[2])*numeric(q.answer),m[0]*m[1]);
    q=template('phy-capacitors-v1',seed);m=q.stem.match(/Capacitors (\d+) μF and (\d+) μF.*a (\d+) V/).slice(1).map(Number);
    near(numeric(q.answer)/m[0]+numeric(q.answer)/m[1],m[2]);
    q=template('phy-circuit-v1',seed);m=q.stem.match(/Resistors (\d+) Ω and (\d+) Ω.*an ideal (\d+) V/).slice(1).map(Number);
    near(numeric(q.answer)/m[2],m[2]/m[0]+m[2]/m[1]);
    q=template('phy-lens-v1',seed);m=q.stem.match(/placed (\d+) cm.*length (\d+) cm/).slice(1).map(Number);
    near(1/numeric(q.answer)+1/m[0],1/m[1]);
    q=template('phy-photoelectric-v1',seed);m=q.stem.match(/function (\d+) eV.*energy (\d+) eV, then (\d+) eV/).slice(1).map(Number);
    near(numeric(q.answer),(m[2]-m[0])-(m[1]-m[0]));
    q=template('chem-limiting-v1',seed);m=q.stem.match(/, (\d+) mol N₂ is mixed with (\d+) mol H₂/).slice(1).map(Number);
    near(numeric(q.answer),Math.min(m[0],m[1]/3)*2*.75);
    q=template('chem-hydrogen-v1',seed);m=q.stem.match(/to n = (\d+)/).slice(1).map(Number);
    near(numeric(q.answer),13.6-13.6/(m[0]*m[0]));
    q=template('chem-gas-v1',seed);m=q.stem.match(/at (\d+) bar and (\d+) K.*volume V\/(\d+) and temperature (\d+) K/).slice(1).map(Number);
    near(numeric(q.answer)/m[2]/m[3],m[0]/m[1]);
    q=template('chem-hess-v1',seed);m=[...q.stem.matchAll(/ΔH = (−?-?\d+) kJ/g)].map(m=>+m[1]);near(numeric(q.answer)+2*(m[0]+m[1]),0);
    q=template('chem-kc-v1',seed);m=q.stem.match(/contains (\d+) mol.*equilibrium, (\d+) mol/).slice(1).map(Number);
    near(numeric(q.answer)*(m[0]-m[1]),(2*m[1])**2);
    q=template('chem-electrolysis-v1',seed);m=q.stem.match(/charge of (\d+) F/).slice(1).map(Number);near(numeric(q.answer)/64*2,m[0]);
    q=template('chem-first-order-v1',seed);m=q.stem.match(/half-life (\d+) min.*to 1\/(\d+)/).slice(1).map(Number);
    near(2**(-numeric(q.answer)/m[0]),1/m[1]);
    q=template('chem-colligative-v1',seed);m=q.stem.match(/^(\d+) g.*dissolved in (\d+) g/).slice(1).map(Number);
    near(numeric(q.answer),2*(m[0]/100)/(m[1]/1000));
    q=template('math-roots-v1',seed);m=q.stem.match(/x² − (\d+)x \+ (\d+)/).slice(1).map(Number);
    const root=(m[0]+Math.sqrt(m[0]**2-4*m[1]))/2;near(numeric(q.answer),root**3+(m[0]-root)**3);
    q=template('math-complex-v1',seed);m=q.stem.match(/z = \((\d+) \+ (\d+)i\)/).slice(1).map(Number);
    near(numeric(q.answer),(m[0]+m[1])**2+(m[1]-m[0])**2);
    q=template('math-ap-v1',seed);m=q.stem.match(/are (\d+) and (\d+).*first (\d+) terms/).slice(1).map(Number);
    const difference=(m[1]-m[0])/4;near(numeric(q.answer),Array.from({length:m[2]},(_,j)=>m[0]+(j-2)*difference).reduce((a,b)=>a+b));
    q=template('math-binomial-v1',seed);m=q.stem.match(/\(1 \+ (\d+)x\)\^(\d+)/).slice(1).map(Number);
    let coeff=[1]; for(let j=0;j<m[1];j++) { const next=Array(coeff.length+1).fill(0);coeff.forEach((v,k)=>{next[k]+=v;next[k+1]+=m[0]*v;});coeff=next; }near(numeric(q.answer),coeff[2]);
    q=template('math-probability-v1',seed);m=q.stem.match(/contains (\d+) red and (\d+) blue/).slice(1).map(Number);
    let favourable=0,total=0;for(let a=0;a<m[0]+m[1];a++)for(let b=a+1;b<m[0]+m[1];b++){total++;if((a<m[0])!==(b<m[0]))favourable++;}near(numeric(q.answer),favourable/total);
    q=template('math-matrix-v1',seed);m=q.stem.match(/row \((\d+), (\d+)\) and second row \((\d+), (\d+)\)/).slice(1).map(Number);
    const [a,b,c,d]=m;const squared=[a*a+b*c,a*b+b*d,c*a+d*c,c*b+d*d];near(numeric(q.answer),squared[0]*squared[3]-squared[1]*squared[2]);
    q=template('math-integral-v1',seed);m=q.stem.match(/from −(\d+) to \d+ of \(x³ \+ (\d+)x²/).slice(1).map(Number);
    const primitive=x=>x**4/4+m[1]*x**3/3+x;near(numeric(q.answer),primitive(m[0])-primitive(-m[0]));
    q=template('math-vectors-v1',seed);m=q.stem.match(/a = \((\d+), (\d+), 1\) and b = \(2, −(\d+), λ\)/).slice(1).map(Number);near(m[0]*2-m[1]*m[2]+numeric(q.answer),0);
  }
});

test('choice keys remain correct after deterministic option shuffling', () => {
  for(let seed=0;seed<100;seed++) {
    for(const id of ['phy-orbit-v1','chem-isomers-v1','math-optimisation-v1']) {
      const q=template(id,Math.imul(seed+1,2654435761)>>>0);
      const incorrectText=q.options.find(o=>!q.answer.includes(o.id)).text;
      assert.match(incorrectText,/kinetic energy|Every carbon|decreasing/);
    }
    let q=template('phy-shm-v1',seed);assert.equal(q.options.find(o=>o.id===q.answer).text,'3/4');
    q=template('chem-neutralisation-v1',seed);assert.equal(q.options.find(o=>o.id===q.answer).text,'−log₁₀(0.05)');
    q=template('math-conic-v1',seed);const m=q.stem.match(/y² = (\d+)x.*point \((\d+), (\d+)\)/).slice(1).map(Number);near(numeric(q.options.find(o=>o.id===q.answer).text.replace('−','-')),-2*m[2]/m[0]);
  }
});

test('practice is deterministic, immutable, bounded, and does not duplicate stems', () => {
  const options={seed:2345,now,count:30,timed:true,minutes:90};
  const s=createSession(options);assert.deepEqual(s,createSession(options));
  const items=sessionItems(s);assert.equal(new Set(items.map(q=>q.stem)).size,30);
  for(const subject of SUBJECTS)assert.ok(items.some(q=>q.subject===subject.id));
  const mixed=sessionItems(createSession({seed:2345,now,count:12}));
  for(const subject of SUBJECTS)assert.equal(mixed.filter(q=>q.subject===subject.id).length,4);
  const changed=setResponse(s,0,items[0].answer,now+1);assert.notDeepEqual(s.responses,changed.responses);
  assert.equal(gradeSession(s).skipped,30);assert.equal(gradeSession(changed).correct,1);
  assert.equal(toggleFlag(s,0,now+1).flags[0],true);assert.equal(s.flags[0],false);
  assert.throws(()=>createSession({seed:0,subject:'biology',now}));
  assert.throws(()=>createSession({seed:0,chapter:'phy-units',now}),/not yet available/);
  assert.throws(()=>createSession({seed:0,subject:'physics',chapter:'chem-mole',now}));
  assert.throws(()=>createSession({seed:0,count:61,now}));
  assert.throws(()=>createSession({seed:0,minutes:0,now}));
  assert.throws(()=>setResponse(s,-1,'A',now));
});

test('timed sessions expire by wall clock and reject late answers after a reload', () => {
  const s=createSession({seed:55,now,count:3,minutes:1});
  assert.equal(remainingMs(s,now+59000),1000);
  assert.equal(remainingMs(s,now+60001),0);
  const late=setResponse(s,0,sessionItems(s)[0].answer,now+60000);
  assert.equal(late.finishedAt,now+60000);assert.deepEqual(late.responses,s.responses);
  const restored=restoreSession(JSON.stringify(s),now+1000000);assert.equal(restored.finishedAt,s.deadline);
  const finished=finishSession(s,now+2000);assert.equal(finished.finishedAt,now+2000);
  assert.deepEqual(setResponse(finished,0,sessionItems(s)[0].answer,now+3000),finished);
  assert.equal(remainingMs(createSession({seed:3,now,timed:false}),now+1),null);
});

test('session restore rejects tampering and discards untrusted keys and totals', () => {
  const s=createSession({seed:12,now,count:3});
  assert.deepEqual(restoreSession(JSON.stringify(s),now),s);
  const forged={...s,answer:'A',score:999};const clean=restoreSession(JSON.stringify(forged),now);assert.equal(clean.score,undefined);assert.equal(clean.answer,undefined);
  for(const mutation of [
    x=>x.questions[0].seed=-1,x=>x.questions[0].templateId='missing',x=>x.questions.push(x.questions[0]),
    x=>x.responses[0]={constructor:'attack'},x=>x.flags[0]=1,x=>x.deadline++,x=>x.minutes=400,
    x=>x.index=3,x=>x.finishedAt=x.deadline+1,x=>x.startedAt=now+1000000,x=>x.subject='chemistry',
  ]) { const v=structuredClone(s);mutation(v);assert.equal(restoreSession(JSON.stringify(v),now),null); }
  assert.equal(restoreSession('{',now),null);assert.equal(restoreSession('x'.repeat(100001),now),null);
});

test('retry preserves exact missed identities and clears responses and flags', () => {
  let s=createSession({seed:82,now,count:4});const original=sessionItems(s);
  s=setResponse(s,0,original[0].answer,now+1);s=toggleFlag(s,2,now+2);s=finishSession(s,now+3);
  const retry=createRetrySession(s,now+4);assert.equal(retry.timed,false);assert.equal(retry.questions.length,3);
  assert.deepEqual(sessionItems(retry).map(q=>q.id),original.slice(1).map(q=>q.id));
  assert.equal(gradeSession(retry).skipped,3);assert.ok(retry.flags.every(f=>!f));
  assert.throws(()=>createRetrySession(createSession({seed:1,now}),now+1));
});

test('progress excludes blanks, deduplicates first attempts, and regrades backup responses', () => {
  let s=createSession({seed:34,now,count:4});const items=sessionItems(s);
  s=setResponse(s,0,items[0].answer,now+1);s=finishSession(s,now+2);
  let p=recordSession(emptyProgress(),s,now+3);
  assert.equal(getStats(p).attempted,1);assert.equal(getStats(p).correct,1);
  p=recordSession(p,s,now+3);assert.equal(p.records.length,1);
  const backup=JSON.parse(exportProgress(p));backup.records[0].score=999;backup.records[0].correct=false;
  const imported=importProgress(JSON.stringify(backup),emptyProgress(),now+3);
  assert.equal(getStats(imported).correct,1);assert.equal(imported.records[0].score,undefined);
  const later=structuredClone(backup);later.records[0].answeredAt+=100;later.records[0].response=items[0].type==='multiple'?[items[0].options.find(o=>!items[0].answer.includes(o.id)).id]:items[0].type==='single'?items[0].options.find(o=>o.id!==items[0].answer).id:'999999';
  assert.equal(getStats(importProgress(JSON.stringify(later),p,now+1000)).correct,1);
  assert.throws(()=>importProgress('{',p));assert.throws(()=>importProgress(JSON.stringify({...backup,app:'another'}),p));
  const bad=structuredClone(backup);bad.records[0].seed=-1;assert.throws(()=>importProgress(JSON.stringify(bad),p));
  assert.equal(p.records.length,1,'failed imports must not mutate existing progress');
});
