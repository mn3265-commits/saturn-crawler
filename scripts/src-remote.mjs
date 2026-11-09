import { fileURLToPath } from 'node:url';

const UA = 'sponsorpath-rss/1.0 (personal job search)';
const LANE = /\b(market|growth|lifecycle|crm|retention|loyalty|product|strategy|monetization|pricing|brand|customer success|program manager|partnership|operations manager|business (?:development|operations)|revenue|e-?commerce|consumer)\b/i;
const OFF = /\b(engineer|developer|devops|sre|security|data scientist|machine learning|designer|sales (?:development|representative)|account executive|recruit|support (?:agent|specialist)|intern)\b/i;
const US_OK = /\b(usa|u\.s\.|united states|us only|north america|americas|worldwide|anywhere|global)\b|^us$/i;
const strip = h => String(h || '').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const unesc = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const want = t => LANE.test(t) && !OFF.test(t);
const get = async (u, json) => { const r = await fetch(u, { headers: { 'user-agent': UA, accept: json ? 'application/json' : 'application/rss+xml' }, signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return json ? r.json() : r.text(); };

export async function remoteBoards({ hours = 48, log = () => {} } = {}) {
  const since = Date.now() - hours * 36e5; const out = new Map();
  const put = (id, r) => { if (!out.has(id)) out.set(id, { id, mode: 'Remote', locations: ['Remote (US)'], ...r, hoursAgo: Math.round((Date.now() - Date.parse(r.postedAt)) / 36e4) / 10 }); };
  for (const cat of ['marketing', 'product']) {
    try {
      const d = await get(`https://remotive.com/api/remote-jobs?category=${cat}&limit=200`, true);
      let n = 0;
      for (const j of d.jobs || []) {
        const t = Date.parse(j.publication_date + (/Z|[+-]\d\d:?\d\d$/.test(j.publication_date) ? '' : 'Z'));
        if (!(t >= since) || !US_OK.test(j.candidate_required_location || '') || !want(j.title) || !/full/i.test(j.job_type || 'full_time')) continue;
        put('remotive-' + j.id, { board: 'Remotive', company: j.company_name, title: j.title, url: j.url, postedAt: new Date(t).toISOString(), salary: j.salary || null, remoteScope: j.candidate_required_location, body: strip(j.description).slice(0, 20000) }); n++;
      }
      log(`remotive ${cat}: ${(d.jobs || []).length} listed, ${n} kept`);
    } catch (e) { log(`remotive ${cat}: ${e.message}`); }
  }
  try {
    const d = (await get('https://remoteok.com/api', true)).slice(1); let n = 0;
    for (const j of d) {
      const t = Date.parse(j.date); const loc = j.location || '';
      if (!(t >= since) || (loc && !US_OK.test(loc)) || !want(j.position || '')) continue;
      put('remoteok-' + j.id, { board: 'RemoteOK', company: (j.company || '').trim(), title: j.position, url: j.url || j.apply_url, postedAt: new Date(t).toISOString(), remoteScope: loc || 'unspecified', salary: Number(j.salary_max) ? `${j.salary_min}-${j.salary_max}` : null, body: strip(j.description).slice(0, 20000) }); n++;
    }
    log(`remoteok: ${d.length} listed, ${n} kept`);
  } catch (e) { log('remoteok: ' + e.message); }
  for (const f of ['categories/remote-sales-and-marketing-jobs', 'categories/remote-product-jobs', 'categories/remote-management-and-finance-jobs']) {
    try {
      const x = await get(`https://weworkremotely.com/${f}.rss`); let n = 0, tot = 0;
      for (const it of x.split('<item>').slice(1)) {
        tot++;
        const tag = k => unesc((it.match(new RegExp(`<${k}>([\\s\\S]*?)</${k}>`)) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
        const raw = tag('title'); const [company, ...rest] = raw.split(': '); const title = rest.join(': ') || raw;
        const t = Date.parse(tag('pubDate')); const region = tag('region'), country = tag('country'), type = tag('type');
        if (!(t >= since) || !want(title) || (type && !/full/i.test(type))) continue;
        if (!(/united states|north america|usa/i.test(region + ' ' + country) || (/anywhere/i.test(region) && !country))) continue;
        const link = tag('link') || (it.match(/<guid[^>]*>([^<]+)/) || [])[1] || '';
        put('wwr-' + link.split('/').pop(), { board: 'We Work Remotely', company: company || '', title, url: link, postedAt: new Date(t).toISOString(), remoteScope: region, body: strip(tag('description')).slice(0, 20000) }); n++;
      }
      log(`wwr ${f.split('/')[1]}: ${tot} listed, ${n} kept`);
    } catch (e) { log(`wwr ${f}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 1100));
  }
  return [...out.values()];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) { // realpath: ~/Documents/GitHub/sponsorpath is a symlink
  const i = process.argv.indexOf('--hours');
  const rows = await remoteBoards({ hours: i > 0 ? Number(process.argv[i + 1]) : 48, log: console.error });
  const h24 = rows.filter(r => r.hoursAgo < 24); const by = {}; for (const r of rows) by[r.board] = (by[r.board] || 0) + 1;
  console.log(`${rows.length} rows in window, ${h24.length} under 24h`, by);
  for (const r of rows.slice(0, 5)) console.log(`  ${r.id} | ${r.company} | ${r.title} | ${r.remoteScope} | ${r.hoursAgo}h | ${r.url}`);
}
