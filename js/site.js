/* ============================================================
   محرك الحركة المشترك — «الضوء الواحد»
   مفردات: power3.out (الكشف) · power2.inOut (الضوء) · expo.out (المثبَّت)
   بلا سكرول ناعم · بلا بريلودر · بلا انتقالات صفحات · بلا كيرسر مخصص
   ============================================================ */
(function () {
  "use strict";

  var doc = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── القائمة على الموبايل: تعمل بلا GSAP ── */
  var burger = document.querySelector(".burger");
  var mnav = document.querySelector(".mnav");
  if (burger && mnav) {
    burger.addEventListener("click", function () {
      var open = burger.getAttribute("aria-expanded") === "true";
      burger.setAttribute("aria-expanded", String(!open));
      mnav.style.display = open ? "none" : "block";
    });
  }

  /* ── نسيج الحبيبات: يُولَّد مرة واحدة ويُثبَّت كصورة خلفية ── */
  function makeGrain() {
    var n = 128, c = document.createElement("canvas");
    c.width = c.height = n;
    var x = c.getContext("2d");
    var img = x.createImageData(n, n), d = img.data;
    var s = 20260728;
    function r() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    for (var i = 0; i < d.length; i += 4) {
      var v = 110 + r() * 66;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    doc.style.setProperty("--grain-src", 'url("' + c.toDataURL("image/png") + '")');
  }
  try { makeGrain(); } catch (e) { /* الحبيبات تحسين لا أكثر */ }

  /* ── بلا GSAP: كل شيء ظاهر والموقع يعمل ── */
  if (typeof gsap === "undefined") {
    doc.classList.remove("js");
    return;
  }
  var PLUGINS = [ScrollTrigger];
  if (window.SplitText) PLUGINS.push(SplitText);
  if (window.Flip) PLUGINS.push(Flip);
  gsap.registerPlugin.apply(gsap, PLUGINS);
  gsap.defaults({ ease: "power3.out", duration: 1.0 });

  var mm = gsap.matchMedia();
  var DESK = "(min-width: 1025px)";

  /* ══════════ ١) عبور الضوء على البوستر — مرة واحدة عند التحميل ══════════
     النافذة تتحرك يسارًا والنسخة تتحرك عكسها بنفس المقدار،
     فيبقى النص مسجَّلًا فوق الأصل بينما تعبر النافذة.
     العنوان مضاء بالكامل من الفريم الأول — لا حالة مطفأة. */
  function heroSweep() {
    var poster = document.querySelector(".poster");
    if (!poster || reduce) return null;
    var lines = poster.querySelectorAll(".p-line");
    if (!lines.length) return null;

    var tl = gsap.timeline({ delay: 0.15 });
    var beam = document.querySelector(".beam-line");
    if (beam) {
      tl.set(beam, { opacity: 1 })
        .fromTo(beam, { scaleX: 0, transformOrigin: "right" },
          { scaleX: 1, duration: 0.55, ease: "power2.out" }, 0)
        .to(beam, { opacity: 0, duration: 0.5 }, 0.55);
    }
    lines.forEach(function (line, i) {
      var sweep = line.querySelector(".sweep");
      var copy = line.querySelector(".copy");
      if (!sweep || !copy) return;
      var span = line.offsetWidth + sweep.offsetWidth;
      tl.set(sweep, { opacity: 1 }, i * 0.1)
        .fromTo(sweep, { x: 0 }, { x: -span, duration: 1.05, ease: "power2.inOut" }, i * 0.1)
        .fromTo(copy, { x: 0 }, { x: span, duration: 1.05, ease: "power2.inOut" }, i * 0.1)
        .set(sweep, { opacity: 0 }, i * 0.1 + 1.05);
    });
    return tl;
  }

  /* ══════════ ٢) دخول عناصر الهيرو ══════════ */
  function heroIn() {
    var els = gsap.utils.toArray("[data-hero]");
    if (!els.length) return;
    if (reduce) { gsap.set(els, { opacity: 1, y: 0 }); return; }
    els.sort(function (a, b) { return (+a.dataset.hero || 0) - (+b.dataset.hero || 0); });
    gsap.fromTo(els, { opacity: 0, y: 34 },
      { opacity: 1, y: 0, duration: 1.0, stagger: 0.09, ease: "power3.out", delay: 0.35 });
  }

  /* ══════════ ٣) الكشف عند السكرول ══════════ */
  function reveals() {
    var els = gsap.utils.toArray("[data-r]").filter(function (el) { return !el.hasAttribute("data-hero"); });
    if (!els.length) return;
    if (reduce) { gsap.set(els, { opacity: 1, y: 0 }); return; }
    ScrollTrigger.batch(els, {
      start: "top 78%",
      once: true,
      onEnter: function (batch) {
        gsap.fromTo(batch, { opacity: 0, y: 34 },
          { opacity: 1, y: 0, duration: 1.0, stagger: 0.09, ease: "power3.out", overwrite: true });
      }
    });
  }

  /* ══════════ ٤) الانقطاعات — الخيط يُرسم مع السكرول ══════════ */
  function leaks() {
    gsap.utils.toArray(".brk .leak").forEach(function (el) {
      if (reduce) { gsap.set(el, { scaleX: 1 }); return; }
      gsap.fromTo(el, { scaleX: 0 }, {
        scaleX: 1, ease: "none",
        scrollTrigger: { trigger: el.closest(".brk"), start: "top 92%", end: "bottom 55%", scrub: 0.8 }
      });
    });
  }

  /* ══════════ ٥) الريل — التدريج يمرّ تحت شعرة التصويب ══════════ */
  function rail() {
    var ticks = document.querySelector(".railbar .ticks");
    if (!ticks || reduce) return;
    mm.add(DESK, function () {
      var setY = gsap.quickSetter(ticks, "y", "px");
      var st = ScrollTrigger.create({
        start: 0, end: "max",
        onUpdate: function (self) { setY(-((self.scroll() * 0.35) % 40)); }
      });
      return function () { st.kill(); gsap.set(ticks, { y: 0 }); };
    });
  }

  /* ══════════ ٦) بارالاكس الصور النازفة — ديسكتوب فقط ══════════ */
  function parallax() {
    if (reduce) return;
    mm.add(DESK, function () {
      var tws = gsap.utils.toArray("[data-px] img").map(function (img) {
        gsap.set(img, { scale: 1.12 });
        return gsap.fromTo(img, { yPercent: -9 }, {
          yPercent: 9, ease: "none",
          scrollTrigger: { trigger: img.closest("[data-px]"), start: "top bottom", end: "bottom top", scrub: true }
        });
      });
      return function () { tws.forEach(function (t) { t.scrollTrigger && t.scrollTrigger.kill(); t.kill(); }); };
    });
  }


  /* ══════════ ٧) كشف العناوين سطرًا بسطر ══════════
     بالسطور فقط — التقسيم بالحروف يفكّ اتصال العربية. */
  function splitHeads() {
    if (!window.SplitText || reduce) return;
    gsap.utils.toArray("[data-split]").forEach(function (el) {
      if (el.closest(".pre")) return;
      SplitText.create(el, {
        type: "lines", mask: "lines", autoSplit: true, aria: "auto", linesClass: "sline",
        onSplit: function (self) {
          if (el._done) return gsap.set(self.lines, { yPercent: 0 });
          return gsap.from(self.lines, {
            yPercent: 112, duration: 1.05, stagger: 0.1, ease: "power4.out",
            onComplete: function () { el._done = true; },
            scrollTrigger: { trigger: el, start: "top 86%", once: true }
          });
        }
      });
    });
  }

  /* ══════════ ٨) عدّادات الأرقام ══════════ */
  var AR_DIGITS = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  function toAr(n) { return String(n).split("").map(function (d) { return AR_DIGITS[+d] !== undefined ? AR_DIGITS[+d] : d; }).join(""); }
  function counters() {
    gsap.utils.toArray("[data-count]").forEach(function (el) {
      var target = parseFloat(el.dataset.count);
      var pre = el.dataset.pre || "", post = el.dataset.post || "";
      if (reduce) { el.textContent = pre + toAr(target) + post; return; }
      var o = { v: 0 };
      gsap.to(o, {
        v: target, duration: 1.7, ease: "power2.out", snap: { v: 1 },
        onUpdate: function () { el.textContent = pre + toAr(Math.round(o.v)) + post; },
        scrollTrigger: { trigger: el, start: "top 88%", once: true }
      });
    });
  }

  /* ══════════ ٩) شريط تقدّم القراءة ══════════ */
  function progressBar() {
    var el = document.querySelector(".head .prog");
    if (!el || reduce) return;
    gsap.fromTo(el, { scaleX: 0 }, {
      scaleX: 1, ease: "none",
      scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 0.25 }
    });
  }

  /* ══════════ ١٠) ماركيه بتسارع حسب سرعة السكرول ══════════ */
  function marquee() {
    document.querySelectorAll(".marq-in").forEach(function (track) {
      if (reduce) return;
      var tw = gsap.to(track, { xPercent: 50, repeat: -1, duration: 30, ease: "none" });
      ScrollTrigger.create({
        onUpdate: function (self) {
          var boost = gsap.utils.clamp(1, 4, 1 + Math.abs(self.getVelocity()) / 1400);
          gsap.to(tw, { timeScale: boost, duration: 0.4, overwrite: true });
        }
      });
    });
  }

  /* ══════════ ١١) تشوّه خفيف حسب سرعة السكرول ══════════ */
  function velocitySkew() {
    if (reduce) return;
    var targets = gsap.utils.toArray("[data-skew]");
    if (!targets.length) return;
    mm.add(DESK, function () {
      var setters = targets.map(function (t) { return gsap.quickSetter(t, "skewY", "deg"); });
      var proxy = { s: 0 };
      var clamp = gsap.utils.clamp(-5, 5);
      var st = ScrollTrigger.create({
        onUpdate: function (self) {
          var v = clamp(self.getVelocity() / -420);
          if (Math.abs(v) > Math.abs(proxy.s)) {
            proxy.s = v;
            gsap.to(proxy, {
              s: 0, duration: 0.7, ease: "power3", overwrite: true,
              onUpdate: function () { setters.forEach(function (fn) { fn(proxy.s); }); }
            });
          }
        }
      });
      return function () { st.kill(); setters.forEach(function (fn) { fn(0); }); };
    });
  }

  /* ── التشغيل ── */
  function boot() {
    heroSweep();
    heroIn();
    splitHeads();
    reveals();
    leaks();
    rail();
    parallax();
    counters();
    progressBar();
    marquee();
    velocitySkew();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
    }
    window.addEventListener("load", function () { ScrollTrigger.refresh(); });
    document.dispatchEvent(new CustomEvent("mk:ready", { detail: { reduce: reduce, mm: mm, DESK: DESK } }));
  }

  window.MK = { reduce: reduce, mm: mm, DESK: DESK };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
