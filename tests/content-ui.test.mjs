import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { CHAPTERS, SUBJECTS } from '../src/questions/catalog.js';
import * as sessionEngine from '../src/content/session.js';

const source=(await readFile(new URL('../assets/pyq.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export function mountPYQ','function mountPYQ').replaceAll('import.meta.url',JSON.stringify('http://localhost/assets/pyq.js'));
const NOW=1_800_000_000_000,BANK='synthetic-ui-bank';
const q=[{id:'q1',subject:'physics',chapter:'phy-kinematics',chapters:['phy-kinematics'],answer:'A'},{id:'q2',subject:'chemistry',chapter:'chem-mole',chapters:['chem-mole'],answer:'B'}].map((v,i)=>({...v,origin:'pyq',status:'practice-ready',type:'single',year:2023,paper:1,paperId:'fixture',section:'section-1',questionNumber:String(i+1),stem:`Synthetic test statement ${i+1}`,options:['A','B'].map(id=>({id,text:`Synthetic option ${id}`})),marking:{correct:3,incorrect:-1,unanswered:0},solution:['Synthetic test explanation.'],source:{url:'https://example.invalid/fixture.pdf',page:1},assets:[]}));
const registry={getQuestion:id=>{const x=q.find(x=>x.id===id);if(!x)throw new Error('Unknown question');return x;},filterQuestions:()=>q,listPapers:()=>[]};
const attempt=(seed=1)=>sessionEngine.createHistoricalSession(registry,{questionIds:q.map(x=>x.id),bankId:BANK,seed,timed:false,now:NOW});
function harness(workspace,{readOnly=true}={}){
 const rootEvents=new Map(),docEvents=new Map(),windowEvents=new Map(),timers=new Map();let commits=0,writes=0;
 const root={_html:'',set innerHTML(value){this._html=value;writes++;},get innerHTML(){return this._html;},querySelector:()=>null,querySelectorAll:()=>[],contains:()=>true,addEventListener:(k,v)=>rootEvents.set(k,v),removeEventListener:(k,v)=>{if(rootEvents.get(k)===v)rootEvents.delete(k);}};
 const surface=events=>({hidden:false,addEventListener:(k,v)=>events.set(k,v),removeEventListener:(k,v)=>{if(events.get(k)===v)events.delete(k);}});
 const DateStub=class extends Date{static now(){return NOW+10000;}};
 const context=vm.createContext({...sessionEngine,CHAPTERS,SUBJECTS,root,registry,workspace,readOnly,Date:DateStub,URL,Intl,Math,Set,Map,JSON,document:surface(docEvents),window:surface(windowEvents),setInterval:fn=>{const id=timers.size+1;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),onChange:()=>{commits++;return true;}});
 vm.runInContext(source,context);const cleanup=vm.runInContext('mountPYQ(root,{registry,workspace,readOnly,onChange})',context);
 return {root,cleanup,rootEvents,docEvents,windowEvents,timers,get writes(){return writes;},get commits(){return commits;},click(action,value=''){const button={dataset:{pyqAction:action,value},disabled:false};rootEvents.get('click')({target:{closest:()=>button}});}};
}

test('reader report and result filter survive writer timing and answer updates',()=>{
 let completed=attempt();completed=sessionEngine.answerHistorical(completed,0,'B',registry,NOW+1);completed=sessionEngine.answerHistorical(completed,1,'B',registry,NOW+2);completed=sessionEngine.finishHistorical(completed,NOW+3);
 const active=attempt(2),workspace={...sessionEngine.emptyHistoricalWorkspace(BANK),active,history:[completed]};
 const h=harness(workspace);h.click('history',completed.id);h.click('report-filter','incorrect');
 assert.match(h.root.innerHTML,/Historical practice report/);assert.match(h.root.innerHTML,/Synthetic test statement 1/);assert.doesNotMatch(h.root.innerHTML,/Synthetic test statement 2/);
 const before=h.root.innerHTML,writes=h.writes;
 const changed=sessionEngine.answerHistorical(active,0,'A',registry,NOW+100);
 h.cleanup.updateWorkspace({...workspace,active:sessionEngine.trackHistorical(changed,1000,NOW+1000)});
 assert.equal(h.root.innerHTML,before);assert.equal(h.writes,writes);assert.equal(h.commits,0);
 h.cleanup();assert.equal(h.timers.size,0);
});

test('reader question navigation survives timing-only snapshots and never writes to the workspace',()=>{
 const workspace={...sessionEngine.emptyHistoricalWorkspace(BANK),active:attempt()};const h=harness(workspace);
 h.click('resume');h.click('question','1');assert.match(h.root.innerHTML,/Synthetic test statement 2/);
 const before=h.root.innerHTML,writes=h.writes;
 h.cleanup.updateWorkspace({...workspace,active:sessionEngine.trackHistorical(workspace.active,1000,NOW+1000)});
 assert.equal(h.writes,writes);assert.equal(h.root.innerHTML,before);
 for(const action of ['flag','clear','finish','start','prepare-one'])h.click(action,'q1');
 assert.equal(h.commits,0);h.cleanup();
});

test('reader moves from active question to its report when another tab finishes',()=>{
 const active=attempt(),workspace={...sessionEngine.emptyHistoricalWorkspace(BANK),active};const h=harness(workspace);h.click('resume');
 const done=sessionEngine.finishHistorical(active,NOW+1000);
 h.cleanup.updateWorkspace({...workspace,active:null,history:[done]});
 assert.match(h.root.innerHTML,/YOUR COMPLETED PYQ ATTEMPT/);assert.doesNotMatch(h.root.innerHTML,/ACTUAL JEE ADVANCED · IN PROGRESS/);assert.equal(h.commits,0);h.cleanup();
});

test('PYQ cleanup removes interval and document/window/root listeners exactly once',()=>{
 const h=harness(sessionEngine.emptyHistoricalWorkspace(BANK));
 assert.equal(h.timers.size,1);assert.equal(h.rootEvents.size,3);assert.equal(h.docEvents.size,1);assert.equal(h.windowEvents.size,1);
 h.cleanup();h.cleanup();assert.equal(h.timers.size,0);assert.equal(h.rootEvents.size,0);assert.equal(h.docEvents.size,0);assert.equal(h.windowEvents.size,0);
});
