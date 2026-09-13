# نتائج الفحص — مرشّحة، لسه ما اتحققش منها

> **مهم:** الـ 24 نتيجة دي طلعت من مرحلة *الاكتشاف* بس. مرحلة **التحقق العدائي ما اشتغلتش** — الفحص اتوقف قبلها. يعني كل نتيجة هنا **مرشّحة**، ممكن تكون صح وممكن تكون غلط، ولازم تتأكد قبل ما تتصلّح.

المصدر: 32 نتيجة خام من 4 عملاء، اندمجت لـ 24 نتيجة فريدة.

## 🔴 حرجة (2)

### `js/form.js:128` — window.open(url,'_blank','noopener') always returns null, so the fallback navigates the site away on every desktop submit

- **النوع:** correctness  
- **اكتشفه:** runtime-desktop

**التفاصيل:** js/form.js:126-130:

    function openWhatsApp(url) {
      if (isTouch) { location.href = url; return; }
      var w = window.open(url, '_blank', 'noopener');
      if (!w) location.href = url;       /* popup blocked — go there directly */
    }

Passing `noopener` inside the *features* string (third argument) makes `window.open` return **null by specification** — the HTML standard's window-open steps say that when the tokenized features contain `noopener`, the return value is null even though the window opened successfully. So `w` is null on every successful desktop open, `!w` is always true, and line 129 runs unconditionally: the current tab is navigated to wa.me as well. The code's own comment at lines 121-123 states the intent it defeats: "On a desktop, open a new tab so the site stays where the visitor left it." The success panel written immediately before (lines 141-146: `form.hidden = true; success.hidden = false; success.classList.add('is-active')`) and the `#formReopen` link set at line 140 — the file's stated safety net for "whose browser blocked it" — are painted and then destroyed by that same navigation.

**سيناريو الفشل:** A desktop visitor (any non-touch pointer, so every laptop and desktop) completes the three-step enquiry form and presses Submit. Two things happen at once: a new tab opens on wa.me, AND the portfolio tab they were reading is itself replaced by wa.me. They lose the site, get a duplicate WhatsApp window, and never see the "WhatsApp is open, press Send" panel or the reopen button — the only instructions telling them WhatsApp does not send by itself. Reproduced in Chromium 1440x900: after form.requestSubmit(), the main frame navigated away (framenavigated → wa.me) and a second page was created (NEWPAGE → wa.me); document.getElementById('contactForm') afterwards returned false, i.e. the site's DOM was gone.

**الدليل:** Direct in-page probe in Chromium: `window.open(u,'_blank','noopener')` → returned "null"; `window.open(u,'_blank')` → returned "object". Full submit run with wa.me routed to abort: MAIN NAV -> chrome-error (the aborted wa.me navigation of the main frame) plus POPUPS OPENED ["NEWPAGE http://localhost:8099/index.html", "NEWPAGE chrome-error"], and a post-submit evaluate showed `contactForm = false`.

**الإصلاح المقترح:** Line 128: drop the features string and set the opener-severing on the handle instead — `var w = window.open(url, '_blank'); if (w) { w.opener = null; } else { location.href = url; }`. That keeps the real popup-blocked fallback working (a blocked open genuinely returns null) without firing it on every success.

---

### `js/motion.js:122` — GSAP guard returns before the preloader is ever dismissed, leaving an opaque full-screen overlay forever

- **النوع:** resilience  
- **اكتشفه:** runtime-desktop, runtime-mobile, runtime-a11y, html-structure (**4 عملاء مستقلين**)

**التفاصيل:** Line 122 is the very first guard in motion.js:

    if (typeof gsap === 'undefined' || !gsap || !gsap.core) { showAll(); return; }

`showAll()` only does `root.classList.remove('js')` + `root.setAttribute('data-mk-motion','on')` (lines 89-96) — it reveals the `[data-anim]` elements and nothing else. The preloader is dismissed exclusively inside `runPreloader()` (js/motion.js:615-691), which is defined ~490 lines BELOW this `return` and is therefore never reached. The overlay it was supposed to remove is `index.html:108` `<div class="mk-preloader" id="mk-preloader" data-preloader aria-hidden="true">`, styled at `css/components.css:1356` with `position: fixed; inset: 0; z-index: var(--z-preloader); background-color: var(--ink)` — an opaque sheet over the entire viewport. The `<noscript>` escape hatch at index.html:70 (`.mk-preloader{display:none}`) only fires when scripting is OFF; it does nothing in this state, where JS runs fine and only the CDN is unreachable. index.html:106 even promises the opposite: "dismisses the overlay within one second whatever the network does".

**سيناريو الفشل:** A visitor on any network where cdnjs.cloudflare.com is unreachable — a corporate proxy, an adblocker/uBlock list that blocks CDN script hosts, a captive portal, China, or a transient CDN outage — loads the page and sees a black screen with "0" and an empty progress bar, permanently. Measured in Chromium at 1440x900 with the CDN blocked: at t=1s, t=3s and t=8s the computed style of #mk-preloader is identical — display:flex, opacity:1, visibility:visible, pointer-events:auto, z-index:1000, rect 0,0,1440x900. document.elementFromPoint at (720,60), (100,100) and (1300,850) all return #mk-preloader. A Playwright click on #navToggle times out after 2.5s with "<div id='mk-preloader'> intercepts pointer events". The whole site — nav, work, the contact form — is unreachable by mouse, touch and click, and the same happens under prefers-reduced-motion.

**الدليل:** Playwright Chromium 1440x900 against http://localhost:8099/index.html with cdnjs/jsdelivr blocked. requestfailed for all four GSAP files and Lenis. Snapshots at 1s/3s/8s: {display:"flex", opacity:"1", pointerEvents:"auto", visibility:"visible", zIndex:"1000", inlineStyle:null}; preRect {x:0,y:0,width:1440,height:900}. elementFromPoint at four viewport corners/centres all return DIV#mk-preloader. page.click('#navToggle') → TimeoutError, "#mk-preloader intercepts pointer events". Under reducedMotion:'reduce' at t=3s: {preDisp:"flex", preOp:"1", preVis:"visible"}.

**الإصلاح المقترح:** Dismiss the overlay on the failure path before returning. Change line 122 to hide the preloader first, e.g.: `if (typeof gsap === 'undefined' || !gsap || !gsap.core) { var pre = qs('#mk-preloader') || qs('[data-preloader]'); if (pre) { pre.style.display = 'none'; } showAll(); return; }` — and apply the same to the `if (!HAS.ST)` return at line 148. A belt-and-braces alternative is a CSS/inline fallback that hides .mk-preloader after ~2s unless a class such as `data-mk-motion="loading"` is present.

