/* ============================================================
   المسرح المثبّت — الشاشة تثبت، رسالة الإقناع تتبدّل خلفها،
   والأعمال تدخل من اليمين والشمال بالتبادل ثم تخرج للجهة المقابلة.
   ديسكتوب فقط؛ دون ذلك تتحول لقائمة رأسية عادية.
   ============================================================ */
(function () {
  "use strict";
  if (typeof gsap === "undefined") return;

  document.addEventListener("mk:ready", function (e) {
    var reduce = e.detail.reduce, mm = e.detail.mm, DESK = e.detail.DESK;

    document.querySelectorAll(".stage").forEach(function (stage) {
      var slides = gsap.utils.toArray(stage.querySelectorAll(".slide"));
      var msgs = gsap.utils.toArray(stage.querySelectorAll(".stage-msg .m"));
      var dots = gsap.utils.toArray(stage.querySelectorAll(".stage-dots i"));
      var cta = stage.querySelector(".stage-cta");
      if (!slides.length) return;

      /* مع تقليل الحركة يُخفى المسرح من CSS وتظهر القائمة — لا نبني شيئًا هنا */
      if (reduce) return;

      mm.add(DESK, function () {
        var N = slides.length;
        /* كل مشهد: دخول ← ثبات ← خروج. نبني تايم لاين واحدة مربوطة بالسكرول. */
        var IN = 0.42, HOLD = 0.34, OUT = 0.24;   /* نِسَب داخل المشهد الواحد */

        gsap.set(slides, { opacity: 0 });
        gsap.set(msgs, { opacity: 0, y: 26 });
        if (cta) gsap.set(cta, { opacity: 0, y: 20 });

        var tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: stage,
            start: "top top",
            end: "+=" + (N * 85) + "%",
            pin: true,
            scrub: 0.7,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: function (self) {
              var raw = self.progress * N;
              dots.forEach(function (d, i) {
                d.style.setProperty("--p", String(Math.max(0, Math.min(1, raw - i))));
              });
            }
          }
        });

        slides.forEach(function (sl, i) {
          var fromRight = i % 2 === 0;            /* الفردي من اليمين، الزوجي من الشمال */
          var dir = fromRight ? 1 : -1;
          var shot = sl.querySelector(".shot");
          var info = sl.querySelector(".info");
          var at = i;                              /* المشهد i يبدأ عند الثانية i */

          /* دخول */
          tl.fromTo(sl, { opacity: 0 }, { opacity: 1, duration: IN * 0.5 }, at)
            .fromTo(shot, { xPercent: 118 * dir, rotate: 1.6 * dir },
              { xPercent: 0, rotate: 0, duration: IN, ease: "power3.out" }, at)
            .fromTo(info, { xPercent: -70 * dir, opacity: 0 },
              { xPercent: 0, opacity: 1, duration: IN, ease: "power3.out" }, at + 0.06);

          /* ثبات مع انجراف خفيف — يمنع الإحساس بالجمود */
          tl.to(shot, { yPercent: -3, duration: HOLD }, at + IN);

          /* خروج للجهة المقابلة (المشهد الأخير يبقى) */
          if (i < N - 1) {
            tl.to(shot, { xPercent: -108 * dir, rotate: -1.2 * dir, duration: OUT, ease: "power2.in" },
              at + IN + HOLD)
              .to(info, { xPercent: 60 * dir, opacity: 0, duration: OUT, ease: "power2.in" },
                at + IN + HOLD)
              .to(sl, { opacity: 0, duration: OUT * 0.7 }, at + IN + HOLD + OUT * 0.3);
          }

          /* الرسالة الخلفية تتبدّل مع كل مشهد */
          var m = msgs[i];
          if (m) {
            tl.fromTo(m, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: IN * 0.8 }, at);
            if (i < N - 1) tl.to(m, { opacity: 0, y: -22, duration: OUT }, at + IN + HOLD);
          }
        });

        /* الدعوة تظهر مع المشهد الأخير */
        if (cta) {
          tl.to(cta, { opacity: 1, y: 0, duration: 0.3 }, N - 1 + IN * 0.6)
            .call(function () { cta.classList.add("on"); }, null, N - 1 + IN * 0.6);
        }

        return function () { tl.scrollTrigger && tl.scrollTrigger.kill(); tl.kill(); };
      });

      /* دون الديسكتوب: القائمة الرأسية تظهر بكشف عادي */
      mm.add("(max-width: 1024px)", function () {
        var list = stage.parentNode.querySelector(".stage-list");
        if (!list) return;
        var items = gsap.utils.toArray(list.querySelectorAll(".sl"));
        if (reduce) { gsap.set(items, { opacity: 1, y: 0 }); return; }
        var b = ScrollTrigger.batch(items, {
          start: "top 82%", once: true,
          onEnter: function (batch) {
            gsap.fromTo(batch, { opacity: 0, y: 34 },
              { opacity: 1, y: 0, duration: 1.0, stagger: 0.09, ease: "power3.out", overwrite: true });
          }
        });
        return function () { b.forEach(function (t) { t.kill(); }); };
      });
    });

    /* زرار التخطّي */
    document.querySelectorAll(".stage-skip").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var stage = btn.closest(".stage");
        var st = ScrollTrigger.getAll().filter(function (t) { return t.pin === stage || t.trigger === stage; })[0];
        var y = st ? st.end + 4 : (stage.getBoundingClientRect().bottom + window.scrollY);
        window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
      });
    });
  });
})();
