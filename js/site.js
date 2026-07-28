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
  gsap.registerPlugin(ScrollTrigger);
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

  /* ── التشغيل ── */
  function boot() {
    heroSweep();
    heroIn();
    reveals();
    leaks();
    rail();
    parallax();
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
