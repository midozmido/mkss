/* ============================================================
   البريلودر — ستارة تُفتح بفتحة دائرية من مركز الشاشة
   · إيقاع متمهّل: ~٢٫١ ثانية عرض مضمون، ثم مشهد فتح ~٢٫٧ ثانية
   · التقدّم حقيقي (الخطوط + صور الشاشة الأولى) والنسبة معروضة بالعربية
   · سقف صارم ٣ ثوانٍ للانتظار: لو تأخّرت الأصول، الموقع يفتح غصبًا
   · يظهر في كل تحميل؛ بعد أول مرة في الجلسة يعمل بنسخة مختصرة (~١٫٤ ث)
     كي لا يُعطّل التنقّل بين الصفحات
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
    document.dispatchEvent(new CustomEvent("mk:opened"));
  }

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seen = false;
  try { seen = sessionStorage.getItem("mk-pre") === "1"; } catch (e) {}

  if (reduce || typeof gsap === "undefined") { dismiss(); return; }
  try { sessionStorage.setItem("mk-pre", "1"); } catch (e) {}

  /* بعد أول ظهور في الجلسة: نفس المشهد بثلث الزمن — يُرى ولا يُملّ */
  var K = seen ? 0.34 : 1;

  var bar = pre.querySelector(".pre-bar i");
  var pct = pre.querySelector(".pre-pct");
  var meta = pre.querySelector(".pre-meta");
  var nameSpans = pre.querySelectorAll(".pre-name span");
  var tagSpan = pre.querySelector(".pre-tag span");

  /* الإيقاع كله من هنا — الإجمالي المستهدف ≈ ٥٫٢ ثانية */
  var T = {
    name: 1.35 * K,    /* دخول الاسم */
    tag: 1.10 * K,     /* السطر تحت اللوجو */
    creep: 3.20 * K,   /* زحف الشريط نحو ٠٫٩ */
    floor: 2100 * K,   /* أقل مدة عرض — يمنع الوميض حين تكون الأصول في الكاش */
    cap: 3000,         /* السقف الأقصى للانتظار */
    hold: 0.38 * K,    /* سكون بعد اكتمال الشريط */
    open: 1.95 * K     /* توسّع الفتحة */
  };

  var AR = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  function toAr(n) {
    return String(n).split("").map(function (d) { return AR[+d] !== undefined ? AR[+d] : d; }).join("");
  }

  /* الفتحة: قناع شعاعي شفاف في المنتصف. r=0 ⇒ اللوح مصمت بالكامل. */
  function setHole(r) {
    var m = "radial-gradient(circle at 50% 50%, transparent " + r + "%, #000 " + (r + 0.5) + "%)";
    pre.style.webkitMaskImage = m;
    pre.style.maskImage = m;
  }
  setHole(0);

  /* ── التقدّم الحقيقي ──
     مصدران يتحرّكان معًا: الزحف الزمني، وجاهزية الأصول. المعروض هو الأكبر
     دائمًا — لولا ذلك لرجعت النسبة للخلف حين ينتهي أحد التوينين قبل الآخر. */
  var creepP = { p: 0 };     /* الزحف الزمني */
  var assetP = { p: 0 };     /* الجاهزية الفعلية */
  var shown = 0;
  function paint() {
    var v = Math.max(creepP.p, assetP.p, shown);
    shown = v;
    if (bar) gsap.set(bar, { scaleX: v });
    if (pct) pct.textContent = toAr(Math.round(v * 100)) + "٪";
  }
  paint();

  function assetsReady(onTick) {
    var jobs = [];
    if (document.fonts && document.fonts.ready) jobs.push(document.fonts.ready);
    /* الصور التي تقع فعلًا في الشاشة الأولى فقط — لا معنى لانتظار صورة
       في آخر الصفحة قبل أن نُظهر الهيرو */
    var vh = window.innerHeight || 800;
    Array.prototype.slice.call(document.images)
      .filter(function (i) {
        if (i.loading === "lazy" || i.complete) return false;
        var r = i.getBoundingClientRect();
        return r.top < vh * 1.15;
      })
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

  /* ── الدخول: الاسم، ثم السطر، ثم بيانات الشريط ── */
  var intro = gsap.timeline()
    .fromTo(nameSpans, { yPercent: 118 },
      { yPercent: 0, duration: T.name, stagger: 0.14, ease: "power4.out" })
    .fromTo(tagSpan, { yPercent: 130, opacity: 0 },
      { yPercent: 0, opacity: 1, duration: T.tag, ease: "power3.out" }, "-=0.72")
    .to(meta, { opacity: 1, duration: 0.6, ease: "power2.out" }, "-=0.55");

  /* زحف بطيء نحو ٠٫٩ — يمنع وقوف الشريط عند رقم ميّت لو تأخّر أصل واحد */
  var creep = gsap.to(creepP, { p: 0.9, duration: T.creep, ease: "power1.out", onUpdate: paint });

  var opened = false;
  function open(fast) {
    if (opened) return;
    opened = true;
    creep.kill();

    var k = fast ? 0.32 : 1;                 /* النسخة المختصرة للمستعجل */
    var hole = { r: 0 };

    gsap.timeline({
      onComplete: function () {
        dismiss();
        if (window.ScrollTrigger) ScrollTrigger.refresh();
      }
    })
      /* ١) الشريط يكمل ويلمع */
      .to(assetP, { p: 1, duration: 0.45 * k, ease: "power2.inOut", onUpdate: paint })
      .to(bar, { boxShadow: "0 0 52px rgba(176,38,255,1)", duration: 0.28 * k }, "-=0.20")
      /* ٢) سكون — هو ما يجعل الفتح يبدو مقصودًا */
      .to({}, { duration: T.hold * k })
      /* ٣) المحتوى يصعد ويخرج */
      .to(pre.querySelectorAll(".pre-in > *"),
        { yPercent: -26, opacity: 0, duration: 0.55 * k, stagger: 0.045 * k, ease: "power2.inOut" })
      /* ٤) الستارة تُفتح — بطيئة في أولها، تسيب نفسها في آخرها */
      .to(hole, {
        r: 96, duration: T.open * k, ease: "power2.inOut",
        onUpdate: function () { setHole(hole.r); }
      }, "-=0.30")
      .to(pre, { opacity: 0, duration: 0.34 * k, ease: "power2.in" }, "-=0.36");
  }

  /* البوابة: الجاهزية الحقيقية أو السقف — أيّهما أسبق، مع أرضية زمنية لا تُخترق */
  var t0 = Date.now();
  var ready = assetsReady(function (frac) {
    var target = 0.12 + frac * 0.88;
    if (target > assetP.p) gsap.to(assetP, { p: target, duration: 0.55, ease: "power2.out", onUpdate: paint });
  });
  var cap = new Promise(function (r) { setTimeout(r, T.cap); });

  Promise.race([ready, cap]).then(function () {
    /* ننتظر أطول اثنين: أرضية الزمن، أو اكتمال دخول الاسم والسطر */
    var waitFloor = T.floor - (Date.now() - t0);
    var waitIntro = (intro.duration() - intro.time()) * 1000 + 120;
    setTimeout(function () { open(false); }, Math.max(0, waitFloor, waitIntro));
  });

  /* مخرج للمستعجل — لا يعمل قبل الثانية الأولى حتى لا تحرقه لمسة عرضية */
  setTimeout(function () {
    ["pointerdown", "keydown", "wheel"].forEach(function (ev) {
      window.addEventListener(ev, function () { open(true); }, { once: true, passive: true });
    });
  }, 900 * K);
})();
