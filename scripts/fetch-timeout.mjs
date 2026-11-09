// sponsorpath / fetch-timeout.mjs (2026-10-21, 5 AI Council, Executor lens): every fetch without its own signal gets a 30 s timeout.
// A merge hung 25 min on one stalled socket (no timeout in jd-alignment.mjs Oracle/Ashby fetches and others), which left Saturn's
// queue empty. Import it FIRST in long-running entry scripts (today.mjs, pregate.mjs): ESM evaluates imports in order.
const FETCH_MS = Number(process.env.SP_FETCH_MS) || 30000;
const orig = globalThis.fetch;
if (orig && !orig.__spTimeout) {
  const wrapped = (url, opts = {}) => orig(url, opts && opts.signal ? opts : { ...opts, signal: AbortSignal.timeout(FETCH_MS) });
  wrapped.__spTimeout = true;
  globalThis.fetch = wrapped;
}
