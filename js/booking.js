/* ============================================================
   فورم الحجز — أربع خطوات، ورقة طلب تتجمّع، ثم رسالة واتساب منسّقة
   الترقيم العربي-الهندي هنا فقط في الموقع، لأنه تسلسل حقيقي.
   ============================================================ */
(function () {
  "use strict";

  var WA = "201099576398";
  var AR = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  function arNum(n) { return String(n).split("").map(function (d) { return AR[+d] || d; }).join(""); }

  var data = { service: "", budget: "", duration: "", desc: "", extras: [], name: "", phone: "", country: "" };
  var step = 1, TOTAL = 4;

  var panes = document.querySelectorAll(".bk-pane");
  var nextBtn = document.getElementById("nextBtn");
  var backBtn = document.getElementById("backBtn");
  var bkNav = document.getElementById("bkNav");
  var done = document.getElementById("done");
  var sheet = document.getElementById("sheet");
  var sheetList = document.getElementById("sheetList");
  var qTitle = document.getElementById("qTitle");
  var qHint = document.getElementById("qHint");
  var stepNow = document.getElementById("stepNow");
  var stepBar = document.getElementById("stepBar");
  if (!panes.length || !nextBtn) return;

  var hasGsap = typeof gsap !== "undefined";
  var hasFlip = typeof Flip !== "undefined";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var COPY = [
    null,
    { t: "ما نوع المشروع؟", h: "اختر الأقرب لما في ذهنك. لو غير محدّد بعد، اختر «أحتاج استشارة» وسنحدّده معًا." },
    { t: "ما الميزانية والمدة؟", h: "تقدير تقريبي يكفي. هذا يحدّد نطاق العمل الذي أرشّحه لك، لا أكثر." },
    { t: "احكِ لي عن المشروع", h: "كلما وضحت الصورة، جاء ردّي أدقّ وأسرع — وبسعر أقرب للواقع." },
    { t: "أين أرسل الرد؟", h: "راجع ورقة الطلب على اليمين، ثم أرسل. تفتح رسالة واتساب جاهزة على رقمي." }
  ];

  /* ── الاختيارات ── */
  document.querySelectorAll("[data-group]").forEach(function (group) {
    var key = group.dataset.group;
    var multi = group.dataset.multi === "true";
    group.addEventListener("click", function (e) {
      var btn = e.target.closest(".opt");
      if (!btn) return;
      if (multi) {
        var on = btn.getAttribute("aria-pressed") === "true";
        btn.setAttribute("aria-pressed", String(!on));
        data[key] = Array.prototype.map.call(group.querySelectorAll('[aria-pressed="true"]'),
          function (b) { return b.dataset.value; });
      } else {
        group.querySelectorAll(".opt").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
        btn.setAttribute("aria-pressed", "true");
        data[key] = btn.dataset.value;
        clearErr(key);
      }
      if (hasGsap && !reduce) {
        gsap.fromTo(btn.querySelector(".mark"), { scale: 0.7 },
          { scale: 1, duration: 0.35, ease: "back.out(2.4)", overwrite: true });
      }
    });
  });

  /* ── الأخطاء ── */
  function showErr(key) {
    var box = document.querySelector('[data-err="' + key + '"]');
    if (box) { box.hidden = false; if (hasGsap && !reduce) gsap.fromTo(box, { x: 0 }, { x: -6, duration: .07, repeat: 5, yoyo: true, clearProps: "x" }); }
  }
  function clearErr(key) {
    var box = document.querySelector('[data-err="' + key + '"]');
    if (box) box.hidden = true;
  }
  function fieldErr(el, bad) {
    var f = el.closest(".field");
    if (!f) return;
    f.classList.toggle("bad", bad);
    if (bad && hasGsap && !reduce) gsap.fromTo(f, { x: 0 }, { x: -6, duration: .07, repeat: 5, yoyo: true, clearProps: "x" });
  }

  function validate(s) {
    var ok = true;
    if (s === 1 && !data.service) { showErr("service"); ok = false; }
    if (s === 2) {
      if (!data.budget) { showErr("budget"); ok = false; }
      if (!data.duration) { showErr("duration"); ok = false; }
    }
    if (s === 3) {
      var d = document.getElementById("desc");
      data.desc = d.value.trim();
      var bad = data.desc.length < 12;
      fieldErr(d, bad);
      if (bad) ok = false;
    }
    if (s === 4) {
      var n = document.getElementById("nm"), p = document.getElementById("ph"), c = document.getElementById("co");
      data.name = n.value.trim();
      data.phone = p.value.replace(/[^\d+]/g, "");
      data.country = c.value.trim() || "غير محدّدة";
      var nb = !data.name, pb = data.phone.replace(/\D/g, "").length < 8;
      fieldErr(n, nb); fieldErr(p, pb);
      if (nb || pb) ok = false;
    }
    return ok;
  }

  /* ── ورقة الطلب: تتجمّع سطرًا سطرًا ── */
  function rowsFor(s) {
    if (s === 1) return [["نوع المشروع", data.service]];
    if (s === 2) return [["الميزانية", data.budget], ["المدة", data.duration]];
    if (s === 3) return [["التفاصيل", data.desc.length > 64 ? data.desc.slice(0, 64) + "…" : data.desc],
                         ["إضافات", data.extras.length ? data.extras.join("، ") : "بدون"]];
    return [];
  }
  function addRows(s) {
    var rows = rowsFor(s);
    if (!rows.length) return;
    sheet.hidden = false;
    var state = (hasFlip && !reduce) ? Flip.getState(sheetList.children) : null;
    var added = [];
    rows.forEach(function (r) {
      var dt = document.createElement("dt"); dt.textContent = r[0];
      var dd = document.createElement("dd"); dd.textContent = r[1];
      sheetList.appendChild(dt); sheetList.appendChild(dd);
      added.push(dt, dd);
    });
    if (state) {
      Flip.from(state, { duration: 0.5, ease: "power3.inOut" });
      gsap.fromTo(added, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.05, ease: "power3.out" });
    }
  }
  function trimRows(s) {
    /* عند الرجوع نحذف صفوف الخطوة التي غادرناها */
    var n = rowsFor(s).length * 2;
    for (var i = 0; i < n && sheetList.lastChild; i++) sheetList.removeChild(sheetList.lastChild);
    if (!sheetList.children.length) sheet.hidden = true;
  }

  /* ── رسالة واتساب ── */
  function waUrl() {
    var m =
      "*طلب مشروع جديد من الموقع*\n" +
      "──────────────\n" +
      "الاسم: " + data.name + "\n" +
      "واتساب: " + data.phone + "\n" +
      "الدولة: " + data.country + "\n" +
      "──────────────\n" +
      "نوع المشروع: " + data.service + "\n" +
      "الميزانية: " + data.budget + "\n" +
      "المدة: " + data.duration + "\n" +
      "إضافات: " + (data.extras.length ? data.extras.join("، ") : "بدون") + "\n" +
      "──────────────\n" +
      "التفاصيل:\n" + data.desc;
    return "https://wa.me/" + WA + "?text=" + encodeURIComponent(m);
  }

  /* ── الانتقال ── */
  function go(to) {
    var from = document.querySelector('.bk-pane[data-pane="' + step + '"]');
    var dir = to > step ? 1 : -1;

    if (dir > 0 && step <= 3) addRows(step);
    if (dir < 0) trimRows(to);

    step = to;

    if (step > TOTAL) {
      if (from) from.hidden = true;
      bkNav.hidden = true;
      done.classList.add("on");
      qTitle.textContent = "تم الإرسال";
      qHint.textContent = "شكرًا لثقتك. الرد يصلك على نفس الرقم خلال ساعات.";
      stepNow.textContent = arNum(TOTAL);
      stepBar.style.width = "100%";
      if (hasGsap && !reduce) {
        gsap.fromTo(done.children, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: .7, stagger: .08, ease: "power3.out" });
      }
      return;
    }

    var to_ = document.querySelector('.bk-pane[data-pane="' + step + '"]');
    stepNow.textContent = "٠" + arNum(step);
    stepBar.style.width = (step / TOTAL * 100) + "%";
    qTitle.textContent = COPY[step].t;
    qHint.textContent = COPY[step].h;
    backBtn.style.visibility = step > 1 ? "visible" : "hidden";
    nextBtn.textContent = step === TOTAL ? "أرسل عبر واتساب" : "التالي";

    if (!hasGsap || reduce) {
      if (from) from.hidden = true;
      to_.hidden = false;
      return;
    }
    gsap.timeline()
      .to(from, {
        opacity: 0, x: 30 * dir, duration: .28, ease: "power2.in",
        onComplete: function () { from.hidden = true; gsap.set(from, { clearProps: "all" }); to_.hidden = false; }
      })
      .fromTo(to_, { opacity: 0, x: -34 * dir }, { opacity: 1, x: 0, duration: .5, ease: "power3.out" })
      .fromTo(to_.querySelectorAll(".opt, .field, h3"), { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: .45, stagger: .05, ease: "power3.out" }, "-=.32");
  }

  nextBtn.addEventListener("click", function () {
    if (!validate(step)) return;
    if (step === TOTAL) {
      var url = waUrl();
      var again = document.getElementById("againBtn");
      if (again) again.href = url;
      window.open(url, "_blank", "noopener");
      go(TOTAL + 1);
      return;
    }
    go(step + 1);
  });
  backBtn.addEventListener("click", function () { if (step > 1) go(step - 1); });

  ["desc", "nm", "ph"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("input", function () { fieldErr(el, false); });
  });
})();
