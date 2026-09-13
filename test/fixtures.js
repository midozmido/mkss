// تجهيزات اختبار محلية — نماذج HTML وهيدرات تحاكي منصات حقيقية.
// ضرورية لأن بيئة التطوير تحجب المواقع الخارجية، فلا سبيل للتحقق إلا محليًا.
import http from 'node:http';

const page = (head = '', body = '') =>
  `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${head}</head>
<body>${body}</body></html>`;

export const FIXTURES = {
  wordpress: {
    expect: 'wordpress',
    headers: { 'content-type': 'text/html; charset=UTF-8', link: '<https://x.test/wp-json/>; rel="https://api.w.org/"' },
    html: page(
      `<meta name="generator" content="WordPress 6.5.2">
<link rel="stylesheet" href="/wp-content/themes/astra/style.css">
<script src="/wp-includes/js/jquery/jquery.min.js"></script>
<link rel="stylesheet" href="/wp-includes/css/dist/block-library/style.min.css" id="wp-block-library-css">`,
      `<div class="elementor elementor-12">محتوى</div>`
    ),
  },
  woocommerce: {
    expect: 'wordpress',
    expectAddon: 'woocommerce',
    headers: { 'set-cookie': ['woocommerce_items_in_cart=1; path=/', 'wp-settings-1=x; path=/'] },
    html: page(
      `<meta name="generator" content="WordPress 6.4">
<meta name="generator" content="WooCommerce 8.5.1">
<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">`,
      `<a class="wc-ajax add_to_cart_button">أضف للسلة</a>`
    ),
  },
  shopify: {
    expect: 'shopify',
    headers: { 'x-shopify-stage': 'production', 'x-shopid': '12345', 'set-cookie': ['_shopify_y=abc; path=/'] },
    html: page(
      `<link href="//cdn.shopify.com/s/files/1/0001/theme.css" rel="stylesheet">`,
      `<div id="shopify-section-header"></div>
<script>window.Shopify = Shopify || {}; Shopify.shop = "متجري.myshopify.com";</script>`
    ),
  },
  salla: {
    expect: 'salla',
    headers: { 'x-salla-store': '998' },
    html: page(
      `<link rel="stylesheet" href="https://cdn.salla.network/themes/default/app.css">`,
      `<salla-products-slider></salla-products-slider><script>window.salla = {};</script>`
    ),
  },
  zid: {
    expect: 'zid',
    headers: {},
    html: page(
      `<link rel="stylesheet" href="https://cdn.zid.sa/assets/app.css">`,
      `<div class="zid-app"><script>window.zid = {store: 1};</script></div>`
    ),
  },
  wix: {
    expect: 'wix',
    headers: { 'x-wix-request-id': 'abc-123' },
    html: page(`<meta name="generator" content="Wix.com Website Builder">
<link href="https://static.wixstatic.com/css/a.css" rel="stylesheet">`, ''),
  },
  webflow: {
    expect: 'webflow',
    headers: {},
    html: page(`<meta name="generator" content="Webflow">`,
      `<div data-wf-page="abc" data-wf-site="def"><img src="https://cdn.prod.website-files.com/x.png"></div>`),
  },
  drupal: {
    expect: 'drupal',
    headers: { 'x-drupal-cache': 'HIT', 'x-generator': 'Drupal 10 (https://www.drupal.org)' },
    html: page(`<meta name="generator" content="Drupal 10 (https://www.drupal.org)">`,
      `<img src="/sites/default/files/logo.png"><script type="application/json" data-drupal-selector="drupal-settings-json">{}</script>`),
  },
  joomla: {
    expect: 'joomla',
    headers: {},
    html: page(`<meta name="generator" content="Joomla! - Open Source Content Management">`,
      `<script src="/media/system/js/core.js"></script>`),
  },
  nextjs: {
    expect: 'nextjs',
    headers: {},
    html: page(`<link rel="preload" href="/_next/static/css/app.css" as="style">`,
      `<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{}</script>`),
  },
  // حالة حرجة: موقع مخصص لا ينتمي لأي منصة — يجب أن يرجع "غير معروف" لا تخمينًا
  custom: {
    expect: null,
    headers: { server: 'nginx' },
    html: page('<title>موقع مخصص</title>', `<img src="/image/logo.png"><script src="/js/app.js"></script>`),
  },
  // حالة حرجة: نفس فخ image/ الذي أوقع المحرك سابقًا في تخمين "ماجنتو"
  imageTrap: {
    expect: null,
    headers: {},
    html: page('<title>معرض صور</title>',
      `<img src="/image/a.png"><img src="/images/b.png"><script src="/assets/image/c.js"></script>`),
  },
};

/** يبني كائن رد شبيه بما يرجعه fetchSite — لاختبار البصمة وحدها */
export function asResponse(fx, url = 'https://x.test/') {
  return { body: fx.html, headers: fx.headers, finalUrl: url, url };
}

/**
 * سيرفر محلي يخدم التجهيزات على مسارات، ويحاكي حالات الفشل.
 * يُستخدم لاختبار الجالب من طرف لطرف.
 */
export function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const name = url.pathname.slice(1);

    if (name === '__slow') {
      setTimeout(() => res.end('متأخر'), 30000); // يتجاوز أي مهلة معقولة
      return;
    }
    if (name === '__error500') {
      res.writeHead(500, { 'content-type': 'text/html' });
      return res.end('<h1>خطأ في السيرفر</h1>');
    }
    if (name === '__loop') {
      res.writeHead(302, { location: '/__loop' });
      return res.end();
    }
    if (name === '__chain') {
      const n = Number(url.searchParams.get('n') || 0);
      if (n < 10) {
        res.writeHead(302, { location: `/__chain?n=${n + 1}` });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<h1>وصلت</h1>');
    }
    if (name === '__huge') {
      res.writeHead(200, { 'content-type': 'text/html' });
      // 4 ميجا — يجب أن يقتطعها الجالب عند 512KB
      const chunk = 'ا'.repeat(64 * 1024);
      for (let i = 0; i < 64; i++) res.write(chunk);
      return res.end();
    }
    if (name === '__redirect_to_internal') {
      // ناقل هجوم: موقع "عام" يحوّل لعنوان بيانات اعتماد السحابة
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      return res.end();
    }

    const fx = FIXTURES[name];
    if (!fx) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<h1>غير موجود</h1>');
    }
    const headers = { 'content-type': 'text/html; charset=utf-8', ...fx.headers };
    res.writeHead(200, headers);
    res.end(fx.html);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, base: `http://127.0.0.1:${port}` });
    });
  });
}
