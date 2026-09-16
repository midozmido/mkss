/* ============================================================================
   timeline.js — the horizontal history

   Seven years on one track, read left to right, driven by one scrubbed
   timeline so the whole section answers the hand on the wheel.

   ── WHY ONE MASTER TIMELINE AND NOT SEVEN TRIGGERS ──────────────────────────
   The stops sit in a horizontal row, which means all seven share the same
   vertical position on the page. Giving each its own ScrollTrigger would fire
   all seven at the same instant — the opposite of the sequence this section is
   for. So there is a single scrubbed timeline, and each stop's beats are
   placed at the moment the travel actually brings that stop to the middle of
   the scroller. The arrival point is measured from geometry, not guessed, so
   the rhythm holds whether the track is 1,600px wide or 3,000px.

   ── THE ORDER OF A STOP ─────────────────────────────────────────────────────
   The YEAR lands first and settles. Its sentence follows a beat later. Then
   the highlighter wipes across that sentence, left to right, the way a hand
   with a marker would. 2026 is last, gets the longest arrival of the seven and
   one extra beat of light on the year, because it is what the run is aiming at.

   ── PACING ──────────────────────────────────────────────────────────────────
   Desktop pins the section and spends a fixed amount of scroll per stop, so
   seven years take the same comfortable number of wheel turns on a laptop as
   on a large display. Below 900px there is no pin — a pin on a phone is how a
   scroll becomes a fight — and the same timeline is scrubbed across the
   section's own pass through the viewport instead.

   ── THE RESTING STATE IS THE FINISHED STATE ─────────────────────────────────
   Nothing here is hidden in CSS. With GSAP missing or under reduced motion the
   section is a legible horizontal history, fully drawn highlighters and all,
   not a row of blanks waiting for a script.

   While the script IS running the from-state is written at build time, far
   below the fold, and the run begins at 'top 75%' — before the track has
   reached the screen. So the years are never seen sitting blank, and they
   never pop from drawn to hidden either, which is what deferring the render
   would have traded for.
   ========================================================================== */

