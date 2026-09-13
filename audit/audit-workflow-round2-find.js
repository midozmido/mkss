export const meta = {
  name: 'mk-site-audit-round2-find',
  description: 'Round 2 discovery: the 12 finders that did not run in round 1, over the mk portfolio site',
  phases: [
    { title: 'Find', detail: '12 remaining finders: all CSS, all JS, cross-contract, perf/SEO, resilience' },
  ],
}

const SITE = '/home/user/mkss/site'

const ENV = `
WORKING CONTEXT — read carefully before you start.

The site under audit is a static one-page portfolio at:
  ${SITE}
Files: index.html (2124 lines), css/tokens.css, css/base.css, css/layout.css,
css/components.css, css/sections/{a,b,c,d}.css, js/{ui,form,motion,signature,rails}.js.
Total ~8,900 lines. It is served live at http://localhost:8099/index.html

TOOLING
- Playwright is installed globally. Use it with:  export NODE_PATH=/opt/node22/lib/node_modules
  then  node -e "const {chromium}=require('playwright'); ..."
  Chromium is at /opt/pw-browsers. Do NOT run "playwright install".
- Write scratch scripts under /tmp/claude-0/-home-user-mkss/62ba9b9c-0f4f-5dc3-b0ac-bed87a749296/scratchpad/

CRITICAL ENVIRONMENT LIMITATION
The egress proxy BLOCKS cdnjs.cloudflare.com, cdn.jsdelivr.net and fonts.googleapis.com.
So at runtime in this sandbox: window.gsap, ScrollTrigger, SplitText, ScrollToPlugin and
Lenis are ALL undefined, and the webfonts never load.
- Do NOT report "GSAP fails to load" as a bug of the site. That is the sandbox.
- DO report anything that breaks BADLY as a consequence, because a real visitor on a
  slow/blocked/adblocked network hits exactly this state. Graceful degradation is in scope.
- For GSAP-dependent code paths you cannot execute, analyse them STATICALLY and reason
  precisely about the GSAP 3.13+ / ScrollTrigger API contract.

WHAT COUNTS AS A FINDING
A real defect with a concrete failure scenario: wrong behaviour, a crash, an element
left invisible or unreachable, a broken accessible name or ARIA state, a layout that
overflows or overlaps, a responsive break, a keyboard trap, a contract mismatch between
a JS selector and the markup, a performance or SEO defect with real impact, a memory
leak, a listener never removed, a race, an off-by-one, dead code that was meant to run.

NOT a finding: subjective style preferences, "I would have named this differently",
"consider adding tests", speculative refactors, or anything you cannot point at a line for.

RULES
- Every finding MUST carry the real file path (relative to the site root, e.g. "js/ui.js")
  and the real 1-indexed line number. VERIFY the line by reading it before you report.
- Quote enough of the offending code in "detail" that a reviewer can confirm it without
  opening the file.
- "failure" must be concrete: the exact user, device, input or sequence, and what goes wrong.
- "fix" must be a specific, minimal change — name the line and what it becomes.
- Prefer fewer, certain findings over many plausible ones. You are graded on precision.
- Read EVERY line of the files assigned to you. Do not sample.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'path relative to site root, e.g. js/ui.js' },
          line: { type: 'number', description: '1-indexed line number, verified' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string', description: 'short kebab-case slug e.g. correctness, a11y, responsive, perf, seo, resilience, contract, memory-leak' },
          title: { type: 'string', description: 'one compressed line, the claim alone' },
          detail: { type: 'string', description: 'what the code does, with the offending code quoted' },
          failure: { type: 'string', description: 'concrete reproduction: device/input/sequence then the wrong outcome' },
          fix: { type: 'string', description: 'the specific minimal change' },
          evidence: { type: 'string', description: 'how you confirmed it: runtime output, computed style, quoted line' },
        },
        required: ['file', 'line', 'severity', 'category', 'title', 'detail', 'failure', 'fix', 'evidence'],
      },
    },
    coverage: { type: 'string', description: 'what you actually read/ran, and anything you could not check' },
  },
  required: ['findings', 'coverage'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding is wrong, already handled elsewhere, or not reproducible' },
    reason: { type: 'string', description: 'the evidence for your verdict, citing lines you actually read' },
    severityCorrection: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'unchanged'] },
    fixCorrection: { type: 'string', description: 'empty string if the proposed fix is sound, otherwise the corrected fix' },
  },
  required: ['refuted', 'reason', 'severityCorrection', 'fixCorrection'],
}

const FINDERS = [
  {
    key: 'runtime-desktop',
    prompt: `Drive the live page at http://localhost:8099/index.html in Playwright Chromium at 1440x900 and hunt for RUNTIME defects.
