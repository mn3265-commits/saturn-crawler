#!/usr/bin/env node
// sponsorpath / career-crawl.mjs (2026-11-05) - crawls each startup's OWN website to its careers page and reads the ATS board
// behind it. His ask 2026-11-05: "km bisa check and crawl website mereka masing2 dan check career page, kaya si taptapsend aja
// aku dptnya dr website mereka". nyc-startup-boards.mjs only GUESSES ATS slugs (495 NYC startups came back "none"); a link on
// the company's own site is the proof the board is theirs.
// Universe: active US YC companies (data/yc-companies.json), data/nyc-startups.json, data/crawl-seeds.json ("Name|domain").
// Steps per company: homepage -> careers/jobs/join links (+ /careers, /jobs guesses) -> ATS embeds in any of those pages.
// Cached per domain 14 days (data/career-crawl-cache.json). startup-sweep.mjs reads data/crawled-boards.json.
//   node scripts/career-crawl.mjs [--limit N] [--refresh] [--render] [--only "taptapsend.com,ramp.com"]
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

// ATS link patterns -> { type, token }. type names match startup-sweep.mjs poll() (gh / ashby / lever); others are recorded only.
const ATS = [
  ['gh', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/gi],
  ['gh', /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi],
  ['ashby', /jobs\.ashbyhq\.com\/([A-Za-z0-9._%-]+)/gi],
  ['lever', /jobs\.lever\.co\/([a-z0-9_.-]+)/gi],
  ['workable', /apply\.workable\.com\/([a-z0-9_-]+)/gi],
  ['rippling', /ats\.rippling\.com\/([a-z0-9_-]+)/gi],
  ['bamboohr', /([a-z0-9-]+)\.bamboohr\.com\/(?:careers|jobs)/gi],
  ['smartrecruiters', /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/gi],
  ['workday', /([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/[A-Za-z0-9_-]+)/gi],
  ['gem', /jobs\.gem\.com\/([a-z0-9_-]+)/gi],
  ['recruitee', /([a-z0-9-]+)\.recruitee\.com/gi],
  ['dover', /dover\.com\/([A-Za-z0-9_-]+)\/careers/gi],
];
const JUNK = /^(embed|api|v1|jobs|job|careers|static|assets|widget|js|css|images?|favicon\.ico|undefined|null)$/i;
export function atsLinks(html) {
  const out = new Map();
  for (const [type, re] of ATS) for (const m of String(html).matchAll(re)) {
    const token = decodeURIComponent(m[1]).replace(/[/?#].*$/, '').replace(/\.$/, '');
    if (!token || JUNK.test(token)) continue;
    out.set(type + '|' + token.toLowerCase(), { type, token });
  }
  return [...out.values()];
}
const CAREER_HREF = /href=["']([^"']*(?:career|jobs?\b|join-us|joinus|join\b|work-with-us|hiring|open-roles|openings|positions)[^"']*)["']/gi;
export function careerLinks(html, base) {
  const out = new Set();
  for (const m of String(html).matchAll(CAREER_HREF)) { try { const u = new URL(m[1], base); if (/^https?:$/.test(u.protocol)) out.add(u.href.split('#')[0]); } catch {} }
  return [...out].slice(0, 4);
}

// 2026-11-06 his "gak cuma di portal career tapi di career website dr masing2 company": read the roles a company lists on its
// OWN careers page (no ATS behind it): schema.org JobPosting JSON-LD first (has datePosted), else same-site links that look like a
// role (/careers/<slug>, /jobs/<slug>, /positions/..., link text with a role word). Max 80 per site; other hosts never count.
const ROLE_WORD = /\b(manager|lead|head|director|analyst|associate|specialist|strategist|coordinator|engineer|designer|scientist|marketer|marketing|product|growth|operations|ops|partnerships?|account|success|sales|recruiter|counsel|chief|officer|executive|intern|consultant|writer|editor|researcher|developer|architect|planner|producer|generalist|administrator|representative)\b/i;
const JOB_PATH = /\/(?:careers?|jobs?|positions?|openings?|roles?|opportunities|vacancies|join(?:-us)?)\/[^/?#]*[a-z0-9-]{6,}/i;
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
      out.set(url + '|' + x.title, { title: String(x.title).trim(), url, datePosted: x.datePosted || null, locations: loc, employmentType: [x.employmentType].flat().filter(Boolean).join(','), via: 'jsonld' });
    }
  }
  if (!out.size) for (const m of String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{3,300}?)<\/a>/gi)) {
    let u; try { u = new URL(m[1], base).href.split('?')[0]; } catch { continue; }
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!same(u) || !JOB_PATH.test(new URL(u).pathname) || text.length < 6 || text.length > 140 || !ROLE_WORD.test(text) || /^(view|see|apply|learn|all|open|explore|browse)\b/i.test(text)) continue;
    if (!out.has(u)) out.set(u, { title: text.slice(0, 120), url: u, datePosted: null, locations: [], via: 'link' });
  }
  return [...out.values()].slice(0, 80);
}
async function get(url) {
  try { const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
    if (!r.ok) return null; const t = await r.text(); return { url: r.url, html: t.slice(0, 6e6) }; } catch { return null; }
}
async function crawl(site) {
  const home = await get(site); if (!home) return { status: 'down', boards: [] };
  let boards = atsLinks(home.html), pages = [home.url]; const htmls = [[home.url, home.html]];
  // /careers and /jobs first: scraped links can be tracking junk (ramp.com/plp/jobs?...).
  const next = [new URL('/careers', home.url).href, new URL('/jobs', home.url).href, ...careerLinks(home.html, home.url).filter(u => !/\?.{40,}/.test(u))];
  for (const u of [...new Set(next)].slice(0, 5)) {
    if (boards.length) break;
    if (atsLinks(u).length) { boards = atsLinks(u); pages.push(u); break; }   // the careers link itself points at the ATS
    const p = await get(u); if (!p) continue; pages.push(p.url); htmls.push([p.url, p.html]);
    boards = [...atsLinks(p.url), ...atsLinks(p.html)];
    if (!boards.length) for (const v of careerLinks(p.html, p.url).filter(v => !pages.includes(v)).slice(0, 2)) {   // one level deeper ("See open roles")
      if (atsLinks(v).length) { boards = atsLinks(v); break; }
      const q = await get(v); if (q) htmls.push([q.url, q.html]); if (q) { boards = [...atsLinks(q.url), ...atsLinks(q.html)]; if (boards.length) { pages.push(q.url); break; } }
    }
  }
  if (boards.length) return { status: 'found', boards, page: pages.at(-1) };
  const jobs = [...new Map(htmls.flatMap(([u, h]) => siteJobs(h, u)).map(j => [j.url + '|' + j.title, j])).values()].slice(0, 80);
  return jobs.length ? { status: 'site', boards, jobs, page: pages.at(-1) } : { status: 'no-ats', boards, page: pages.at(-1) };
}

