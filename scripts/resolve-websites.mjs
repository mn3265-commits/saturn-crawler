#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'nyc-startup-universe.json');
export const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(inc|llc|corp|co|ltd|the|hq)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
export const pick = (name, hits) => (hits || []).find(h => h.domain && norm(h.name) === norm(name))?.domain || null;
const SUF = /\b(inc|incorporated|llc|lp|llp|corp|corporation|co|company|companies|ltd|limited|plc|ag|sa|nv|se|the|hq|group|holdings?)\b\.?/gi;
export const clean = s => String(s || '').split('||')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'.,]/g, '').replace(SUF, ' ').replace(/&\s*$/, '').replace(/\s+/g, ' ').trim();
const sn = s => clean(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
export const pickSeed = (name, hits) => (hits || []).find(h => h.domain && sn(h.name) === sn(name))?.domain || null;
const suggest = async q => { for (let t = 0; t < 4; t++) { try {
  const r = await fetch('https://autocomplete.clearbit.com/v1/companies/suggest?query=' + encodeURIComponent(q), { signal: AbortSignal.timeout(10000) });
  if (r.ok) return await r.json(); if (r.status !== 429 && r.status < 500) return [];
} catch {} await new Promise(s => setTimeout(s, 5000 * (t + 1))); } return null; };

if (process.argv[1] && (await import('node:fs')).realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.assert(pick('Ramp', [{ name: 'Rampant', domain: 'rampant.tv' }, { name: 'Ramp', domain: 'ramp.com' }]) === 'ramp.com', 'pick self-check');
  console.assert(pick('10up', [{ name: 'UPS', domain: 'ups.com' }]) === null, 'pick rejects fuzzy');
  console.assert(pickSeed('Estée Lauder Companies', [{ name: 'Estée Lauder', domain: 'esteelauder.com' }]) === 'esteelauder.com', 'pickSeed accents/suffix');
  console.assert(pickSeed('Apple Inc.', [{ name: 'Apple News+', domain: 'apple.news' }]) === null, 'pickSeed rejects fuzzy');
  { const seeds = (await readFile(join(ROOT, 'data', 'chrome-only-seeds.json'), 'utf8').then(JSON.parse).catch(() => ({}))).companies || [];
    const DOM = join(ROOT, 'data', 'chrome-only-domains.json'), dom = await readFile(DOM, 'utf8').then(JSON.parse).catch(() => ({}));
    const todo = seeds.filter(n => !(n in dom)); let k = 0, got = 0;
    await Promise.all(Array.from({ length: 3 }, async () => { while (k < todo.length) { const n = todo[k++]; const hits = await suggest(clean(n)); if (hits) { dom[n] = pickSeed(n, hits); if (dom[n]) got++; } } }));
    await writeFile(DOM, JSON.stringify(dom, null, 1));
    console.log(`resolve-websites seeds: ${todo.length} tried, ${got} resolved, ${Object.values(dom).filter(Boolean).length}/${seeds.length} with domain`); }
  { const seeds = (await readFile(join(ROOT, 'data', 'h1b-tech-seeds.json'), 'utf8').then(JSON.parse).catch(() => ({}))).companies || [];
    const DOM = join(ROOT, 'data', 'h1b-domains.json'), dom = await readFile(DOM, 'utf8').then(JSON.parse).catch(() => ({}));
    const todo = seeds.filter(n => !(n in dom)).slice(0, +process.env.H1B_MAX || 3000); let k = 0, got = 0, n = 0;
    await Promise.all(Array.from({ length: 4 }, async () => { while (k < todo.length) { const nm = todo[k++]; const hits = await suggest(clean(nm)); if (hits) { dom[nm] = pickSeed(nm, hits); if (dom[nm]) got++; }
      if (++n % 500 === 0) await writeFile(DOM, JSON.stringify(dom)); } }));
    await writeFile(DOM, JSON.stringify(dom));
    console.log(`resolve-websites h1b: ${todo.length} tried, ${got} resolved, ${Object.values(dom).filter(Boolean).length}/${seeds.length} with domain`); }
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
        } catch { await open().catch(() => {}); }
        if (++n % 100 === 0) { console.error(`builtin-chrome ${n}/${rest.length} hit ${got}`); await save(); }
      }
      await browser.close().catch(() => {}); await save();
      console.error(`builtin-chrome: ${n} tried, ${got} resolved`);
    }
  }
  console.log(`resolve-websites: ${done} tried, ${hit} resolved, ${d.companies.filter(c => c.website).length}/${d.companies.length} with website`);
  process.exit(0);
}
