#!/usr/bin/env node
import './fetch-timeout.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { NYC_LOC } from './board-poll.mjs';
import { builtinMetros, getHtml, closeBrowser } from './src-builtin.mjs';
import { isUSLocation } from './us-location.mjs';
import { mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { LIGHT_TECH, PICKED_SEAT } from './loop-public.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const flag = k => process.argv.includes(k);
const HOURS = Number(arg('--hours')) || 48;
const ALL = flag('--all');
const read = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };
export const nyDate = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const TODAY = nyDate(Date.now()), YDAY = nyDate(Date.now() - 864e5);
export const BACKFILL_D = 90;
export const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const LEVEL_OUT = /\b(director|head of|vice president|vp\b|svp|evp|chief(?! of staff)|c[eoft]o\b|general manager|partner\b|founder\b(?!'?s? (?:associate|office)))/i;
export const ROLE_OUT = /pre-?sales|solutions? consultant|field marketing|event (?:marketing|manager)|engineer|developer|\bswe\b|\bsre\b|devops|architect|scientist|researcher|machine learning|\bml\b|designer|\bux\b|\bui\b|illustrat|animator|video editor|counsel|attorney|lawyer|paralegal|legal|compliance officer|accountant|accounting|controller|bookkeep|\btax\b|payroll|audit|recruit|talent|sourcer|people partner|\bhr\b|human resources|nurse|physician|clinical|medical|therap|pharmac|dental|account executive|\bae\b|\bsdr\b|\bbdr\b|sales development|business development rep|sales rep|inside sales|closer|driver|warehouse|technician|mechanic|electrician|chef|cook|barista|cashier|retail associate|security officer|apprentice|unpaid|teacher|tutor|sales|account manager|business development|data science|investigator|restaurant|store manager|fragrance|formulat|materials|writer\b|shift lead|executive assistant|admin(?:istrative)? assistant|office services|instructional/i;
export const roleOut = t => ROLE_OUT.test(t || '') && !LIGHT_TECH(t) && !PICKED_SEAT(t);
export const locOk = locs => { const l = locs.filter(Boolean); if (l.some(x => NYC_LOC.test(x) || isUSLocation(x))) return true;
  return l.some(x => /remote|anywhere/i.test(x)) && l.every(x => /^(remote|anywhere)[\s-]*(us|usa|united states)?$/i.test(x.trim()) || isUSLocation(x)); };
export const SOFT = /^(?!.*(?:sales|quota|commission)).*(?:JD alignment|off-lane|alignment below|title rung|junior|entry|lane)/i;

export const LANE_T = /market|growth|lifecycle|crm|product|strateg|operations|bizops|chief of staff|analyst|partnership|gtm|go-to-market|pricing|monetiz/i;
const MAIN = process.argv[1] && (await import('node:fs')).realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (MAIN) {
async function getJson(url) { try { const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } }); return r.ok ? await r.json() : null; } catch { return null; } }
async function poll(b) {
  const { type, token, label } = b, out = [];
  if (type === 'gh' || type === 'greenhouse') {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
    for (const j of d?.jobs || []) out.push({ company: label, title: j.title, url: j.absolute_url, locations: [j.location?.name || ''], published: j.first_published || j.updated_at, ats: 'greenhouse' });
  } else if (type === 'ashby') {
    const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
    for (const j of d?.jobs || []) if (j.isListed !== false) out.push({ company: label, title: j.title, url: j.jobUrl, locations: [j.location, ...(j.secondaryLocations || []).map(s => s.location), j.isRemote ? 'Remote' : ''].filter(Boolean), published: j.publishedAt, ats: 'ashby', type: j.employmentType });
  } else if (type === 'lever') {
    const d = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
    for (const j of Array.isArray(d) ? d : []) out.push({ company: label, title: j.text, url: j.hostedUrl, locations: [j.categories?.location, ...(j.categories?.allLocations || []), j.workplaceType === 'remote' ? 'Remote' : ''].filter(Boolean), published: j.createdAt ? new Date(j.createdAt).toISOString() : null, ats: 'lever', type: j.categories?.commitment });
  } else if (type === 'workable') {
    const d = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${token}`);
    for (const j of d?.jobs || []) out.push({ company: label, title: j.title, url: j.url, locations: [[j.city, j.state, j.country].filter(Boolean).join(', '), j.telecommuting ? 'Remote' : ''].filter(Boolean), published: j.published_on, ats: 'workable' });
  } else if (type === 'smartrecruiters') {
    const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`);
    for (const j of d?.content || []) out.push({ company: label, title: j.name, url: `https://jobs.smartrecruiters.com/${token}/${j.id}`, locations: [[j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', '), j.location?.remote ? 'Remote' : ''].filter(Boolean), published: j.releasedDate, ats: 'smartrecruiters' });
  } else if (type === 'recruitee') {
    const d = await getJson(`https://${token}.recruitee.com/api/offers/`);
    for (const j of d?.offers || []) out.push({ company: label, title: j.title, url: j.careers_url, locations: [j.location || '', j.remote ? 'Remote' : ''].filter(Boolean), published: j.published_at && j.published_at.replace(' UTC', 'Z').replace(' ', 'T'), ats: 'recruitee' });
  } else if (type === 'gem') {
    const d = await getJson(`https://api.gem.com/job_board/v0/${token}/job_posts/`);
    for (const j of Array.isArray(d) ? d : []) out.push({ company: label, title: j.title, url: j.absolute_url, locations: [j.location?.name || '', j.location_type === 'remote' ? 'Remote' : ''].filter(Boolean), published: j.first_published_at || j.created_at, ats: 'gem' });
  } else if (type === 'bamboohr') {
    const d = await getJson(`https://${token}.bamboohr.com/careers/list`);
    for (const j of d?.result || []) { const locs = [[j.location?.city, j.location?.state].filter(Boolean).join(', '), j.isRemote ? 'Remote' : ''].filter(Boolean);
      if (!locOk(locs)) continue;
      const x = await getJson(`https://${token}.bamboohr.com/careers/${j.id}/detail`);
      out.push({ company: label, title: j.jobOpeningName, url: `https://${token}.bamboohr.com/careers/${j.id}`, locations: locs, published: x?.result?.jobOpening?.datePosted, ats: 'bamboohr' }); }
  } else if (type === 'dover' && !(/^dover$/i.test(token) && !/dover/i.test(label))) {
    const c = await getJson(`https://app.dover.com/api/v1/careers-page-slug/${token}`);
    const d = c?.id && await getJson(`https://app.dover.com/api/v1/careers-page/${c.id}/jobs`);
    const seed = !FIRST_SEEN.boards[type + '|' + token]; FIRST_SEEN.boards[type + '|' + token] = TODAY;
    for (const j of d?.results || []) { if (!j.is_published || j.is_sample) continue;
      const url = `https://jobs.dover.com/${token}/${j.id}`;
      if (!FIRST_SEEN.jobs[url]) FIRST_SEEN.jobs[url] = seed ? 'seed' : new Date().toISOString();
      const fs = FIRST_SEEN.jobs[url];
      out.push({ company: label, title: j.title.trim(), url, locations: [...(j.locations || []).map(l => l.name).filter(Boolean), j.workplace_type === 'REMOTE' ? 'Remote' : ''].filter(Boolean), published: fs === 'seed' ? null : fs, ats: 'dover' }); }
  } else if (type === 'workday') {
    const host = token.toLowerCase(), tenant = host.split('.')[0];
    let site = b.site;
    if (!site && b.page) { const h = await fetch(b.page, { headers: { 'user-agent': 'Mozilla/5.0' } }).then(r => r.text()).catch(() => '');
      site = (h.match(new RegExp(host.replace(/\./g, '\\.') + '/(?:[a-z]{2}-[A-Z]{2}/)?([A-Za-z0-9_-]+)', 'i')) || [])[1]; }
    if (!site || /^(wday|en-us)$/i.test(site)) return out;
    const seen = new Map(), wdDays = x => (/today/i.test(x) ? 0 : /yesterday/i.test(x) ? 1 : Number((String(x).match(/(\d+)\+?\s+days?/i) || [])[1] ?? 99));
    for (const q of ['marketing', 'product', 'strategy', 'growth', 'operations', 'customer', 'analyst']) for (let off = 0; off < 60; off += 20) {
      const r = await fetch(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' }, body: JSON.stringify({ limit: 20, offset: off, searchText: q, appliedFacets: {} }) }).then(r => r.ok ? r.json() : null).catch(() => null);
      const list = r?.jobPostings || []; for (const j of list) seen.set(j.externalPath, j); if (list.length < 20) break; }
    for (const j of seen.values()) { const age = wdDays(j.postedOn); if (age > 30) continue;
      out.push({ company: label, title: j.title, url: `https://${host}/en-US/${site}${j.externalPath}`, locations: [j.locationsText || ''].filter(Boolean), published: new Date(Date.now() - age * 864e5).toISOString(), ats: 'workday' }); }
  } else if (type === 'rippling') {
    const d = await getJson(`https://api.rippling.com/platform/api/ats/v1/board/${token}/jobs`);
    const seed = !FIRST_SEEN.boards[type + '|' + token]; FIRST_SEEN.boards[type + '|' + token] = TODAY;
    for (const j of Array.isArray(d) ? d : []) { if (!FIRST_SEEN.jobs[j.url]) FIRST_SEEN.jobs[j.url] = seed ? 'seed' : new Date().toISOString();
      const fs = FIRST_SEEN.jobs[j.url];
      out.push({ company: label, title: j.name, url: j.url, locations: [String(j.workLocation?.label || '').replace(/^(?:hybrid|on-?site|remote)\s*\((.*)\)$/i, '$1'), /remote/i.test(j.workLocation?.label || '') ? 'Remote' : ''].filter(Boolean), published: fs === 'seed' ? null : fs, ats: 'rippling' }); }
  }
  return out;
}
const FIRST_SEEN_PATH = join(ROOT, 'data', 'startup-first-seen.json');
const FIRST_SEEN = await read(FIRST_SEEN_PATH, { boards: {}, jobs: {} });

