/* ============================================================
   فورم الحجز متعدد الخطوات — يرسل ملخص الطلب على الواتساب
   ============================================================ */
(function () {
  "use strict";

  var WA_NUMBER = "201099576398";

  var data = {
    service: "",
    budget: "",
    duration: "",
    desc: "",
    extras: [],
    name: "",
    phone: "",
    country: ""
  };

  var current = 1;
  var TOTAL = 4;

  var steps = document.querySelectorAll(".bk-step");
  var dots = document.querySelectorAll(".bkp-step");
  var btnNext = document.getElementById("bk-next");
  var btnBack = document.getElementById("bk-back");
  if (!steps.length || !btnNext) return;

  var hasGsap = typeof gsap !== "undefined";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- اختيارات الكروت والرقائق ---------- */
  document.querySelectorAll("[data-group]").forEach(function (group) {
    var key = group.dataset.group;
    var multi = group.dataset.multi === "true";
    group.addEventListener("click", function (e) {
      var item = e.target.closest(".opt-card, .chip");
      if (!item) return;
      if (multi) {
        item.classList.toggle("selected");
        data[key] = Array.prototype.map.call(
          group.querySelectorAll(".selected"),
          function (el) { return el.dataset.value; }
        );
      } else {
        group.querySelectorAll(".selected").forEach(function (el) { el.classList.remove("selected"); });
        item.classList.add("selected");
        data[key] = item.dataset.value;
        hideErr(key);
      }
      if (hasGsap && !reduce) {
        gsap.fromTo(item, { scale: 0.96 }, { scale: 1, duration: 0.35, ease: "back.out(2)", overwrite: true });
      }
    });
  });

  /* ---------- أخطاء التحقق ---------- */
  function showErr(key) {
    var el = document.querySelector('[data-err="' + key + '"]');
    if (!el) return;
    el.style.display = "block";
    var f = el.closest(".field");
    if (f) f.classList.add("invalid");
    if (hasGsap && !reduce) gsap.fromTo(el, { x: 0 }, { x: -7, duration: 0.07, repeat: 5, yoyo: true, clearProps: "x" });
  }
  function hideErr(key) {
    var el = document.querySelector('[data-err="' + key + '"]');
    if (!el) return;
    el.style.display = "none";
    var f = el.closest(".field");
    if (f) f.classList.remove("invalid");
  }

  function validate(step) {
    var ok = true;
    if (step === 1 && !data.service) { showErr("service"); ok = false; }
    if (step === 2) {
      if (!data.budget) { showErr("budget"); ok = false; }
      if (!data.duration) { showErr("duration"); ok = false; }
    }
    if (step === 3) {
      data.desc = document.getElementById("bk-desc").value.trim();
      if (data.desc.length < 10) { showErr("desc"); ok = false; } else hideErr("desc");
    }
    if (step === 4) {
      data.name = document.getElementById("bk-name").value.trim();
      data.phone = document.getElementById("bk-phone").value.replace(/\D/g, "");
      data.country = document.getElementById("bk-country").value;
      if (!data.name) { showErr("name"); ok = false; } else hideErr("name");
      if (data.phone.length < 8) { showErr("phone"); ok = false; } else hideErr("phone");
    }
    return ok;
  }

  /* ---------- الملخص ---------- */
  function renderSummary() {
    var list = document.getElementById("bk-summary-list");
    if (!list) return;
    var rows = [
      ["الخدمة", data.service],
      ["الميزانية", data.budget],
      ["المدة", data.duration],
      ["الإضافات", data.extras.length ? data.extras.join("، ") : "بدون"],
      ["التفاصيل", data.desc.length > 90 ? data.desc.slice(0, 90) + "…" : data.desc]
    ];
    list.innerHTML = rows.map(function (r) {
      return "<li><b>" + r[0] + "</b><span>" + escapeHtml(r[1]) + "</span></li>";
    }).join("");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- رسالة الواتساب ---------- */
  function buildWaUrl() {
    var msg =
      "🚀 *طلب حجز جديد من الموقع*\n" +
      "─────────────\n" +
      "👤 الاسم: " + data.name + "\n" +
      "📱 واتساب: " + data.phone + "\n" +
      "🌍 الدولة: " + data.country + "\n" +
      "─────────────\n" +
      "🛠 الخدمة: " + data.service + "\n" +
      "💰 الميزانية: " + data.budget + "\n" +
      "⏱ المدة: " + data.duration + "\n" +
      "➕ إضافات: " + (data.extras.length ? data.extras.join("، ") : "بدون") + "\n" +
      "─────────────\n" +
      "📝 التفاصيل:\n" + data.desc;
    return "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(msg);
  }

  /* ---------- التنقل بين الخطوات ---------- */
  function goTo(step) {
    var from = document.querySelector('.bk-step[data-step="' + current + '"]');
    var to = document.querySelector('.bk-step[data-step="' + step + '"]');
    var dir = step > current ? 1 : -1;
    current = step;

    /* ارجع لأول الفورم مع كل خطوة */
    var wrap = document.querySelector(".bk-wrap");
    if (wrap) {
      var sm = window.MK && window.MK.smoother && window.MK.smoother();
      if (sm) sm.scrollTo(wrap, true, "top 90px");
      else window.scrollTo({ top: wrap.getBoundingClientRect().top + window.pageYOffset - 90, behavior: reduce ? "auto" : "smooth" });
    }

    /* مؤشر التقدم */
    dots.forEach(function (d, i) {
      d.classList.toggle("current", i === Math.min(step, TOTAL) - 1);
      d.classList.toggle("done", i < Math.min(step, TOTAL) - 1);
    });

    /* أزرار التنقل */
    btnBack.style.visibility = (step > 1 && step <= TOTAL) ? "visible" : "hidden";
    if (step === TOTAL) {
      btnNext.textContent = "إرسال عبر واتساب ✆";
      btnNext.classList.remove("btn-primary");
      btnNext.classList.add("btn-wa");
    } else {
      btnNext.textContent = "التالي ←";
      btnNext.classList.add("btn-primary");
      btnNext.classList.remove("btn-wa");
    }
    if (step > TOTAL) { btnNext.style.display = "none"; btnBack.style.visibility = "hidden"; }

    if (step === TOTAL) renderSummary();

    if (!hasGsap || reduce) {
      from.classList.remove("active");
      to.classList.add("active");
      return;
    }
    gsap.timeline()
      .to(from, {
        autoAlpha: 0, x: 40 * dir, duration: 0.3, ease: "power2.in",
        onComplete: function () {
          from.classList.remove("active");
          gsap.set(from, { clearProps: "all" });
          to.classList.add("active");
        }
      })
      .fromTo(to, { autoAlpha: 0, x: -46 * dir }, { autoAlpha: 1, x: 0, duration: 0.5, ease: "power3.out" })
      .fromTo(to.querySelectorAll(".opt-card, .chip, .field, .bk-summary, h2, .bk-hint, .bk-label, .bk-done"),
        { y: 18, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.045, ease: "power2.out" }, "-=0.3");
  }

  btnNext.addEventListener("click", function () {
    if (!validate(current)) return;
    if (current === TOTAL) {
      var url = buildWaUrl();
      var again = document.getElementById("bk-wa-again");
      if (again) again.href = url;
      window.open(url, "_blank");
      goTo(TOTAL + 1);
      return;
    }
    goTo(current + 1);
  });
  btnBack.addEventListener("click", function () {
    if (current > 1) goTo(current - 1);
  });

  /* مسح الخطأ أول ما المستخدم يكتب */
  ["bk-desc", "bk-name", "bk-phone"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("input", function () {
      hideErr(id.replace("bk-", "").replace("desc", "desc").replace("name", "name").replace("phone", "phone"));
    });
  });
})();
