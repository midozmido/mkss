/* ============================================================================
   testimonials.js — the client feedback run

   The quotes travel right to left as the section passes through the viewport.
   It is the same idea as the Work rail but deliberately NOT the same mechanism:

     · No pin. The Work section earns a pin because it is the portfolio and the
       visitor is there to look. Pinning a second time, one section later, turns
       the page into a sequence of things that stop you — so this one moves
       while the page keeps scrolling normally underneath it.

     · It scrubs the track's own scrollLeft rather than transforming it. The
       track is a real overflow-x scroller with snap points, so the visitor can
       take it by hand at any moment; the first time they do, the scrub gets out
       of the way for good and the row is theirs.

   gsap or ScrollTrigger missing → this file returns at once and the row is the
   native swipeable scroller it already is in CSS. Below 900px the same: a thumb
   is the right instrument for sideways and it needs no help.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var SCRUBBING = 'is-scrubbing';

    /* How far the track may differ from the value this file last wrote before
       the movement is credited to the visitor. Covers sub-pixel rounding on
       scrollLeft read-back and nothing else. */
    var HAND_TOLERANCE = 10;

    /* Snap is handed back the instant the scrub stops owning the track, and the
       browser then settles the row onto a snap port. Positions inside this
       window after a hand-back are re-read, not read as a swipe. */
    var SNAP_GRACE = 600;

    function qs(sel, ctx) {
        try { return (ctx || document).querySelector(sel); } catch (e) { return null; }
    }

    function module(name, fn) {
        try { return fn(); } catch (err) {
            if (window.console && console.warn) console.warn('[mk-quotes] ' + name + ':', err);
            return null;
        }
    }

    if (typeof gsap === 'undefined' || !gsap || !gsap.core) return;
    if (typeof ScrollTrigger === 'undefined' || !ScrollTrigger) return;

    var rail = qs('[data-quote-rail]');
    var track = rail ? qs('[data-quote-track]', rail) : null;
    if (!rail || !track) return;

    function travel() {
        return Math.max(0, Math.round(track.scrollWidth - track.clientWidth));
    }

    var mm = gsap.matchMedia();

    function build() {
        /* Nothing to travel: three quotes on a wide screen already fit. The row
           then stays exactly what it is, and no trigger is created. */
        if (travel() < 40) return null;

        var live = true;
        var written = track.scrollLeft;
        var scrubbing = false;
        var grace = 0;
        var progress = { p: 0 };

        function setScrubbing(on) {
            if (on === scrubbing) return;
            scrubbing = on;
            if (on) {
                track.classList.add(SCRUBBING);
            } else {
                track.classList.remove(SCRUBBING);
                grace = Date.now() + SNAP_GRACE;
            }
        }

        function apply() {
            if (!live) return;
            var d = travel();
            if (d < 40) return;
            var target = Math.round(progress.p * d);
            if (Math.abs(target - track.scrollLeft) > 1) {
                setScrubbing(true);
                track.scrollLeft = target;
            }
            written = track.scrollLeft;
        }

        /* The window is the whole time the section is on screen, less a tenth of
           the viewport at each end so the first and last quote are readable at
           rest. Linear: an eased scrub reads as lag against the wheel. */
        var tl = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: {
                trigger: rail,
                start: 'top 88%',
                end: 'bottom 12%',
                scrub: 0.7,
                invalidateOnRefresh: true,
                onToggle: function (self) { if (!self.isActive) setScrubbing(false); }
            }
        });
        tl.to(progress, { p: 1, onUpdate: apply });

        /* The hand takes over. Detected from the track's own scroll position,
           never from a pointer event: on a phone every vertical page swipe that
           starts on top of the row fires pointerdown here, and killing the scrub
           for that would kill it for almost everybody. */
        function handOver() {
            if (!live) return;
            live = false;
            setScrubbing(false);
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
            /* Tabbing to a link inside a quote makes the browser scroll it into
               view; a scrub that then dragged it back would strand the focus
               ring off-screen. */
            track.addEventListener('focusin', handOver, { passive: true });
        }

        function detach() {
            track.removeEventListener('scroll', onScroll);
            track.removeEventListener('focusin', handOver);
        }

        attach();

        return function teardown() {
            live = false;
            setScrubbing(false);
            detach();
            module('teardown', function () {
                if (tl.scrollTrigger) tl.scrollTrigger.kill();
                tl.kill();
            });
        };
    }

    function boot() {
        mm.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', function () {
            var down = module('build', build);
            return function () { if (down) down(); };
        });

        module('refresh', function () {
            window.addEventListener('load', function () {
                window.setTimeout(function () { ScrollTrigger.refresh(); }, 160);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { window.setTimeout(boot, 0); });
    } else {
        window.setTimeout(boot, 0);
    }

})(window, document);
