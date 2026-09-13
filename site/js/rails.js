/* ============================================================================
   rails.js — CARD GROUPS BECOME HORIZONTAL RAILS ON A PHONE
   ----------------------------------------------------------------------------
   Loads after js/motion.js and extends it. It registers nothing motion.js has
   already registered, it does not pin, it does not touch Lenis, the reveals,
   the cursor or the preloader, and it never claims [data-rail] — that selector
   belongs to the work rail and motion.js's initRail() takes the FIRST match on
   the page, so a second one would silently steal it.

   ── THE CLASS SYSTEM ────────────────────────────────────────────────────────

     .flick-rail          THE TRACK. The element that already carries .grid.
                          Below 900px css/sections/d.css turns it into a
                          horizontal scroll container with snap points; this
                          file scrubs its scrollLeft as the section passes the
                          viewport. From 900px it is the grid again and this
                          file does nothing at all.

     .flick-rail__item    ONE CARD on the track. Must be a DIRECT child of it.

     .flick-rail.is-scrubbing
                          STATE, written here and nowhere else. It turns
                          scroll-snap off for as long as the scrub owns the
                          track: a `scroll-snap-type: x mandatory` container
                          re-snaps after every programmatic scroll, which would
                          quantise a smooth scrub into card-sized jumps.

   ── TO TURN ANY FUTURE CARD GROUP INTO A RAIL ──────────────────────────────

     1. add  class="… flick-rail"        to the grid container
     2. add  class="… flick-rail__item"  to every direct child
     3. add  tabindex="0"  and an accessible name to the container —
             aria-label on a <ul>/<ol>, or role="group" + aria-label on a <div>
             — so the scroller is reachable and operable from the keyboard.

     That is the whole contract. No id, no data attribute, no edit to this
     file: it finds every .flick-rail on its own, and skips the ones that do
     not actually overflow.

   ── THE FIVE RULES THIS FILE IS BUILT AROUND ───────────────────────────────

     1. NEVER PIN. Pinning a rail on a phone is the single most common way this
        effect becomes a scroll trap. There is no pin here, and no Observer:
        vertical scrolling is never intercepted, never slowed, never redirected.
     2. THE HAND ALWAYS WINS. The track is a real overflow-x scroller with snap
        points underneath, so it can be flicked at any moment. The first time
        the visitor moves it themselves the scrub is killed for good and the
        row is theirs — nobody is left waiting for an animation to finish.
     3. SCRUBBED MOVEMENT IS LINEAR. The horizontal move is a tween on the
        parent timeline with ease "none". An eased scrub reads as lag.
     4. prefers-reduced-motion: NO SCRUB AT ALL. The media query below simply
        does not match, nothing is built, and the track stays what the CSS
        already made it — a plain swipeable row with snap. Nothing is killed
        and nothing is left hidden.
     5. IT MOVES THE REAL SCROLLER, not a transform. Snap, momentum, the
        scrollbar geometry and the arrow keys all stay native; the scrub has
        nothing to do but write scrollLeft.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var RAIL = '.flick-rail';
    var SCRUBBING = 'is-scrubbing';

    /* The JS mirror of the CSS. d.css is mobile-first — it states the rail and
       undoes it at `min-width: 900px` — so this file's window is everything
       below 900px, which in a media query can only be written as a max-width.
       The .98 keeps the two blocks from both matching on a fractional
       viewport width. */
    var PHONE = '(max-width: 899.98px) and (prefers-reduced-motion: no-preference)';

    /* A track that overflows by less than this is not a rail; scrubbing it
       would be a twitch, and killing the snap for it buys nothing. */
    var MIN_TRAVEL = 32;

    /* How far the track can differ from the value this file last wrote before
       the movement is credited to the visitor. Covers sub-pixel rounding on
       scrollLeft read-back, and nothing else: snap is off while the scrub is
       running, so there is no other machine moving this element. */
    var HAND_TOLERANCE = 8;

    /* The one moment something OTHER than the visitor can move the track: snap
       is handed back the instant the scrub stops owning it, and the browser
       then settles the row onto a snap port. Scroll positions inside this
       window after that hand-back are re-read rather than read as a swipe. */
    var SNAP_GRACE = 600;

    /* ── helpers, same shape as js/motion.js ─────────────────────────────── */

    function qsa(sel, ctx) {
        try { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
        catch (e) { return []; }
    }

    function each(list, fn) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) fn(list[i], i);
    }

    /* One broken rail must never take the page down with it. */
    function module(name, fn) {
        try { return fn(); } catch (err) {
            if (window.console && console.warn) console.warn('[mk-rails] ' + name + ':', err);
            return null;
        }
    }

    if (typeof gsap === 'undefined' || !gsap || !gsap.core) return;
    if (typeof ScrollTrigger === 'undefined' || !ScrollTrigger) return;

    function travelOf(track) {
        return Math.max(0, Math.round(track.scrollWidth - track.clientWidth));
    }

    /* ═══════════════════════════════════════════════════════════════════════
       KEYBOARD REACH
       The scrollbar is hidden in CSS, so the track carries tabindex="0" in the
       markup: focus it with Tab, move it with the arrow keys, Home and End.
       At 900px the same element stops being a scroller, and a tab stop that
       scrolls nothing is just a dead stop in the tab order — so the attribute
       is taken off again whenever the element does not actually overflow, and
       put back when it does. Re-run on every ScrollTrigger refresh, which is
       every resize, every font load and every late image.
       ═══════════════════════════════════════════════════════════════════ */

    function syncReach() {
        each(qsa(RAIL), function (track) {
            var scrolls = travelOf(track) > 0;
            if (scrolls) {
                if (track.getAttribute('tabindex') === null) track.setAttribute('tabindex', '0');
            } else if (track.getAttribute('tabindex') === '0') {
                track.removeAttribute('tabindex');
            }
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
       ONE RAIL
       Returns a teardown, or null if this track is not worth scrubbing.
       ═══════════════════════════════════════════════════════════════════ */

    function buildRail(track, scroller) {
        if (travelOf(track) < MIN_TRAVEL) return null;

        var live = true;                       /* false once the hand takes over */
        var written = track.scrollLeft;        /* the last value written here    */
        var scrubbing = false;
        var grace = 0;
        var progress = { p: 0 };               /* the scrubbed proxy             */

        function setScrubbing(on) {
            if (on === scrubbing) return;
            scrubbing = on;
            if (on) {
                track.classList.add(SCRUBBING);
            } else {
                track.classList.remove(SCRUBBING);
                grace = Date.now() + SNAP_GRACE;   /* the browser is about to snap */
            }
        }

        /* The scrubbed move. Linear by contract, driven by the parent timeline
           rather than by a ScrollTrigger of its own.

           Snap is only taken away on a frame that actually moves the row. A
           scrub tween is updated once when it is built, long before the
           section is anywhere near the viewport, and that first update writes
           the position the row is already in — taking snap off for it would
           leave every rail on the page unsnapped until its trigger first went
           inactive.

           The read-back matters too: the browser clamps scrollLeft to the
           current scroll range, and comparing against an unclamped number
           would make the scrub read its own clamp as a swipe. */
        function apply() {
            if (!live) return;
            var travel = travelOf(track);
            if (travel < MIN_TRAVEL) return;
            var target = Math.round(progress.p * travel);
            if (Math.abs(target - track.scrollLeft) > 1) {
                setScrubbing(true);
                track.scrollLeft = target;
            }
            written = track.scrollLeft;
        }

        /* The window is the whole time the row is on screen, less a tenth of
           the viewport at each end so the first and last card are readable at
           rest. Any shorter and six cards have to cross a 390px screen inside
           half a flick, which is a blur rather than a rail. */
        var config = {
            trigger: track,
            start: 'top 90%',
            end: 'bottom 10%',
            scrub: 0.6,
            invalidateOnRefresh: true,
            onToggle: function (self) { if (!self.isActive) setScrubbing(false); }
        };
        if (scroller) config.scroller = scroller;

        var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: config });
        tl.to(progress, { p: 1, onUpdate: apply });

        /* ── the hand takes over ──────────────────────────────────────────
           Detected from the track's own scroll position, not from a pointer
           event: on a phone every vertical page swipe that happens to start on
           top of the rail fires pointerdown and touchstart here, and killing
           the scrub for that would kill it for almost everybody. A scrollLeft
           that does not match what this file last wrote, on the other hand,
           can only be the visitor — snap is off while the scrub is running, so
           nothing else moves this element.

           focusin is the second, honest trigger: tabbing to a link inside a
           card makes the browser scroll that card into view, and a scrub that
           then dragged it back out would strand the focus ring off-screen. */
        function handOver() {
            if (!live) return;
            live = false;
            setScrubbing(false);              /* snap is theirs again */
            detach();
            module('hand over', function () {
                if (tl.scrollTrigger) tl.scrollTrigger.kill();
                tl.kill();
            });
        }

        function onScroll() {
            if (!live) return;
            if (Date.now() < grace) { written = track.scrollLeft; return; }
            if (Math.abs(track.scrollLeft - written) > HAND_TOLERANCE) handOver();
        }

        function attach() {
            track.addEventListener('scroll', onScroll, { passive: true });
            track.addEventListener('focusin', handOver, { passive: true });
        }

        function detach() {
            track.removeEventListener('scroll', onScroll);
            track.removeEventListener('focusin', handOver);
        }

        attach();

        return function teardown() {
            live = false;                     /* a late onUpdate becomes a no-op */
            setScrubbing(false);
            detach();
            module('teardown', function () {
                if (tl.scrollTrigger) tl.scrollTrigger.kill();
                tl.kill();
            });
        };
    }

    /* ═══════════════════════════════════════════════════════════════════════
       WIRING
       gsap.matchMedia owns the lifecycle: below 900px with no reduced-motion
       preference the rails are built, and the moment either of those stops
       being true GSAP reverts everything created inside the context and calls
       the cleanup returned below. Rotating a phone into a 900px landscape
       therefore lands on the plain desktop grid with no leftovers.
       ═══════════════════════════════════════════════════════════════════ */

    /* motion.js decides which element actually scrolls on this page (<body>
       here, because base.css caps its height) and teaches ScrollTrigger about
       it. Reading its answer rather than guessing keeps these triggers on the
       same scroller as every other trigger on the page. */
    function currentScroller() {
        try {
            if (window.MKMotion && typeof window.MKMotion.scroller === 'function') {
                return window.MKMotion.scroller() || null;
            }
        } catch (e) { }
        return null;
    }

    var mm = null;
    var wiredScroller;

    function wire() {
        if (mm) {
            module('unwire', function () { mm.kill(true); });
            mm = null;
        }
        wiredScroller = currentScroller();

        mm = gsap.matchMedia();
        mm.add(PHONE, function () {
            var downs = [];
            each(qsa(RAIL), function (track) {
                if (track.hasAttribute('data-rail')) return;      /* the work rail is motion.js's */
                var down = module('build rail', function () { return buildRail(track, wiredScroller); });
                if (down) downs.push(down);
            });
            return function () { each(downs, function (down) { down(); }); };
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
       BOOT
       After motion.js. It ships with defer and registers its DOMContentLoaded
       handler while parsing, which is before this file is parsed, so its
       handler — and the scroller wiring inside it — runs first. The extra tick
       is belt and braces for the same ordering.
       ═══════════════════════════════════════════════════════════════════ */

    var booted = false;

    function boot() {
        if (booted) return;
        booted = true;
        module('sync reach', syncReach);
        module('wire', wire);
        module('refresh hook', function () {
            ScrollTrigger.addEventListener('refresh', syncReach);
        });
    }

    function bootSoon() { window.setTimeout(boot, 0); }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        if (document.readyState === 'complete') bootSoon();
        else document.addEventListener('DOMContentLoaded', bootSoon);
    } else {
        document.addEventListener('DOMContentLoaded', bootSoon);
    }

    /* Images and fonts change every measurement on the page, and motion.js may
       re-decide the scroller once they have landed. If it did, the triggers
       built above are pointed at an element that no longer moves — so rebuild
       them rather than leave them frozen at progress 0. */
    window.addEventListener('load', function () {
        boot();
        module('load resync', syncReach);
        if (currentScroller() !== wiredScroller) module('scroller changed', wire);
    });

    window.setTimeout(boot, 3000);

})(window, document);
