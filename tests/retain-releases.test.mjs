import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {retainReleases, canonicalReleasePath, PRODUCTION_ORIGIN, MAX_ASSET_BYTES} from '../scripts/retain-releases.mjs';
import {publicResourceFiles} from '../scripts/stage-resource-explorer.mjs';

const A='aaaaaaaaaaaaaaaaaaaa', B='bbbbbbbbbbbbbbbbbbbb', C='cccccccccccccccccccc', D='dddddddddddddddddddd';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2)+'\n';
function releaseFiles(version) {
  const prefix=`releases/${version}`;
  return {[`${prefix}/index.html`]:`<html>${prefix}/assets/app.js</html>`,
    [`${prefix}/assets/app.js`]:"const archive = new URL('../data/archive.json',import.meta.url);\n",
    [`${prefix}/assets/style.css`]:'body{color:black}\n'};
}
function manifest(version, contents, retainedVersions) {
  return {version, release:`releases/${version}`, files:Object.fromEntries(Object.entries(contents).map(([path,body])=>[path,hash(body)])),
    precacheFiles:3,precachePaths:Object.keys(releaseFiles(version)),...(retainedVersions?{retainedVersions}:{})};
}
async function fixture(version=C) {
  const root=await mkdtemp(join(tmpdir(),'vedaris-retention-')), dist=join(root,'dist');
  const appVersion=hash('application-'+version),meta=`<meta name="app-version" content="${appVersion}">`;
  const contents={...releaseFiles(version),
    'index.html':`<html>${meta}releases/${version}/assets/app.js</html>`,
    'resources/index.html':`<html>${meta}Saved library</html>`,
    'app-version.json':json({schemaVersion:1,project:'vedaris-jee',version:appVersion}),
    'sw.js':'// The new worker must remain untouched.\n',
    '404.html':meta+'<h1>Not found</h1>',
    'manifest.webmanifest':'{}',
    '_headers':"/*\n  Content-Security-Policy: script-src 'self'\n/releases/*\n  Cache-Control: public, max-age=31536000, immutable\n/app-version.json\n  Cache-Control: no-store\n"};
  const info=manifest(version,contents);
  for(const [path,body] of Object.entries({...contents,'build-info.json':json(info)})){
    await mkdir(dirname(join(dist,path)),{recursive:true});await writeFile(join(dist,path),body);
  }
  return {root,dist,info,contents,cleanup:()=>rm(root,{recursive:true,force:true})};
}
async function snapshot(directory,prefix='') {
  const out={};
  for(const item of await readdir(directory,{withFileTypes:true})) {
    const path=prefix+item.name;
    if(item.isDirectory())Object.assign(out,await snapshot(join(directory,item.name),path+'/'));
    else out[path]=hash(await readFile(join(directory,item.name)));
  }
  return out;
}
function network(info,contents,{failure,delay=false}={}) {
  const calls=[];let active=0,maximum=0;
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
    assert.equal(new URL(url).origin,PRODUCTION_ORIGIN);
    active++;maximum=Math.max(maximum,active);
    try {
      if(delay)await new Promise(resolve=>setTimeout(resolve,2));
      const path=new URL(url).pathname.slice(1);
      if(path==='build-info.json')return new Response(json(info));
      if(failure)return failure(path);
      const physical=Object.keys(contents).find(key=>canonicalReleasePath(key)===path);
      return physical===undefined?new Response('Not found',{status:404}):new Response(contents[physical]);
    } finally {active--;}
  };
  return {fetchImpl,calls,get maximum(){return maximum;}};
}

