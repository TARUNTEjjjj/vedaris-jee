import { CHAPTERS } from '../questions/catalog.js';

/**
 * Learner-declared revision goals and dismissed suggestions, kept in this
 * browser only. The plan stores chapter IDs and timestamps; it never stores
 * answers, scores or recommendation text. Chapter IDs that a later content
 * version no longer knows are preserved (so nothing is silently deleted) and
 * reported as ignored by the recommendation engine.
 */
export const REVISION_PLAN_KEY = 'vedaris.revision-plan.v1';
export const MAX_GOALS = 12;
export const MAX_DISMISSED = 100;
const CHAPTER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = value => Number.isSafeInteger(value) && value > 0;
const known = id => CHAPTERS.some(chapter => chapter.id === id);

export function emptyRevisionPlan() { return { version: 1, goals: [], dismissed: [] }; }

/** Returns a clean copy, or null for unreadable data so callers can preserve it. */
export function restoreRevisionPlan(raw, now = Date.now()) {
  try {
    if (typeof raw === 'string') { if (raw.length > 50000) return null; raw = JSON.parse(raw); }
    if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.goals) || !Array.isArray(raw.dismissed) || raw.goals.length > MAX_GOALS || raw.dismissed.length > MAX_DISMISSED) return null;
    const limit = now + 60000;
    const goals = raw.goals.map(goal => {
      if (!object(goal) || typeof goal.chapter !== 'string' || goal.chapter.length > 60 || !CHAPTER_ID.test(goal.chapter) || !time(goal.addedAt) || goal.addedAt > limit) throw new Error('Invalid goal');
      return { chapter: goal.chapter, addedAt: goal.addedAt };
    });
    const dismissed = raw.dismissed.map(entry => {
      if (!object(entry) || typeof entry.chapter !== 'string' || entry.chapter.length > 60 || !CHAPTER_ID.test(entry.chapter) || typeof entry.signature !== 'string' || entry.signature.length > 200 || !time(entry.dismissedAt) || entry.dismissedAt > limit) throw new Error('Invalid dismissal');
      return { chapter: entry.chapter, signature: entry.signature, dismissedAt: entry.dismissedAt };
    });
    if (new Set(goals.map(goal => goal.chapter)).size !== goals.length || new Set(dismissed.map(entry => entry.chapter)).size !== dismissed.length) return null;
    return { version: 1, goals, dismissed };
  } catch { return null; }
}

function clean(plan, now) {
  const value = restoreRevisionPlan(plan, now);
  if (!value) throw new Error('The saved revision plan could not be read; it has been preserved');
  return value;
}

export function addRevisionGoal(plan, chapter, now = Date.now()) {
  const value = clean(plan, now);
  if (!known(chapter)) throw new Error('Choose a chapter from the chapter list');
  if (value.goals.some(goal => goal.chapter === chapter)) return value;
  if (value.goals.length >= MAX_GOALS) throw new Error(`Choose up to ${MAX_GOALS} revision goals. Remove one to add another.`);
  return { ...value, goals: [...value.goals, { chapter, addedAt: now }], dismissed: value.dismissed.filter(entry => entry.chapter !== chapter) };
}

export function removeRevisionGoal(plan, chapter, now = Date.now()) {
  const value = clean(plan, now);
  return { ...value, goals: value.goals.filter(goal => goal.chapter !== chapter) };
}

/** A dismissal applies only while the chapter's retained evidence signature is unchanged. */
export function dismissRecommendation(plan, chapter, signature, now = Date.now()) {
  const value = clean(plan, now);
  if (typeof chapter !== 'string' || !CHAPTER_ID.test(chapter) || typeof signature !== 'string' || !signature || signature.length > 200) throw new Error('Invalid recommendation');
  const dismissed = [...value.dismissed.filter(entry => entry.chapter !== chapter), { chapter, signature, dismissedAt: now }];
  return { ...value, dismissed: dismissed.slice(-MAX_DISMISSED) };
}

export function undismissRecommendation(plan, chapter, now = Date.now()) {
  const value = clean(plan, now);
  return { ...value, dismissed: value.dismissed.filter(entry => entry.chapter !== chapter) };
}
