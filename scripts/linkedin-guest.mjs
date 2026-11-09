import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
export const NYC_GEO = 'geoId=90000070&location=New%20York%20City%20Metropolitan%20Area';
export const KEYWORDS = ['lifecycle marketing', 'CRM manager', 'CRM marketing', 'retention marketing', 'loyalty marketing',
  'customer marketing manager', 'customer value management', 'personalization manager', 'growth marketing manager',
  'monetization', 'pricing strategy', 'product marketing manager', 'growth product manager', 'product manager consumer',
  'product manager fintech', 'associate product manager', 'strategy and operations', 'customer strategy consultant',
  'management consultant', 'digital banking product', 'chief of staff', 'email marketing manager', 'digital channels manager'];

export const US_GEO = 'geoId=103644278&location=United%20States';
export const BROAD_KEYWORDS = ['product manager', 'associate product manager', 'product marketing manager', 'brand manager',
  'lifecycle marketing', 'CRM marketing', 'retention marketing', 'customer marketing', 'growth marketing manager', 'marketing manager',
  'strategy and operations', 'business operations manager', 'chief of staff', 'program manager', 'project manager', 'strategy manager',
  'corporate strategy', 'management consultant', 'technology consultant', 'digital transformation', 'IT strategy', 'product operations',
  'technical program manager', 'innovation manager', 'AI strategy', 'AI product manager', 'AI product marketing', 'AI transformation',
  'generative AI', 'agentic', 'AI adoption', 'AI solutions', 'conversational AI', 'data strategy', 'implementation manager', 'IT governance',
  'vendor management', 'analytics manager', 'insights manager', 'business intelligence manager', 'senior business analyst',
  'operations manager', 'program officer', 'international development', 'pricing manager', 'monetization',
  'business analyst', 'operations strategy', 'customer insights', 'digital product manager', 'strategic partnerships', 'marketing operations',
  'revenue strategy', 'customer experience manager', 'strategic initiatives', 'PMO',
  'marketing technology manager', 'martech product manager', 'CRM product owner', 'lifecycle product manager', 'customer data platform',
  'business systems manager', 'product owner payments',
  'associate product manager', 'product analyst', 'marketing analyst', 'growth analyst', 'strategy analyst', 'business operations analyst',
  'marketing associate', 'strategy associate', 'product marketing associate', 'CRM specialist', 'lifecycle marketing specialist',
  'marketing specialist', 'AI analyst', 'pricing analyst', 'consulting analyst', 'associate consultant',
  'product management intern', 'product marketing intern', 'marketing intern', 'strategy intern', 'AI intern', 'business analyst intern',
  'MBA intern', 'graduate intern',
  'development program', 'leadership development program', 'rotational program', 'associate program', 'graduate program',
  'early career program', 'MBA associate', 'strategy associate program', 'marketing rotational', 'fellowship',
  'contract marketing manager', 'contract product manager', 'CRM consultant contract', 'lifecycle marketing contract', 'part-time marketing manager',
  'spring 2027 internship', 'january 2027 start', 'marketing fellowship', 'technology fellowship', 'product management internship 2027',
  'solutions consultant', 'solutions engineer', 'technical account manager', 'implementation consultant', 'forward deployed',
  'AI automation', 'AI deployment', 'data analyst', 'business systems analyst', 'technical product manager',
  'data analyst intern', 'technology intern', 'AI engineer intern',
  'lifecycle marketing manager', 'CRM manager', 'CRM associate', 'growth marketing associate', 'growth associate',
  'strategy and operations associate', 'business operations associate', 'digital transformation analyst', 'AI strategy associate',
  'monetization analyst', 'pricing strategy', 'product strategy associate', 'product operations analyst'];

export const OFF = /trust (and|&) safety|code review|agentic|\bai agents?\b|developer|platform|infrastructure|security|data platform|\bml\b|machine learning|technical project|\bsales\b|account exec|events|paid (marketing|media|acquisition|social|search)|performance marketing|new grad|intern|recruit|coordinator|dynamics|salesforce admin|project manager|technical|robotics|engineer/i;
export const TOO_SENIOR = /\b(director|svp|evp|senior vice president|executive vice president|managing director|partner|chief)\b(?!\s+of\s+staff)/i;
export const IN_LANE = /digital channels?|omnichannel|omni-channel|channel strategy|owned (?:media|channels?)|digital banking|digital engagement|personali[sz]ation|lifecycle|crm|retention|growth|customer|engagement|loyalty|monetization|activation|pricing|product marketing|go.to.market|gtm|consumer|chief of staff|email marketing|product manager|product owner|associate product|strateg|consult|operations/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.text();
}

export async function searchPage(kw, start = 0, { geo = NYC_GEO, extra = 'f_TPR=r86400' } = {}) {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(kw)}&${geo}&${extra}&start=${start}`;
  const html = await get(url);
  const out = [];
  for (const li of html.split('<li>').slice(1)) {
    const id = (li.match(/jobPosting:(\d+)/) || [])[1];
    const title = decode((li.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    const company = decode(((li.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/) || [])[1] || '').replace(/<[^>]+>/g, ''));
    const location = decode((li.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
    const postedAt = (li.match(/datetime="([^"]+)"/) || [])[1] || null;
    if (id && title && company) out.push({ id, title, company, location, postedAt, url: `https://www.linkedin.com/jobs/view/${id}`, kw });
  }
  return out;
}