test('retains every prior release, uses canonical shell URLs, and leaves current shell/SW untouched',async()=>{
  const f=await fixture();
  try {
    const contents={...releaseFiles(A),...releaseFiles(B),[`releases/${B}/data/content/paper.json`]:'{"questions":[1]}',
      [`releases/${A}/assets/content/diagram.png`]:'figure bytes','sw.js':'// old worker must not replace current'};
    const remote=manifest(B,contents,[A]), net=network(remote,contents,{delay:true});
    const result=await retainReleases({dist:f.dist,fetchImpl:net.fetchImpl});
    assert.deepEqual(result.retainedVersions,[A,B]);assert.equal(result.downloadedFiles,8);
    assert.ok(net.maximum<=4);assert.equal(net.maximum,4);
    assert.ok(net.calls.every(call=>!new URL(call.url).pathname.endsWith('.html')));
    assert.ok(net.calls.every(call=>!new URL(call.url).pathname.endsWith('/sw.js')));
    const info=JSON.parse(await readFile(join(f.dist,'build-info.json')));
    assert.equal(info.version,C);assert.equal(info.release,f.info.release);
    assert.deepEqual(info.precachePaths,f.info.precachePaths);assert.equal(info.precacheFiles,f.info.precacheFiles);
    for(const [path,body] of Object.entries(f.contents))assert.equal(await readFile(join(f.dist,path),'utf8'),body,path);
    for(const [path,body] of Object.entries(contents).filter(([path])=>path.startsWith('releases/')))assert.equal(await readFile(join(f.dist,path),'utf8'),body,path);
    const again=network(remote,contents);
    assert.equal((await retainReleases({dist:f.dist,fetchImpl:again.fetchImpl})).downloadedFiles,0);
    assert.equal(again.calls.length,1);
    // A following deployment must preserve both older generations and this one.
    const next=await fixture(D);
    try {
      const allContents={};for(const path of Object.keys(info.files))allContents[path]=await readFile(join(f.dist,path));
      const following=await retainReleases({dist:next.dist,fetchImpl:network(info,allContents).fetchImpl});
      assert.deepEqual(following.retainedVersions,[A,B,C]);
      assert.equal(await readFile(join(next.dist,`releases/${A}/assets/content/diagram.png`),'utf8'),'figure bytes');
    }finally{await next.cleanup();}
  }finally{await f.cleanup();}
});

test('retains the complete old library shell without replacing current mutable aliases',async()=>{
  const f=await fixture();
  try {
    const contents={...releaseFiles(A)};
    for(const file of publicResourceFiles) {
      contents[`releases/${A}/resources/${file}`]='Old public resource '+file;
      contents[`resources/${file}`]='Mutable alias must not be copied';
    }
    const net=network(manifest(A,contents),contents);
    const result=await retainReleases({dist:f.dist,fetchImpl:net.fetchImpl});
    assert.equal(result.downloadedFiles,3+publicResourceFiles.length);
    for(const file of publicResourceFiles) {
      assert.equal(await readFile(join(f.dist,`releases/${A}/resources/${file}`),'utf8'),'Old public resource '+file);
      if(file==='index.html') assert.equal(await readFile(join(f.dist,'resources',file),'utf8'),f.contents['resources/index.html']);
      else await assert.rejects(readFile(join(f.dist,'resources',file)),{code:'ENOENT'});
    }
    assert.ok(net.calls.every(call=>!new URL(call.url).pathname.startsWith('/resources/')));
  }finally{await f.cleanup();}
});

test('corruption, redirects, HTTP failures and network errors leave dist and its manifest unchanged',async()=>{
  const failures=[
    {pattern:/digest mismatch/,response:()=>new Response('corrupt bytes')},
    {pattern:/HTTP 302/,response:()=>new Response('',{status:302,headers:{location:'/login'}})},
    {pattern:/unexpected redirect/,response:()=>{const r=new Response('redirected');Object.defineProperty(r,'redirected',{value:true});return r;}},
    {pattern:/unexpected response URL/,response:()=>{const r=new Response('wrong origin');Object.defineProperty(r,'url',{value:'https://elsewhere.test/'});return r;}},
    {pattern:/HTTP 404/,response:()=>new Response('missing',{status:404})},
    {pattern:/network unavailable/,response:()=>{throw new Error('network unavailable');}},
    {pattern:/byte budget/,response:()=>new Response('huge',{headers:{'content-length':String(MAX_ASSET_BYTES+1)}})},
  ];
  for(const failure of failures){
    const f=await fixture();
    try{
      const before=await snapshot(f.dist),contents=releaseFiles(B),info=manifest(B,contents);
      await assert.rejects(retainReleases({dist:f.dist,fetchImpl:network(info,contents,{failure:failure.response}).fetchImpl}),failure.pattern);
      assert.deepEqual(await snapshot(f.dist),before);
      assert.deepEqual(await readdir(f.root),['dist']);
    }finally{await f.cleanup();}
  }
});

