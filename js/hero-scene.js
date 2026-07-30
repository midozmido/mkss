/* ============================================================
   مشهد خلفية الهيرو — «الضوء الواحد»
   دالة زمن دورية بحتة: draw(ctx, t, W, H) حيث t ∈ [0,1)
   كل حركة مبنية على sin/cos لمضاعفات 2π ⇒ الإطار الأخير = الأول
   يُستخدم مرتين: (١) لتصدير WebM  (٢) كبديل حي داخل الموقع
   ============================================================ */
(function (root) {
  "use strict";
  var TAU = Math.PI * 2;

  /* عشوائية ثابتة — نفس المشهد في كل تشغيل */
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* نسيج تشويش دقيق: يكسر التكتّل في التدرّجات الداكنة — بلاه يظهر «تبقيع» مربّع */
  var DITHER = null;
  function dither() {
    if (DITHER) return DITHER;
    var n = 160, c = document.createElement("canvas");
    c.width = c.height = n;
    var x = c.getContext("2d");
    var img = x.createImageData(n, n), d = img.data, r = rng(770315);
    for (var i = 0; i < d.length; i += 4) {
      var v = Math.round(r() * 255);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 17;                     /* شفافية منخفضة جدًا — يُحَسّ ولا يُرى */
    }
    x.putImageData(img, 0, 0);
    DITHER = c;
    return c;
  }

  var MOTES = null, SHAFTS = null;
  function build() {
    var r = rng(20260730);
    MOTES = [];
    for (var i = 0; i < 90; i++) {
      MOTES.push({
        x: r(), y: r(),
        z: 0.25 + r() * 0.95,          /* العمق: يتحكم في الحجم والسرعة والوضوح */
        ph: r(),                        /* طور الدورة */
        amp: 0.02 + r() * 0.07,         /* سعة التمايل الأفقي */
        cyc: 1 + Math.floor(r() * 2)    /* عدد الدورات داخل اللوب — عدد صحيح ⇒ لوب نظيف */
      });
    }
    SHAFTS = [];
    for (var j = 0; j < 4; j++) {
      SHAFTS.push({
        x: 0.16 + j * 0.23 + r() * 0.06,
        w: 0.05 + r() * 0.12,
        lean: -0.22 + r() * 0.44,
        ph: r(),
        a: 0.085 + r() * 0.10
      });
    }
  }

  function draw(x, t, W, H) {
    if (!MOTES) build();
    var S = Math.min(W, H) / 900;      /* معامل قياس ليعمل المشهد على أي مقاس */

    /* ── ١) الغرفة ── */
    x.fillStyle = "#050308";
    x.fillRect(0, 0, W, H);

    /* ── ٢) المصدر: هالة بنفسجية واحدة تتنفّس فوق المنتصف ── */
    var breath = 0.5 + 0.5 * Math.sin(t * TAU);
    var cx = W * (0.5 + 0.035 * Math.sin(t * TAU));
    var cy = H * (0.34 + 0.03 * Math.cos(t * TAU));
    var R = Math.max(W, H) * (0.62 + 0.09 * breath);

    var g = x.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0.00, "rgba(176,38,255," + (0.30 + 0.10 * breath).toFixed(3) + ")");
    g.addColorStop(0.16, "rgba(150,34,222," + (0.17 + 0.06 * breath).toFixed(3) + ")");
    g.addColorStop(0.42, "rgba(61,11,112," + (0.13 + 0.04 * breath).toFixed(3) + ")");
    g.addColorStop(0.74, "rgba(24,6,46,0.05)");
    g.addColorStop(1.00, "rgba(5,3,8,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);

    /* نواة صغيرة شديدة السطوع — «اللمبة» نفسها */
    var core = x.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.085);
    core.addColorStop(0, "rgba(233,216,255," + (0.16 + 0.09 * breath).toFixed(3) + ")");
    core.addColorStop(1, "rgba(233,216,255,0)");
    x.fillStyle = core;
    x.fillRect(0, 0, W, H);

    /* ── ٣) أعمدة الضوء النازلة ── */
    x.save();
    x.globalCompositeOperation = "screen";
    for (var i = 0; i < SHAFTS.length; i++) {
      var s = SHAFTS[i];
      var drift = 0.045 * Math.sin((t + s.ph) * TAU);
      var puls = 0.55 + 0.45 * Math.sin((t + s.ph) * TAU);
      var x0 = (s.x + drift) * W;
      var wpx = s.w * W;
      var lean = s.lean * W * 0.5;

      var sg = x.createLinearGradient(x0, 0, x0 + lean, H);
      sg.addColorStop(0.00, "rgba(176,38,255," + (s.a * puls * 1.15).toFixed(4) + ")");
      sg.addColorStop(0.45, "rgba(140,40,210," + (s.a * puls * 0.45).toFixed(4) + ")");
      sg.addColorStop(1.00, "rgba(176,38,255,0)");
      x.fillStyle = sg;
      x.beginPath();
      x.moveTo(x0 - wpx * 0.5, -2);
      x.lineTo(x0 + wpx * 0.5, -2);
      x.lineTo(x0 + lean + wpx * 2.1, H + 2);
      x.lineTo(x0 + lean - wpx * 1.7, H + 2);
      x.closePath();
      x.fill();
    }
    x.restore();

    /* ── ٤) العلامة: ثلاثة أعمدة كالشعار، تتنفّس وتنجرف ببطء ──
       حوافّ حادّة ⇒ تنجو من الضغط، بعكس الخطوط الرفيعة الباهتة. */
    var hz = H * 0.63;
    x.save();
    x.globalCompositeOperation = "screen";
    var BARS = [
      { x: 0.400, h: 0.60, w: 0.0045, a: 0.55, ph: 0.00 },
      { x: 0.500, h: 0.42, w: 0.0035, a: 0.30, ph: 0.33 },
      { x: 0.582, h: 0.28, w: 0.0028, a: 0.18, ph: 0.66 }
    ];
    for (var q = 0; q < BARS.length; q++) {
      var bar = BARS[q];
      var pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((t + bar.ph) * TAU));
      var bw = Math.max(1, bar.w * W);
      var bh = bar.h * H;
      var bx = (bar.x + 0.012 * Math.sin((t + bar.ph) * TAU)) * W;
      var by = H * 0.5 - bh * 0.5 + H * 0.02 * Math.cos((t + bar.ph) * TAU);
      /* هالة حول العمود */
      var bg = x.createLinearGradient(bx - bw * 9, 0, bx + bw * 9, 0);
      bg.addColorStop(0.0, "rgba(176,38,255,0)");
      bg.addColorStop(0.5, "rgba(176,38,255," + (0.16 * bar.a * pulse).toFixed(4) + ")");
      bg.addColorStop(1.0, "rgba(176,38,255,0)");
      x.fillStyle = bg;
      x.fillRect(bx - bw * 9, by, bw * 18, bh);
      /* العمود نفسه */
      var cg = x.createLinearGradient(0, by, 0, by + bh);
      cg.addColorStop(0.00, "rgba(233,216,255,0)");
      cg.addColorStop(0.28, "rgba(233,216,255," + (0.42 * bar.a * pulse).toFixed(4) + ")");
      cg.addColorStop(0.72, "rgba(233,216,255," + (0.42 * bar.a * pulse).toFixed(4) + ")");
      cg.addColorStop(1.00, "rgba(233,216,255,0)");
      x.fillStyle = cg;
      x.fillRect(bx - bw * 0.5, by, bw, bh);
    }
    x.restore();

    /* ── ٥) مستوى ضوئي أفقي يمسح الغرفة ببطء ── */
    var sweepY = hz - H * 0.5 * Math.sin(t * TAU + 0.6);
    var sw = x.createLinearGradient(0, sweepY - H * 0.09, 0, sweepY + H * 0.09);
    sw.addColorStop(0, "rgba(176,38,255,0)");
    sw.addColorStop(0.5, "rgba(200,120,255,0.085)");
    sw.addColorStop(1, "rgba(176,38,255,0)");
    x.fillStyle = sw;
    x.fillRect(0, sweepY - H * 0.09, W, H * 0.18);
    x.fillStyle = "rgba(233,216,255,0.085)";
    x.fillRect(0, sweepY, W, Math.max(1, S));

    /* ── ٦) الهباء: ذرّات تسبح في شعاع الضوء ── */
    x.save();
    x.globalCompositeOperation = "lighter";
    for (var n = 0; n < MOTES.length; n++) {
      var p = MOTES[n];
      var rise = (p.y - t * 0.34 * p.z) % 1;
      if (rise < 0) rise += 1;
      var px = (p.x + p.amp * Math.sin((t * p.cyc + p.ph) * TAU)) * W;
      var py = rise * H;
      var rad = (0.6 + p.z * 1.9) * S;
      /* الذرّة تلمع أكثر كلما اقتربت من المصدر */
      var dx = (px - cx) / W, dy = (py - cy) / H;
      var near = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.72);
      var a = (0.05 + 0.30 * near) * (0.35 + p.z * 0.65);
      /* تلاشٍ عند الحافتين حتى لا تظهر/تختفي فجأة */
      a *= Math.min(1, rise * 7) * Math.min(1, (1 - rise) * 7);
      if (a <= 0.002) continue;
      x.fillStyle = "rgba(233,216,255," + a.toFixed(4) + ")";
      x.beginPath();
      x.arc(px, py, rad, 0, TAU);
      x.fill();
    }
    x.restore();

    /* ── ٧) تشويش دقيق فوق كل شيء — يمنع تكتّل الضغط في التدرّجات ── */
    var dz = dither();
    var pat = x.createPattern(dz, "repeat");
    x.save();
    x.globalCompositeOperation = "overlay";
    /* إزاحة العيّنة كل إطار حتى لا يثبت النسيج ويُقرأ كوسخ على الشاشة */
    var ox = Math.round(Math.sin(t * TAU * 3) * 80);
    var oy = Math.round(Math.cos(t * TAU * 2) * 80);
    x.translate(ox, oy);
    x.fillStyle = pat;
    x.fillRect(-ox, -oy, W, H);
    x.restore();

    /* ── ٨) تعتيم الأطراف ── */
    var v = x.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.20,
                                   W * 0.5, H * 0.46, Math.max(W, H) * 0.70);
    v.addColorStop(0.00, "rgba(5,3,8,0)");
    v.addColorStop(0.62, "rgba(5,3,8,0.55)");
    v.addColorStop(0.86, "rgba(5,3,8,1)");
    v.addColorStop(1.00, "rgba(5,3,8,1)");
    x.fillStyle = v;
    x.fillRect(0, 0, W, H);
  }

  root.HeroScene = { draw: draw };
})(typeof window !== "undefined" ? window : globalThis);
