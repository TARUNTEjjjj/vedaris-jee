import {readFile, mkdir, writeFile, stat, readdir} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateQuestionCatalog} from '../src/archive/questions.js';

try {
  if (!(process.argv.length === 3 || (process.argv.length === 5 && process.argv[3] === '--catalog'))) throw new Error('Usage: node scripts/import-pyq.mjs reviewed-questions.json [--catalog archive.json]');
  const input = process.argv[2];
  const catalogPath = process.argv[4] ?? fileURLToPath(new URL('../data/archive.json', import.meta.url));
  if ((await stat(input)).size > 20 * 1024 * 1024) throw new Error('Import exceeds 20 MiB');
  if ((await stat(catalogPath)).size > 20 * 1024 * 1024) throw new Error('Source catalog exceeds 20 MiB');
  const bundle = JSON.parse(await readFile(input, 'utf8'));
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const errors = validateQuestionCatalog(bundle, catalog);
  if (errors.length) throw new Error(errors.join('\n'));
  const directory = fileURLToPath(new URL('../data/imports/validated/', import.meta.url));
  const filename = basename(input);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(filename)) throw new Error('Input filename must be a simple .json filename');
  let entries = [];
  try { entries = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const incomingIds = new Set(bundle.questions.map(q => q.id));
  const identity = q => JSON.stringify([q.paperId, q.subject, q.section, q.questionNumber]);
  const incomingIdentities = new Set(bundle.questions.map(identity));
  for (const entry of entries.filter(entry => entry.endsWith('.json'))) {
    const existing = JSON.parse(await readFile(join(directory, entry), 'utf8'));
    if (validateQuestionCatalog(existing, catalog).length) throw new Error(`Existing staged import ${entry} is invalid against the source catalog; resolve it before importing`);
    if (existing.questions.some(q => incomingIds.has(q.id) || incomingIdentities.has(identity(q)))) throw new Error(`Duplicate question identity already staged in ${entry}`);
  }
  // Nothing is created until the complete batch and existing staged identities pass.
  await mkdir(directory, {recursive: true});
  const output = join(directory, filename);
  await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, {encoding: 'utf8', flag: 'wx'});
  console.log(`Staged ${bundle.questions.length} validated questions at ${output}. These are not yet wired into the practice app.`);
} catch (error) {
  console.error(`PYQ import refused: ${error.message}`);
  process.exitCode = 1;
}
