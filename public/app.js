// JS المتصفح — بلا إطار ولا CDN. يعمل بدونه كل شيء (النماذج تُرسَل عاديًا).
(function () {
  'use strict';

  // ——————————————————— الوضع الليلي ———————————————————
  var KEY = 'mkss-theme';
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) { /* تخزين محجوب — نكمل بتفضيل النظام */ }

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = current ? (current === 'dark' ? 'light' : 'dark') : (systemDark ? 'light' : 'dark');
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
    });
  }

  // ——————————————————— تأكيد ونسخ ———————————————————
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-copy]');
    if (!el) return;
    var text = el.getAttribute('data-copy');
    var show = function () {
      var old = el.textContent;
      el.textContent = 'تم النسخ ✓';
      setTimeout(function () { el.textContent = old; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(show, fallback);
    } else fallback();

    function fallback() {
      // المتصفحات على HTTP لا تتيح الحافظة — نستخدم تحديد النص كبديل
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); show(); } catch (err) { ta.remove(); return; }
      ta.remove();
    }
  });

  // إدراج رد محفوظ في حقل الكتابة
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-insert]');
    if (!el) return;
    var input = document.getElementById('chat-input');
    if (!input) return;
    input.value = el.getAttribute('data-insert');
    input.focus();
    input.dispatchEvent(new Event('input'));
  });

  // اللون يُطبَّق فورًا عند الضغط، ثم يُحفظ على الخادم — بلا وميض انتظار
  var colorBar = document.getElementById('color-bar');
  if (colorBar) {
    colorBar.addEventListener('click', function (e) {
      var sw = e.target.closest('.swatch');
      if (!sw) return;
      var box = document.querySelector('.chat');
      if (box) box.style.setProperty('--chat-accent', sw.value);
      colorBar.querySelectorAll('.swatch').forEach(function (s) { s.setAttribute('aria-pressed', 'false'); });
      sw.setAttribute('aria-pressed', 'true');
    });
  }

  // ——————————————————— تفضيل تقليل الحركة ———————————————————
  // استعلام واحد نقرأ ‎.matches‎ منه عند كل استخدام لا مرة واحدة عند التحميل:
  // من يشغّل التفضيل والصفحة مفتوحة يجب أن يُحترم فورًا بلا مستمع إضافي.
  var reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  var docBody = document.body;

  // ——————————————————— درج التنقّل (الموبايل) ———————————————————
  var navPanel = document.getElementById('sidenav');
  var navOpener = document.querySelector('[data-nav-open]');
  var navScrim = document.querySelector('.scrim');
  var navReturn = null;   // الزر الذي فتح الدرج — إليه يعود التركيز عند الإغلاق

  // العنصر المخفي يظهر في الاستعلام ولا يقبل التركيز؛ لو دخل حلقة الحبس
  // توقّف Tab عنده وبدا للمستخدم أن لوحة المفاتيح تعطّلت.
  function navFocusable() {
    if (!navPanel) return [];
    var all = navPanel.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
      ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(all, function (el) { return el.getClientRects().length > 0; });
  }

  function navOpenDrawer() {
    if (!navPanel || docBody.classList.contains('nav-open')) return;
    navReturn = document.activeElement;
    docBody.classList.add('nav-open');   // CSS يقفل تمرير الخلفية على هذا الصنف
    if (navOpener) navOpener.setAttribute('aria-expanded', 'true');
    if (navScrim) navScrim.hidden = false;
    var first = navFocusable()[0];
    if (first) first.focus();
  }

  /** @param {boolean} [restore] مرِّر false للإغلاق التلقائي (اتساع الشاشة) */
  function navCloseDrawer(restore) {
    if (!docBody.classList.contains('nav-open')) return;
    docBody.classList.remove('nav-open');
    if (navOpener) navOpener.setAttribute('aria-expanded', 'false');
    if (navScrim) navScrim.hidden = true;
    // لا نركّز زرًّا اختفى: فوق 768px يختفي الشريط العلوي كله، وتركيز عنصر
    // مخفي يُسقِط التركيز على <body> فيضيع موضع القارئ في الصفحة.
    if (restore !== false && navReturn && navReturn.isConnected && navReturn.getClientRects().length) {
      navReturn.focus();
    }
    navReturn = null;
  }

  if (navPanel) {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;   // نقرة على عقدة ليست عنصرًا
      if (t.closest('[data-nav-open]')) { navOpenDrawer(); return; }
      if (t.closest('[data-nav-close]')) navCloseDrawer();   // الزر والحجاب كلاهما يحملها
    });

    document.addEventListener('keydown', function (e) {
      if (!docBody.classList.contains('nav-open')) return;
      if (e.key === 'Escape') { navCloseDrawer(); return; }
      if (e.key !== 'Tab') return;
      var f = navFocusable();
      if (!f.length) return;
      var inside = navPanel.contains(document.activeElement);
      // الدرج يغطّي الصفحة: تسريب Tab إلى ما خلف الحجاب يترك المستخدم
      // يتنقّل في محتوى لا يراه ولا يعرف كيف يعود منه.
      if (e.shiftKey && (!inside || document.activeElement === f[0])) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === f[f.length - 1])) {
        e.preventDefault();
        f[0].focus();
      }
    });

    // فوق 768px يصير الشريط ثابتًا ظاهرًا؛ بقاء الصنف بعد تدوير الجهاز
    // يُبقي الحجاب وقفل التمرير فوق تخطيط لم يعد فيه درج أصلًا.
    if (window.matchMedia) {
      var navWide = window.matchMedia('(min-width: 768px)');
      var navWideChange = function (ev) { if (ev.matches) navCloseDrawer(false); };
      if (navWide.addEventListener) navWide.addEventListener('change', navWideChange);
      else if (navWide.addListener) navWide.addListener(navWideChange);   // سفاري قديم
    }
  }

  // ——————————————————— إظهار كلمة السر ———————————————————
  // نبدّل النوع لا نعرض النص في عنصر آخر: الحقل يبقى هو نفسه، فلا يفقد
  // مدير كلمات السر تتبّعه ولا يضيع ما كُتب فيه.
  document.addEventListener('click', function (e) {
    var t = e.target;
    var btn = t && t.closest ? t.closest('[data-pw-toggle]') : null;
    if (!btn) return;
    var input = document.getElementById(btn.getAttribute('data-pw-toggle'));
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.setAttribute('aria-label', show ? 'إخفاء كلمة السر' : 'إظهار كلمة السر');
    // موضع المؤشّر يقفز إلى البداية عند تغيير النوع، فيكتب المستخدم في أوله
    var end = input.value.length;
    input.focus();
    try { input.setSelectionRange(end, end); } catch (err) { /* بعض الأنواع ترفض */ }
  });

  // ——————————————————— تنبيه Caps Lock ———————————————————
  // أشيع سبب لـ«كلمة السر غير صحيحة» وهي صحيحة: الحروف منقّطة فلا يرى
  // المستخدم أنها كبيرة. قولها له يوفّر محاولة ضائعة — وحظرًا بعد عشر محاولات.
  (function () {
    var caps = document.querySelectorAll('[data-caps]');
    if (!caps.length) return;
    var show = function (input, on) {
      var warn = input.closest('.field') && input.closest('.field').querySelector('.caps-warn');
      if (warn) warn.hidden = !on;
    };
    caps.forEach(function (input) {
      var check = function (e) {
        // getModifierState غير مدعومة في كل حدث ولا كل متصفّح — نتجاهل بصمت
        if (!e.getModifierState) return;
        try { show(input, e.getModifierState('CapsLock')); } catch (err) { /* لا دعم */ }
      };
      input.addEventListener('keydown', check);
      input.addEventListener('keyup', check);
      // مغادرة الحقل تُخفي التنبيه: تحذير معلّق فوق حقل لا يُكتب فيه ضجيج
      input.addEventListener('blur', function () { show(input, false); });
    });
  })();

  // ——————————————————— زرّ الإرسال أثناء الانتظار ———————————————————
  // الضغط على «دخول» ثم لا شيء لثانية يجعل المستخدم يضغط ثانيةً وثالثة.
  // نعرض الحالة، و**لا نعطّل الزر قبل الإرسال**: الزر المعطّل لا تُرسَل قيمته
  // ولا يُرسل النموذج أصلًا في بعض المتصفّحات.
  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var btn = e.target.querySelector('button[data-pending]');
    if (!btn) return;
    btn.setAttribute('data-busy', '');
    btn.setAttribute('aria-busy', 'true');
  });

  // العودة من ذاكرة الخلف تُعيد الصفحة كما غادرتها: زرّ عالق في حالة انتظار
  window.addEventListener('pageshow', function () {
    document.querySelectorAll('[data-busy]').forEach(function (b) {
      b.removeAttribute('data-busy');
      b.removeAttribute('aria-busy');
    });
  });

  // ——————————————————— شريط تقدّم التنقّل وانتقال الصفحات ———————————————————
  var navBar = document.getElementById('nav-progress');
  var navFill = navBar ? navBar.querySelector('span') : null;
  var navDelay = null;    // مؤقّت الـ 120ms قبل الإظهار
  var navRaf = null;
  var navT0 = 0;
  var navBusy = false;
  var hasVT = 'startViewTransition' in document;

  // المتصفحات الداعمة تتولّى الانتقال بـ @view-transition من CSS وحده؛
  // الصنف يمنح CSS وسيلة للتمييز فلا يطبّق تلاشي الاحتياط فوق الانتقال.
  root.classList.add(hasVT ? 'has-vt' : 'no-vt');

  function navProgressPaint(pct) {
    if (!navBar || !navFill) return;
    var v = pct.toFixed(2) + '%';
    // نكتب القيمة بطريقتين: عرض منطقي على العنصر الداخلي، ومتغيّر على الحاوية.
    // CSS قد يملأ الشريط بالعرض أو بـ scaleX، ولا نريد شريطًا لا يتحرّك
    // لأن الطريقتين لم تتفقا.
    navFill.style.inlineSize = v;
    navBar.style.setProperty('--nav-progress', v);
  }

  function navTick(now) {
    if (!navT0) navT0 = now;
    var ms = now - navT0;
    // منحنى يقترب من 90% ولا يبلغها: الاكتمال وحده يملأ الشريط، فلا نَعِد
    // بانتهاء لم يحدث ثم نعلّق المستخدم عند 100%.
    navProgressPaint(90 * (1 - Math.exp(-ms / 2000)));
    // تنقّل أُلغي (حوار مغادرة، أو رابط تبيّن أنه تنزيل) يترك الحلقة تدور
    // إلى ما لا نهاية وتستنزف البطارية — نوقفها ونترك الشريط عند حدّه.
    navRaf = ms < 20000 ? requestAnimationFrame(navTick) : null;
  }

  function navProgressStart() {
    if (navBusy) return;
    navBusy = true;
    // تلاشي الاحتياط للمتصفحات بلا View Transitions: إضافة صنف فقط.
    // لا setTimeout ولا انتظار قبل المغادرة — التأخير الصناعي بطء حقيقي.
    if (!hasVT && !reduceMotion.matches) docBody.classList.add('is-leaving');
    if (!navBar || !navFill) return;
    navDelay = setTimeout(function () {
      navDelay = null;
      navBar.hidden = false;
      // مع تقليل الحركة نعرض الشريط ساكنًا عند حدّه: التنبيه بأن شيئًا يجري
      // حقّ للمستخدم، والزحف المتحرّك هو ما طلب الاستغناء عنه.
      if (reduceMotion.matches) { navProgressPaint(90); return; }
      navT0 = 0;
      navRaf = requestAnimationFrame(navTick);
    }, 120);   // صمت متعمّد: التنقّل المحلي ينتهي قبلها، ووميض يظهر ويختفي يُشعر بالبطء
  }

  function navProgressDone() {
    if (navDelay) { clearTimeout(navDelay); navDelay = null; }
    if (navRaf) { cancelAnimationFrame(navRaf); navRaf = null; }
    navBusy = false;
    navT0 = 0;
    docBody.classList.remove('is-leaving');
    if (!navBar || !navFill) return;
    if (navBar.hidden) { navProgressPaint(0); return; }
    navProgressPaint(100);
    setTimeout(function () {
      navBar.hidden = true;
      navProgressPaint(0);
    }, reduceMotion.matches ? 0 : 220);
  }

  // مسجَّل بعد مستمع data-confirm أعلاه عمدًا: النموذج الذي أُلغي تأكيده
  // يصل إلينا وقد رُفع defaultPrevented، فلا نُظهر شريطًا لتنقّل لن يحدث.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    // Ctrl/Cmd/Shift/Alt والزر الأوسط تفتح تبويبًا آخر — هذه الصفحة باقية
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var t = e.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (!a) return;
    if (a.hasAttribute('download')) return;
    if (a.target && a.target !== '_self') return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    // mailto: و tel: و javascript: لا تغادر الصفحة
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) return;
    if (a.origin && a.origin !== location.origin) return;   // موقع خارجي
    // قفزة داخل الصفحة نفسها ليست تنقّلًا
    if (a.hash && a.pathname === location.pathname && a.search === location.search) return;
    navProgressStart();
  });

  document.addEventListener('submit', function (e) {
    // نموذج الشات يُرسَل بـ fetch ويمنع الافتراضي: الصفحة لا تغادر
    if (e.defaultPrevented) return;
    var f = e.target;
    if (f && f.getAttribute && f.getAttribute('target')) return;
    navProgressStart();
  });

  // تنقّل لم يمر بنقر رابط: زر الرجوع، إعادة التحميل، أو تحويل من الخادم
  window.addEventListener('pagehide', navProgressStart);

  // العودة من ذاكرة الخلف/الأمام تُعيد الصفحة كما تركناها لحظة المغادرة:
  // شريط عالق عند 90% وجسم ما زال متلاشيًا لو لم ننظّف هنا.
  window.addEventListener('pageshow', function () { navProgressDone(); });

  // ——————————————————— دخول المحتوى وعدّادات الأرقام ———————————————————
  var revealEls = document.querySelectorAll('[data-reveal]');
  var countEls = document.querySelectorAll('[data-count]');

  /**
   * يعدّ من صفر إلى الرقم المكتوب في العنصر.
   * النص الأصلي هو القيمة النهائية ويُعاد حرفيًّا عند الانتهاء، فلا يغيّر
   * التقريب ما كتبه الخادم (‎07‎ أو ‎1.50‎ أو لاحقة مثل ‎+‎).
   */
  function navCountUp(el) {
    var raw = String(el.textContent == null ? '' : el.textContent).trim();
    var m = /^(\D*?)(\d+(?:\.\d+)?)(\D*)$/.exec(raw);
    if (!m) return;   // «—» أو نص غير رقمي: يبقى كما هو بلا عبث
    var target = parseFloat(m[2]);
    var dec = (m[2].split('.')[1] || '').length;
    var t0 = 0;
    var step = function (now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / 700);
      if (p < 1) {
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = m[1] + (target * eased).toFixed(dec) + m[3];
        requestAnimationFrame(step);
      } else {
        el.textContent = raw;
      }
    };
    requestAnimationFrame(step);
  }

  function navReveal(el) { el.classList.add('in-view'); }

  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    // بلا حركة أو بلا مراقب: الحالة النهائية فورًا. ترك العنصر بلا ‎in-view‎
    // يعني بقاءه شفافًا إلى الأبد — محتوى مفقود لا حركة ناقصة.
    revealEls.forEach(navReveal);
  } else {
    var navIO = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        obs.unobserve(en.target);   // مرة واحدة: لا نعيد الحركة مع كل تمرير
        if (en.target.hasAttribute('data-reveal')) navReveal(en.target);
        if (en.target.hasAttribute('data-count')) navCountUp(en.target);
      });
    }, { threshold: 0.01, rootMargin: '0px 0px -6% 0px' });

    revealEls.forEach(function (el) { navIO.observe(el); });
    countEls.forEach(function (el) { navIO.observe(el); });   // مراقبة المكرّر لا تضرّ
  }

  // ——————————————————— الشات ———————————————————
  var chat = document.querySelector('.chat');
  if (!chat) return;

  var log = document.getElementById('chat-log');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var status = document.getElementById('chat-status');
  var typing = document.getElementById('typing');
  var viewer = chat.getAttribute('data-viewer');        // client | admin
  var convId = chat.getAttribute('data-chat-conv');
  var lastId = lastSeenId();

  scrollToEnd();
  autoGrow();

  function lastSeenId() {
    var nodes = log ? log.querySelectorAll('.msg[data-id]') : [];
    return nodes.length ? Number(nodes[nodes.length - 1].getAttribute('data-id')) : 0;
  }

  function scrollToEnd() {
    if (log) log.scrollTop = log.scrollHeight;
  }

  function setStatus(kind, text) {
    if (!status) return;
    status.className = 'badge ' + (kind === 'ok' ? 'badge-ok' : kind === 'bad' ? 'badge-danger' : '');
    status.textContent = text;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getDate() + '/' + (d.getMonth() + 1) + ' — ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function render(m) {
    if (!log || Number(m.id) <= lastId) return;   // لا نكرّر رسالة وصلت مرتين
    if (log.querySelector('.empty')) log.innerHTML = '';

    var mine = m.author_role === viewer;
    var who = m.author_role === 'client' ? 'العميل' : m.author_role === 'admin' ? 'فريق الدعم' : 'النظام';
    var div = document.createElement('div');
    div.className = 'msg msg-new' + (mine ? ' msg-mine' : '') + (m.author_role === 'system' ? ' msg-system' : '');
    div.setAttribute('data-id', m.id);
    div.innerHTML = '<div class="msg-body">' + esc(m.body) + '</div>' +
      '<div class="msg-meta">' + esc(mine ? 'أنت' : who) + ' · <time>' + esc(fmt(m.created_at)) + '</time></div>';
    log.appendChild(div);
    lastId = Number(m.id);
    scrollToEnd();
  }

  // مزامنة ما فات أثناء الانقطاع — SSE وحده لا يضمن ما حدث ونحن مفصولون
  function syncMissed() {
    var url = (viewer === 'admin' ? '/admin/chat/' + convId + '/since' : '/chat/' + convId + '/since') + '?after=' + lastId;
    fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data && data.messages) data.messages.forEach(render); })
      .catch(function () {});
  }

  if (window.EventSource) {
    var streamUrl = viewer === 'admin' ? '/admin/chat/stream' : '/chat/stream';
    var es = new EventSource(streamUrl);

    es.addEventListener('open', function () {
      setStatus('ok', '● متصل');
      syncMissed();
    });

    es.addEventListener('message', function (ev) {
      try {
        var m = JSON.parse(ev.data);
        // لوحة الأدمن تستقبل رسائل كل العملاء — نعرض من نحن فاتحون محادثته فقط
        if (String(m.conversation_id) !== String(convId)) return;
        // العميل لا يرى الملاحظات الداخلية — حارس ثانٍ بعد فلترة السيرفر
        if (viewer === 'client' && m.visibility === 'internal') return;
        // رسائل المساعد تحمل أزرارًا (تقييم/اقتراحات) يبنيها السيرفر،
        // فنعيد التحميل بدل رسم نصف الرسالة بلا أزرارها.
        if (typing) typing.classList.remove('on');
        if (viewer === 'client' && (m.author_role === 'bot' || m.author_role === 'system')) {
          return window.location.reload();
        }
        render(m);
      } catch (e) {}
    });

    // مؤشر «يكتب…»: يبثّه الخادم عند بدء تفكير سامي وعند انتهائه
    es.addEventListener('typing', function (ev) {
      if (!typing) return;
      var on = false;
      try { on = JSON.parse(ev.data).on; } catch (e) {}
      typing.classList.toggle('on', !!on);
      if (on && log) log.scrollTop = log.scrollHeight;
    });

    es.addEventListener('error', function () {
      setStatus('bad', '○ انقطع — يعيد المحاولة');
    });
  } else {
    setStatus('', 'التحديث اللحظي غير مدعوم');
    setInterval(syncMissed, 10000);
  }

  // ——————————————————— الإرسال ———————————————————
  if (form) {
    form.addEventListener('submit', function (e) {
      var text = (input.value || '').trim();
      if (!text) { e.preventDefault(); return; }
      if (!window.fetch) return;   // بلا fetch يُرسَل النموذج عاديًا

      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      input.value = '';
      autoGrow();

      var body = new URLSearchParams();
      body.set('_csrf', form.querySelector('[name="_csrf"]').value);
      body.set('body', text);

      fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (data) { if (data && data.message) render(data.message); })
        .catch(function () {
          input.value = text;   // لا نُضيّع ما كتبه المستخدم
          setStatus('bad', '○ تعذّر الإرسال');
        })
        .then(function () { if (btn) btn.disabled = false; input.focus(); });
    });
  }

  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
    input.addEventListener('input', autoGrow);
  }

  function autoGrow() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }
})();
