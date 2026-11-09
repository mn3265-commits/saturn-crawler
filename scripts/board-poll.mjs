import { techCan, internLane } from './tech-can.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRefusal } from './sponsor-refusal.mjs';
import { isUSLocation, isRemoteText, NON_US } from './us-location.mjs';
import { LOOP_LOC } from './loop-public.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'data', 'board-poll-cache.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const read = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };
const decode = s => String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const text = s => decode(decode(s).replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

export const NYC_LOC = /new york|\bnyc\b|manhattan|brooklyn|queens|bronx|staten island|jersey city|hoboken|newark|weehawken|basking ridge|stamford|white plains|purchase, ny|harrison, ny|long island city|\bny\b(?!\w)/i;
export const METRO_LOC = /san francisco|bay area|oakland|san jose|palo alto|mountain view|menlo park|sunnyvale|south san francisco|los angeles|santa monica|culver city|seattle|bellevue|redmond|washington,? d\.?c|\bdc\b|arlington, va|alexandria, va|bethesda|reston|mclean|tysons|boston|cambridge, ma|somerville|waltham|burlington, ma|philadelphia|chicago|wilmington, (?:de|delaware)/i;
void isUSLocation; void isRemoteText; void NON_US;
export const ALLOWED_LOC = { test: l => NYC_LOC.test(l || '') || LOOP_LOC.test(l) };
const IN_LANE = /digital|omni|channel|owned|personali|lifecycle|crm|cvm|retention|growth|customer|engagement|loyalty|moneti|activation|pricing|marketing|go.to.market|gtm|consumer|chief of staff|product manager|product owner|product lead|associate product|strateg|consult|operations|member|subscri|insights|commercial|partnerships|brand|campaign|email|experience|program|project|portfolio|\bpmo\b|analytics|analyst|intelligence|transformation|technology|innovation|implementation|solutions|governance|planning|business partner|\bai\b|non-?profit|philanthrop|international development|product/i;
const OFF = /engineer|developer|scientist|designer|recruit|counsel|attorney|legal|accountant|payroll|nurse|driver|technician|mechanic|warehouse|cashier|barista|sales (?:rep|associate|development)|account executive|\bsdr\b|\bbdr\b|security|infrastructure|devops|data engineer/i;

const get = async (url, opts = {}) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000), headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) } });
      if (r.status === 429 && !attempt) { await new Promise(res => setTimeout(res, 2500)); continue; }
      const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
      return { status: r.status, data: d };
    } catch (e) { if (attempt) return { status: 0, error: e.message }; }
  }
  return { status: 0 };
};
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: e.message }; } } })); return out; }

const wdDays = s => (/today/i.test(s) ? 0 : /yesterday/i.test(s) ? 1 : Number((String(s).match(/(\d+)\+?\s+days?/i) || [])[1] ?? 99));