---

## 🟠 عالية (12)

### `css/components.css:1255` — Transitioning `visibility` makes the menu's closeBtn.focus() a silent no-op, so focus never enters the aria-modal panel

- **النوع:** a11y  
- **اكتشفه:** runtime-desktop

**التفاصيل:** css/components.css:1247-1256:

    .premium-menu {
      visibility: hidden;
      opacity: 0;
      transition:
        opacity var(--dur-fast) var(--ease-out),
        visibility var(--dur-fast) var(--ease-out);   /* line 1255 */
    }

Because `visibility` is in the transition list with a 0.36s eased timing, the computed visibility of the panel — and of everything inside it, including `#menuClose` — is still `hidden` at the moment js/ui.js:95 runs:

      document.body.classList.add('menu-open');
      if (closeBtn) closeBtn.focus();      /* ui.js:95 */

An element with computed `visibility: hidden` is not focusable, so `.focus()` throws nothing and does nothing. Focus stays wherever it was. That in turn disables the focus trap at ui.js:117-129, which only intercepts Tab when `document.activeElement === first` or `=== last` of the menu's focusables — with focus outside the menu entirely, neither branch matches and Tab/Shift+Tab are never prevented. The panel carries `role="dialog" aria-modal="true"` (`.premium-menu-content`) and nothing behind it is `inert` or `aria-hidden`.

**سيناريو الفشل:** A keyboard or screen-reader visitor opens the site menu (mouse click or Enter on the burger). Focus remains on #navToggle, which is painted UNDERNEATH the panel (navbar z-index 300 vs .premium-menu 500), so there is no visible focus ring and no dialog boundary is announced. Pressing Shift+Tab then walks straight out of the supposedly modal dialog into the page behind it: measured sequence is `A.btn btn--outline navbar__cta` → `A.navbar__brand` → `A.skip-link`, all obscured by the overlay. Nothing tells the user they have left the menu.