Do at least this, and go further where it pays:
- Capture every console error and pageerror, and every failed same-origin request.
- Check the preloader (#mk-preloader): does it ever get dismissed? What are its computed display/opacity/pointer-events after 1s, 3s, 8s? Can the visitor reach content underneath? Click through it?
- Check document.documentElement.className and [data-mk-motion] over time.
- Count [data-anim] elements left at opacity 0 or visibility hidden after load.
- Exercise EVERY interactive control: the burger #navToggle (open AND close), #menuClose, the overlay, every .premium-menu-link, every .filter-btn, every .faq-question, every .project-details-btn, the dialog close, the marquee pause button, the three form steps and submit.
- After each, assert the aria state that should have changed actually changed (aria-expanded, aria-pressed, aria-hidden, aria-current).
- Check document.body.style.overflow is correctly restored after closing menu AND dialog (try opening the dialog from inside the menu, and closing them in the wrong order).
- Look for duplicate element IDs, elements with the same id queried by JS, and detached listeners.
- Measure scrollWidth > clientWidth on documentElement (horizontal overflow) and find the culprit element if so.
Report what actually misbehaves.`,
  },
  {
    key: 'runtime-mobile',
    prompt: `Drive the live page in Playwright Chromium at mobile sizes and hunt for RESPONSIVE and TOUCH defects.
Test at 320x568, 390x844, 414x896 and 768x1024, and also 1024x600 landscape.
- At every width, assert document.documentElement.scrollWidth <= clientWidth. If it overflows, walk the DOM and name the exact element and computed width/margin/padding causing it.
- Find every element whose bounding box extends past the viewport right edge.
- Measure tap-target sizes for every button and link: flag anything under 24x24 CSS px (WCAG 2.5.8) and note which are under 44x44.
- Check the .flick-rail horizontal scrollers: do they actually overflow and scroll at 390px? Is the hidden scrollbar reachable by keyboard (tabindex)? Does tabbing into a card strand focus off-screen?
- Check the fullscreen menu at 320px: are all 8 links reachable without the panel clipping or the body scrolling behind it?
- Check the navbar: does the logo + CTA + burger fit at 320px without overlap? Measure their boxes.
- Check the contact form at 320px: do the two-column .grid--2 fields collapse? Any input wider than its container?
- Check text: any element with computed font-size below 12px? Any line clipped by overflow:hidden?
- Screenshot each width to /tmp/claude-0/-home-user-mkss/62ba9b9c-0f4f-5dc3-b0ac-bed87a749296/scratchpad/ and LOOK at them with the Read tool — report visual breakage you can see.`,
  },
  {
    key: 'runtime-a11y',
    prompt: `Audit the live page for ACCESSIBILITY defects, at runtime, in Playwright Chromium at 1440x900 and 390x844.
- Walk the full keyboard tab order from the top. List every focusable element in order. Flag: focus traps, elements focusable while visually hidden (the closed menu, hidden form steps, hidden project cards after filtering), tab stops that scroll nothing, and any control with no visible focus indicator (compute outline/box-shadow on :focus-visible).
- Verify the accessible name of every button, link and form control. Flag empty or unhelpful names.
- Verify heading order: extract every h1..h6 in DOM order and flag skipped ranks and multiple h1s.
- Verify ARIA: every aria-controls points at an existing id; every aria-labelledby/aria-describedby target exists; role=dialog has a working aria-modal and label; aria-expanded/aria-pressed are present AND updated.
- Compute actual colour contrast ratios for body text, muted text, badges, chips, buttons and placeholder/hint text against their real computed backgrounds. Flag anything under 4.5:1 for normal text and 3:1 for large text and UI borders. Report the measured ratio and the two hex colours.
- Test prefers-reduced-motion: reduce — reload with that emulated and check nothing is left invisible, the marquee stops, and the page is fully readable.
- Test with JavaScript disabled entirely: reload and check the preloader is gone, the marquee is paused, all content is visible, and the form degrades honestly.
- Check the skip link: does it exist, become visible on focus, and actually move focus to #main?`,
  },
  {
    key: 'html-structure',
    prompt: `Read index.html at ${SITE}/index.html LINE BY LINE, all 2124 lines. Audit HTML correctness and semantics.
Hunt specifically for: duplicate id attributes; ids referenced by JS or aria that do not exist; invalid element nesting (interactive inside interactive, block inside a paragraph, a div inside a list outside a list item); unclosed or mis-nested tags; heading-rank jumps; images missing alt/width/height or with width/height that do not match the real intrinsic aspect ratio (check the actual files with a quick script); an anchor used where a button belongs and vice versa; target="_blank" without rel="noopener"; form controls with no associated label; fieldset/legend misuse; aria-hidden on a focusable ancestor; role misuse; the JSON-LD block's validity and whether its claims match the visible page.
Also verify the four stylesheet load-order comments against the actual order, and that every src/href to a local asset resolves to a file that exists on disk.
Verify each line number you report by reading it.`,
  },
  {
    key: 'css-foundation',
    prompt: `Read these files LINE BY LINE and audit them: ${SITE}/css/tokens.css (339 lines), ${SITE}/css/base.css (451), ${SITE}/css/layout.css (326).
Hunt for: custom properties referenced but never defined (grep every var usage and check the property exists); tokens defined but never used; invalid property values; cascade bugs where a later rule silently loses or wins by accident; the [data-anim] flash-guard in base.css — trace EXACTLY which selector hides content, what removes it, and what happens if that never runs; focus-visible handling; box-sizing coverage; overflow and height rules on html/body and which element is actually the scrollport; z-index stacking with no context established; fixed/sticky elements that can escape their container; container/measure widths that can exceed the viewport; any use of vh that breaks on mobile browser chrome.
Cross-check every custom property used in these three files against the definitions in tokens.css and report any that resolve to nothing.
Verify each line number you report.`,
  },
  {
    key: 'css-components',
    prompt: `Read ${SITE}/css/components.css LINE BY LINE, all 1633 lines, and audit it.
Hunt for: duplicate selectors that silently override each other; undefined custom properties (cross-check against ${SITE}/css/tokens.css); properties that do nothing because of a missing prerequisite (transition on a non-animatable property, position-dependent offsets with position static); buttons/inputs missing focus styles; hover-only affordances with no keyboard equivalent; hardcoded colours that escape the token palette (the file's own comments claim a strict violet/teal palette — find every hex that is not in tokens.css); text that can overflow its box; fixed heights that will clip translated content; contrast-critical pairs.
Also check every class this file styles actually appears in ${SITE}/index.html, and flag substantial dead rules.
Verify each line number you report.`,
  },
  {
    key: 'css-sections',
    prompt: `Read these LINE BY LINE and audit them: ${SITE}/css/sections/a.css (188), b.css (92), c.css (422), d.css (418).
These carry the hero, marquee, signature scene, work rail, timeline and the .flick-rail responsive system.
Hunt for: media-query boundary bugs (a rule that applies in both branches or neither — pay very close attention to the 900px / 899.98px boundary that js/rails.js mirrors); animation/transition that never stops; prefers-reduced-motion blocks that miss an animation defined elsewhere; scroll-snap combined with programmatic scrolling; position sticky or fixed inside a transformed ancestor (which silently breaks it); overflow hidden that clips a focus ring or a pinned element; the .signature__veil guard — what shows it, what hides it, and every path where it could stay hidden; marquee animation with no paused state for reduced motion; undefined custom properties.
Cross-check the 900px breakpoint in d.css against the PHONE media query string in ${SITE}/js/rails.js and report any mismatch.
Verify each line number you report.`,
  },
  {
    key: 'js-ui',
    prompt: `Read ${SITE}/js/ui.js LINE BY LINE, all 415 lines, and audit it. Also read the markup it drives in ${SITE}/index.html.
Trace each of its seven modules: menu, anchors, scroll-spy, chrome, filter, faq, project dialog.
Hunt for: selectors that match nothing in the markup; listeners added and never removed; the focus trap (does it handle the case of zero focusable elements, elements hidden by CSS but still matched, and shift+tab from outside?); body.style.overflow being stomped when two overlays interact (open the menu, then the dialog, then close in either order — walk the code and say what body overflow ends up as); the dialog missing a focus trap entirely (the menu has one — does the dialog?); scroll-spy correctness at the top and bottom of the page; the filter hiding cards while they remain focusable or while the rail's scroll width is stale; the FAQ accordion's aria wiring; history.replaceState on every anchor click; the deep-link landing logic and its 6-second window; the raf() helper swallowing errors silently.
Be exact about which line each defect is on.`,
  },
  {
    key: 'js-motion-a',
    prompt: `Read ${SITE}/js/motion.js LINE BY LINE. Audit LINES 1 THROUGH 760 in depth (read the rest for context only).
This covers the boot sequence, the scroller decision, Lenis wiring, the preloader, and the reveal system.
Hunt hard for: what happens when gsap / ScrollTrigger / SplitText / ScrollToPlugin / Lenis are UNDEFINED (a blocked CDN, an adblocker, a slow network) — trace every early return and say exactly what state the page is left in, especially the preloader and the [data-anim] flash guard; the preloader dismissal path and whether it is guaranteed to run (the markup comment claims "within one second whatever the network does" — prove or disprove it); double-registration of plugins; ScrollTrigger instances created without being killed; requestAnimationFrame loops that never stop; the scroller decision and whether it can pick the wrong element mid-load; reduced-motion handling; listeners on window/document never removed; any path where a [data-anim] element can be left at opacity 0 forever.
IMPORTANT known runtime fact to reason from: in a sandbox with the CDN blocked, after load the page shows an empty html className and a data-mk-motion attribute of "on" and 0 of 61 [data-anim] elements hidden, BUT #mk-preloader has computed display flex and opacity 1 and is still covering the page. Find the exact lines that cause that and whether it is a real defect for a real visitor.
Verify every line number.`,
  },
  {
    key: 'js-motion-b',
    prompt: `Read ${SITE}/js/motion.js LINE BY LINE. Audit LINES 760 THROUGH 1471 in depth (read the rest for context only).
This covers the hero timeline, the custom cursor, parallax, the pinned work rail, the marquee and its pause button.
Hunt hard for: the custom cursor (is it removed on a coarse pointer? does it leak a listener? does it cover content or steal pointer events?); parallax layers whose data-parallax is set at runtime and whether that can fight the CSS; the pinned rail — pin-spacer maths, what happens when the filter changes the rail width, whether ScrollTrigger.refresh() is called at the right moment, and whether the rail can trap vertical scrolling; the marquee pause button built with innerHTML around line 1257 — is the SVG string safe and is the aria-label correct for the content? (the markup calls it "the scrolling text", the JS calls it "the technology marquee" — is that an accessible-name mismatch, and does the JS label survive?); any animation that keeps running when the section is off-screen; memory growth over a long session; duplicated ScrollTrigger ids; and again, every path that can leave an element invisible.
Verify every line number.`,
  },
  {
    key: 'js-signature',
    prompt: `Read ${SITE}/js/signature.js LINE BY LINE, all 542 lines, and audit it. Read the matching markup (index.html section 12b, the .signature block) and ${SITE}/css/sections/c.css.
This drives a pinned, scrubbed scene with SplitText.
Hunt for: the .signature__veil guard — enumerate EVERY code path, and find any where the veil is never lifted (SplitText missing, GSAP missing, the element missing, an exception thrown before the lift, reduced motion, a resize during setup). If any exists, the heading and the logo are invisible forever: that is critical.
Also: SplitText revert/cleanup on resize (leaked DOM nodes and lost text), whether the split text keeps its accessible name after splitting, pin and clip-path interaction, scrub timeline correctness, whether the scene can leave the mark at opacity 0 when scrolled past quickly, and reduced-motion behaviour.
Verify every line number.`,
  },
  {
    key: 'js-rails',
    prompt: `Read ${SITE}/js/rails.js LINE BY LINE, all 342 lines, and audit it. Read ${SITE}/css/sections/d.css and the .flick-rail markup in index.html.
Hunt for: the PHONE media-query string vs the actual 900px breakpoint in d.css — confirm they truly match at fractional widths; the tabindex add/remove logic and whether it can leave a dead tab stop or remove an author-supplied tabindex it did not add; the hand-over detection (HAND_TOLERANCE, SNAP_GRACE) and whether a normal vertical page swipe on a phone can falsely trigger or falsely fail to trigger it; teardown completeness on matchMedia revert; the 3-second setTimeout boot backstop firing after a teardown; whether it can fight motion.js over the same element; what happens when window.MKMotion is absent; and the interaction between scroll-snap and programmatic scrollLeft.
Verify every line number.`,
  },
  {
    key: 'js-form',
    prompt: `Read ${SITE}/js/form.js LINE BY LINE, all 152 lines, and audit it. Read the form markup in index.html (the #contactForm section).
Hunt for: validation gaps (is the email regex adequate? is the phone validated at all? is whitespace-only input caught?); the multi-step show and validate contract — can a visitor reach step 3 and submit with step 1 or 2 invalid, by pressing Enter, by submitting from step 1, or by tabbing into a hidden step?; the submit handler validating only the current step rather than all steps — prove whether that is exploitable and what a half-filled WhatsApp message would look like; focus management between steps; the success panel replacing the form while the form's data is still needed by the reopen link; whether hiding the form leaves focusable content in the tab order; the WhatsApp URL length limit and what happens with a very long details value; encodeURIComponent coverage; the isTouch detection and popup-blocked fallback; and whether the error messages are announced by a live region when the error box is populated.
Also test it live at http://localhost:8099/index.html in Playwright: fill and submit, and check what actually happens.
Verify every line number.`,
  },
  {
    key: 'cross-contract',
    prompt: `This is a CONTRACT audit. The site's JS files address the markup by string selectors, and the CSS styles classes the JS toggles. Find every place where those three drift apart.
Mechanically, at ${SITE}:
1. Extract EVERY selector string used in all five js files (querySelector, querySelectorAll, getElementById, closest, matches, classList add/remove/toggle, getAttribute/setAttribute names, dataset keys).
2. For each, check whether it matches anything in index.html. Report every JS hook that matches NOTHING — that is dead code or a typo, and the feature it belongs to is silently broken.
3. Extract every class the JS ADDS at runtime (is-open, is-active, is-done, has-error, scrolled, is-scrubbing, menu-open, and any others) and check each one is actually styled in the CSS. A state class with no style is a feature that appears to work in JS and does nothing on screen.
4. Extract every class used in index.html and check it is styled somewhere. Report substantial unstyled classes.
5. Check the markup comments that document JS hooks (they are extensive — "JS hooks owned by this section", "spelled exactly") against reality, and report every documented hook that no longer matches.
6. Check every aria-controls, aria-labelledby, aria-describedby, label for, and href="#..." target id resolves.
Write a script to do this properly rather than eyeballing it. Report concrete mismatches with file and line for BOTH sides.`,
  },
  {
    key: 'perf-seo',
    prompt: `Audit performance and SEO for ${SITE}, with measurements not guesses.
Performance:
- Measure every image's real intrinsic dimensions and byte size (use a script) and compare against the width/height attributes and the CSS display size. Flag every image shipped far larger than it renders, every wrong aspect ratio, every missing loading/decoding hint where it matters, and the total image payload.
- Identify render-blocking resources: 8 separate stylesheets in the head plus a Google Fonts stylesheet. Quantify the request cost and the critical path. Check whether any CSS is unused.
- Check the LCP candidate and whether it is lazy-loaded or preloaded (a lazy-loaded or unpreloaded LCP image is a real defect).
- Check for layout-shift sources: images or embeds without reserved space, webfont swap without size-adjust, content injected by JS above the fold.
- Check the 5 deferred CDN scripts: total bytes, and what the page costs if they are slow.
SEO:
- Validate the JSON-LD against schema.org: required properties, wrong types, claims not backed by the page.
- Check canonical, og and twitter meta for correctness and consistency with the real deployed URL (https://profile.mk-wp.site/), and whether the og:image declared dimensions match the real file.
- Check title and meta description lengths against what Google actually renders.
- Check heading structure for SEO, internal anchor quality, and whether the page declares lang correctly.
- Check for a missing robots directive, sitemap reference, or favicon set problem.
Report each with file and line.`,
  },
  {
    key: 'resilience',
    prompt: `Audit RESILIENCE and DEGRADATION for the site at ${SITE}. This is about what a real visitor sees when something does not go perfectly. Test what you can live in Playwright at http://localhost:8099/index.html and analyse the rest statically.
Scenarios to drive out concretely:
1. The CDN is blocked or slow (adblocker, corporate proxy, China, flaky mobile). GSAP/ScrollTrigger/SplitText/Lenis never arrive. What EXACTLY does the visitor see? Walk every guard in js/motion.js, js/signature.js and js/rails.js. Is the preloader dismissed? Is the signature section readable? Is anything left invisible or covering the page? This is the sandbox's real state — measure it, screenshot it, and LOOK at the screenshot with Read.
2. GSAP arrives but SplitText does not (a partial CDN failure). Simulate by stubbing a minimal window.gsap and ScrollTrigger and leaving SplitText undefined, then report.
3. JavaScript is disabled entirely. Check the noscript block actually covers everything it needs to.
4. prefers-reduced-motion reduce.
5. A very slow network where scripts land after the visitor has already scrolled.
6. Fonts fail (they do here) — is there a real fallback stack, or does it fall to a default that breaks the layout? Measure.
For each scenario, report specific defects with the exact file and line of the guard that is missing or wrong. A page that can be left permanently covered or permanently blank is CRITICAL.`,
  },
]

const DONE = new Set(['runtime-desktop', 'runtime-mobile', 'runtime-a11y', 'html-structure'])
const REMAINING = FINDERS.filter(f => !DONE.has(f.key))

phase('Find')
log(`Round 2 — ${REMAINING.length} finders left (${DONE.size} already done in round 1)`)

const rounds = await parallel(REMAINING.map(f => () =>
  agent(ENV + '\n\nYOUR ASSIGNMENT:\n' + f.prompt, {
    label: `find:${f.key}`,
    phase: 'Find',
    schema: FINDINGS_SCHEMA,
  }).then(r => ({ key: f.key, r }))
))

const alive = rounds.filter(Boolean).filter(x => x.r)
const dead = REMAINING.length - alive.length
if (dead > 0) log(`WARNING: ${dead} finder(s) returned nothing — coverage is incomplete`)

const raw = alive.flatMap(x => (x.r.findings || []).map(f => ({ ...f, finder: x.key })))
log(`${raw.length} new raw findings from ${alive.length} finders`)

return {
  findings: raw,
  coverage: alive.map(x => ({ finder: x.key, coverage: x.r.coverage })),
  finderFailures: dead,
  findersRun: alive.map(x => x.key),
}
