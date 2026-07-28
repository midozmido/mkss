/* ============================================================
   صفحة الأعمال — ظهور الكروت + فلترة بحركة Flip
   ============================================================ */
(function () {
  "use strict";
  if (typeof gsap === "undefined") return;

  document.addEventListener("mk:ready", function (e) {
    var reduce = e.detail.reduce;
    var cards = gsap.utils.toArray(".w-card");
    var grid = document.querySelector(".wgrid");
    if (!grid || !cards.length) return;

    /* ظهور أولي متتابع */
    if (reduce) {
      gsap.set(cards, { autoAlpha: 1 });
    } else {
      ScrollTrigger.batch(".w-card", {
        start: "top 90%",
        once: true,
        onEnter: function (batch) {
          gsap.fromTo(batch,
            { y: 54, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, stagger: 0.09, duration: 0.75, ease: "power3.out", overwrite: true });
        }
      });
    }

    /* الفلترة */
    var btns = document.querySelectorAll(".f-btn");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.classList.contains("active")) return;
        btns.forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        var f = btn.dataset.filter;

        if (reduce || !window.Flip) {
          cards.forEach(function (c) {
            c.style.display = (f === "all" || c.dataset.cat === f) ? "" : "none";
            gsap.set(c, { autoAlpha: 1, y: 0 });
          });
          ScrollTrigger.refresh();
          return;
        }

        var state = Flip.getState(cards);
        cards.forEach(function (c) {
          var show = f === "all" || c.dataset.cat === f;
          c.style.display = show ? "" : "none";
          if (show) gsap.set(c, { autoAlpha: 1, y: 0 });
        });
        Flip.from(state, {
          duration: 0.65,
          ease: "power3.inOut",
          absolute: true,
          stagger: 0.03,
          onEnter: function (els) {
            return gsap.fromTo(els, { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1, duration: 0.5 });
          },
          onLeave: function (els) {
            return gsap.to(els, { autoAlpha: 0, scale: 0.92, duration: 0.35 });
          },
          onComplete: function () { ScrollTrigger.refresh(); }
        });
      });
    });
  });
})();
