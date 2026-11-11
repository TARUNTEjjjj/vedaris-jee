# Capacity and hosting acceptance

**Target: 10,000 concurrent study sessions. Capacity at that concurrency is unmeasured.**

Vedaris serves static files from Cloudflare Pages. Practice generation, answer scoring, timers, review queues, and saved progress run in the visitor's browser. There is no application server API, shared database, authenticated session service, or per-answer network request. Progress is local to a device; this architecture does not provide cross-device sync or a live shared leaderboard.

This design removes a central application-compute bottleneck. It does not establish a measured concurrency limit or an uptime guarantee. The project has no published 10,000-user test result. Record any future measurements with the release version, date, generator hardware, regions, scenario, achieved concurrency, throughput, transferred bytes, latency percentiles, errors, and pass/fail result. A small live probe is a reachability check, not a capacity test.

## Cloudflare delivery model

- Cloudflare documents free, unlimited **static asset requests** on both free and paid Pages plans; requests invoking Functions use Workers quotas. The Pages product advertises unlimited bandwidth. These are service/pricing statements, not proof of this application's performance at 10,000 users. [Static pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Pages product](https://www.cloudflare.com/products/pages/)
- Pages automatically serves static assets through Tiered Cache, supports Gzip/Brotli, and uses ETags for browser revalidation. Its default cache behavior is suitable for mutable entry points. [Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- The build emits an immutable `releases/<content-version>/` directory. Release assets receive a one-year immutable browser cache policy. HTML, `build-info.json`, the service worker, and the root manifest revalidate. Avoid adding a broad cache rule that could retain an old entry point. [Custom headers](https://developers.cloudflare.com/pages/configuration/headers/)
- Free Pages allows 500 builds per month, one concurrent build, a 20-minute build timeout, 20,000 files, and 25 MiB per asset. These are build/content limits rather than visitor limits. Vedaris additionally enforces 5 MiB per release input and 15 MiB across source inputs to keep offline installation bounded. [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)

The service worker downloads and verifies the release during installation. Therefore a first visit can download more than the initially visible page. A returning visitor can reuse cached content. Reviewed question bundles, native MathML and 39 local diagrams are included. The 0.4 complete offline release is approximately 2.55 MB raw / 1.38 MB by per-file gzip estimate; the enforced compressed budget is 2 MiB and each asset is below 1 MiB. Ten thousand cold downloads would therefore be roughly 14 GB at that estimate, before protocol overhead, without implying measured capacity. No external PYQ PDF or publisher page is precached: those links open on the source's infrastructure, whose capacity is outside this project's control.

## Two different traffic targets

**10,000 open study sessions:** students load the app at different times, then solve locally. Open tabs do not continuously request server work. CDN traffic is driven by new arrivals, reloads, deployments, and uncached downloads.

**10,000 cold arrivals:** all students need the entry document and release assets over a short interval. This is a different, substantially heavier traffic pattern. If a release requires `B` transferred bytes and `A` requests per first visit, 10,000 cold visits require approximately `10,000 × B` bytes and `10,000 × A` requests, spread over the arrival window. Measure transferred bytes, including compression and first-install traffic; `sourceBytes` is not a compressed transfer measurement.

## Reproducible HTTP test

`scripts/loadtest.js` requires an existing [k6 installation](https://grafana.com/docs/k6/latest/set-up/install-k6/). It installs nothing and is not run by builds or deployment. Its only permitted host is `https://vedaris-jee.pages.dev`; redirects are disabled. It fetches `/build-info.json`, `/`, and validated paths within that release directory. It never crawls HTML links, requests source publishers, downloads external papers, or executes browser JavaScript.

Start with the default 25-user profile:

```sh
mkdir -p work
k6 run --summary-export work/loadtest-25.json scripts/loadtest.js
```

The default stages ramp up over two minutes, hold for three minutes, then ramp down over one minute. Each virtual user downloads the release once and spends subsequent iterations in a 20–40 second local study interval. The complete release download models first installation conservatively; it is not a simulation of browser rendering or cache eviction.

An explicit target run, after smaller runs pass and the generator can sustain the workload:

```sh
k6 run -e MAX_VUS=10000 -e RAMP=10m -e HOLD=5m -e DOWN=2m \
  --summary-export work/loadtest-10000.json scripts/loadtest.js
```

`MAX_VUS` must be 1–10,000. Each stage duration must be 1 second–60 minutes. Setting `MODE=cold` downloads the release again after every think interval, deliberately imposing repeated cold visits. A short `RAMP` with study mode tests a concentrated initial-arrival burst. These are different workloads: label results accordingly, and start with bounded smaller runs before increasing either arrival rate or users. Keep deployments paused during a run; a change to the pinned release invalidates the comparison.

The script aborts if cumulative failure-rate or correctness-check thresholds fail after a 30-second evaluation delay. Target only the owned application hostname and avoid shared infrastructure or unrelated hosts. Cloudflare's own example uses gradual ramp-up and think time; its policies constrain testing to owned assets. [Load-test example](https://developers.cloudflare.com/waiting-room/additional-options/test-waiting-room/), [testing scope](https://developers.cloudflare.com/fundamentals/reference/scans-penetration/), [simulation policy](https://developers.cloudflare.com/ddos-protection/reference/simulate-ddos-attack/)

## Proposed acceptance targets — not measured results

| Check | Proposed release acceptance | Measurement status |
| --- | --- | --- |
| HTTP request failures | Less than 1% over each representative run | Unmeasured at 10,000 VUs |
| Response correctness | More than 99% of checks pass; root references the pinned release and release assets return 200 | Unmeasured at 10,000 VUs |
| Entry and asset request duration | p95 below 1 second; p99 below 2 seconds, reported separately | Proposed; depends on test geography/network |
| Peak concurrency | Achieve the configured 10,000 VUs for the hold period without generator saturation | Unmeasured |
| Browser experience | Practice, scoring, persistence, offline recovery, and upgrade behavior pass browser checks; inspect LCP, INP, and CLS on representative devices | HTTP load tests cannot establish this |
| Uptime | No project-specific availability SLA is asserted | Requires operational measurements and any applicable provider contract |

A passed run supports only its measured scenario and release. The count of completed downloads is not a concurrent-user count. Add `--out json=work/loadtest-timeseries.json` when retaining k6's time series to verify the sustained peak; large runs can produce substantial local output. Inspect generator CPU/network utilization so a saturated generator is not mistaken for a server limit.

## Observability and future backend work

Cloudflare Pages can enable Web Analytics in the project's Metrics view; the beacon is inserted on a subsequent deployment. It provides visits, page views, load experience, and Core Web Vitals, including LCP, INP, and CLS. It is not an exact live concurrency counter. Analytics is optional and is not claimed enabled by this document. The current self-only Content Security Policy must be updated deliberately for the documented beacon script and collection endpoints before enabling it. [Pages analytics](https://developers.cloudflare.com/pages/how-to/web-analytics/), [metrics](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/), [Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/)

Adding accounts, cross-device sync, server grading, AI APIs, a database, or shared leaderboards changes this model. Pages Functions share the Workers Free quota of 100,000 requests per day; paid usage has separate pricing and resource limits. Model API request rate, authentication, database concurrency, storage, abuse controls, and cost before claiming the same user capacity for a backend release. [Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
