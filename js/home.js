/* ============================================================
   الصفحة الرئيسية — مشهد الرحلة (Canvas Sequence) + السكرول الأفقي
   ============================================================ */
(function () {
  "use strict";
  if (typeof gsap === "undefined") return;

  document.addEventListener("mk:ready", function (e) {
    var reduce = e.detail.reduce;
    var desktop = e.detail.desktop;

    /* ---------- مشهد الرحلة المثبّت (ديسكتوب فقط) ---------- */
    var stage = document.querySelector(".process-stage");
    var canvas = document.querySelector(".process-canvas");
    if (stage && canvas && desktop && !reduce) {
      initScene(stage, canvas);
    }

    /* ---------- السكرول الأفقي لمختارات الأعمال ---------- */
    var track = document.querySelector(".hw-track");
    var viewport = document.querySelector(".hw-viewport");
    if (track && viewport) {
      if (desktop && !reduce) {
        var amount = function () { return Math.max(0, track.scrollWidth - viewport.clientWidth); };
        gsap.to(track, {
          x: function () { return amount(); },   /* RTL: المخفي على الشمال، فنزيح لليمين */
          ease: "none",
          scrollTrigger: {
            trigger: ".hw-pin",
            start: "top top",
            end: function () { return "+=" + amount(); },
            pin: true,
            scrub: 1,
            anticipatePin: 1,
            invalidateOnRefresh: true
          }
        });
        /* دخول الكروت داخل المسار الأفقي */
        gsap.utils.toArray(".hw-card").forEach(function (card, i) {
          gsap.fromTo(card, { autoAlpha: 0, y: 50 }, {
            autoAlpha: 1, y: 0, duration: 0.7, delay: i * 0.05,
            scrollTrigger: { trigger: ".hw-pin", start: "top 75%", once: true }
          });
        });
      } else {
        viewport.classList.add("free");
      }
    }

    ScrollTrigger.refresh();
  });

  /* ============================================================
     مشهد "رحلة المشروع": موقع يتبني قدامك مع السكرول
     أربع مراحل: اكتشاف ← تصميم ← تطوير ← إطلاق
     ============================================================ */
  function initScene(stage, canvas) {
    var ctx = canvas.getContext("2d");
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = 0, H = 0;

    function resize() {
      W = stage.clientWidth; H = stage.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", function () { resize(); draw(lastP); });

    var PURPLE = "#a855f7", PURPLE2 = "#7c3aed", DEEP = "#4c1d95";

    /* أدوات */
    var clamp01 = gsap.utils.clamp(0, 1);
    function seg(a, b, p) { return clamp01((p - a) / (b - a)); }
    function eo(t) { return 1 - Math.pow(1 - t, 3); }             /* power2.out */
    function rr(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* جسيمات الإطلاق — مواضع شبه عشوائية ثابتة (بدون Math.random عشان الثبات) */
    var particles = [];
    for (var i = 0; i < 42; i++) {
      var fr = (i * 0.6180339887) % 1; /* توزيع ذهبي */
      particles.push({ fx: fr, sp: 0.45 + ((i * 7919) % 100) / 180, r: 1.5 + ((i * 13) % 5) });
    }

    var lastP = 0;
    function draw(p) {
      lastP = p;
      ctx.clearRect(0, 0, W, H);

      /* شبكة نقاط خلفية */
      var gridA = 0.5 * seg(0, 0.12, p) * (1 - seg(0.85, 1, p) * 0.7);
      ctx.fillStyle = "rgba(168,85,247," + (0.07 * gridA) + ")";
      var gap = 46;
      for (var gx = gap / 2; gx < W; gx += gap)
        for (var gy = gap / 2; gy < H; gy += gap) {
          ctx.beginPath(); ctx.arc(gx, gy, 1.4, 0, 7); ctx.fill();
        }

      /* إطار المتصفح في المنتصف */
      var bw = Math.min(W * 0.62, 860), bh = Math.min(H * 0.62, 520);
      var launch = eo(seg(0.8, 1, p));
      var scale = 1 + launch * 0.06;
      var bx = (W - bw * scale) / 2, by = (H - bh * scale) / 2 - launch * H * 0.04;
      ctx.save();
      ctx.translate(bx, by); ctx.scale(scale, scale);

      /* توهج خلف الإطار */
      var glowA = 0.25 * eo(seg(0.5, 0.8, p)) + 0.5 * launch;
      if (glowA > 0.01) {
        var g = ctx.createRadialGradient(bw / 2, bh / 2, 40, bw / 2, bh / 2, bw * 0.7);
        g.addColorStop(0, "rgba(168,85,247," + glowA * 0.5 + ")");
        g.addColorStop(1, "rgba(168,85,247,0)");
        ctx.fillStyle = g;
        ctx.fillRect(-bw * 0.3, -bh * 0.3, bw * 1.6, bh * 1.6);
      }

      /* المرحلة ١: رسم الإطار (Stroke draw) */
      var t1 = eo(seg(0.02, 0.24, p));
      if (t1 > 0) {
        ctx.fillStyle = "rgba(13,11,19," + (0.85 * t1) + ")";
        rr(0, 0, bw, bh, 18); ctx.fill();
        var per = 2 * (bw + bh);
        ctx.strokeStyle = PURPLE;
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(168,85,247,.6)"; ctx.shadowBlur = 14;
        ctx.setLineDash([per]);
        ctx.lineDashOffset = per * (1 - t1);
        rr(0, 0, bw, bh, 18); ctx.stroke();
        ctx.setLineDash([]); ctx.shadowBlur = 0;
        /* شريط العنوان */
        ctx.globalAlpha = t1;
        ctx.strokeStyle = "rgba(255,255,255,.09)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, 46); ctx.lineTo(bw, 46); ctx.stroke();
        var dots = ["#f87171", "#fbbf24", "#34d399"];
        for (var d = 0; d < 3; d++) {
          ctx.fillStyle = dots[d];
          ctx.beginPath(); ctx.arc(bw - 26 - d * 20, 23, 5.5, 0, 7); ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,255,.06)";
        rr(24, 13, bw * 0.4, 20, 10); ctx.fill();
        ctx.globalAlpha = 1;
      }

      /* المرحلة ٢: بلوكات الوايرفريم تدخل (RTL) */
      var blocks = [
        { x: bw - 30 - bw * 0.42, y: 76,  w: bw * 0.42, h: 26, hue: 0.85 },  /* عنوان */
        { x: bw - 30 - bw * 0.3,  y: 116, w: bw * 0.3,  h: 14, hue: 0.3 },   /* سطر */
        { x: bw - 30 - bw * 0.24, y: 144, w: bw * 0.24, h: 14, hue: 0.2 },   /* سطر */
        { x: bw - 30 - 120,       y: 182, w: 120,       h: 34, hue: 1, btn: true }, /* زرار */
        { x: 30, y: 76, w: bw * 0.34, h: 140, hue: 0.6, img: true }          /* صورة */
      ];
      var cardW = (bw - 60 - 40) / 3;
      for (var c = 0; c < 3; c++)
        blocks.push({ x: 30 + c * (cardW + 20), y: bh - 30 - (bh - 260), w: cardW, h: bh - 260, hue: 0.5, card: true, i: c });

      blocks.forEach(function (b, bi) {
        var st = 0.22 + bi * 0.035;
        var tb = eo(seg(st, st + 0.12, p));
        if (tb <= 0) return;
        var fill = eo(seg(0.52, 0.78, p)); /* المرحلة ٣: التلوين */
        ctx.save();
        ctx.globalAlpha = tb;
        ctx.translate(0, (1 - tb) * 26);
        var alpha = 0.10 + b.hue * 0.12 + fill * 0.3 * b.hue;
        if (b.btn || (fill > 0 && (b.img || b.card))) {
          var lg = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
          lg.addColorStop(0, b.btn ? PURPLE : "rgba(168,85,247," + alpha + ")");
          lg.addColorStop(1, b.btn ? PURPLE2 : "rgba(124,58,237," + alpha + ")");
          ctx.fillStyle = lg;
        } else {
          ctx.fillStyle = "rgba(255,255,255," + (0.07 + b.hue * 0.1) + ")";
        }
        rr(b.x, b.y, b.w, b.h, b.btn ? b.h / 2 : 10);
        ctx.fill();
        if ((b.img || b.card) && fill > 0.15) {
          ctx.strokeStyle = "rgba(168,85,247," + 0.35 * fill + ")";
          ctx.lineWidth = 1.5;
          rr(b.x, b.y, b.w, b.h, 10); ctx.stroke();
        }
        ctx.restore();
      });

      ctx.restore();

      /* المرحلة ٤: جسيمات الإطلاق */
      if (launch > 0.01) {
        particles.forEach(function (pt) {
          var py = H * 0.95 - launch * pt.sp * H * 1.05;
          var px = pt.fx * W;
          var a = clamp01(1.3 - launch) * 0.8;
          ctx.fillStyle = "rgba(192,132,252," + a + ")";
          ctx.beginPath(); ctx.arc(px, py, pt.r * (0.6 + launch), 0, 7); ctx.fill();
        });
      }
    }

    /* نصوص المراحل + مؤشر التقدم */
    var steps = gsap.utils.toArray(".p-step");
    var bars = gsap.utils.toArray(".p-progress i");
    var current = -1;
    gsap.set(steps[0], { opacity: 1 });
    function setStep(idx) {
      if (idx === current) return;
      if (current >= 0) gsap.to(steps[current], { opacity: 0, y: -24, duration: 0.35, ease: "power2.in", overwrite: true });
      gsap.fromTo(steps[idx], { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", overwrite: true, delay: 0.1 });
      current = idx;
    }
    setStep(0);

    ScrollTrigger.create({
      trigger: stage,
      start: "top top",
      end: "+=320%",
      pin: true,
      scrub: 0.6,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: function (self) {
        var p = self.progress;
        draw(p);
        setStep(Math.min(3, Math.floor(p * 4)));
        bars.forEach(function (b, i) {
          b.style.setProperty("--p", clamp01(p * 4 - i));
        });
      }
    });
    draw(0);
  }
})();
