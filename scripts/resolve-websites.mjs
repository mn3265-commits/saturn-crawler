#!/usr/bin/env node
// sponsorpath / resolve-websites.mjs (2026-11-05) - fills the missing website of companies in data/nyc-startup-universe.json.
// Why: Built In NYC answers 429 to the company-page fetch, so 4,769 of 6,023 NYC startups had no website and were never crawled.
// Source: Clearbit's free autocomplete (name -> domain). Only an exact normalized-name match is taken.
// shortcut: exact name match can still pick a same-named company elsewhere; downstream gates check location, so it costs a wasted fetch only.
//   node scripts/resolve-websites.mjs [--limit n]
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'nyc-startup-universe.json');
export const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(inc|llc|corp|co|ltd|the|hq)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
export const pick = (name, hits) => (hits || []).find(h => h.domain && norm(h.name) === norm(name))?.domain || null;

if (process.argv[1] && (await import('node:fs')).realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.assert(pick('Ramp', [{ name: 'Rampant', domain: 'rampant.tv' }, { name: 'Ramp', domain: 'ramp.com' }]) === 'ramp.com', 'pick self-check');
  console.assert(pick('10up', [{ name: 'UPS', domain: 'ups.com' }]) === null, 'pick rejects fuzzy');
  const d = JSON.parse(await readFile(OUT, 'utf8'));
  const i0 = process.argv.indexOf('--limit'), lim = i0 > 0 ? +process.argv[i0 + 1] : Infinity;
  const need = d.companies.filter(c => !c.website && !c.resolveTried).slice(0, lim);
  let i = 0, done = 0, hit = 0;
  const save = () => writeFile(OUT, JSON.stringify(d, null, 1));
  await Promise.all(Array.from({ length: 6 }, async () => { while (i < need.length) { const c = need[i++];
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch('https://autocomplete.clearbit.com/v1/companies/suggest?query=' + encodeURIComponent(c.name), { signal: AbortSignal.timeout(10000) });
        if (r.status === 429) { await new Promise(s => setTimeout(s, 5000 * (t + 1))); continue; }
        if (r.ok) { const dom = pick(c.name, await r.json()); c.resolveTried = true; if (dom) { c.website = 'https://' + dom; c.websiteSrc = 'clearbit'; hit++; } }
      } catch {}
      break;
    }
    if (++done % 250 === 0) { console.error(`resolve ${done}/${need.length} hit ${hit}`); await save(); } } }));
  await save();
  // Pass 2: Built In blocks plain fetch (429) but serves headless Chrome, so read "View Website" there for the rest.
  if (!process.argv.includes('--no-chrome')) {
    const rest = d.companies.filter(c => !c.website && c.path && !c.biTried).slice(0, lim);
    if (rest.length) {
      const { chromium } = await import('playwright-core');
      let browser, page;
      const open = async () => { await browser?.close().catch(() => {}); browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage(); await page.route('**/*', r => /^(image|media|font|stylesheet)$/.test(r.request().resourceType()) ? r.abort() : r.continue()); };
      await open(); let n = 0, got = 0;
      for (const c of rest) {
        try {
          await page.goto('https://www.builtinnyc.com' + c.path, { waitUntil: 'domcontentloaded', timeout: 20000 });
          const m = (await page.content()).match(/href="(https?:\/\/[^"]+)"[^>]*trackViewWebsite/);
          c.biTried = true;
          if (m) { c.website = m[1].replace(/&amp;/g, '&').replace(/[?#].*$/, '').replace(/\/$/, ''); c.websiteSrc = 'builtin-chrome'; got++; }
        } catch { await open().catch(() => {}); }   // dead tab or browser: relaunch, retry this company next run
        if (++n % 100 === 0) { console.error(`builtin-chrome ${n}/${rest.length} hit ${got}`); await save(); }
      }
      await browser.close().catch(() => {}); await save();
      console.error(`builtin-chrome: ${n} tried, ${got} resolved`);
    }
  }
  console.log(`resolve-websites: ${done} tried, ${hit} resolved, ${d.companies.filter(c => c.website).length}/${d.companies.length} with website`);
  process.exit(0);   // playwright can keep the event loop alive after close
}
