const FETCH_MS = Number(process.env.SP_FETCH_MS) || 30000;
const orig = globalThis.fetch;
if (orig && !orig.__spTimeout) {
  const wrapped = (url, opts = {}) => orig(url, opts && opts.signal ? opts : { ...opts, signal: AbortSignal.timeout(FETCH_MS) });
  wrapped.__spTimeout = true;
  globalThis.fetch = wrapped;
}
