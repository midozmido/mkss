/* ============================================================
   form.js — the three-step enquiry form. Delivers to WhatsApp only.

   On submit the visitor's answers are written out as a WhatsApp message to
   +20 109 957 6398 and WhatsApp opens with it ready to send. There is no
   server, no inbox and no third-party form service involved.

   One thing that matters about WhatsApp: it does NOT send by itself. It opens
   with the text filled in and the visitor still has to press Send. So the
   page never says "sent" — it says WhatsApp is open and what to do next, and
   keeps a button to reopen it in case it did not appear.

   Replaces contact.js + mk-form.js, which between them had two real bugs:
   validation matched a machine-translated `[مطلوب]` selector and so never
   ran, and a second handler reset the form and showed "sent" while nothing
   was delivered anywhere.
   ============================================================ */
(function () {
  'use strict';

  /* International format, digits only — what wa.me expects. +20 = Egypt. */
  var WHATSAPP = '201099576398';

  var form = document.getElementById('contactForm');
  if (!form) return;

  var steps = Array.prototype.slice.call(form.querySelectorAll('.form-step'));
  var dots = Array.prototype.slice.call(document.querySelectorAll('.progress-step'));
  var success = document.getElementById('formSuccess');
  var reopen = document.getElementById('formReopen');
  var current = 0;

  /* ── steps ───────────────────────────────────────────────── */
  function show(i) {
    current = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach(function (s, n) {
      var on = n === current;
      s.classList.toggle('is-active', on);
      s.hidden = !on;
    });
    dots.forEach(function (d, n) {
      d.classList.toggle('is-active', n <= current);
      d.classList.toggle('is-done', n < current);
    });
    var first = steps[current] && steps[current].querySelector('input:not([type="radio"]), textarea');
    if (first && i > 0) first.focus({ preventScroll: true });
  }

  function setError(el, msg) {
    var wrap = el.closest ? el.closest('.field') : null;
    var box = wrap ? wrap.querySelector('.field__error') : null;
    if (wrap) wrap.classList.toggle('has-error', !!msg);
    if (box) box.textContent = msg || '';
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  /* True when the step is complete. Writes the reason next to each field, so
     the visitor is told what is wrong and not just shown a red border. */
  function validate(step) {
    var ok = true, seen = {};
    Array.prototype.slice.call(step.querySelectorAll('[required]')).forEach(function (el) {
      if (el.type === 'radio') {
        if (seen[el.name]) return;
        seen[el.name] = true;
        var picked = form.querySelector('[name="' + el.name + '"]:checked');
        if (!picked) { ok = false; setError(el, 'Pick one to continue.'); } else setError(el, '');
        return;
      }
      var v = (el.value || '').trim();
      if (!v) { ok = false; setError(el, 'This one is required.'); return; }
      if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        ok = false; setError(el, 'That email address looks incomplete.'); return;
      }
      setError(el, '');
    });
    if (!ok) {
      var bad = step.querySelector('[aria-invalid="true"]');
      if (bad && bad.focus) bad.focus();
    }
    return ok;
  }

  form.addEventListener('click', function (e) {
    var next = e.target.closest ? e.target.closest('.next-step') : null;
    var prev = e.target.closest ? e.target.closest('.prev-step') : null;
    if (next) { e.preventDefault(); if (validate(steps[current])) show(current + 1); }
    else if (prev) { e.preventDefault(); show(current - 1); }
  });

  /* ── the message ─────────────────────────────────────────── */
  function value(name) {
    var el = form.querySelector('[name="' + name + '"]');
    if (!el) return '';
    if (el.type === 'radio') {
      var p = form.querySelector('[name="' + name + '"]:checked');
      return p ? p.value : '';
    }
    return (el.value || '').trim();
  }

  /* Laid out so it reads well in a chat bubble: a greeting, then one fact per
     line, then the free-text brief last because it is the longest. */
  function message() {
    var L = [];
    var name = value('name');
    L.push(name ? 'Hi Mohamed, this is ' + name + '.' : 'Hi Mohamed,');
    L.push('I would like to talk about a new website.');
    L.push('');
    if (value('projectType')) L.push('Project: ' + value('projectType'));
    if (value('budget')) L.push('Scope: ' + value('budget'));
    if (value('email')) L.push('Email: ' + value('email'));
    if (value('phone')) L.push('My WhatsApp: ' + value('phone'));
    if (value('details')) { L.push(''); L.push(value('details')); }
    return L.join('\n');
  }

  function whatsappUrl() {
    return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(message());
  }

  /* On a phone, navigate in place: wa.me hands straight to the WhatsApp app,
     whereas window.open there tends to leave an empty tab behind. On a
     desktop, open a new tab so the site stays where the visitor left it. */
  var isTouch = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  /* No 'noopener' in the features string. Per spec window.open() returns null
     whenever noopener is requested — the caller is deliberately denied a handle
     — so `!w` was true on EVERY desktop submit, not just a blocked one, and the
     fallback below dragged the visitor's own tab off the site to wa.me. They
     got WhatsApp twice and lost the portfolio they were reading.

     Severing .opener on the handle gives the same protection and still lets the
     null check mean what it says: the popup was actually blocked. */
  function openWhatsApp(url) {
    if (isTouch) { location.href = url; return; }
    var w = window.open(url, '_blank');
    if (w) { try { w.opener = null; } catch (e) { /* cross-origin, already safe */ } }
    else { location.href = url; }      /* popup genuinely blocked — go there directly */
  }

  /* Every step, not just the visible one. A form is submittable by Enter from
     any field, and the browser's implicit submission does not care which step
     is on screen: picking a project type on step 1 and pressing Enter used to
     deliver the message and show the "ready in WhatsApp" panel as though it had
     worked. Measured before this fix, the whole enquiry read:
         Hi Mohamed, / I would like to talk about a new website. / Project: Online store
     — no name, no email, no phone, and no way to reply to it.

     On failure, reveal the offending step FIRST, then re-validate it, so the
     message is announced against a field that is actually on screen and focus
     does not land on something hidden. */
  function validateAll() {
    for (var i = 0; i < steps.length; i++) {
      if (!validate(steps[i])) { show(i); validate(steps[i]); return false; }
    }
    return true;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validateAll()) return;

    var url = whatsappUrl();

    /* The reopen button carries the same message, so a visitor who closed
       WhatsApp, or whose browser blocked it, can get back with one tap. */
    if (reopen) reopen.href = url;
    if (success) {
      form.hidden = true;
      success.hidden = false;
      success.classList.add('is-active');
      if (success.focus) success.focus();
    }

    openWhatsApp(url);
  });

  show(0);
})();
