// JS المتصفح — وحدة واحدة صغيرة، بلا إطار ولا CDN.
(function () {
  'use strict';

  // تبديل الوضع الليلي — يتذكر الاختيار لكل متصفح
  var KEY = 'mkss-theme';
  var root = document.documentElement;

  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) { /* وضع خاص أو تخزين محجوب — نتجاهل ونكمل بتفضيل النظام */ }

  var btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = current ? (current === 'dark' ? 'light' : 'dark') : (systemDark ? 'light' : 'dark');
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
    });
  }

  // تأكيد قبل أي إجراء لا رجعة فيه
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // نسخ النص بضغطة (روابط التفعيل في لوحة الأدمن)
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-copy]');
    if (!el) return;
    var text = el.getAttribute('data-copy');
    var done = function () {
      var old = el.textContent;
      el.textContent = 'تم النسخ ✓';
      setTimeout(function () { el.textContent = old; }, 1600);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    else done();
  });
})();
