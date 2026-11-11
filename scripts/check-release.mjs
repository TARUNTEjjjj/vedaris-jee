import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {validateReleaseInfo, MAX_DEPLOY_FILES, MAX_RETAINED_BYTES, MAX_ASSET_BYTES} from './retain-releases.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const info = JSON.parse(await readFile(join(dist, 'build-info.json'), 'utf8'));
const {versions} = validateReleaseInfo(info);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function walk(directory) {
  const paths=[];
  for(const item of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,item.name);
    if(item.isDirectory())paths.push(...await walk(path));else paths.push(path);
  }
  return paths;
}
const paths=await walk(dist);
assert(!paths.some(p=>p.endsWith('_worker.js')||p.includes('/functions/')), 'Static release must not invoke Workers/Functions');
const retained = path => path.startsWith('releases/') && !path.startsWith(info.release+'/');
assert(paths.length<=MAX_DEPLOY_FILES,'Total deployment file budget exceeded');
assert(paths.filter(path=>!retained(path.slice(dist.length+1))).length<1000,'Current release file budget exceeded');
assert(JSON.stringify([...(info.retainedVersions??[])].sort())===JSON.stringify([...versions].filter(version=>version!==info.version).sort()),'Retained version inventory mismatch');
assert(paths.length===Object.keys(info.files).length+1 && paths.every(path=>path===join(dist,'build-info.json') || Object.hasOwn(info.files,path.slice(dist.length+1))),'Deployment contains untracked files');
let raw=0, encoded=0, offlineRaw=0, offlineEncoded=0, retainedBytes=0;
assert(Array.isArray(info.precachePaths) && info.precachePaths.length===info.precacheFiles,'Missing bounded offline inventory');
const precache=new Set(info.precachePaths);
for(const [path,hash] of Object.entries(info.files)) {
  const bytes=await readFile(join(dist,path));
  assert(createHash('sha256').update(bytes).digest('hex')===hash,`Asset changed after build: ${path}`);
  assert(bytes.length<(retained(path)?MAX_ASSET_BYTES+1:1024*1024),`Single asset exceeds release budget: ${path}`);
  if(retained(path))retainedBytes+=bytes.length;
  if(path.startsWith(info.release+'/')) {raw+=bytes.length;encoded+=Math.min(bytes.length,gzipSync(bytes).length);}
  if(precache.has(path)) {offlineRaw+=bytes.length;offlineEncoded+=Math.min(bytes.length,gzipSync(bytes).length);}
}
assert(offlineEncoded<2*1024*1024,'Compressed application offline cache exceeds 2 MiB budget');
assert(retainedBytes<=MAX_RETAINED_BYTES,'Retained release byte budget exceeded');
assert([...precache].every(path=>Object.hasOwn(info.files,path) && !path.includes('/assets/content/') && (!path.includes('/data/content/') || path.endsWith('/catalog.json'))),'Paper content must load on demand');
const html=await readFile(join(dist,'index.html'),'utf8');
assert(!/https:\/\/(fonts\.googleapis|fonts\.gstatic)/.test(html),'External font dependency in shell');
const css=await readFile(join(dist,info.release,'assets/style.css'),'utf8');
assert(!/@import\s+url|https:\/\//.test(css),'Styles must be self-hosted');
const app=await readFile(join(dist,info.release,'assets/app.js'),'utf8');
assert(app.includes("new URL('../data/archive.json',import.meta.url)"),'Archive fetch must be release-relative');
const headers=await readFile(join(dist,'_headers'),'utf8');
assert(headers.includes('Cache-Control: public, max-age=31536000, immutable'),'Immutable release headers missing');
assert(headers.includes("script-src 'self'"),'Script security policy missing');
assert(!paths.some(p=>/\/(?:tests|docs|\.git|\.openai|imports)\//.test(p.slice(dist.length))), 'Private source or staged content leaked into release');
console.log(JSON.stringify({status:'pass',version:info.version,files:paths.length,totalReleaseBytes:raw,totalGzipEstimateBytes:encoded,offlineShellBytes:offlineRaw,offlineShellGzipEstimateBytes:offlineEncoded,retainedVersions:info.retainedVersions??[],retainedBytes,externalRuntimeDependencies:0,serverFunctions:0,note:'The app shell is precached; reviewed papers and figures are integrity-checked and cached on use. Retained releases preserve older open tabs without expanding the current offline cache. This is not a concurrency load test.'},null,2));
