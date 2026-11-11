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
import * as historical from '../src/content/session.js';

// Exercise the real route/session controller with a minimal page adapter.
// Detailed DOM layout and interaction are covered by the browser release check.
const source=(await readFile(new URL('../assets/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify('http://localhost/assets/app.js')).replace(/\$\('\.skip-link'\)[\s\S]*$/,'');
function controller(hash='') {
 const stored=new Map();
 const context=vm.createContext({...questions,...sessions,...progress,...history,...notebook,...historical,Date,Math,JSON,URLSearchParams,Intl,performance,crypto:webcrypto,console,
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

test('unavailable storage still mounts PYQ memory practice and retains it when reopening the bank',async()=>{
 const c=controller('#pyq');let mounted,reads=0;
 c.context.loadContentBank=async()=>({registry:{},markup:{}});
 c.context.mountPYQ=(_root,options)=>{mounted=options;return ()=>{};};
 c.context.localStorage.getItem=()=>{reads++;throw new Error('Storage access denied');};
 c.run("contentManifest={version:1,bankId:'test-reviewed-bank'};");
 await c.run('showPYQ()');
 assert.ok(mounted,'The reviewed bank must remain usable when local storage is unavailable');
 assert.equal(mounted.memoryMode,true);assert.equal(mounted.readOnly,false);assert.equal(reads,1);
 const next={...mounted.workspace,history:[]};
 assert.equal(mounted.onChange(next),true);assert.equal(c.stored.size,0);
 await c.run('showPYQ()');
 assert.equal(mounted.workspace,next);assert.equal(mounted.memoryMode,true);assert.equal(reads,1);
});

test('corrupt PYQ storage remains exportable and read-only instead of becoming memory practice',async()=>{
 const c=controller('#pyq');let mounted,reads=0;
 const raw='{invalid saved JSON';
 c.context.loadContentBank=async()=>({registry:{},markup:{}});
 c.context.mountPYQ=(_root,options)=>{mounted=options;return ()=>{};};
 c.context.localStorage.getItem=()=>{reads++;return raw;};
 c.run("contentManifest={version:1,bankId:'test-reviewed-bank'};");
 await c.run('showPYQ()');
 assert.ok(mounted);assert.equal(mounted.memoryMode,false);assert.equal(mounted.readOnly,true);
 assert.equal(mounted.backupRaw,raw);assert.equal(reads,1);
 assert.equal(mounted.onChange(mounted.workspace),false);assert.equal(c.stored.size,0);
});
