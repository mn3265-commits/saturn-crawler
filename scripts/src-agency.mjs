import { fileURLToPath } from 'node:url';

const UA = 'Mozilla/5.0 (sponsorpath personal job search)';
const LANE = /\b(marketing|martech|analytics|measurement|attribution|consumer insights?|customer insights?|crm|lifecycle|retention|loyalty|growth|email|campaign|digital (?:marketing|strategy|analyst|product)|e-?commerce|customer (?:experience|journey|engagement)|braze|hubspot|marketo|salesforce marketing|product marketing|brand strateg|media (?:analyst|planner|strategist)|web analyst|data analyst|business intelligence|insights analyst)\b/i;
const OFF = /\b(engineer|developer|designer|illustrator|animator|copy ?writer|editor|photograph|video|art director|motion|accountant|bookkeep|payroll|tax|audit|legal|paralegal|nurse|admin(?:istrative)? assistant|receptionist|warehouse|driver|help ?desk|it support)\b/i;
const want = t => LANE.test(t) && !OFF.test(t);
const strip = h => String(h || '').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&#39;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&#8211;|&#8212;/g, '-').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
const get = async u => { const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)); return m ? m[1].trim() : ''; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function aquent({ since, log }) {
  const x = await get('https://aquent.com/feeds/jobs.xml'); const out = [];
  for (const it of x.match(/<item>[\s\S]*?<\/item>/g) || []) {
    if (tag(it, 'country') !== 'US') continue;
    const type = tag(it, 'placement_type'); if (!/temp|contract/i.test(type)) continue;
    const title = strip(tag(it, 'title')).replace(/\s*\[\d+\]\s*$/, ''); if (!want(title)) continue;
    const postedAt = new Date(tag(it, 'pubDate')).toISOString(); if (Date.parse(postedAt) < since) continue;
    const remote = /fully remote|remote/i.test(tag(it, 'remotetype')) && !/hybrid|on-?site/i.test(tag(it, 'remotetype'));
    const city = tag(it, 'city'), st = tag(it, 'state'), pay = tag(it, 'salary');
    out.push({ id: 'aquent-' + tag(it, 'job_id'), company: 'Aquent', title, url: tag(it, 'url'), postedAt, employmentType: type === 'Temp to Perm' ? 'Contract (temp to perm)' : 'Temporary',
      locations: [remote ? 'Remote (US)' : `${city}, ${st}`], mode: remote ? 'Remote' : tag(it, 'remotetype'), payText: pay || null,
      body: `${title}\n${city}, ${st} (${tag(it, 'remotetype')})\nEmployment type: ${type === 'Permanent' ? type : 'Temporary'} (${type})${pay ? `\nPay: ${pay}` : ''}\n\n${strip(tag(it, 'description'))}`, agencyBridge: true });
  }
  log(`agency aquent: ${out.length} US temp/contract rows in lane`); return out;
}

async function robertHalf({ since, log, max = 150 }) {
  const sm = await get('https://www.roberthalf.com/content/roberthalf.sitemap.us-external-job-details-sitemap.xml');
  const cand = [...sm.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map(m => ({ url: m[1], lastmod: m[2] }))
    .filter(c => Date.parse(c.lastmod + 'T23:59:59Z') >= since)
    .filter(c => { const slug = (c.url.split('/job/')[1] || '').split('/')[1] || ''; return want(slug.replace(/-/g, ' ')); }).slice(0, max);
  const out = [];
  for (const c of cand) {
    try {
      const h = await get(c.url); let jp = null;
      for (const b of h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { const d = JSON.parse(b[1].trim()); for (const x of [d, d.mainEntity, ...(Array.isArray(d) ? d : []), ...(d['@graph'] || [])]) if (x && x['@type'] === 'JobPosting') jp = x; } catch {} }
      if (!jp) continue;
      const et = [].concat(jp.employmentType || []).join(' '); if (!/temp|contract/i.test(et)) continue;
      const postedAt = new Date(jp.datePosted).toISOString(); if (Date.parse(postedAt) < since) continue;
      if (!want(jp.title || '')) continue;
      const addr = [].concat(jp.jobLocation || [])[0]?.address || {}; const remote = /telecommute/i.test(jp.jobLocationType || '');
      const bs = jp.baseSalary?.value || {}; const unit = String(bs.unitText || jp.baseSalary?.unitText || '').toLowerCase();
      const pay = +bs.minValue > 0 || +bs.value > 0 ? `$${bs.minValue || bs.value}${bs.maxValue ? '-$' + bs.maxValue : ''}${unit ? ' / ' + unit : ''}` : null;
      out.push({ id: 'rh-' + (c.url.match(/\/([^/]+)-usen$/)?.[1] || c.url.split('/').pop()), company: 'Robert Half', title: jp.title, url: c.url, postedAt, employmentType: /perm|hire/i.test(et) ? 'Contract (to hire)' : 'Temporary',
        locations: [remote ? 'Remote (US)' : (c.url.split('/job/')[1] || '').split('/')[0].replace(/-([a-z]{2})$/, (m, st) => ', ' + st.toUpperCase()).replace(/-/g, ' ').replace(/\b\w/g, x => x.toUpperCase())], mode: remote ? 'Remote' : 'On-site', payText: pay,
        body: `${jp.title}\n${addr.addressLocality || ''}, ${addr.addressRegion || ''}${remote ? ' (remote)' : ''}\nEmployment type: ${/contract/i.test(et) ? 'Contract' : 'Temporary'} (${et})${pay ? `\nPay: ${pay}` : ''}\n\n${strip(jp.description)}`, agencyBridge: true });
    } catch {}
    await sleep(400);
  }
  log(`agency robert half: ${cand.length} lane slugs fetched, ${out.length} US temp/contract rows`); return out;
}

export async function agencyBridge({ hours = 72, log = () => {} } = {}) {
  const since = Date.now() - hours * 36e5, rows = [];
  for (const [name, fn] of [['aquent', aquent], ['robert half', robertHalf]]) { try { rows.push(...await fn({ since, log })); } catch (e) { log(`agency ${name} failed: ${e.message}`); } }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--hours'); const rows = await agencyBridge({ hours: i > 0 ? Number(process.argv[i + 1]) : 72, log: s => console.error(s) });
  if (process.argv.includes('--print')) for (const r of rows) console.log(`${r.company} | ${r.title} | ${r.locations[0]} | ${r.employmentType} | ${r.payText || '-'} | ${r.postedAt.slice(0, 10)} | ${r.url}`);
  else console.log(JSON.stringify(rows));
}
