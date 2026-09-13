// فحص الـ DNS — node:dns المدمج
import { Resolver, promises as dnsp } from 'node:dns';
import { URL } from 'node:url';

/** يحل الدومين ويقرأ سجلاته الأساسية مع قياس الزمن */
export async function inspectDNS(urlStr, { timeout = 5000 } = {}) {
  let host;
  try {
    host = new URL(urlStr).hostname;
  } catch {
    return { ok: false, reason: 'رابط غير صالح' };
  }

  const started = Date.now();
  const withTimeout = (p, fallback = null) =>
    Promise.race([
      p.catch(() => fallback),
      new Promise((r) => setTimeout(() => r(fallback), timeout)),
    ]);

  const [addr4, addr6, ns, mx, txt] = await Promise.all([
    withTimeout(dnsp.resolve4(host), []),
    withTimeout(dnsp.resolve6(host), []),
    withTimeout(dnsp.resolveNs(baseDomain(host)), []),
    withTimeout(dnsp.resolveMx(baseDomain(host)), []),
    withTimeout(dnsp.resolveTxt(baseDomain(host)), []),
  ]);

  const ms = Date.now() - started;
  const ips = [...(addr4 || []), ...(addr6 || [])];
  const flat = (txt || []).map((r) => (Array.isArray(r) ? r.join('') : r));

  return {
    ok: ips.length > 0,
    ms,
    host,
    ips: ips.slice(0, 6),
    nameservers: (ns || []).slice(0, 6),
    hasMX: (mx || []).length > 0,
    mx: (mx || []).slice(0, 4).map((m) => m.exchange),
    hasSPF: flat.some((t) => t.toLowerCase().startsWith('v=spf1')),
    hasDMARC: false, // يتملي في inspectDMARC
    provider: guessProvider((ns || []).map((n) => n.toLowerCase()).join(' ')),
  };
}

/** DMARC بيتخزن على _dmarc.example.com */
export async function inspectDMARC(urlStr, { timeout = 6000 } = {}) {
  try {
    const host = baseDomain(new URL(urlStr).hostname);
    const rec = await Promise.race([
      dnsp.resolveTxt(`_dmarc.${host}`).catch(() => []),
      new Promise((r) => setTimeout(() => r([]), timeout)),
    ]);
    const flat = (rec || []).map((r) => (Array.isArray(r) ? r.join('') : r));
    return flat.some((t) => t.toLowerCase().startsWith('v=dmarc1'));
  } catch {
    return false;
  }
}

/** تقريب معقول للدومين الأساسي — يتعامل مع .com.eg و .co.uk */
export function baseDomain(host) {
  const parts = String(host).split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const twoLevel = ['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'mil'];
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (last.length === 2 && twoLevel.includes(secondLast)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

/** نستنتج مزود الـ DNS/الاستضافة من الـ nameservers — بدون WHOIS خارجي */
function guessProvider(nsText) {
  const rules = [
    [/cloudflare/, 'Cloudflare'],
    [/awsdns/, 'AWS Route 53'],
    [/googledomains|google/, 'Google'],
    [/azure-dns/, 'Microsoft Azure'],
    [/digitalocean/, 'DigitalOcean'],
    [/hostinger|hostinger\.com/, 'Hostinger'],
    [/namecheap|registrar-servers/, 'Namecheap'],
    [/godaddy|domaincontrol/, 'GoDaddy'],
    [/bluehost/, 'Bluehost'],
    [/siteground/, 'SiteGround'],
    [/wpengine/, 'WP Engine'],
    [/kinsta/, 'Kinsta'],
    [/shopify/, 'Shopify'],
    [/wixdns/, 'Wix'],
    [/squarespace/, 'Squarespace'],
    [/vercel/, 'Vercel'],
    [/netlify/, 'Netlify'],
    [/ovh/, 'OVH'],
    [/hetzner/, 'Hetzner'],
    [/contabo/, 'Contabo'],
  ];
  for (const [re, name] of rules) if (re.test(nsText)) return name;
  return null;
}
