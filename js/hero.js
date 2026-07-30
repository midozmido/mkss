/* ============================================================
   الهيرو — لوحة الضوء تتمدّد من ٥٠٪ إلى ملء الشاشة مع السكرول،
   ثم يدخل النص متمركزًا بعد أن تنتهي الحركة.
   · الخلفية: فيديو WebM، وإن تعذّر ⇒ نفس المشهد حيًّا على كانفس
   · بلا JS أو مع تقليل الحركة: اللوحة مفتوحة والنص ظاهر من أول لحظة
   ============================================================ */
(function () {
  "use strict";

  var sect = document.querySelector(".hero");
  var hero = document.querySelector(".hero-pin");   /* الغلاف الذي يُثبَّت */
  if (!sect || !hero) return;

  var stage = hero.querySelector(".hero-stage");
  var media = hero.querySelector(".hero-media");
  var veil = hero.querySelector(".hero-veil");
  var frame = hero.querySelector(".hero-frame");
  var vid = hero.querySelector(".hero-vid");
  var fb = hero.querySelector(".hero-fb");
  var inner = hero.querySelector(".hero-in");
  var hint = hero.querySelector(".hero-hint");
  var cap = hero.querySelector(".hero-cap");

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var slow = (function () {
    var c = navigator.connection;
    if (!c) return false;
    return c.saveData === true || /(^|-)2g$/.test(c.effectiveType || "");
  })();

  /* ══════════ ١) الخلفية ══════════ */
  var fbTicker = null;

  function startFallback() {
    if (!fb || !window.HeroScene || fbTicker) return;
    stage.classList.add("fb");
    var x = fb.getContext("2d", { alpha: false });
    var PERIOD = 8000;                       /* نفس دورة الفيديو */
    var t0 = (window.performance || Date).now();
    fbTicker = function () {
      var t = (((window.performance || Date).now() - t0) % PERIOD) / PERIOD;
      window.HeroScene.draw(x, t, fb.width, fb.height);
    };
    if (window.gsap) gsap.ticker.add(fbTicker);
    else (function loop() { fbTicker(); requestAnimationFrame(loop); })();
  }

  function stillFallback() {
    /* تقليل الحركة أو شبكة بطيئة: إطار ساكن واحد، بلا فيديو وبلا حلقة */
    if (!fb || !window.HeroScene) return;
    stage.classList.add("fb");
    window.HeroScene.draw(fb.getContext("2d", { alpha: false }), 0, fb.width, fb.height);
  }

  function initMedia() {
    if (!vid) return;
    if (reduce || slow) { vid.remove(); stillFallback(); return; }

    /* المقاس حسب العرض — لا داعي لـ١٫٤ ميجا على شاشة هاتف */
    vid.src = window.innerWidth >= 1100 ? "assets/hero/beam-1440.webm"
                                        : "assets/hero/beam-960.webm";
    vid.load();

    var settled = false;
    function ok() {
      if (settled) return;
      settled = true;
      var pr = vid.play();
      if (pr && pr.catch) pr.catch(function () { vid.remove(); startFallback(); });
    }
    function bad() {
      if (settled) return;
      settled = true;
      vid.remove();
      startFallback();
    }
    vid.addEventListener("canplay", ok, { once: true });
    vid.addEventListener("error", bad, { once: true });
    /* لو المتصفح لا يفكّ ترميز VP9 فقد لا يُطلق أي حدث — نحسم بعد مهلة */
    setTimeout(function () { if (!settled && vid.readyState < 2) bad(); }, 1600);
  }

  /* نبدأ التحميل بعد فتح الستارة، حتى لا يزاحم الخطوط على النطاق */
  if (document.documentElement.classList.contains("pre-on")) {
    document.addEventListener("mk:opened", initMedia, { once: true });
  } else {
    initMedia();
  }

  /* ══════════ ٢) الحركة ══════════ */
  document.addEventListener("mk:ready", function (e) {
    var mm = e.detail.mm, DESK = e.detail.DESK, SPEED = e.detail.SPEED || 1;

    /* الحالة المفتوحة: نص ظاهر ولوحة كاملة — هي الحالة الوحيدة بلا حركة.
       على الشاشة الرأسية يُقصّ الفيديو على نواته المضيئة، فيحتاج حجابًا أثقل. */
    function openState() {
      var narrow = window.innerWidth < 1025;
      gsap.set(stage, { clipPath: "inset(0%)" });
      gsap.set(media, { scale: 1 });
      gsap.set(veil, { opacity: narrow ? 0.82 : 0.68 });
      gsap.set(frame, { opacity: 0, clipPath: "inset(0%)" });
      gsap.set(inner, { opacity: 1 });
      gsap.set(hero.querySelectorAll("[data-hero]"), { opacity: 1, y: 0 });
      if (hint) gsap.set(hint, { opacity: 0 });
      if (cap) gsap.set(cap, { opacity: 0 });
    }

    if (e.detail.reduce) { openState(); return; }

    /* التثبيت على كل المقاسات — القيم فقط هي التي تتغيّر.
       على الشاشة الضيقة: شبّاك أوسع قليلًا (٦٠٪ لا ٥٠٪) ومسافة سكرول أقصر. */
    mm.add({ wide: DESK, narrow: "(max-width: 1024px)" }, function (ctx) {
      var wide = !!ctx.conditions.wide;
      var START = wide ? 25 : 20;              /* إزاحة الشبّاك المبدئية بالنسبة المئوية */
      var LEN = wide ? 150 : 110;              /* طول مسافة السكرول */
      var heads = gsap.utils.toArray(hero.querySelectorAll(".poster .mask"));
      var bits = gsap.utils.toArray(hero.querySelectorAll("[data-hero]"))
        .sort(function (a, b) { return (+a.dataset.hero || 0) - (+b.dataset.hero || 0); });

      gsap.set(inner, { opacity: 1 });
      gsap.set(heads, { opacity: 0 });
      gsap.set(hero.querySelectorAll(".poster .p-line"), { yPercent: 118 });
      gsap.set(bits, { opacity: 0, y: 42 });
      gsap.set(stage, { clipPath: "inset(" + START + "%)" });
      gsap.set(media, { scale: wide ? 1.12 : 1.08 });
      gsap.set(veil, { opacity: wide ? 0.32 : 0.46 });
      gsap.set(frame, { opacity: 1, inset: START + "%" });
      if (cap) gsap.set(cap, { opacity: 1 });
      if (hint) gsap.to(hint, { opacity: 1, duration: 1.1, delay: 1.4, ease: "power2.out" });

      var tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: sect,
          start: "top top",
          end: "+=" + Math.round(LEN * SPEED) + "%",
          pin: hero,
          scrub: 0.9,
          anticipatePin: 1,
          invalidateOnRefresh: true
        }
      });

      /* ① الشبّاك يفتح من ٥٠٪ إلى ملء الشاشة */
      tl.to(stage, { clipPath: "inset(0%)", duration: 0.52, ease: "power2.inOut" }, 0)
        .to(media, { scale: 1, duration: 0.52, ease: "power2.inOut" }, 0)
        .to(veil, { opacity: wide ? 0.68 : 0.82, duration: 0.52 }, 0)
        .to(frame, { top: "0%", right: "0%", bottom: "0%", left: "0%", duration: 0.52, ease: "power2.inOut" }, 0)
        .to(frame, { opacity: 0, duration: 0.22 }, 0.30);
      if (hint) tl.to(hint, { opacity: 0, duration: 0.12 }, 0);
      if (cap) tl.to(cap, { opacity: 0, y: -24, duration: 0.16, ease: "power2.in" }, 0);

      /* ② سكون قصير — الفيديو وحده في الشاشة */
      /* ③ النص يدخل بعد اكتمال التمدد */
      tl.to(heads, { opacity: 1, duration: 0.04 }, 0.60)
        .to(hero.querySelectorAll(".poster .p-line"),
          { yPercent: 0, duration: 0.20, stagger: 0.07, ease: "power3.out" }, 0.60)
        .add(function () { runSweep(); }, 0.80)
        .to(bits, { opacity: 1, y: 0, duration: 0.16, stagger: 0.055, ease: "power3.out" }, 0.82);

      return function () {
        tl.scrollTrigger && tl.scrollTrigger.kill();
        tl.kill();
        openState();
      };
    });

  });

  /* ══════════ ٣) العبور الضوئي على العنوان ══════════ */
  var swept = false;
  function runSweep() {
    if (swept || typeof gsap === "undefined") return;
    swept = true;
    var lines = hero.querySelectorAll(".poster .p-line");
    var beam = hero.querySelector(".beam-line");
    var tl = gsap.timeline();
    if (beam) {
      tl.set(beam, { opacity: 1, transformOrigin: "center" })
        .fromTo(beam, { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power2.out" }, 0)
        .to(beam, { opacity: 0, duration: 0.7 }, 0.8);
    }
    lines.forEach(function (line, i) {
      var sweep = line.querySelector(".sweep");
      var copy = line.querySelector(".copy");
      if (!sweep || !copy) return;
      var span = line.offsetWidth + sweep.offsetWidth;
      tl.set(sweep, { opacity: 1 }, i * 0.14)
        .fromTo(sweep, { x: 0 }, { x: -span, duration: 1.35, ease: "power2.inOut" }, i * 0.14)
        .fromTo(copy, { x: 0 }, { x: span, duration: 1.35, ease: "power2.inOut" }, i * 0.14)
        .set(sweep, { opacity: 0 }, i * 0.14 + 1.35);
    });
  }
  window.MKHeroSweep = runSweep;
})();