const POLLED = new Set(['gh', 'ashby', 'lever', 'workable', 'smartrecruiters', 'recruitee', 'gem', 'bamboohr', 'rippling', 'dover', 'workday']);
const yc = await read(join(ROOT, 'data', 'yc-sources.json'), {});
const sponsors = (await read(join(ROOT, 'data', 'startup-sponsors.json'), {})).companies || [];
const boards = new Map();
for (const b of [...(yc.sources || []), ...(yc.liveNoLane || [])]) if (b.type && b.token) boards.set(b.type + '|' + b.token, { type: b.type, token: b.token, label: b.label || b.token });
for (const b of (await read(join(ROOT, 'data', 'nyc-startup-boards.json'), {})).boards || []) boards.set(b.type + '|' + b.token, { type: b.type, token: b.token, label: b.label });
for (const c of sponsors) if (c.ats && c.token) { const t = c.ats === 'greenhouse' ? 'gh' : c.ats; boards.set(t + '|' + c.token, { type: t, token: c.token, label: c.company }); }
const NAMER = (await import('./board-name.mjs')).makeNamer((await read(join(ROOT, 'data', 'target-boards.json'), {})).boards || []);
for (const b of (await read(join(ROOT, 'data', 'crawled-boards.json'), {})).boards || []) if (POLLED.has(b.type)) boards.set(b.type + '|' + b.token, { type: b.type, token: b.token, label: NAMER.board(b.label, b.type, b.token, b.site), site: b.site, page: b.page });
{ let n = 0; for (const b of (await read(join(ROOT, 'data', 'cc-boards.json'), {})).boards || []) if (POLLED.has(b.type) && !boards.has(b.type + '|' + b.token)) { boards.set(b.type + '|' + b.token, { type: b.type, token: b.token, label: b.label, via: 'cc-index' }); n++; }
  if (n) console.error(`startup-sweep: +${n} boards from the Common Crawl ATS index`); }
