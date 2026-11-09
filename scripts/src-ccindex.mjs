#!/usr/bin/env node
import './fetch-timeout.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'cc-boards.json');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

export const HOSTS = [
  ['ashby', 'jobs.ashbyhq.com/*', u => u.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i)?.[1], 'com,ashbyhq,jobs)/'],
  ['gh', 'job-boards.greenhouse.io/*', u => u.match(/job-boards\.greenhouse\.io\/([^/?#]+)/i)?.[1], 'io,greenhouse,job-boards)/'],
  ['gh', 'boards.greenhouse.io/*', u => u.match(/boards\.greenhouse\.io\/(?!embed)([^/?#]+)/i)?.[1], 'io,greenhouse,boards)/'],
  ['lever', 'jobs.lever.co/*', u => u.match(/jobs\.lever\.co\/([^/?#]+)/i)?.[1], 'co,lever,jobs)/'],
  ['workable', 'apply.workable.com/*', u => u.match(/apply\.workable\.com\/([^/?#]+)/i)?.[1], 'com,workable,apply)/'],
  ['rippling', 'ats.rippling.com/*', u => u.match(/ats\.rippling\.com\/([^/?#]+)/i)?.[1], 'com,rippling,ats)/'],
  ['gem', 'jobs.gem.com/*', u => u.match(/jobs\.gem\.com\/([^/?#]+)/i)?.[1], 'com,gem,jobs)/'],
  ['recruitee', '*.recruitee.com', u => u.match(/\/\/([a-z0-9-]+)\.recruitee\.com/i)?.[1], 'com,recruitee,'],
  ['bamboohr', '*.bamboohr.com', u => u.match(/\/\/([a-z0-9-]+)\.bamboohr\.com\/(?:careers|jobs)/i)?.[1], 'com,bamboohr,'],
];
const JUNK = /^(embed|api|v\d|jobs?|careers?|static|assets|widget|js|css|images?|favicon\.ico|robots\.txt|sitemap.*|undefined|null|www|app|login|signin|search|privacy|terms|static-assets|_next)$/i;
export const tokenOf = (fn, url) => { let t = fn(url); if (!t) return null; try { t = decodeURIComponent(t); } catch {} t = t.trim(); return !t || JUNK.test(t) || t.length > 60 ? null : t; };

import { gunzipSync } from 'node:zlib';
const DATA = 'https://data.commoncrawl.org/';
const range = async (url, a, b) => { for (let t = 0; t < 5; t++) { try { const r = await fetch(url, { headers: { range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(120000) });
  if (r.ok || r.status === 206) return Buffer.from(await r.arrayBuffer()); } catch {} await new Promise(s => setTimeout(s, 5000 * (t + 1))); } return null; };
const sizeOf = async url => { for (let t = 0; t < 5; t++) { try { const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(60000) }); if (r.ok) return +r.headers.get('content-length'); } catch {} await new Promise(s => setTimeout(s, 5000)); } return 0; };
async function lineAt(idx, pos) { const b = await range(idx, pos, pos + 4095); if (!b) return null; const t = b.toString('utf8'); const i = pos === 0 ? 0 : t.indexOf('\n') + 1; const j = t.indexOf('\n', i); return j > i ? { line: t.slice(i, j), next: pos + Buffer.byteLength(t.slice(0, j + 1)) } : null; }
export async function staticIndex(crawl, prefix) {
  const idx = `${DATA}cc-index/collections/${crawl}/indexes/cluster.idx`, size = await sizeOf(idx); if (!size) return null;
  let lo = 0, hi = size;
  for (let k = 0; k < 40 && hi - lo > 4096; k++) { const mid = Math.floor((lo + hi) / 2); const L = await lineAt(idx, mid); if (!L) return null; if (L.line.split(' ')[0] < prefix) lo = mid; else hi = mid; }
  const blocks = []; let pos = lo;
  for (let guard = 0; guard < 4000; guard++) { const b = await range(idx, pos, pos + 65535); if (!b) break; const t = b.toString('utf8'); const ls = t.split('\n'); const usable = t.endsWith('\n') ? ls : ls.slice(0, -1);
    let stop = false; for (const l of usable.slice(pos === 0 ? 0 : 1)) { if (!l) continue; const [key, rest] = [l.split(' ')[0], l.split('\t')]; const prevKey = blocks.length ? null : key;
      if (key > prefix + '\uffff') { stop = true; break; } blocks.push({ key, file: rest[1], off: +rest[2], len: +rest[3] }); }
    if (stop || usable.length < 2) break; pos += Buffer.byteLength(usable.slice(0, -1).join('\n')) + 1; }
  const firstIn = blocks.findIndex(b => b.key >= prefix); const use = firstIn < 0 ? blocks.slice(-1) : blocks.slice(Math.max(0, firstIn - 1)).filter((b, i) => i === 0 || b.key.startsWith(prefix) || b.key < prefix + '\uffff');
  const urls = [];
  for (const b of use) { const buf = await range(`${DATA}cc-index/collections/${crawl}/indexes/${b.file}`, b.off, b.off + b.len - 1); if (!buf) continue;
    let txt; try { txt = gunzipSync(buf).toString('utf8'); } catch { continue; }
    for (const l of txt.split('\n')) { if (!l.startsWith(prefix)) continue; const m = l.match(/"url": "([^"]+)"/); if (m) urls.push(m[1]); } }
  return urls;
}

async function cdx(api, pattern) {
  const get = async u => { for (let t = 0; t < 6; t++) { try { const r = await fetch(u, { signal: AbortSignal.timeout(150000) }); if (r.ok) return await r.text(); if (r.status === 404) return ''; } catch {} await new Promise(s => setTimeout(s, 10000 * (t + 1))); } return null; };
  const q = `${api}?url=${encodeURIComponent(pattern)}&output=json&fl=url`;
  let pages = 1; const meta = await get(q + '&showNumPages=true'); try { pages = Math.min(50, JSON.parse(meta).pages || 1); } catch {}
  const out = []; let failed = 0;
  for (let p = 0; p < pages; p++) { await new Promise(s => setTimeout(s, 3000)); const txt = await get(q + `&page=${p}`); if (txt == null) { failed++; continue; } for (const l of txt.split('\n')) { try { out.push(JSON.parse(l).url); } catch {} } }
  out.failed = failed; return out;
}

if (process.argv[1] && (await import('node:fs')).realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.assert(tokenOf(HOSTS[0][2], 'https://jobs.ashbyhq.com/mercor/e79473b9') === 'mercor', 'ashby token');
  console.assert(tokenOf(HOSTS[2][2], 'https://boards.greenhouse.io/embed/job_board?for=x') === null, 'gh embed is not a token');
  console.assert(tokenOf(HOSTS[7][2], 'https://acme-co.recruitee.com/o/pm') === 'acme-co', 'recruitee subdomain token');
  const prev = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));
  if (!process.argv.includes('--force') && prev.generated && !prev.failedPages && Date.now() - Date.parse(prev.generated) < 7 * 864e5) { console.log(`src-ccindex: fresh (${prev.boards?.length} boards, ${prev.generated.slice(0, 10)}), skipped`); process.exit(0); }
  const n = +(arg('--crawls') || 4);
  const crawls = (await (await fetch('https://index.commoncrawl.org/collinfo.json')).json()).slice(0, n);
  const seen = new Map((prev.boards || []).map(b => [b.type + '|' + b.token.toLowerCase(), b]));
  const before = seen.size; let failedPages = 0;
  for (const c of crawls) for (const [type, pattern, fn, surt] of HOSTS) {
    let urls = surt ? await staticIndex(c.id, surt) : null; const via = urls ? 'static' : 'api';
    if (!urls || !urls.length) urls = await cdx(c['cdx-api'], pattern); let k = 0; failedPages += (urls.failed || 0) + (urls.length ? 0 : 1);
    for (const u of urls) { const t = tokenOf(fn, u); if (!t) continue; const key = type + '|' + t.toLowerCase(); if (!seen.has(key)) { seen.set(key, { type, token: t, label: t, via: 'cc:' + c.id }); k++; } }
    console.error(`  ${c.id} ${pattern} [${via}]: ${urls.length} urls, +${k} boards${urls.failed ? `, ${urls.failed} pages FAILED` : ''}`);
  }
  const boards = [...seen.values()], counts = {};
  for (const b of boards) counts[b.type] = (counts[b.type] || 0) + 1;
  await writeFile(OUT, JSON.stringify({ _doc: 'ATS boards found in the Common Crawl URL index (src-ccindex.mjs). Polled by startup-sweep.mjs.', generated: new Date().toISOString(), crawls: crawls.map(c => c.id), failedPages, counts, boards }, null, 1));
  console.log(`src-ccindex: ${boards.length} boards (+${boards.length - before}) ${JSON.stringify(counts)}`);
}