// 2026-11-05 his "employ a good skill to crawl ... thorough": --render = second pass over 'no-ats' sites with headless system Chrome
// (playwright-core, channel chrome; its own temp profile, never his session). Renders JS, follows iframes, and records every
// network request, so boards loaded by a widget (Greenhouse embed, Ashby/Lever/Workday/Dover APIs) are caught too.
async function renderPass(cache, list) {
  const { chromium } = await import('playwright-core');
  // 2026-11-05: Chrome died at site ~400 ("Failed to open a new tab") and the uncaught error killed the whole run.
  // Now a failed newPage relaunches Chrome once; progress is saved every 100 sites, so a rerun resumes.
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
  // 2026-11-05: 6 parallel pages got the run killed for low memory; default is now 1 page (sequential). RENDER_PAGES=n to raise.
  await Promise.all(Array.from({ length: Math.max(1, +process.env.RENDER_PAGES || 1) }, async () => { while (i < list.length) { const d = list[i++], v = cache[d];
    const page = await newPage(); const seen = [];
    page.on('request', q => seen.push(q.url()));
    let boards = [], jobs = [];
    // 2026-11-08: one hung page (content/evaluate have no timeout) could stall the runner; each site gets 60s, then the page is dropped.
    const cap = new Promise(r => setTimeout(r, 60000));
    try { await Promise.race([cap, (async () => {
      for (const u of [...new Set([v.page, 'https://' + d + '/careers', 'https://' + d].filter(Boolean))]) {
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        if (u === 'https://' + d) {   // homepage: click through to the careers link, then let it load
          const href = await page.evaluate(() => [...document.querySelectorAll('a')].map(a => a.href).find(h => /career|jobs?\b|join|hiring|open-roles/i.test(h))).catch(() => null);
          if (href) { await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {}); await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}); }
        }
        const html = await page.content().catch(() => '');
        const frames = page.frames().map(f => f.url());
        boards = [...atsLinks(seen.join(' ')), ...atsLinks(frames.join(' ')), ...atsLinks(html)];
        if (boards.length) break;
        if (!jobs.length) jobs = siteJobs(html, page.url());
      }
    })()]); } catch {}
    await page.close().catch(() => {});
    const uniq = [...new Map(boards.map(b => [b.type + '|' + b.token.toLowerCase(), b])).values()];
    cache[d] = { ...v, at: Date.now(), rendered: true, rv: 2, status: uniq.length ? 'found' : jobs.length ? 'site' : 'no-ats', boards: uniq, ...(jobs.length && !uniq.length ? { jobs } : {}) };
    if (uniq.length) found++;
    if (++done % 100 === 0) { console.error(`  render ${done}/${list.length} found ${found} ${Math.round((Date.now() - t0) / 1e3)}s`); await writeFile(CACHE, JSON.stringify(cache)); } } }));
  await browser.close().catch(() => {});
  return { rendered: done, found };
}

