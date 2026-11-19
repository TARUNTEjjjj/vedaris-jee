import test from 'node:test';
import assert from 'node:assert/strict';
import { mountRevision } from '../assets/revision.js';
import { revisionRecommendations } from '../src/learning/recommendations.js';
import { emptyRevisionPlan, addRevisionGoal, removeRevisionGoal } from '../src/learning/revision-plan.js';

const NOW = 1_790_000_000_000;

// Minimal stand-in for the page: every innerHTML write creates fresh elements,
// as a real re-render does, so stale references can be told apart.
function fakeRoot() {
  const root = { generation: 0, focused: null, elements: new Map() };
  const element = (selector, extra = {}) => {
    const el = { selector, generation: root.generation, textContent: '', listeners: {}, dataset: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, focus() { root.focused = this; }, ...extra };
    return el;
  };
  Object.defineProperty(root, 'innerHTML', {
    get() { return this.html; },
    set(html) {
      this.html = html; this.generation++;
      const status = element('[data-revision-status]');
      const form = element('[data-revision-goal-form]', { elements: { namedItem: () => ({ value: 'phy-rotation' }) } });
      const buttons = [...html.matchAll(/data-revision-action="([^"]+)" data-chapter="([^"]+)"/g)].map(([, action, chapter]) => element('[data-revision-action]', { dataset: { revisionAction: action, chapter } }));
      this.elements = new Map([['[data-revision-status]', status], ['[data-revision-goal-form]', form], ['buttons', buttons]]);
    },
  });
  root.querySelector = selector => root.elements.get(selector) ?? null;
  root.querySelectorAll = selector => selector === '[data-revision-action]' ? root.elements.get('buttons') : [];
  return root;
}

function mountLikeApp(root, state) {
  const render = () => mountRevision(root, {
    result: revisionRecommendations({ plan: state.plan, now: NOW }), plan: state.plan,
    onAddGoal: chapter => { state.plan = addRevisionGoal(state.plan, chapter, NOW); render(); return true; },
    onRemoveGoal: chapter => { state.plan = removeRevisionGoal(state.plan, chapter, NOW); render(); return true; },
    onDismiss: () => false, onUndismiss: () => false,
  });
  render();
}

test('revision actions announce their outcome and keep focus after the view re-renders', () => {
  const root = fakeRoot(), state = { plan: emptyRevisionPlan() };
  mountLikeApp(root, state);
  root.querySelector('[data-revision-goal-form]').listeners.submit({ preventDefault() {}, target: root.querySelector('[data-revision-goal-form]') });
  assert.deepEqual(state.plan.goals.map(goal => goal.chapter), ['phy-rotation']);
  const status = root.querySelector('[data-revision-status]');
  assert.equal(status.generation, root.generation, 'status region is the one currently rendered');
  assert.equal(status.textContent, 'Goal added.');
  assert.equal(root.focused, status, 'focus moves to the live status instead of the removed button');
  assert.match(root.innerHTML, /data-revision-status role="status" aria-live="polite" tabindex="-1"/);

  root.querySelectorAll('[data-revision-action]').find(button => button.dataset.revisionAction === 'remove-goal').listeners.click();
  assert.equal(state.plan.goals.length, 0);
  assert.equal(root.querySelector('[data-revision-status]').textContent, 'Goal removed.');
  assert.equal(root.focused, root.querySelector('[data-revision-status]'));
});

test('a rejected revision change is reported without re-rendering', () => {
  const root = fakeRoot();
  mountRevision(root, { result: revisionRecommendations({ plan: emptyRevisionPlan(), now: NOW }), plan: emptyRevisionPlan(), onAddGoal: () => false });
  const generation = root.generation;
  root.querySelector('[data-revision-goal-form]').listeners.submit({ preventDefault() {}, target: root.querySelector('[data-revision-goal-form]') });
  assert.equal(root.generation, generation);
  assert.match(root.querySelector('[data-revision-status]').textContent, /could not be saved/);
});
