/* ============================================================================
   cards.js — the card choreography

   Every card group on the page (stats, expertise, services, process,
   testimonials) arrives as the visitor scrolls into it, and the cards do NOT
   all do the same thing: they alternate. Odd cards rise from below, even cards
   drop from above, and they cross in the middle of the row. Each one is tied to
   its own ScrollTrigger, so the movement is driven by the scroll position
   rather than played once on a timer.

   ── WHAT THIS FILE WILL AND WILL NOT DO ─────────────────────────────────────
   · It never pins. A pin is what turns a scroll into a trap, and the visitor
     must always be able to keep going.
   · It never touches the horizontal rail below 900px — css/sections/d.css and
     js/rails.js own that, and from this file's point of view the phone layout
     is the sticky deck in css/motion-ambient.css §8.
   · It runs ONLY at 900px and up, through gsap.matchMedia, so rotating a phone
     into landscape reverts everything it built.
   · With gsap or ScrollTrigger missing it returns immediately and the CSS
     fallback in css/motion-ambient.css §9 plays the same gesture on its own.

   Loaded after js/motion.js, and it claims nothing motion.js claims: the
   containers carry data-anim="stagger", which motion.js reads, so this file
   takes that attribute OFF the ones it drives to stop the two systems
   animating the same nodes.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var GROUP = '.flick-rail';
    var ITEM = '.flick-rail__item';

    function qsa(sel, ctx) {
        try { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
        catch (e) { return []; }
    }

    function module(name, fn) {
        try { return fn(); } catch (err) {
            if (window.console && console.warn) console.warn('[mk-cards] ' + name + ':', err);
            return null;
        }
    }

    if (typeof gsap === 'undefined' || !gsap || !gsap.core) return;
    if (typeof ScrollTrigger === 'undefined' || !ScrollTrigger) return;

    /* The signal css/motion-ambient.css reads to stand its own fallback down.
       Set here rather than in motion.js because this is the file that actually
       drives the cards. */
    try { document.documentElement.setAttribute('data-mk-cards', 'on'); } catch (e) { }

    /* One card. Odd indexes rise, even indexes drop — they pass each other on
       the way in, which is what makes the row read as a movement rather than a
       list fading up. The distance is generous because the gesture has to be
       legible at a glance; the rotation is small because a card that tumbles
       reads as a gimmick. */
    function buildCard(el, i) {
        var down = (i % 2) === 1;

        gsap.set(el, { willChange: 'transform, opacity' });

        var tween = gsap.fromTo(el,
            {
                autoAlpha: 0,
                y: down ? -110 : 110,
                rotateX: down ? -8 : 8,
                scale: 0.94
            },
            {
                autoAlpha: 1,
                y: 0,
                rotateX: 0,
                scale: 1,
                duration: 1,
                ease: 'expo.out',
                scrollTrigger: {
                    trigger: el,
                    /* Starts while the card is still below the fold and finishes
                       before it reaches the middle, so the movement is over by
                       the time the visitor is reading it. */
                    start: 'top 92%',
                    end: 'top 55%',
                    scrub: 0.6,
                    invalidateOnRefresh: true
                },
                onComplete: function () { gsap.set(el, { willChange: 'auto' }); }
            });

        return tween;
    }

    /* A little perspective on the container is what makes rotateX read as depth
       rather than a squash. Set in JS, not CSS, so it exists only while this
       file is actually driving the cards. */
    function buildGroup(group) {
        var items = qsa(ITEM, group).filter(function (el) {
            return el.parentElement === group;
        });
        if (items.length < 2) return null;

        gsap.set(group, { perspective: 1200 });

        /* motion.js animates [data-anim] containers with its stagger effect.
           Two systems on the same nodes fight and one of them loses, leaving
           cards stuck mid-state — so the attribute comes off the groups this
           file owns. It is restored on teardown. */
        var hadAnim = group.getAttribute('data-anim');
        if (hadAnim) group.removeAttribute('data-anim');

        var tweens = items.map(function (el, i) {
            return module('card ' + i, function () { return buildCard(el, i); });
        }).filter(Boolean);

        return function teardown() {
            tweens.forEach(function (t) {
                module('kill', function () {
                    if (t.scrollTrigger) t.scrollTrigger.kill();
                    t.kill();
                });
            });
            module('clear', function () {
                gsap.set(items, { clearProps: 'transform,opacity,visibility,willChange' });
                gsap.set(group, { clearProps: 'perspective' });
            });
            if (hadAnim) group.setAttribute('data-anim', hadAnim);
        };
    }

    /* 900px and up only: below that the cards are the horizontal rail, and on
       a phone this file's layout is the sticky deck in the stylesheet. */
    var mm = gsap.matchMedia();

    function boot() {
        mm.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', function () {
            var downs = qsa(GROUP)
                .map(function (g) { return module('group', function () { return buildGroup(g); }); })
                .filter(Boolean);

            return function () { downs.forEach(function (d) { d(); }); };
        });

        /* The groups sit below several pinned and lazily-measured blocks, so the
           positions they were built against are stale until everything above
           them has settled. */
        module('refresh', function () {
            window.addEventListener('load', function () {
                window.setTimeout(function () { ScrollTrigger.refresh(); }, 120);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { window.setTimeout(boot, 0); });
    } else {
        window.setTimeout(boot, 0);
    }

})(window, document);
