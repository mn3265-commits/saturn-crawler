export const REFUSALS = [
  /\b(?:unable|not able|cannot|can ?not|can't|won't|will not|do(?:es)? not|are not|is not|no longer)\s+(?:to\s+)?(?:currently\s+)?(?:be\s+able\s+to\s+)?(?:provide|offer|support|consider|accommodate|pursue|file|extend)\w*\b[^.?!]{0,60}?\b(?:sponsor\w*|visas?|h-?1b)\b/i,
  /\b(?:unable|not able|cannot|can ?not|can't|won't|will not|do(?:es)? not|are not|no longer)\s+(?:to\s+)?(?:currently\s+)?sponsor\b/i,
  /\bno\s+(?:visa\s+|employment\s+|work\s+|h-?1b\s+)?sponsorship\b(?!\s+(?:is\s+)?(?:required|needed|necessary))/i,
  /\bsponsorship\s+(?:is\s+|will\s+)?(?:not|un)\s*(?:be\s+)?(?:available|offered|provided|possible|supported)/i,
  /\bnot\s+(?:eligible|open)\s+(?:for|to)\s+(?:visa\s+|employment\s+)?sponsorship/i,
  /\b(?:must|required to|need to)\s+be\s+(?:currently\s+|legally\s+)*(?:authorized|eligible)[^?!]{0,90}?\bwithout\s+(?:the\s+need\s+for\s+|requiring\s+|needing\s+)?(?:current\s+or\s+future\s+|now\s+or\s+in\s+the\s+future\s+)?(?:visa\s+|employer\s+|employment\s+|company\s+)?sponsor/i,
  /\bonly\s+(?:u\.?s\.?\s+)?citizens\b|\bu\.?s\.?\s+citizenship\s+(?:is\s+)?required\b/i,
  /not eligible for (?:(?:current|future|any|present)(?:\s+(?:or|and|\/)\s+(?:current|future))?\s+)?(?:visa |immigration |work )?(?:visa |immigration )?sponsorship/i,
  /\bineligible for (?:(?:current|future|any)\s+(?:or\s+(?:current|future)\s+)?)?(?:(?:employment|visa|immigration|work)[- ])*(?:visa\s+)?sponsorship/i,
];
export function findRefusal(text) {
  const t = String(text || '');
  for (const re of REFUSALS) {
    const m = t.match(re);
    if (m) { const i = m.index; return t.slice(Math.max(0, i - 60), i + m[0].length + 40).replace(/\s+/g, ' ').trim(); }
  }
  return null;
}

