import { fileURLToPath } from 'node:url';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const CATS = ['marketing', 'product'];

export async function builtinNyc({ pages = 3, log = () => {} } = {}) {
  const out = new Map();
  for (const cat of CATS) {
    for (let p = 1; p <= pages; p++) {
      let html = '';
      try {
        const r = await fetch(`https://www.builtinnyc.com/jobs/${cat}?daysSinceUpdated=1${p > 1 ? `&page=${p}` : ''}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) { log(`builtin ${cat} p${p}: HTTP ${r.status}`); break; }
        html = await r.text();
      } catch (e) { log(`builtin ${cat} p${p}: ${e.message}`); break; }
      const cards = html.split(/id="job-card-\d+"/).slice(1);
      for (const c of cards) {
        const id = (c.match(/\/job\/[^"/]+\/(\d+)/) || [])[1];
        const title = decode((c.match(/data-id="job-card-title"[^>]*>([^<]*)</) || [])[1]);
        const company = decode((c.match(/data-id="company-title"[^>]*>\s*<span>([^<]*)</) || [])[1]);
        const path = (c.match(/href="(\/job\/[^"]+)"/) || [])[1];
        const location = decode((c.match(/fa-location-dot[\s\S]*?<span[^>]*>([^<]*)</) || [])[1]);
        const ago = decode((c.match(/(\d+\s+(?:Minutes?|Hours?|Days?)\s+Ago|Reposted[^<]*|Yesterday)/i) || [])[1]);
        if (id && title && company && !out.has(id)) out.set(id, { id: 'builtin-' + id, company, title, url: `https://www.builtinnyc.com${path}`, locations: [location || 'New York, NY'], builtinAgo: ago, body: '' });
      }
      if (!cards.length) break;
      await new Promise(r => setTimeout(r, 800));
    }
  }
  return [...out.values()];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) { // realpath: ~/Documents/GitHub/sponsorpath is a symlink
  const rows = await builtinNyc({ log: console.error });
  console.log(rows.length); for (const r of rows.slice(0, 15)) console.log(`  ${r.company} | ${r.title} | ${r.locations[0]} | ${r.builtinAgo}`);
}
