/* ============================================================================
   mk-motion.js — THE MK CUT motion system
   ----------------------------------------------------------------------------
   Loads AFTER: gsap, ScrollTrigger, SplitText, ScrollToPlugin, Lenis (all CDN).
   Loads AFTER: js/main.js, js/contact.js, js/onepage.js, js/onepage-extras.js.

   It never rebinds anything those files own. It does not touch the fullscreen
   menu, anchor scrolling, scroll-spy, the portfolio filter, the FAQ, the
   modals or the contact form. Where it needs to cooperate (Lenis vs. the
   anchor scroller in onepage.js) it publishes a hook on window.MKMotion and
   lets the owner call it.

   ── THE ONE ENVIRONMENT FACT ────────────────────────────────────────────────
   css/base.css:33-35 sets `html, body { height: 100%; overflow-x: hidden }`.
   Because html's overflow is not `visible`, it does NOT propagate to the
   viewport, so BODY keeps its own overflow and — being height-capped — becomes
   the scroll container. Consequences this file has to survive:

     • window.pageYOffset is 0 forever; window.scrollTo() is inert.
     • scroll events fire on <body> and do not bubble to window.
     • ScrollTrigger's own scroll listener/getter resolve to
       document.scrollingElement (= <html>), which never moves.

   So: ScrollTrigger.scrollerProxy() is pointed at the real scroller, and
   ScrollTrigger.update() is driven from a listener bound to the scroller
   itself. Detection matches js/onepage.js:176-193 and js/onepage-extras.js:20-28
   exactly — compare the two overflows and take the larger, never "html first",
   because on phones html permanently overflows by the URL-bar height while
   body holds the real 14,000px.

   ── VOCABULARY ──────────────────────────────────────────────────────────────
   data-anim="cut"      MK signature: clip-path wipe travelling along --mk-angle
   data-anim="lines"    per-line mask reveal (hero H1 + every section h2)
   data-anim="up"       rise 40px + fade
   data-anim="fade"     opacity only
   data-anim="media"    MK-cut reveal + counter-scale 1.15 -> 1
   data-anim="stagger"  container whose direct children stagger in
   anything else        FALLBACK (fade) — an unknown value is still visible.

   Optional: data-delay="0.2"  data-parallax="0.15"  data-magnetic
   ========================================================================== */

