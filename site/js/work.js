/* ============================================================================
   work.js — the Selected Work journey

   One pinned section, one horizontal travel, one closing mark.

   The visitor scrolls down, the section takes hold, and the eight builds move
   across the screen from right to left. The travel ends on the studio mark,
   which ignites as it arrives and then dissolves into a soft blur as the
   section lets go and the page carries on.

   ── WHY THIS FILE AND NOT js/motion.js ──────────────────────────────────────
   motion.js has its own initRail() for [data-rail]. Two pins on one element is
   not a thing that degrades gracefully — the second one measures against a
   scrollport the first is already moving — so this file takes the attribute
   off before motion.js can claim it, and owns the section outright.

   ── THE RULES THIS IS BUILT AROUND ──────────────────────────────────────────
   1. The pin never traps. It lasts exactly the horizontal distance plus the
      outro, and the visitor's scroll always keeps moving the page.
   2. Desktop only, through gsap.matchMedia at 900px. Below that the rail is a
      native swipeable row with snap — a pin on a phone is how a scroll becomes
      a fight, and the thumb is already the right instrument for sideways.
   3. prefers-reduced-motion gets the plain row, not a scrubbed pin.
   4. gsap or ScrollTrigger missing: this file returns at once, the rail stays
      the native swipeable row it is in CSS, and the mark's own CSS animation
      in css/motion-ambient.css §10 plays instead.
   ========================================================================== */

(function (window, document) {
    'use strict';

    function qs(sel, ctx) {
        try { return (ctx || document).querySelector(sel); } catch (e) { return null; }
    }

    function module(name, fn) {
        try { return fn(); } catch (err) {
            if (window.console && console.warn) console.warn('[mk-work] ' + name + ':', err);
            return null;
        }
    }

    if (typeof gsap === 'undefined' || !gsap || !gsap.core) return;
    if (typeof ScrollTrigger === 'undefined' || !ScrollTrigger) return;

    var rail = qs('[data-rail]');
    var track = rail ? qs('[data-rail-track]', rail) : null;
    var mark = qs('[data-work-mark]');
    var outro = qs('[data-work-outro]');
    if (!rail || !track) return;

    /* Claimed before motion.js's DOMContentLoaded handler can reach initRail().
       Both files ship with defer and this one is last in the document, so its
       handler is registered last — but the attribute comes off immediately, at
       parse time, which is earlier than any handler runs. */
    rail.removeAttribute('data-rail');

    /* Tells css/motion-ambient.css §10 to stand its own mark animation down. */
    try { document.documentElement.setAttribute('data-mk-work', 'on'); } catch (e) { }

    function distance() {
        return Math.max(0, Math.round(track.scrollWidth - (rail.clientWidth || window.innerWidth)));
    }

    var mm = gsap.matchMedia();

    function build() {
        if (!distance()) return null;

        /* The horizontal travel. Linear by contract: an eased scrub reads as
           lag against the hand on the wheel. */
        var tl = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: {
                trigger: rail,
                start: 'top top',
                /* The travel, plus a quarter-viewport of room at the end for
                   the mark to ignite and dissolve in. Function form so a resize
                   re-measures instead of keeping a stale number. */
                end: function () { return '+=' + (distance() + window.innerHeight * 0.75); },
                pin: true,
                anticipatePin: 1,
                scrub: 0.8,
                invalidateOnRefresh: true
            }
        });

        /* 0 → 75% of the pinned range: the builds travel. */
        tl.to(track, {
            x: function () { return -distance(); },
            duration: 0.75
        });

        if (mark) {
            /* 75 → 88%: the mark ignites. It arrives already on screen — it is
               the last panel of the track — so this lifts it out of the row
               rather than introducing it. */
            tl.fromTo(mark,
                { filter: 'drop-shadow(0 0 4px rgba(168,85,247,0.15)) blur(0px)', scale: 0.92, autoAlpha: 0.55 },
                { filter: 'drop-shadow(0 0 48px rgba(168,85,247,0.95)) blur(0px)', scale: 1, autoAlpha: 1, duration: 0.13 },
                0.75);

            /* 88 → 100%: it dissolves. Blur and fade together, never blur
               alone — a blurred-but-opaque logo reads as a rendering fault.
               The scale keeps rising a little so it feels like it is receding
               into light rather than being switched off. */
            tl.to(mark,
                { filter: 'drop-shadow(0 0 64px rgba(45,212,191,0.6)) blur(18px)', scale: 1.08, autoAlpha: 0, duration: 0.12 },
                0.88);
        }

        if (outro) {
            /* The line and the call to action follow the mark out, a beat
               later, so the panel leaves as one thing. */
            var rest = Array.prototype.slice.call(outro.children).filter(function (el) {
                return el !== mark;
            });
            if (rest.length) {
                tl.fromTo(rest,
                    { autoAlpha: 0, y: 24 },
                    { autoAlpha: 1, y: 0, duration: 0.1, stagger: 0.02 },
                    0.78);
                tl.to(rest, { autoAlpha: 0, y: -16, duration: 0.1 }, 0.9);
            }
        }

        return function teardown() {
            module('kill', function () {
                if (tl.scrollTrigger) tl.scrollTrigger.kill();
                tl.kill();
            });
            module('clear', function () {
                gsap.set(track, { clearProps: 'transform' });
                if (mark) gsap.set(mark, { clearProps: 'filter,transform,opacity,visibility' });
                if (outro) gsap.set(outro.children, { clearProps: 'transform,opacity,visibility' });
            });
        };
    }

    function boot() {
        mm.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', function () {
            var down = module('build', build);
            return function () { if (down) down(); };
        });

        /* The section sits well down the page, under blocks whose height is not
           final until images and fonts have landed. */
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
