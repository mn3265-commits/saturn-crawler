import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const read = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };
const decode = s => String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ndash;|&mdash;/g, '-').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const text = s => decode(decode(s).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|li|h\d|div|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

export const NYC_LOC = /new york|\bnyc\b|manhattan|brooklyn|queens|bronx|staten island|jersey city|hoboken|newark|weehawken|basking ridge|stamford|white plains|purchase, ny|harrison, ny|long island city|melville|\bny\b(?!\w)/i;
export const METRO_LOC = /san francisco|bay area|oakland|san jose|palo alto|mountain view|menlo park|sunnyvale|south san francisco|los angeles|santa monica|culver city|seattle|bellevue|redmond|washington,? d\.?c|\bdc\b|arlington, va|alexandria, va|bethesda|reston|mclean|tysons|boston|cambridge, ma|somerville|waltham|burlington, ma|philadelphia|chicago|wilmington, (?:de|delaware)/i;
const REMOTE_US = /remote/i;
import { isUSLocation } from './us-location.mjs';
const okLoc = l => NYC_LOC.test(l || '') || METRO_LOC.test(l || '') || isUSLocation(l) || (REMOTE_US.test(l || '') && /\b(us|usa|united states|u\.s\.)\b/i.test(l || ''));
const IN_LANE = /digital|omni|channel|owned|personali|lifecycle|crm|cvm|retention|growth|customer|engagement|loyalty|moneti|activation|pricing|marketing|go.to.market|gtm|consumer|chief of staff|product manager|product owner|product lead|associate product|strateg|consult|operations|member|subscri|insights|commercial|partnerships|brand|campaign|email|experience|analyst|business|program|product|project|analytics|intelligence|transformation|technology|innovation|implementation|governance|planning|non-?profit|international development/i;
const OFF = /engineer|developer|scientist|designer|recruit|counsel|attorney|legal|accountant|payroll|nurse|driver|technician|mechanic|warehouse|cashier|barista|sales (?:rep|associate|development)|account executive|\bsdr\b|\bbdr\b|intern\b|internship|security|infrastructure|devops|data engineer|tax\b|audit|trader|teller|underwriter|actuar|pharmac|clinical|nursing|welder|electrician|machinist|plant\b/i;

const get = async (url, { json = true, method = 'GET', body, headers = {}, retries = 1 } = {}) => {
  for (let a = 0; a <= retries; a++) {
    try {
      const r = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), redirect: 'follow',
        headers: { 'user-agent': UA, accept: json ? 'application/json, text/plain, */*' : 'text/html,*/*', ...(body ? { 'content-type': 'application/json' } : {}), ...headers } });
      if (r.status === 429 && a < retries) { await new Promise(res => setTimeout(res, 2500)); continue; }
      const t = await r.text(); let d = null; if (json) { try { d = JSON.parse(t); } catch {} }
      return { status: r.status, text: t, data: d, url: r.url };
    } catch (e) { if (a === retries) return { status: 0, error: e.message }; }
  }
};
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: e.message }; } } })); return out; }
const iso = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

const BIGTECH_Q = ['marketing', 'product manager', 'strategy', 'program manager', 'customer', 'growth', 'business operations', 'analytics'];

