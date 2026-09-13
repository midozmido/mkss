/* ============================================================================
   js/signature.js — 12b SIGNATURE: the pinned scene
   ----------------------------------------------------------------------------
   Loads AFTER js/motion.js and EXTENDS it. It edits nothing that file owns: no
   effect is re-registered, no [data-anim] element is touched, the scroller is
   not re-detected (motion.js wires ScrollTrigger's scrollerProxy before any
   trigger exists, and this file simply inherits the defaults it set).

   THE SCENE — one parent timeline, scrubbed by the visitor's own scroll:

       0 → 35%    the sentence assembles. SplitText by WORDS, never chars: a
                  character split breaks the joins in a joined script and this
                  page may carry Arabic later. Each word arrives along the
                  --mk-angle vector (dx = dy · tan21), not straight up.
       35 → 55%   it holds, fully legible. A scene with no rest is a gimmick.
       55 → 75%   it disperses on the same vector, the opposite direction, in a
                  scattered order rather than a tidy queue.
       75 → 100%  the mark builds from nothing. A clip-path wipe travelling
                  along --mk-angle — not a fade, the wipe is the whole idea —
                  with the picture counter-scaling 1.12 → 1 inside it so it
                  settles instead of zooming, and the violet-to-teal gradient
                  igniting last: the mark arrives grey and takes its colour in
                  the final sixth of the scene.

   THE RULES THIS FILE KEEPS
     · ScrollTrigger on the parent timeline only. No child tween owns one.
     · pin, scrub 1, end +=140%, anticipatePin, invalidateOnRefresh.
     · Every selector guarded; every module wrapped, so one failure cannot take
       the page down with it.
     · Nothing already registered is registered again — the plugins are checked
       by name against gsap's own globals first.
     · Below 900px there is no pin: a pinned scrubbed scene on a phone fights
       the browser's own scroll. The same two elements get a plain reveal.
     · prefers-reduced-motion gets no pin and no scrub — it gets the FINAL
       state, set directly. Tweens are never killed: a killed tween under a
       flash guard leaves content hidden forever, which is worse than any
       animation.
     · The flash guard here is .signature__veil (c.css, 12b). It is lifted the
       instant the from-state is set, and again by the safety net below.
   ========================================================================== */