(function (window, document) {
    'use strict';

    var NS = 'MKMotion';
    var VERSION = '1.0.0';
    var root = document.documentElement;

    /* ───────────────────────── tiny ES5 helpers ───────────────────────── */

    function qs(sel, ctx) {
        try { return (ctx || document).querySelector(sel); } catch (e) { return null; }
    }

    function qsa(sel, ctx) {
        try {
            return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
        } catch (e) { return []; }
    }

    function each(list, fn) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) fn(list[i], i);
    }

    function closest(el, sel) {
        while (el && el.nodeType === 1) {
            if (el.matches ? el.matches(sel) : (el.msMatchesSelector && el.msMatchesSelector(sel))) return el;
            el = el.parentNode;
        }
        return null;
    }

    /* Every module runs inside one of these. One broken module must never take
       the rest of the page down with it — that is how a motion layer ends up
       leaving a site blank. */
    function module(name, fn) {
        try { return fn(); } catch (err) {
            if (window.console && console.warn) console.warn('[mk-motion] ' + name + ':', err);
            return null;
        }
    }

    /* The CSS pre-hide (`.js [data-anim] { visibility: hidden }`) lives behind
       a `js` class on <html>. Dropping the class is the nuclear reveal: it can
       beat an !important CSS rule that an inline style cannot. */
    var shown = false;
    function showAll() {
        if (shown) return;
        shown = true;
        try {
            root.classList.remove('js');
            root.setAttribute('data-mk-motion', 'on');
        } catch (e) { /* nothing left to try */ }
    }

    /* Marks an element as claimed by this system, so the safety net below can
       tell "hidden because it is waiting for its scroll trigger" apart from
       "hidden because something failed". */
    var claimed = 0;
    function claim(el) {
        if (!el) return el;
        try { el.setAttribute('data-mk', 'on'); } catch (e) { }
        claimed++;
        return el;
    }
    function isClaimed(el) {
        return !!(el && el.getAttribute && el.getAttribute('data-mk') === 'on');
    }

    function isHidden(el) {
        try { return window.getComputedStyle(el).visibility === 'hidden'; }
        catch (e) { return false; }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       1. PLUGIN GUARD — check gsap, then EACH plugin by name.
          A single failed CDN file must never leave the page blank.
       ═══════════════════════════════════════════════════════════════════ */

    if (typeof gsap === 'undefined' || !gsap || !gsap.core) { showAll(); return; }

    var HAS = {
        ST: (typeof ScrollTrigger !== 'undefined') && !!ScrollTrigger,
        Split: (typeof SplitText !== 'undefined') && !!SplitText,
        ScrollTo: (typeof ScrollToPlugin !== 'undefined') && !!ScrollToPlugin,
        Lenis: (typeof Lenis !== 'undefined') && !!Lenis,
        quickTo: typeof gsap.quickTo === 'function'
    };

    /* SplitText only grew SplitText.create() / mask / autoSplit in GSAP 3.13.
       If an older build is served, `lines` degrades to a whole-block reveal
       instead of throwing. */
    HAS.SplitModern = HAS.Split && typeof SplitText.create === 'function';

    var plugins = [];
    if (HAS.ST) plugins.push(ScrollTrigger);
    if (HAS.Split) plugins.push(SplitText);
    if (HAS.ScrollTo) plugins.push(ScrollToPlugin);
    if (plugins.length) {
        try { gsap.registerPlugin.apply(gsap, plugins); }
        catch (e) { /* registration is advisory in 3.x; the plugins still work */ }
    }

    /* ScrollTrigger is load-bearing: without it nothing below the fold would
       ever reveal, so hand the page straight back to CSS. */
    if (!HAS.ST) { showAll(); return; }

    /* ═══════════════════════════════════════════════════════════════════════
       2. SAFETY NET — nothing stays invisible.

          NOTE: this cannot simply un-hide every hidden [data-anim] at 4s. Every
          element still waiting for its scroll trigger is legitimately
          visibility:hidden at that moment, and blanket-revealing them would
          fire the whole page at once. So it only rescues elements this system
          never claimed, and only calls showAll() if it claimed nothing at all
          (i.e. the system really did fail).
       ═══════════════════════════════════════════════════════════════════ */

    var SAFETY = window.setTimeout(function () {
        module('safety net', function () {
            var vh = window.innerHeight || root.clientHeight || 800;
            var rescued = 0;

            each(qsa('[data-anim]'), function (el) {
                if (!isHidden(el)) return;

                if (!isClaimed(el)) {
                    /* Never touched by this system — something failed. */
                    gsap.set(el, { autoAlpha: 1, clearProps: 'transform,clipPath' });
                    rescued++;
                    return;
                }

                /* Claimed AND hidden AND already inside the viewport means its
                   trigger should have fired and did not (a wrong scroller, a
                   pin that never refreshed). Anything still below the fold is
                   hidden on purpose and must be left alone — blanket-revealing
                   it would fire the whole page at once. */
                var top = 1e9;
                try { top = el.getBoundingClientRect().top; } catch (e) { }
                if (top < vh * 0.95) {
                    gsap.set(el, { autoAlpha: 1, y: 0, x: 0, clearProps: 'transform,clipPath' });
                    rescued++;
                }
            });

            /* Claimed nothing at all: the system never ran. Hand the page back
               to CSS — dropping the class beats an !important rule that an
               inline style cannot. */
            if (!claimed || rescued) showAll();
        });
    }, 4000);

    /* ═══════════════════════════════════════════════════════════════════════
       3. MOTION TOKENS — client-approved, already tuned +30% slower.
          BANNED: bounce / elastic / back. Organic curves break the technical
          feel; every ease here is expo or power.
       ═══════════════════════════════════════════════════════════════════ */

    var MOTION = {
        dur: { fast: 0.36, base: 0.72, slow: 1.05, hero: 1.40 },
        ease: { out: 'expo.out', inOut: 'expo.inOut', in: 'power2.in', scrub: 'none' },
        y: 40,
        stagger: 0.055,
        overlap: '-=0.32',
        angle: 21
    };

    /* --mk-angle is the single source of truth; the token is only the fallback
       for the frame before the stylesheet has parsed. */
    module('read --mk-angle', function () {
        var raw = window.getComputedStyle(root).getPropertyValue('--mk-angle');
        var deg = parseFloat(raw);
        if (!isNaN(deg) && deg > 0 && deg < 90) MOTION.angle = deg;
    });
    var TAN = Math.tan(MOTION.angle * Math.PI / 180);   /* 21deg -> 0.3839 */

    gsap.defaults({ duration: MOTION.dur.base, ease: MOTION.ease.out });

    var reduced = false;
    module('read reduced-motion', function () {
        reduced = !!(window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    });

    /* ═══════════════════════════════════════════════════════════════════════
       3b. THE SCROLLER — teach ScrollTrigger which element actually moves.
       ═══════════════════════════════════════════════════════════════════ */

    /* Which element actually scrolls?
       <html> is checked FIRST, not "whichever overflows more". If <html> has
       overflow it IS the scrollport, and <body> reporting a bigger number does
       not change that — the old order returned <body> whenever body happened to
       measure taller, which is true mid-load on this page.

       Do NOT try to detect this by nudging scrollTop and reading it back:
       onepage.css sets html{scroll-behavior:smooth}, so the write starts an
       animation and the read returns the OLD value. The probe reports
       "doesn't move" for the element that does. Measurement is the reliable
       signal here; mk-legacy-off.css pins html{height:auto} so the answer is
       also stable from the first frame. */
    function detectScroller() {
        var d = document.documentElement;
        var b = document.body;
        var dOver = d ? d.scrollHeight - d.clientHeight : 0;
        var bOver = b ? b.scrollHeight - b.clientHeight : 0;
        if (dOver > 1) return d;                     /* normal viewport scroll */
        if (bOver > 1) return b;                     /* body-as-scrollport */
        return document.scrollingElement || d || b;
    }

    var scrollerEl = detectScroller();
    var bodyScrolls = (scrollerEl === document.body);
    var lenis = null;                                 /* late-bound, see §9 */

    function scrollTopOf() {
        if (!scrollerEl) return 0;
        if (scrollerEl === document.documentElement || scrollerEl === document.scrollingElement) {
            return window.pageYOffset || scrollerEl.scrollTop || 0;
        }
        return scrollerEl.scrollTop || 0;
    }

    var scrollerWired = false;
    var scrollUpdateBound = false;

    /* Idempotent. Called once at boot, and again if a later re-measure changes
       the answer (the page can be too short to tell the candidates apart before
       images and fonts land). */
    /* Undo body-mode. Without this the wiring could only ever latch ON: if the
       first measurement said "body" and a later one said "html", the early
       return below left a scrollerProxy pointing at an element that no longer
       moves — every trigger frozen at progress 0, no error. That is exactly
       what happened once mk-tokens.css normalised the layout onto <html>. */
    function unwireScroller() {
        if (!scrollerWired) return;
        scrollerWired = false;
        try { ScrollTrigger.scrollerProxy(document.body, null); } catch (e) { }
        try { ScrollTrigger.defaults({ scroller: window }); } catch (e) { }
        try { ScrollTrigger.refresh(); } catch (e) { }
    }

    function wireScroller() {
        scrollerEl = detectScroller();
        bodyScrolls = (scrollerEl === document.body);
        if (!bodyScrolls) { unwireScroller(); return; }  /* <html> scrolls — GSAP needs no help */
        if (scrollerWired) return;
        scrollerWired = true;

        /* ScrollTrigger classes <body> as a "root" scroller and swaps it for
           document.scrollingElement, which is <html> and never moves here.
           scrollerProxy is the documented override; because body is a root,
           GSAP registers the proxy for window / body / documentElement at once,
           so every trigger — including ones that never name a scroller — routes
           through it. pinType must be "fixed": body scrolling leaves
           position:fixed pinned elements correctly parked against the viewport. */
        ScrollTrigger.scrollerProxy(document.body, {
            scrollTop: function (value) {
                if (arguments.length) {
                    if (lenis && typeof lenis.scrollTo === 'function') {
                        lenis.scrollTo(value, { immediate: true, force: true });
                    } else {
                        document.body.scrollTop = value;
                    }
                }
                return document.body.scrollTop;
            },
            getBoundingClientRect: function () {
                return {
                    top: 0, left: 0,
                    width: window.innerWidth || root.clientWidth,
                    height: window.innerHeight || root.clientHeight
                };
            },
            pinType: 'fixed'
        });

        /* Harmless if _isViewport(body) is true (it collapses to the same proxy)
           and load-bearing if a future GSAP stops treating body as a root. */
        ScrollTrigger.defaults({ scroller: document.body });

        /* ScrollTrigger's own scroll listener sits on the element it resolved
           to — documentElement — which never moves here, so updates have to be
           driven by hand.

           Measured on this exact layout: a real wheel scroll dispatches on
           <body> and on document in the CAPTURE phase, and never on window
           (window.pageYOffset stays 0 for the life of the page). So window —
           the one target most scripts bind — is worthless here, and that is why
           js/animations.js:62's navbar listener never fired.

           The listeners below are therefore bound to every plausible target.
           But listeners alone are not enough to trust: every programmatic move
           on this page — js/onepage.js's anchor clicks and hash landing, Lenis
           writing body.scrollTop each frame, ScrollTrigger restoring position
           around a pin — is an assignment, and assignments coalesce into at
           most one event per rendering step (sometimes none at all). A missed
           event means every trigger stays frozen at its last known position and
           nothing below the fold ever reveals.

           So the authority is a per-frame position check: one integer
           comparison while idle, an update only when the number actually moved.
           The listeners stay too, so a real wheel scroll still updates inside
           the event rather than waiting for the next frame. */
        if (scrollUpdateBound) return;
        scrollUpdateBound = true;

        var opts = { passive: true };
        var bump = function () { ScrollTrigger.update(); };
        window.addEventListener('scroll', bump, opts);
        document.addEventListener('scroll', bump, { passive: true, capture: true });
        if (document.body) document.body.addEventListener('scroll', bump, opts);
        if (document.documentElement) document.documentElement.addEventListener('scroll', bump, opts);

        var lastY = -1;
        gsap.ticker.add(function () {
            var y = document.body.scrollTop;
            if (y === lastY) return;
            lastY = y;
            ScrollTrigger.update();
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
       4. EFFECTS REGISTRY — the data-anim vocabulary, plus a mandatory
          FALLBACK so an unknown value can never leave content invisible.
       ═══════════════════════════════════════════════════════════════════ */

    /* THE MK CUT.
       The 111K logo is three bars leaning --mk-angle off vertical. A cut wipe is
       that same leaning edge sweeping left to right: near-vertical, tilted 21deg,
       top edge leading. Run is expressed as a % of the element's own width so it
       stays a true 21deg at any size; measured lazily and re-measured on refresh
       via function-based values. */
    function cutRun(el) {
        var h = el.offsetHeight || 0;
        var w = el.offsetWidth || 0;
        if (!h || !w) return 20;                       /* pre-layout fallback */
        return Math.max(4, Math.min(60, (h * TAN / w) * 100));
    }
    function cutFrom(el) {
        var r = cutRun(el);
        return 'polygon(0% 0%, 0% 0%, ' + (-r).toFixed(2) + '% 100%, 0% 100%)';
    }
    function cutTo(el) {
        var r = cutRun(el);
        return 'polygon(0% 0%, ' + (100 + r).toFixed(2) + '% 0%, 100% 100%, 0% 100%)';
    }

    gsap.registerEffect({
        name: 'mkCut', extendTimeline: true,
        defaults: { duration: MOTION.dur.slow, ease: MOTION.ease.inOut },
        effect: function (targets, cfg) {
            return gsap.fromTo(targets,
                {
                    clipPath: function (i, t) { return cutFrom(t); },
                    webkitClipPath: function (i, t) { return cutFrom(t); },
                    autoAlpha: 1
                },
                {
                    clipPath: function (i, t) { return cutTo(t); },
                    webkitClipPath: function (i, t) { return cutTo(t); },
                    autoAlpha: 1,
                    duration: cfg.duration, ease: cfg.ease,
                    onComplete: function () {
                        /* Leaving a clip-path parked forever would clip focus
                           rings and hover shadows. */
                        gsap.set(targets, { clearProps: 'clipPath,webkitClipPath' });
                    }
                });
        }
    });

    gsap.registerEffect({
        name: 'mkUp', extendTimeline: true,
        defaults: { duration: MOTION.dur.base, ease: MOTION.ease.out, stagger: 0 },
        effect: function (targets, cfg) {
            return gsap.fromTo(targets,
                { y: MOTION.y, autoAlpha: 0 },
                { y: 0, autoAlpha: 1, duration: cfg.duration, ease: cfg.ease, stagger: cfg.stagger });
        }
    });

    gsap.registerEffect({
        name: 'mkFade', extendTimeline: true,
        defaults: { duration: MOTION.dur.base, ease: MOTION.ease.out, stagger: 0 },
        effect: function (targets, cfg) {
            return gsap.fromTo(targets,
                { autoAlpha: 0 },
                { autoAlpha: 1, duration: cfg.duration, ease: cfg.ease, stagger: cfg.stagger });
        }
    });

    /* Image: the cut reveals the frame while the picture counter-scales out of
       1.15 — the frame and the content move at different speeds, which is what
       makes a masked reveal read as depth rather than as a fade. */
    gsap.registerEffect({
        name: 'mkMedia', extendTimeline: true,
        defaults: { duration: MOTION.dur.slow, ease: MOTION.ease.inOut },
        effect: function (targets, cfg) {
            var el = targets[0] || targets;
            var inner = null;
            module('mkMedia inner', function () {
                inner = (el.tagName === 'IMG' || el.tagName === 'VIDEO')
                    ? el
                    : qs('img, video, picture > img, .project-image img', el);
            });
            var tl = gsap.timeline();
            tl.fromTo(el,
                {
                    clipPath: function (i, t) { return cutFrom(t); },
                    webkitClipPath: function (i, t) { return cutFrom(t); },
                    autoAlpha: 1
                },
                {
                    clipPath: function (i, t) { return cutTo(t); },
                    webkitClipPath: function (i, t) { return cutTo(t); },
                    autoAlpha: 1,
                    duration: cfg.duration, ease: cfg.ease,
                    onComplete: function () { gsap.set(el, { clearProps: 'clipPath,webkitClipPath' }); }
                }, 0);
            if (inner && inner !== el) {
                tl.fromTo(inner, { scale: 1.15 },
                    { scale: 1, duration: cfg.duration * 1.2, ease: cfg.ease, clearProps: 'scale' }, 0);
            } else if (inner) {
                /* The element IS the image: scale it inside its own clip. */
                tl.fromTo(inner, { scale: 1.15 },
                    { scale: 1, duration: cfg.duration * 1.2, ease: cfg.ease, clearProps: 'scale' }, 0);
            }
            return tl;
        }
    });

    gsap.registerEffect({
        name: 'mkStagger', extendTimeline: true,
        defaults: { duration: MOTION.dur.base, ease: MOTION.ease.out },
        effect: function (targets, cfg) {
            var el = targets[0] || targets;
            var kids = el.children ? Array.prototype.slice.call(el.children) : [];
            if (!kids.length) return gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: cfg.duration });
            gsap.set(el, { autoAlpha: 1 });
            return gsap.fromTo(kids,
                { y: MOTION.y, autoAlpha: 0 },
                {
                    y: 0, autoAlpha: 1, duration: cfg.duration, ease: cfg.ease,
                    stagger: MOTION.stagger
                });
        }
    });

    /* Per-line mask reveal. The lines do not rise straight up — they travel
       along --mk-angle (dx = dy * tan21), so even the type obeys the MK cut. */
    var heroTextDone = false;
    function linesIn(el, opts) {
        opts = opts || {};
        if (!HAS.SplitModern) {
            /* Old SplitText, or none at all: a whole-block cut still reads as
               deliberate, and never leaves the heading blank. */
            return gsap.effects.mkCut(el, { duration: opts.duration || MOTION.dur.slow });
        }
        var tween = null;
        SplitText.create(el, {
            type: 'lines',
            mask: 'lines',
            linesClass: 'line',
            autoSplit: true,
            aria: 'auto',
            onSplit: function (self) {
                gsap.set(el, { autoAlpha: 1 });
                tween = gsap.fromTo(self.lines,
                    {
                        yPercent: 110,
                        x: function (i, t) { return (t.offsetHeight || 24) * 1.1 * TAN; }
                    },
                    {
                        yPercent: 0, x: 0,
                        duration: opts.duration || MOTION.dur.slow,
                        stagger: opts.stagger || (MOTION.stagger * 2),
                        ease: MOTION.ease.out
                    });
                /* autoSplit re-runs this on every resize / font swap. Replaying
                   the hero headline mid-session would be a bug, so once the hero
                   has played the re-split lands straight on its end state. */
                if (opts.hero && heroTextDone) tween.progress(1);
                return tween;                       /* MANDATORY with autoSplit */
            }
        });
        return tween;
    }

    var EFFECTS = {
        cut: function (el) { return gsap.effects.mkCut(el, {}); },
        lines: function (el) { return linesIn(el, {}); },
        up: function (el) { return gsap.effects.mkUp(el, {}); },
        fade: function (el) { return gsap.effects.mkFade(el, {}); },
        media: function (el) { return gsap.effects.mkMedia(el, {}); },
        stagger: function (el) { return gsap.effects.mkStagger(el, {}); }
    };
    var FALLBACK = EFFECTS.fade;
    /* Which vocabulary entries are cheap enough to batch (see §8). */
    var BATCHABLE = { up: 1, fade: 1 };

    function effectFor(el) {
        var key = el.getAttribute('data-anim');
        return (key && EFFECTS[key]) ? EFFECTS[key] : FALLBACK;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       5. ASSET GATE — callback based, no Promise dependency.
          Lazy images are excluded on purpose: they never resolve until the
          visitor scrolls to them, and waiting on one would stall the preloader
          forever. The hard cap makes that unfalsifiable anyway.
       ═══════════════════════════════════════════════════════════════════ */

    function assetsReady(capMs, onProgress, onDone) {
        var settled = false;
        var finish = function () {
            if (settled) return;
            settled = true;
            try { onDone(); } catch (e) { }
        };

        var vh = window.innerHeight || 800;
        var watched = [];
        each(qsa('img'), function (img) {
            if (img.loading === 'lazy') return;
            var top = 1e9;
            try { top = img.getBoundingClientRect().top; } catch (e) { }
            if (top > vh * 1.5) return;                /* below the fold: not our problem */
            watched.push(img);
        });

        var total = watched.length + 1;                /* +1 for the font gate */
        var done = 0;
        function tick() {
            done++;
            try { onProgress(Math.min(1, done / total)); } catch (e) { }
            if (done >= total) finish();
        }

        each(watched, function (img) {
            if (img.complete) { tick(); return; }
            var fired = false;
            var once = function () { if (fired) return; fired = true; tick(); };
            img.addEventListener('load', once);
            img.addEventListener('error', once);
        });

        if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
            document.fonts.ready.then(tick, tick);
        } else {
            tick();
        }

        window.setTimeout(finish, capMs);
        return { progress: function () { return Math.min(1, done / total); } };
    }

    /* ═══════════════════════════════════════════════════════════════════════
       6. PRELOADER — a real counter driven by real asset progress, capped at
          1s total, exiting upward along --mk-angle. Never a fake delay: if the
          assets are ready at 180ms the overlay leaves at 180ms.

          Markup contract (all optional — absent markup means no preloader, not
          a broken page):
            #mk-preloader | [data-preloader]      the full-screen overlay
              [data-preloader-count]              text node, receives 0..100
              [data-preloader-bar]                scaleX 0 -> 1
       ═══════════════════════════════════════════════════════════════════ */

    var PRELOADER_CAP = 1000;

    function runPreloader(onExit) {
        var pre = qs('#mk-preloader') || qs('[data-preloader]');
        var shownPct = 0;

        if (!pre) {
            /* No overlay in the DOM. Still gate the hero on the assets so the
               headline does not split against a fallback font, but never wait
               longer than the cap. */
            assetsReady(PRELOADER_CAP, function () { }, function () { onExit(0); });
            return;
        }

        claim(pre);
        var countEl = qs('[data-preloader-count]', pre);
        var barEl = qs('[data-preloader-bar]', pre);
        var started = (window.performance && performance.now) ? performance.now() : Date.now();

        function now() {
            return (window.performance && performance.now) ? performance.now() : Date.now();
        }

        function paint(p) {
            /* The counter never goes backwards and never sits still: it is the
               larger of "assets actually loaded" and "time against the cap". */
            p = Math.max(shownPct, Math.min(1, p));
            shownPct = p;
            if (countEl) countEl.textContent = String(Math.round(p * 100));
            if (barEl) gsap.set(barEl, { scaleX: p, transformOrigin: '0% 50%' });
        }

        var rafId = 0;
        function frame() {
            var elapsed = now() - started;
            paint(elapsed / PRELOADER_CAP);
            if (shownPct < 1) rafId = window.requestAnimationFrame(frame);
        }
        paint(0);
        if (barEl) gsap.set(barEl, { scaleX: 0, transformOrigin: '0% 50%' });
        rafId = window.requestAnimationFrame(frame);

        assetsReady(PRELOADER_CAP,
            function (p) { paint(p); },
            function () {
                if (rafId) window.cancelAnimationFrame(rafId);
                paint(1);

                if (reduced) {
                    gsap.set(pre, { autoAlpha: 0, display: 'none' });
                    onExit(0);
                    return;
                }

                /* Exit: a sheet leaving upward with its trailing edge cut at
                   --mk-angle. The shape is set instantly (no clip-path
                   interpolation — point counts must match and this way they
                   cannot drift), then the whole sheet slides. */
                var w = pre.offsetWidth || window.innerWidth || 1;
                var h = pre.offsetHeight || window.innerHeight || 1;
                var drop = Math.max(3, Math.min(14, (w * TAN / h) * 100));
                gsap.set(pre, {
                    clipPath: 'polygon(0% 0%, 100% 0%, 100% ' + (100 - drop).toFixed(2) + '%, 0% 100%)',
                    webkitClipPath: 'polygon(0% 0%, 100% 0%, 100% ' + (100 - drop).toFixed(2) + '%, 0% 100%)'
                });
                var exit = gsap.to(pre, {
                    yPercent: -105,
                    duration: MOTION.dur.slow,
                    ease: MOTION.ease.inOut,
                    onComplete: function () {
                        gsap.set(pre, { autoAlpha: 0, display: 'none' });
                        module('preloader refresh', function () { ScrollTrigger.refresh(); });
                    }
                });
                /* The hero overlaps the exit by 0.35s — the headline is already
                   moving behind the sheet as it clears. */
                onExit(Math.max(0, (exit.duration() || MOTION.dur.slow) - 0.35));
            });
    }

    /* ═══════════════════════════════════════════════════════════════════════
       7. HERO — the signature moment.
          Outside matchMedia (a resize must never replay it) and guarded by a
          flag. Budget: everything on screen by 1.40s, CTA at 0.32s.
       ═══════════════════════════════════════════════════════════════════ */

    var heroPlayed = false;

    function heroFinalState() {
        var hero = qs('.hero') || qs('#hero');
        if (!hero) return;
        var bits = qsa('[data-anim]', hero);
        each(bits, claim);
        gsap.set(bits.length ? bits : [hero], {
            autoAlpha: 1, y: 0, x: 0, scale: 1,
            clipPath: 'none', webkitClipPath: 'none',
            clearProps: 'transform'
        });
        gsap.set(qsa('.hero-grid, .side-glow, .side-glow-left, .side-glow-right', hero), { autoAlpha: 1 });
        var sc = qs('.hero-scanner', hero);
        if (sc) gsap.set(sc, { autoAlpha: 0 });
        heroTextDone = true;
    }

    function heroIn(startDelay) {
        if (heroPlayed) return null;
        heroPlayed = true;

        var hero = qs('.hero') || qs('#hero');
        if (!hero) return null;

        if (reduced) { heroFinalState(); return null; }

        var tl = gsap.timeline({
            delay: startDelay || 0,
            onComplete: function () { heroTextDone = true; }
        });

        /* ── background layers ───────────────────────────────────────────── */
        module('hero background', function () {
            var grid = qs('.hero-grid', hero);
            var glows = qsa('.side-glow, .side-glow-left, .side-glow-right', hero);
            if (grid) {
                tl.fromTo(grid, { autoAlpha: 0, scale: 1.06 },
                    { autoAlpha: 1, scale: 1, duration: MOTION.dur.hero, ease: MOTION.ease.out }, 0);
            }
            if (glows.length) {
                tl.fromTo(glows, { autoAlpha: 0 },
                    { autoAlpha: 1, duration: MOTION.dur.hero, ease: MOTION.ease.out, stagger: 0.12 }, 0.05);
            }
        });

        /* ── the scan line: violet -> teal, once, never a loop ────────────── */
        module('hero scanner', function () {
            var sc = qs('.hero-scanner', hero);
            if (!sc) return;
            claim(sc);
            /* Kill whatever CSS keyframe owns it — the brief is one sweep, not
               an infinite loop. Inline wins over a non-!important rule; if a
               rule does carry !important the GSAP tween still runs on top. */
            sc.style.animation = 'none';
            var bg = '';
            try { bg = window.getComputedStyle(sc).backgroundImage; } catch (e) { }
            if (!bg || bg === 'none') {
                sc.style.backgroundImage =
                    'linear-gradient(180deg, rgba(122,34,219,0) 0%, var(--violet-400, #A855F7) 35%, var(--teal-400, #2DD4BF) 100%)';
            }
            tl.fromTo(sc,
                { xPercent: -120, autoAlpha: 0 },
                {
                    xPercent: 120, autoAlpha: 1, duration: MOTION.dur.hero,
                    ease: MOTION.ease.inOut,
                    onComplete: function () { gsap.set(sc, { autoAlpha: 0 }); }
                }, 0);
        });

        /* ── badge ───────────────────────────────────────────────────────── */
        module('hero badge', function () {
            var badge = qs('.premium-badge, .hero-badge-animated', hero);
            if (!badge) return;
            claim(badge);
            tl.fromTo(badge, { y: 24, autoAlpha: 0 },
                { y: 0, autoAlpha: 1, duration: MOTION.dur.base, ease: MOTION.ease.out }, 0.04);
        });

        /* ── H1: per-line mask reveal, travelling along --mk-angle ────────── */
        module('hero title', function () {
            var h1 = qs('.hero-title', hero) || qs('h1', hero);
            if (!h1) return;
            claim(h1);
            var tw = linesIn(h1, { hero: true, duration: MOTION.dur.slow, stagger: MOTION.stagger * 2 });
            if (tw) tl.add(tw, 0.08);
            else gsap.set(h1, { autoAlpha: 1 });
        });

        /* ── description ─────────────────────────────────────────────────── */
        module('hero description', function () {
            var p = qs('.hero-description', hero) || qs('p', hero);
            if (!p) return;
            claim(p);
            tl.fromTo(p, { y: MOTION.y * 0.6, autoAlpha: 0 },
                { y: 0, autoAlpha: 1, duration: MOTION.dur.base, ease: MOTION.ease.out }, 0.42);
        });

        /* ── CTAs: absolute 0.32s. The old build left the primary button
              missing for the first 1.5s of the page's life. ──────────────── */
        module('hero actions', function () {
            var actions = qsa('.hero-actions .btn, .hero-actions > *', hero);
            if (!actions.length) return;
            each(actions, claim);
            tl.fromTo(actions, { y: 20, autoAlpha: 0 },
                {
                    y: 0, autoAlpha: 1, duration: MOTION.dur.base,
                    ease: MOTION.ease.out, stagger: MOTION.stagger
                }, 0.32);
        });

        /* ── scroll indicator ────────────────────────────────────────────── */
        module('hero scroll indicator', function () {
            var si = qs('.scroll-indicator', hero);
            if (!si) return;
            claim(si);
            tl.fromTo(si, { autoAlpha: 0, y: 12 },
                { autoAlpha: 1, y: 0, duration: MOTION.dur.base, ease: MOTION.ease.out }, 0.9);
        });

        /* ── anything the HTML tagged inside the hero that we did not
              already own, so the loop still covers 100% of [data-anim] ───── */
        module('hero tagged extras', function () {
            each(qsa('[data-anim]', hero), function (el, i) {
                if (isClaimed(el)) return;
                claim(el);
                var tw = effectFor(el)(el);
                if (tw) tl.add(tw, 0.1 + i * MOTION.stagger);
                else gsap.set(el, { autoAlpha: 1 });
            });
        });

        return tl;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       8. SCROLL REVEALS — iterate EVERY [data-anim], no subset, no exception.
          Cheap repeated effects go through ScrollTrigger.batch (one trigger
          instead of forty); the expressive ones get their own trigger.
       ═══════════════════════════════════════════════════════════════════ */

    function initScrollReveals() {
        var buckets = {};

        each(qsa('[data-anim]'), function (el) {
            if (isClaimed(el)) return;                    /* hero already owns it */
            if (closest(el, '.hero')) return;
            if (closest(el, '#mk-preloader, [data-preloader]')) return;

            var key = el.getAttribute('data-anim');
            if (!key || !EFFECTS[key]) key = 'fade';      /* unknown -> FALLBACK */

            claim(el);

            if (BATCHABLE[key]) {
                /* Pre-set the from-state now so the element is already dark
                   before its batch fires — otherwise it would flash. */
                if (key === 'up') gsap.set(el, { y: MOTION.y, autoAlpha: 0 });
                else gsap.set(el, { autoAlpha: 0 });
                (buckets[key] || (buckets[key] = [])).push(el);
                return;
            }

            var tw = EFFECTS[key](el);
            if (!tw) { gsap.set(el, { autoAlpha: 1 }); return; }

            tw.pause(0);
            var d = parseFloat(el.getAttribute('data-delay'));
            if (!isNaN(d) && d > 0) tw.delay(d);

            ScrollTrigger.create({
                trigger: el,
                /* clamp() keeps the start inside the scrollable range. Without it
                   an element too close to the bottom of the document can never
                   reach the 88% line — the page runs out of scroll first — and it
                   stays hidden forever. Measured: .footer-bottom did exactly that
                   at 390px, where the footer is tallest relative to the viewport. */
                start: 'clamp(top 88%)',
                once: true,
                invalidateOnRefresh: true,
                animation: tw
            });
        });

        /* One trigger per bucket, staggered per batch — this is where the
           "many similar elements" cost actually lives. */
        var keys = ['up', 'fade'];
        each(keys, function (key) {
            var list = buckets[key];
            if (!list || !list.length) return;

            ScrollTrigger.batch(list, {
                /* clamp() keeps the start inside the scrollable range. Without it
                   an element too close to the bottom of the document can never
                   reach the 88% line — the page runs out of scroll first — and it
                   stays hidden forever. Measured: .footer-bottom did exactly that
                   at 390px, where the footer is tallest relative to the viewport. */
                start: 'clamp(top 88%)',
                once: true,
                onEnter: function (batch) {
                    if (key === 'up') {
                        gsap.to(batch, {
                            y: 0, autoAlpha: 1,
                            duration: MOTION.dur.base, ease: MOTION.ease.out,
                            stagger: MOTION.stagger, overwrite: 'auto'
                        });
                    } else {
                        gsap.to(batch, {
                            autoAlpha: 1,
                            duration: MOTION.dur.base, ease: MOTION.ease.out,
                            stagger: MOTION.stagger, overwrite: 'auto'
                        });
                    }
                }
            });
        });
    }

    /* If the HTML never got its data-anim attributes, the page would ship with
       zero motion and no way to tell. Only runs when the count is exactly zero,
       so it can never collide with authored markup. */
    function autoTagFallback() {
        if (qsa('[data-anim]').length) return 0;
        var n = 0;
        function tag(sel, value, limit) {
            each(qsa(sel), function (el, i) {
                if (limit && i >= limit) return;
                if (el.getAttribute('data-anim')) return;
                if (closest(el, '.hero')) return;
                el.setAttribute('data-anim', value);
                n++;
            });
        }
        tag('.section-header h2, section h2', 'lines');
        tag('.section-header p, .section-subtitle', 'up');
        tag('.project-image, .project-card img, .about-image, .profile-image', 'media');
        tag('.portfolio-grid, .services-grid, .stats-grid, .process-steps, .faq-list', 'stagger');
        tag('.service-card, .feature-card, .stat-item, .testimonial-card, .timeline-item, .faq-item', 'up');
        return n;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       9. DESKTOP-ONLY EXTRAS
       ═══════════════════════════════════════════════════════════════════ */

    /* ── Lenis ───────────────────────────────────────────────────────────────
       The scroll container is <body>, so Lenis has to be told: with the default
       (window / documentElement) wrapper it would read a limit of ~0 and do
       nothing at all. Sync is the documented one: Lenis drives ScrollTrigger,
       the GSAP ticker drives Lenis, lagSmoothing off.

       It deliberately does NOT take over anchor navigation. js/onepage.js owns
       that (initAnchors -> scrollToY), and rebinding it here would produce two
       scripts scrolling the same page. Lenis tracks a native smooth scroll
       through its own scroll listener, so the two coexist; for a caller that
       wants Lenis easing, window.MKMotion.scrollTo() is the hook. */
    var lenisTick = null;

    function initLenis() {
        /* Some Lenis builds export the class on `.default` off the UMD global. */
        var L = (typeof Lenis !== 'undefined') ? Lenis : null;
        if (L && L.default && typeof L !== 'function') L = L.default;
        if (typeof L !== 'function') return null;

        var opts = {
            duration: 1.15,
            easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
            smoothWheel: true,
            wheelMultiplier: 0.9,
            touchMultiplier: 1.6,
            /* Lenis 1.x calls it `autoRaf`; older builds ignore the key. We drive
               it from the GSAP ticker instead so both clocks agree. */
            autoRaf: false
        };
        if (bodyScrolls) {
            opts.wrapper = document.body;
            opts.content = document.body;
        }

        var instance = null;
        module('lenis construct', function () { instance = new L(opts); });
        if (!instance) return null;

        module('lenis sync', function () {
            instance.on('scroll', ScrollTrigger.update);
            /* Stored, not anonymous: an orphaned ticker callback would keep
               calling raf() on a destroyed instance every frame forever. */
            lenisTick = function (t) { instance.raf(t * 1000); };
            gsap.ticker.add(lenisTick);
            gsap.ticker.lagSmoothing(0);
        });

        return instance;
    }

    /* ── custom cursor + magnetic buttons ─────────────────────────────────
       gsap.quickTo, never a fresh tween per pointermove: one tween per axis,
       reused. A tween per event is how a cursor turns into 400 live tweens and
       a dropped frame budget. */
    function initCursor() {
        if (!HAS.quickTo) return null;
        var fine = true;
        module('pointer check', function () {
            fine = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
        });
        if (!fine) return null;

        var dot = qs('.mk-cursor');
        if (!dot) {
            dot = document.createElement('div');
            dot.className = 'mk-cursor';
            dot.setAttribute('aria-hidden', 'true');
            /* Inline base so it is functional even before css/mk-elevate.css
               styles it; every value here is overridable by a real rule. */
            dot.style.cssText =
                'position:fixed;top:0;left:0;width:28px;height:28px;margin:-14px 0 0 -14px;' +
                'border:1px solid var(--violet-400,#A855F7);border-radius:50%;' +
                'pointer-events:none;z-index:9999;opacity:0;' +
                'mix-blend-mode:screen;will-change:transform';
            document.body.appendChild(dot);
        }

        var xTo = gsap.quickTo(dot, 'x', { duration: 0.34, ease: MOTION.ease.out });
        var yTo = gsap.quickTo(dot, 'y', { duration: 0.34, ease: MOTION.ease.out });
        var cursorVisible = false;

        window.addEventListener('pointermove', function (e) {
            if (!cursorVisible) { cursorVisible = true; gsap.to(dot, { autoAlpha: 1, duration: MOTION.dur.fast }); }
            xTo(e.clientX);
            yTo(e.clientY);
        }, { passive: true });

        window.addEventListener('pointerleave', function () {
            gsap.to(dot, { autoAlpha: 0, duration: MOTION.dur.fast });
        }, { passive: true });

        /* Grow over anything interactive. */
        each(qsa('a, button, .btn, .filter-btn, [role="button"]'), function (el) {
            el.addEventListener('pointerenter', function () {
                gsap.to(dot, { scale: 1.9, borderColor: 'var(--teal-400,#2DD4BF)', duration: MOTION.dur.fast });
            }, { passive: true });
            el.addEventListener('pointerleave', function () {
                gsap.to(dot, { scale: 1, borderColor: 'var(--violet-400,#A855F7)', duration: MOTION.dur.fast });
            }, { passive: true });
        });

        return dot;
    }

    function initMagnetic() {
        if (!HAS.quickTo) return 0;
        var targets = qsa('[data-magnetic]');
        if (!targets.length) {
            targets = qsa('.hero-actions .btn, .navbar-contact-link, .menu-trigger');
        }
        var n = 0;
        each(targets, function (el) {
            var xTo = gsap.quickTo(el, 'x', { duration: MOTION.dur.fast, ease: MOTION.ease.out });
            var yTo = gsap.quickTo(el, 'y', { duration: MOTION.dur.fast, ease: MOTION.ease.out });
            var pull = parseFloat(el.getAttribute('data-magnetic')) || 0.28;

            el.addEventListener('pointermove', function (e) {
                var r = el.getBoundingClientRect();
                xTo((e.clientX - (r.left + r.width / 2)) * pull);
                yTo((e.clientY - (r.top + r.height / 2)) * pull);
            }, { passive: true });

            el.addEventListener('pointerleave', function () { xTo(0); yTo(0); }, { passive: true });
            el.addEventListener('blur', function () { xTo(0); yTo(0); }, { passive: true });
            n++;
        });
        return n;
    }

    /* ── horizontal pinned rail ───────────────────────────────────────────
       SCRUBBED, never hijacked: the visitor keeps full control of scroll speed
       and direction. No snapping, no Observer section-jumping, ease "none",
       functional end value, invalidateOnRefresh.

       Markup contract:
         [data-rail]        the pinned viewport (usually the section)
         [data-rail-track]  the row that moves (optional; defaults to the first
                            element child)

       Without that markup it falls back to .portfolio-grid, but ONLY if the
       grid genuinely overflows horizontally. On the current CSS grid it does
       not, so the rail simply does not build — a pin over a non-overflowing
       track would steal a screen of scroll and move nothing. */
    function initRail() {
        var rail = qs('[data-rail]');
        var track = null;

        if (rail) {
            track = qs('[data-rail-track]', rail) || rail.children[0] || null;
        } else {
            var grid = qs('.portfolio-grid');
            if (!grid) return null;
            if (grid.scrollWidth <= grid.clientWidth + 40) return null;   /* not a rail */
            rail = grid.parentNode;
            track = grid;
        }
        if (!rail || !track) return null;

        function distance() {
            var d = track.scrollWidth - (rail.clientWidth || window.innerWidth);
            return Math.max(0, Math.round(d));
        }
        if (!distance()) return null;

        var tween = gsap.to(track, {
            x: function () { return -distance(); },
            ease: MOTION.ease.scrub,                    /* "none" — scrub must be linear */
            scrollTrigger: {
                trigger: rail,
                start: 'top top',
                end: function () { return '+=' + (distance() + rail.offsetHeight * 0.25); },
                pin: true,
                anticipatePin: 1,
                scrub: true,
                invalidateOnRefresh: true
            }
        });

        /* main.js's portfolio filter shows/hides cards with display:none, which
           changes the track width out from under the trigger. React to it —
           this reads the result, it does not re-implement the filter. */
        each(qsa('.filter-btn'), function (btn) {
            btn.addEventListener('click', function () {
                window.setTimeout(function () {
                    module('rail refresh', function () { ScrollTrigger.refresh(); });
                }, 60);
            }, { passive: true });
        });

        return tween;
    }

    /* ── parallax — at most three layers ──────────────────────────────────
       Attribute is data-parallax, NOT data-speed: data-speed is claimed by
       ScrollSmoother and would be silently double-handled if it ever loads. */
    function initParallax() {
        var layers = qsa('[data-parallax]');
        if (!layers.length) {
            var hero = qs('.hero');
            if (hero) {
                layers = [];
                var grid = qs('.hero-grid', hero);
                var gl = qs('.side-glow-left', hero);
                var gr = qs('.side-glow-right', hero);
                if (grid) { grid.setAttribute('data-parallax', '0.12'); layers.push(grid); }
                if (gl) { gl.setAttribute('data-parallax', '-0.18'); layers.push(gl); }
                if (gr) { gr.setAttribute('data-parallax', '0.18'); layers.push(gr); }
            }
        }
        layers = layers.slice(0, 3);
        if (!layers.length) return 0;

        each(layers, function (el) {
            var strength = parseFloat(el.getAttribute('data-parallax'));
            if (isNaN(strength) || !strength) strength = 0.15;
            var host = el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : el;

            gsap.fromTo(el,
                { y: function () { return -strength * (window.innerHeight || 800) * 0.35; } },
                {
                    y: function () { return strength * (window.innerHeight || 800) * 0.35; },
                    ease: MOTION.ease.scrub,
                    scrollTrigger: {
                        trigger: host,
                        start: 'top bottom',
                        end: 'bottom top',
                        scrub: true,
                        invalidateOnRefresh: true
                    }
                });
        });
        return layers.length;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       10/12. MARQUEE + PAUSE CONTROL (WCAG 2.2.2)
          Anything that moves automatically for more than five seconds needs a
          pause. css/marquee.css:41 runs `animation: scroll 40s linear infinite`,
          so the honest fix is to control THAT rather than layer a second,
          competing GSAP loop over it. If the CSS animation is ever removed,
          this builds a GSAP loop instead. Either way the result is stored in a
          variable with one API and one button wired to it.
       ═══════════════════════════════════════════════════════════════════ */

    function initMarquee() {
        var container = qs('.marquee-container');
        if (!container) return null;
        var contents = qsa('.marquee-content', container);
        if (!contents.length) return null;

        var cssDriven = false;
        module('marquee probe', function () {
            var name = window.getComputedStyle(contents[0]).animationName;
            cssDriven = !!(name && name !== 'none');
        });

        var api;

        if (cssDriven) {
            var paused = false;
            api = {
                type: 'css',
                paused: function () { return paused; },
                pause: function () {
                    paused = true;
                    each(contents, function (c) { c.style.animationPlayState = 'paused'; });
                },
                play: function () {
                    paused = false;
                    each(contents, function (c) { c.style.animationPlayState = 'running'; });
                }
            };
        } else {
            var tl = gsap.to(contents, {
                xPercent: -100,
                repeat: -1,
                duration: 40,
                ease: MOTION.ease.scrub
            });
            api = {
                type: 'gsap',
                timeline: tl,
                paused: function () { return !tl.isActive(); },
                pause: function () { tl.pause(); },
                play: function () { tl.play(); }
            };
        }

        /* Use the author's button if there is one; otherwise mint a real one.
           No visible copy is added — the label is on aria-label and the glyph is
           drawn, so the locked English text on the page is untouched. */
        var btn = qs('[data-marquee-toggle]') || qs('.marquee-pause') || qs('#marqueePause');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mk-marquee-toggle';
            btn.setAttribute('data-marquee-toggle', '');
            btn.style.cssText =
                'position:absolute;top:50%;right:12px;transform:translateY(-50%);' +
                'width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;' +
                'border:1px solid rgba(255,255,255,.18);border-radius:999px;' +
                'background:rgba(18,16,32,.72);color:rgba(255,255,255,.72);' +
                'cursor:pointer;z-index:5;line-height:1;font-size:11px;padding:0';
            if (window.getComputedStyle(container).position === 'static') {
                container.style.position = 'relative';
            }
            container.appendChild(btn);
        }

        function paint() {
            var isPaused = api.paused();
            btn.setAttribute('aria-pressed', isPaused ? 'true' : 'false');
            btn.setAttribute('aria-label', isPaused ? 'Play the technology marquee' : 'Pause the technology marquee');
            btn.innerHTML = isPaused
                ? '<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true"><path d="M0 0l10 6-10 6z"/></svg>'
                : '<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';
        }

        btn.addEventListener('click', function () {
            if (api.paused()) api.play(); else api.pause();
            paint();
        });

        /* Reduced motion: stopped by default, but still startable. */
        if (reduced) api.pause();
        paint();

        api.button = btn;
        return api;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       11. RUN
       ═══════════════════════════════════════════════════════════════════ */

    var marquee = null;
    var mm = gsap.matchMedia();

    function start() {
        /* Teach ScrollTrigger about <body> BEFORE a single trigger exists. */
        module('scroller wiring', wireScroller);

        module('auto-tag fallback', autoTagFallback);
        marquee = module('marquee', initMarquee);

        runPreloader(function (heroDelay) {
            var branched = false;

            /* ── REDUCE: set the FINAL state, duration 0. Never kill tweens —
                 killing them under the flash guard leaves content hidden
                 forever, which is worse than any animation. ──────────────── */
            module('reduce branch', function () {
                mm.add('(prefers-reduced-motion: reduce)', function () {
                    branched = true;
                    window.clearTimeout(SAFETY);
                    module('reduced reveals', function () {
                        var all = qsa('[data-anim]');
                        each(all, claim);
                        gsap.set(all, {
                            autoAlpha: 1, y: 0, x: 0, scale: 1,
                            clipPath: 'none', webkitClipPath: 'none',
                            clearProps: 'transform'
                        });
                    });
                    module('reduced hero', heroFinalState);
                    showAll();
                });
            });

            /* ── EVERY viewport that has not asked for less motion.
                 Deliberately NOT a breakpoint query: a phone with no reduce
                 preference matches this, and gets the full reveal system.
                 (The old build killed every reveal below 768px with
                 !important — animations.css:122-178 — which is exactly the
                 failure this branch exists to prevent.) ─────────────────── */
            module('reveal branch', function () {
                mm.add('(prefers-reduced-motion: no-preference)', function () {
                    branched = true;
                    module('scroll reveals', initScrollReveals);
                });
            });

            /* Neither branch matched (an engine with no matchMedia, or one that
               reports neither preference): still reveal, still animate. */
            if (!branched) {
                module('no-matchMedia fallback', initScrollReveals);
            }

            /* ── THE HERO — outside matchMedia on purpose.
                 A media-query context reverts everything it created when it
                 stops matching, and a hero that re-plays (or worse, reverts to
                 its from-state) on a resize or an OS preference flip is a bug.
                 The heroPlayed flag makes it once-only either way. ────────── */
            module('hero', function () { heroIn(heroDelay); });

            showAll();

            /* ── DESKTOP-ONLY EXTRAS ─────────────────────────────────────── */
            module('desktop branch', function () {
                mm.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', function () {
                    lenis = module('lenis', initLenis);
                    var cursor = module('cursor', initCursor);
                    module('magnetic', initMagnetic);
                    module('rail', initRail);
                    module('parallax', initParallax);

                    /* matchMedia contexts revert the tweens and triggers they
                       created; Lenis, its ticker callback and the cursor node
                       are ours to take down by hand. */
                    return function () {
                        if (lenisTick) {
                            module('ticker remove', function () { gsap.ticker.remove(lenisTick); });
                            lenisTick = null;
                        }
                        if (lenis) {
                            module('lenis destroy', function () { lenis.destroy(); });
                            lenis = null;
                            module('ticker reset', function () { gsap.ticker.lagSmoothing(500, 33); });
                        }
                        if (cursor && cursor.parentNode) cursor.parentNode.removeChild(cursor);
                    };
                });
            });

            /* ── 13. REFRESH after fonts and images ──────────────────────── */
            /* Re-decide the scroller FIRST. The boot-time answer was taken
               before images had height, when <body> still looked like the
               taller scroller; by now the real one is known. wireScroller()
               un-wires as readily as it wires, so a wrong early guess is
               corrected rather than frozen in. */
            module('re-wire scroller', wireScroller);
            module('refresh', function () { ScrollTrigger.refresh(); });
        });

        /* Late-landing images (lazy ones, the portfolio thumbnails) change every
           trigger position on the page. */
        window.addEventListener('load', function () {
            module('load re-wire', wireScroller);
            module('load refresh', function () { ScrollTrigger.refresh(); });
        });
        if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
            document.fonts.ready.then(function () {
                module('font re-wire', wireScroller);
                module('font refresh', function () { ScrollTrigger.refresh(); });
            });
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       PUBLIC HOOK
       js/onepage.js owns anchor scrolling. It is not rebound here; this is the
       hook it (or anything else) can call to move the page through Lenis
       instead of the browser's native smooth scroll:

           window.MKMotion.scrollTo('#contact')
           window.MKMotion.scrollTo(1200)
       ═══════════════════════════════════════════════════════════════════ */

    function resolveY(target) {
        if (typeof target === 'number') return target;
        var el = (typeof target === 'string') ? qs(target) : target;
        if (!el || !el.getBoundingClientRect) return null;
        var nav = qs('.navbar');
        var offset = 0;
        if (nav) {
            var pos = '';
            try { pos = window.getComputedStyle(nav).position; } catch (e) { }
            if (pos === 'fixed' || pos === 'sticky') {
                offset = Math.round(nav.getBoundingClientRect().bottom) + 16;
            }
        }
        return Math.max(0, Math.round(el.getBoundingClientRect().top + scrollTopOf() - offset));
    }

    window[NS] = {
        version: VERSION,
        motion: MOTION,
        angle: function () { return MOTION.angle; },
        get lenis() { return lenis; },
        get marquee() { return marquee; },
        scroller: function () { return scrollerEl; },
        effects: EFFECTS,
        refresh: function () { module('api refresh', function () { ScrollTrigger.refresh(); }); },
        scrollTo: function (target, opts) {
            var y = resolveY(target);
            if (y === null) return false;
            if (lenis && typeof lenis.scrollTo === 'function') {
                lenis.scrollTo(y, opts || { duration: 1.15 });
                return true;
            }
            if (HAS.ScrollTo) {
                gsap.to(scrollerEl, {
                    duration: reduced ? 0 : MOTION.dur.slow,
                    scrollTo: { y: y, autoKill: true },
                    ease: MOTION.ease.inOut
                });
                return true;
            }
            try { scrollerEl.scrollTop = y; } catch (e) { return false; }
            return true;
        },
        showAll: showAll
    };

    /* ── boot LAST ────────────────────────────────────────────────────────
       This ships with `defer`, so at execution time readyState is already
       "interactive". Waiting for DOMContentLoaded puts this file behind every
       DOMContentLoaded binder on the page (main.js, contact.js, onepage.js) —
       the portfolio filter, the modals and the menu all exist before anything
       here measures them. The load + timeout nets cover a late/async inject. */
    var booted = false;
    function boot() {
        if (booted) return;
        booted = true;
        module('boot', start);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        /* Give the other DOMContentLoaded handlers their turn first. */
        if (document.readyState === 'complete') window.setTimeout(boot, 0);
        else document.addEventListener('DOMContentLoaded', boot);
    } else {
        document.addEventListener('DOMContentLoaded', boot);
    }
    window.addEventListener('load', boot);
    window.setTimeout(boot, 2500);

}(window, document));
