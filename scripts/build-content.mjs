import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createContentRegistry } from '../src/content/catalog.js';
import { renderStudyText } from './render-math.mjs';

const MAX_BYTES = 1024 * 1024;
const BANK_ID = 'vedaris-reviewed-jee-v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value)}\n`);
const empty = () => ({inputs: new Map(), counts: {questions: 0, papers: 0, fullPapers: 0, years: 0, assets: 0}, manifest: null});

async function readJSON(root, path, {optional = false} = {}) {
  let stat;
  try { stat = await lstat(join(root, path)); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error(`Content source must be a regular file of at most 1 MiB: ${path}`);
  return JSON.parse(await readFile(join(root, path), 'utf8'));
}

function compileQuestion(question) {
  const compile = (value, field) => {
    try { return renderStudyText(value); }
    catch (error) { throw new Error(`Math rendering failed for ${question.id}.${field}: ${error.message}`, {cause: error}); }
  };
  const markup = {
    statement: compile(question.statement, 'statement'),
    options: Object.fromEntries((question.options ?? []).map(option => [option.id, compile(option.text, `options.${option.id}`)])),
    solution: question.solution.steps.map((step, index) => compile(step, `solution.${index}`)),
  };
  if (question.matchingLists) markup.matchingLists = Object.fromEntries(['left', 'right'].map(side => [side, question.matchingLists[side].map(entry => ({label: entry.label, html: compile(entry.text, `matchingLists.${side}.${entry.label}`)}))]));
  return markup;
}

/**
 * Compile only explicitly curated source bundles. This does not fetch content,
 * infer reviews, mutate source files, or make an incomplete paper practice-ready.
 * The caller supplies its verified local asset inventory and hashes the outputs
 * into the same immutable release as the application shell.
 */
export async function prepareContent(root, archive, availableAssets = []) {
  root = resolve(root);
  const catalog = await readJSON(root, 'content/catalog.json', {optional: true});
  if (catalog === null) return empty();
  if (catalog.version !== 1 || catalog.bankId !== BANK_ID || !Array.isArray(catalog.bundles) || !Array.isArray(catalog.papers) || !Array.isArray(catalog.attributions) || !Array.isArray(catalog.coverageNotes)) throw new Error('Invalid reviewed content source catalog');
  if (!catalog.bundles.length) {
    if (catalog.papers.length) throw new Error('An empty content catalog cannot declare full-paper configurations');
    return empty();
  }
  if (!Array.isArray(availableAssets) || catalog.bundles.length > 200) throw new Error('Invalid content inventory or excessive bundle count');
  const paths = new Set(), paperIds = new Set(), sources = [];
  for (const entry of catalog.bundles) {
    if (!entry || typeof entry.path !== 'string' || !/^content\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/.test(entry.path) || paths.has(entry.path)) throw new Error('Content bundle paths must be distinct direct JSON children of content/');
    paths.add(entry.path);
    const bundle = await readJSON(root, entry.path);
    if (!bundle || !Array.isArray(bundle.questions) || !bundle.questions.length || bundle.questions.length > 500) throw new Error(`Expected a nonempty, bounded paper bundle: ${entry.path}`);
    const ids = new Set(bundle.questions.map(question => question.paperId));
    if (ids.size !== 1 || paperIds.has([...ids][0])) throw new Error('Each content bundle must contain exactly one distinct source paper');
    paperIds.add([...ids][0]);
    sources.push({path: entry.path.replace(/^content\//, 'data/content/'), bundle});
  }
  const usedAssets = [...new Set(sources.flatMap(({bundle}) => bundle.questions.flatMap(question => (question.assets ?? []).map(asset => asset.url))))].sort();
  const inventory = new Set(availableAssets);
  for (const path of usedAssets) if (!/^assets\/content\/[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(path) || path.split('/').some(part => part === '.' || part === '..') || !inventory.has(path)) throw new Error(`Content image must be in the local build inventory: ${path}`);
  const registry = createContentRegistry({archive, bundles: sources.map(item => item.bundle), papers: catalog.papers, availableAssets: usedAssets});
  // Keep the full configuration once. Dashboard summaries do not need a
  // second copy of section instructions, question IDs, and review evidence.
  const paperSummaries = registry.listPapers().map(({sections,orderedQuestionIds,review,...summary}) => summary);
  if (catalog.papers.some(paper => !paperIds.has(paper.paperId))) throw new Error('A configured content paper has no source bundle');
  const inputs = new Map(), bundles = [];
  for (const {path, bundle} of sources) {
    const markup = Object.fromEntries(bundle.questions.map(question => [question.id, compileQuestion(question)]));
    const bytes = jsonBytes({bundle, markup});
    if (bytes.length > MAX_BYTES) throw new Error(`Compiled paper exceeds the 1 MiB budget: ${path}`);
    inputs.set(path, bytes);
    bundles.push({path, sha256: digest(bytes)});
  }
  const questions = registry.filterQuestions();
  const years = [...new Set(questions.map(question => question.year))].sort((a, b) => a - b);
  const chapterCounts = Object.fromEntries([...new Set(questions.flatMap(question => question.chapters))].sort().map(id => [id, questions.filter(question => question.chapters.includes(id)).length]));
  const manifest = {version: 1, bankId: BANK_ID, questionCount: registry.size, years, papers: catalog.papers, paperSummaries, bundles, availableAssets: usedAssets, chapterCounts, coverageByYear:registry.coverageByYear(), attributions: catalog.attributions, coverageNotes: catalog.coverageNotes};
  const manifestBytes = jsonBytes(manifest);
  if (manifestBytes.length > MAX_BYTES) throw new Error('Compiled content catalog exceeds the 1 MiB budget');
  inputs.set('data/content/catalog.json', manifestBytes);
  return {inputs, counts: {questions: registry.size, papers: paperSummaries.length, fullPapers: paperSummaries.filter(paper => paper.complete).length, years: years.length, assets: usedAssets.length}, manifest};
}
