import { fileURLToPath } from 'node:url';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
export const SITES = {
  nyc: 'https://www.builtinnyc.com/jobs', boston: 'https://www.builtinboston.com/jobs', sf: 'https://www.builtinsf.com/jobs',
  chicago: 'https://www.builtinchicago.org/jobs', seattle: 'https://www.builtinseattle.com/jobs', la: 'https://www.builtinla.com/jobs',
  austin: 'https://www.builtinaustin.com/jobs', colorado: 'https://www.builtincolorado.com/jobs',
  'remote-us': 'https://builtin.com/jobs/remote',
};
export const DEFAULT_METROS = ['boston', 'sf', 'chicago', 'seattle', 'la', 'austin', 'colorado', 'remote-us'];
const CATS = ['marketing', 'product'];
const CITY = { boston: 'Boston, MA', sf: 'San Francisco, CA', chicago: 'Chicago, IL', seattle: 'Seattle, WA', la: 'Los Angeles, CA', austin: 'Austin, TX', colorado: 'Denver, CO', nyc: 'New York, NY', 'remote-us': 'Remote (US)' };

function agoHours(t) {
  const m = String(t || '').match(/(\d+)\s+(minute|hour|day)/i);
  if (m) return m[2][0].toLowerCase() === 'm' ? Number(m[1]) / 60 : m[2][0].toLowerCase() === 'h' ? Number(m[1]) : Number(m[1]) * 24 + 12;
  if (/yesterday/i.test(t)) return 30;
  if (/today|just now/i.test(t)) return 3;
  return null;
}

export async function builtinMetros({ metros = DEFAULT_METROS, cats = CATS, pages = 3, hours = 48, log = () => {} } = {}) {
  const out = new Map();
  for (const metro of metros) {
    const base = SITES[metro]; if (!base) { log(`builtin: unknown metro ${metro}`); continue; }
    for (const cat of cats) {
      for (let p = 1; p <= pages; p++) {
        let html = '';
        try {
          const r = await fetch(`${base}/${cat}?daysSinceUpdated=1${p > 1 ? `&page=${p}` : ''}`, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
          if (!r.ok) { log(`builtin ${metro} ${cat} p${p}: HTTP ${r.status}`); break; }
          html = await r.text();
        } catch (e) { log(`builtin ${metro} ${cat} p${p}: ${e.message}`); break; }
        const cards = html.split(/id="job-card-\d+"/).slice(1);
        for (const c of cards) {
          const id = (c.match(/\/job\/[^"/]+\/(\d+)/) || [])[1];
          const title = decode((c.match(/data-id="job-card-title"[^>]*>([^<]*)</) || [])[1]);
          const company = decode((c.match(/data-id="company-title"[^>]*>\s*<span>([^<]*)</) || [])[1]);
          const path = (c.match(/href="(\/job\/[^"]+)"/) || [])[1];
          const loc = decode((c.match(/fa-location-dot[\s\S]*?<span[^>]*>([^<]*)</) || [])[1]);
          const ago = decode((c.match(/fa-clock[^>]*><\/i>\s*([^<]+)</) || c.match(/(\d+\s+(?:Minutes?|Hours?|Days?)\s+Ago|Reposted[^<]*|Yesterday)/i) || [])[1]);
          const mode = decode((c.match(/fa-house-building[\s\S]*?<span[^>]*>([^<]*)</) || [])[1]);
          const h = agoHours(ago);
          const companyPath = (c.match(/href="(\/company\/[^"]+)"/) || [])[1] || null;
          if (!(id && title && company)) continue;
          if (h != null && h > hours) continue;
          const host = new URL(base).origin;
          const locations = /^\d+ locations/i.test(loc) ? [CITY[metro]] : [loc || CITY[metro]];
          const row = { id: 'builtin-' + id, metro, company, title, url: host + path, locations, mode, builtinAgo: ago, hoursAgo: h == null ? null : Math.round(h * 10) / 10,
            postedAt: h != null && h < 24 ? new Date(Date.now() - h * 36e5).toISOString() : null, reposted: /repost/i.test(ago), companyPath, body: '' };
          const prev = out.get(id);
          if (!prev) out.set(id, row); else if (row.locations[0] && !prev.locations.includes(row.locations[0])) prev.locations.push(row.locations[0]);
        }
        if (!cards.length) break;
        await new Promise(r => setTimeout(r, 700));
      }
    }
  }
  return [...out.values()];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) { // realpath: ~/Documents/GitHub/sponsorpath is a symlink
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const rows = await builtinMetros({ metros: arg('--metros') ? arg('--metros').split(',') : DEFAULT_METROS, hours: Number(arg('--hours')) || 48, pages: Number(arg('--pages')) || 3, log: console.error });
  const in24 = rows.filter(r => r.hoursAgo != null && r.hoursAgo < 24);
  const by = {}; for (const r of rows) by[r.metro] = (by[r.metro] || 0) + 1;
  console.log(`${rows.length} rows in window (${in24.length} under 24h by Built In's own date)`, by);
  for (const r of (in24.length >= 5 ? in24 : rows).slice(0, 5)) console.log(`  ${r.id} | ${r.company} | ${r.title} | ${r.locations[0]} | ${r.builtinAgo} | ${r.url}`);
}