const startupNames = new Set([...boards.values()].map(b => key(b.label)));
for (const e of (await read(join(ROOT, 'data', 'nyc-startups.json'), {})).companies || []) startupNames.add(key(String(e).split('|')[0]));
for (const c of await read(join(ROOT, 'data', 'yc-companies.json'), [])) if (c.status === 'Active') startupNames.add(key(c.name));

const drop = {}, laneDrops = []; let CUR = null;
const D = reason => { drop[reason] = (drop[reason] || 0) + 1; if (CUR && LANE_T.test(CUR.title || '') && laneDrops.length < 20000) laneDrops.push({ company: CUR.company, title: CUR.title, url: CUR.url, locations: CUR.locations, published: CUR.published, reason }); };
const rows = [];
const list = [...boards.values()]; let i = 0;
await Promise.all(Array.from({ length: +process.env.SWEEP_CONC || 16 }, async () => { while (i < list.length) { const b = list[i++]; for (const j of await poll(b)) rows.push({ ...j, source: 'startup career site' }); } }));
{ const cb = await read(join(ROOT, 'data', 'crawled-boards.json'), {}); let n = 0;
  for (const j of cb.siteJobs || []) {
    const sk = 'site|' + j.website, seed = !FIRST_SEEN.boards[sk];
    if (!FIRST_SEEN.jobs[j.url]) FIRST_SEEN.jobs[j.url] = seed ? 'seed' : new Date().toISOString();
    const fs = FIRST_SEEN.jobs[j.url];
    const locs = j.locations?.length ? j.locations : [/nyc/.test(j.src || '') ? 'New York, NY' : 'United States'];
    rows.push({ company: j.company, title: j.title, url: j.url, locations: locs, published: j.datePosted || (fs === 'seed' ? null : fs), ats: 'site', source: 'company careers page', type: j.employmentType || undefined, startDate: j.startDate || undefined }); n++; }
  for (const j of cb.siteJobs || []) FIRST_SEEN.boards['site|' + j.website] = TODAY;
  console.error(`own careers pages: ${n} roles from ${new Set((cb.siteJobs || []).map(j => j.website)).size} sites`); }
