import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const info = JSON.parse(await readFile(join(dist, 'build-info.json'), 'utf8'));
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
assert(paths.length<1000,'Release file budget exceeded');
let raw=0, encoded=0;
for(const [path,hash] of Object.entries(info.files)) {
  const bytes=await readFile(join(dist,path));
  assert(createHash('sha256').update(bytes).digest('hex')===hash,`Asset changed after build: ${path}`);
  assert(bytes.length<1024*1024,`Single asset exceeds 1 MiB launch budget: ${path}`);
  if(path.startsWith(info.release+'/')) {raw+=bytes.length;encoded+=Math.min(bytes.length,gzipSync(bytes).length);}
}
assert(encoded<250*1024,'Compressed complete offline release exceeds 250 KiB launch budget');
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
console.log(JSON.stringify({status:'pass',version:info.version,files:paths.length,completeOfflineReleaseBytes:raw,gzipEstimateBytes:encoded,externalRuntimeDependencies:0,serverFunctions:0,note:'Size estimate covers the complete offline bundle, including fonts. This is not a concurrency load test.'},null,2));
