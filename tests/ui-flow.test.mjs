import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as questions from '../src/questions/index.js';
import * as sessions from '../src/practice/session.js';
import * as progress from '../src/learning/progress.js';
import * as history from '../src/learning/history.js';
import * as notebook from '../src/learning/notebook.js';

// Exercise the real route/session controller with a minimal page adapter.
// Detailed DOM layout and interaction are covered by the browser release check.
const source=(await readFile(new URL('../assets/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify('http://localhost/assets/app.js')).replace(/\$\('\.skip-link'\)[\s\S]*$/,'');
function controller(hash='') {
 const stored=new Map();
 const context=vm.createContext({...questions,...sessions,...progress,...history,...notebook,Date,Math,JSON,URLSearchParams,Intl,performance,crypto:webcrypto,console,
  location:{hash},confirm:()=>true,
  document:{querySelector:()=>({innerHTML:'',querySelectorAll:()=>[]}),querySelectorAll:()=>[],hidden:false},
  localStorage:{setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},
 });
 vm.runInContext(source,context);
 vm.runInContext("writer={mode:'writer'};showQuestion=()=>{};showSetup=()=>{globalThis.view='setup'};",context);
 return {run:code=>vm.runInContext(code,context),stored,context};
}

test('subject-grouped UI sessions retain valid aligned answers on every reload',()=>{
 const c=controller();
 for(let seed=1;seed<=30;seed++) {
  c.context.setup={count:12,minutes:36,subject:'all',chapter:'all',timed:true};
  c.context.crypto={getRandomValues:array=>{array[0]=seed;return array;}};
  c.run("startSession(setup);");
  const clean=sessions.restoreSession(c.run('JSON.stringify(session)'));
  assert.ok(clean,`Grouped session seed ${seed} must restore`);
  assert.deepEqual(sessions.sessionItems(clean).map(q=>q.subject),[...Array(4).fill('physics'),...Array(4).fill('chemistry'),...Array(4).fill('mathematics')]);
 }
});

test('explicit chapter, count and setup links show setup without replacing active work',()=>{
 for(const hash of ['#practice?subject=chemistry&chapter=chem-equilibrium','#practice?count=6','#practice?setup=1']) {
  const c=controller(hash);
  c.run('session=createSession({seed:2,count:3});globalThis.originalId=session.id;showPractice();');
  assert.equal(c.context.view,'setup');
  assert.equal(c.run('session.id'),c.context.originalId);
 }
});

test('timer expiry while leaving practice records completed history exactly once',()=>{
 const c=controller('#overview');
 c.run("session=createSession({seed:2,count:3,minutes:1,now:Date.now()-61000});trackingActive=true;timingCursor=performance.now()-1000;flushTime();flushTime();");
 assert.equal(c.run('history.sessions.length'),1);
 assert.ok(c.run('session.finishedAt'));
 assert.equal(c.run('trackingActive'),false);
 assert.ok(c.stored.has('vedaris.history.v1'));
});
