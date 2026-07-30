/* ============================================================
   البريلودر — فتحة دائرية تتوسّع من مركز الشاشة فتكشف الموقع
   · التقدّم حقيقي (خطوط + صور الشاشة الأولى)، لا عدّاد وهمي
   · سقف صارم ٢٫٥ ثانية: لو تأخّرت الأصول، الموقع يفتح غصبًا
   · مرة واحدة لكل جلسة — التنقل بين الصفحات لا يعيده
   · بلا JS أو مع تقليل الحركة: لا يظهر أصلًا
   ============================================================ */
(function () {
  "use strict";

  var doc = document.documentElement;
  var pre = document.querySelector(".pre");
  if (!pre) return;

  function dismiss() {
    pre.remove();
    doc.classList.remove("pre-on");
  }

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seen = false;
  try { seen = sessionStorage.getItem("mk-pre") === "1"; } catch (e) {}

  if (reduce || seen || typeof gsap === "undefined") { dismiss(); return; }
  try { sessionStorage.setItem("mk-pre", "1"); } catch (e) {}

  var bar = pre.querySelector(".pre-bar i");
  var nameSpans = pre.querySelectorAll(".pre-name span");

  /* الفتحة: قناع شعاعي شفاف في المنتصف. r=0 ⇒ اللوح مصمت بالكامل. */
  function setHole(r) {
    var m = "radial-gradient(circle at 50% 50%, transparent " + r + "%, #000 " + (r + 0.6) + "%)";
    pre.style.webkitMaskImage = m;
    pre.style.maskImage = m;
  }
  setHole(0);

  /* ── التقدّم الحقيقي ── */
  var state = { p: 0 };
  function paint() { if (bar) gsap.set(bar, { scaleX: state.p }); }

  function assetsReady(onTick) {
    var jobs = [];
    if (document.fonts && document.fonts.ready) jobs.push(document.fonts.ready);
    Array.prototype.slice.call(document.images)
      .filter(function (i) { return i.loading !== "lazy" && !i.complete; })
      .forEach(function (i) {
        jobs.push(new Promise(function (r) {
          i.addEventListener("load", r, { once: true });
          i.addEventListener("error", r, { once: true });
        }));
      });
    if (!jobs.length) jobs.push(Promise.resolve());

    var done = 0, total = jobs.length;
    jobs.forEach(function (j) {
      Promise.resolve(j).then(function () { onTick(++done / total); });
    });
    return Promise.all(jobs);
  }

  /* دخول الاسم */
  var intro = gsap.timeline().fromTo(nameSpans, { yPercent: 118 },
    { yPercent: 0, duration: 0.85, stagger: 0.07, ease: "power4.out" });

  /* زحف بطيء نحو ٠٫٩ — يمنع وقوف الشريط عند رقم ميّت لو تأخّر أصل واحد */
  var creep = gsap.to(state, { p: 0.9, duration: 2.2, ease: "power1.out", onUpdate: paint });

  var opened = false;
  function open() {
    if (opened) return;
    opened = true;
    creep.kill();

    var hole = { r: 0 };
    gsap.timeline({
      onComplete: function () {
        dismiss();
        if (window.ScrollTrigger) ScrollTrigger.refresh();
        document.dispatchEvent(new CustomEvent("mk:opened"));
      }
    })
      .to(state, { p: 1, duration: 0.3, ease: "power2.out", onUpdate: paint })
      .to(bar, { boxShadow: "0 0 46px rgba(176,38,255,1)", duration: 0.18 }, "-=0.14")
      .to(pre.querySelectorAll(".pre-in > *"),
        { opacity: 0, scale: 0.94, duration: 0.3, stagger: 0.04, ease: "power2.in" }, "+=0.05")
      .to(hole, {
        r: 92, duration: 1.05, ease: "power3.inOut",
        onUpdate: function () { setHole(hole.r); }
      }, "-=0.14")
      .to(pre, { opacity: 0, duration: 0.22 }, "-=0.2");
  }

  /* البوابة: الجاهزية الحقيقية أو السقف الزمني — أيّهما أسبق */
  var ready = assetsReady(function (frac) {
    var target = 0.15 + frac * 0.85;
    if (target > state.p) gsap.to(state, { p: target, duration: 0.4, ease: "power2.out", onUpdate: paint });
  });
  var cap = new Promise(function (r) { setTimeout(r, 2500); });

  Promise.race([ready, cap]).then(function () {
    /* نضمن اكتمال دخول الاسم قبل الفتح */
    setTimeout(open, Math.max(0, 950 - intro.time() * 1000));
  });

  /* مخرج طوارئ: أي تفاعل يفتح فورًا */
  ["pointerdown", "keydown", "wheel"].forEach(function (ev) {
    window.addEventListener(ev, open, { once: true, passive: true });
  });
})();
