import { fileURLToPath } from 'node:url';

const UA = 'sponsorpath/1.0 (personal job search; +local)';
const CATS = ['Advertising and Marketing', 'Product Management', 'Project Management'];
const LEVELS = ['Mid Level', 'Senior Level'];
export const LOCS = ['New York, NY', 'Boston, MA', 'San Francisco, CA', 'Chicago, IL', 'Seattle, WA', 'Los Angeles, CA', 'Washington, DC', 'Austin, TX', 'Atlanta, GA', 'Dallas, TX', 'Houston, TX', 'Miami, FL', 'Denver, CO', 'Philadelphia, PA', 'Flexible / Remote'];
const strip = h => String(h || '').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

export async function museJobs({ hours = 48, cats = CATS, locs = LOCS, levels = LEVELS, log = () => {} } = {}) {
  const since = Date.now() - hours * 36e5;
  const out = new Map(); let reqs = 0;
  for (const cat of cats) for (const loc of locs) {
    let pageCount = 1;
    for (let p = 0; p < pageCount && p < 60; p++) {
      const qs = new URLSearchParams(); qs.append('category', cat); for (const l of levels) qs.append('level', l); qs.append('location', loc); qs.append('page', p);
      let d;
      try {
        const r = await fetch('https://www.themuse.com/api/public/jobs?' + qs, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
        reqs++;
        if (!r.ok) { log(`muse ${cat}/${loc} p${p}: HTTP ${r.status}`); if (r.status === 429 || r.status === 403) return [...out.values()]; break; }
        d = await r.json();
      } catch (e) { log(`muse ${cat}/${loc} p${p}: ${e.message}`); break; }
      pageCount = d.page_count || 0;
      for (const j of d.results || []) {
        const t = Date.parse(j.publication_date);
        if (!(t >= since) || j.type && j.type !== 'external') continue;
        const locations = (j.locations || []).map(l => l.name).filter(Boolean);
        const row = out.get(j.id) || { id: 'muse-' + j.id, museId: j.id, company: j.company?.name, title: j.name, url: j.refs?.landing_page, locations: [], postedAt: new Date(t).toISOString(),
          hoursAgo: Math.round((Date.now() - t) / 36e4) / 10, levels: (j.levels || []).map(l => l.name), categories: (j.categories || []).map(c => c.name), body: strip(j.contents).slice(0, 20000) };
        for (const l of locations) if (!row.locations.includes(l)) row.locations.push(l);
        out.set(j.id, row);
      }
      await new Promise(r => setTimeout(r, 250));
    }
  }
  log(`muse: ${reqs} requests, ${out.size} rows in ${hours}h`);
  return [...out.values()];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) { // realpath: ~/Documents/GitHub/sponsorpath is a symlink
  const i = process.argv.indexOf('--hours');
  const rows = await museJobs({ hours: i > 0 ? Number(process.argv[i + 1]) : 48, log: console.error });
  const h24 = rows.filter(r => r.hoursAgo < 24);
  console.log(`${rows.length} rows in window, ${h24.length} under 24h`);
  for (const r of (h24.length >= 5 ? h24 : rows).slice(0, 5)) console.log(`  ${r.id} | ${r.company} | ${r.title} | ${r.locations.slice(0, 3).join('; ')} | ${r.hoursAgo}h | ${r.url}`);
}