**الدليل:** A/B proof in Chromium 1440x900. As shipped, synchronously after open(): {visSyncAfterOpen:"hidden", activeAfterOpen:"BODY#"}; an immediate second `closeBtn.focus()` also left activeElement on BODY; at +600ms visibility became "visible" and focus() then succeeded (BUTTON#menuClose). With only the transition changed to `visibility 0s linear .36s` / `visibility 0s` on .is-open: {visSyncAfterOpen:"visible", activeAfterOpen:"BUTTON#menuClose"}. Real mouse click on #navToggle: active stayed BUTTON#navToggle at t+50ms and t+650ms. Shift+Tab x3 from there produced navbar__cta → navbar__brand → skip-link, with inMenu=false throughout; #main had aria-hidden=null and inert=false.

**الإصلاح المقترح:** Line 1254-1255: make visibility flip instantly on open and only delay on close — `transition: opacity var(--dur-fast) var(--ease-out), visibility 0s linear var(--dur-fast);` on `.premium-menu`, plus `transition: opacity var(--dur-fast) var(--ease-out), visibility 0s;` on `.premium-menu.is-open` (components.css:1258). (Separately, ui.js:95 should still be treated as fallible.)

---

### `css/components.css:899` — Work rail is overflow:hidden from 900px, stranding 6 of 8 project cards

- **النوع:** responsive  
- **اكتشفه:** runtime-mobile, runtime-a11y (**2 عملاء مستقلين**)

**التفاصيل:** `@media (min-width: 900px) { .rail, .mk-rail { overflow: hidden; scroll-snap-type: none; } }` turns the project rail from a real scroller into a clipped box, on the assumption that js/motion.js will pin it and scrub `scrollLeft`. That scrub is GSAP/ScrollTrigger-only (js/motion.js:122 and :148 both `return` before any rail is built), so when GSAP does not load there is no scroll mechanism left at all: not touch-drag, not wheel, not a scrollbar, and the element carries no `tabindex` either.

**سيناريو الفشل:** On a 1024x600 landscape tablet with an ad-blocker that blocks cdnjs, scroll to #work. The rail measures `scrollWidth 2817 / clientWidth 956`, box x=34..990. Card 1 (Sakhaa Program) and card 2 (SL Smarts) are visible; cards 3-8 sit at left=743, 1097, 1452, 1806, 2161 and 2515 — entirely outside the clip. A 600px horizontal `mouse.wheel` over the rail leaves `scrollLeft` at 0. Six of the eight portfolio pieces — Sharik, Dr Mohamed Osama, Laft, Dremora, Rehal, London Royal Academy — can never be seen or clicked. The identical page at 390x844 works (overflow-x:auto; the same wheel moves scrollLeft to 656).

**الدليل:** Runtime 1024x600: {"ovf":"hidden","tabindex":null,"scrollLeft":0,"scrollW":2817,"clientW":956,"railBox":{"l":34,"r":990},"trackTransform":"none"} and cards 3-8 all `fullyVisible:false`; `after horizontal wheel scrollLeft = 0`. Same probe at 390x844: `ovfX:"auto"`, `after horizontal wheel scrollLeft = 656`.

**الإصلاح المقترح:** Change line 899 from `overflow: hidden;` to `overflow-x: auto; overflow-y: hidden;` so the rail keeps a native scroll axis at every width, and let the pinned scrub write `scrollLeft` on a container that the visitor can also move by hand — the same contract css/sections/d.css already uses for `.flick-rail`.

---

### `css/components.css:1329` — Menu close button collapses to 44x22px whenever the menu panel overflows

- **النوع:** touch  
- **اكتشفه:** runtime-mobile

**التفاصيل:** .premium-menu-close declares `inline-size: var(--size-touch); block-size: var(--size-touch);` (44px) but it is a flex item of `.premium-menu-content { display: flex; flex-direction: column; overflow-y: auto; }` (line 1272-1288) which sets no `align-items`/`flex-shrink`. As soon as the panel's content is taller than the viewport, the default `flex-shrink: 1` squashes the button: its computed `block-size` becomes `22px`, exactly half the declared 44px. The nav links and footer below it absorb the rest.

**سيناريو الفشل:** Open the menu on an iPhone SE (320x568): the panel's content is 735px against a 568px box, so the X button renders 44x22 CSS px. Same at 360x640 (735 vs 640), at 667x375 — any phone held in landscape (749 vs 375) — and at 1024x600 (766 vs 600). 22px is below the 24x24 CSS px floor of WCAG 2.5.8 Target Size (Minimum), and it is the primary close affordance. At 390x844 / 414x896 / 768x1024 / 1280x800 the content fits and the same button measures the correct 44x44 — so the control silently halves in height on exactly the smallest and shortest screens.

**الدليل:** Runtime measurement of `.premium-menu-close.getBoundingClientRect()` with the menu open: 320x568 -> {w:44,h:22,panelOverflows:true,sh:735,ch:568}; 360x640 -> {w:44,h:22,sh:735,ch:640}; 667x375 -> {w:44,h:22,sh:749,ch:375}; 1024x600 -> {w:44,h:22,sh:766,ch:600}; 390x844 -> {w:44,h:44,panelOverflows:false}; 1280x800 -> {w:44,h:44}. Computed `blockSize` reads "22px" and `flexShrink` reads "1".

**الإصلاح المقترح:** Add `flex-shrink: 0;` to the `.premium-menu-close` rule (alongside line 1329) so the declared 44x44 hit area survives an overflowing panel.

---

### `css/components.css:553` — All 7 FAQ questions have no visible focus indicator — the ring is clipped away

- **النوع:** a11y  
- **اكتشفه:** runtime-a11y

**التفاصيل:** `.faq-item { ... overflow: hidden; }` (line 553). The `.faq-question` button inside it is `inline-size: 100%` (line 566) with the item carrying no padding, so the button fills the item's padding box exactly. The global focus style is `:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }` (css/base.css:321-325) = a 2px teal outline drawn 3px OUTSIDE the button on all four sides — entirely outside `.faq-item`'s clip rectangle. `overflow:hidden` therefore erases the whole ring. Nothing else changes on focus: `.faq-question:hover` (line 578) only fires on hover.

**سيناريو الفشل:** At 1440x900, Tab from the "Message on WhatsApp" button into the FAQ. The button receives focus and matches `:focus-visible`, but the screen shows no change at all across all seven questions. A sighted keyboard user loses their place completely in a seven-item list and cannot tell which question Enter will open. WCAG 2.4.7 failure.

**الدليل:** Runtime, focus reached by real `page.keyboard.press('Tab')` from the preceding control: `activeElement.matches(':focus-visible') === true`, computed `outline = "rgb(45, 212, 191) solid 2px"`, `outline-offset = "3px"`; geometry `.faq-item` x=268..1172, `.faq-question` x=269..1171, `.faq-item` overflow=hidden. Clipped screenshot of the focused question shows no teal ring anywhere; the identical capture of a focused `.pill-filter` (not inside an overflow:hidden box) shows the ring clearly.

**الإصلاح المقترح:** Delete `overflow: hidden;` at css/components.css:553 — the clipping the accordion actually needs is already on `.faq-answer-content` (line 605). If the rounded corner clip must stay, use `overflow: clip; overflow-clip-margin: 6px;` instead.

---

### `css/sections/c.css:80` — Portfolio filter hides nothing: .project-card.rail__item ties with [hidden][hidden] and wins on source order

- **النوع:** correctness  
- **اكتشفه:** runtime-desktop

**التفاصيل:** js/ui.js:316 filters by setting the property: `card.hidden = !show;`. base.css:383 is the defence written for exactly that:

    [hidden][hidden] {   /* specificity (0,2,0) */
      display: none;
    }

with a comment claiming it "outranks any single class". But css/sections/c.css:80-84 declares:

    .project-card.rail__item {   /* also (0,2,0) */
      display: flex;
      flex-direction: column;
      block-size: auto;
    }

Two classes on one element is the same specificity as two attribute selectors, so the tie is broken by source order — and index.html loads base.css at line 49 but css/sections/c.css at line 54, so c.css wins. Every card carries both classes (index.html:1066: `class="card card--flush project-card rail__item"`), so `hidden` cards keep `display: flex`. The `[hidden][hidden]` rule was written against `.project-card { display: block }` (components.css:918, one class) and was never updated when c.css added the second class. The form steps are unaffected — `.form-step` is a single class, so they hide correctly.

**سيناريو الفشل:** A visitor clicks the "Government" pill in the work section expecting one project. All eight cards stay on screen: measured after the click, seven cards have hidden=true yet computed display "flex", visibility "visible", opacity "1" and a rect of 336x546. Only aria-pressed on the pills changes, so the control looks like it fired and did nothing — and a screen-reader or keyboard user is worse off, because the 13 links and buttons inside those seven `hidden` cards are still in the tab order: tabbing forward from the Government pill reaches "SL Smarts", "Sharik" and "Dr Mohamed Osama" (all hidden=true) while the pill announces Government as pressed.

**الدليل:** Playwright at 1440x900, after clicking the data-filter="government" pill: per-card readout showed 7 cards {hiddenAttr:true, display:"flex", vis:"visible", op:"1", w:336, h:546} alongside the 1 matching card. A tab sweep starting from the Government pill landed on `A.btn btn--quiet project-link [card=SL Smarts hidden=true]`, then Sharik, then Dr Mohamed Osama. Confirmed the same for every pill: `hiddenButPainted` was 5, 6, 7, 7 and 7 for corporate/marketplace/government/education/healthcare.

**الإصلاح المقترح:** Raise the hide rule above any two-class component rule. Either change base.css:383 to `[hidden][hidden][hidden] { display: none !important; }`, or — minimally and locally — scope the exception at css/sections/c.css:80 to `.project-card.rail__item:not([hidden]) { display: flex; ... }` so a hidden card falls back to the [hidden][hidden] rule.

---

### `css/sections/c.css:81` — Project filter hides nothing — [hidden][hidden] loses the cascade to .project-card.rail__item

- **النوع:** correctness  
- **اكتشفه:** runtime-a11y

**التفاصيل:** js/ui.js:316 filters with `card.hidden = !show`, relying on base.css:383 `[hidden][hidden] { display: none; }` (specificity 0-2-0). css/sections/c.css:80-84 declares `.project-card.rail__item { display: flex; flex-direction: column; block-size: auto; }` — also specificity 0-2-0, and sections/c.css is the 7th stylesheet while base.css is the 2nd (index.html:49 vs 54). Equal specificity, later source wins, so every filtered-out card keeps `display:flex`. base.css:377-382 even documents the intended mechanism ("A single [hidden] ties on specificity with a class and loses on source order") — the doubling was not enough once a two-class selector was added in c.css.

**سيناريو الفشل:** At 1440x900, click the "Government" filter pill. `aria-pressed` flips to "true" on Government and "false" on All, but all eight project cards stay on screen, keep `display:flex`, stay in the tab order and stay in the accessibility tree. A screen-reader or keyboard user is told the list is now filtered to one sector and then walks through all eight "Visit the site" / "Project brief" controls, seven of which belong to sectors they just filtered out. Identical at 390x844.

**الدليل:** Runtime after programmatically clicking the government filter: every one of the eight `.project-card` elements reports `hidden=true` (except Sakhaa) yet `getComputedStyle().display === "flex"` and `getBoundingClientRect()` 336x546. `page.accessibility.snapshot()` still lists `link: Visit the site: SL Smarts`, `link: Visit the site: Sharik`, `heading: SL Smarts`. Focusing `.project-card[1] .project-link` succeeds and reports `card hidden=true`. Screenshot shows all four visible cards unchanged.

**الإصلاح المقترح:** Change the selector at css/sections/c.css:80 from `.project-card.rail__item` to `.project-card.rail__item:not([hidden])`, so the rule stops matching hidden cards and base.css's `[hidden][hidden]{display:none}` is the only display declaration left for them.

---

### `css/sections/d.css:166` — Footer logo is stretched out of aspect ratio by flex align-items:stretch

- **النوع:** responsive  
- **اكتشفه:** runtime-mobile

**التفاصيل:** .footer__logo { block-size: var(--size-tile-lg); inline-size: auto; } sits inside `.footer__col { display: flex; flex-direction: column; gap: var(--space-lg); }` (line 134-138), which declares no `align-items`. On a column flex container the cross axis is horizontal, so the default `stretch` resolves `inline-size: auto` to the full column width instead of to the intrinsic width. Combined with the fixed 56px `block-size`, the 512x135 PNG is rendered at a completely different ratio. The markup compounds it: `<img class="footer__logo" ... width="160" height="56">` (index.html:2006-2007) declares a 160:56 ratio for a file whose real ratio is 512:135.

**سيناريو الفشل:** Open the footer on any device. The brand mark renders 280x56 at 320px wide (should be 212.4x56), 350x56 at 390px, and 462.5x56 at 1024px — horizontally stretched by 1.32x, 1.65x and 2.18x respectively, and getting worse the wider the screen. The distortion is visible against the identical logo in the navbar, which renders correctly at 121.4x32 (ratio 3.79 = 512/135) because it is not a stretched flex item.

**الدليل:** Runtime: parentDisplay "flex", parentFlexDir "column", parentAlignItems "normal"; computedWidth "280px"/"350px"/"462.547px" at 320/390/1024 against natural 512x135 (correctWidthForH56 = 212.4). Setting `img.style.alignSelf='flex-start'` changed the box to 212.4x56 at all three widths. Navbar copy of the same file: 121.4x32.

**الإصلاح المقترح:** Add `align-self: flex-start;` to the `.footer__logo` rule (beside line 166); verified at runtime to restore 212.4x56 at every width. Also correct the markup attributes at index.html:2007 to `width="212" height="56"` so the reserved box matches the real ratio.

---

### `index.html:306` — The marquee's WCAG 2.2.2 pause control is inside the container's fade mask, rendering at 7–35% opacity, and ships empty

- **النوع:** a11y  
- **اكتشفه:** runtime-a11y, runtime-desktop, html-structure (**3 عملاء مستقلين**)

**التفاصيل:** `<button class="mk-marquee-pause" type="button" data-marquee-toggle aria-pressed="false" aria-label="Pause the scrolling text"></button>` is a child of `.marquee-container`, which carries `mask-image: var(--grad-fade-x)` / `-webkit-mask-image` (css/components.css:1034-1035), where `--grad-fade-x` is `linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)` (css/tokens.css:79). A CSS mask applies to the element's whole rendered subtree, so the button is faded with everything else. `.mk-marquee-pause { inset-inline-end: var(--space-sm) }` (css/components.css:1103) parks it in the final 5% of the masked box. The element also has no content of its own — the glyph is injected by js/motion.js:1257-1259, which never runs when GSAP is absent.

**سيناريو الفشل:** On the live page the only in-page control for the 40s infinite `mk-marquee` animation (css/components.css:1050) is drawn at roughly 7–35% alpha over a near-black strip: a user with low vision or on a bright screen simply cannot see it, and a sighted user does not know a pause control exists. In the CDN-blocked state it is additionally a dead control: `innerHTML.length === 0` (no glyph at all) and clicking it changes nothing, so the page moves text automatically for more than five seconds with no working stop — WCAG 2.2.2 failure.

**الدليل:** Runtime measurement at 1440x900: `.marquee-container` x=47.94 width=1344.13; `.mk-marquee-pause` x=1336.06 width=44 → the button spans 95.8%–99.1% of the masked box, where the gradient interpolates from alpha 1.0 at 88% to 0 at 100% (alpha ≈ 0.35 at its left edge, ≈ 0.07 at its right). Clipped screenshot of that region shows only a barely-perceptible circle outline. Also measured: `btn.innerHTML.length === 0`, `btn.textContent === ""`, and clicking it left `getComputedStyle('.marquee-content').animationPlayState === "running"` before and after, with `aria-pressed` still "false".

**الإصلاح المقترح:** Move the `<button class="mk-marquee-pause">` element at index.html:306-307 out of `<div class="marquee-container">` and make it the next sibling, then add `position: relative` to that sibling's wrapper (`.stack.stack--xl`) so the button's existing absolute positioning still resolves. It then sits outside the masked box at full opacity.

---

### `index.html:2090` — </main> closes after </footer>, so the site footer exposes no contentinfo landmark

- **النوع:** a11y  
- **اكتشفه:** html-structure

**التفاصيل:** `<main id="main">` opens at index.html:186. `<footer class="section section--ink site-footer" id="footer" aria-labelledby="footer-title">` opens at line 1993 and closes at line 2088; `</main>` is only at line 2090. The whole page footer is therefore a descendant of `<main>`. Per HTML-AAM a `footer` nested inside `main` does not map to `contentinfo` — Chromium gives it the generic `sectionfooter` role — and the `aria-labelledby="footer-title"` pointing at the visually-hidden `<h2 id="footer-title">Site footer</h2>` (line 1994) is discarded with it. It also means the copyright line, the two footer `<nav>`s, the payment badges and the social links are all announced as part of the document's main content.

**سيناريو الفشل:** A screen-reader user on the page opens the landmarks rotor (VoiceOver VO+U → Landmarks, or NVDA's D key). They get "banner" and "main" but no "content information" landmark, so there is no way to jump to the footer; and skipping past `main` skips the entire page including its footer. Keyboard users relying on landmark navigation have to tab through all 8 project cards and the 3-step contact form to reach the footer links.

**الدليل:** Playwright on the live page: `page.getByRole('contentinfo').count()` === 0 while `getByRole('banner')` === 1 and `getByRole('main')` === 1. Moving the node in the live DOM (`main.parentNode.insertBefore(footer, main.nextSibling)`) flips the count to 1. Control page `<main><footer id=a>in main</footer></main><footer id=b>outside</footer>` gives an accessibility snapshot of role `sectionfooter` for the nested one and role `contentinfo` for the sibling.

**الإصلاح المقترح:** Move the `</main>` tag: delete it from line 2090 and insert `</main>` on its own line immediately before line 1993 (`<footer class="section section--ink site-footer" id="footer" ...>`), so the footer is a sibling of main, not a child.

---

### `index.html:2007` — Footer logo declares width=160 height=56 for a 512x135 file and ships visibly stretched

- **النوع:** correctness  
- **اكتشفه:** html-structure

**التفاصيل:** Line 2006-2007: `<img class="footer__logo" src="assets/images/logo-gradient.png" alt="MK, the studio mark of Mohamed Khaled" width="160" height="56">`. The file on disk is 512x135 (ratio 3.793); the declared 160/56 is ratio 2.857. The same file is declared correctly as 512x135 at line 121 (navbar) and line 1509 (signature). On top of that, css/sections/d.css:164-167 sets `.footer__logo { block-size: var(--size-tile-lg); inline-size: auto; }` and its parent `.footer__col` is `display:flex; flex-direction:column` with the initial `align-items: normal` (= stretch), so `inline-size:auto` is stretched to the whole column instead of resolving from the intrinsic ratio. With `object-fit: fill` (the default) the mark is drawn at 359.86x56 = ratio 6.426 against a true 3.793 — 69% too wide.

**سيناريو الفشل:** Every visitor who scrolls to the footer at a desktop width sees the brand mark horizontally squashed: the "MK" monogram and the "wordpress developer" wordmark are stretched to nearly double their correct width, while the identical logo in the navbar 2000px above renders correctly. Additionally, before the image bytes arrive the UA reserves a box from the attribute ratio (aspect-ratio computes to `auto 160 / 56`), so the footer column also reflows when the image lands.

**الدليل:** PNG header read from disk: assets/images/logo-gradient.png = 512x135. In Chromium after load: `.footer__logo` naturalWidth 512, naturalHeight 135, getBoundingClientRect {w:359.859375, h:56} (ratio 6.426), computed width 359.859px === parent `.footer__col` width 359.859px, computed `aspect-ratio: auto 160 / 56`, `object-fit: fill`, parent computed `display:flex; flex-direction:column; align-items:normal`. Same measurement for `.navbar__logo` gives 121.4x32 (ratio 3.792) and `.signature__mark` 307.2x81 (ratio 3.793). Element screenshots of the footer and navbar logos side by side show the footer copy visibly wider per glyph.

**الإصلاح المقترح:** Two one-line changes. index.html:2007 — replace `width="160" height="56"` with `width="512" height="135"` so the reserved box matches the file. css/sections/d.css:164-167 — add `align-self: flex-start;` to the `.footer__logo` rule so `inline-size: auto` resolves from the intrinsic ratio (212.4px) instead of being stretched by the flex column.

---

### `js/ui.js:169` — Skip link moves the scroll but never moves focus, so it skips nothing

- **النوع:** a11y  
- **اكتشفه:** runtime-a11y

**التفاصيل:** The delegated anchor handler catches every `a[href^="#"]` — including `<a class="skip-link" href="#main">` (index.html:103) — and calls `e.preventDefault();` at js/ui.js:169 before doing its own `goTo(target)` scroll. Cancelling the default fragment navigation also cancels the browser's update of the sequential focus navigation starting point, and the handler never calls `target.focus()`. `<main id="main">` (index.html:186) carries no `tabindex="-1"`, so it is not focusable either. WCAG 2.4.1 requires the bypass mechanism to actually move the point of regard.

**سيناريو الفشل:** A keyboard or screen-reader user presses Tab once, the skip link appears, they press Enter. Focus stays on the skip link (`document.activeElement` is still `A.skip-link`), the URL becomes `#main`, and the next Tab lands on `a.navbar__brand` — the navbar, i.e. exactly the chrome they asked to skip. They must then tab through the brand, the CTA and the menu trigger again on every page entry.

**الدليل:** Runtime with JS enabled: after Tab+Enter, `document.activeElement` = `A.skip-link`, `location.hash` = `#main`, next Tab → `A.navbar__brand` (outside #main). The same sequence in a `javaScriptEnabled:false` context lands on `A.btn btn--primary btn--lg` with `closest('#main')` truthy — proving the native behaviour works and that js/ui.js:169's preventDefault is what breaks it.

**الإصلاح المقترح:** At js/ui.js:173, inside the existing `setTimeout(function () { goTo(target); }, ...)`, also move focus: `target.setAttribute('tabindex','-1'); target.focus({preventScroll:true});`

---

### `js/ui.js:396` — Project brief dialog declares aria-modal but has no focus trap and leaves the page behind it reachable

- **النوع:** a11y  
- **اكتشفه:** runtime-a11y, runtime-desktop (**2 عملاء مستقلين**)

**التفاصيل:** `initProjectDialog` binds only `document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.classList.contains('is-open')) close(); });` at js/ui.js:396-398. There is no Tab handling, nothing sets `inert` or `aria-hidden` on the rest of the document, and `#projectDialog` (index.html:1254) is `role="dialog" aria-modal="true"`. The sibling `initMenu` does implement a trap (js/ui.js:120-128); the dialog was never given one.

**سيناريو الفشل:** Open any project brief (e.g. "Project brief: Sakhaa Program"). Focus lands on the close button; Tab once reaches "Visit the site"; Tab again leaves the dialog entirely and lands on the testimonials rail container, then the contact form's first radio, then "Continue to scope", then the FAQ questions — all of which sit behind an `rgba(6,5,11,.82)` scrim at `z-index:500`. A keyboard user is now moving an invisible focus ring around content they cannot see, with no way back into the dialog except Escape, and `document.body.style.overflow='hidden'` means the page cannot even scroll to follow the focus.

**الدليل:** Runtime at 1440x900: after clicking `.project-details-btn[0]`, `document.activeElement` = `BUTTON.dialog__close`; successive Tab presses gave `A.btn "Visit the site" y=501`, then `DIV.grid "What clients said after launch" y=8643`, `INPUT.option__input y=13023`, `BUTTON.btn "Continue to scope" y=12594`, `A.btn "Email info@mk-wp.site"`, `BUTTON.faq-question` — all outside the dialog while it reported `aria-hidden="false"` and `display="flex"`.

**الإصلاح المقترح:** In the keydown handler at js/ui.js:396, add the same Tab wrap the menu uses: when `e.key === 'Tab'` and the dialog is open, collect `$$('a[href]:not([hidden]), button:not([disabled])', dialog)` and preventDefault/wrap between first and last, exactly as js/ui.js:122-128 does.

---

## 🟡 متوسطة (7)

### `css/components.css:643` — Form inputs are 15px, below the 16px threshold that stops iOS Safari auto-zoom

- **النوع:** touch  
- **اكتشفه:** runtime-mobile

**التفاصيل:** .field__input { ... font-size: var(--fs-sm); ... } resolves to `clamp(0.9375rem, 0.894rem + 0.188vw, 1.0625rem)`, whose floor is 15px and which only reaches 16px at a ~901px viewport. The page ships `<meta name="viewport" content="width=device-width, initial-scale=1">` (index.html:6) with no `maximum-scale`, so iOS Safari applies its auto-zoom whenever a focused form control is under 16px. base.css:28-31 states this was the exact regression being fixed ("pushed body copy to 12.9px and triggered iOS input zoom"), but the fields were left on --fs-sm.

**سيناريو الفشل:** On an iPhone, reach step 3 of the enquiry form and tap the Name field. Safari zooms the page in to enlarge the 15px text; it does not zoom back out on blur, so the rest of the form — Email, WhatsApp number, the Back / Continue on WhatsApp buttons — is now wider than the screen and has to be panned horizontally to finish. Measured computed font-size: 15px at 320 and 360, 15.04px at 390, 15.08px at 414, 15.75px at 768, 15.996px at 900. Every phone and every tablet in portrait is affected.

**الدليل:** getComputedStyle('#f-name').fontSize across viewports: 320->15px, 360->15px, 390->15.0372px, 414->15.0823px, 768->15.7478px, 900->15.996px, 1024->16.2291px, 1280->16.7104px. Viewport meta confirmed at index.html:6 with no maximum-scale.

**الإصلاح المقترح:** On line 643 raise the floor past the zoom threshold, e.g. `font-size: clamp(1rem, 0.894rem + 0.188vw, 1.0625rem);` — or add a `--fs-field` token pinned at 16px minimum and use it here and on `.option__card` (line 721).

---

### `css/components.css:759` — Form step indicator overflows the contact card at 320px

- **النوع:** responsive  
- **اكتشفه:** runtime-mobile

**التفاصيل:** .form-progress { display: flex; align-items: center; gap: var(--space-sm); ... } is a nowrap flex row (no `flex-wrap`), and its `.progress-step` children keep the default `min-width: auto`, so they cannot compress below their text. The three steps plus two 12px gaps need 273px; at 320px the form card gives them 238px.

**سيناريو الفشل:** On a 320px-wide phone (iPhone SE / Galaxy Fold cover screen), scroll to the enquiry form. The row overflows its box by 35px: step 3 renders from x=225.2 to x=313.8 while `#contactForm.card` ends at x=300 and the container's inner edge is 300. The word "Contact" and its numbered circle sit 13.8px outside the card's rounded border, on the bare section background, 6.2px from the screen edge — the step marker looks detached from the form it belongs to. At 360px and above the row fits (scrollWidth == clientWidth) and the break disappears, so it is specific to the narrowest phones.

**الدليل:** Runtime at 320: {"progBox":{l:41,r:279,w:238},"scrollW":273,"clientW":238,"overflowBy":35,"steps":[...{n:"3Contact",l:225.2,r:313.8}],"cardRight":300,"pastCard":13.8}. At 360/375/390/414 overflowBy is 0 and pastCard is negative. Visible in scratchpad/shots/form1-320.png, where "3 Contact" crosses the card border.

**الإصلاح المقترح:** Add `flex-wrap: wrap;` to the `.form-progress` rule (beside line 759) so the third step drops to a second line instead of escaping the card; the existing `gap: var(--space-sm)` already supplies the row gap.

---

### `css/components.css:875` — Mandatory scroll snap leaves every focused "Visit the site" link 81% off-screen on a phone

- **النوع:** a11y  
- **اكتشفه:** runtime-a11y

**التفاصيل:** `.rail, .mk-rail { ... scroll-snap-type: x mandatory; }` (line 875) with `.rail__item { scroll-snap-align: start; }` (line 892). Below 900px the rail is a live scroller whose only resting positions are card starts (0, 328, 656, 984 …). When focus moves to a control near the right edge of the next card, the browser computes a small scroll to reveal it and mandatory snapping immediately pulls the container back to the nearest snap point — which is the one it started from.

**سيناريو الفشل:** At 390x844, tab through the Work section. After "Project brief: Sakhaa Program", Tab lands on "Visit the site: SL Smarts" at x=369 with width 110 on a 390px screen: only 21px (19%) of the link and none of its focus ring are on screen, and the rail's scrollLeft does not change. The same happens for Sharik, Dr Mohamed Osama and the remaining cards. Seven of the eight project links are focused essentially outside the viewport — WCAG 2.4.7 / 2.4.11.

**الدليل:** Runtime at 390x844, real Tab presses with a 900ms settle: {"Visit the site: SL Smarts", x:369, w:110, visW:21, pctVisible:19, railScrollLeft:0, snap:"x mandatory"} then {"Project brief: SL Smarts", x:167, visW:107, pctVisible:100, railScrollLeft:328}; identical pattern for Sharik (x:369, 19%, scrollLeft 328→656) and Dr Mohamed Osama (x:369, 19%, scrollLeft 656→984).

**الإصلاح المقترح:** Change css/components.css:875 from `scroll-snap-type: x mandatory;` to `scroll-snap-type: x proximity;` so the browser may rest between snap points when bringing a focused control into view.

---

### `css/components.css:596` — With JavaScript off, all seven FAQ answers collapse to zero height and cannot be opened

- **النوع:** resilience  
- **اكتشفه:** runtime-a11y

**التفاصيل:** `.faq-answer { display: grid; grid-template-rows: 0fr; }` (line 596) with `.faq-answer-content { overflow: hidden; }` (line 605). The only rule that opens a panel is `.faq-item.is-open .faq-answer { grid-template-rows: 1fr; }` (line 600), and `.is-open` is written exclusively by js/ui.js:349. The `<noscript>` block at index.html:68-82 was written to cover the preloader and the marquee but says nothing about the accordion.

**سيناريو الفشل:** A visitor with scripting disabled (or with js/ui.js blocked) reaches the FAQ and sees seven clickable-looking headings — "What is the 7-day money-back window?", "What does the 180-day support cover?", "How do I pay?" — and pressing any of them does nothing, because `.faq-question` is `type="button"` with no handler. Every answer, including the whole payment-methods list and both guarantee terms, is rendered at height 0 and unreadable.

**الدليل:** Runtime in a Playwright context with `javaScriptEnabled:false`: `.faq-answer .faq-answer-content` first() `isVisible() === false`; `.faq-answer` first() boundingBox = {"x":268.94,"y":15511.59,"width":902.13,"height":0}. In the same run the preloader correctly reported `isVisible() === false` and the marquee item did not move over 1.5s, so the noscript block itself is being applied.

**الإصلاح المقترح:** Add `.faq-answer{grid-template-rows:1fr}` to the `<noscript>` style block at index.html:68-82 (it is declared after the stylesheets, so it wins on source order with no importance override, exactly as the two rules already there do).

---

### `css/tokens.css:71` — Control borders measure 1.16–1.60:1 against their backgrounds, far below the 3:1 required to perceive the control

- **النوع:** a11y  
- **اكتشفه:** runtime-a11y

**التفاصيل:** `--rule: var(--white-a08);` (line 71) = rgba(255,255,255,.08) and `--rule-strong: var(--white-a18);` (line 73) = rgba(255,255,255,.18). These are the only boundary on several controls whose background is transparent, so nothing else marks where the control is. `.pill-filter, .filter-btn { border: var(--border); background-color: transparent; }` (css/components.css:501, 503); `.btn--outline { background-color: transparent; border-color: var(--rule-strong); }` (css/components.css:99-100); `.field__input { border: var(--border); background-color: var(--surface-2); }` (css/components.css:640-642) sitting inside a `--surface-4` card. WCAG 1.4.11 requires 3:1 for the visual boundary needed to identify a component.

**سيناريو الفشل:** On a laptop screen at typical brightness, or for anyone with reduced contrast sensitivity, the five unselected category filters above the project rail read as plain floating uppercase words rather than buttons — only the violet-filled "All" pill looks pressable, so the filter row does not communicate that it is a control group. Likewise "See the work", "Email info@mk-wp.site" and "Message on WhatsApp" (`.btn--outline`) show as bare text, and the Name / Email / WhatsApp text fields in step 3 have no perceivable edge at all.

**الدليل:** Computed at runtime by compositing each border colour over its real painted background stack and applying the WCAG relative-luminance formula: `.pill-filter:not(.is-active)` border #252332 on #121020 = 1.22:1; `.btn--outline` border #333237 on #06050B = 1.60:1; `.field__input` border #252332 on #121020 = 1.22:1 (and its own fill #121020 against the enclosing card #221D3D is 1.16:1); `.menu-trigger` #1A191F on #06050B = 1.16:1; `.footer__social` 1.16:1; `.dialog__close` 1.25:1. All measured border widths are 1px.

**الإصلاح المقترح:** Raise the two tokens at css/tokens.css:71 and 73 to at least rgba(255,255,255,.34) — e.g. `--rule: rgba(var(--white-rgb), .34);` and `--rule-strong: rgba(var(--white-rgb), .45);` — which puts the hairline at roughly 3.1:1 and 3.9:1 on --surface-2 while staying a hairline.

---

### `index.html:1602` — With JavaScript off the enquiry form is a dead end: steps 2 and 3 stay hidden and the form has no action

- **النوع:** resilience  
- **اكتشفه:** runtime-a11y

**التفاصيل:** `<div class="form-step" data-step="2" hidden>` (line 1602) and `<div class="form-step" data-step="3" hidden>` (line 1644) ship the attribute in the markup, and only js/form.js:39 (`s.hidden = !on`) ever clears it. The only control left visible is `<button class="btn btn--primary next-step" type="button">Continue to scope</button>` (line 1597) — `type="button"`, so it has no default behaviour and no handler. The submit control `<button class="btn btn--primary" type="submit">Continue on WhatsApp</button>` lives inside the hidden step 3 (line 1687), and `<form class="card card--static" id="contactForm" novalidate ...>` (line 1546) declares no `action` and no `method`. css/components.css:813-816 asserts the opposite: "Without scripting all three steps stay readable."

**سيناريو الفشل:** A visitor with scripting disabled reaches the contact section, picks "An online store", presses "Continue to scope" and nothing happens — ever. The name, email and WhatsApp fields and the only submit button are all inside hidden steps, so there is no way to send an enquiry and no visible explanation. The page's primary conversion path is silently dead.

**الدليل:** Runtime with `javaScriptEnabled:false`: `.form-step[data-step="2"]` `getAttribute('hidden')` = "" and `isVisible() === false`; `.form-step[data-step="3"]` `isVisible() === false`; `#contactForm` `getAttribute('action')` = null and `getAttribute('method')` = null.

**الإصلاح المقترح:** Add `.form-step[hidden]{display:flex}` to the `<noscript>` style block at index.html:68-82 (specificity 0-2-0, declared after the stylesheets, so it beats base.css:383's `[hidden][hidden]`), and give the form at index.html:1546 a real `action`/`method` so the submit button in step 3 degrades to something that works.

---

### `js/rails.js:109` — GSAP guard returns before syncReach(), leaving five dead tabindex="0" stops on desktop when the CDN is blocked

- **النوع:** a11y  
- **اكتشفه:** runtime-desktop, runtime-a11y (**2 عملاء مستقلين**)

**التفاصيل:** js/rails.js:109-110:

    if (typeof gsap === 'undefined' || !gsap || !gsap.core) return;
    if (typeof ScrollTrigger === 'undefined' || !ScrollTrigger) return;

These sit above `boot()` (lines 311-319), which is the only caller of `syncReach()` (lines 127-136). `syncReach` is pure DOM work — it reads `track.scrollWidth - track.clientWidth` via `travelOf()` and adds or removes `tabindex="0"` — and needs neither GSAP nor ScrollTrigger. The file's own comment at lines 118-124 states the contract it is failing to keep: "At 900px the same element stops being a scroller, and a tab stop that scrolls nothing is just a dead stop in the tab order — so the attribute is taken off again whenever the element does not actually overflow." With the guards firing first, the attribute is never taken off.

**سيناريو الفشل:** A keyboard visitor on a desktop (1440x900) whose network blocks cdnjs hits five focus stops that do nothing at all. Measured: UL.grid--4.flick-rail ("The numbers so far"), DIV.grid--3.flick-rail ("The stack"), DIV.grid--3.flick-rail ("Six kinds of site I build"), OL.process__list.flick-rail ("Four steps from brief to handover") and DIV.grid--3.flick-rail ("What clients said after launch") — each with scrollWidth === clientWidth === 1304 and computed overflow-x "visible". The arrow keys, Home and End do nothing on them, and a screen reader announces a group label for a scroll region that is not a scroll region.

**الدليل:** Playwright at 1440x900 with cdnjs blocked (window.gsap undefined): querying `[tabindex="0"]` returned exactly those five elements, each reporting {scrollW:1304, clientW:1304, overflows:false, overflowX:"visible"}. A Tab sweep from the project dialog landed on `DIV.grid grid--3 flick-rail` as a real focus stop.

**الإصلاح المقترح:** Run the DOM-only work before the GSAP guards. Move `module('sync reach', syncReach);` (and the syncReach function it calls) above line 109 — e.g. call `syncReach()` on DOMContentLoaded unconditionally, then keep lines 109-110 as guards only for `wire()` and the refresh hook.

---

## ⚪ منخفضة (3)

### `css/components.css:779` — Active form-progress step text measures 4.05:1, below the 4.5:1 needed for 14px copy

- **النوع:** a11y  
- **اكتشفه:** runtime-a11y

**التفاصيل:** `.progress-step.is-active { color: var(--violet-400); }` (line 779) paints the reached step markers `#A855F7`. `.progress-step` is `font-size: var(--fs-xs)` (14px at 1440) and `font-weight: var(--fw-semibold)` (600) — normal text by WCAG's definition, so it needs 4.5:1. The markers sit inside `#contactForm`, a `.card` on `--surface-4` `#221D3D`.

**سيناريو الفشل:** On the contact form, the words "Project", "Scope" and "Contact" that mark which of the three steps the visitor has reached are the one cue to progress through the form, and at 4.05:1 they are below the threshold for 14px text. A low-vision user cannot reliably tell reached steps from unreached ones — the unreached state, `--text-3` on the same card, measures 5.00:1 and is actually more legible than the highlighted one.

**الدليل:** Measured at runtime at 1440x900 by compositing the computed colour over the real background stack: fg #A855F7, bg #221D3D, ratio 4.05:1 at 14px/600 (need 4.5). Hand-checked: L(#A855F7)=0.21546, L(#221D3D)=0.015246, (0.21546+0.05)/(0.015246+0.05)=4.07. The same violet passes elsewhere only because it sits on darker surfaces (`.btn--quiet` on --surface-1 = 5.00:1, `.badge--brand` = 4.96:1).

**الإصلاح المقترح:** Change css/components.css:779 to `color: var(--violet-100);` (#E9D5FF on #221D3D = 11.8:1), which also matches `.field__error`'s existing use of the same token on the same surface.

---

### `index.html:2048` — footer-contact-title id is never referenced; the contact column is the one unlabelled footer column

- **النوع:** a11y  
- **اكتشفه:** html-structure

**التفاصيل:** Line 2048: `<p class="footer__title" id="footer-contact-title">Get in touch</p>`, inside a plain `<div class="footer__col">` at line 2047. No element anywhere in the document carries `aria-labelledby="footer-contact-title"` — the only aria-labelledby values in the footer are `footer-title` (1993), `footer-nav-title` (2021) and `footer-services-title` (2034). The id is dead. The block comment at lines 1985-1986 states the design intent outright: "Each column is a named landmark instead — aria-labelledby points at the visible title." Columns 2 and 3 are `<nav aria-labelledby=...>`; the contact column got the id but never the landmark, and the brand column (2005) got neither.

**سيناريو الفشل:** A screen-reader user listing landmarks in the footer hears "Navigation" and "Services" as two named navigation regions but the email address, WhatsApp link and YouTube link are in an unnamed generic div with no way to target them; the visible heading "Get in touch" is never associated with the group it heads.

**الدليل:** `grep -o 'id="[^"]*"' index.html` lists footer-contact-title once at line 2048; `grep -oE 'aria-labelledby="[^"]*"' index.html` returns 20 values, none of them footer-contact-title. Verified by reading lines 2046-2049 and 2021/2034.

**الإصلاح المقترح:** On line 2047 change `<div class="footer__col">` to `<div class="footer__col" role="group" aria-labelledby="footer-contact-title">` so the existing id at 2048 is actually used (or, if the landmark is not wanted, delete `id="footer-contact-title"` from line 2048).

---

### `index.html:87` — JSON-LD declares ProfessionalService but omits address, a required LocalBusiness property

- **النوع:** seo  
- **اكتشفه:** html-structure

**التفاصيل:** The ld+json block at lines 84-99 sets `"@type": "ProfessionalService"` (line 87). ProfessionalService is a subtype of LocalBusiness, and Google's LocalBusiness structured-data spec lists `@type`, `name` and `address` as required. The block supplies name, url, image, email, telephone, founder, foundingDate, description, areaServed and sameAs — every optional signal for a local-business rich result — but no `address` and no `PostalAddress` anywhere. `"areaServed": "Worldwide"` (line 96) also contradicts the local-business framing: nothing on the visible page names a premises, only "clients across the Arab world, Europe and America" (lines 224, 346, 1908-1910).

**سيناريو الفشل:** Submitting https://profile.mk-wp.site/ to Google's Rich Results Test reports the item under "Local businesses" as invalid with "Missing field 'address'", so the entity is ineligible for the local-business rich result and for a knowledge panel keyed off it. All the other correctly-supplied properties (telephone, email, sameAs, foundingDate) are wasted on an item Google will not index as a business.

**الدليل:** Read lines 84-99 in full; the object has exactly ten keys and none is `address`, `location` or `PostalAddress`. Cross-checked every claim it does make against the page: telephone +201099576398 matches the wa.me links (177, 1706, 1714, 1965, 2064, 2095); email info@mk-wp.site matches lines 175, 1713, 2059; foundingDate 2020 matches the h2 at 481 and the timeline at 1386; url matches the canonical at line 13; the YouTube sameAs matches line 2071.

**الإصلاح المقترح:** Change line 87 to `"@type": "Organization",` — Organization has no required address and matches the worldwide-remote positioning the page actually makes — or, if a local listing is wanted, keep ProfessionalService and add an `"address": { "@type": "PostalAddress", "addressLocality": "...", "addressCountry": "EG" }` entry after line 92.

---