export async function searchAll(keywords = KEYWORDS, { pages = [0, 10, 20, 30], delay = 900, geo, extra, log = () => {}, deadline = 0 } = {}) {
  const cards = new Map();
  let r429 = 0;
  for (const kw of keywords) {
    if (deadline && Date.now() > deadline) { log(`linkedin-guest: time budget reached, skipping the remaining keywords from "${kw}"`); break; }
    if (r429 >= 3) { log(`linkedin-guest: 3 rate limits in a row, skipping the remaining keywords from "${kw}"`); break; }
    for (const start of pages) {
      let got = [];
      try { got = await searchPage(kw, start, { geo, extra }); r429 = 0; }
      catch (e) {
        if (/^429/.test(e.message)) { await sleep(10000); try { got = await searchPage(kw, start, { geo, extra }); r429 = 0; } catch (e2) { if (/^429/.test(e2.message)) r429++; log(`search failed ${kw}@${start}: ${e2.message}`); await sleep(delay * 3); break; } }
        else { log(`search failed ${kw}@${start}: ${e.message}`); await sleep(delay * 3); break; }
      }
      for (const c of got) if (!cards.has(c.id)) cards.set(c.id, c);
      await sleep(delay);
      if (got.length < 10) break;
    }
  }
  return cards;
}

export async function fetchDetail(id) {
  const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
  const desc = (html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
  const plain = decode(desc.replace(/<br\s*\/?>|<\/(p|li|ul|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '));
  const applicantsText = decode((html.match(/num-applicants__caption[^>]*>([\s\S]*?)<\//) || [])[1] ||
    (html.match(/num-applicants__figure[^>]*>([\s\S]*?)<\//) || [])[1]);
  let applicants = null;
  if (/first\s+(\d+)/i.test(applicantsText)) applicants = Number(applicantsText.match(/first\s+(\d+)/i)[1]) - 1;
  else if (/(\d[\d,]*)/.test(applicantsText)) applicants = Number(applicantsText.match(/(\d[\d,]*)/)[1].replace(/,/g, ''));
  const agoText = decode((html.match(/posted-time-ago__text[^>]*>([\s\S]*?)<\//) || [])[1]);
  const n = Number((agoText.match(/(\d+)/) || [])[1]);
  const hoursAgo = /minute/i.test(agoText) ? 0 : /hour/i.test(agoText) ? n : /day/i.test(agoText) ? n * 24 : /week/i.test(agoText) ? n * 168 : /month/i.test(agoText) ? n * 720 : null;
  const criteria = {};
  for (const m of html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>[\s\S]*?description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)) criteria[decode(m[1])] = decode(m[2]);
  const location = decode((html.match(/topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
  const title = decode(((html.match(/topcard__title[^>]*>([\s\S]*?)<\/h[1-3]>/) || [])[1] || '').replace(/<[^>]+>/g, ' '));
  const company = decode(((html.match(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/) || html.match(/topcard__flavor(?![-\w])[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '').replace(/<[^>]+>/g, ' '));
  return { title: title || null, company: company || null, description: desc, descriptionPlain: plain, applicantsText: applicantsText || null, applicants, agoText, hoursAgo, criteria, location, closed: /no longer accepting applications/i.test(html) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) { // realpath: ~/Documents/GitHub/sponsorpath is a symlink
  const DRY = process.argv.includes('--dry-run');
  const cards = await searchAll(KEYWORDS, { log: m => console.warn(m) });
  const kept = [...cards.values()].filter(c => IN_LANE.test(c.title) && !OFF.test(c.title) && !TOO_SENIOR.test(c.title));
  console.log(`linkedin-guest: ${cards.size} postings in the last 24h (NYC metro), ${kept.length} in lane`);
  const out = [];
  for (const c of kept.slice(0, 60)) {
    try {
      const d = await fetchDetail(c.id);
      out.push({ company: c.company, title: c.title, url: c.url, location: c.location, postedAt: c.postedAt,
        description: d.description, source: 'linkedin-guest', applicants: d.applicantsText, applicantCount: d.applicants });
    } catch (e) { console.warn('detail failed', c.id, e.message); }
    await sleep(1200);
  }
  const file = join(ROOT, 'data', 'linkedin-guest-latest.json');
  await writeFile(file, JSON.stringify(out, null, 1));
  console.log(`linkedin-guest: ${out.length} with descriptions -> ${file}`);
  for (const j of out.slice(0, 15)) console.log(`  ${j.company} | ${j.title} | ${j.location} | ${j.applicants || '?'}`);
  if (!DRY && out.length) execFileSync(process.execPath, [join(ROOT, 'scripts', 'ingest-jobs.mjs'), file], { stdio: 'inherit' });
}