const SEEN_F = join(ROOT, 'data', 'portal-seen.json'); let SEEN = null;
const ldJob = html => { for (const m of String(html || '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) { try { const j = JSON.parse(m[1]); for (const x of [].concat(j['@graph'] || j)) if (x && x['@type'] === 'JobPosting') return x; } catch {} } return null; };
const icimsLoc = l => { const p = l.trim().split('-'); return /^[A-Z]{2}$/.test(p[0]) && p.length >= 2 ? [p.slice(2).join('-'), p[1], p[0] === 'US' ? 'United States' : p[0]].filter(Boolean).join(', ') : l.trim(); };

export const ADAPTERS = {
  async icims(b, { maxPages = 6 } = {}) {
    const out = [];
    for (let p = 0; p < maxPages; p++) {
      const r = await get(`${b.base}/jobs/search?ss=1&in_iframe=1&pr=${p}`, { json: false }); let n = 0;
      for (const s of String(r.text || '').split('<div class="row">').slice(1)) {
        const m = s.match(/href="([^"]+\/jobs\/(\d+)\/[^"]*)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/); if (!m) continue; n++;
        const dt = (s.match(/Posted Date<\/span>\s*<span title="([^"]+)"/) || [])[1];
        const loc = (s.match(/Job Locations<\/span>\s*<\/dt>\s*<dd[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '';
        if (!out.some(o => o.id === m[2])) out.push({ id: m[2], title: text(m[3]), locs: text(loc).split('|').map(icimsLoc).filter(Boolean), postedAt: iso(dt), url: decode(m[1]).replace(/[?&]in_iframe=1/, ''), body: '' });
      }
      if (!n || !new RegExp(`[?&]pr=${p + 1}\\b`).test(String(r.text).replace(/&amp;/g, '&'))) break;
    }
    return out;
  },
  async radancy(b, { maxPages = 80 } = {}) {
    SEEN ||= await read(SEEN_F, {}); const first = !SEEN[b.base], seen = SEEN[b.base] ||= {}, out = []; let complete = false;
    for (let p = 1; p <= maxPages; p++) {
      const r = await get(`${b.base}/search-jobs/results?ActiveFacetID=0&CurrentPage=${p}&RecordsPerPage=100&Distance=50&RadiusUnitType=0&Keywords=&Location=&ShowRadius=False&IsPagination=False&FacetType=0&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5&ResultsType=0`);
      if (!r.data) break; let n = 0;
      for (const s of String(r.data.results || '').split(/<li[\s>]/).slice(1)) {
        const m = s.match(/href="((?:\/[a-z]{2}(?:-[a-z]{2})?)?\/job\/[^"]+\/(\d+))"/i); if (!m) continue; n++;
        const loc = text((s.match(/class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || '');
        if (!out.some(o => o.id === m[2])) out.push({ id: m[2], title: text((s.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/) || [])[1] || ''), locs: [/multiple|^$/i.test(loc) ? 'Multiple Locations, United States' : loc], url: b.base + m[1], body: '', postedApprox: true });
      }
      if (n < 100) { complete = p > 1 || n > 0; break; }
    }
    const now = new Date().toISOString(), old = new Date(Date.now() - 60 * 864e5).toISOString(), ids = new Set(out.map(o => o.id));
    for (const o of out) o.postedAt = seen[o.id] ||= first ? old : now;
    if (complete) for (const id of Object.keys(seen)) if (!ids.has(id)) delete seen[id];
    return out;
  },
  async phenom(b, { sinceMs, maxPages = 8 }) {
    const [country, lang] = (b.locale || 'us/en').split('/');
    const out = [];
    for (let p = 0; p < maxPages; p++) {
      const r = await get(`${b.base}/widgets`, { method: 'POST', body: { lang: `${lang}_${country}`.replace('global', 'us'), deviceType: 'desktop', country, pageName: 'search-results', ddoKey: 'refineSearch', sortBy: 'Most recent', subsearch: '', from: p * 50, jobs: true, counts: false, all_fields: ['category', 'country', 'state', 'city', 'type'], size: 50, clearAll: false, jdsource: 'facets', isSliderEnable: false, pageId: 'page11', siteType: 'external', keywords: '', global: true, selected_fields: {}, sort: { order: 'desc', field: 'postedDate' }, locationData: {} } });
      const jobs = r.data?.refineSearch?.data?.jobs; if (!jobs?.length) break;
      let oldest = Infinity;
      for (const j of jobs) {
        const posted = Math.max(Date.parse(j.postedDate) || 0, Date.parse(j.dateCreated) || 0) || null;
        oldest = Math.min(oldest, Date.parse(j.postedDate) || Infinity);
        const locs = [...new Set([...(j.multi_location || []), j.location, j.cityStateCountry, j.cityState].filter(Boolean))];
        out.push({ id: j.jobId || j.reqId, title: j.title, locs, postedAt: posted ? new Date(posted).toISOString() : null, postedDay: iso(j.postedDate),
          url: j.applyUrl && !/\/apply$/.test(j.applyUrl) ? j.applyUrl : `${b.base}/${b.locale || 'us/en'}/job/${j.jobId}/${String(j.title).replace(/[^A-Za-z0-9]+/g, '-')}`, body: j.descriptionTeaser || '', _phenomJob: j });
      }
      if (oldest < sinceMs - 864e5) break;
    }
    return out;
  },
  async jibe(b, { sinceMs, maxPages = 6 }) {
    const out = [];
    for (let p = 1; p <= maxPages; p++) {
      const r = await get(`${b.base}/api/jobs?limit=100&page=${p}&sortBy=posted_date&descending=true`);
      const jobs = r.data?.jobs; if (!jobs?.length) break;
      let oldest = Infinity;
      for (const w of jobs) {
        const j = w.data || w; const t = Date.parse(j.posted_date || j.create_date);
        oldest = Math.min(oldest, t || Infinity);
        const locs = [...new Set([j.full_location, j.location_name && [j.location_name, j.state].filter(Boolean).join(', '), j.short_location, ...(j.multipleLocations ? (j.locations || []).map(x => x.name || x.full_location) : [])].filter(Boolean))];
        out.push({ id: j.req_id || j.slug, title: j.title, locs, postedAt: iso(j.posted_date || j.create_date), url: j.apply_url ? `${b.base}/jobs/${j.slug || j.req_id}` : `${b.base}/jobs/${j.slug}`, body: text(j.description || '') + '\n' + text(j.qualifications || '') + '\n' + text(j.responsibilities || '') });
      }
      if (oldest < sinceMs - 864e5) break;
    }
    return out;
  },
  async successfactors(b, { sinceMs, maxPages = 4 }) {
    const out = [];
    for (let p = 0; p < maxPages; p++) {
      const r = await get(`${b.base}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=${p * 25}`, { json: false });
      const rows = [...String(r.text || '').matchAll(/<tr class="data-row[\s\S]*?<\/tr>/g)].map(m => m[0]);
      const tiles = rows.length ? [] : [...String(r.text || '').matchAll(/<li[^>]*class="[^"]*job-tile[\s\S]*?<\/li>/g)].map(m => m[0]);
      if (!rows.length && !tiles.length) break;
      for (const h of tiles) {
        const href = (h.match(/data-url="([^"]+)"/) || h.match(/href="(\/(?:[a-z]+\/)?job\/[^"]+)"/) || [])[1]; if (!href) continue;
        const dt = (h.match(/section-date-value">\s*([^<]+)/) || [])[1];
        out.push({ id: (href.match(/\/(\d+)\/?$/) || [])[1], title: text((h.match(/class="jobTitle-link[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ''), locs: [text((h.match(/section-location-value">([\s\S]*?)<\/div>/) || [])[1] || '')], postedAt: dt ? iso(dt + ' 00:00:00 GMT') : null, postedDay: Boolean(dt), url: b.base + decode(href), needsDetail: true });
      }
      for (const h of rows) {
        const href = (h.match(/href="(\/(?:[a-z]+\/)?job\/[^"]+)"/) || [])[1]; if (!href) continue;
        const title = decode((h.match(/class="jobTitle-link"[^>]*>([^<]+)</) || [])[1] || '').trim();
        const loc = decode((h.match(/class="jobLocation"[^>]*>\s*([^<]+?)\s*</) || [])[1] || '');
        out.push({ id: (href.match(/\/(\d+)\/?$/) || [])[1], title, locs: [loc], postedAt: null, url: b.base + decode(href), needsDetail: true });
      }
    }
    return out;
  },
  async avature(b, { maxPages = 14 }) {
    const out = [], seen = new Set();
    for (let p = 0; p < maxPages; p++) {
      const r = await get(`${b.base}${b.path}/SearchJobs/?folderRecordsPerPage=6&folderOffset=${p * 6}`, { json: false });
      const arts = [...String(r.text || '').matchAll(/<article[\s\S]*?<\/article>/g)].map(m => m[0]); if (!arts.length) break;
      let fresh = 0;
      for (const h of arts) {
        const m = h.match(/href="([^"]*JobDetail\/[^"]*?(\d+))"[^>]*>\s*([\s\S]*?)<\/a>/); if (!m || seen.has(m[2])) continue; seen.add(m[2]); fresh++;
        const rest = text(h.replace(m[0], '')).split('\n').map(s => s.trim()).filter(Boolean);
        const loc = (rest.find(s => /,|remote|united states/i.test(s) && !/Job ID|Share|Learn more/i.test(s)) || '').replace(/\s*[•·]\s*.*/, '');
        out.push({ id: m[2], title: text(m[3]), locs: [loc.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ')], postedAt: null, url: decode(m[1]), needsDetail: true });
      }
      if (!fresh) break;
    }
    return out;
  },
  async oracle(b, { sinceMs, maxPages = 6 }) {
    const out = [];
    for (let p = 0; p < maxPages; p++) {
      const r = await get(`https://${b.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${b.site},limit=50,offset=${p * 50},sortBy=POSTING_DATES_DESC`);
      const list = r.data?.items?.[0]?.requisitionList; if (!list?.length) break;
      let oldest = Infinity;
      for (const j of list) {
        const t = Date.parse(j.PostedDate); oldest = Math.min(oldest, t || Infinity);
        out.push({ id: j.Id, title: j.Title, locs: [j.PrimaryLocation, ...(j.secondaryLocations || []).map(s => s.Name)].filter(Boolean), postedAt: iso(j.PostedDate),
          url: `https://${b.host}/hcmUI/CandidateExperience/en/sites/${b.site}/job/${j.Id}`, _oracle: true });
      }
      if (oldest < sinceMs - 864e5) break;
    }
    return out;
  },
  async eightfold(b, { sinceMs, maxPages = 4 }) {
    const out = [];
    if (b.pcsx) {
      for (const q of b.queries ? BIGTECH_Q : ['']) for (let p = 0; p < (b.queries ? 4 : 12); p++) {
        const r = await get(`${b.base}/api/pcsx/search?domain=${b.domain}&query=${encodeURIComponent(q)}&location=United%20States&start=${p * 10}&sort_by=timestamp`);
        const list = r.data?.data?.positions; if (!list?.length) break;
        let oldest = Infinity;
        for (const j of list) { const t = (j.postedTs || j.creationTs || 0) * 1000; oldest = Math.min(oldest, t || Infinity);
          if (!out.some(o => o.id === j.id)) out.push({ id: j.id, title: j.name, locs: j.locations || [], postedAt: t ? new Date(t).toISOString() : null, postedDay: true, url: `${b.base}${j.positionUrl || '/careers/job/' + j.id}`, body: '', fetchFull: true }); }
        if (oldest < sinceMs - 864e5) break;
      }
      return out;
    }
    for (let p = 0; p < maxPages; p++) {
      const r = await get(`${b.base}/api/apply/v2/jobs?domain=${b.domain}&start=${p * 50}&num=50&sort_by=timestamp`);
      const list = r.data?.positions; if (!list?.length) break;
      let oldest = Infinity;
      for (const j of list) { const t = (j.t_create || j.t_update || 0) * 1000; oldest = Math.min(oldest, t || Infinity);
        out.push({ id: j.id, title: j.name, locs: j.locations || [j.location].filter(Boolean), postedAt: t ? new Date(t).toISOString() : null, url: j.canonicalPositionUrl || `${b.base}/careers/job/${j.id}`, body: text(j.job_description || '') }); }
      if (oldest < sinceMs - 864e5) break;
    }
    return out;
  },
  async tiktok(b, { sinceMs }) {
    const H = { origin: 'https://lifeattiktok.com', 'website-path': 'tiktok' };
    const CODES = b.locationCodes || ['CT_114', 'CT_75', 'CT_1103355', 'CT_94', 'CT_157', 'CT_221'];
    const out = [];
    for (let off = 0; off < 300; off += 100) {
      const r = await get('https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts', { method: 'POST', headers: H, body: { keyword: '', limit: 100, offset: off, job_category_id_list: [], location_code_list: CODES, subject_id_list: [], recruitment_id_list: [], portal_type: 6, job_function_id_list: [], portal_entrance: 1 } });
      const list = r.data?.data?.job_post_list; if (!list?.length) break;
      let oldest = Infinity;
      for (const j of list) {
        const t = Number(BigInt(j.id) >> 32n) * 1000; oldest = Math.min(oldest, t);
        const ci = j.city_info || {}; const loc = [ci.en_name, ci.parent?.en_name].filter(Boolean).join(', ');
        out.push({ id: j.code || j.id, title: j.title, locs: [loc], postedAt: new Date(t).toISOString(), postedApprox: true, url: `https://lifeattiktok.com/search/${j.id}`, body: [j.description, j.requirement].filter(Boolean).join('\n'), recruitType: j.recruit_type?.en_name });
      }
      if (oldest < sinceMs - 864e5 * 3) break;
    }
    return out.filter(j => !/intern/i.test(j.recruitType || ''));
  },
  async amazon(b, { sinceMs }) {
    const out = new Map();
    for (const q of b.queries || BIGTECH_Q) {
      for (let off = 0; off < 400; off += 100) {
        const r = await get(`https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(q)}&normalized_country_code%5B%5D=USA&result_limit=100&sort=recent&offset=${off}`, { retries: 2 });
        const list = r.data?.jobs; if (!list?.length) break;
        for (const j of list) if (!j.is_intern && !j.university_job && !/sales|account management/i.test(j.job_category || '')) out.set(j.id_icims, { id: j.id_icims, title: j.title, locs: [j.normalized_location || j.location].filter(Boolean), postedAt: iso(String(j.posted_date).replace(/\s+/g, ' ') + ' 00:00:00 GMT'), postedDay: true,
          url: `https://www.amazon.jobs${j.job_path}`, body: text([j.description, 'Basic qualifications', j.basic_qualifications, 'Preferred qualifications', j.preferred_qualifications].join('\n')) });
        if (Date.parse(String(list[list.length - 1].posted_date).replace(/\s+/g, ' ') + ' GMT') < sinceMs - 864e5) break;
      }
    }
    return [...out.values()];
  },
  async microsoft(b, { sinceMs }) {
    const out = new Map();
    for (const q of b.queries || BIGTECH_Q) {
      for (let start = 0; start < 200; ) {
        const r = await get(`https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=${encodeURIComponent(q)}&location=United%20States&start=${start}&sort_by=timestamp`, { retries: 3 });
        const list = r.data?.data?.positions; if (!list?.length) break;
        for (const j of list) out.set(j.id, { id: j.displayJobId || j.id, posId: j.id, title: j.name, locs: j.locations || [], postedAt: new Date(j.postedTs * 1000).toISOString(), url: `https://apply.careers.microsoft.com/careers/job/${j.id}`, fetchFull: true });
        start += list.length;
        if (list[list.length - 1].postedTs * 1000 < sinceMs) break;
        await new Promise(res => setTimeout(res, 800));
      }
    }
    return [...out.values()];
  },
  async google(b, { sinceMs }) {
    const out = new Map();
    for (const q of b.queries || BIGTECH_Q) {
      for (let page = 1; page <= 5; page++) {
        const r = await get(`https://www.google.com/about/careers/applications/jobs/results?q=${encodeURIComponent(q)}&location=United%20States&sort_by=date&page=${page}`, { json: false });
        const m = String(r.text || '').match(/AF_initDataCallback\(\{key: 'ds:1'[\s\S]*?data:([\s\S]*?), sideChannel/); if (!m) break;
        let list; try { list = JSON.parse(m[1])[0]; } catch { break; } if (!list?.length) break;
        for (const j of list) {
          const slug = String(j[1]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          out.set(j[0], { id: j[0], title: j[1], locs: (j[9] || []).map(l => l[0]), postedAt: j[12]?.[0] ? new Date(j[12][0] * 1000).toISOString() : null,
            url: `https://www.google.com/about/careers/applications/jobs/results/${j[0]}-${slug}`, body: text([j[10]?.[1], j[3]?.[1], j[4]?.[1], j[19]?.[1]].filter(Boolean).join('\n')) });
        }
        if ((list[list.length - 1][12]?.[0] || 0) * 1000 < sinceMs) break;
      }
    }
    return [...out.values()];
  },
  async apple(b, { sinceMs }) {
    const t = await fetch('https://jobs.apple.com/api/v1/CSRFToken', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
    const H = { 'x-apple-csrf-token': t.headers.get('x-apple-csrf-token') || '', cookie: (t.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; '), origin: 'https://jobs.apple.com' };
    b._h = H;
    const out = new Map();
    for (const q of b.queries || BIGTECH_Q) {
      for (let page = 1; page <= 5; page++) {
        const r = await get('https://jobs.apple.com/api/v1/search', { method: 'POST', headers: H, body: { query: q, filters: { locations: ['postLocation-USA'] }, page, locale: 'en-us', sort: 'newest', format: { longDate: 'MMMM D, YYYY', mediumDate: 'MMM D, YYYY' } } });
        const list = r.data?.res?.searchResults; if (!list?.length) break;
        for (const j of list) out.set(j.positionId, { id: j.positionId, title: j.postingTitle, locs: (j.locations || []).map(l => [l.name, l.countryName].filter(Boolean).join(', ')), postedAt: j.postDateInGMT,
          url: `https://jobs.apple.com/en-us/details/${j.positionId}/${j.transformedPostingTitle}`, body: j.jobSummary || '', fetchFull: true });
        if (Date.parse(list[list.length - 1].postDateInGMT) < sinceMs) break;
      }
    }
    return [...out.values()];
  },
  async goldman(b, { sinceMs, maxPages = 6 }) {
    const out = [], query = 'query($q: RoleSearchQueryInput!) { roleSearch(searchQueryInput: $q) { totalCount items { roleId corporateTitle jobTitle descriptionHtml createdDate lastPostedDate locations { city state country } externalSource { sourceId } } } }';
    for (let p = 0; p < maxPages; p++) {
      const r = await get('https://api-higher.gs.com/gateway/api/v1/graphql', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://higher.gs.com' },
        body: { query, variables: { q: { page: { pageSize: 50, pageNumber: p }, sort: { sortStrategy: 'POSTED_DATE', sortOrder: 'DESC' }, filters: [], experiences: ['PROFESSIONAL'], searchTerm: '' } } } });
      const list = r.data?.data?.roleSearch?.items; if (!list?.length) break;
      let oldest = Infinity;
      for (const j of list) { const d = j.createdDate || j.lastPostedDate, t = d ? Date.parse(d) : 0; oldest = Math.min(oldest, Date.parse(j.lastPostedDate || d || 0) || Infinity);
        const sid = j.externalSource?.sourceId || String(j.roleId).split('_')[0];
        out.push({ id: sid, title: j.jobTitle, locs: (j.locations || []).map(l => [l.city, l.state, l.country].filter(Boolean).join(', ')), postedAt: t ? new Date(t).toISOString() : null, url: `https://higher.gs.com/roles/${sid}`, body: text(j.descriptionHtml || '') }); }
      if (oldest < sinceMs - 864e5) break;
    }
    return out;
  },
  async tencent(b) {
    const out = [];
    for (let p = 1; p <= 3; p++) {
      const r = await get(`https://careers.tencent.com/tencentcareer/api/post/Query?timestamp=${Date.now()}&countryId=&cityId=&bgIds=&productId=&categoryId=&parentCategoryId=&attrId=&keyword=&pageIndex=${p}&pageSize=50&language=en-us&area=us`);
      const list = r.data?.Data?.Posts; if (!list?.length) break;
      for (const j of list) if (!out.some(o => o.id === j.PostId)) out.push({ id: j.PostId, title: j.RecruitPostName, locs: [[j.LocationName, j.CountryName].filter(Boolean).join(', ')], postedAt: iso(String(j.LastUpdateTime || '').replace(/年|月/g, '-').replace('日', '')), url: j.PostURL || `https://careers.tencent.com/en-us/jobdesc.html?postId=${j.PostId}`, body: j.Responsibility || '' });
    }
    return out;
  },
};

async function detail(b, r) {
  try {
    if (b.type === 'successfactors' && r.needsDetail) {
      const d = await get(r.url, { json: false });
      const dp = (String(d.text).match(/itemprop="datePosted"\s+content="([^"]+)"/) || [])[1];
      if (dp) r.postedAt = iso(dp.replace(/ UTC /, ' GMT '));
      const m = String(d.text).match(/itemprop="description"[^>]*>([\s\S]*?)<\/span>\s*(?:<\/div>|<span class="jobdescriptionfooter)/); r.body = text(m ? m[1] : d.text).slice(0, 12000);
    } else if (b.type === 'avature' && r.needsDetail) {
      const d = await get(r.url, { json: false });
      const dp = (String(d.text).match(/"Posted since":"([^"]+)"/) || [])[1];
      if (dp) r.postedAt = iso(dp.replace(/-/g, ' ') + ' 00:00:00 GMT');
      r.body = text(String(d.text).replace(/[\s\S]*?<body/i, '<body')).slice(0, 12000);
    } else if (b.type === 'oracle') {
      const d = await get(`https://${b.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="${r.id}",siteNumber=${b.site}`);
      const j = d.data?.items?.[0]; if (j) r.body = text([j.ExternalDescriptionStr, j.ExternalQualificationsStr, j.ExternalResponsibilitiesStr, (j.requisitionFlexFields || []).map(f => `${f.Prompt || ''}: ${f.Value || ''}`).join(' . ')].filter(Boolean).join('\n')).slice(0, 12000);
    } else if (b.type === 'microsoft') {
      const d = await get(`https://apply.careers.microsoft.com/api/pcsx/position_details?position_id=${r.posId}&domain=microsoft.com&hl=en`, { retries: 3 });
      if (d.data?.data?.jobDescription) r.body = text(d.data.data.jobDescription).slice(0, 12000);
    } else if (b.type === 'apple') {
      const d = await get(`https://jobs.apple.com/api/v1/jobDetails/${r.id}`, { headers: b._h || {} });
      const j = d.data?.res; if (j) r.body = text([j.jobSummary, j.description, 'Minimum qualifications', j.minimumQualifications, 'Preferred qualifications', j.preferredQualifications, j.keyQualifications].filter(Boolean).join('\n')).slice(0, 12000);
    } else if (b.type === 'eightfold' && b.pcsx) {
      const d = await get(`${b.base}/api/pcsx/position_details?position_id=${r.id}&domain=${b.domain}&hl=en`);
      r.body = text(d.data?.data?.jobDescription || '').slice(0, 12000);
    } else if (b.type === 'icims' || b.type === 'radancy') {
      const d = await get(b.type === 'icims' ? r.url + (r.url.includes('?') ? '&' : '?') + 'in_iframe=1' : r.url, { json: false }), j = ldJob(d.text);
      r.body = text(j?.description || String(d.text || '').replace(/[\s\S]*?<body/i, '<body')).slice(0, 12000);
      if (j && !r.postedAt && b.type === 'icims') r.postedAt = iso(j.datePosted);
      if (j && b.type === 'radancy') { const L = [].concat(j.jobLocation || []).map(x => [x.address?.addressLocality, x.address?.addressRegion, x.address?.addressCountry].filter(Boolean).join(', ')).filter(Boolean); if (L.length) r.locs = L; }
    } else if (b.type === 'phenom') {
      const d = await get(r.url.includes('myworkdayjobs.com') ? `${b.base}/${b.locale || 'us/en'}/job/${r.id}/x` : r.url, { json: false });
      const m = String(d.text).match(/"description":"((?:[^"\\]|\\.)*)"/); if (m) { try { r.body = text(JSON.parse(`"${m[1]}"`)).slice(0, 12000); } catch {} }
    }
  } catch {}
}

export async function portalJobs({ hours = 48, log = () => {}, only = null, allTitles = false, file = join(ROOT, 'data', 'portal-boards.json') } = {}) {
  const cfg = await read(file, { boards: [] });
  const boards = (cfg.boards || []).filter(b => !only || only.some(o => b.company.toLowerCase().includes(o.toLowerCase())));
  const sinceMs = Date.now() - hours * 36e5;
  const stats = {};
  const rows = [];
  await pool(boards, 8, async b => {
    const t0 = Date.now(); let raw = [];
    try { raw = await ADAPTERS[b.type](b, { sinceMs }) || []; } catch (e) { stats[b.company] = { err: e.message }; return; }
    let keep = raw.filter(r => r.title && r.locs.some(okLoc) && (allTitles || (IN_LANE.test(r.title) && !OFF.test(r.title))));
    keep = keep.filter(r => !r.postedAt || Date.parse(r.postedAt) >= sinceMs - (r.postedDay || r.needsDetail ? 864e5 : 0));
    await pool(keep.filter(r => r.needsDetail || r.fetchFull || !r.body || r._oracle || r.body.length < 800), 5, r => detail(b, r));
    keep = keep.filter(r => (!r.postedAt || Date.parse(r.postedAt) >= sinceMs) && r.locs.some(okLoc));
    for (const r of keep) rows.push({ source: `Portal (${b.type})`, portal: b.type, id: `portal-${b.company.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${r.id}`, company: b.company, title: r.title, url: r.url, locations: r.locs.filter(Boolean),
      postedAt: r.postedAt, postedApprox: Boolean(r.postedApprox || r.postedDay || ['oracle', 'successfactors', 'avature', 'tencent', 'amazon', 'icims'].includes(b.type)),
       hoursAgo: r.postedAt ? Math.round((Date.now() - Date.parse(r.postedAt)) / 36e4) / 10 : null, body: r.body || '', tier: b.tier, industry: b.industry });
    stats[b.company] = { type: b.type, listed: raw.length, kept: keep.length, ms: Date.now() - t0 };
  });
  if (SEEN) { try { await writeFile(SEEN_F, JSON.stringify(SEEN)); } catch {} }
  log(`portals: ${boards.length} portals, ${rows.length} rows`);
  return Object.assign(rows, { stats });
}

if ((process.argv[1] && (await import("node:fs")).realpathSync(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const a = process.argv, arg = k => { const i = a.indexOf(k); return i > 0 ? a[i + 1] : null; };
  const t0 = Date.now();
  const rows = await portalJobs({ hours: Number(arg('--hours') || 48), only: arg('--only') ? arg('--only').split(',') : null, allTitles: a.includes('--all-titles'), log: console.error });
  if (a.includes('--print')) {
    for (const r of rows.sort((x, y) => (x.hoursAgo ?? 99) - (y.hoursAgo ?? 99))) console.log(`${String(r.hoursAgo ?? '?').padStart(5)}h  ${r.company.padEnd(22)} ${r.title.slice(0, 60).padEnd(60)} ${r.locations[0] || ''}  [${r.portal}]`);
    const byType = {}; for (const [c, s] of Object.entries(rows.stats)) { const t = s.type || 'error'; (byType[t] ||= { boards: 0, listed: 0, kept: 0, ms: 0 }); byType[t].boards++; byType[t].listed += s.listed || 0; byType[t].kept += s.kept || 0; byType[t].ms += s.ms || 0; }
    console.error(JSON.stringify(byType)); const errs = Object.entries(rows.stats).filter(([, s]) => s.err || s.listed === 0); if (errs.length) console.error('empty/errors:', errs.map(([c, s]) => `${c}${s.err ? '(' + s.err + ')' : ''}`).join(', '));
  } else console.log(JSON.stringify(rows));
  console.error(`total ${rows.length} rows in ${Math.round((Date.now() - t0) / 1000)}s`);
}
