// Practice scoring is explicit on each item; it is not a universal JEE marking scheme.
const LIMIT = 96;
const gcd = (a, b) => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a; };

/** Parse a finite decimal or one integer fraction exactly, without eval or floating-point rounding. */
export function parseNumber(value) {
  if (typeof value !== 'string' || value.length > LIMIT) return null;
  const s = value.trim();
  let n, d;
  if (/^[+-]?\d+\s*\/\s*[+-]?\d+$/.test(s)) {
    const [a, b] = s.split('/').map(x => x.trim());
    n = BigInt(a); d = BigInt(b);
    if (!d) return null;
  } else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) {
    const negative = s.startsWith('-');
    const [whole, frac = ''] = s.replace(/^[+-]/, '').split('.');
    d = 10n ** BigInt(frac.length);
    n = BigInt((whole || '0') + frac) * (negative ? -1n : 1n);
  } else return null;
  if (d < 0n) { n = -n; d = -d; }
  const common = gcd(n, d);
  return { n: n / common, d: d / common };
}

export function numbersEqual(a, b) {
  const x = parseNumber(a), y = parseNumber(b);
  return Boolean(x && y && x.n === y.n && x.d === y.d);
}

export function gradeQuestion(item, response) {
  if (!item || !['single', 'multiple', 'numerical'].includes(item.type)) throw new Error('Unknown question type');
  const m = item.marking;
  if (!m || !Number.isFinite(m.correct) || m.correct <= 0 || !Number.isFinite(m.incorrect) || !Number.isFinite(m.unanswered)) throw new Error('Invalid marking scheme');
  const result = (score, status) => ({ score, maxScore: m.correct, status });
  if (item.type === 'multiple') {
    if (!Array.isArray(item.answer) || !item.answer.length || new Set(item.answer).size !== item.answer.length) throw new Error('Invalid multiple-choice key');
    const valid = new Set(item.options?.map(o => o.id));
    if (item.answer.some(a => !valid.has(a))) throw new Error('Invalid multiple-choice key');
    if (response == null || response === '' || (Array.isArray(response) && response.length === 0)) return result(m.unanswered, 'skipped');
    if (!Array.isArray(response) || response.some(a => !valid.has(a)) || new Set(response).size !== response.length) return result(m.incorrect, 'incorrect');
    if (response.some(a => !item.answer.includes(a))) return result(m.incorrect, 'incorrect');
    if (response.length === item.answer.length) return result(m.correct, 'correct');
    const per = m.partial?.perCorrect;
    if (Number.isFinite(per) && per > 0) return result(Math.min(m.correct, response.length * per), 'partial');
    return result(m.incorrect, 'incorrect');
  }
  if (response == null || (typeof response === 'string' && !response.trim())) return result(m.unanswered, 'skipped');
  if (typeof response !== 'string') return result(m.incorrect, 'incorrect');
  if (item.type === 'single') {
    if (!item.options?.some(o => o.id === item.answer)) throw new Error('Invalid single-choice key');
    return response === item.answer ? result(m.correct, 'correct') : result(m.incorrect, 'incorrect');
  }
  if (!parseNumber(item.answer)) throw new Error('Invalid numerical answer key');
  return numbersEqual(response, item.answer) ? result(m.correct, 'correct') : result(m.incorrect, 'incorrect');
}