function universe(yc, nyc, dw, seeds, nycU = {}) {
  const m = new Map(), add = (name, w, src) => { if (!w) return; const site = /^https?:/.test(w) ? w : 'https://' + w; let d; try { d = new URL(site).hostname.replace(/^www\./, ''); } catch { return; } if (!m.has(d)) m.set(d, { name, site, domain: d, src }); };
  // 2026-11-05 his "please crawl every startup in NYC specially": the NYC universe (nyc-startup-universe.mjs: Built In NYC <= 1000
  // employees + YC NYC + own list) goes first, so NYC is crawled before the rest of the US.
  for (const e of seeds.companies || []) { const [n, d] = String(e).split('|'); add(n, d, 'seed'); }
  for (const c of nycU.companies || []) add(c.name, c.website, 'nyc');
  for (const c of yc) if (c.status === 'Active' && /United States|USA|Remote/i.test(JSON.stringify(c.all_locations || ''))) add(c.name, c.website, 'yc');
  for (const e of nyc.companies || []) { const [n, d] = String(e).split('|'); add(n, d, 'nyc-startups'); }
  for (const e of seeds.companies || []) { const [n, d] = String(e).split('|'); add(n, d, 'seed'); }   // data/crawl-seeds.json: his finds + lookalikes
  for (const e of [...(dw.companies || dw.watch || []), ...(Array.isArray(dw) ? dw : [])]) add(e.company || e.name, e.website || e.site || e.domain, 'diaspora-watch');
  return [...m.values()];
}

