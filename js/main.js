/* ============================================================
   محرك الحركة المشترك — م. محمد خالد
   GSAP 3.13+ · ScrollTrigger · ScrollSmoother · SplitText
   ============================================================ */
(function () {
  "use strict";

  /* تدهور رشيق: لو GSAP مش موجود، الموقع يظهر كامل بدون حركة */
  if (typeof gsap === "undefined") {
    document.documentElement.classList.remove("js");
    var deadPre = document.querySelector(".preloader");
    if (deadPre) deadPre.remove();
    var deadCur = document.querySelector(".curtain");
    if (deadCur) deadCur.remove();
    return;
  }

  var plugins = [ScrollTrigger];
  if (window.ScrollSmoother) plugins.push(ScrollSmoother);
  if (window.SplitText) plugins.push(SplitText);
  if (window.Flip) plugins.push(Flip);
  gsap.registerPlugin.apply(gsap, plugins);

  /* ---------- ١) توكنز الحركة — عدّل هنا يتغيّر الموقع كله ---------- */
  var MOTION = {
    dur:  { fast: 0.35, base: 0.7, slow: 1.0, hero: 1.25 },
    ease: { out: "power3.out", inOut: "power4.inOut", in: "power2.in" },
    y: 44,
    stagger: 0.09,
    overlap: "-=0.35"
  };
  gsap.defaults({ duration: MOTION.dur.base, ease: MOTION.ease.out });

  /* ---------- ٢) الحركات البيتية ---------- */
  gsap.registerEffect({
    name: "reveal",
    extendTimeline: true,
    defaults: { y: MOTION.y, stagger: MOTION.stagger, duration: MOTION.dur.base },
    effect: function (t, c) {
      return gsap.fromTo(t,
        { y: c.y, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: c.duration, stagger: c.stagger, ease: MOTION.ease.out });
    }
  });
  gsap.registerEffect({
    name: "curtain",
    extendTimeline: true,
    defaults: { duration: MOTION.dur.slow },
    effect: function (t, c) {
      return gsap.fromTo(t,
        { clipPath: "inset(100% 0% 0% 0%)", autoAlpha: 1 },
        { clipPath: "inset(0% 0% 0% 0%)", autoAlpha: 1, duration: c.duration, ease: MOTION.ease.inOut });
    }
  });

  /* ---------- ٣) أدوات ---------- */
  function assetsReady() {
    var fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    /* الصور الكسولة (lazy) مش بتتحمل غير عند السكرول — منستناهاش */
    var imgs = Promise.all(
      Array.prototype.slice.call(document.images)
        .filter(function (i) { return !i.complete && i.loading !== "lazy"; })
        .map(function (i) { return new Promise(function (r) { i.onload = i.onerror = r; }); })
    );
    /* مهلة أمان: البريلودر عمره ما يعلّق أكثر من ٤ ثواني */
    var safety = new Promise(function (r) { setTimeout(r, 4000); });
    return Promise.race([Promise.all([fonts, imgs]), safety]);
  }

  var mmPointer = window.matchMedia("(hover:hover) and (pointer:fine)");
  var mmDesktop = window.matchMedia("(min-width: 900px)");
  var mmReduce  = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- ٤) السموث سكرول (ديسكتوب فقط) ---------- */
  var smoother = null;
  if (window.ScrollSmoother && mmDesktop.matches && !mmReduce.matches &&
      document.getElementById("smooth-wrapper")) {
    smoother = ScrollSmoother.create({
      wrapper: "#smooth-wrapper",
      content: "#smooth-content",
      smooth: 1.2,
      effects: true,
      smoothTouch: false,
      normalizeScroll: true
    });
  }

  /* ---------- ٥) الناف بار ---------- */
  var nav = document.querySelector(".nav");
  if (nav) {
    ScrollTrigger.create({
      start: 40,
      onToggle: function (self) { nav.classList.toggle("scrolled", self.isActive); }
    });
  }
  var burger = document.querySelector(".burger");
  var navMobile = document.querySelector(".nav-mobile");
  if (burger && navMobile) {
    var menuTL = gsap.timeline({ paused: true })
      .set(navMobile, { display: "block" })
      .fromTo(navMobile, { clipPath: "inset(0 0 100% 0)" },
        { clipPath: "inset(0 0 0% 0)", duration: 0.55, ease: MOTION.ease.inOut })
      .fromTo(navMobile.querySelectorAll("a, .btn"), { y: 22, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, stagger: 0.05, duration: 0.4 }, "-=0.25");
    var menuOpen = false;
    burger.addEventListener("click", function () {
      menuOpen = !menuOpen;
      burger.classList.toggle("open", menuOpen);
      if (menuOpen) { menuTL.timeScale(1).play(); }
      else { menuTL.timeScale(1.6).reverse(); }
    });
  }

  /* ---------- ٦) الكيرسر المخصص ---------- */
  if (mmPointer.matches && !mmReduce.matches) {
    var cur = document.createElement("div"); cur.className = "cursor";
    var dot = document.createElement("div"); dot.className = "cursor-dot";
    document.body.appendChild(cur); document.body.appendChild(dot);
    gsap.set([cur, dot], { xPercent: 0, autoAlpha: 0 });
    var cx = gsap.quickTo(cur, "x", { duration: 0.45, ease: "power3" });
    var cy = gsap.quickTo(cur, "y", { duration: 0.45, ease: "power3" });
    var dx = gsap.quickTo(dot, "x", { duration: 0.12, ease: "power2" });
    var dy = gsap.quickTo(dot, "y", { duration: 0.12, ease: "power2" });
    var shown = false;
    window.addEventListener("pointermove", function (e) {
      if (!shown) { gsap.to([cur, dot], { autoAlpha: 1, duration: 0.3 }); shown = true; }
      cx(e.clientX); cy(e.clientY); dx(e.clientX); dy(e.clientY);
    });
    document.addEventListener("pointerover", function (e) {
      if (e.target.closest("a, button, .chip, .opt-card, .f-btn")) cur.classList.add("is-link");
      if (e.target.closest(".w-img, .hw-img")) cur.classList.add("is-media");
    });
    document.addEventListener("pointerout", function (e) {
      if (e.target.closest("a, button, .chip, .opt-card, .f-btn")) cur.classList.remove("is-link");
      if (e.target.closest(".w-img, .hw-img")) cur.classList.remove("is-media");
    });

    /* أزرار مغناطيسية */
    document.querySelectorAll(".magnetic").forEach(function (btn) {
      var xT = gsap.quickTo(btn, "x", { duration: 0.5, ease: "elastic.out(1,0.45)" });
      var yT = gsap.quickTo(btn, "y", { duration: 0.5, ease: "elastic.out(1,0.45)" });
      btn.addEventListener("pointermove", function (e) {
        var r = btn.getBoundingClientRect();
        xT((e.clientX - (r.left + r.width / 2)) * 0.3);
        yT((e.clientY - (r.top + r.height / 2)) * 0.3);
      });
      btn.addEventListener("pointerleave", function () { xT(0); yT(0); });
    });
  }

  /* ---------- ٧) انتقالات الصفحات ---------- */
  var curtainEl = document.querySelector(".curtain");
  function navigateWithCurtain(href) {
    if (!curtainEl || mmReduce.matches) { location.href = href; return; }
    try { sessionStorage.setItem("mk-transition", "1"); } catch (e) {}
    gsap.timeline({ onComplete: function () { location.href = href; } })
      .set(curtainEl, { display: "grid", scaleY: 0, transformOrigin: "bottom" })
      .to(curtainEl, { scaleY: 1, duration: 0.55, ease: MOTION.ease.inOut })
      .fromTo(curtainEl.querySelector(".curtain-logo"), { y: 26, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.35 }, "-=0.2");
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (a.target === "_blank" || e.metaKey || e.ctrlKey) return;
    if (/^(https?:|#|tel:|mailto:|wa)/.test(href)) return;
    if (!/\.html(\?|#|$)|^\/$|^\.\/$/.test(href) && href.indexOf(".html") === -1) return;
    e.preventDefault();
    navigateWithCurtain(href);
  });
  function curtainIn() {
    var came = false;
    try { came = sessionStorage.getItem("mk-transition") === "1"; sessionStorage.removeItem("mk-transition"); } catch (e) {}
    if (!curtainEl || !came || mmReduce.matches) return gsap.timeline();
    /* غطِّ الصفحة فورًا (قبل أول رسم) — الستارة بتشتغل كبريلودر مصغّر */
    gsap.set(curtainEl, { display: "grid", scaleY: 1, transformOrigin: "top" });
    return gsap.timeline()
      .to(curtainEl, { scaleY: 0, duration: 0.6, ease: MOTION.ease.inOut, delay: 0.1 })
      .set(curtainEl, { display: "none" });
  }

  /* ---------- ٨) كشف العناوين سطرًا بسطر (SplitText) ---------- */
  function initSplitTitles(scopeReady) {
    if (!window.SplitText) {
      gsap.set("[data-split] .split-inner", { visibility: "visible" });
      return;
    }
    document.querySelectorAll("[data-split]").forEach(function (el) {
      var inner = el.querySelector(".split-inner") || el;
      var onLoad = el.getAttribute("data-split") === "load";
      SplitText.create(inner, {
        type: "lines",
        mask: "lines",
        autoSplit: true,
        aria: "auto",
        linesClass: "line",
        onSplit: function (self) {
          gsap.set(inner, { visibility: "visible" });
          /* إعادة التقسيم بعد أول تشغيل (تغيير مقاس) — بدون إعادة الحركة */
          if (el._mkPlayed) return gsap.set(self.lines, { yPercent: 0 });
          var vars = {
            yPercent: 112, duration: MOTION.dur.hero, stagger: 0.11,
            ease: "power4.out",
            onComplete: function () { el._mkPlayed = true; }
          };
          if (onLoad) {
            vars.delay = parseFloat(el.dataset.delay) || 0;
            if (scopeReady && scopeReady.startAt) vars.delay += scopeReady.startAt;
          } else {
            vars.scrollTrigger = { trigger: el, start: "top 86%", once: true };
          }
          return gsap.from(self.lines, vars);
        }
      });
    });
  }

  /* ---------- ٩) نظام الظهور بالسمات data-anim ---------- */
  var EFFECTS = {
    up:      function (el) { return gsap.fromTo(el, { y: MOTION.y, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: MOTION.dur.base }); },
    fade:    function (el) { return gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: MOTION.dur.slow }); },
    scale:   function (el) { return gsap.fromTo(el, { scale: 0.92, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: MOTION.dur.base }); },
    curtain: function (el) { return gsap.effects.curtain(el); }
  };
  function initReveals() {
    gsap.utils.toArray("[data-anim]").forEach(function (el) {
      if (el.closest("[data-hero-zone]")) return; /* الهيرو بيتحرك مع التحميل */
      var fx = EFFECTS[el.dataset.anim] || EFFECTS.up;
      var tw = fx(el).paused(true);
      tw.delay(parseFloat(el.dataset.delay) || 0);
      ScrollTrigger.create({ trigger: el, start: "top 88%", once: true, animation: tw });
    });
  }

  /* ---------- ١٠) عدّادات الأرقام ---------- */
  function initCounters() {
    gsap.utils.toArray("[data-count]").forEach(function (el) {
      var target = parseFloat(el.dataset.count);
      var suffix = el.dataset.suffix || "";
      var obj = { v: 0 };
      gsap.to(obj, {
        v: target, duration: 1.8, ease: "power2.out", snap: { v: 1 },
        onUpdate: function () { el.textContent = obj.v + suffix; },
        scrollTrigger: { trigger: el, start: "top 86%", once: true }
      });
    });
  }

  /* ---------- ١١) الماركيه + تسارع مع سرعة السكرول ---------- */
  function initMarquee() {
    document.querySelectorAll(".marquee-track").forEach(function (track) {
      var tween = gsap.to(track, { xPercent: 50, repeat: -1, duration: 26, ease: "none" });
      /* RTL: المحتوى بيتحرك ناحية اليمين */
      ScrollTrigger.create({
        onUpdate: function (self) {
          var boost = gsap.utils.clamp(1, 4, 1 + Math.abs(self.getVelocity()) / 1200);
          gsap.to(tween, { timeScale: boost, duration: 0.4, overwrite: true });
        }
      });
    });
  }

  /* ---------- ١٢) الإقلاع ---------- */
  function boot() {
    var isHome = !!document.querySelector(".preloader");
    var reduce = mmReduce.matches;

    if (reduce) {
      /* تقليل الحركة: كل شيء يظهر فورًا */
      var pre = document.querySelector(".preloader");
      if (pre) pre.remove();
      gsap.set("[data-anim], [data-hero]", { autoAlpha: 1, y: 0, clearProps: "transform,clipPath" });
      gsap.set("[data-split] .split-inner", { visibility: "visible" });
      document.dispatchEvent(new CustomEvent("mk:ready", { detail: { reduce: true, desktop: mmDesktop.matches } }));
      return;
    }

    var master = gsap.timeline({ paused: true });

    if (isHome) {
      /* البريلودر: عداد + شريط ثم خروج للأعلى */
      var pre2 = document.querySelector(".preloader");
      var count = { v: 0 };
      var countEl = pre2.querySelector(".pre-count");
      master
        .fromTo(pre2.querySelectorAll(".pre-name span"),
          { yPercent: 120 }, { yPercent: 0, duration: 0.8, stagger: 0.08, ease: "power4.out" })
        .to(count, {
          v: 100, duration: 1.5, ease: "power2.inOut",
          onUpdate: function () { countEl.textContent = Math.round(count.v); }
        }, 0.15)
        .fromTo(pre2.querySelector(".pre-bar i"), { scaleX: 0 }, { scaleX: 1, duration: 1.5, ease: "power2.inOut" }, 0.15)
        .to(pre2.querySelectorAll(".pre-name, .pre-bar, .pre-count"),
          { yPercent: -30, autoAlpha: 0, duration: 0.45, stagger: 0.05, ease: MOTION.ease.in }, "+=0.15")
        .to(pre2, { yPercent: -100, duration: 0.75, ease: MOTION.ease.inOut }, "-=0.15")
        .set(pre2, { display: "none" });
    } else {
      master.add(curtainIn());
    }

    assetsReady().then(function () {
      /* مدة البريلودر/الستارة معروفة الآن — نبني عليها تزامن الدخول */
      var preDur = master.duration();
      var titleAt = Math.max(0, preDur - 0.45);

      initSplitTitles({ startAt: titleAt });

      /* دخول عناصر الهيرو / رأس الصفحة [data-hero] بترتيب data-hero="1,2,3" */
      var heroEls = gsap.utils.toArray("[data-hero]");
      heroEls.sort(function (a, b) {
        return (parseFloat(a.dataset.hero) || 0) - (parseFloat(b.dataset.hero) || 0);
      });
      heroEls.forEach(function (el, i) {
        var kind = el.dataset.heroFx || "up";
        var pos = i === 0 ? titleAt + 0.35 : "-=0.5";
        if (kind === "curtain") master.curtain(el, {}, pos);
        else if (kind === "fade") master.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: MOTION.dur.slow }, pos);
        else master.fromTo(el, { y: MOTION.y, autoAlpha: 0 }, { y: 0, autoAlpha: 1 }, pos);
      });

      initReveals();
      initCounters();
      initMarquee();
      master.play();
      ScrollTrigger.refresh();
      document.dispatchEvent(new CustomEvent("mk:ready", { detail: { reduce: false, desktop: mmDesktop.matches } }));
    });
  }

  /* واجهة عامة لسكربتات الصفحات */
  window.MK = { MOTION: MOTION, smoother: function () { return smoother; }, reduce: function () { return mmReduce.matches; }, desktop: function () { return mmDesktop.matches; } };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
