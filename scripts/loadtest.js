// Run with an existing k6 installation. This file never follows third-party links.
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const PRODUCTION = 'https://vedaris-jee.pages.dev';
const requested = __ENV.BASE_URL || PRODUCTION;
if (requested !== PRODUCTION && requested !== `${PRODUCTION}/`) {
  throw new Error(`BASE_URL must be exactly ${PRODUCTION}. Redirects are disabled.`);
}
const BASE_URL = PRODUCTION;
const rawUsers = __ENV.MAX_VUS || '25';
if (!/^[1-9]\d*$/.test(rawUsers) || Number(rawUsers) > 10000) {
  throw new Error('MAX_VUS must be an integer from 1 through 10000. Default: 25.');
}
const MAX_VUS = Number(rawUsers);
const MODE = __ENV.MODE || 'study';
if (!['study', 'cold'].includes(MODE)) throw new Error('MODE must be study or cold.');

function duration(name, fallback) {
  const value = __ENV[name] || fallback;
  const match = /^(\d+)(s|m)$/.exec(value);
  const seconds = match ? Number(match[1]) * (match[2] === 'm' ? 60 : 1) : 0;
  if (seconds < 1 || seconds > 3600) throw new Error(`${name} must be 1s–60m.`);
  return value;
}

export const options = {
  // Native HTTP requests download response bytes; only the small entry documents are retained.
  discardResponseBodies: true,
  maxRedirects: 0,
  batch: 6,
  batchPerHost: 6,
  scenarios: {
    readers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: duration('RAMP', MAX_VUS > 250 ? '10m' : '2m'), target: MAX_VUS },
        { duration: duration('HOLD', '3m'), target: MAX_VUS },
        { duration: duration('DOWN', '1m'), target: 0 },
      ],
      gracefulRampDown: '1m',
      gracefulStop: '1m',
    },
  },
  thresholds: {
    // Proposed acceptance targets, not previously measured results or a hosting SLA.
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
    checks: [{ threshold: 'rate>0.99', abortOnFail: true, delayAbortEval: '30s' }],
    'http_req_duration{phase:entry}': ['p(95)<1000', 'p(99)<2000'],
    'http_req_duration{phase:asset}': ['p(95)<1000', 'p(99)<2000'],
  },
};

const opened = new Counter('successful_cold_sessions');
let hasOpened = false;
const requestOptions = phase => ({ redirects: 0, timeout: '15s', tags: { phase } });

function releasePath(path, release) {
  return path.startsWith(`${release}/`)
    && /^releases\/[a-f0-9]{20}\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(path)
    && !path.split('/').some(part => part === '.' || part === '..');
}

function canonicalPath(path) {
  // Pages serves physical HTML files at clean URLs; redirects stay disabled.
  if (path.endsWith('/index.html')) return path.slice(0, -'index.html'.length);
  return path.endsWith('.html') ? path.slice(0, -'.html'.length) : path;
}

export function setup() {
  const response = http.get(`${BASE_URL}/build-info.json`, {
    ...requestOptions('manifest'), responseType: 'text',
  });
  if (!check(response, { 'build manifest returns 200': r => r.status === 200 })) {
    fail('Cannot load the deployment manifest. No session traffic was started.');
  }
  let info;
  try { info = response.json(); } catch { fail('Deployment manifest is not valid JSON.'); }
  if (!info || !/^[a-f0-9]{20}$/.test(info.version)
      || info.release !== `releases/${info.version}`
      || !info.files || typeof info.files !== 'object' || Array.isArray(info.files)) {
    fail('Deployment manifest does not match the Vedaris release contract.');
  }
  const files = Object.keys(info.files).filter(path => path.startsWith(`${info.release}/`));
  if (!files.length || files.length > 500 || !files.includes(`${info.release}/index.html`)
      || files.some(path => !releasePath(path, info.release) || !/^[a-f0-9]{64}$/.test(info.files[path]))) {
    fail('Unsafe, empty, or unexpectedly large release asset list.');
  }
  console.log(`Target ${BASE_URL}; release ${info.version}; ${files.length} assets; mode ${MODE}; peak ${MAX_VUS} VUs.`);
  console.log('HTTP delivery test only: no browser execution, storage, service worker, or external PYQ host traffic.');
  return { version: info.version, release: info.release, files: files.sort() };
}

export default function (release) {
  if (!hasOpened || MODE === 'cold') {
    const entry = http.get(`${BASE_URL}/`, { ...requestOptions('entry'), responseType: 'text' });
    const entryOK = check(entry, {
      'entry returns 200': r => r.status === 200,
      'entry matches pinned release': r => typeof r.body === 'string' && r.body.includes(`${release.release}/assets/app.js`),
    });
    // A deployment during the test invalidates the comparison; stop this iteration early.
    if (!entryOK) { sleep(30); return; }
    const responses = http.batch(release.files.map(path => ({
      method: 'GET', url: `${BASE_URL}/${canonicalPath(path)}`, params: requestOptions('asset'),
    })));
    const results = responses.map(response => check(response, { 'release asset returns 200': r => r.status === 200 }));
    if (results.every(Boolean)) { opened.add(1); hasOpened = true; }
  }
  // A student works locally between downloads. Study mode downloads once per VU.
  // Cold mode deliberately downloads the whole release again after each think interval.
  sleep(20 + Math.random() * 20);
}
