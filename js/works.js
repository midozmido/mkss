/* ============================================================
   الأعمال — معاينة المشروع في خانة ثابتة على الشبكة عند المرور على صف الفهرس
   ============================================================ */
(function () {
  "use strict";
  document.addEventListener("mk:ready", function () {
    var slot = document.querySelector(".ithumb");
    if (!slot) return;
    var imgs = slot.querySelectorAll("img");
    document.querySelectorAll(".irow").forEach(function (row) {
      var i = parseInt(row.dataset.thumb, 10);
      function on() {
        imgs.forEach(function (im, j) { im.classList.toggle("on", j === i); });
        slot.classList.add("live");
      }
      function off() {
        slot.classList.remove("live");
        imgs.forEach(function (im) { im.classList.remove("on"); });
      }
      row.addEventListener("mouseenter", on);
      row.addEventListener("focus", on);
      row.addEventListener("mouseleave", off);
      row.addEventListener("blur", off);
    });
  });
})();
