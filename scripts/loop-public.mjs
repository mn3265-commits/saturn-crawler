import { isUSLocation, isRemoteText } from './us-location.mjs';


export const PREFERRED_HOURS = 24;
export const RECENT_DAYS = 3;
export const CAP_EXEMPT_DAYS = 60;
export const CAP_EXEMPT_CO = /\bcolumbia university\b|^columbia$|columbia (?:business school|irving|sps|school of)|teachers college|barnard college|new york university|^nyu\b|nyu langone|langone health|mount sinai|memorial sloan|\bmskcc\b|sloan kettering|rockefeller university|weill cornell|cornell university|\bcuny\b|city university of new york|\bsuny\b|\buniversity\b|\bcollege\b(?! board)|teaching hospital|\bhospital\b|medical center|health system|school of medicine|research (?:institute|foundation|center)|howard hughes|broad institute|flatiron institute|simons foundation|allen institute|cold spring harbor|salk institute|new york genome center|\bnyu\b/i;
export const MULTILATERAL_CO = /united nations|\bundp\b|\bunicef\b|\bunops\b|\bunfpa\b|\bunhcr\b|\bunesco\b|\bun women\b|world bank|\bifc\b|international finance corporation|international monetary fund|\bimf\b|inter-american development bank|\biadb\b|asian development bank|\boecd\b|world food programme|\bwfp\b|world health organization|international organization for migration|\bgavi\b|global fund|african development bank|european bank for reconstruction/i;
export const capExempt = company => CAP_EXEMPT_CO.test(String(company || ''));
export const multilateral = company => MULTILATERAL_CO.test(String(company || ''));
export const PRIORITY_DAYS = 3;
export const AI_TITLE = /\b(ai|artificial intelligence|genai|gen ai|generative|agentic|llm|machine learning|copilot|conversational)\b/i;
export const LOWER_DAYS = 5;
export const LOWER_RUNG = t => /\b(intern|internship|co-?op|associate|analyst|specialist|coordinator|apm|junior|jr\.?|entry[- ]level|new grad(?:uate)?|rotational|rotation|development program|leadership program|graduate program|early career|fellow(?:ship)?|trainee|ldp)\b/i.test(t || '')
  && !/\b(senior|sr\.?|lead|principal|staff|director|head|vp|vice president|manager)\b/i.test(String(t || '').replace(/associate product manager|associate manager/ig, ''));
export const CW_GRC = t => /\b(grc|governance,? risk|cyber ?security (?:risk|grc|governance|compliance|awareness|program|analyst|associate|specialist|coordinator)|information security (?:risk|governance|compliance|analyst|associate|specialist)|security (?:awareness|risk|governance|compliance|program)|it (?:audit|controls?|risk|compliance|governance)|itgc|sox\b|technology risk|tech risk)\b/i.test(t || '')
  && !/\b(engineer|engineering|architect|developer|penetration|pen ?test|soc analyst|red team)\b/i.test(t || '');
export const POST_SALES_SEAT = t => /\bpost[- ]?sales?\b/i.test(t || '') && /\b(implementation|onboarding|solutions?|customer success|support|delivery|enablement)\b/i.test(t || '')
  && !/\b(senior|sr\.?|staff|principal|lead|head|director|vp)\b/i.test(t || '');
export const CORE_DAYS = 7;
export const CORE_FRESH = /\b(lifecycle|crm|retention|loyalty|customer (?:marketing|engagement|lifecycle)|email marketing|marketing automation)\b/i;
export const HEAVY_TECH = /\b(software|backend|back-end|front-?end|full[- ]?stack|ml|machine learning|deep learning|data engineer|data platform|infrastructure|platform|devops|sre|site reliability|firmware|embedded|hardware|mechanical|electrical|civil|chemical|structural|security engineer|cloud engineer|network engineer|compiler|kernel|robotics|research|scientist|ios|android|mobile)\b/i;
export const LIGHT_TECH = t => /\bengineer/i.test(t || '') && !HEAVY_TECH.test(t || '') && !/\b(senior|sr\.?|staff|principal|lead|head|director|manager)\b/i.test(t || '')
  && (LOWER_RUNG(t) || /\b(implementation|solutions?|support|integration|automation|ai enablement|prompt|onboarding|customer|technical account|analytics|forward deployed|deployment|sales)\b/i.test(t || ''));
export const PICKED_SEAT = t => /\brevenue architect\b/i.test(t || '') && !/\b(staff|principal|head|director|vp|vice president)\b/i.test(t || '');
export const freshWindowDays = (company, { title = '', priority = false } = {}) =>
  capExempt(company) || multilateral(company) ? CAP_EXEMPT_DAYS : CORE_FRESH.test(title || '') ? CORE_DAYS : LOWER_RUNG(title) ? LOWER_DAYS : (priority || AI_TITLE.test(title || '')) ? PRIORITY_DAYS : RECENT_DAYS;

