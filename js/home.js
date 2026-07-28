/* ============================================================
   الرئيسية — المتتالية المثبّتة + مصغّرة الخدمات
   ============================================================ */
(function () {
  "use strict";
  if (typeof gsap === "undefined") return;

  var FRAMES = 36;
  var SRC = function (i) { return "assets/seq/build-" + String(i + 1).padStart(4, "0") + ".webp"; };
  var STATIC_FRAME = 17;                 /* الإطار الساكن للموبايل والشبكات البطيئة */
  var MARK_AT = [7, 15, 25, 35];         /* تخطيط · بنية · أداء · إطلاق */

  document.addEventListener("mk:ready", function (e) {
    var reduce = e.detail.reduce;
    var mm = e.detail.mm, DESK = e.detail.DESK;

    /* ── مصغّرة صفوف الخدمات في خانة ثابتة على الشبكة ── */
    (function servicesThumb() {
      var slot = document.querySelector(".sthumb");
      if (!slot) return;
      var imgs = slot.querySelectorAll("img");
      document.querySelectorAll(".srow").forEach(function (row, i) {
        function on() {
          imgs.forEach(function (im, j) { im.classList.toggle("on", j === i); });
          slot.classList.add("live");
        }
        function off() { slot.classList.remove("live"); imgs.forEach(function (im) { im.classList.remove("on"); }); }
        row.addEventListener("mouseenter", on);
        row.addEventListener("focusin", on);
        row.addEventListener("mouseleave", off);
        row.addEventListener("focusout", off);
      });
    })();

    /* ── المتتالية المثبّتة ── */
    var sec = document.querySelector(".seq");
    if (!sec) return;
    var canvas = sec.querySelector("canvas");
    var fallback = sec.querySelector(".fallback");
    var marks = Array.prototype.slice.call(sec.querySelectorAll(".seq-marks span"));

    function showStatic() {
      if (canvas) canvas.hidden = true;
      if (fallback) fallback.hidden = false;
      marks.forEach(function (m) { m.classList.add("on"); });
    }
    function showCanvas() {
      if (fallback) fallback.hidden = true;
      if (canvas) canvas.hidden = false;
    }

    var conn = navigator.connection || {};
    var slow = conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || "");
    if (reduce || slow || !window.matchMedia(DESK).matches || !canvas) { showStatic(); return; }

    mm.add(DESK, function () {
      var ctx = canvas.getContext("2d");
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var imgs = [], cur = -1;

      function size() {
        var r = sec.getBoundingClientRect();
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
        draw(cur < 0 ? 0 : cur, true);
      }

      /* رسم بأسلوب cover محسوب يدويًا */
      function draw(i, force) {
        if (i === cur && !force) return;
        cur = i;
        var im = imgs[i];
        if (!im || !im.naturalWidth) return;
        var cw = canvas.width, ch = canvas.height;
        var s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
        var w = im.naturalWidth * s, h = im.naturalHeight * s;
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(im, (cw - w) / 2, (ch - h) / 2, w, h);
        marks.forEach(function (m, k) { m.classList.toggle("on", i >= MARK_AT[k]); });
      }

      var st = null, resizeHandler = null, killed = false;

      Promise.all(Array.from({ length: FRAMES }, function (_, i) {
        var im = new Image();
        im.src = SRC(i);
        imgs[i] = im;
        return im.decode ? im.decode().catch(function () {}) : Promise.resolve();
      })).then(function () {
        if (killed) return;
        showCanvas();
        size();
        resizeHandler = function () { size(); };
        window.addEventListener("resize", resizeHandler);
        st = ScrollTrigger.create({
          trigger: sec,
          start: "top top",
          end: "+=200%",
          pin: true,
          scrub: 0.6,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: function (self) { draw(Math.round(self.progress * (FRAMES - 1))); }
        });
        ScrollTrigger.refresh();
      });

      return function () {
        killed = true;
        if (st) st.kill();
        if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      };
    });

    /* دون الديسكتوب: إطار ساكن، صفر تحميل للمتتالية */
    mm.add("(max-width: 1024px)", function () { showStatic(); });
  });
})();
