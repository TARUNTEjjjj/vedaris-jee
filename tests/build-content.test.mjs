import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,mkdir,rm,cp,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareContent} from '../scripts/build-content.mjs';
import {createContentRegistry,gradeContentQuestion} from '../src/content/catalog.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const scratch=join(tmpdir(),'vedaris-content-');
const archive=JSON.parse(await readFile(root+'data/archive.json','utf8'));
async function walk(path){const out=[];for(const row of await readdir(root+path,{withFileTypes:true})){const next=path+'/'+row.name;out.push(...(row.isDirectory()?await walk(next):[next]));}return out;}
const inventory=await walk('assets');
const compiled=await prepareContent(root,archive,inventory);
async function fixture(fn){const tmp=await mkdtemp(scratch+'content-fixture-');try{await fn(tmp);}finally{await rm(tmp,{recursive:true,force:true});}}
async function copyContent(tmp){await cp(root+'content',tmp+'/content',{recursive:true});}
async function modify(tmp,path,fn){const value=JSON.parse(await readFile(tmp+'/'+path,'utf8'));fn(value);await writeFile(tmp+'/'+path,JSON.stringify(value));}

test('all 102 source questions load, full-paper totals hold, and every gold answer earns full credit',()=>{
 const decoded=compiled.manifest.bundles.map(({path})=>JSON.parse(compiled.inputs.get(path)));
 const registry=createContentRegistry({archive,bundles:decoded.map(row=>row.bundle),papers:compiled.manifest.papers,availableAssets:compiled.manifest.availableAssets});
 assert.equal(registry.size,102);
 for(const paper of registry.listPapers()){
  const full=registry.getFullPaper(paper.paperId);
  assert.equal(full.questions.length,51);assert.equal(full.maxMarks,180);assert.equal(full.durationMinutes,180);
  let total=0;
  for(const question of full.questions){const result=gradeContentQuestion(question,question.answer);assert.equal(result.score,question.marking.correct,question.id);total+=result.score;}
  assert.equal(total,180);
 }
 const discrete=registry.getQuestion('2023_P1_Physics_Q09-v1');
 for(const value of ['80','150','220'])assert.equal(gradeContentQuestion(discrete,value).score,4);
 assert.equal(gradeContentQuestion(discrete,'100').score,0);
 const multi=registry.getQuestion('2023_P1_Mathematics_Q01-v1');
 assert.equal(gradeContentQuestion(multi,['A']).score,1);assert.equal(gradeContentQuestion(multi,['A','C']).score,2);assert.equal(gradeContentQuestion(multi,['A','B']).score,-2);
 const range=registry.getQuestion('2023_P2_Physics_Q15-v1');
 for(const value of ['8','8.2','8.4'])assert.equal(gradeContentQuestion(range,value).score,3);
 assert.equal(gradeContentQuestion(range,'8.400001').score,0);
 for(const id of ['2023_P2_Physics_Q16-v1','2023_P2_Physics_Q17-v1'])for(const response of [null,'','0','999'])assert.equal(gradeContentQuestion(registry.getQuestion(id),response).score,3);
});

test('compiler is deterministic, self-consistent and below publication budgets',async()=>{
 const again=await prepareContent(root,archive,inventory);
 assert.deepEqual([...again.inputs],[...compiled.inputs]);
 assert.deepEqual(compiled.counts,{questions:102,papers:2,fullPapers:2,years:1,assets:39});
 for(const {path,sha256} of compiled.manifest.bundles){const bytes=compiled.inputs.get(path);assert.ok(bytes.length<1024*1024);assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256);}
 assert.ok(compiled.manifest.attributions.some(row=>row.licenseNotice?.includes('Permission is hereby granted')));
});

test('matching lists, all figures and one shared paragraph survive conversion',()=>{
 const bundles=compiled.manifest.bundles.map(({path})=>JSON.parse(compiled.inputs.get(path)));
 for(const {bundle,markup} of bundles)for(const q of bundle.questions){
  assert.ok(markup[q.id].statement);assert.equal(markup[q.id].solution.length,q.solution.steps.length);
  if(q.matchingLists)for(const side of ['left','right'])assert.equal(markup[q.id].matchingLists[side].length,q.matchingLists[side].length);
  for(const asset of q.assets){assert.ok(compiled.manifest.availableAssets.includes(asset.url));assert.ok(asset.alt.length>20);}
 }
 const grid=bundles[1].bundle.questions.find(q=>q.id==='2023_P2_Mathematics_Q16-v1');
 assert.equal((grid.statement.match(/Consider the/g)||[]).length,1);assert.equal(grid.assets.length,1);assert.ok(grid.assets[0].alt.includes('49'));
});

test('absent and explicitly empty source catalogs are no-ops',async()=>fixture(async tmp=>{
 assert.equal((await prepareContent(tmp,archive,[])).inputs.size,0);
 await mkdir(tmp+'/content');await writeFile(tmp+'/content/catalog.json',JSON.stringify({version:1,bankId:'vedaris-reviewed-jee-v1',bundles:[],papers:[],attributions:[],coverageNotes:[]}));
 assert.equal((await prepareContent(tmp,archive,[])).inputs.size,0);
}));

test('path traversal and duplicate source bundles fail closed',async()=>fixture(async tmp=>{
 await copyContent(tmp);await modify(tmp,'content/catalog.json',c=>c.bundles[0].path='../escape.json');
 await assert.rejects(prepareContent(tmp,archive,inventory),/direct JSON children/);
 await copyContent(tmp);await modify(tmp,'content/catalog.json',c=>c.bundles.push(c.bundles[0]));
 await assert.rejects(prepareContent(tmp,archive,inventory),/distinct direct JSON/);
}));

test('source symlinks and missing image inventory fail closed',async()=>fixture(async tmp=>{
 await copyContent(tmp);await rm(tmp+'/content/2023-p1.json');await symlink(root+'content/2023-p1.json',tmp+'/content/2023-p1.json');
 await assert.rejects(prepareContent(tmp,archive,inventory),/regular file/);
 await assert.rejects(prepareContent(root,archive,[]),/local build inventory/);
}));

test('invalid mathematical notation fails compilation rather than silently rendering broken content',async()=>fixture(async tmp=>{
 await copyContent(tmp);await modify(tmp,'content/2023-p1.json',b=>b.questions[0].statement='$\\notARealMathCommand{1}$');
 await assert.rejects(prepareContent(tmp,archive,inventory),/Math rendering failed/);
}));

test('HTML in source prose is escaped before publication',async()=>fixture(async tmp=>{
 await copyContent(tmp);await modify(tmp,'content/2023-p1.json',b=>b.questions[0].statement='<img src=x onerror=alert(1)> $x^2$');
 const result=await prepareContent(tmp,archive,inventory);const doc=JSON.parse(result.inputs.get('data/content/2023-p1.json'));const html=doc.markup[doc.bundle.questions[0].id].statement;
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('<math'));
}));

test('source reviews include real key evidence for all 102 questions',async()=>{
 const audit=JSON.parse(await readFile(root+'content/review-audit.json','utf8'));
 const questions=audit.papers.flatMap(p=>p.questions);assert.equal(questions.length,102);
 for(const q of questions){const check=q.answerCheck;assert.ok(check.matchesSource===true||check.matchesDataset===true,q.id);assert.ok(check.officialKeyVerified===true||check.matchesOfficialFinalKey===true,q.id);const url=check.officialFinalKeyUrl||check.answerKeyUrl||check.sourceUrl;assert.ok(url.startsWith('https://web.archive.org/web/20230618'),q.id);}
});
