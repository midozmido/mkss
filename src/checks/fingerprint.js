// محرك بصمات المنصات — قواعد داخلية بالكامل، لا Wappalyzer ولا أي API خارجي.
// الفكرة: كل إشارة ليها وزن، والمنصة اللي تجمع أعلى وزن هي الناتج، مع نسبة ثقة.

/**
 * كل قاعدة: { re, w, where, note }
 *  where: 'html' | 'headers' | 'cookies' | 'url'
 *  w: الوزن (كل ما زاد كل ما كانت الإشارة قاطعة أكتر)
 */
const PLATFORMS = {
  wordpress: {
    label: 'ووردبريس',
    en: 'WordPress',
    color: '#21759b',
    rules: [
      { re: /\/wp-content\//i, w: 45, where: 'html', note: 'مسار wp-content' },
      { re: /\/wp-includes\//i, w: 40, where: 'html', note: 'مسار wp-includes' },
      { re: /<meta[^>]+name=["']generator["'][^>]+WordPress/i, w: 50, where: 'html', note: 'وسم generator' },
      { re: /\/wp-json\//i, w: 30, where: 'html', note: 'REST API' },
      { re: /wp-emoji-release/i, w: 25, where: 'html' },
      { re: /wp-block-library/i, w: 25, where: 'html' },
      { re: /^wordpress_|^wp-settings|^wp_/i, w: 35, where: 'cookies' },
      { re: /\/wp-json\//i, w: 30, where: 'headers', note: 'رابط REST في الهيدر' },
    ],
    version: [/<meta[^>]+name=["']generator["'][^>]+WordPress\s+([\d.]+)/i],
  },
  shopify: {
    label: 'شوبيفاي',
    en: 'Shopify',
    color: '#95bf47',
    rules: [
      { re: /cdn\.shopify\.com/i, w: 50, where: 'html', note: 'CDN شوبيفاي' },
      { re: /Shopify\.theme|Shopify\.shop|window\.Shopify/i, w: 50, where: 'html', note: 'كائن Shopify' },
      { re: /shopify-section/i, w: 30, where: 'html' },
      { re: /x-shopify-stage|x-shopid|x-shardid/i, w: 55, where: 'headers', note: 'هيدر شوبيفاي' },
      { re: /_shopify_y|_shopify_s|_secure_session_id/i, w: 40, where: 'cookies' },
      { re: /myshopify\.com/i, w: 35, where: 'html' },
    ],
  },
  salla: {
    label: 'سلة',
    en: 'Salla',
    color: '#004d5a',
    rules: [
      { re: /salla\.sa|cdn\.salla\.network|salla\.dev/i, w: 50, where: 'html', note: 'أصول سلة' },
      { re: /salla-|s-block|window\.salla/i, w: 40, where: 'html' },
      { re: /x-salla|salla/i, w: 45, where: 'headers' },
    ],
  },
  zid: {
    label: 'زد',
    en: 'Zid',
    color: '#5c39d4',
    rules: [
      { re: /zid\.store|cdn\.zid\.sa|zidapi/i, w: 50, where: 'html', note: 'أصول زد' },
      { re: /window\.zid|zid-app/i, w: 40, where: 'html' },
      { re: /x-zid/i, w: 45, where: 'headers' },
    ],
  },
  woocommerce: {
    label: 'ووكومرس',
    en: 'WooCommerce',
    color: '#7f54b3',
    isAddon: 'wordpress',
    rules: [
      { re: /woocommerce/i, w: 40, where: 'html', note: 'أصول ووكومرس' },
      { re: /wc-ajax|wc_add_to_cart/i, w: 35, where: 'html' },
      { re: /woocommerce_items_in_cart|woocommerce_cart_hash/i, w: 40, where: 'cookies' },
    ],
    version: [/<meta[^>]+name=["']generator["'][^>]+WooCommerce\s+([\d.]+)/i],
  },
  wix: {
    label: 'ويكس',
    en: 'Wix',
    color: '#0c6efc',
    rules: [
      { re: /static\.wixstatic\.com|wix\.com/i, w: 50, where: 'html' },
      { re: /X-Wix-Request-Id|x-wix-/i, w: 55, where: 'headers' },
      { re: /<meta[^>]+content=["']Wix\.com/i, w: 50, where: 'html' },
    ],
  },
  squarespace: {
    label: 'سكوير سبيس',
    en: 'Squarespace',
    color: '#000000',
    rules: [
      { re: /squarespace\.com|static1\.squarespace/i, w: 50, where: 'html' },
      { re: /Squarespace/i, w: 45, where: 'headers' },
      { re: /SQUARESPACE_ROLLUPS|Static\.SQUARESPACE_CONTEXT/i, w: 50, where: 'html' },
    ],
  },
  webflow: {
    label: 'ويب فلو',
    en: 'Webflow',
    color: '#4353ff',
    rules: [
      { re: /<meta[^>]+content=["']Webflow["']/i, w: 50, where: 'html' },
      { re: /assets\.website-files\.com|cdn\.prod\.website-files\.com/i, w: 45, where: 'html' },
      { re: /data-wf-page|data-wf-site/i, w: 45, where: 'html' },
    ],
  },
  magento: {
    label: 'ماجنتو',
    en: 'Magento',
    color: '#ee672f',
    rules: [
      { re: /\/static\/version\d+\/frontend\//i, w: 45, where: 'html' },
      { re: /Magento_|mage\/|requirejs\/require\.js/i, w: 35, where: 'html' },
      { re: /X-Magento/i, w: 50, where: 'headers' },
      { re: /mage-cache-storage|form_key/i, w: 30, where: 'cookies' },
    ],
  },
  opencart: {
    label: 'أوبن كارت',
    en: 'OpenCart',
    color: '#1c98d8',
    rules: [
      { re: /catalog\/view\/theme|index\.php\?route=/i, w: 45, where: 'html' },
      { re: /OCSESSID/i, w: 45, where: 'cookies' },
    ],
  },
  prestashop: {
    label: 'بريستاشوب',
    en: 'PrestaShop',
    color: '#df0067',
    rules: [
      { re: /<meta[^>]+content=["']PrestaShop/i, w: 50, where: 'html' },
      { re: /prestashop|PrestaShop/i, w: 30, where: 'html' },
      { re: /PrestaShop-/i, w: 40, where: 'cookies' },
    ],
  },
  joomla: {
    label: 'جوملا',
    en: 'Joomla',
    color: '#5091cd',
    rules: [
      { re: /<meta[^>]+name=["']generator["'][^>]+Joomla/i, w: 50, where: 'html' },
      { re: /\/media\/jui\/|\/media\/system\/js\//i, w: 40, where: 'html' },
      { re: /joomla_user_state/i, w: 40, where: 'cookies' },
    ],
  },
  drupal: {
    label: 'دروبال',
    en: 'Drupal',
    color: '#0678be',
    rules: [
      { re: /<meta[^>]+name=["']generator["'][^>]+Drupal/i, w: 50, where: 'html' },
      { re: /\/sites\/default\/files\/|drupal-settings-json/i, w: 40, where: 'html' },
      { re: /X-Drupal-Cache|X-Generator.*Drupal/i, w: 50, where: 'headers' },
    ],
  },
  ghost: {
    label: 'جوست',
    en: 'Ghost',
    color: '#15171a',
    rules: [
      { re: /<meta[^>]+name=["']generator["'][^>]+Ghost/i, w: 50, where: 'html' },
      { re: /ghost-|\/ghost\/api\//i, w: 30, where: 'html' },
    ],
  },
  bigcommerce: {
    label: 'بيج كوميرس',
    en: 'BigCommerce',
    color: '#121118',
    rules: [
      { re: /cdn\d*\.bigcommerce\.com|stencil/i, w: 45, where: 'html' },
      { re: /X-BC-|bigcommerce/i, w: 45, where: 'headers' },
    ],
  },
  framer: {
    label: 'فريمر',
    en: 'Framer',
    color: '#0055ff',
    rules: [
      { re: /framerusercontent\.com/i, w: 50, where: 'html' },
      { re: /<meta[^>]+content=["']Framer/i, w: 50, where: 'html' },
    ],
  },
  duda: {
    label: 'دودا',
    en: 'Duda',
    color: '#18d2b0',
    rules: [
      { re: /irp\.cdn-website\.com|dudaone|_dm_/i, w: 45, where: 'html' },
    ],
  },
  weebly: {
    label: 'ويبلي',
    en: 'Weebly',
    color: '#1c7cba',
    rules: [
      { re: /weebly\.com|editmysite\.com/i, w: 45, where: 'html' },
    ],
  },
  blogger: {
    label: 'بلوجر',
    en: 'Blogger',
    color: '#ff5722',
    rules: [
      { re: /blogger\.com|blogspot\.com|<meta[^>]+content=["']blogger["']/i, w: 45, where: 'html' },
    ],
  },
  hubspot: {
    label: 'هبسبوت',
    en: 'HubSpot CMS',
    color: '#ff7a59',
    rules: [
      { re: /hs-scripts\.com|hubspot\.(com|net)|hs-sites\.com/i, w: 45, where: 'html' },
    ],
  },
  nextjs: {
    label: 'Next.js (مخصص)',
    en: 'Next.js',
    color: '#000000',
    isCustom: true,
    rules: [
      { re: /\/_next\/static\//i, w: 45, where: 'html' },
      { re: /__NEXT_DATA__|self\.__next/i, w: 45, where: 'html' },
      { re: /x-nextjs-|x-powered-by.*next/i, w: 40, where: 'headers' },
    ],
  },
  nuxt: {
    label: 'Nuxt (مخصص)',
    en: 'Nuxt',
    color: '#00dc82',
    isCustom: true,
    rules: [
      { re: /__NUXT__|\/_nuxt\//i, w: 45, where: 'html' },
    ],
  },
  laravel: {
    label: 'Laravel (مخصص)',
    en: 'Laravel',
    color: '#ff2d20',
    isCustom: true,
    rules: [
      { re: /laravel_session|XSRF-TOKEN/i, w: 40, where: 'cookies' },
      { re: /<meta[^>]+name=["']csrf-token["']/i, w: 20, where: 'html' },
    ],
  },
  django: {
    label: 'Django (مخصص)',
    en: 'Django',
    color: '#0c4b33',
    isCustom: true,
    rules: [
      { re: /csrftoken|django_language|sessionid/i, w: 35, where: 'cookies' },
      { re: /\/static\/admin\/|csrfmiddlewaretoken/i, w: 35, where: 'html' },
    ],
  },
  rails: {
    label: 'Ruby on Rails (مخصص)',
    en: 'Ruby on Rails',
    color: '#cc0000',
    isCustom: true,
    rules: [
      { re: /_session_id|_rails/i, w: 35, where: 'cookies' },
      { re: /csrf-param|X-Runtime/i, w: 25, where: 'headers' },
    ],
  },
  aspnet: {
    label: 'ASP.NET (مخصص)',
    en: 'ASP.NET',
    color: '#512bd4',
    isCustom: true,
    rules: [
      { re: /ASP\.NET|X-AspNet-Version|X-AspNetMvc/i, w: 50, where: 'headers' },
      { re: /__VIEWSTATE|__EVENTVALIDATION/i, w: 45, where: 'html' },
      { re: /ASP\.NET_SessionId/i, w: 40, where: 'cookies' },
    ],
  },
};

// إضافات/تقنيات نكتشفها بجانب المنصة الأساسية
const EXTRAS = [
  { key: 'elementor', label: 'Elementor', re: /elementor(-|\/|\.)/i },
  { key: 'divi', label: 'Divi', re: /et_divi|divi-|Divi\//i },
  { key: 'wpbakery', label: 'WPBakery', re: /js_composer|vc_row/i },
  { key: 'gsap', label: 'GSAP', re: /gsap|TweenMax|ScrollTrigger/i },
  { key: 'jquery', label: 'jQuery', re: /jquery[.-]/i },
  { key: 'bootstrap', label: 'Bootstrap', re: /bootstrap(\.min)?\.(css|js)/i },
  { key: 'tailwind', label: 'Tailwind', re: /tailwind/i },
  { key: 'react', label: 'React', re: /react(-dom)?[.@-]|data-reactroot/i },
  { key: 'vue', label: 'Vue', re: /vue(\.min)?\.js|data-v-[a-f0-9]{8}/i },
  { key: 'ga4', label: 'Google Analytics 4', re: /gtag\/js\?id=G-|googletagmanager\.com\/gtag/i },
  { key: 'gtm', label: 'Google Tag Manager', re: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i },
  { key: 'meta_pixel', label: 'Meta Pixel', re: /connect\.facebook\.net\/.*fbevents\.js|fbq\(/i },
  { key: 'tiktok_pixel', label: 'TikTok Pixel', re: /analytics\.tiktok\.com/i },
  { key: 'snap_pixel', label: 'Snap Pixel', re: /sc-static\.net\/scevent/i },
  { key: 'hotjar', label: 'Hotjar', re: /static\.hotjar\.com/i },
  { key: 'whatsapp', label: 'واتساب', re: /wa\.me\/|api\.whatsapp\.com/i },
  { key: 'recaptcha', label: 'reCAPTCHA', re: /recaptcha/i },
  { key: 'cloudflare_turnstile', label: 'Turnstile', re: /challenges\.cloudflare\.com\/turnstile/i },
];

const CDNS = [
  { re: /cloudflare/i, name: 'Cloudflare' },
  { re: /cloudfront/i, name: 'AWS CloudFront' },
  { re: /fastly/i, name: 'Fastly' },
  { re: /akamai/i, name: 'Akamai' },
  { re: /vercel/i, name: 'Vercel' },
  { re: /netlify/i, name: 'Netlify' },
  { re: /bunnycdn|bunny\.net/i, name: 'BunnyCDN' },
  { re: /sucuri/i, name: 'Sucuri' },
];

/**
 * البصمة الأساسية.
 * @param {{body:string, headers:object, finalUrl:string}} res
 */
export function fingerprint(res) {
  const html = res?.body || '';
  const headers = res?.headers || {};
  const headerText = Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : v}`)
    .join('\n');
  const cookieText = []
    .concat(headers['set-cookie'] || [])
    .join('\n');
  const url = res?.finalUrl || res?.url || '';

  const haystack = { html, headers: headerText, cookies: cookieText, url };

  const scores = [];
  for (const [key, def] of Object.entries(PLATFORMS)) {
    let score = 0;
    const hits = [];
    for (const rule of def.rules) {
      const target = haystack[rule.where] || '';
      if (rule.re.test(target)) {
        score += rule.w;
        if (rule.note) hits.push(rule.note);
      }
    }
    if (score > 0) scores.push({ key, def, score, hits });
  }

  scores.sort((a, b) => b.score - a.score);

  // الإضافات المرتبطة بمنصة (زي ووكومرس) ما تنافسش المنصة الأم
  const primary = scores.find((s) => !s.def.isAddon) || scores[0] || null;
  const addons = scores.filter((s) => s.def.isAddon && s !== primary);

  const detected = primary
    ? {
        key: primary.key,
        label: primary.def.label,
        en: primary.def.en,
        color: primary.def.color,
        isCustom: Boolean(primary.def.isCustom),
        score: primary.score,
        // الثقة: 100 وزن ≈ يقين. نقصرها على 99 لأن الفحص الخارجي مبيوصلش ليقين مطلق
        confidence: Math.min(99, Math.round((primary.score / 100) * 100)),
        evidence: primary.hits.slice(0, 4),
        version: extractVersion(primary.def, html),
      }
    : null;

  return {
    platform: detected,
    addons: addons.map((a) => ({
      key: a.key,
      label: a.def.label,
      en: a.def.en,
      confidence: Math.min(99, a.score),
      version: extractVersion(a.def, html),
    })),
    runnerUp: scores[1] && scores[1] !== primary
      ? { key: scores[1].key, label: scores[1].def.label, score: scores[1].score }
      : null,
    extras: EXTRAS.filter((e) => e.re.test(html)).map((e) => ({ key: e.key, label: e.label })),
    server: cleanHeader(headers['server']),
    poweredBy: cleanHeader(headers['x-powered-by']),
    cdn: detectCDN(headerText),
    generator: (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i) || [])[1] || null,
    title: decodeEntities((html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1] || '').trim() || null,
    lang: (html.match(/<html[^>]+lang=["']([^"']+)["']/i) || [])[1] || null,
    isRTL: /dir=["']rtl["']/i.test(html),
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
  };
}

function extractVersion(def, html) {
  if (!def.version) return null;
  for (const re of def.version) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function detectCDN(headerText) {
  for (const c of CDNS) if (c.re.test(headerText)) return c.name;
  return null;
}

function cleanHeader(v) {
  if (!v) return null;
  return String(Array.isArray(v) ? v[0] : v).slice(0, 80);
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export { PLATFORMS };