(function (window, document) {
    'use strict';

    var SCRUBBING = 'is-scrubbing';

    /* How far the track may differ from the value this file last wrote before
       the movement is credited to the visitor. Covers scrollLeft read-back
       rounding and nothing else. */
    var HAND_TOLERANCE = 10;

    /* Snap is handed back the instant the scrub stops owning the track, and the
       browser then settles onto a snap port. Positions read inside this window
       after a hand-back are re-read, not read as a swipe. */
    var SNAP_GRACE = 600;

    /* The scroll range is bought in CSS: css/motion-ambient.css §13 makes the
       section tall and sticks its container to the top, so the years hold still
       while the page scrolls past them. Nothing is pinned by ScrollTrigger —
       position: sticky does it without a pin-spacer, and it cannot fight the
       Work section's pin further up the page. */

    function qs(sel, ctx) {
        try { return (ctx || document).querySelector(sel); } catch (e) { return null; }
    }
    function qsa(sel, ctx) {
        try { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
        catch (e) { return []; }
    }
    function module(name, fn) {
        try { return fn(); } catch (err) {
            if (window.console && console.warn) console.warn('[mk-timeline] ' + name + ':', err);
            return null;
        }
    }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function docTop(el) {
        return el.getBoundingClientRect().top + (window.pageYOffset || 0);
    }

    if (typeof gsap === 'undefined' || !gsap || !gsap.core) return;
    if (typeof ScrollTrigger === 'undefined' || !ScrollTrigger) return;

    var rail = qs('[data-timeline]');
    var track = rail ? qs('[data-tl-track]', rail) : null;
    if (!rail || !track) return;

    /* The trigger is the SECTION, not the rail. The rail is the sticky thing —
       it stays where it is while the page moves, so its own top and bottom are
       the same scroll position and a range measured on it is zero long. The
       scroll this sequence spends belongs to the tall section around it. */
    var section = rail.closest ? (rail.closest('section') || rail) : rail;
    if (section === rail) return;

    /* The element CSS sticks to the top of the screen. Everything about when
       the run may start and must be over is measured off this. */
    var holder = rail.closest ? rail.closest('.container') : null;
    if (!holder) return;

    var stops = qsa('[data-tl-stop]', track);
    if (!stops.length) return;

    function travel() {
        return Math.max(0, Math.round(track.scrollWidth - track.clientWidth));
    }

    /* Where in the travel this stop reaches the middle of the scroller, as a
       fraction of the whole. The first stops clamp to 0 and the last to 1,
       which is correct: they are already at the middle when the run starts and
       ends. */
    function arrivalOf(stop, d) {
        if (!d) return 0;
        var target = stop.offsetLeft - (track.clientWidth - stop.offsetWidth) / 2;
        return clamp(target / d, 0, 1);
    }

    var mm = gsap.matchMedia();

    /* ── where a stop has to be for it to sit in the middle ────────────────
       The track carries half a stop's worth of padding at each end, so every
       stop — the first and the last included — can reach the centre. That
       makes these targets an even ladder, 0 to 1, and the march below spends
       the same scroll on every year. Measured rather than assumed, so a change
       to the track's shape cannot silently break the spacing. */
    function targetOf(stop, d) {
        if (!d) return 0;
        return clamp((stop.offsetLeft - (track.clientWidth - stop.offsetWidth) / 2) / d, 0, 1);
    }

    /* ── one stop's turn ───────────────────────────────────────────────────
       The track moves and settles, THEN the year lands, THEN its sentence,
       THEN the highlight wipes across that sentence. That order is the whole
       point: one scroll brings the year, the next fills it in. The track
       holding still while a year is being read is what keeps it readable —
       a continuous slide would mean every sentence is animating and moving at
       the same time. */
    function addStop(tl, stop, i, at, slot, progress, target, apply) {
        var year = qs('[data-tl-year]', stop);
        var card = qs('[data-tl-card]', stop);
        var mark = qs('[data-tl-mark]', stop);
        var isLast = i === stops.length - 1;
        var lead = 0.30;

        if (i === 0) {
            /* Nothing to travel to: the first stop is already in the middle
               when the track is at rest, so its turn starts straight away. */
            lead = 0;
        } else {
            /* The year being left behind steps back. Two lit years on screen
               at once means neither is the one being read, and the outgoing
               one meets the track's edge faded rather than sliced. */
            tl.to(stops[i - 1], {
                autoAlpha: 0.16,
                duration: slot * 0.45,
                ease: 'power1.inOut'
            }, at + slot * 0.1);

            tl.to(progress, {
                p: target,
                duration: slot * 0.5,
                ease: 'power2.inOut',
                onUpdate: apply
            }, at);
        }

        if (year) {
            tl.fromTo(year,
                { autoAlpha: 0, y: 40, scale: isLast ? 0.76 : 0.9 },
                {
                    autoAlpha: 1, y: 0, scale: 1,
                    duration: slot * (isLast ? 0.5 : 0.38),
                    ease: 'expo.out'
                },
                at + slot * lead);
        }

        if (card) {
            tl.fromTo(card,
                { autoAlpha: 0, y: 28 },
                { autoAlpha: 1, y: 0, duration: slot * 0.36, ease: 'expo.out' },
                at + slot * (lead + 0.18));
        }

        if (mark) {
            /* background-size, not a width: the highlight follows the text
               across every wrapped line rather than drawing one rectangle
               behind the block. */
            tl.fromTo(mark,
                { backgroundSize: '0% 100%' },
                { backgroundSize: '100% 100%', duration: slot * 0.38, ease: 'power2.inOut' },
                at + slot * (lead + 0.32));
        }

        if (isLast && year) {
            /* 2026 is what the run is aiming at. One extra beat of light on the
               year once it has landed, so arriving reads as arriving. */
            tl.fromTo(year,
                { filter: 'drop-shadow(0 0 0 rgba(45, 212, 191, 0))' },
                {
                    filter: 'drop-shadow(0 0 30px rgba(45, 212, 191, .65))',
                    duration: slot * 0.62, ease: 'power2.out'
                },
                at + slot * (lead + 0.38));
        }
    }

    /* ── the whole section, one scrubbed timeline ───────────────────────── */
    function build() {
        var d = travel();
        if (d < 40) return null;

        var live = true;
        var written = track.scrollLeft;
        var scrubbing = false;
        var grace = 0;
        var progress = { p: 0 };

        function setScrubbing(on) {
            if (on === scrubbing) return;
            scrubbing = on;
            if (on) track.classList.add(SCRUBBING);
            else { track.classList.remove(SCRUBBING); grace = Date.now() + SNAP_GRACE; }
        }

        function apply() {
            if (!live) return;
            var now = travel();
            if (now < 40) return;
            var t = Math.round(progress.p * now);
            if (Math.abs(t - track.scrollLeft) > 1) {
                setScrubbing(true);
                track.scrollLeft = t;
            }
            written = track.scrollLeft;
        }

        /* The run starts while the track is still below the fold — at 75% the
           only part of the section on screen is its heading — so the years are
           never seen sitting in their from-state. */
        function startAt() {
            return Math.round(docTop(section) - window.innerHeight * 0.75);
        }

        /* And it must be over BEFORE the sticky holder lets go, or the last
           years and the light on 2026 play while the section is already
           sliding off the top of the screen. The release point is measured,
           not assumed: where the holder's bottom meets the section's content
           box is the last scroll position at which it is still stuck. The run
           finishes half a screen short of that, so a lit, still 2026 is held
           on screen while the page finishes with the section. */
        function endAt() {
            var cs = getComputedStyle(section);
            var stick = parseFloat(getComputedStyle(holder).insetBlockStart) || 0;
            var release = docTop(section) + section.offsetHeight
                - (parseFloat(cs.paddingBottom) || 0)
                - holder.offsetHeight - stick;
            return Math.max(startAt() + window.innerHeight,
                Math.round(release - window.innerHeight * 0.5));
        }

        var st = {
            trigger: section,
            start: startAt,
            end: endAt,
            scrub: 0.8,
            invalidateOnRefresh: true,
            onToggle: function (self) { if (!self.isActive) setScrubbing(false); }
        };

        var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: st });

        /* Equal scroll per year, at every width. Seven slots across the
           section's pass: on a 900px-tall viewport that is a little under half
           a screen of scroll per year, which is two or three turns of a wheel
           and one comfortable thumb stroke. */
        var slot = 1 / stops.length;
        stops.forEach(function (stop, i) {
            addStop(tl, stop, i, i * slot, slot, progress, targetOf(stop, d), apply);
        });

        function handOver() {
            if (!live) return;
            live = false;
            setScrubbing(false);
            detach();
        }

        function onScroll() {
            if (!live) return;
            if (Date.now() < grace) { written = track.scrollLeft; return; }
            if (Math.abs(track.scrollLeft - written) > HAND_TOLERANCE) handOver();
        }

        function attach() {
            track.addEventListener('scroll', onScroll, { passive: true });
            /* Tabbing into a stop makes the browser scroll it into view; a
               scrub that then dragged it back would strand the focus ring. */
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
            module('kill', function () {
                if (tl.scrollTrigger) tl.scrollTrigger.kill();
                tl.kill();
            });
            module('clear', function () {
                gsap.set(qsa('[data-tl-stop], [data-tl-year], [data-tl-card]', track),
                    { clearProps: 'transform,opacity,visibility,filter' });
                gsap.set(qsa('[data-tl-mark]', track), { clearProps: 'backgroundSize' });
            });
        };
    }

    /* Arrival points are measured, so a width change invalidates them. The
       matchMedia queries only rerun when a breakpoint is crossed, which is not
       often enough — this rebuilds after the resize settles. */
    /* Tells css/motion-ambient.css §13 to buy the scroll range this run needs.
       Set from inside the lifecycle and removed again on teardown, so under
       reduced motion — where matchMedia never runs this — the section stays the
       ordinary height it is without a script. */
    function flag(on) {
        module('flag', function () {
            if (on) document.documentElement.setAttribute('data-mk-timeline', 'on');
            else document.documentElement.removeAttribute('data-mk-timeline');
        });
    }

    function lifecycle() {
        flag(true);
        var down = module('build', build);
        var timer = 0;
        var lastW = window.innerWidth;

        function onResize() {
            if (window.innerWidth === lastW) return;   /* mobile URL-bar height */
            lastW = window.innerWidth;
            window.clearTimeout(timer);
            timer = window.setTimeout(function () {
                if (down) down();
                down = module('rebuild', build);
                module('refresh', function () { ScrollTrigger.refresh(); });
            }, 220);
        }
        window.addEventListener('resize', onResize, { passive: true });

        return function () {
            window.clearTimeout(timer);
            window.removeEventListener('resize', onResize);
            if (down) down();
            flag(false);
        };
    }

    function boot() {
        /* Every width, not desktop only. The sequence IS the section — a phone
           that got the plain row would get a different section, and the ask was
           for the same run at every responsive size. There is no pin to fight
           a thumb with, and the visitor can still take the track by hand at any
           moment and keep it. */
        mm.add('(prefers-reduced-motion: no-preference)', lifecycle);

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
