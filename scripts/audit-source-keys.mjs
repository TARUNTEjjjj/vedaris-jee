import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';

// Reproducible form of the inline check completed on 2026-11-11.
// This validates runtime scoring against the pinned dataset's official-key
// transcription; it does not replace the separate visual paper/key reviews.
if(process.argv.length!==3)throw new Error('Usage: node scripts/audit-source-keys.mjs /path/to/pinned/questions.jsonl');
const root=fileURLToPath(new URL('../',import.meta.url));
const sourcePath=resolve(process.argv[2]);
const {createContentRegistry,gradeContentQuestion}=await import(pathToFileURL(join(root,'src/content/catalog.js')));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceBytes=await readFile(sourcePath);
if(sha256(sourceBytes)!=='d5e8dd3a43544e36a4889035c032516f670cc02e768d3b9958e9e42e8c9900c9')throw new Error('Source does not match the reviewed dataset revision');
const raw=sourceBytes.toString('utf8').trim().split('\n').map(JSON.parse);
const archive=JSON.parse(await readFile(join(root,'data/archive.json')));
const catalog=JSON.parse(await readFile(join(root,'content/catalog.json')));
const bundles=await Promise.all(catalog.bundles.map(async descriptor=>JSON.parse(await readFile(join(root,descriptor.path)))));
const assets=[...new Set(bundles.flatMap(bundle=>bundle.questions.flatMap(question=>question.assets.map(asset=>asset.url))))];
const registry=createContentRegistry({archive,bundles,papers:catalog.papers,availableAssets:assets});
const key=value=>JSON.stringify([...value].sort());
const variants=answer=>answer.kind==='any_of'?answer.value.flatMap(variants):[answer];
let checks=0;
for(const source of raw){
  const question=registry.getQuestion(source.id+'-v1'),accepted=variants(source.correct_answer);
  if(question.type==='multiple'||question.type==='single'){
    const choices=question.options.map(option=>option.id);
    const responses=question.type==='single'?choices:Array.from({length:2**choices.length},(_,mask)=>choices.filter((_,index)=>mask&(1<<index)));
    for(const response of responses){
      const expectedFullCredit=accepted.some(answer=>answer.kind==='option'&&key(answer.value)===key(Array.isArray(response)?response:[response]));
      const result=gradeContentQuestion(question,response);
      if((result.score===question.marking.correct)!==expectedFullCredit)throw new Error(question.id+JSON.stringify({response,result,expectedFullCredit}));
      checks++;
    }
  }else if(question.type==='numerical'){
    for(const answer of accepted){
      const values=answer.kind==='range'?[answer.min,answer.max]:[answer.value];
      for(const value of values){
        if(gradeContentQuestion(question,String(value)).score!==question.marking.correct)throw new Error(question.id+' '+value);
        checks++;
      }
    }
  }else if(question.type==='bonus'){
    if(source.correct_answer.kind!=='bonus'||gradeContentQuestion(question,'').status!=='bonus')throw new Error(question.id);
    checks++;
  }
}
console.log(JSON.stringify({
  status:'pass',checkedAt:new Date().toISOString(),reviewer:'Codex (AI-assisted verification; not human editorial certification)',
  source:{url:'https://huggingface.co/datasets/propar2750/jee-advanced',revision:'2580e96f1e74343e1d478509187f16fe58dbab85',file:'jsonl/questions.jsonl',sha256:sha256(sourceBytes)},
  questions:raw.length,checks,failures:0,
  reproduce:'node scripts/audit-source-keys.mjs /path/to/pinned/questions.jsonl',
  method:'Enumerate every multiple-choice response set and each single-choice option, comparing full-credit status with all pinned source alternatives. Check every discrete numeric alternative and each inclusive interval endpoint. Verify blank responses receive official bonus status for dropped questions.',
  limits:'This compares the pinned source key transcription to runtime scoring. It does not independently certify all statements, mathematical derivations, partial-mark values, numerical gaps or human review; those have separate tests and source-review evidence.',
},null,2));