export const NYC_METRO = /new york|\bnyc\b|manhattan|brooklyn|queens|bronx|staten island|long island city|westchester|white plains|purchase, ny|harrison, ny|jersey city|hoboken|newark|weehawken|basking ridge|new jersey|, nj\b|stamford|greenwich|norwalk/i;
export const US_METROS = {
  'SF Bay Area': /san francisco|bay area|silicon valley|oakland|san jose|palo alto|mountain view|menlo park|sunnyvale|redwood city|san mateo|santa clara|cupertino|emeryville|berkeley|foster city|burlingame|san bruno|fremont, ca/i,
  Boston: /boston|cambridge, ma|somerville|waltham|burlington, ma|lexington, ma|needham|woburn|newton, ma|quincy, ma|bedford, ma|watertown, ma/i,
  DC: /washington,? d\.?c|\bd\.c\.|\bdc\b|district of columbia|arlington,? (?:va|virginia)|alexandria,? va|bethesda|reston|mclean|tysons|herndon|rockville|silver spring|chevy chase|chantilly/i,
  Chicago: /chicago|evanston|oak brook|deerfield, il|northbrook|schaumburg/i,
  Seattle: /seattle|bellevue|redmond|kirkland/i,
  LA: /los angeles|santa monica|culver city|burbank|glendale, ca|pasadena|el segundo|playa vista|beverly hills|long beach|hollywood|irvine|venice, ca|marina del rey/i,
  Austin: /austin|round rock/i,
  Denver: /denver|boulder|broomfield|englewood, co|golden, co|aurora, co/i,
  'San Diego': /san diego|la jolla|carlsbad/i,
  Miami: /miami|fort lauderdale|boca raton|coral gables|doral|west palm beach/i,
};
export const INTL_CITIES = { London: /\blondon\b(?!,? (?:on|ontario|ky|kentucky|oh)\b)/i, Amsterdam: /\bamsterdam\b/i, Berlin: /\bberlin\b/i, Munich: /\bmunich\b|m[uü]nchen/i, Stockholm: /\bstockholm\b/i, Tokyo: /\btokyo\b/i };
const metroOf = l => { if (NYC_METRO.test(l) && !/\b(?:buffalo|rochester|syracuse|albany|ithaca)\b/i.test(l)) return 'NYC metro'; for (const [k, re] of Object.entries(US_METROS)) if (re.test(l)) return k; return null; };
const intlOf = l => { for (const [k, re] of Object.entries(INTL_CITIES)) if (re.test(l)) return k; return null; };
const REMOTE_NON_US = /\b(?:uk|united kingdom|canada|europe|emea|apac|latam|india|germany|ireland|netherlands|australia|singapore|mexico|brazil|spain|poland|portugal|philippines)\b/i;
export function loopLocation(loc) {
  const l = String(loc || '').trim();
  if (!l) return { cls: 'unknown', ok: false };
  const m = metroOf(l);
  if (m && (isUSLocation(l) || m === 'NYC metro' || !intlOf(l))) return { cls: m, ok: true };
  if (isRemoteText(l) && !REMOTE_NON_US.test(l) && !intlOf(l)) return { cls: 'Remote US', ok: true };
  if (/^(?:us|u\.s\.?|usa|united states(?: of america)?)$/i.test(l)) return { cls: 'Remote US', ok: true };
  if (isUSLocation(l)) return { cls: 'US other', ok: true };
  const c = intlOf(l);
  if (c) return { cls: `Abroad (${c})`, ok: true };
  return { cls: 'non-US other', ok: false };
}
const RANK = c => (c === 'NYC metro' ? 0 : c === 'Remote US' ? 1 : /^Abroad/.test(c) ? 3 : 2);
export function loopLocations(locs = []) {
  const v = (locs || []).flatMap(x => String(x || '').split(/\s*(?:;|\||\/|\bor\b)\s*/i)).map(x => x.trim()).filter(Boolean)
    .map(x => ({ SF: 'San Francisco, CA', NYC: 'New York, NY', LA: 'Los Angeles, CA', DC: 'Washington, DC', 'Bay Area': 'San Francisco, CA' }[x] || x))
    .map(l => ({ l, ...loopLocation(l) }));
  const ok = v.filter(x => x.ok).sort((a, b) => RANK(a.cls) - RANK(b.cls));
  if (ok.length) return { ok: true, cls: ok[0].cls, loc: ok[0].l, abroad: /^Abroad/.test(ok[0].cls) };
  if (!v.length) return { ok: false, cls: 'unknown', reason: 'no location' };
  const us = v.find(x => x.cls === 'US other');
  return us ? { ok: false, cls: 'US other', reason: `US city outside the loop metro list (${us.l})` }
    : { ok: false, cls: 'non-US other', reason: `non-US city not on the loop list (${v.slice(0, 3).map(x => x.l).join(' / ')})` };
}
export const LOOP_LOC = { test: l => loopLocation(l).ok };
