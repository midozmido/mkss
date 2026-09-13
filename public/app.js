// JS المتصفح — بلا إطار ولا CDN. يعمل بدونه كل شيء (النماذج تُرسَل عاديًا).
(function () {
  'use strict';

  // ——————————————————— الوضع الليلي ———————————————————
  var KEY = 'mkss-theme';
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) { /* تخزين محجوب — نكمل بتفضيل النظام */ }

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = current ? (current === 'dark' ? 'light' : 'dark') : (systemDark ? 'light' : 'dark');
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
    });
  }

  // ——————————————————— تأكيد ونسخ ———————————————————
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-copy]');
    if (!el) return;
    var text = el.getAttribute('data-copy');
    var show = function () {
      var old = el.textContent;
      el.textContent = 'تم النسخ ✓';
      setTimeout(function () { el.textContent = old; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(show, fallback);
    } else fallback();

    function fallback() {
      // المتصفحات على HTTP لا تتيح الحافظة — نستخدم تحديد النص كبديل
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); show(); } catch (err) { ta.remove(); return; }
      ta.remove();
    }
  });

  // ——————————————————— الشات ———————————————————
  var chat = document.querySelector('.chat');
  if (!chat) return;

  var log = document.getElementById('chat-log');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var status = document.getElementById('chat-status');
  var viewer = chat.getAttribute('data-viewer');        // client | admin
  var chatUser = chat.getAttribute('data-chat-user');
  var lastId = lastSeenId();

  scrollToEnd();
  autoGrow();

  function lastSeenId() {
    var nodes = log ? log.querySelectorAll('.msg[data-id]') : [];
    return nodes.length ? Number(nodes[nodes.length - 1].getAttribute('data-id')) : 0;
  }

  function scrollToEnd() {
    if (log) log.scrollTop = log.scrollHeight;
  }

  function setStatus(kind, text) {
    if (!status) return;
    status.className = 'badge ' + (kind === 'ok' ? 'badge-ok' : kind === 'bad' ? 'badge-danger' : '');
    status.textContent = text;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getDate() + '/' + (d.getMonth() + 1) + ' — ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function render(m) {
    if (!log || Number(m.id) <= lastId) return;   // لا نكرّر رسالة وصلت مرتين
    if (log.querySelector('.empty')) log.innerHTML = '';

    var mine = m.author_role === viewer;
    var who = m.author_role === 'client' ? 'العميل' : m.author_role === 'admin' ? 'فريق الدعم' : 'النظام';
    var div = document.createElement('div');
    div.className = 'msg msg-new' + (mine ? ' msg-mine' : '') + (m.author_role === 'system' ? ' msg-system' : '');
    div.setAttribute('data-id', m.id);
    div.innerHTML = '<div class="msg-body">' + esc(m.body) + '</div>' +
      '<div class="msg-meta">' + esc(mine ? 'أنت' : who) + ' · <time>' + esc(fmt(m.created_at)) + '</time></div>';
    log.appendChild(div);
    lastId = Number(m.id);
    scrollToEnd();
  }

  // مزامنة ما فات أثناء الانقطاع — SSE وحده لا يضمن ما حدث ونحن مفصولون
  function syncMissed() {
    var url = (viewer === 'admin' ? '/admin/chat/' + chatUser + '/since' : '/chat/since') + '?after=' + lastId;
    fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data && data.messages) data.messages.forEach(render); })
      .catch(function () {});
  }

  if (window.EventSource) {
    var streamUrl = viewer === 'admin' ? '/admin/chat/stream' : '/chat/stream';
    var es = new EventSource(streamUrl);

    es.addEventListener('open', function () {
      setStatus('ok', '● متصل');
      syncMissed();
    });

    es.addEventListener('message', function (ev) {
      try {
        var m = JSON.parse(ev.data);
        // لوحة الأدمن تستقبل رسائل كل العملاء — نعرض من نحن فاتحون محادثته فقط
        if (viewer === 'admin' && String(m.user_id) !== String(chatUser)) return;
        render(m);
      } catch (e) {}
    });

    es.addEventListener('error', function () {
      setStatus('bad', '○ انقطع — يعيد المحاولة');
    });
  } else {
    setStatus('', 'التحديث اللحظي غير مدعوم');
    setInterval(syncMissed, 10000);
  }

  // ——————————————————— الإرسال ———————————————————
  if (form) {
    form.addEventListener('submit', function (e) {
      var text = (input.value || '').trim();
      if (!text) { e.preventDefault(); return; }
      if (!window.fetch) return;   // بلا fetch يُرسَل النموذج عاديًا

      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      input.value = '';
      autoGrow();

      var body = new URLSearchParams();
      body.set('_csrf', form.querySelector('[name="_csrf"]').value);
      body.set('body', text);

      fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (data) { if (data && data.message) render(data.message); })
        .catch(function () {
          input.value = text;   // لا نُضيّع ما كتبه المستخدم
          setStatus('bad', '○ تعذّر الإرسال');
        })
        .then(function () { if (btn) btn.disabled = false; input.focus(); });
    });
  }

  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
    input.addEventListener('input', autoGrow);
  }

  function autoGrow() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }
})();
