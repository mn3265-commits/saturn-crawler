import './fetch-timeout.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { freshWindowDays, CORE_DAYS, RECENT_DAYS } from './loop-public.mjs';
import { searchAll, KEYWORDS, BROAD_KEYWORDS, US_GEO } from './linkedin-guest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'sources');
const H = 72;
const log = (...a) => console.error('[cloud-sources]', ...a);
const tpr = 'f_TPR=r86400&f_JT=F';
const cards = m => [...m.values()];

const SOURCES = {
  boards: { fn: async () => (await import('./board-poll.mjs')).pollTargets({ hours: H, hoursFor: b => Math.max(H, Math.max(freshWindowDays(b.company), CORE_DAYS) * 24), log }), count: v => v.rows.length },
  portals: { fn: async () => (await import('./src-portals.mjs')).portalJobs({ hours: Math.max(H, RECENT_DAYS * 24), log }) },
  builtinNyc: { fn: async () => (await import('./builtin-nyc.mjs')).builtinNyc({ log }) },
  builtinMetros: { fn: async () => (await import('./src-builtin.mjs')).builtinMetros({ hours: H, log }) },
  muse: { everyH: 20, fn: async () => (await import('./src-muse.mjs')).museJobs({ hours: 48, log }) },
  jobdatalake: { everyH: 5, fn: async () => (await import('./src-jobdatalake.mjs')).jdlJobs({ log }) },
  remote: { everyH: 20, keepEmpty: true, fn: async () => (await import('./src-remote.mjs')).remoteBoards({ hours: 48, log }) },
  linkedin: { fn: async () => {
    const dl = Date.now() + 12 * 60e3;
    const [nyc, us] = await Promise.all([
      searchAll([...new Set([...KEYWORDS, ...BROAD_KEYWORDS])], { extra: tpr, delay: 900, log, deadline: dl }),
      (async () => ({
        us: await searchAll(BROAD_KEYWORDS, { geo: US_GEO, extra: tpr, pages: [0, 10, 20, 30, 40, 50, 60, 70], delay: 900, log, deadline: dl }),
        'remote-us': await searchAll(BROAD_KEYWORDS, { geo: US_GEO, extra: tpr + '&f_WT=2', pages: [0, 10, 20], delay: 900, log, deadline: dl }),
        'us-ea10': await searchAll(BROAD_KEYWORDS, { geo: US_GEO, extra: 'f_TPR=r86400&f_JT=F&f_AL=true&f_EA=true', pages: [0], delay: 1000, log, deadline: dl + 120e3 }),
      }))(),
    ]);
    return { nyc: cards(nyc), us: cards(us.us), 'remote-us': cards(us['remote-us']), 'us-ea10': cards(us['us-ea10']) };
  }, count: v => Object.values(v).reduce((s, a) => s + a.length, 0) },
};

const age = async name => { try { return (Date.now() - Date.parse(JSON.parse(gunzipSync(await readFile(join(OUT, name + '.json.gz')))).at)) / 36e5; } catch { return Infinity; } };
async function run(name) {
  const s = SOURCES[name], t0 = Date.now();
  if (s.everyH && (await age(name)) < s.everyH) return log(`${name}: kept (fetched < ${s.everyH}h ago)`);
  try {
    const rows = await s.fn(), n = (s.count || (v => v.length))(rows);
    if (!n && !s.keepEmpty) return log(`${name}: 0 rows, file not updated (Mac falls back)`);
    await writeFile(join(OUT, name + '.json.gz'), gzipSync(JSON.stringify({ at: new Date().toISOString(), n, rows })));
    log(`${name}: ${n} rows in ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) { log(`${name} failed: ${e.message}`); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) {
  await mkdir(OUT, { recursive: true });
  const want = process.argv.slice(2).filter(a => SOURCES[a]);
  await Promise.all((want.length ? want : Object.keys(SOURCES)).map(run));
  await (await import('./src-builtin.mjs')).closeBrowser();
  process.exit(0);
}
export { SOURCES };
