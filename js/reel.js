/* ============================================================
   مسرح الجُمَل — الشاشة تثبت، والجملة تصعد من تحت قناع، تثبت،
   ثم تنزل تحته وتحلّ محلّها التالية. بعد الأخيرة يولد خيط ضوء
   في المنتصف ويتمدّد لعرض الشاشة، فيصير فاصل القسم التالي.
   ديسكتوب فقط؛ دونه تظهر القائمة الرأسية (`.reel-list`) من CSS.
   ============================================================ */
(function () {
  "use strict";
  if (typeof gsap === "undefined") return;

  document.addEventListener("mk:ready", function (e) {
    var reduce = e.detail.reduce, mm = e.detail.mm, DESK = e.detail.DESK;
    var SPEED = e.detail.SPEED || 1;

    var reel = document.querySelector(".reel");
    if (!reel || reduce) return;                /* CSS يتكفّل بالبديل */

    var pin = reel.querySelector(".reel-pin");
    var stack = reel.querySelector(".reel-stack");
    var hand = reel.querySelector(".reel-hand");
    var dots = gsap.utils.toArray(reel.querySelectorAll(".reel-dots i"));
    var stmts = gsap.utils.toArray(reel.querySelectorAll(".rst"));
    if (!stmts.length) return;

    /* ── تقسيم كل جملة إلى أسطر داخل أقنعة ──
       بالسطور لا بالحروف: التقسيم بالحروف يفكّ اتصال العربية.
       دون SplitText نعامل الجملة كسطر واحد — الحركة تبقى صحيحة. */
    function linesOf(el) {
      if (window.SplitText) {
        var sp = SplitText.create(el, { type: "lines", mask: "lines", aria: "auto", linesClass: "rl" });
        if (sp.lines && sp.lines.length) return sp.lines;
      }
      el.classList.add("rl");
      return [el];
    }

    mm.add(DESK, function () {
      var groups = stmts.map(linesOf);
      var N = stmts.length;

      gsap.set(stmts, { opacity: 1 });
      groups.forEach(function (g) { gsap.set(g, { yPercent: 118, opacity: 0 }); });
      gsap.set(hand, { scaleX: 0, opacity: 0, transformOrigin: "center" });

      /* المشهد الواحد = ١ ثانية على خط الزمن؛ التسليم يأخذ ٠٫٦ إضافية */
      var IN = 0.34, HOLD = 0.34, OUT = 0.30;

      var tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: reel,
          start: "top top",
          end: "+=" + Math.round(N * 95 * SPEED / 1.6) + "%",
          pin: pin,
          scrub: 1.05,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: function (self) {
            var raw = self.progress * (N + 0.6);
            dots.forEach(function (d, i) {
              d.style.setProperty("--p", String(gsap.utils.clamp(0, 1, raw - i)));
            });
          }
        }
      });

      groups.forEach(function (g, i) {
        var at = i;

        /* طلوع: الأسطر تصعد من تحت القناع مع ضبابية تتلاشى */
        tl.fromTo(g,
          { yPercent: 118, opacity: 0, filter: "blur(10px)" },
          { yPercent: 0, opacity: 1, filter: "blur(0px)",
            duration: IN, stagger: IN * 0.22, ease: "power4.out" }, at);

        /* ثبات: انجراف لطيف لأعلى — يمنع الإحساس بصورة مجمّدة */
        tl.to(g, { y: -14, duration: HOLD, ease: "sine.inOut" }, at + IN);

        /* نزول: ترجع تحت القناع بترتيب معكوس */
        tl.to(g, {
          yPercent: 118, opacity: 0, filter: "blur(9px)",
          duration: OUT, stagger: { each: OUT * 0.18, from: "end" }, ease: "power3.in"
        }, at + IN + HOLD);
        tl.set(g, { y: 0 }, at + IN + HOLD + OUT);
      });

      /* التسليم: الخيط يولد في المنتصف ويتمدّد، ويلمع الضوء العام لمعة قصيرة */
      var lamp = document.querySelector(".lamp");
      tl.to(hand, { opacity: 1, duration: 0.06 }, N - 0.10)
        .to(hand, { scaleX: 1, duration: 0.42, ease: "power2.inOut" }, N - 0.10);
      if (lamp) {
        tl.to(lamp, { opacity: 1.6, duration: 0.20, ease: "power2.out" }, N - 0.02)
          .to(lamp, { opacity: 1, duration: 0.34, ease: "power2.inOut" }, N + 0.20);
      }
      tl.to(hand, { opacity: 0.35, duration: 0.22 }, N + 0.32);

      return function () {
        tl.scrollTrigger && tl.scrollTrigger.kill();
        tl.kill();
        if (lamp) gsap.set(lamp, { clearProps: "opacity" });
        groups.forEach(function (g) { gsap.set(g, { clearProps: "all" }); });
      };
    });
  });
})();