await writeFile(FIRST_SEEN_PATH, JSON.stringify(FIRST_SEEN));
const boardCount = rows.length;

if (!flag('--no-builtin')) {
  const SIZE = join(ROOT, 'data', 'builtin-company-size.json'), cache = await read(SIZE, {}), sizes = {};
  const biSize = async path => {
    if (!path) return Infinity;
    const c = cache[path]; if (c && Date.now() - c.at < 30 * 864e5) return (sizes[path] = c.n ?? Infinity);
    let n = null;
    try { const h = (await getHtml('https://www.builtinnyc.com' + path)) || '';
      const m = h.replace(/<[^>]+>/g, ' ').match(/([\d,]+)\s+Total Employees/i); n = m ? Number(m[1].replace(/,/g, '')) : null; } catch {}
    cache[path] = { n, at: Date.now() }; await new Promise(r => setTimeout(r, 400));
    return (sizes[path] = n ?? Infinity);
  };
  const cats = ['marketing', 'product', 'operations', 'project-management', 'data-analytics', 'customer-success-account-management', 'content'];
  for (const r of await builtinMetros({ metros: ['nyc', 'boston', 'sf', 'chicago', 'seattle', 'la', 'austin', 'colorado', 'remote-us'], cats, pages: 3, hours: 30 })) {
    const k = key(r.company);
    if (LEVEL_OUT.test(r.title) || roleOut(r.title)) continue;
    if (!startupNames.has(k) && !((await biSize(r.companyPath)) <= 1000)) { D('Built In: not a startup'); continue; }
    const n = sizes[r.companyPath];
    rows.push({ company: r.company.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))), employees: Number.isFinite(n) ? n : null, title: r.title, url: r.url, locations: r.locations, published: r.postedAt, builtinAgo: r.builtinAgo, ats: 'builtin', source: 'Built In NYC (startup lane)' });
  }
  await writeFile(SIZE, JSON.stringify(cache)); await closeBrowser();
}
for (const r of rows) if (!r.published && FIRST_SEEN.jobs[r.url] === 'seed') r.seed = true;
await mkdir(join(ROOT, 'data', 'sources'), { recursive: true });
await writeFile(join(ROOT, 'data', 'sources', 'sweep.json.gz'), gzipSync(JSON.stringify({ at: new Date().toISOString(), n: rows.length, rows, boards: boards.size, boardCount, drop, laneDrops })));
console.log(`sweep-poll: ${boards.size} boards, ${boardCount} career-site postings, ${rows.length} rows with Built In`);
}