if (import.meta.url === (await import('node:url')).pathToFileURL((await import('node:fs')).realpathSync(process.argv[1])).href) {
  const cache = await read(CACHE, {});
  let list = universe(await read(join(ROOT, 'data', 'yc-companies.json'), []), await read(join(ROOT, 'data', 'nyc-startups.json'), {}), await read(join(ROOT, 'data', 'diaspora-watch.json'), {}), await read(join(ROOT, 'data', 'crawl-seeds.json'), {}), await read(join(ROOT, 'data', 'nyc-startup-universe.json'), {}));
  const only = arg('--only')?.split(',').map(s => s.trim().toLowerCase());
  if (only) list = list.filter(c => only.some(o => c.domain.includes(o) || c.name.toLowerCase().includes(o)));
  const todo = list.filter(c => process.argv.includes('--refresh') || only || !(cache[c.domain] && (cache[c.domain].status === 'site' && cache[c.domain].rendered || Date.now() - cache[c.domain].at < (cache[c.domain].status === 'site' ? 864e5 - 36e5 : TTL)))).slice(0, Number(arg('--limit')) || Infinity);
  console.error(`career-crawl: ${list.length} companies, ${todo.length} to crawl`);
  let i = 0, done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: 24 }, async () => { while (i < todo.length) { const c = todo[i++];
    cache[c.domain] = { name: c.name, src: c.src, at: Date.now(), ...(await crawl(c.site)) };
    if (++done % 200 === 0) { console.error(`  ${done}/${todo.length} ${Math.round((Date.now() - t0) / 1e3)}s`); await writeFile(CACHE, JSON.stringify(cache)); } } }));
  await writeFile(CACHE, JSON.stringify(cache));
  // 2026-11-06 his "gabisa aku pake ini terus": render only in the cloud (GitHub Actions sets CI); the 8GB Air ran out of memory.
  if (process.argv.includes('--render') && !process.env.CI && !process.argv.includes('--local-render')) { console.error('render pass skipped: runs in GitHub Actions (saturn-crawler), not on the Mac'); process.exit(0); }
  if (process.argv.includes('--render')) {
    const doms = new Set(list.map(c => c.domain));
    const rl = Object.keys(cache).filter(d => doms.has(d) && (cache[d].status === 'no-ats' && (!cache[d].rendered || cache[d].rv !== 2) || cache[d].status === 'site' && cache[d].rendered && Date.now() - cache[d].at > 864e5 - 36e5 || process.argv.includes('--refresh') && cache[d].status === 'no-ats'));
    // daily refresh of known job pages first, then NYC, then sites with a careers page (2026-11-05: homepage-only sites hit ~2%)
    const pr = d => (cache[d].status === 'site' ? 0 : 4) + (/nyc/.test(cache[d].src || '') ? 0 : 2) + (cache[d].page ? 0 : 1);
    rl.sort((a, b) => pr(a) - pr(b));
    const chunk = rl.slice(0, +process.env.RENDER_MAX || Infinity);   // 2026-11-06: cloud runner lost memory on one 3000-site Chrome; chunks of RENDER_MAX, each a fresh process
    console.error(`render pass: ${chunk.length} of ${rl.length} sites`); console.error(JSON.stringify(await renderPass(cache, chunk)));
    if (chunk.length < rl.length) console.error('RENDER_MORE');
    await writeFile(CACHE, JSON.stringify(cache));
  }
  const boards = [], byType = {};
  // 2026-11-05 Cargo bug: getcargo.ai/jobs is a job aggregator (300+ other companies' boards), so OpenAI roles were queued as
  // "Cargo". A site's board counts only when it is clearly theirs: 1-2 boards on the site, or the token matches name / domain.
  const k = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const theirs = (domain, v, b) => { const t = k(b.token.split('.')[0]), n = k(v.name), d = k(domain.split('.')[0]);
    return t.length >= 3 && (t.includes(d) || d.includes(t) || t.includes(n) || (n.length >= 4 && n.includes(t))); };
  for (const [domain, v] of Object.entries(cache)) for (const b of (v.boards || []).filter((b, _, all) => all.length <= 2 || theirs(domain, v, b))) { boards.push({ ...b, label: v.name, website: domain, page: v.page, src: v.src }); byType[b.type] = (byType[b.type] || 0) + 1; }
  const st = {}; for (const v of Object.values(cache)) st[v.status] = (st[v.status] || 0) + 1;
  const siteJobsOut = Object.entries(cache).filter(([, v]) => v.status === 'site').flatMap(([domain, v]) => (v.jobs || []).map(j => ({ ...j, company: v.name, website: domain, src: v.src, page: v.page, crawledAt: v.at })));
  await writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), companies: Object.keys(cache).length, status: st, byType, boards, siteJobs: siteJobsOut }, null, 1));
  console.log(JSON.stringify({ crawled: done, status: st, byType }));
}
