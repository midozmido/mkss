// النقاط المضيئة فوق نقش الخاتَم — تُحمَّل في صفحات الدخول وحدها.
//
// **ما هي النقطة**: نتيجة فحص عائدة. النظام يفحص كل موقع كل خمس دقائق،
// وكل فحص يرجع إلينا بنتيجة. هذا كل ما ترمز إليه النقطة، ولهذا هي قليلة
// وهادئة: سحابةٌ من مئة نقطة تتلألأ كذبٌ على كيف يعمل النظام.
//
// **ولماذا لا تطفو**: النقطة لا تتحرّك في فراغ أبدًا. الخطوط المحورية في
// نقش الخاتَم — المارّة بمراكز النجوم أفقيًّا ورأسيًّا — هي مسارها حرفًا
// بحرف، ومقاس الخلية هنا هو مقاسها هناك. لا تنعطف إلا عند مركز نجمة، حيث
// يوجد في النقش عقدة فعلية تلتقي عندها أربعة أشرطة. وهذا ما يفصلها عن
// «نقاط عائمة تربطها خطوط» — القالب الذي تراه في كل صفحة دخول.
//
// الصفحة تعمل كاملةً بدون هذا الملف: النقش مرسوم في HTML، والنموذج يُرسَل
// إلى الخادم، وما يضيفه هنا حركةٌ لا معلومة.
(function () {
  'use strict';

  var canvas = document.getElementById('probes');
  if (!canvas || !canvas.getContext) return;

  var CELL = 112;          // ضلع خلية النقش — يطابق khatam() في layout.js
  var SPEED = 108;         // بكسل/ثانية
  var TURN = 0.3;          // احتمال الانعطاف عند مركز نجمة
  var TRAIL = 9;           // عدد المواضع المحفوظة للذيل
  var MIN_WIDTH = 260;     // تحت هذا العرض لا تعمل الطبقة أصلًا — يُقاس على اللوحة لا على النافذة

  var ctx = canvas.getContext('2d', { alpha: true });
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  var W = 0, H = 0, dpr = 1;
  var cols = 0, rows = 0;
  var dots = [];
  var ink = '45,212,191';
  var raf = 0, last = 0;

  // ——— اللون من الورقة لا من ثابت هنا ———
  // ‎.auth-aside-bg‎ لونه ‎var(--brand)‎، فيتبع بوابة العميل أو الإدارة والوضع
  // الليلي معًا. قراءته من المحسوب تعني أن تغيير التوكن يغيّر النقاط بلا
  // سطر واحد هنا.
  function readInk() {
    var host = canvas.parentNode || document.body;
    var c = getComputedStyle(host).color || '';
    var m = c.match(/-?\d+(\.\d+)?/g);
    if (m && m.length >= 3) ink = m[0] + ',' + m[1] + ',' + m[2];
  }

  function centreX(i) { return (i + 0.5) * CELL; }
  function centreY(j) { return (j + 0.5) * CELL; }

  /** نقطة جديدة تولد خارج الإطار على أحد خطوط الشبكة وتدخل نحو الوسط */
  function spawn(d) {
    var vertical = Math.random() < 0.5;
    if (vertical) {
      d.i = Math.floor(Math.random() * cols);
      d.j = Math.random() < 0.5 ? -1 : rows;
      d.x = centreX(d.i);
      d.y = centreY(d.j);
      d.vx = 0;
      d.vy = d.j < 0 ? 1 : -1;
    } else {
      d.j = Math.floor(Math.random() * rows);
      d.i = Math.random() < 0.5 ? -1 : cols;
      d.x = centreX(d.i);
      d.y = centreY(d.j);
      d.vy = 0;
      d.vx = d.i < 0 ? 1 : -1;
    }
    d.speed = SPEED * (0.7 + Math.random() * 0.6);
    d.life = 0;
    d.trail.length = 0;
    return d;
  }

  function makeDots() {
    var n = Math.max(8, Math.min(18, Math.round((W / dpr) / 120)));
    dots = [];
    for (var k = 0; k < n; k++) {
      var d = spawn({ trail: [] });
      // توزيع البدايات على المسار كي لا تدخل كلها من الحافة في اللحظة نفسها
      var pre = Math.random() * (W / dpr);
      d.x += d.vx * pre;
      d.y += d.vy * pre;
      dots.push(d);
    }
  }

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(r.width * dpr);
    H = Math.round(r.height * dpr);
    canvas.width = W;
    canvas.height = H;
    cols = Math.ceil(r.width / CELL);
    rows = Math.ceil(r.height / CELL);
    readInk();
    return true;
  }

  /** مركز اللوحة — نحوه تنعطف النقاط، فتُقرأ الحركة تجمّعًا لا تشتّتًا.
   *  الإحداثيات نسبيّة للوحة لأن الكانفس يملؤها هي لا الصفحة. */
  function target() {
    return { x: (W / dpr) / 2, y: (H / dpr) / 2 };
  }

  function step(d, dt, t) {
    var prevX = d.x, prevY = d.y;
    d.x += d.vx * d.speed * dt;
    d.y += d.vy * d.speed * dt;
    d.life += dt;

    // الانعطاف عند مركز نجمة فقط: هناك وحدها تلتقي الأشرطة في النقش
    if (d.vx !== 0) {
      var cx = centreX(d.i + (d.vx > 0 ? 1 : -1));
      if ((d.vx > 0 && prevX < cx && d.x >= cx) || (d.vx < 0 && prevX > cx && d.x <= cx)) {
        d.i += d.vx > 0 ? 1 : -1;
        d.x = cx;
        if (Math.random() < TURN) { d.vy = t.y > d.y ? 1 : -1; d.vx = 0; }
      }
    } else if (d.vy !== 0) {
      var cy = centreY(d.j + (d.vy > 0 ? 1 : -1));
      if ((d.vy > 0 && prevY < cy && d.y >= cy) || (d.vy < 0 && prevY > cy && d.y <= cy)) {
        d.j += d.vy > 0 ? 1 : -1;
        d.y = cy;
        if (Math.random() < TURN) { d.vx = t.x > d.x ? 1 : -1; d.vy = 0; }
      }
    }

    d.trail.push(d.x, d.y);
    if (d.trail.length > TRAIL * 2) d.trail.splice(0, 2);

    var w = W / dpr, h = H / dpr, pad = CELL;
    if (d.x < -pad || d.x > w + pad || d.y < -pad || d.y > h + pad || d.life > 60) spawn(d);
  }

  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W / dpr, H / dpr);
    for (var k = 0; k < dots.length; k++) {
      var d = dots[k], tr = d.trail;
      // الذيل: قطع متدرّجة الشفافية بدل تدرّج خطّي — أرخص وأدقّ على المنعطف
      for (var p = 2; p < tr.length; p += 2) {
        var a = (p / tr.length) * 0.62;
        ctx.strokeStyle = 'rgba(' + ink + ',' + a.toFixed(3) + ')';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tr[p - 2], tr[p - 1]);
        ctx.lineTo(tr[p], tr[p + 1]);
        ctx.stroke();
      }
      // الهالة ثم النواة: الهالة وحدها تبدو ضبابية، والنواة وحدها تبدو نقطة ميتة
      ctx.fillStyle = 'rgba(' + ink + ',0.16)';
      ctx.beginPath(); ctx.arc(d.x, d.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(' + ink + ',0.95)';
      ctx.beginPath(); ctx.arc(d.x, d.y, 2.3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    // سقف الخطوة: تبويب عاد من الخلفية يعطي فرقًا بالثواني، فتقفز النقاط
    // نصف الشاشة في إطار واحد.
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    var t = target();
    for (var k = 0; k < dots.length; k++) step(dots[k], dt, t);
    paint();
  }

  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }

  function start() {
    stop();
    if (!resize()) return;
    if (W / dpr < MIN_WIDTH) { ctx.clearRect(0, 0, W, H); return; }
    makeDots();
    if (reduce.matches) {
      // إطار واحد ساكن: النقاط موجودة على الشبكة ولا تتحرّك. إخفاؤها تمامًا
      // يترك النقش أصمّ، وتحريكها يخالف تفضيلًا صريحًا.
      for (var k = 0; k < dots.length; k++) dots[k].trail.length = 0;
      paint();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(start, 180);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (!reduce.matches && W / dpr >= MIN_WIDTH) { last = 0; raf = requestAnimationFrame(frame); }
  });

  // تبديل الوضع الليلي يغيّر ‎--brand‎، والنقاط تقرأ لونها من المحسوب —
  // فبلا هذا المراقب تبقى بلون السمة السابقة حتى إعادة التحميل.
  if (window.MutationObserver) {
    new MutationObserver(readInk).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  if (reduce.addEventListener) reduce.addEventListener('change', start);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
