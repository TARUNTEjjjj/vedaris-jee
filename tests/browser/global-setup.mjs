import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The gate checks the built release that would be deployed, never source files.
export default async function globalSetup() {
  const info = fileURLToPath(new URL('../../dist/build-info.json', import.meta.url));
  try { await access(info); }
  catch { throw new Error('dist/ is missing. Run `npm run test:browser` (which builds first) or `node scripts/build.mjs`.'); }
}
