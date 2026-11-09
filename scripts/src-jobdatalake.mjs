import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const MCP = 'https://mcp.jobdatalake.com';
export const LANES = [
  { q: 'lifecycle marketing', fn: 'marketing' }, { q: 'CRM', fn: 'marketing' }, { q: 'growth', fn: 'marketing' }, { q: 'growth', fn: 'product' },
  { q: 'product marketing', fn: 'marketing' }, { q: 'product manager', fn: 'product' }, { q: 'strategy operations' }, { q: 'business operations' },
  { q: 'pricing' }, { q: 'chief of staff' }, { q: 'AI transformation' }, { q: 'marketing analytics' },
];
const WHERE = [{ location: 'New York', countries: 'US' }, { countries: 'US' }];
const RESERVE = 100;

export function parseJobs(text) {
  const left = Number((String(text).match(/(\d+)\/500 free calls remaining/) || [])[1] ?? NaN);
  const found = Number((String(text).match(/Found (\d+) jobs/) || [])[1] || 0);
  const jobs = String(text).split(/\n(?=\d+\. \*\*)/).slice(1).map(b => {
    const m = b.match(/^\d+\. \*\*(.+?)\*\* at (.+)$/m); if (!m) return null;
    const lines = b.split('\n').map(s => s.trim());
    const loc = (lines[1] || '').split(' | ')[0];
    return { title: m[1].trim(), company: m[2].trim(), locations: loc ? loc.split(/,\s*(?=Remote\b)|;\s*/).filter(Boolean) : [],
      mode: (lines[1] || '').match(/fully_remote|hybrid|on_site/)?.[0] || null,
      url: (b.match(/Apply: (\S+)/) || [])[1] || null, handle: (b.match(/ID: (\S+)/) || [])[1] || null };
  }).filter(j => j && j.url);
  return { left, found, jobs };
}

async function rpc(session, body) {
  const r = await fetch(MCP, { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(body) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  const t = await r.text();
  const data = t.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).pop() || t;
  return { session: r.headers.get('mcp-session-id') || session, msg: data ? JSON.parse(data) : null };
}

export async function jdlJobs({ maxCalls = 60, pages = 3, log = () => {} } = {}) {
  const fetchedAt = Date.now();
  const out = new Map(); let calls = 0, stop = '';
  let { session } = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sponsorpath', version: '1' } } });
  await rpc(session, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
  outer: for (const w of WHERE) for (const lane of LANES) for (let page = 1; page <= pages; page++) {
    if (calls >= maxCalls) { stop = `max ${maxCalls} calls`; break outer; }
    const args = { query: lane.q, ...(lane.fn ? { job_function: lane.fn } : {}), ...w, posted_within: '24h', employment_type: 'full_time', per_page: 100, page };
    let res;
    try { res = (await rpc(session, { jsonrpc: '2.0', id: 100 + calls, method: 'tools/call', params: { name: 'search_jobs', arguments: args } })).msg; calls++; }
    catch (e) { calls++; if ([401, 403, 429].includes(e.status)) { stop = e.message; break outer; } log(`jdl ${lane.q}/${w.location || 'US'} p${page}: ${e.message}`); break; }
    const text = (res?.result?.content || []).map(c => c.text || '').join('\n');
    if (res?.error || res?.result?.isError) { stop = 'tool error: ' + (res.error?.message || text).slice(0, 120); break outer; }
    const { left, found, jobs } = parseJobs(text);
    for (const j of jobs) {
      const key = j.url.replace(/[?#].*$/, '') + (j.url.match(/[?&](gh_jid|jobId|id)=[^&]+/)?.[0] || '') + '|' + j.title.toLowerCase();
      if (out.has(key)) continue;
      out.set(key, { id: 'jdl-' + (j.handle || key), company: j.company, title: j.title, url: j.url, locations: j.locations, mode: j.mode, postedAt: new Date(fetchedAt - 864e5).toISOString(), jdlLane: lane.q, jdlWhere: w.location || 'US' });
    }
    if (left < RESERVE) { stop = `daily quota ${left} left (reserve ${RESERVE})`; break outer; }
    if (found <= page * 100) break;
  }
  log(`jobdatalake: ${calls} calls, ${out.size} rows (24h)${stop ? ', stopped: ' + stop : ''}`);
  return [...out.values()];
}

function selfCheck() {
  const t = '📊 246/500 free calls remaining today\n\nFound 58 jobs (showing 2):\n\n1. **Lifecycle Marketing Coordinator, CRM (Remote)** at Instacart\n   Remote | fully_remote | $86k - $110k\n   Skills: \n   Apply: https://instacart.careers/job/?gh_jid=8355990\n   ID: instacart-lifecycle-x\n\n2. **Lifecycle Marketing Manager** at Fivetran, Inc.\n   New York, NY, Remote | hybrid | $121k - $145k\n   Skills: SQL\n   Apply: https://www.fivetran.com/careers/job?gh_jid=8198264003\n   ID: fivetran-lmm\n\n3. **No Link** at Nobody\n   Remote | on_site\n   ID: x';
  const p = parseJobs(t);
  assert.equal(p.left, 246); assert.equal(p.found, 58); assert.equal(p.jobs.length, 2);
  assert.deepEqual(p.jobs[0], { title: 'Lifecycle Marketing Coordinator, CRM (Remote)', company: 'Instacart', locations: ['Remote'], mode: 'fully_remote', url: 'https://instacart.careers/job/?gh_jid=8355990', handle: 'instacart-lifecycle-x' });
  assert.equal(p.jobs[1].company, 'Fivetran, Inc.'); assert.deepEqual(p.jobs[1].locations, ['New York, NY', 'Remote']); assert.equal(p.jobs[1].mode, 'hybrid');
  assert.equal(parseJobs('Found 0 jobs').jobs.length, 0); assert.ok(Number.isNaN(parseJobs('').left));
  console.log('self-check OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) {
  if (process.argv.includes('--self-check')) selfCheck();
  else {
    const rows = await jdlJobs({ log: console.error });
    console.log(`${rows.length} rows`);
    for (const r of rows.slice(0, 8)) console.log(`  ${r.company} | ${r.title} | ${r.locations.join('; ')} | ${r.url}`);
  }
}