(function (window, document) {
    'use strict';

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

    /* Same shape as js/motion.js: one broken module never takes the rest down. */
    function module(name, fn) {
        try { return fn(); } catch (err) {
            if (window.console && console.warn) console.warn('[mk-signature] ' + name + ':', err);
            return null;
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       1. THE VEIL — c.css hides both halves while `js` is on <html>. This is
          the only thing that lifts it, so it must run on every path out of
          this file, including the failures.
       ═══════════════════════════════════════════════════════════════════ */

    var unveiled = false;

    function unveil() {
        if (unveiled) return;
        unveiled = true;
        each(qsa('.signature__veil'), function (el) {
            try { el.classList.remove('signature__veil'); } catch (e) { /* nothing left to try */ }
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
       2. STATE — filled in by run(), read by the safety net.
       ═══════════════════════════════════════════════════════════════════ */

    var root = null;        /* the <section>            */
    var frame = null;       /* the grid that holds both halves */
    var words = null;       /* the <h2>                 */
    var logo = null;        /* the mark's positioning wrapper */
    var wipe = null;        /* the clip-path target     */
    var mark = null;        /* the <img>                */
    var glow = null;        /* the bloom, decoration    */
    var parts = null;       /* the word spans, or [words] with no SplitText */
    var settled = false;    /* a branch ran to completion */

    /* The mark's resting bloom. Deliberately not 1: the plate is the full brand
       gradient blurred by --blur-glow, and at full opacity it would out-shout
       the mark it is lighting. */
    var GLOW = 0.55;
    var MARK_SCALE = 1.12;          /* counter-scale: settles, never zooms */
    var MARK_DIM = 'grayscale(1) brightness(0.55)';
    var MARK_LIT = 'grayscale(0) brightness(1)';

    /* Durations and eases mirror the tokens in css/tokens.css. Anything
       scrubbed uses "none": a scrubbed tween with a curve fights the hand on
       the wheel. */
    var DUR = { fast: 0.36, base: 0.72, slow: 1.05 };
    var EASE = { out: 'expo.out', inOut: 'expo.inOut', scrub: 'none' };

    /* ═══════════════════════════════════════════════════════════════════════
       3. SAFETY NET — nothing this file touches may stay invisible. If run()
          threw halfway, the from-state is already painted and lifting the veil
          alone would not be enough, so the net lands the final state too.
       ═══════════════════════════════════════════════════════════════════ */

    window.setTimeout(function () {
        module('safety net', function () {
            if (!settled) module('net final state', showFinal);
            unveil();
        });
    }, 4000);

    /* ═══════════════════════════════════════════════════════════════════════
       4. THE FINAL STATE — both halves, still and visible. This is what
          reduced motion gets, what an engine with no matchMedia gets, and what
          the safety net falls back to.
       ═══════════════════════════════════════════════════════════════════ */

    function showFinal() {
        if (typeof gsap === 'undefined' || !gsap || !gsap.core) return;
        /* No clearProps here: gsap applies it last and it would wipe the very
           values being set on the same call. */
        if (parts && parts.length) gsap.set(parts, { opacity: 1, x: 0, y: 0 });
        else if (words) gsap.set(words, { opacity: 1, x: 0, y: 0 });
        if (wipe) gsap.set(wipe, { clipPath: 'none', webkitClipPath: 'none' });
        if (mark) gsap.set(mark, { scale: 1, filter: 'none' });
        if (glow) gsap.set(glow, { opacity: GLOW });
        if (frame) {
            try { frame.classList.remove('signature__frame--scene'); } catch (e) { }
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       5. GEOMETRY — --mk-angle is the single source of truth; the constant is
          only the fallback for the frame before the stylesheet has parsed.
       ═══════════════════════════════════════════════════════════════════ */

    var ANGLE = 21;
    var TAN = Math.tan(ANGLE * Math.PI / 180);

    function readAngle() {
        var raw = window.getComputedStyle(document.documentElement).getPropertyValue('--mk-angle');
        var deg = parseFloat(raw);
        if (!isNaN(deg) && deg > 0 && deg < 90) {
            ANGLE = deg;
            TAN = Math.tan(ANGLE * Math.PI / 180);
        }
    }

    /* How far a word travels. Its own height, so a word set at 50px moves
       further than one set at 20px and the whole line reads as one gesture at
       any viewport. Function-based in the tweens, so a refresh re-measures. */
    function travelY(el) {
        var h = (el && el.offsetHeight) || 0;
        return (h || 24) * 1.15;
    }

    function travelX(el) {
        return travelY(el) * TAN;
    }

    /* THE MK CUT, as a clip-path. The same near-vertical edge leaning 21deg off
       vertical that js/motion.js sweeps across a heading — the run is a
       percentage of the element's own width, so it stays a true 21deg at any
       size. Measured lazily and re-measured on refresh. */
    function cutRun(el) {
        var h = el.offsetHeight || 0;
        var w = el.offsetWidth || 0;
        if (!h || !w) return 20;                       /* pre-layout fallback */
        return Math.max(4, Math.min(60, (h * TAN / w) * 100));
    }

    /* The closed state must have ZERO AREA — a line, not a shape.
       The previous version was polygon(0 0, 0 0, -r 100%, 0 100%): a thin
       triangle whose tail sits left of the box. That looks harmless until you
       remember the logo is held at its 1.12x counter-scale before the reveal,
       so it overflows the wipe by ~20px on every side — and the triangle
       uncovered that overflow. The result was a small grey wedge of logo
       sitting on top of the word "starts" for the whole of the word phase.
       Collapsing points 3 and 4 onto the same slanted line gives the shape no
       interior at all, while keeping the 21deg leading edge for the sweep. */
    function cutFrom(el) {
        var r = cutRun(el);
        var x = (-r).toFixed(2);
        return 'polygon(0% 0%, 0% 0%, ' + x + '% 100%, ' + x + '% 100%)';
    }

    function cutTo(el) {
        var r = cutRun(el);
        return 'polygon(0% 0%, ' + (100 + r).toFixed(2) + '% 0%, 100% 100%, 0% 100%)';
    }

    /* ═══════════════════════════════════════════════════════════════════════
       6. THE SPLIT — by WORDS. autoSplit is off on purpose: it re-splits on
          every resize and font swap, and the new spans would leave the scrubbed
          timeline animating nodes that are no longer in the document. Words
          survive a resize anyway — they reflow, they do not re-break.
       ═══════════════════════════════════════════════════════════════════ */

    function splitWords(hasSplit) {
        if (!hasSplit || !words) return words ? [words] : [];
        var list = null;
        module('split by words', function () {
            var split = SplitText.create(words, {
                type: 'words',
                wordsClass: 'signature__word',
                aria: 'auto',
                autoSplit: false
            });
            if (split && split.words && split.words.length) list = split.words;
        });
        /* No SplitText, or a split that produced nothing: the whole heading
           travels as one block. Still the right gesture, never a blank line. */
        return (list && list.length) ? list : [words];
    }

    /* Splits a window of the timeline between a duration and a stagger so the
       whole group lands exactly on the window's end, whatever the word count. */
    function window_(total, count) {
        if (count < 2) return { dur: total, stagger: 0 };
        var s = (total * 0.55) / (count - 1);
        return { dur: total - s * (count - 1), stagger: s };
    }

    /* ═══════════════════════════════════════════════════════════════════════
       7. THE PINNED, SCRUBBED SCENE — 900px and up, no reduced-motion request.
          The ScrollTrigger lives on the parent timeline and nowhere else; every
          child is a plain tween placed at an absolute position on it.
       ═══════════════════════════════════════════════════════════════════ */

    /* The four windows of the scene, as fractions of one timeline. */
    var IN = 0.35;
    var HOLD = 0.20;
    var OUT = 0.20;
    var BUILD = 0.25;
    var T_OUT = IN + HOLD;                  /* 0.55 — dispersal starts */
    var T_BUILD = IN + HOLD + OUT;          /* 0.75 — the mark starts building */

    function buildScene() {
        if (!root || !frame || !parts || !parts.length || !wipe || !mark) return null;

        frame.classList.add('signature__frame--scene');

        var enter = window_(IN, parts.length);
        var leave = window_(OUT, parts.length);

        var tl = gsap.timeline({
            defaults: { ease: EASE.scrub },
            scrollTrigger: {
                trigger: root,
                start: 'top top',
                end: '+=140%',
                pin: true,
                anticipatePin: 1,
                scrub: 1,
                invalidateOnRefresh: true
            }
        });

        /* ── 0 → 35%: the words assemble ─────────────────────────────────────
           opacity, not autoAlpha: autoAlpha parks visibility:hidden at zero,
           which takes the heading out of the accessibility tree every time the
           scene rests at either end. The sentence is this section's accessible
           name, so it stays in the tree the whole way through. */
        tl.fromTo(parts,
            {
                opacity: 0,
                y: function (i, t) { return travelY(t); },
                x: function (i, t) { return travelX(t); }
            },
            {
                opacity: 1, y: 0, x: 0,
                duration: enter.dur,
                stagger: { each: enter.stagger, from: 'start' }
            }, 0);

        /* ── 35 → 55%: the hold. Nothing is scheduled here, and that is the
              point: the sentence has to be readable at a standstill or the
              whole scene is decoration. ──────────────────────────────────── */

        /* ── 55 → 75%: dispersal. Same angle, opposite direction — the offset
              signs flip, so the words carry on through instead of retreating.
              from:"random" scatters the order, so it reads as coming apart
              rather than as the assembly played backwards. ────────────────── */
        tl.to(parts, {
            opacity: 0,
            y: function (i, t) { return -travelY(t); },
            x: function (i, t) { return -travelX(t); },
            duration: leave.dur,
            stagger: { each: leave.stagger, from: 'random' }
        }, T_OUT);

        /* ── 75 → 100%: the mark builds from nothing ────────────────────────
              The wipe is the idea: a leaning edge crossing the mark along
              --mk-angle. There is no opacity on it at all, so it can never
              degrade into a fade. */
        tl.fromTo(wipe,
            {
                clipPath: function (i, t) { return cutFrom(t); },
                webkitClipPath: function (i, t) { return cutFrom(t); }
            },
            {
                clipPath: function (i, t) { return cutTo(t); },
                webkitClipPath: function (i, t) { return cutTo(t); },
                duration: BUILD * 0.70
            }, T_BUILD);

        /* Counter-scale: the picture eases out of 1.12 inside the clip while
           the clip opens, so the two move at different speeds and the mark
           settles into place rather than flying at the visitor. */
        tl.fromTo(mark,
            { scale: MARK_SCALE },
            { scale: 1, duration: BUILD * 0.80 }, T_BUILD);

        /* The gradient ignites LAST, and finishes last: the mark is built in
           grey, then takes its violet-to-teal in the final sixth of the scene.
           The clip-path never clears — under a scrub the scene has to be able
           to run backwards, and clearing would strand the mark fully drawn. */
        tl.fromTo(mark,
            { filter: MARK_DIM },
            { filter: MARK_LIT, duration: BUILD * 0.60 }, T_BUILD + BUILD * 0.40);

        if (glow) {
            tl.fromTo(glow,
                { opacity: 0 },
                { opacity: GLOW, duration: BUILD * 0.60 }, T_BUILD + BUILD * 0.40);
        }

        return tl;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       8. BELOW 900px — no pin. A pinned scrubbed scene on a phone fights the
          browser's own scroll: the visitor's thumb stops moving the page and
          starts moving a timeline, which is exactly the gesture a phone has no
          way to explain. The same two elements, revealed once, at their own
          speed. The words do not disperse here — with no pin there is nothing
          to disperse into, and both halves stay on the page.
       ═══════════════════════════════════════════════════════════════════ */

    function buildPlainReveal() {
        if (!root || !parts || !parts.length || !wipe || !mark) return null;

        var tl = gsap.timeline({ paused: true, defaults: { ease: EASE.out } });

        tl.fromTo(parts,
            {
                opacity: 0,
                y: function (i, t) { return travelY(t); },
                x: function (i, t) { return travelX(t); }
            },
            {
                opacity: 1, y: 0, x: 0,
                duration: DUR.base,
                stagger: 0.055
            }, 0);

        tl.fromTo(wipe,
            {
                clipPath: function (i, t) { return cutFrom(t); },
                webkitClipPath: function (i, t) { return cutFrom(t); }
            },
            {
                clipPath: function (i, t) { return cutTo(t); },
                webkitClipPath: function (i, t) { return cutTo(t); },
                duration: DUR.slow, ease: EASE.inOut
            }, DUR.fast);

        tl.fromTo(mark,
            { scale: MARK_SCALE },
            { scale: 1, duration: DUR.slow, ease: EASE.inOut }, DUR.fast);

        tl.fromTo(mark,
            { filter: MARK_DIM },
            { filter: MARK_LIT, duration: DUR.base }, DUR.fast + DUR.base);

        if (glow) {
            tl.fromTo(glow,
                { opacity: 0 },
                { opacity: GLOW, duration: DUR.base }, DUR.fast + DUR.base);
        }

        tl.pause(0);

        /* clamp() keeps the start inside the scrollable range, the same guard
           js/motion.js uses: an element too close to the end of the document
           can never reach the line, and would stay hidden forever. */
        ScrollTrigger.create({
            trigger: root,
            start: 'clamp(top 80%)',
            once: true,
            invalidateOnRefresh: true,
            animation: tl
        });

        return tl;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       9. RUN
       ═══════════════════════════════════════════════════════════════════ */

    function run() {
        root = qs('#signature') || qs('[data-signature]');
        if (!root) { unveil(); return; }

        frame = qs('[data-signature-frame]', root);
        words = qs('[data-signature-words]', root);
        logo = qs('[data-signature-logo]', root);
        wipe = qs('[data-signature-wipe]', root);
        mark = qs('[data-signature-mark]', root);
        glow = qs('.signature__glow', root);

        /* Any missing piece and there is no scene to build — but the markup
           that IS there still has to be readable. */
        if (!frame || !words || !logo || !wipe || !mark) { unveil(); return; }

        /* GSAP or ScrollTrigger absent: hand the section straight back to CSS.
           Both halves are real content and read perfectly well without motion. */
        if (typeof gsap === 'undefined' || !gsap || !gsap.core) { unveil(); return; }

        var hasST = (typeof ScrollTrigger !== 'undefined') && !!ScrollTrigger;
        /* SplitText.create / autoSplit only exist from GSAP 3.13. An older
           build degrades to a whole-heading reveal instead of throwing. */
        var hasSplit = (typeof SplitText !== 'undefined') && !!SplitText &&
            typeof SplitText.create === 'function';

        if (!hasST) { unveil(); return; }

        /* Register nothing that is already registered. js/motion.js loads first
           and registers both; this only covers the case where it did not run. */
        module('register plugins', function () {
            var known = {};
            try { known = gsap.core.globals() || {}; } catch (e) { known = {}; }
            var pending = [];
            if (hasST && !known.ScrollTrigger) pending.push(ScrollTrigger);
            if (hasSplit && !known.SplitText) pending.push(SplitText);
            if (pending.length) gsap.registerPlugin.apply(gsap, pending);
        });

        module('read --mk-angle', readAngle);

        parts = splitWords(hasSplit);
        if (!parts.length) { unveil(); return; }

        var branched = false;
        var mm = gsap.matchMedia();

        /* ── REDUCED MOTION: the final state, set directly. No pin, no scrub,
              and no tween to kill. ─────────────────────────────────────────── */
        module('reduce branch', function () {
            mm.add('(prefers-reduced-motion: reduce)', function () {
                branched = true;
                module('reduced final state', showFinal);
            });
        });

        /* ── THE SCENE: 900px and up. ───────────────────────────────────────
              The cleanup takes the overlap back off when the context stops
              matching, so a resize down to a phone leaves the sentence above
              the mark rather than on top of it. gsap.matchMedia reverts the
              timeline and its ScrollTrigger by itself. */
        module('scene branch', function () {
            mm.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', function () {
                branched = true;
                module('pinned scene', buildScene);
                return function () {
                    if (frame) frame.classList.remove('signature__frame--scene');
                };
            });
        });

        /* ── THE FALLBACK: below 900px. The complement of the site's 900px
              breakpoint, not a fourth one. ─────────────────────────────────── */
        module('plain branch', function () {
            mm.add('(max-width: 899.98px) and (prefers-reduced-motion: no-preference)', function () {
                branched = true;
                module('plain reveal', buildPlainReveal);
            });
        });

        /* An engine with no matchMedia, or one reporting neither preference:
           still readable, still finished. */
        if (!branched) module('no-matchMedia fallback', showFinal);

        /* The from-states are set. Lift the guard — synchronously, in the same
           task, so there is no frame where the content paints unstyled. */
        unveil();
        settled = true;

        /* The mark is lazy-loaded. Its box is reserved by the width and height
           attributes so nothing reflows, but the wipe measures the real element
           and a refresh after the bytes land costs nothing. */
        if (mark && !mark.complete) {
            mark.addEventListener('load', function () {
                module('mark refresh', function () { ScrollTrigger.refresh(); });
            });
        }
    }

    /* ═══════════════════════════════════════════════════════════════════════
       10. BOOT — after js/motion.js, never before.
           This ships with `defer` and executes while readyState is already
           "interactive", so it takes the same DOMContentLoaded path motion.js
           takes. Its listener is registered second, which is the whole point:
           motion.js has to wire ScrollTrigger's scrollerProxy before this file
           creates a single trigger, or the pin would be measured against an
           element that never moves. The load and timeout nets cover a late or
           async inject.
       ═══════════════════════════════════════════════════════════════════ */

    var booted = false;

    function boot() {
        if (booted) return;
        booted = true;
        module('boot', run);
    }

    if (document.readyState === 'complete') {
        window.setTimeout(boot, 0);
    } else {
        document.addEventListener('DOMContentLoaded', boot);
    }
    window.addEventListener('load', boot);
    window.setTimeout(boot, 2500);

}(window, document));
