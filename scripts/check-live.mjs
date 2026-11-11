import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
const origin=new URL(process.argv[2]||'https://vedaris-jee.pages.dev');
if(origin.protocol!=='https:'||!(origin.hostname==='vedaris-jee.pages.dev'||/^[a-f0-9]+\.vedaris-jee\.pages\.dev$/.test(origin.hostname))||origin.username||origin.password||origin.port)throw new Error('Use only the owned Vedaris Cloudflare production or deployment hostname');
const local=JSON.parse(await readFile(new URL('../dist/build-info.json',import.meta.url),'utf8'));
const timings=[];
let requests=0;
async function get(path){const start=performance.now();const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000),redirect:'error'});const body=new Uint8Array(await response.arrayBuffer());requests++;timings.push(performance.now()-start);if(response.status!==200)throw new Error(`${path}: HTTP ${response.status}`);return {response,body};}
const remote=JSON.parse(new TextDecoder().decode((await get('/build-info.json')).body));
if(remote.version!==local.version)throw new Error(`Expected ${local.version}, received ${remote.version}`);
const inventory = files => JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')));
if(inventory(remote.files)!==inventory(local.files))throw new Error('Production file inventory differs from the checked deployment artifact');
const canonical = path => path.endsWith('index.html') ? path.slice(0,-10) : path.endsWith('.html') ? path.slice(0,-5) : path;
const paths=Object.keys(remote.files).filter(p=>p!=='_headers');
const failures=[];
for(let offset=0;offset<paths.length;offset+=5)await Promise.all(paths.slice(offset,offset+5).map(async path=>{try{const {body,response}=await get('/'+canonical(path));if(createHash('sha256').update(body).digest('hex')!==remote.files[path])throw new Error('content hash mismatch');const cache=response.headers.get('cache-control')||'';if(path.startsWith('releases/')&&!cache.includes('immutable'))throw new Error('immutable cache header missing');if(['index.html','sw.js'].includes(path)&&!cache.includes('no-cache'))throw new Error('mutable entry point must revalidate');if(!response.headers.get('content-security-policy'))throw new Error('security headers missing');}catch(e){failures.push({path,error:e.message});}}));
const shell=await get('/');
if(!new TextDecoder().decode(shell.body).includes(remote.release+'/assets/app.js'))failures.push({path:'/',error:'root document references the wrong release'});
// Bounded smoke traffic: 60 reads, at most 5 in flight. This is not 10,000 users.
for(let round=0;round<12;round++)await Promise.all(Array.from({length:5},(_,i)=>get(i%2?'/':'/'+remote.release+'/assets/app.js')));
const missing=await fetch(new URL('/vedaris-release-check-not-found',origin),{signal:AbortSignal.timeout(15000),redirect:'manual'});requests++;
if(missing.status!==404)failures.push({path:'missing route',error:`Expected 404, received ${missing.status}`});
const sorted=timings.toSorted((a,b)=>a-b);
const result={checkedAt:new Date().toISOString(),origin:origin.origin,version:remote.version,status:failures.length?'fail':'pass',requests,concurrencyLimit:5,measuredFrom:'single developer machine',p50Ms:Math.round(sorted[Math.floor(sorted.length*.5)]),p95Ms:Math.round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]),failures,note:'Asset integrity, headers, routing and bounded HTTP smoke check only. This does not verify 10,000 concurrent users.'};
console.log(JSON.stringify(result,null,2));
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(result,null,2)+'\n');
if(failures.length)process.exitCode=1;
