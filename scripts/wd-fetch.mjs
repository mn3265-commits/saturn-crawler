import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const UA_DEFAULT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
let IMP;
function impersonateBin() {
  if (IMP !== undefined) return IMP;
  IMP = null;
  for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/home/linuxbrew/.linuxbrew/bin', '/usr/bin']) {
    try { if (!existsSync(d)) continue;
      const b = readdirSync(d).filter(f => /^curl_chrome\d+$/.test(f)).sort((a, z) => Number(z.slice(11)) - Number(a.slice(11)))[0];
      if (b) { IMP = `${d}/${b}`; break; } } catch {}
  }
  return IMP;
}

function run(bin, url, { json = true, method = 'GET', body, headers = {}, ua, timeoutSec = 20 }, impersonate) {
  return new Promise(res => {
    const a = ['-s', '-L', '-m', String(timeoutSec), '-w', '\n%{http_code}'];
    if (!impersonate) a.push('-A', ua || UA_DEFAULT);
    a.push('-H', `Accept: ${json ? 'application/json' : 'text/html'}`);
    for (const [k, v] of Object.entries(headers || {})) if (!/^user-agent$/i.test(k)) a.push('-H', `${k}: ${v}`);
    if (method === 'POST') a.push('-X', 'POST', '--data-binary', String(body ?? ''));
    execFile(bin, [...a, url], { maxBuffer: 32 << 20 }, (e, out) => {
      out = String(out || ''); const i = out.lastIndexOf('\n'), status = Number(out.slice(i + 1)); if (!status) return res(null);
      const text = out.slice(0, i); let data = null; if (json) { try { data = JSON.parse(text); } catch {} }
      res({ status, url, data, text });
    });
  });
}

export const wdStats = { curl: 0, impersonate: 0, blocked: 0 };
export async function wdEscape(url, opts = {}) {
  const c = await run('curl', url, opts, false);
  if (c && c.status !== 429 && c.status !== 403) { wdStats.curl++; return { ...c, via: 'curl' }; }
  const bin = impersonateBin();
  if (bin) { const i = await run(bin, url, opts, true); if (i && i.status !== 429 && i.status !== 403) { wdStats.impersonate++; return { ...i, via: 'impersonate' }; } }
  wdStats.blocked++;
  return c;
}
