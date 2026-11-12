#!/usr/bin/env node
import './fetch-timeout.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CACHE = join(ROOT, 'data', 'career-crawl-cache.json'), OUT = join(ROOT, 'data', 'crawled-boards.json');
const TTL = 14 * 864e5;

const ATS = [
  ['gh', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/gi],
  ['gh', /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi],
  ['ashby', /jobs\.ashbyhq\.com\/([A-Za-z0-9._%-]+)/gi],
  ['lever', /jobs\.lever\.co\/([a-z0-9_.-]+)/gi],
  ['workable', /apply\.workable\.com\/([a-z0-9_-]+)/gi],
  ['rippling', /ats\.rippling\.com\/([a-z0-9_-]+)/gi],
  ['bamboohr', /([a-z0-9-]+)\.bamboohr\.com\/(?:careers|jobs)/gi],
  ['smartrecruiters', /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/gi],
  ['workday', /([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)(?:\/wday\/cxs\/[a-z0-9_-]+)?(?:\/[a-z]{2}-[A-Z]{2})?(?:\/([A-Za-z0-9_-]+))?/gi],
  ['oracle', /([a-z0-9-]+\.fa\.(?:[a-z0-9-]+\.)*oraclecloud\.com)(?:\/hcmUI\/CandidateExperience\/[a-z_-]+\/sites\/[A-Za-z0-9_]+|\/hcmRestApi\/[^\s"'<>]{0,300}?siteNumber=[A-Za-z0-9_]+)?/gi],
  ['eightfold', /([a-z0-9-]+)\.eightfold\.ai/gi],
  ['icims', /careers-([a-z0-9-]+)\.icims\.com/gi],
  ['successfactors', /career\d*\.successfactors\.(?:com|eu)\/career\?company=([A-Za-z0-9_]+)/gi],
  ['gem', /jobs\.gem\.com\/([a-z0-9_-]+)/gi],
  ['recruitee', /([a-z0-9-]+)\.recruitee\.com/gi],
  ['dover', /dover\.com\/([A-Za-z0-9_-]+)\/careers/gi],
];
const JUNK = /^(embed|api|v1|jobs|job|careers|static|assets|widget|js|css|images?|favicon\.ico|undefined|null)$/i;
export function atsLinks(html) {
  const out = new Map();
  for (const [type, re] of ATS) for (const m of String(html).matchAll(re)) {
    const token = decodeURIComponent(m[1]).replace(/[/?#].*$/, '').replace(/\.$/, '');
    if (!token || JUNK.test(token) || type === 'eightfold' && /^(app|static|www|careers)$/i.test(token)) continue;
    const k = type + '|' + token.toLowerCase(), b = { type, token, url: m[0], ...(type === 'workday' && m[2] && !/^(wday|en|api|shared)$/i.test(m[2]) ? { site: m[2] } : {}) };
    if (!out.has(k) || b.site && !out.get(k).site || b.url.length > out.get(k).url.length && !out.get(k).site) out.set(k, b);
  }
  return [...out.values()];
}
const CAREER_HREF = /href=["']([^"']*(?:career|jobs?\b|join-us|joinus|join\b|work-with-us|hiring|open-roles|openings|positions)[^"']*)["']/gi;
export function careerLinks(html, base) {
  const out = new Set();
  for (const m of String(html).matchAll(CAREER_HREF)) { try { const u = new URL(m[1], base); if (/^https?:$/.test(u.protocol)) out.add(u.href.split('#')[0]); } catch {} }
  return [...out].slice(0, 4);
}

const ROLE_WORD = /\b(manager|lead|head|director|analyst|associate|specialist|strategist|coordinator|engineer|designer|scientist|marketer|marketing|product|growth|operations|ops|partnerships?|account|success|sales|recruiter|counsel|chief|officer|executive|intern|consultant|writer|editor|researcher|developer|architect|planner|producer|generalist|administrator|representative)\b/i;
const JOB_PATH = /\/(?:careers?|jobs?|positions?|openings?|roles?|opportunities|vacancies|join(?:-us)?)\/[^/?#]*[a-z0-9-]{6,}/i;
const JOB_HOST = /^(?:jobs|careers|apply|hire|hiring|talent|work|join)\./i;
export const jobLink = u => { try { const x = new URL(u); return JOB_PATH.test(x.pathname) || JOB_HOST.test(x.hostname) && /\/[^/?#]*[a-z0-9-]{6,}/i.test(x.pathname); } catch { return false; } };
const START_HINT = /\b(?:spring|winter|summer|fall|january|february|march)\s+20\d\d\b/i;
export const linkType = t => (/\b(intern(?:ship)?|co-?op)\b/i.test(t) ? 'INTERN' : /\bfellow(?:ship)?\b/i.test(t) ? 'FELLOWSHIP' : /\bpart[- ]time\b/i.test(t) ? 'PART_TIME' : /\b(contract(?:or)?|temporary|temp|freelance)\b/i.test(t) ? 'CONTRACTOR' : null);
export function siteJobs(html, base) {
  const out = new Map(); let host; try { host = new URL(base).hostname.replace(/^www\./, ''); } catch { return []; }
  const same = u => { try { const h = new URL(u).hostname.replace(/^www\./, ''); return h === host || h.endsWith('.' + host) || host.endsWith('.' + h); } catch { return false; } };
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const items = [j].flat().flatMap(x => x?.['@graph'] ? x['@graph'] : [x]).flatMap(x => x?.['@type'] === 'ItemList' ? (x.itemListElement || []).map(e => e.item || e) : [x]);
    for (const x of items) if (/JobPosting/.test([x?.['@type']].flat().join(' ')) && x.title) {
      const loc = [x.jobLocation].flat().filter(Boolean).map(l => [l.address?.addressLocality, l.address?.addressRegion, l.address?.addressCountry?.name || l.address?.addressCountry].filter(Boolean).join(', ')).filter(Boolean);
      if (/TELECOMMUTE/i.test(x.jobLocationType || '')) loc.push('Remote');
      let url = x.url || base; try { url = new URL(url, base).href; } catch {}
      out.set(url + '|' + x.title, { title: String(x.title).trim(), url, datePosted: x.datePosted || null, locations: loc, employmentType: [x.employmentType].flat().filter(Boolean).join(','), startDate: x.jobStartDate || null, via: 'jsonld' });
    }
  }
  if (!out.size) for (const m of String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{3,300}?)<\/a>/gi)) {
    let u; try { u = new URL(m[1], base).href.split('?')[0]; } catch { continue; }
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s+\$\s?\d[\d,.]*\s?[kK]?\b.*$/, '');
    if (!same(u) || !jobLink(u) || /\/(solutions|blog|about|news|press|resources)\//i.test(new URL(u).pathname) || /\bjobs?$/i.test(text) ||   /* 2026-11-09 precision audit: 32% real; SEO 'X jobs' pages + /solutions/role/ links were junk */ text.length < 6 || text.length > 140 || !ROLE_WORD.test(text) || /^(view|see|apply|learn|all|open|explore|browse)\b/i.test(text)) continue;
    if (!out.has(u)) out.set(u, { title: text.slice(0, 120), url: u, datePosted: null, locations: [], employmentType: linkType(text), startDate: (text.match(START_HINT) || [])[0] || null, via: 'link' });
  }
  let path = ''; try { path = new URL(base).pathname; } catch {}
  if (!out.size && /career|jobs?\b|join|hiring|position|opening|work-with/i.test(path)) for (const m of String(html).replace(/<(nav|header|footer|script|style)\b[\s\S]*?<\/\1>/gi, ' ').matchAll(/<(h[1-6]|li|strong|b|dt|td|p|span|div|a)\b[^>]*>\s*([^<>]{6,80}?)\s*<\//gi)) {   /* menus are not job lists (audit: 'Order & trade manager' was a nav item) */
    const t = m[2].replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!TEXT_TITLE.test(t) || t.split(' ').length > 9 || /[.!?:;]$|\b(you|your|we|our|us|at|of the|life|meet|day)\b|^(view|see|apply|learn|all|open|explore|browse|contact|talk|for|about|join)\b/i.test(t)) continue;
    const u = base.split('#')[0] + '#' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!out.has(u)) out.set(u, { title: t, url: u, datePosted: null, locations: [], employmentType: linkType(t), startDate: (t.match(START_HINT) || [])[0] || null, via: 'text' });
  }
  return [...out.values()].slice(0, 80);
}
const TEXT_TITLE = /^[A-Z][\w&/,()'’ -]*\b(manager|lead|head|director|analyst|associate|specialist|strategist|coordinator|engineer|designer|scientist|marketer|recruiter|counsel|officer|executive|intern|consultant|writer|editor|researcher|developer|architect|planner|producer|generalist|administrator|representative)\b(\s*[-–—,(|].{0,30})?$/i;
console.assert(siteJobs('<h3>Software Engineer</h3><p>Our initial product,</p><a>Contact sales</a><h4>A Day In The Life of Jenny, Designer at X</h4><li>Growth Marketing Manager (NYC)</li>', 'https://tumult.com/jobs/').map(j => j.title).join('|') === 'Software Engineer|Growth Marketing Manager (NYC)', 'siteJobs text fallback self-check');
console.assert(siteJobs('<h3>Software Engineer</h3>', 'https://tumult.com/').length === 0, 'text fallback only on careers pages');
console.assert(siteJobs('<nav><a>Order &amp; trade manager</a></nav><h3>Growth Manager</h3>', 'https://x.com/careers').map(j => j.title).join('|') === 'Growth Manager', 'text fallback skips nav');
async function get(url) {
  try { const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
    if (!r.ok && (r.status === 403 || r.status === 429)) { const r2 = await fetch(url, { headers: { accept: 'text/html' }, redirect: 'follow' }).catch(() => null);
      if (r2?.ok) { const t = await r2.text(); return { url: r2.url, html: t.slice(0, 6e6) }; } }
    if (!r.ok) return null; const t = await r.text(); return { url: r.url, html: t.slice(0, 6e6) }; } catch { return null; }
}
export async function crawl(site) {
  const home = await get(site); if (!home) return { status: 'down', boards: [] };
  let boards = atsLinks(home.html), pages = [home.url]; const htmls = [[home.url, home.html]];
  const next = [new URL('/careers', home.url).href, new URL('/jobs', home.url).href, ...careerLinks(home.html, home.url).filter(u => !/\?.{40,}/.test(u))];
  for (const u of [...new Set(next)].slice(0, 5)) {
    if (boards.length) break;
    if (atsLinks(u).length) { boards = atsLinks(u); pages.push(u); break; }
    const p = await get(u); if (!p) continue; pages.push(p.url); htmls.push([p.url, p.html]);
    boards = [...atsLinks(p.url), ...atsLinks(p.html)];
    if (!boards.length) for (const v of careerLinks(p.html, p.url).filter(v => !pages.includes(v)).slice(0, 2)) {
      if (atsLinks(v).length) { boards = atsLinks(v); break; }
      const q = await get(v); if (q) htmls.push([q.url, q.html]); if (q) { boards = [...atsLinks(q.url), ...atsLinks(q.html)]; if (boards.length) { pages.push(q.url); break; } }
    }
  }
  if (boards.length) return { status: 'found', boards, page: pages.at(-1) };
  const jobs = [...new Map(htmls.flatMap(([u, h]) => siteJobs(h, u)).map(j => [j.url + '|' + j.title, j])).values()].slice(0, 80);
  return jobs.length ? { status: 'site', boards, jobs, page: pages.at(-1) } : { status: 'no-ats', boards, page: pages.at(-1) };
}

let YC_SLUG = new Map();
async function renderPass(cache, list) {
  const { chromium } = await import('playwright-core');
  let browser, ctx;
  const launch = async () => {
    await browser?.close().catch(() => {});
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    ctx = await browser.newContext({ userAgent: UA });
    await ctx.route('**/*', r => /^(image|media|font|stylesheet)$/.test(r.request().resourceType()) ? r.abort() : r.continue());
  };
  const newPage = async () => { try { return await ctx.newPage(); } catch { await launch(); return ctx.newPage(); } };
  await launch();
  let i = 0, done = 0, found = 0; const t0 = Date.now();
  // 2026-11-12: a wall-clock budget (SP_RENDER_BUDGET_SEC) ends the chunk gracefully before the workflow's hard kill, the
  // cache is saved every 20 sites, and every site in the chunk is stamped renderTry up front (one save) so a chunk that
  // still dies hard does not re-pick the same sites next time (the --render list skips renderTry < 6 h).
  const RENDER_BUDGET = (Number(process.env.SP_RENDER_BUDGET_SEC) || 0) * 1000;
  for (const d of list) if (cache[d]) cache[d].renderTry = Date.now();
  await writeFile(CACHE, JSON.stringify(cache));
  await Promise.all(Array.from({ length: Math.max(1, +process.env.RENDER_PAGES || 1) }, async () => { while (i < list.length) {
    if (RENDER_BUDGET && Date.now() - t0 > RENDER_BUDGET) break;
    const d = list[i++], v = cache[d];
    const page = await newPage(); const seen = [];
    page.on('request', q => seen.push(q.url()));
    let boards = [], jobs = [], landed = null, portal = [];
    const cap = new Promise(r => setTimeout(r, 60000));
    try { await Promise.race([cap, (async () => {
      for (const u of [...new Set([v.page, 'https://' + d + '/careers', 'https://' + d].filter(Boolean))]) {
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        if (u === 'https://' + d) {
          const href = await page.evaluate(() => [...document.querySelectorAll('a')].map(a => a.href).find(h => /career|jobs?\b|join|hiring|open-roles/i.test(h))).catch(() => null);
          if (href) { await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {}); await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}); }
        }
        const html = await page.content().catch(() => '');
        if (/chrome-only|program/.test(v.src || '')) { landed = page.url();
          portal = await page.evaluate(() => [...document.querySelectorAll('a')].map(a => a.href).filter(h => /^https?:/.test(h) && /search|job|career|position|opening|student|graduate|program/i.test(h))).catch(() => []);
          const reg = h => { try { return new URL(h).hostname.split('.').slice(-2).join('.'); } catch { return ''; } };
          portal = [...new Set(portal.filter(h => reg(h) === reg(landed) && new URL(h).hostname !== new URL(landed).hostname || /myworkdayjobs|oraclecloud|eightfold|icims|successfactors|phenom/i.test(h)).map(h => h.split('#')[0]))].slice(0, 6); }
        const frames = page.frames().map(f => f.url());
        boards = [...atsLinks(seen.join(' ')), ...atsLinks(frames.join(' ')), ...atsLinks(html)];
        if (boards.length) break;
        if (!jobs.length) jobs = siteJobs(html, page.url());
      }
    })()]); } catch {}
    await page.close().catch(() => {});
    const uniq = [...boards.reduce((m, b) => { const k = b.type + '|' + b.token.toLowerCase(); if (!m.has(k) || b.site && !m.get(k).site) m.set(k, b); return m; }, new Map()).values()];
    if (!uniq.length && !jobs.length && v.src === 'yc' && YC_SLUG.get(v.name)) { const y = await get(`https://www.ycombinator.com/companies/${YC_SLUG.get(v.name)}/jobs`); if (y) jobs = siteJobs(y.html, y.url); }
    cache[d] = { ...v, at: Date.now(), rendered: true, rv: 3, ...(landed ? { landed, portal } : {}), status: uniq.length ? 'found' : jobs.length ? 'site' : 'no-ats', boards: uniq, ...(jobs.length && !uniq.length ? { jobs } : {}) };
    if (uniq.length) found++;
    if (++done % 20 === 0) { console.error(`  render ${done}/${list.length} found ${found} ${Math.round((Date.now() - t0) / 1e3)}s`); await writeFile(CACHE, JSON.stringify(cache)); } } }));
  await browser.close().catch(() => {});
  if (RENDER_BUDGET && Date.now() - t0 > RENDER_BUDGET && done < list.length) console.error(`  render budget hit at ${done}/${list.length}`);
  await writeFile(CACHE, JSON.stringify(cache));
  return { rendered: done, found, budgetHit: !!(RENDER_BUDGET && done < list.length) };
}

function universe(yc, nyc, dw, seeds, nycU = {}, co = {}, coDom = {}, h1b = {}) {
  const m = new Map(), add = (name, w, src, keyPath) => { if (!w) return; const site = /^https?:/.test(w) ? w : 'https://' + w; let d; try { const u = new URL(site); d = u.hostname.replace(/^www\./, '') + (keyPath ? u.pathname.replace(/\/$/, '') : ''); } catch { return; } if (!m.has(d)) m.set(d, { name, site, domain: d, src }); };
  for (const n of co.companies || []) add(n, coDom[n], 'chrome-only');
  for (const e of co.programs || []) { const [n, u] = String(e).split('|'); add(n, u, 'program', true); }
  for (const e of seeds.companies || []) { const [n, d] = String(e).split('|'); add(n, d, 'seed'); }
  for (const c of nycU.companies || []) add(c.name, c.website, 'nyc');
  for (const [n, d] of Object.entries(h1b)) if (d) add(n, d, 'h1b');
  for (const c of yc) if (c.status === 'Active' && /United States|USA|Remote/i.test(JSON.stringify(c.all_locations || ''))) add(c.name, c.website, 'yc');
  for (const e of nyc.companies || []) { const [n, d] = String(e).split('|'); add(n, d, 'nyc-startups'); }
  for (const e of seeds.companies || []) { const [n, d] = String(e).split('|'); add(n, d, 'seed'); }
  for (const e of [...(dw.companies || dw.watch || []), ...(Array.isArray(dw) ? dw : [])]) add(e.company || e.name, e.website || e.site || e.domain, 'diaspora-watch');
  return [...m.values()];
}

if (import.meta.url === (await import('node:url')).pathToFileURL((await import('node:fs')).realpathSync(process.argv[1])).href) {
  console.assert(atsLinks('https://citi.wd5.myworkdayjobs.com/wday/cxs/citi/2/jobs')[0]?.site === '2' && atsLinks('x.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1')[0]?.type === 'oracle', 'atsLinks portal self-check');
  const cache = await read(CACHE, {});
  let list = universe(await read(join(ROOT, 'data', 'yc-companies.json'), []), await read(join(ROOT, 'data', 'nyc-startups.json'), {}), await read(join(ROOT, 'data', 'diaspora-watch.json'), {}), await read(join(ROOT, 'data', 'crawl-seeds.json'), {}), await read(join(ROOT, 'data', 'nyc-startup-universe.json'), {}), await read(join(ROOT, 'data', 'chrome-only-seeds.json'), {}), await read(join(ROOT, 'data', 'chrome-only-domains.json'), {}), await read(join(ROOT, 'data', 'h1b-domains.json'), {}));
  YC_SLUG = new Map((await read(join(ROOT, 'data', 'yc-companies.json'), [])).filter(c => c.isHiring && c.slug).map(c => [c.name, c.slug]));
  const only = arg('--only')?.split(',').map(s => s.trim().toLowerCase());
  if (only) list = list.filter(c => only.some(o => c.domain.includes(o) || c.name.toLowerCase().includes(o)));
  const todo = list.filter(c => process.argv.includes('--refresh') || only || !(cache[c.domain] && (cache[c.domain].status === 'site' && cache[c.domain].rendered || Date.now() - cache[c.domain].at < (cache[c.domain].status === 'site' ? 864e5 - 36e5 : TTL)))).slice(0, Number(arg('--limit')) || Infinity);
  // 2026-11-12 (crawl.yml 11-09..11-11: 4 runs cancelled, 13 render chunks in a row at "12449 to crawl" + exit 124): with
  // --render this re-ran the WHOLE static pass before rendering anything, and 24 workers stuck on slow sites (crawl() can
  // make 16 fetches x 30 s) never reached the 200-site save, so every chunk redid the same work and died. Now: --render
  // skips the static pass (it has its own step; --static-too restores it), every site has a hard cap, a wall-clock
  // budget (SP_STATIC_BUDGET_SEC) ends the pass gracefully with the cache written, and the cache is saved every 50.
  const RENDER_ONLY = process.argv.includes('--render') && !process.argv.includes('--static-too');
  const STATIC_BUDGET = (Number(process.env.SP_STATIC_BUDGET_SEC) || 0) * 1000;
  const SITE_CAP_MS = Number(process.env.SP_SITE_CAP_MS) || 120000;
  if (RENDER_ONLY) todo.length = 0;
  console.error(`career-crawl: ${list.length} companies, ${todo.length} to crawl${RENDER_ONLY ? ' (render only)' : ''}`);
  let i = 0, done = 0; const t0 = Date.now();
  const capped = (p, ms, fb) => Promise.race([p, new Promise(r => setTimeout(() => r(fb), ms))]);
  await Promise.all(Array.from({ length: 24 }, async () => { while (i < todo.length) { const c = todo[i++];
    if (STATIC_BUDGET && Date.now() - t0 > STATIC_BUDGET) break;
    let res = await capped(crawl(c.site), SITE_CAP_MS, { status: 'down', boards: [], capped: true });
    if (res.status !== 'found' && c.src === 'yc' && YC_SLUG.get(c.name)) { const y = await get(`https://www.ycombinator.com/companies/${YC_SLUG.get(c.name)}/jobs`);
      const jobs = y ? siteJobs(y.html, y.url) : []; if (jobs.length) res = { status: 'site', boards: [], jobs, page: y.url, via: 'yc' }; }
    cache[c.domain] = { name: c.name, src: c.src, at: Date.now(), ...res };
    if (++done % 50 === 0) { console.error(`  ${done}/${todo.length} ${Math.round((Date.now() - t0) / 1e3)}s`); await writeFile(CACHE, JSON.stringify(cache)); } } }));
  if (STATIC_BUDGET && Date.now() - t0 > STATIC_BUDGET) console.error(`  static budget hit at ${done}/${todo.length}, cache saved`);
  await writeFile(CACHE, JSON.stringify(cache));
  if (process.argv.includes('--render') && !process.env.CI && !process.argv.includes('--local-render')) { console.error('render pass skipped: runs in GitHub Actions (saturn-crawler), not on the Mac'); process.exit(0); }
  if (process.argv.includes('--render')) {
    const doms = new Set(list.map(c => c.domain));
    const big = d => /chrome-only|program/.test(cache[d].src || '');
    const rl = Object.keys(cache).filter(d => doms.has(d) && (cache[d].status === 'down' && !cache[d].rendered ||   /* 2026-11-09 coverage audit: ~2/3 of 'down' startups answer a real browser (403/429 bot walls), so every down site gets one render, big ones first via pr() */ cache[d].status === 'no-ats' && (!cache[d].rendered || cache[d].rv !== 3) || cache[d].status === 'site' && cache[d].rendered && Date.now() - cache[d].at > 864e5 - 36e5 || process.argv.includes('--refresh') && cache[d].status === 'no-ats'));
    const pr = d => (big(d) ? -8 : 0) + (cache[d].status === 'site' ? 0 : 4) + (/nyc/.test(cache[d].src || '') ? 0 : 2) + (cache[d].page ? 0 : 1);
    // 2026-11-12: a site tried in the last 6 h by a chunk that died hard (renderTry stamped, not rendered) waits its turn.
    const fresh = rl.filter(d => !(cache[d].renderTry && Date.now() - cache[d].renderTry < 6 * 36e5));
    fresh.sort((a, b) => pr(a) - pr(b));
    const chunk = fresh.slice(0, +process.env.RENDER_MAX || Infinity);
    console.error(`render pass: ${chunk.length} of ${fresh.length} sites (${rl.length - fresh.length} cooling)`);
    const rp = await renderPass(cache, chunk); console.error(JSON.stringify(rp));
    if (chunk.length < fresh.length || rp.budgetHit) console.error('RENDER_MORE');
    await writeFile(CACHE, JSON.stringify(cache));
  }
  const boards = [], byType = {};
  const k = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const theirs = (domain, v, b) => { const t = k(b.token.split('.')[0]), n = k(v.name), d = k(domain.split('.')[0]);
    return t.length >= 3 && (t.includes(d) || d.includes(t) || t.includes(n) || (n.length >= 4 && n.includes(t))); };
  for (const [domain, v] of Object.entries(cache)) for (const b of (v.boards || []).filter((b, _, all) => all.length <= 2 || theirs(domain, v, b))) { boards.push({ ...b, label: v.name, website: domain, page: v.page, src: v.src }); byType[b.type] = (byType[b.type] || 0) + 1; }
  const st = {}; for (const v of Object.values(cache)) st[v.status] = (st[v.status] || 0) + 1;
  const siteJobsOut = Object.entries(cache).filter(([, v]) => v.status === 'site').flatMap(([domain, v]) => (v.jobs || []).map(j => ({ ...j, company: v.name, website: domain, src: v.src, page: v.page, crawledAt: v.at })));
  await writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), companies: Object.keys(cache).length, status: st, byType, boards, siteJobs: siteJobsOut }, null, 1));
  console.log(JSON.stringify({ crawled: done, status: st, byType }));
}
