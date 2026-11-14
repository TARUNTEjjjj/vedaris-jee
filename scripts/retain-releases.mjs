import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PRODUCTION_ORIGIN = 'https://vedaris-jee.pages.dev';
export const MAX_DEPLOY_FILES = 18000;
export const MAX_RETAINED_BYTES = 500 * 1024 * 1024;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const VERSION = /^[a-f0-9]{20}$/;
const HASH = /^[a-f0-9]{64}$/;
const RESOURCE_FILES = new Set(['resources/index.html', 'resources/explorer.css', 'resources/explorer.mjs', 'resources/catalog.json']);
const MUTABLE_FILES = new Set(['index.html', '404.html', '_headers', 'manifest.webmanifest', 'sw.js', ...RESOURCE_FILES]);
const projectDist = fileURLToPath(new URL('../dist', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

/** Accept only the public paths emitted by this project's static builder. */
export function validateReleaseInfo(info) {
  assert(object(info) && typeof info.version === 'string' && VERSION.test(info.version) && info.release === `releases/${info.version}` && object(info.files), 'Invalid release manifest identity');
  const immutable = new Map(), versions = new Set();
  for (const [path, digest] of Object.entries(info.files)) {
    assert(typeof digest === 'string' && HASH.test(digest), `Invalid release digest: ${path}`);
    if (MUTABLE_FILES.has(path)) continue;
    const match = /^releases\/([a-f0-9]{20})\/(.+)$/.exec(path);
    assert(match, `Unsafe release path: ${path}`);
    const relative = match[2], segments = relative.split('/');
    assert(segments.every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part)) &&
      (['index.html', 'manifest.webmanifest'].includes(relative) || RESOURCE_FILES.has(relative) || /^(?:assets|src|data)\//.test(relative)), `Unsafe release path: ${path}`);
    assert(!segments.some(part => ['_worker.js', '_headers', '_redirects', 'functions'].includes(part)), `Unsafe release path: ${path}`);
    immutable.set(path, digest); versions.add(match[1]);
  }
  assert(versions.has(info.version), 'Release manifest omits its current immutable files');
  for (const version of versions) assert(immutable.has(`releases/${version}/index.html`), `Release ${version} has no shell inventory`);
  if (info.retainedVersions !== undefined) {
    assert(Array.isArray(info.retainedVersions) && new Set(info.retainedVersions).size === info.retainedVersions.length &&
      info.retainedVersions.every(version => typeof version === 'string' && VERSION.test(version) && version !== info.version && versions.has(version)), 'Invalid retained version inventory');
  }
  return {immutable, versions};
}

function productionOrigin(value) {
  const url = new URL(value);
  assert(url.origin === PRODUCTION_ORIGIN && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Retention requires the owned Vedaris production origin');
  return url.origin;
}

// Cloudflare Pages canonicalizes HTML requests; the hash still describes the
// physical .html file copied into dist, not an unexpected redirect response.
export function canonicalReleasePath(path) {
  return path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path.endsWith('.html') ? path.slice(0, -'.html'.length) : path;
}

async function responseBytes(response, maximum, label) {
  assert(response.status === 200 && !response.redirected, `${label}: HTTP ${response.status} or unexpected redirect`);
  const advertised = response.headers.get('content-length');
  if (advertised !== null) assert(/^\d+$/.test(advertised) && Number(advertised) <= maximum, `${label}: byte budget exceeded`);
  assert(response.body, `${label}: empty response body`);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert(size <= maximum, `${label}: byte budget exceeded`);
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

async function inventory(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(directory, {withFileTypes: true})) {
    assert(!item.isSymbolicLink(), 'Deployment must not contain symlinks');
    const path = prefix + item.name;
    if (item.isDirectory()) files.push(...await inventory(join(directory, item.name), `${path}/`));
    else { assert(item.isFile(), 'Deployment must contain only regular files'); files.push(path); }
  }
  return files;
}

/**
 * Carry every production immutable release into a fresh build. Download and
 * verify in a sibling staging directory before touching dist. The current
 * shell, worker, release identity and precache inventory are never replaced.
 */
export async function retainReleases({dist = projectDist, origin = PRODUCTION_ORIGIN, fetchImpl = globalThis.fetch,
  limits = {}} = {}) {
  dist = resolve(dist); origin = productionOrigin(origin);
  const maxFiles = limits.maxFiles ?? MAX_DEPLOY_FILES;
  const maxRetainedBytes = limits.maxRetainedBytes ?? MAX_RETAINED_BYTES;
  assert(Number.isSafeInteger(maxFiles) && maxFiles > 0 && maxFiles <= MAX_DEPLOY_FILES &&
    Number.isSafeInteger(maxRetainedBytes) && maxRetainedBytes >= 0 && maxRetainedBytes <= MAX_RETAINED_BYTES, 'Invalid retention budgets');
  const currentText = await readFile(join(dist, 'build-info.json'), 'utf8');
  const current = JSON.parse(currentText), local = validateReleaseInfo(current);
  const actualFiles = await inventory(dist);
  assert(actualFiles.length === Object.keys(current.files).length + 1 && actualFiles.every(path => path === 'build-info.json' || Object.hasOwn(current.files, path)), 'Deployment contains untracked files; run a fresh build');
  const controller = new AbortController();
  async function get(path, maximum) {
    const url = new URL(path, `${origin}/`).href;
    const response = await fetchImpl(url, {redirect: 'error', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])});
    assert(!response.url || response.url === url, `${path}: unexpected response URL`);
    return responseBytes(response, maximum, path);
  }
  const remote = validateReleaseInfo(JSON.parse((await get('build-info.json', MAX_MANIFEST_BYTES)).toString('utf8')));
  const mergedFiles = {...current.files};
  for (const [path, digest] of remote.immutable) {
    assert(!Object.hasOwn(mergedFiles, path) || mergedFiles[path] === digest, `Immutable release collision: ${path}`);
    mergedFiles[path] = digest;
  }
  assert(Object.keys(mergedFiles).length + 1 <= maxFiles, 'Retained deployment exceeds file budget; no old releases were evicted');
  const missing = [...remote.immutable].filter(([path]) => !local.immutable.has(path));
  // A version is immutable as a whole, including its file inventory. Never
  // merge additional files into a version whose directory is already present.
  for (const [path] of missing) assert(!local.versions.has(path.split('/')[1]), `Immutable release inventory collision: ${path}`);
  let retainedBytes = 0;
  for (const [path, digest] of Object.entries(current.files)) {
    const file = join(dist, path), stat = await lstat(file);
    assert(stat.isFile() && !stat.isSymbolicLink(), `Not a regular release file: ${path}`);
    const bytes = await readFile(file);
    assert(hash(bytes) === digest, `Local release digest mismatch: ${path}`);
    if (path.startsWith('releases/') && !path.startsWith(`${current.release}/`)) retainedBytes += bytes.length;
  }
  assert(retainedBytes <= maxRetainedBytes, 'Retained deployment exceeds byte budget; no old releases were evicted');
  const staging = await mkdtemp(join(dirname(dist), '.vedaris-retain-'));
  try {
    let next = 0;
    const workers = Array.from({length: Math.min(4, missing.length)}, async () => {
      while (!controller.signal.aborted && next < missing.length) {
        const [path, digest] = missing[next++];
        try {
          const bytes = await get(canonicalReleasePath(path), MAX_ASSET_BYTES);
          assert(hash(bytes) === digest, `Release digest mismatch: ${path}`);
          retainedBytes += bytes.length;
          assert(retainedBytes <= maxRetainedBytes, 'Retained deployment exceeds byte budget; no old releases were evicted');
          await mkdir(dirname(join(staging, path)), {recursive: true});
          await writeFile(join(staging, path), bytes);
        } catch (error) { controller.abort(error); throw error; }
      }
    });
    const results = await Promise.allSettled(workers);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw controller.signal.reason ?? failure.reason;
    // All network operations, hashes and capacity checks finished. Fail if a
    // concurrent build changed the destination while downloads were running.
    assert(await readFile(join(dist, 'build-info.json'), 'utf8') === currentText, 'Build changed during retention; run retention again');
    const addedVersions = [...new Set(missing.map(([path]) => path.split('/')[1]))].sort();
    const retainedVersions = [...new Set([...local.versions, ...remote.versions])].filter(version => version !== current.version).sort();
    const info = {...current, files: Object.fromEntries(Object.entries(mergedFiles).sort(([a], [b]) => a.localeCompare(b, 'en'))), retainedVersions};
    const stagedManifest = join(staging, 'build-info.json');
    await writeFile(stagedManifest, `${JSON.stringify(info, null, 2)}\n`);
    await mkdir(join(dist, 'releases'), {recursive: true});
    const moved = [];
    try {
      for (const version of addedVersions) {
        await rename(join(staging, 'releases', version), join(dist, 'releases', version));
        moved.push(version);
      }
      await rename(stagedManifest, join(dist, 'build-info.json'));
    } catch (error) {
      await Promise.all(moved.map(version => rm(join(dist, 'releases', version), {recursive: true, force: true})));
      throw error;
    }
    return {info, retainedVersions, retainedFiles: Object.keys(mergedFiles).filter(path => path.startsWith('releases/') && !path.startsWith(`${current.release}/`)).length, retainedBytes, downloadedFiles: missing.length};
  } finally { await rm(staging, {recursive: true, force: true}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length <= 3, 'Usage: node scripts/retain-releases.mjs [https://vedaris-jee.pages.dev]');
  const {info, ...summary} = await retainReleases({origin: process.argv[2] ?? PRODUCTION_ORIGIN});
  console.log(JSON.stringify({status: 'pass', currentVersion: info.version, ...summary}, null, 2));
}
