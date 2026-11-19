import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {archiveStats, validateArchive} from '../src/archive/index.js';
import {planReadiness, validateImportPlan} from './import-plan.mjs';

try {
  if (process.argv.length > 4) throw new Error('Usage: node scripts/validate-archive.mjs [archive.json] [historical-import-plan.json]');
  const path = process.argv[2] ?? fileURLToPath(new URL('../data/archive.json', import.meta.url));
  const planPath = process.argv[3] ?? fileURLToPath(new URL('../content/historical-import-plan.json', import.meta.url));
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const errors = validateArchive(manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  const stats = archiveStats(manifest);
  let importPlan = null;
  let plan = null;
  try { plan = JSON.parse(await readFile(planPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' || process.argv[3]) throw error; }
  if (plan) {
    const planErrors = validateImportPlan(plan, manifest);
    if (planErrors.length) throw new Error(`Historical import plan: ${planErrors.join('\n')}`);
    importPlan = plan.papers.map(record => {
      const readiness = planReadiness(plan, manifest, record.paperId);
      return {paperId: record.paperId, stage: record.stage, publicationBlockers: readiness.publication.length, mockBlockers: readiness.mock.length, certification: readiness.certification};
    });
  }
  console.log(JSON.stringify({valid: true, ...stats, importPlan}, null, 2));
} catch (error) {
  console.error(`Archive validation failed: ${error.message}`);
  process.exitCode = 1;
}
