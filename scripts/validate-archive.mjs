import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {archiveStats, validateArchive} from '../src/archive/index.js';

try {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/validate-archive.mjs [archive.json]');
  const path = process.argv[2] ?? fileURLToPath(new URL('../data/archive.json', import.meta.url));
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const errors = validateArchive(manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  const stats = archiveStats(manifest);
  console.log(JSON.stringify({valid: true, ...stats}, null, 2));
} catch (error) {
  console.error(`Archive validation failed: ${error.message}`);
  process.exitCode = 1;
}
