/* ============================================================
   ui.js — every non-motion interaction on the page.

   Replaces four legacy files that had grown into each other:
     onepage.js         menu, anchors, scroll-spy
     onepage-extras.js  scroll progress, navbar state, anchor fallback
     main.js            portfolio filter, FAQ, project modal, counters
     animations.js      a second reveal system that never reliably fired

   Between them they bound the same events twice, shipped a dead navbar
   listener, and left 40 of 50 headings at opacity 0 on desktop. One file,
   one binding each.

   Depends on nothing. Motion is motion.js's job; this file never animates
   anything GSAP owns.
   ============================================================ */
(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────── */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* Each module is isolated: one throwing must not take the others down. */
  function module(name, fn) {
    try { return fn(); } catch (e) {
      if (window.console && console.warn) console.warn('[ui] ' + name + ' failed:', e);
      return null;
    }
  }

  function raf(fn) {
    var pending = false;
    return function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; try { fn(); } catch (e) { } });
    };
  }

  /* Which element scrolls. Check <html> FIRST: if it overflows it IS the
     scrollport, regardless of what <body> measures. The old code compared the
     two and took whichever was taller, which picked <body> mid-load and left
     every scroll-driven feature frozen. */
  function scroller() {
    var d = document.documentElement, b = document.body;
    if (d && d.scrollHeight - d.clientHeight > 1) return d;
    if (b && b.scrollHeight - b.clientHeight > 1) return b;
    return document.scrollingElement || d;
  }
  function scrollTop() {
    var el = scroller();
    return (el === document.documentElement || el === document.scrollingElement)
      ? (window.pageYOffset || el.scrollTop || 0)
      : (el.scrollTop || 0);
  }
  /* A scroll on <body>-as-scrollport does not reach window, and — measured —
     not a document capture listener either. Bind every candidate. */
  function onScroll(cb) {
    var o = { passive: true };
    window.addEventListener('scroll', cb, o);
    document.addEventListener('scroll', cb, { passive: true, capture: true });
    if (document.body) document.body.addEventListener('scroll', cb, o);
    if (document.documentElement) document.documentElement.addEventListener('scroll', cb, o);
  }

  var reduced = function () {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  /* ── shared scroll lock ────────────────────────────────────
     The menu and the project dialog each used to write body.style.overflow
     themselves. Open both and whichever closed first cleared the lock, leaving
     the page scrolling behind a panel that was still up. Ownership is tracked
     instead, and the scrollbar compensation the menu applied is now applied for
     either owner rather than only one of them. */
  var lockOwners = [];
  function lockScroll(owner) {
    if (lockOwners.indexOf(owner) !== -1) return;
    if (!lockOwners.length) {
      var gap = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (gap > 0) document.body.style.paddingRight = gap + 'px';
    }
    lockOwners.push(owner);
  }
  function unlockScroll(owner) {
    var i = lockOwners.indexOf(owner);
    if (i === -1) return;
    lockOwners.splice(i, 1);
    if (!lockOwners.length) {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    }
  }

  /* ── 1. Fullscreen menu ──────────────────────────────────── */
  function initMenu() {
    var menu = $('#premiumMenu'), toggle = $('#navToggle');
    if (!menu || !toggle) return null;

    var overlay = $('.premium-menu-overlay', menu);
    var closeBtn = $('#menuClose') || $('.premium-menu-close', menu);
    var links = $$('.premium-menu-link', menu);
    var lastFocus = null;

    var isOpen = function () { return menu.classList.contains('is-open'); };

    function open() {
      if (isOpen()) return;
      lastFocus = document.activeElement;
      menu.classList.add('is-open');
      toggle.classList.add('is-active');
      toggle.setAttribute('aria-expanded', 'true');
      menu.setAttribute('aria-hidden', 'false');
      lockScroll('menu');
      document.body.classList.add('menu-open');
      /* Next frame, so the style change above has been applied. components.css
         now flips visibility at 0s on .is-open, but focusing on the same tick
         as the class still races the style recalc in some engines, and a
         focus() that lands on a hidden element fails silently. */
      if (closeBtn) requestAnimationFrame(function () { closeBtn.focus(); });
    }

    function close() {
      if (!isOpen()) return;
      menu.classList.remove('is-open');
      toggle.classList.remove('is-active');
      toggle.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
      unlockScroll('menu');
      document.body.classList.remove('menu-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    /* A toggle, not open-only — the old build bound openMenu to the burger, so
       a second click could never close it. */
    toggle.addEventListener('click', function (e) { e.preventDefault(); isOpen() ? close() : open(); });
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (overlay) overlay.addEventListener('click', close);
    /* No per-link close listener here. It fired at the target before the
       delegated anchor handler in initAnchors() could read menu.isOpen(), so
       that handler always saw `false`, always used a 0ms defer, and scrolled
       the page while the panel was still opaque over it. initAnchors closes
       the menu itself and then waits for the fade. */

    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      /* Trap focus inside the panel while it is open. */
      var f = $$('a[href], button:not([disabled])', menu).filter(function (el) {
        return el.offsetWidth || el.offsetHeight;
      });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    toggle.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-hidden', 'true');
    return { open: open, close: close, isOpen: isOpen };
  }

  /* ── 2. Anchor navigation ────────────────────────────────── */
  function initAnchors(menu) {
    var navbar = $('.navbar');

    function offset() {
      /* The navbar is a floating pill with a gap above it, so content has to
         clear its BOTTOM edge — using its height alone leaves the heading
         tucked under the bar by exactly that gap. */
      return navbar ? navbar.getBoundingClientRect().bottom + 16 : 96;
    }

    function goTo(target) {
      var el = scroller();
      var dest = Math.max(0, target.getBoundingClientRect().top + scrollTop() - offset());
      if (reduced()) { el.scrollTop = dest; window.scrollTo(0, dest); return; }
      /* When Lenis owns the scroll, hand it the move. A native smooth scroll
         alongside Lenis means two animations writing the same scrollTop, which
         is the same fight base.css now disarms for the wheel — js/motion.js
         publishes this hook for exactly this caller. */
      if (window.MKMotion && typeof window.MKMotion.scrollTo === 'function' &&
          document.documentElement.getAttribute('data-mk-lenis') === 'on') {
        if (window.MKMotion.scrollTo(dest) !== false) return;
      }
      if (el.scrollTo) el.scrollTo({ top: dest, behavior: 'smooth' });
      else el.scrollTop = dest;
      /* If smooth scrolling is unavailable or refused, land anyway. */
      setTimeout(function () {
        if (Math.abs(scrollTop() - dest) > 4) { el.scrollTop = dest; window.scrollTo(0, dest); }
      }, 700);
    }

    document.addEventListener('click', function (e) {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var hash = a.getAttribute('href');
      if (!hash || hash === '#' || hash === '#!') return;
      var target;
      try { target = document.getElementById(hash.slice(1)); } catch (err) { return; }
      if (!target) return;

      e.preventDefault();
      /* Scrolling alone is not navigation. This handler preventDefaults every
         in-page anchor, which also cancels the browser's own focus move — so
         the skip link scrolled to #main and left focus on itself, and the next
         Tab went back into the navbar. It skipped nothing for the people who
         need it. Give the target a programmatic focus stop if it has none. */
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      var wasOpen = menu && menu.isOpen && menu.isOpen();
      if (wasOpen) menu.close();
      /* Let the panel start fading before moving, or the scroll happens behind it. */
      setTimeout(function () {
        goTo(target);
        if (target.focus) target.focus({ preventScroll: true });
      }, wasOpen ? 260 : 0);
      if (history.replaceState) history.replaceState(null, '', hash);
    });

    /* DEEP LINKS — /#contact from a shared link, or a reload after a menu tap.

       The browser jumps to the anchor before any script runs, and on this page
       that position is wrong within a second: the work rail and the signature
       scene are PINNED, and ScrollTrigger inserts a pin-spacer for each one
       when it builds them — pushing everything below the first pin down by
       ~1,800px. Measured: /#contact stopped at scroll 12,414 while the form
       had moved to 14,189. The visitor landed on the wrong section and the
       form, never scrolled into view, stayed invisible.

       So land once on load, then land AGAIN every time ScrollTrigger finishes
       a refresh — that is the moment the pin spacers exist and positions are
       real. Stop as soon as the visitor scrolls on their own; we must never
       yank the page out from under a person who has started reading. */
    if (location.hash && location.hash.length > 1) {
      var target = null;
      try { target = document.getElementById(location.hash.slice(1)); } catch (err) { }

      if (target) {
        /* Take over from the browser's own restoration, which runs on its
           own clock and would fight the corrected landing. */
        if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

        var userMoved = false;
        var stop = function () { userMoved = true; };
        ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) {
          window.addEventListener(ev, stop, { passive: true, once: true });
        });

        var land = function () { if (!userMoved) goTo(target); };

        window.addEventListener('load', function () { setTimeout(land, 120); });

        /* ScrollTrigger is loaded after this file, so wait for it to exist. */
        var tries = 0;
        (function hook() {
          if (window.ScrollTrigger && ScrollTrigger.addEventListener) {
            ScrollTrigger.addEventListener('refresh', function () { setTimeout(land, 0); });
            return;
          }
          if (++tries < 40) setTimeout(hook, 100);   /* give up after ~4s */
        })();

        /* After a few seconds everything has settled; release the hash so a
           later refresh (a resize, a font swap) cannot pull the page back. */
        setTimeout(stop, 6000);
      }
    }
  }

  /* ── 3. Scroll-spy ───────────────────────────────────────── */
  function initSpy() {
    var links = $$('.premium-menu-link[href^="#"]');
    if (!links.length) return;

    var entries = links.map(function (link) {
      var id = link.getAttribute('href').slice(1);
      return { link: link, el: document.getElementById(id) };
    }).filter(function (e) { return e.el; });
    if (!entries.length) return;

    var current = -1;
    var update = raf(function () {
      var line = scrollTop() + (($('.navbar') || {}).getBoundingClientRect
        ? $('.navbar').getBoundingClientRect().bottom : 96) + 24;
      var best = -1, bestTop = -Infinity;

      /* The menu is not in DOM order (Work is listed before Process but sits
         after it on the page), so "first section not yet passed" picks wrong.
         Take the passed section nearest the navbar instead. */
      entries.forEach(function (e, i) {
        var top = e.el.getBoundingClientRect().top + scrollTop();
        if (top <= line && top > bestTop) { bestTop = top; best = i; }
      });
      /* Pin the DOM-last section once the page bottoms out. */
      var el = scroller();
      if (el.scrollHeight - scrollTop() - el.clientHeight < 4) {
        var lastIdx = 0, lastTop = -Infinity;
        entries.forEach(function (e, i) {
          var t = e.el.getBoundingClientRect().top + scrollTop();
          if (t > lastTop) { lastTop = t; lastIdx = i; }
        });
        best = lastIdx;
      }
      if (best === current) return;
      if (entries[current]) {
        entries[current].link.classList.remove('is-active');
        entries[current].link.removeAttribute('aria-current');
      }
      if (entries[best]) {
        entries[best].link.classList.add('is-active');
        entries[best].link.setAttribute('aria-current', 'true');
      }
      current = best;
    });

    onScroll(update);
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  /* ── 4. Navbar state + reading progress ──────────────────── */
  function initChrome() {
    var navbar = $('.navbar'), bar = $('#scroll-progress');

    var update = raf(function () {
      var top = scrollTop();
      if (navbar) navbar.classList.toggle('scrolled', top > 50);
      if (bar) {
        var el = scroller();
        var max = el.scrollHeight - el.clientHeight;
        /* The old version divided by documentElement, which measured 0 on that
           layout, so the bar sat permanently at Infinity%. */
        bar.style.width = max > 0 ? Math.max(0, Math.min(100, (top / max) * 100)) + '%' : '0%';
      }
    });

    onScroll(update);
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  /* ── 5. Portfolio filter ─────────────────────────────────── */
  function initFilter() {
    var btns = $$('.filter-btn');
    var cards = $$('.project-card');
    if (!btns.length || !cards.length) return;

    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var want = btn.getAttribute('data-filter');
        btns.forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        cards.forEach(function (card) {
          var cat = card.getAttribute('data-category');
          var show = (want === 'all' || cat === want);
          card.hidden = !show;
        });
        /* Filtering changes the rail's width, so the pinned scroll has to
           re-measure or its end position is stale. */
        if (window.ScrollTrigger) requestAnimationFrame(function () { ScrollTrigger.refresh(); });
      });
      btn.setAttribute('aria-pressed', btn.classList.contains('is-active') ? 'true' : 'false');
    });
  }

  /* ── 6. FAQ accordion ────────────────────────────────────── */
  function initFaq() {
    var items = $$('.faq-item');
    if (!items.length) return;

    items.forEach(function (item, i) {
      var q = $('.faq-question', item);
      var a = $('.faq-answer', item);
      if (!q || !a) return;

      if (!a.id) a.id = 'faq-answer-' + i;
      q.setAttribute('aria-expanded', 'false');
      q.setAttribute('aria-controls', a.id);

      q.addEventListener('click', function () {
        var open = item.classList.contains('is-open');
        /* One at a time — two open answers push the next question off screen. */
        items.forEach(function (other) {
          if (other === item) return;
          other.classList.remove('is-open');
          var oq = $('.faq-question', other);
          if (oq) oq.setAttribute('aria-expanded', 'false');
        });
        item.classList.toggle('is-open', !open);
        q.setAttribute('aria-expanded', String(!open));
      });
    });
  }

  /* ── 7. Project detail dialog ────────────────────────────── */
  function initProjectDialog() {
    var cards = $$('.project-card');
    if (!cards.length) return;

    var dialog = $('#projectDialog');
    if (!dialog) return;

    var titleEl = $('[data-dialog-title]', dialog);
    var bodyEl = $('[data-dialog-body]', dialog);
    var linkEl = $('[data-dialog-link]', dialog);
    var closeEl = $('[data-dialog-close]', dialog);
    var lastFocus = null;

    function open(card) {
      lastFocus = document.activeElement;
      var t = $('.project-title', card);
      var link = $('.project-link', card);
      var brief = card.getAttribute('data-brief') || '';
      if (titleEl) titleEl.textContent = t ? t.textContent.trim() : '';
      if (bodyEl) bodyEl.textContent = brief;
      if (linkEl && link) { linkEl.href = link.href; linkEl.hidden = false; }
      else if (linkEl) linkEl.hidden = true;
      dialog.classList.add('is-open');
      dialog.setAttribute('aria-hidden', 'false');
      lockScroll('dialog');
      if (closeEl) closeEl.focus();
    }
    function close() {
      dialog.classList.remove('is-open');
      dialog.setAttribute('aria-hidden', 'true');
      unlockScroll('dialog');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    cards.forEach(function (card) {
      var btn = $('.project-details-btn', card);
      if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); open(card); });
    });
    if (closeEl) closeEl.addEventListener('click', close);
    dialog.addEventListener('click', function (e) { if (e.target === dialog) close(); });
    document.addEventListener('keydown', function (e) {
      if (!dialog.classList.contains('is-open')) return;
      if (e.key === 'Escape') { close(); return; }
      /* The panel declares aria-modal="true", which promises the rest of the
         page is inert — but nothing enforced it, so Tab walked straight out
         into the page behind. Measured: of seven tabs from the open dialog,
         six landed outside it. Same trap the menu already uses. */
      if (e.key !== 'Tab') return;
      var f = $$('a[href], button:not([disabled])', dialog).filter(function (el) {
        return (el.offsetWidth || el.offsetHeight) && !el.hidden;
      });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    });
    dialog.setAttribute('aria-hidden', 'true');
  }

  /* ── 8. Marquee pause — fallback only ────────────────────────
     The strip is a CSS animation, but its WCAG 2.2.2 pause control is wired in
     js/motion.js inside start(), which both plugin guards return before. With
     GSAP blocked the button rendered as a visible, EMPTY 44x44 circle with a
     stuck aria-pressed="false" while the text kept scrolling — a control that
     announces itself and does nothing.

     motion.js paints a glyph into the button as its last step, so an empty
     button one tick after load means motion.js never got there. Only then does
     this take over, which keeps the two from double-toggling on the happy path.
     Scripting off entirely is already handled: the <noscript> block in
     index.html hides this button and pauses the strip outright. */
  function initMarqueeFallback() {
    var btn = $('[data-marquee-toggle]');
    var lists = $$('.marquee-content');
    if (!btn || !lists.length) return;

    var PLAY = '<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true"><path d="M0 0l10 6-10 6z"/></svg>';
    var PAUSE = '<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';
    var paused = false;

    function paint() {
      btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      /* Matches the markup's own wording, not motion.js's "technology marquee" —
         the strip has carried promises, not logos, since the rebuild. */
      btn.setAttribute('aria-label', paused ? 'Play the scrolling text' : 'Pause the scrolling text');
      btn.innerHTML = paused ? PLAY : PAUSE;
    }

    function adopt() {
      if (btn.innerHTML.trim()) return;          /* motion.js got here first */
      lists.forEach(function (l) { l.style.animationPlayState = 'running'; });
      btn.addEventListener('click', function () {
        paused = !paused;
        lists.forEach(function (l) {
          l.style.animationPlayState = paused ? 'paused' : 'running';
        });
        paint();
      });
      paint();
    }

    if (document.readyState === 'complete') window.setTimeout(adopt, 0);
    else window.addEventListener('load', function () { window.setTimeout(adopt, 0); });
  }

  /* ── 9. Work rail fallback — only when ScrollTrigger never arrived ──
     From 900px the work rail is pinned by ScrollTrigger and GSAP translates
     the track, so components.css keeps the rail overflow:hidden — making it a
     native scroll container would fight the pin.

     But when GSAP is blocked (an ad blocker, a corporate proxy, a blocked
     region) the pin never builds, the track keeps its full width, and the
     cards past the rail's edge become unreachable by any means: measured
     2869px of cards inside a 1344px rail, six of eight projects stranded.

     So the rail is made scrollable ONLY on that path. The check runs after
     load, by which point the deferred CDN scripts have either arrived or
     failed, and it asks for ScrollTrigger specifically — that is what pins. */
  function initRailFallback() {
    var rails = $$('.mk-rail, .rail');
    if (!rails.length) return;

    function decide() {
      var pinned = (typeof window.ScrollTrigger !== 'undefined') && !!window.ScrollTrigger;
      rails.forEach(function (r) { r.classList.toggle('is-unpinned', !pinned); });
    }

    if (document.readyState === 'complete') window.setTimeout(decide, 0);
    else window.addEventListener('load', function () { window.setTimeout(decide, 0); });
  }

  /* ── boot ────────────────────────────────────────────────── */
  function boot() {
    var menu = module('menu', initMenu);
    module('anchors', function () { initAnchors(menu); });
    module('scroll-spy', initSpy);
    module('chrome', initChrome);
    module('filter', initFilter);
    module('faq', initFaq);
    module('project dialog', initProjectDialog);
    module('marquee fallback', initMarqueeFallback);
    module('rail fallback', initRailFallback);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