test('unsafe manifests fail before fetching any old assets or mutating dist',async()=>{
  const invalidPaths=[`releases/${B}/../sw.js`,`releases/${B}/assets/../../sw.js`,`releases/${B}/assets/%2e%2e/secret`,
    `releases/${B}/assets\\secret.js`,`releases/${B}/assets//bad.js`,`releases/${B}/_worker.js`,
    `releases/${B}/assets/_headers`,`releases/not-a-version/index.html`,'https://elsewhere.test/file','unknown-root.json'];
  for(const path of invalidPaths){
    const f=await fixture();
    try{
      const before=await snapshot(f.dist),contents=releaseFiles(B),info=manifest(B,contents);
      info.files[path]=hash('bad');const net=network(info,contents);
      await assert.rejects(retainReleases({dist:f.dist,fetchImpl:net.fetchImpl}),/Unsafe release path/);
      assert.equal(net.calls.length,1);assert.deepEqual(await snapshot(f.dist),before);
    }finally{await f.cleanup();}
  }
  const f=await fixture();
  try{
    const contents=releaseFiles(B),info=manifest(B,contents);info.files[`releases/${B}/index.html`]='not-a-digest';
    await assert.rejects(retainReleases({dist:f.dist,fetchImpl:network(info,contents).fetchImpl}),/Invalid release digest/);
    await assert.rejects(retainReleases({dist:f.dist,origin:'https://preview.vedaris-jee.pages.dev',fetchImpl:()=>{throw new Error('must not fetch');}}),/owned Vedaris production/);
  }finally{await f.cleanup();}
});

test('a late download failure discards already verified staging files without changing the manifest',async()=>{
  const f=await fixture();
  try{
    const before=await snapshot(f.dist),contents=releaseFiles(B),late=`releases/${B}/data/content/late-paper.json`;
    contents[late]='{"questions":[]}';
    const info=manifest(B,contents);let successful=0;
    const fetchImpl=async(url,options)=>{
      assert.equal(options.redirect,'error');
      const path=new URL(url).pathname.slice(1);
      if(path==='build-info.json')return new Response(json(info));
      if(path===late){await new Promise(resolve=>setTimeout(resolve,15));return new Response('missing',{status:404});}
      const physical=Object.keys(contents).find(key=>canonicalReleasePath(key)===path);
      successful++;return new Response(contents[physical]);
    };
    await assert.rejects(retainReleases({dist:f.dist,fetchImpl}),/HTTP 404/);
    assert.equal(successful,3);assert.deepEqual(await snapshot(f.dist),before);
    assert.deepEqual(await readdir(f.root),['dist']);
  }finally{await f.cleanup();}
});

test('file and byte limits stop retention without evicting or partially publishing an old release',async()=>{
  for(const limits of [{maxFiles:10},{maxRetainedBytes:1}]){
    const f=await fixture();
    try{
      const before=await snapshot(f.dist),contents=releaseFiles(B),info=manifest(B,contents),net=network(info,contents);
      await assert.rejects(retainReleases({dist:f.dist,limits,fetchImpl:net.fetchImpl}),/budget; no old releases were evicted/);
      assert.deepEqual(await snapshot(f.dist),before);assert.deepEqual(await readdir(f.root),['dist']);
      if(limits.maxFiles)assert.equal(net.calls.length,1);
    }finally{await f.cleanup();}
  }
});

test('immutable hash and inventory collisions cannot replace current release assets',async()=>{
  for(const extraFile of [false,true]){
    const f=await fixture();
    try{
      const before=await snapshot(f.dist),contents={...releaseFiles(C)};
      if(extraFile)contents[`releases/${C}/assets/added.js`]='extra';else contents[`releases/${C}/assets/app.js`]='changed';
      await assert.rejects(retainReleases({dist:f.dist,fetchImpl:network(manifest(C,contents),contents).fetchImpl}),/Immutable release (?:inventory )?collision/);
      assert.deepEqual(await snapshot(f.dist),before);
    }finally{await f.cleanup();}
  }
});

test('release checks permit retained generations above the current 1000-file budget without expanding precache',async()=>{
  const f=await fixture();
  try{
    const contents=releaseFiles(B);
    for(let i=0;i<1001;i++)contents[`releases/${B}/assets/content/figure-${i}.png`]='test figure';
    await retainReleases({dist:f.dist,fetchImpl:network(manifest(B,contents),contents).fetchImpl});
    await mkdir(join(f.root,'scripts'));
    for(const name of ['check-release.mjs','retain-releases.mjs'])await writeFile(join(f.root,'scripts',name),await readFile(new URL(`../scripts/${name}`,import.meta.url)));
    const result=JSON.parse(execFileSync(process.execPath,[join(f.root,'scripts/check-release.mjs')],{encoding:'utf8'}));
    assert.equal(result.status,'pass');assert.ok(result.files>1000);
    assert.deepEqual(result.retainedVersions,[B]);assert.ok(result.retainedBytes>0);
    assert.equal(result.offlineShellBytes,Object.values(releaseFiles(C)).reduce((n,body)=>n+Buffer.byteLength(body),0));
  }finally{await f.cleanup();}
});