const DAILY = join(ROOT, 'data', 'board-poll-daily.json');
export const WD_RECENT_CAP = 15;
export async function pollTargets({ hours = 72, log = () => {}, all = false, hoursFor = null } = {}) {
  const allBoards = (await read(join(ROOT, 'data', 'target-boards.json'), { boards: [] })).boards || [];
  const stamps = await read(DAILY, {});
  const bkey = b => `${b.ats}:${b.token || b.tenant}:${b.site || ''}`;
  const boards = allBoards.filter(b => all || b.poll !== 'daily' || !stamps[bkey(b)] || Date.now() - Date.parse(stamps[bkey(b)]) > 20 * 36e5);
  const skippedDaily = allBoards.length - boards.length;
  for (const b of boards) if (b.poll === 'daily') stamps[bkey(b)] = new Date().toISOString();
  if (skippedDaily) log(`board-poll: ${skippedDaily} daily-tier boards skipped (polled <20h ago)`);
  try { await writeFile(DAILY, JSON.stringify(stamps)); } catch {}
  const cache = await read(CACHE, {});
  for (const [k, v] of Object.entries(cache)) if (Date.now() - Date.parse(v.at) > 72 * 36e5) delete cache[k];
  const hrsOf = b => (hoursFor ? hoursFor(b) : hours);
  const fresh = (iso, b) => iso && Date.parse(iso) >= Date.now() - hrsOf(b) * 36e5;
const want = (title, locs) => (IN_LANE.test(title) || techCan(title) || internLane(title)) && (!OFF.test(title) || techCan(title)) && locs.some(l => ALLOWED_LOC.test(l));
  const rows = []; let failed = 0;
  const push = (b, j) => rows.push({ id: `${b.ats}-${b.token || b.tenant}-${j.id}`, company: b.company, title: j.title, url: j.url, locations: j.locations,
    body: j.body || '', boardTier: b.tier, boardIndustry: b.industry,
    ats: { kind: b.ats, slug: b.token || b.tenant, id: j.id, title: j.title, url: j.url, published: j.published, dateOnly: !!j.dateOnly, refusal: j.refusal || null, where: j.refusal ? j.where || 'JD' : null } });

  const detail = async (key, fn) => { if (cache[key]) return cache[key]; const v = await fn(); if (v) cache[key] = { at: new Date().toISOString(), ...v }; return v; };

  const POLL = {
    greenhouse: async b => {
      const r = await get(`https://boards-api.greenhouse.io/v1/boards/${b.token}/jobs`);
      if (r.status !== 200) return false;
      const hits = (r.data.jobs || []).filter(j => fresh(j.first_published, b) && want(j.title, [j.location?.name, ...(j.offices || []).map(o => o.name)]));
      await pool(hits, 4, async j => {
        const d = await detail(`gh:${b.token}:${j.id}`, async () => {
          const x = await get(`https://boards-api.greenhouse.io/v1/boards/${b.token}/jobs/${j.id}?questions=true`);
          if (!x.data) return null;
          const form = [...(x.data.questions || []), ...(x.data.location_questions || [])].map(q => `${q.label || ''}. ${text(q.description || '')}`).join(' \n ');
          const inForm = findRefusal(form);
          return { body: text(x.data.content).slice(0, 20000), refusal: inForm || null, where: inForm ? 'form question' : null, published: x.data.first_published };
        });
        push(b, { id: String(j.id), title: decode(j.title), url: j.absolute_url, locations: [j.location?.name].filter(Boolean), published: d?.published || j.first_published, body: d?.body, refusal: d?.refusal, where: d?.where });
      });
      return true;
    },
    ashby: async b => {
      const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${b.token}?includeCompensation=true`);
      if (r.status !== 200) return false;
      for (const j of r.data.jobs || []) {
        const locs = [j.location, ...(j.secondaryLocations || []).map(s => s.location)].filter(Boolean);
        if (!fresh(j.publishedAt, b) || !want(j.title, locs)) continue;
        push(b, { id: j.id, title: j.title, url: j.jobUrl, locations: locs, published: j.publishedAt, body: j.descriptionPlain || '', refusal: findRefusal(j.descriptionPlain) });
      }
      return true;
    },
    lever: async b => {
      const r = await get(`https://api.lever.co/v0/postings/${b.token}?mode=json`);
      if (r.status !== 200 || !Array.isArray(r.data)) return false;
      for (const j of r.data) {
        const iso = j.createdAt ? new Date(j.createdAt).toISOString() : null;
        const locs = [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean);
        if (!fresh(iso, b) || !want(j.text, locs)) continue;
        const body = [j.descriptionPlain, ...(j.lists || []).map(l => `${l.text}\n${text(l.content)}`), j.additionalPlain].filter(Boolean).join('\n');
        push(b, { id: j.id, title: j.text, url: j.hostedUrl, locations: locs, published: iso, body, refusal: findRefusal(body) });
      }
      return true;
    },
    smartrecruiters: async b => {
      const all = [];
      for (let off = 0; off < 500; off += 100) {
        const r = await get(`https://api.smartrecruiters.com/v1/companies/${b.token}/postings?limit=100&offset=${off}`);
        if (r.status !== 200) return off > 0;
        all.push(...(r.data.content || []));
        if ((r.data.content || []).length < 100) break;
      }
      const hits = all.filter(j => fresh(j.releasedDate, b) && want(j.name, [[j.location?.city, j.location?.region].filter(Boolean).join(', ')]));
      await pool(hits, 4, async j => {
        const d = await detail(`sr:${b.token}:${j.id}`, async () => {
          const x = await get(`https://api.smartrecruiters.com/v1/companies/${b.token}/postings/${j.id}`);
          if (!x.data) return null;
          const body = text(Object.values(x.data.jobAd?.sections || {}).map(s => s.text || '').join('\n'));
          return { body: body.slice(0, 20000), url: x.data.postingUrl };
        });
        push(b, { id: j.id, title: j.name, url: d?.url || `https://jobs.smartrecruiters.com/${b.token}/${j.id}`, locations: [[j.location?.city, j.location?.region].filter(Boolean).join(', ')], published: j.releasedDate, body: d?.body, refusal: findRefusal(d?.body) });
      });
      return true;
    },
    workday: async b => {
      const base = `https://${b.tenant}.${b.wd}.myworkdayjobs.com/wday/cxs/${b.tenant}/${b.site}`;
      const maxDays = Math.ceil(hrsOf(b) / 24);
      const seen = new Map();
      for (const q of ['marketing', 'product manager', 'strategy', 'customer', 'growth', 'CRM lifecycle']) {
        for (let off = 0; off < 60; off += 20) {
          const r = await get(`${base}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 20, offset: off, searchText: q, appliedFacets: {} }) });
          if (r.status !== 200) { if (!seen.size && off === 0 && q === 'marketing') return false; break; }
          const list = r.data.jobPostings || [];
          for (const j of list) if (wdDays(j.postedOn) <= maxDays && want(j.title, [j.locationsText])) seen.set(j.externalPath, j);
          if (list.length < 20) break;
        }
      }
      const all = [...seen.values()].sort((x, y) => wdDays(x.postedOn) - wdDays(y.postedOn));
      const pick = [...all.filter(j => wdDays(j.postedOn) <= 2), ...all.filter(j => wdDays(j.postedOn) > 2).slice(0, WD_RECENT_CAP)];
      await pool(pick, 3, async j => {
        const d = await detail(`wd:${b.tenant}:${j.externalPath}`, async () => {
          const x = await get(`${base}${j.externalPath}`);
          const info = x.data?.jobPostingInfo;
          if (!info) return null;
          const locs = [info.location, ...(info.additionalLocations || [])].filter(Boolean);
          return { body: text(info.jobDescription).slice(0, 20000), startDate: info.startDate || null, url: info.externalUrl || null, locations: locs, reqId: info.jobReqId || null };
        });
        const day = d?.startDate || new Date(Date.now() - wdDays(j.postedOn) * 864e5).toISOString().slice(0, 10);
        push(b, { id: d?.reqId || j.externalPath, title: j.title, url: d?.url || `https://${b.tenant}.${b.wd}.myworkdayjobs.com/${b.site}${j.externalPath}`,
          locations: d?.locations?.length ? d.locations : [j.locationsText], published: new Date(day + 'T12:00:00Z').toISOString(), dateOnly: true, body: d?.body, refusal: findRefusal(d?.body) });
      });
      return true;
    },
  };

  const res = await pool(boards, 10, async b => { const fn = POLL[b.ats]; if (!fn) return null; const ok = await fn(b); if (!ok) failed++; return ok; });
  void res;
  await writeFile(CACHE, JSON.stringify(cache));
  const nyc = rows.filter(r => r.locations.some(l => ALLOWED_LOC.test(l)));
  log(`board-poll: ${boards.length} boards, ${nyc.length} NYC/metro in-lane-title postings in ${hours}h, ${failed} boards failed`);
  return { boards: boards.length, failed, rows: nyc };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) { // realpath: ~/Documents/GitHub/sponsorpath is a symlink
  const t0 = Date.now();
  const r = await pollTargets({ hours: Number(process.argv[2]) || 72, log: m => console.error(m) });
  const by = {}; for (const x of r.rows) by[x.ats.kind] = (by[x.ats.kind] || 0) + 1;
  console.log(`${r.rows.length} rows from ${r.boards} boards (${r.failed} failed) in ${Math.round((Date.now() - t0) / 1000)}s`, by);
  for (const x of r.rows.slice(0, 40)) console.log(`  ${x.ats.kind} ${x.ats.published?.slice(0, 16)} | ${x.company} | ${x.title} | ${x.locations[0]}`);
}
