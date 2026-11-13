const sq = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const bare = s => sq(String(s || '').replace(/\b(the|inc|llc|corp|corporation|co|company|companies|group|holdings|plc|ltd)\b\.?/gi, ' '));
export function makeNamer(targetBoards = [], extraNames = []) {
  const byKey = new Map(), byBrand = new Map();
  for (const b of targetBoards) {
    const t = b.ats === 'greenhouse' ? 'gh' : b.ats;
    if (b.ats === 'workday') { byKey.set(`workday|${sq(b.tenant)}|${sq(b.site)}`, b.company); if (!byKey.has(`workday|${sq(b.tenant)}`)) byKey.set(`workday|${sq(b.tenant)}`, b.company); }
    else byKey.set(`${t}|${sq(b.token)}`, b.company);
  }
  for (const n of [...targetBoards.map(b => b.company), ...extraNames]) { const k = bare(n); if (k.length >= 4 && !byBrand.has(k)) byBrand.set(k, n); }
  return {
    board(label, type, token, site) {
      const t = type === 'greenhouse' ? 'gh' : type;
      if (t === 'workday') { const tenant = sq(String(token).split('.')[0]); return byKey.get(`workday|${tenant}|${sq(site)}`) || byKey.get(`workday|${tenant}`) || label; }
      return byKey.get(`${t}|${sq(token)}`) || label;
    },
    host(label, url) {
      let h = ''; try { h = new URL(/^https?:/.test(url) ? url : 'https://' + url).hostname; } catch { return label; }
      const parts = h.split('.'), brand = /eightfold\.ai$|icims\.com$|avature\.net$/.test(h) ? parts[0].replace(/^(us)?careers-|^jobs-/, '') : parts[parts.length - 2];
      if (!brand || bare(label).includes(sq(brand))) return label;
      return byBrand.get(sq(brand)) || label;
    },
  };
}
