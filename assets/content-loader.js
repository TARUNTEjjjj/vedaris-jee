import { createContentRegistry } from '../src/content/catalog.js';

export async function loadContentManifest() {
  const response=await fetch(new URL('../data/content/catalog.json',import.meta.url),{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('The reviewed question catalog could not be downloaded.');
  const manifest=await response.json();
  if(manifest.version!==1||typeof manifest.bankId!=='string'||!Array.isArray(manifest.bundles)||manifest.bundles.length>100||!Array.isArray(manifest.papers)||!Array.isArray(manifest.availableAssets)||!Number.isInteger(manifest.questionCount)||manifest.questionCount<0)throw new Error('The reviewed question catalog is invalid.');
  for(const bundle of manifest.bundles)if(!/^data\/content\/[a-z0-9-]+\.json$/.test(bundle.path)||!/^[a-f0-9]{64}$/.test(bundle.sha256))throw new Error('The question catalog contains an unsafe bundle path.');
  return manifest;
}

export async function loadContentBank(manifest,archive) {
  // Content is split by paper; verified bytes belong to this immutable release.
  const documents=await Promise.all(manifest.bundles.map(async descriptor=>{
    const response=await fetch(new URL(`../${descriptor.path}`,import.meta.url),{signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!response.ok)throw new Error('A reviewed paper could not be downloaded. Reconnect and try again.');
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>1024*1024)throw new Error('A question bundle exceeded its size limit.');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(hash!==descriptor.sha256)throw new Error('A paper did not pass its integrity check. Reload to try again.');
    const document=JSON.parse(new TextDecoder().decode(bytes));
    if(!document.bundle||!document.markup)throw new Error('A reviewed paper is incomplete.');
    return document;
  }));
  const registry=createContentRegistry({archive,bundles:documents.map(d=>d.bundle),papers:manifest.papers,availableAssets:manifest.availableAssets});
  if(registry.size!==manifest.questionCount)throw new Error('Question coverage does not match the published catalog.');
  const markup=Object.assign({},...documents.map(d=>d.markup));
  for(const question of registry.filterQuestions())if(!markup[question.id]||typeof markup[question.id].statement!=='string'||!Array.isArray(markup[question.id].solution))throw new Error('A question is missing its published mathematics or solution.');
  return {registry,markup};
}
