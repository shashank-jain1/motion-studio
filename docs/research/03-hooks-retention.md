# 03 — Hooks, Retention & Scroll-Stopping Motion Graphics

> Research brief for the AI director. Scope: animated / motion-graphic video (not talking-head) for Reels, TikTok, Shorts, YouTube, LinkedIn, X, web hero, and paid ads. Compiled Oct 2026.
>
> **Evidence legend:** **[OFFICIAL]** = platform documentation. **[STUDY]** = published research with a method. **[VENDOR]** = agency or tool blog; numbers usually unsourced, so treat them as directional. **[CRAFT]** = practitioner heuristic or our own synthesis. Most "X% more retention" stats on the web are VENDOR-grade. Build defaults on OFFICIAL guidance and use the rest as hypotheses to A/B test.

---

## 0. TL;DR for the director

- **The first frame is the thumbnail and the hook.** Frame 0 must already carry motion, contrast, and a promise. No fade from black, no logo sting, no "intro." VENDOR data puts intro-first openings 30–40% behind value-first ones ([Opus](https://www.opus.pro/blog/tiktok-length-format-retention-data)).
- **Platforms measure at 2s and 6s.** TikTok Ads reports **2-second** and **6-second** views, with replays excluded [OFFICIAL] ([TikTok video play](https://ads.tiktok.com/help/article/video-play)). TikTok's performance guide says to "prioritize your hook in the first 6 seconds" by using suspense, surprise, or emotion [OFFICIAL] ([TikTok creative best practices](https://ads.tiktok.com/help/article/creative-best-practices)). Practical budget: **0–1s stop the thumb, 1–3s make the promise, 3–6s start delivering.**
- **Structure is hook → body → close/CTA.** That is TikTok Creative Code #4 [OFFICIAL] ([Creative Codes](https://ads.tiktok.com/business/en/creative-codes)). Re-hook every **3–5s** in short form (a visual change, a new text beat, or a sound hit), and never hold a static frame for more than ~5s [VENDOR] ([Opus](https://www.opus.pro/blog/tiktok-length-format-retention-data)).
- **Design for sound-off, then enhance for sound-on.** Facebook found that 41% of videos were meaningless without sound, and captions added about 12% view time (Meta data, c.2017; [SMT](https://www.socialmediatoday.com/social-business/facebook-adds-automated-captions-video-ads-offers-tips-improve-video-performance)). TikTok and Shorts are sound-on cultures: Google says sound lifts Shorts ad conversions by more than 20% [OFFICIAL] ([Google Shorts ads guide](https://support.google.com/google-ads/answer/16041697)).
- **Brand early, but integrate it into the hook.** A logo card is not a hook. Google's ABCD rule is to brand "early, often, and richly" and to "see and say" the brand [OFFICIAL] ([ABCDs](https://business.google.com/en-all/resources/articles/abcds-of-effective-video-ads/)).
- **Make loops seamless.** If the last frame matches the first, replays count as watch time, and Instagram (Mosseri, Jan 2025) names watch time, likes/reach, and sends/reach as its top Reels signals ([PostEverywhere summary](https://posteverywhere.ai/blog/how-the-instagram-algorithm-works)).

---

## 1. Visual hooks for 0–3 seconds

### 1.1 What the data says about hook timing (2025–2026)

- **TikTok [OFFICIAL]:** state the proposition early for recall, put the hook in the first 6s, and pace on-screen text at **5–10 words/sec** maximum ([TikTok creative best practices](https://ads.tiktok.com/help/article/creative-best-practices)). Paid reporting uses 2s and 6s view thresholds plus "focused view" (6s or an engagement) ([TikTok video play](https://ads.tiktok.com/help/article/video-play); [Strike Social](https://strikesocial.com/blog/tiktok-video-view-ads-metrics/)).
- **Meta (legacy official stat):** "65% of people who watch the first 3 seconds will watch for at least 10 seconds" ([SMT](https://www.socialmediatoday.com/social-business/facebook-adds-automated-captions-video-ads-offers-tips-improve-video-performance)). Meta's Reels analysis via Adobe found that 9:16 + sound-on + safe-zone + at least one extra element (an early hook, text overlay, voiceover, or a human) lifted CTR about 56% ([Adobe blog](https://blog.adobe.com/en/publish/2024/11/04/unlock-potential-reels-best-practices-for-creative-success-using-adobe-creative-cloud)).
- **Google/YouTube [OFFICIAL]:** "Jump in": tight framing, engaging pacing, and bright, high-contrast visuals ([ABCDs](https://business.google.com/en-all/resources/articles/abcds-of-effective-video-ads/)). Shorts research found people "don't hesitate to swipe away" boring videos, whether paid or organic, and a native tone beats a hard pitch ([PPC Land](https://ppc.land/google-offers-new-blueprint-for-brand-success-with-youtube-shorts-ads/)).
- **Retention curves [VENDOR]:** a strong hook keeps about 80–90% of viewers through 3s. A sharp drop at about 8–10s means the hook promised something the body did not deliver. 70% average watch time got about 4.3× the impressions of 40% across a 500-video sample (no methodology given) ([Opus](https://www.opus.pro/blog/tiktok-length-format-retention-data)). Hook-rate benchmark: below 20% (3s views / impressions) is below average, and 20–35% is average ([PostEverywhere](https://posteverywhere.ai/social-media-terms/hook-rate)).
- **Takeaway for motion graphics:** we have no face to anchor attention, so the hook has to come from **motion salience** (large, fast, high-contrast change), **novelty** (something the brain can't predict), and **an explicit promise in type**.

### 1.2 Hook catalog (30 patterns)

Format: **Name.** What it is. *Why it works.* → How to build it.

1. **Bold-claim type slam.** A 2–5 word claim punches in at 120–150% scale and settles to 100% with overshoot. *A clear promise plus motion onset.* → Kinetic text, scale spring (damping ~12), a 2–4 frame camera shake, and an impact SFX on the landing frame.
2. **Pattern interrupt / color flash.** 2–4 frames of inverted or saturated full-frame color, then the content. *An abrupt luminance change triggers the orienting reflex.* → A solid layer with 0.1s opacity, an RGB-split glitch, and a hit SFX. Use once only, and respect photosensitivity (no more than 3 flashes/sec).
3. **Impossible transformation.** An object morphs into an unrelated object (a coin turns into a rocket). *The prediction error forces a second look.* → SVG path morph (flubber/interpolate), shape tween, and a matched whoosh.
4. **Extreme scale shift / infinite zoom.** Start macro (a pixel or atom), then zoom out through nested worlds, or the reverse. *Continuous novelty with no natural exit point.* → Nested scenes with a camera scale on an exponential curve (`scale = 2^(t*k)`) and crossfades at each 10× level.
5. **Fast zoom from macro.** A blurry extreme close-up snaps out to reveal the object. *Ambiguity is resolved within 1s.* → Camera punch-out (scale 4 → 1 over 12–18 frames, easeOutExpo) with motion blur.
6. **Object breaks the frame.** An element bursts past the device frame or card border, or "out of the phone." *It violates spatial expectations.* → Masked layer whose mask releases mid-animation, a z-index swap, and a drop shadow onto the "outside."
7. **"Wait for it" tension.** A slowly filling bar, a ball rolling toward a gap, or a stack about to topple. *Anticipation makes leaving feel like a cost.* → Progress-bar or physics-sim tension with a riser SFX, payoff at 3–7s.
8. **Curiosity-gap reveal tease.** Show 20% of the answer (blurred, cropped, or masked) with "the #1 mistake is..." *An information gap sized to feel resolvable* ([Loewenstein, via Virlo](https://virlo.ai/blog/the-science-behind-what-happens-next)). → Blur or mosaic shader, an iris mask, and text with a redacted bar.
9. **Number countdown / list promise.** "3 tools that..." with a big "3" counting down. *It gives a defined commitment length.* → Counter component, oversized numerals (40–60% of frame height), and a tick SFX.
10. **Stat counter slam.** "$0 → $1,284,000" rolling up in under 1.2s. *Rapidly changing numbers plus specificity.* → Odometer/counter with easeOutCubic, tabular figures, and a final scale pop.
11. **Before → after wipe.** A split or wipe slider between ugly and beautiful states. *An instant value demonstration.* → Linear wipe mask, an animated divider handle, and a "swipe" SFX.
12. **Oddly-satisfying motion.** Perfect fits, precise slicing, sorting, or soft-body squish. *A "just right," order-restoring feeling* ([Discover](https://www.discovermagazine.com/why-are-oddly-satisfying-videos-sosatisfying-218)). → Physics springs, metaball/goo shader, and a lock-in snap with a click SFX.
13. **Satisfying seamless loop.** An object travels a closed path and returns exactly to frame 0. *No natural end point leads to replays.* → Modulo time (`t % period`), first frame === last frame.
14. **Split-screen contrast.** Left/right or top/bottom: "you vs. the pros" or "$10 vs. $1000." *Comparison is processed instantly.* → Two compositions in clip masks, synced beats, and a label chip per side.
15. **Text-on-object (tracked type).** Words appear on surfaces: a can label, a building, a phone screen. *Type integrated into the world reads as premium and novel.* → 3D plane or text with perspective transform or corner-pin, optionally with a shader.
16. **POV framing.** "POV: you just shipped on Friday" over a first-person UI or animated scene. *Self-insertion is a native TikTok grammar.* → Top text chip plus a first-person camera (UI cursor, hands, screen).
17. **Glitch / datamosh entry.** The content resolves from digital corruption. *Signals "something's wrong," then rewards with clarity.* → RGB split, scanline, and pixel-sort shaders, 6–10 frames, plus a digital crackle SFX.
18. **Unexpected physics.** Type falls and bounces, liquid flows upward, gravity flips. *Breaks an intuitive physics model.* → Rigid-body sim (matter.js precomputed per frame) or a spring chain.
19. **Path-draw reveal.** A line draws a logo, chart, or route in about 1s. *Watching a shape complete satisfies the urge for closure.* → SVG stroke-dashoffset animation and a pen/scribble SFX.
20. **Chart that breaks out.** A line chart rises so fast it tears through the top of the frame. *Data plus drama.* → Path draw with a camera follow, then overflow past the frame mask.
21. **3D device spin-in.** A phone or laptop whips in 180° and lands on the hero UI. *Product in the first second, which Meta and TikTok recommend.* → Three.js/R3F device model, Y-rotation spring, and a screen texture as a video.
22. **Wrong-answer hook.** Show the common way, slam a big ❌ or strike-through, then "do this instead." *Loss aversion plus correction.* → Strike-through path draw, a red flash, and a buzzer SFX.
23. **Direct address in type.** "If you run a gym, stop scrolling." *Self-identification makes the viewer feel the post is for them.* → Kinetic type with the niche keyword highlighted in brand color.
24. **Question hook.** "Why does every SaaS site look the same?" *An open question creates a loop.* VENDOR data: question hooks beat generic openers by about 23% ([Opus](https://www.opus.pro/blog/tiktok-length-format-retention-data)). → Typewriter or word-by-word, with an ellipsis pulse.
25. **Mid-action start (in medias res).** Open at the peak of an animation, at the explosion rather than the fuse. *Skips the setup that people scroll away from.* → Start the timeline at 40% progress; you can rewind later as the "how we got here."
26. **Rapid-fire montage (0.3–0.5s cuts).** 6–10 snapshots of outcomes in the first 3s. *Density signals "this video is packed."* → Hard cuts on the beat with matching flash frames.
27. **Character/mascot reacts.** A blob or emoji character does an exaggerated double-take. *Faces, even abstract ones, capture attention.* → Lottie/SVG rig with squash-and-stretch and eye motion.
28. **Price/offer slam (ads).** "-50%" crashes in with debris particles. *A direct benefit, as Meta guidance recommends.* → Particles burst and the type lands on a shockwave ring.
29. **Map/route zoom.** Earth to city to street to the storefront pin. *Locality ("this is near me").* → Tile or vector map with a camera fly-to and a pin drop with bounce.
30. **Fake UI notification.** An iOS-style push banner: "Your revenue just doubled." *Familiar UI hijacks attention.* → A generic notification card that slides down with a spring and a "ding." Keep it non-deceptive: never imitate a real brand's system UI in ads, which platforms may reject.

**Combination rule [CRAFT]:** the strongest openers stack **one visual mechanism + one text promise + one sound event** within the first 0.5s. Examples: (#4 infinite zoom + #23 direct address + riser), or (#21 device spin + #10 stat counter + impact).

---

## 2. Retention structure

### 2.1 Beat map (default 20–35s short-form)

| Time | Beat | Job |
|---|---|---|
| 0.0–0.5s | **Stop** | Motion onset, maximum contrast, first word on screen at frame 0 |
| 0.5–3s | **Promise** | What you'll get. Open loop #1 |
| 3–6s | **Proof/first value** | Deliver a quick win. TikTok's 6s threshold |
| every 3–5s | **Re-hook** | New visual idea, scene change, text beat, or SFX hit |
| ~40–60% | **Mid-hook** | "But here's the part nobody tells you…" (open loop #2) |
| last 20% | **Payoff** | Close the main loop. VENDOR data: payoff inside the first 15s beats end-loaded payoffs by about 20% ([Opus](https://www.opus.pro/blog/tiktok-length-format-retention-data)), so deliver partial value early |
| final 1–2s | **CTA / loop seam** | CTA (ads), or match-cut back to frame 0 (organic) |

- **Open loops:** chain micro-cliffhangers rather than one big one at the end ([SociaLync](https://www.socialync.io/blog/open-loops-in-content-2026)). Every loop must pay off, because clickbait erodes trust. The Zeigarnik evidence is mixed, so treat this as a heuristic.
- **Mode switching:** neither pure information nor pure visuals should run more than about 8s [VENDOR] ([Opus](https://www.opus.pro/blog/tiktok-length-format-retention-data)).

### 2.2 Pacing / cut frequency

No rigorous shot-length census of viral TikToks exists. Published numbers (1–2s, 1.2–1.8s, 5–7s) conflict and are unsourced. A 2026 controlled study (n=242) found that **higher pacing reduced sustained engagement**: seamless cuts increased liking, and overlapping cuts helped completion only at low frequency ([Dost & Huang 2026](https://archives.marketing-trends-congress.com/2026/pages/PDF/paper_professor_DOST_HUANG.pdf)). For motion graphics, "cut" means **any visual state change** (scene, camera move, type beat), not just hard cuts.

Default **visual-event interval** (time between meaningful changes) [CRAFT, consistent with the above]:

| Context | Interval | Notes |
|---|---|---|
| TikTok/Reels hype, gaming, music drop | 0.4–1.2s | On the beat. Flash frames OK |
| TikTok/Reels/Shorts educational | 1.5–3s | One idea per beat. Re-hook every 3–5s |
| Ads (all short-form) | 1–2s | Product visible at least 50% of runtime |
| LinkedIn / B2B | 2.5–4s | Calmer. Text must be readable muted |
| YouTube long-form explainer | 3–6s | Camera drift and builds instead of cuts |
| Web hero loop | 4–10s per loop | Ambient, no hard cuts, seamless |

### 2.3 Sound design sync

- **Hierarchy:** music bed (−18 to −14 LUFS short-form master, ducked under VO), then SFX layer, then VO.
- **Map motion to sound** [CRAFT, [Sonilo guide](https://sonilo.com/ai-music/whoosh-sound-effect-guide)]: the whoosh length equals the move length and **peaks on the cut or landing frame**. Use a light swoosh for small fast moves, an **impact/hit** for landings, and a transition sound when the scene (not an object) changes. A **reverse riser** leads *into* a cut, and the silence after it is the effect.
- **Beat grid:** quantize scene changes to the music BPM (at 120 BPM a beat is 0.5s, or 15 frames at 30fps). A 1-bar dropout of music before a reveal adds surprise. Framer's promo used exactly this ([jameshfisher study](https://jameshfisher.com/2017/03/25/framer-promo-video-study/)).
- **Per-element SFX:** type slam gets a thud, counter gets ticks then a "ding" on the final value, check marks get a pop, UI clicks get a soft click, morph gets a whoosh, glitch gets crackle.
- TikTok Creative Code #6 is **"Build with sound"** [OFFICIAL], and Google wants audio mentions of the brand and CTA ("see and say") [OFFICIAL].

### 2.4 On-screen text

- **Max density:** 5–10 words/sec reading pace (TikTok OFFICIAL). Our default is **≤ 7 words per text beat**, a minimum on-screen time of max(1.2s, words × 0.3s), and important claims held for at least 2s.
- **Size:** body ≥ 48px, hook ≥ 80–120px on 1080×1920. Use strong contrast: a stroke or shadow, or a solid chip behind the type.
- **Captions:** burn in captions with word-level highlighting. Facebook found captions add about 12% view time; VENDOR data puts it near 12% retention on TikTok.
- **Never** put critical text in the bottom 35% of 9:16 ads (see the safe zones below).

### 2.5 Safe zones (1080×1920 master)

None of the platforms publishes organic margins. These are conservative composites from ad specs and measured UI ([AdaptlyPost 2026](https://adaptlypost.com/blog/social-media-safe-zones-2026-complete-guide); [Meta via AdNova](https://adnova.ai/blogs/meta-ad-safe-zones-guide); [Remotion overlay](https://www.remotion.dev/elements/overlays/social-safe-zones/)).

| Placement | Top | Bottom | Left | Right | Safe rect |
|---|---|---|---|---|---|
| TikTok organic | 108px (5.6%) | 320px (16.7%) | 60px | 120px (11%) | 900×1492 |
| TikTok ads | 108 / up to 240 | 370 / up to 660 | 60–120 | 120 + right rail ~180px wide from y≈840 | ~900×1100–1440 |
| IG/FB Reels organic | 210px (11%) | 310px (16%) | 0–65 | 84px | 996×1400 |
| **Meta Reels/Stories ads** | **14% (269px)** | **35% (672px)** | **6% (65px)** | **6%** | **950×979** |
| YouTube Shorts | 120px | 300px (360 with expanded desc.) | 0–48 | 96px | 984×1440–1500 |
| LinkedIn vertical | 100 | 100 | 35 | 35 | 1010×1720 |

- **Universal "safe-everywhere" rect [CRAFT]:** x 90–930, y 270–1250 for **critical** text and logo (fits Meta's ad rule). Decorative motion can fill the full bleed.
- The right rail (likes/comments/share) sits roughly from x≥900 and y 840–1500. Keep faces, products, and numbers out of it.
- Render a debug overlay per platform in Remotion and check it on a real device before launch.

### 2.6 Optimal lengths

| Platform | Organic sweet spot | Ad sweet spot | Notes |
|---|---|---|---|
| TikTok | 21–34s (highest completion), 30–60s for watch time | 9–21s | VENDOR ([Opus](https://www.opus.pro/blog/tiktok-length-format-retention-data)). Up to 10 min allowed |
| Reels | 15–30s | 6–15s | Sends/reach matter: make it shareable |
| Shorts | 20–45s | <60s (only the first 60s plays in-feed for ads) | [Google](https://support.google.com/google-ads/answer/16041697) |
| YouTube in-stream | — | 6s bumper, 15s, or 30s | Brand in the first 5s ([ABCDs](https://business.google.com/en-all/resources/articles/abcds-of-effective-video-ads/)) |
| LinkedIn | 30–90s organic | 15–30s (or under 15s) | Autoplays muted. 4:5 or 1:1 ([Brandwatch](https://www.brandwatch.com/blog/linkedin-video-specs/)) |
| X | 15–45s | ≤15s | 1:1 or 16:9 or 9:16. Message in the first 3s ([RB](https://www.rb.com.au/blog/twitter-video-ads/)) |
| Web hero | 6–12s seamless loop | — | Muted, no text-critical frames, <4 MB |

### 2.7 Loopability

- Techniques [VENDOR/CRAFT] ([faceless.so](https://faceless.so/blog/how-to-make-looping-videos-for-tiktok-reels)): (a) last frame equals first frame, (b) match-on-action across the seam, (c) blend the last 6–10 frames into frame 0, (d) loop the audio so it masks the seam, (e) split sentence: the end text reads into the start text ("...and that's why" → "Most founders...").
- Spec field idea: `loop: { mode: "seamless" | "matchcut" | "none", seamFrames: 8 }`. Validate by diffing the first and last frames.
- Ads: hold the CTA end card 1–2s rather than looping.

---

## 3. Niche playbooks

All entries are [CRAFT] synthesis consistent with the sources above. Values are **defaults for the director**, to be tuned per brand.

| Niche | Motion style | Hooks that fit | Pacing | Color / type | Visual metaphors |
|---|---|---|---|---|---|
| **SaaS / app launch** | Real UI as hero, 3D device, cursor-driven demos, beat-synced big type. Note: 2026 SaaS videos are shifting to **screencast-built, light-mode, captioned**, while 3D and pure kinetic-type formats decline ([Advids 100-video study](https://advids.co/blog/ui-animation-motion-design-trends)) | #21 device spin, #1 claim slam, #11 before/after, #22 wrong-way, #30 notification | 1–2s beats on music, 1-bar dropout before the reveal | Light UI frames, one accent color, Inter/Geist-style grotesk, tight tracking | Chaos tangle → straight line, stack of tabs collapsing into one, clock rewinding |
| **Fintech** | Clean data viz, counters, charts that draw, glass/frosted cards | #10 stat counter, #20 chart breaks out, #14 split ($ vs $$) | 1.5–2.5s | Deep navy/black plus mint/green or electric accent, tabular numerals, trust-forward | Growing plant/compound curve, shield/lock, coins stacking, card flip |
| **E-commerce product** | Product orbit, macro detail, exploded views, price slams | #5 macro zoom, #11 before/after, #28 price slam, #12 satisfying | 0.8–1.5s | Brand palette, bold condensed sans for offers, sticker/badge shapes | Unboxing, product breaking out of the frame, "in hand" scale, ingredient explosion |
| **Food / restaurant** | Ingredient drops with physics, steam particles, top-down assembly, warm grain | #12 satisfying assembly, #18 unexpected physics, #29 map zoom to the restaurant | 0.6–1.2s on beat | Warm saturated (red/orange/cream), chunky rounded display type | Ingredients falling into a bowl, cheese-pull stretch shader, plate spin |
| **Real estate** | Map fly-to, floor-plan path draw, slow camera dolly, price counter | #29 map zoom, #19 floor-plan draw, #11 empty → staged | 2–3s, smooth | Neutral/earth plus gold or brand accent, elegant serif plus sans | Keys, door opening as a transition, blueprint becoming a photo, pin drop |
| **Fitness** | Aggressive kinetic type, rep counters, progress rings, motion trails | #9 countdown, #10 counter, #11 transformation, #1 claim slam | 0.4–1s on beat | High-contrast black plus neon (volt/red), heavy italic condensed | Progress ring filling, battery charge, heart-rate line, weights stacking |
| **Education / explainer** | Diagram builds, path draws, iconography, a mascot | #24 question, #8 curiosity gap, #22 wrong answer, #4 infinite zoom | 2–3s with builds, re-hook every 4–5s | Calm palette with one highlight color, highly legible sans, numbered steps | Lightbulb, puzzle snapping, zoom-into-a-cell, maps and timelines |
| **Personal brand / creator** | Captions-forward, sticker/collage, hand-drawn scribbles, grain | #23 direct address, #16 POV, #24 question, #25 mid-action | 1–2s | Signature 2–3 color kit, expressive display font, handwritten accents | Notebook doodles, polaroids, chat bubbles, highlights on words |
| **Events / music drop** | Beat-locked flashes, glitch, 3D chrome type, strobing (photosafe), countdowns | #2 color flash, #17 glitch, #9 countdown, #26 montage | 0.25–0.5s on beat (cut on kicks/snares) | Dark plus neon or chrome, wide/extended display, distorted type | Speaker cones pulsing, waveforms, tunnel/infinite zoom, ticket tear |
| **Gaming** | HUD overlays, glitch, XP bars, damage numbers, screen shake | #2 flash, #7 wait-for-it, #10 counter, #26 montage | 0.4–1s | Saturated neon on black, pixel or techno display | Level-up, loot box opening, health bar, achievement unlocked |
| **B2B / LinkedIn** | Data storytelling, restrained kinetic type, clean iconography, 4:5 framing | #10 stat, #24 question, #22 "the old way", #14 split | 2.5–4s, muted-first | Corporate-calm (navy, slate, white) plus one accent, sans, generous whitespace | Funnel, bridge, gears meshing, puzzle, team nodes connecting |
| **Local business ads** | Map pin, storefront reveal, offer slam, review stars filling | #29 map zoom, #23 "If you live in [city]...", #28 offer | 1–2s | Brand colors, big legible offer type, phone/address in the safe zone | Pin drop, door opening, stars filling, calendar check |

**Universal niche rule:** the hook's metaphor must be **legible in 1 second without sound**. If you need a VO to understand it, it is the wrong hook for feed placements.

---

## 4. Ad-performance insights (animated ads)

**Meta (FB/IG)**
- 9:16 vertical with **sound on**, built inside safe zones, plus **at least one extra creative element** (early hook, text overlay, voiceover, lo-fi feel). Meta's analysis reported about +56% CTR and −20% CPC for Reels-specific ads ([Adobe/Meta](https://blog.adobe.com/en/publish/2024/11/04/unlock-potential-reels-best-practices-for-creative-success-using-adobe-creative-cloud)).
- Front-load **product or brand plus motion** in the opening seconds, and design for sound-off with captions ([SMT](https://www.socialmediatoday.com/social-business/facebook-adds-automated-captions-video-ads-offers-tips-improve-video-performance); [Vidico](https://vidico.com/news/facebook-video-ad-best-practices-that-actually-work-2026/)).
- Safe zones are top 14%, bottom 35%, sides 6%. **Don't bake a CTA button into the bottom**, because Meta's CTA button overlays it ([AdNova](https://adnova.ai/blogs/meta-ad-safe-zones-guide)).
- Produce per-placement aspect ratios: 9:16 (Reels/Stories), 4:5 (Feed), 1:1 (legacy) ([AdsUploader](https://adsuploader.com/blog/meta-ads-aspect-ratios)).
- Metrics: **hook rate** (3s views / impressions) means first-frame quality. **Hold rate** (ThruPlay / 3s views) means the body delivers the promise.

**TikTok**
- Basics are sound/music, 9:16, ≥720p, and content inside the UI safe zone. The hook goes in the first 6s via suspense, surprise, or emotion. Text runs at 5–10 words/sec. Test **3–5 creatives per ad group** ([TikTok](https://ads.tiktok.com/help/article/creative-best-practices)).
- Six Creative Codes: TikTok-first, trends, production principles, **hook-body-close structure**, **stimulation** (music, dynamic transitions, movement, text, emoji), and **build with sound** ([TikTok Creative Codes](https://ads.tiktok.com/business/en/creative-codes)).
- Polished brand motion should still feel native. Mix lo-fi elements (captions in native style, emoji, POV framing) into premium motion.

**Google / YouTube**
- **ABCD:** *Attention* (jump in, tight framing, bright high-contrast). *Branding* (early and throughout; one case put the brand in the first 5s; "see and say"). *Connection* (humanize, focus the message, humor and surprise). *Direction* (a CTA, reinforced with audio). Applying ABCDs gave +30% short-term sales likelihood (Google/Kantar 2021, n=11k ads) ([ABCDs](https://business.google.com/en-all/resources/articles/abcds-of-effective-video-ads/)).
- **Shorts:** use vertical 9:16 (landscape gets blurred bars), keep it under 60s, and use sound (+20% conversions). Feel native; supply ≥3 Shorts assets ([Google Ads help](https://support.google.com/google-ads/answer/16041697); [Shorts ABCDs PDF](https://services.google.com/fh/files/misc/formarketingshortsabcdsonesheeters.pdf)).

**LinkedIn / X**
- LinkedIn autoplays muted, and about 73% of views are mobile. Use 4:5 (1080×1350) or 1:1, captions always, and the hook in the first 3s ([Adobe](https://www.adobe.com/express/learn/blog/video-ads-linkedin); [Brandwatch](https://www.brandwatch.com/blog/linkedin-video-specs/)).
- X: aim for ≤15s, message in the first 3s (VENDOR: +13% breakthrough), and captions ([RB](https://www.rb.com.au/blog/twitter-video-ads/)).

**Cross-platform ad rules for the director**
1. Product or brand visible by **1.5s** (integrated into the hook, not a logo card).
2. Brand mark persistent but subtle (corner bug, or brand color as the type highlight).
3. Captions or on-screen copy cover every claim.
4. One message per ad, with the CTA in the final 2–3s (plus audio CTA if there's VO).
5. Export platform-native ratios from one spec: 9:16, 4:5, 1:1, 16:9.
6. Generate **3–5 hook variants** per concept with the same body (TikTok/Google both recommend multiple creatives).

---

## 5. "Oddly satisfying" and premium motion trends 2025–2026

**Macro shift:** feeds are saturated with glossy AI output, so **visible human craft** (grain, hand-drawn strokes, imperfection) reads as authentic ([Videobolt](https://blog.videobolt.net/post/top-motion-graphics-trends-2026); [Designity](https://designity.com/blog/2d-animation-trends-2026); [Renderforest](https://www.renderforest.com/blog/design-trends-in-2026)). Vertical-first is now default ([GDJ](https://graphicdesignjunction.com/2026/01/video-and-motion-creative-trends-2026/)).

| Trend | What it looks like | Remotion build notes |
|---|---|---|
| **Elastic / kinetic type** (most-cited 2026 trend) | Letters stretch, squash, reflow to audio; variable-font weight/width animation | Variable fonts with `font-variation-settings` interpolated per frame, per-letter springs |
| **3D / puffy / inflated type** | Bubble, balloon, and clay-like letterforms | R3F TextGeometry with bevel, matcap materials, soft shadows |
| **Liquid chrome / Y2K metallic** (subtler in 2026) | Chrome logos, holographic gradients | Env-map matcap, iridescent gradient shader |
| **Liquid glass** | Frosted translucent panels with refraction, moving to a "premium default" for UI | `backdrop-filter: blur`, refraction displacement shader, specular edge highlights |
| **Grain / analog / film** | Grain, dust, scratches, VHS bleed, paper textures | Noise shader overlay (2–6% opacity, animated per frame), chromatic aberration, gate weave |
| **Hand-drawn / scribble accents** | Loose strokes, circles around words, arrows | Rough.js-style jittered SVG paths with path-draw, boiled lines (re-randomize every 2–3 frames) |
| **Cutout / collage / zine** | Paper-cut layers, tape, torn edges, stop-motion timing | Animate "on twos" (12fps stepped), torn-edge masks, slight per-frame rotation jitter |
| **Clay / stop-motion CGI** | Soft, fingerprinted, tactile 3D | Matcap clay material, stepped animation, subsurface-like soft light |
| **Bold minimal / brutalist type** | Huge heavy type, raw grids, bright flat color, hard cuts | Full-bleed type at 30–60% of frame height, no easing (linear or stepped), monospace labels |
| **Isometric worlds** | Tiny iso cities and flows for systems and processes | 2:1 iso grid, `rotateX(60deg) rotateZ(45deg)` CSS, or orthographic camera |
| **Morphing UI** | Cards morph into buttons, then into charts (shared-element transitions) | Layout interpolation (FLIP), SVG path morph, border-radius springs |
| **Infinite zoom** | Endless nested scenes | Exponential scale with recursive compositions |
| **Oddly satisfying physics** | Soft-body squish, perfect fits, sorting, marble runs, kinetic sand slicing | Precomputed physics (matter.js / rapier) baked to frames, metaball shader, ASMR SFX |
| **Light-mode, screencast-heavy SaaS** | Real UI, captions, brighter frames (median brightness 117 → 154/255 in 2026) | Real screenshots/video in device frames, cursor choreography, burned-in captions ([Advids](https://advids.co/blog/ui-animation-motion-design-trends)) |

**Satisfying-motion principles [CRAFT]:** (1) **Precision fits**: things snap exactly into place. (2) **Completion**: progress bars and shapes always finish. (3) **Rhythm**: repetition with a steady period. (4) **Smooth easing**: spring or easeInOut, never linear for organic moves. (5) **Tactile sound**: clicks, squishes, pops at 1:1 sync. (6) **Seamless loop**: no visible end.

---

## 6. Hook Library (build recipes)

Legend: **KT** = kinetic text, **CAM** = camera punch/zoom, **MS** = morphing shapes, **MK** = masks, **PT** = particles, **SH** = shaders, **3D** = 3D device/object, **PD** = path draw, **CT** = counters. SFX listed last.

| Hook | Recipe |
|---|---|
| Claim slam | KT (scale 1.4→1, spring d12) + CAM (3-frame shake) + PT (dust burst) · SFX impact |
| Color flash interrupt | SH (invert/RGB split, 2–4f) + KT · SFX hit |
| Impossible transformation | MS (path morph A→B) + CAM (slow push-in) + PT (sparkle at midpoint) · SFX whoosh |
| Infinite zoom | CAM (exponential scale) + MK (nested windows) + SH (motion blur) · SFX riser loop |
| Macro snap-out | CAM (scale 4→1 easeOutExpo) + SH (blur→sharp) · SFX swish |
| Frame break | MK (mask release) + 3D/KT (z-pop) + shadow · SFX crack |
| Wait-for-it | PD/CT (progress fill) + CAM (slow push) · SFX riser → hit |
| Curiosity tease | MK (iris/redaction) + SH (blur/mosaic) + KT ("the #1…") · SFX tick |
| Countdown | CT (3-2-1 oversized) + KT + CAM punch per number · SFX tick ×3 + boom |
| Stat counter | CT (odometer) + KT (label) + CAM (pop on final) · SFX ticks → ding |
| Before/after | MK (linear wipe) + KT (labels) + PD (divider) · SFX swipe |
| Satisfying fit | MS (soft-body) + SH (metaball) + CAM (lock-off) · SFX squish/click |
| Seamless loop | MS/PD on modulo time + MK seam blend · SFX looped bed |
| Split-screen | MK (two clips) + KT (chips) + beat-synced swaps · SFX alt hits |
| Text-on-object | 3D (plane/corner-pin) + KT + SH (lighting) · SFX subtle |
| POV | KT (top chip "POV:") + CAM (first-person drift) + UI cursor · SFX UI clicks |
| Glitch entry | SH (RGB split, pixel sort, scanlines) + KT resolve · SFX digital crackle |
| Unexpected physics | MS/KT (rigid-body letters) + CAM follow · SFX bounces |
| Path-draw reveal | PD (stroke-dashoffset) + KT (fill-in) + PT (pen sparks) · SFX scribble |
| Chart breakout | PD (line) + CAM (follow up) + MK (overflow frame) + CT · SFX riser → hit |
| 3D device spin-in | 3D (rotY spring) + CAM (settle) + screen video · SFX whoosh + land |
| Wrong-answer | KT + PD (strike-through/❌) + SH (red flash) · SFX buzzer |
| Direct address | KT (word highlight in brand color) + CAM punch on keyword · SFX pop |
| Question | KT (word-by-word) + MS (? morph) · SFX soft pops |
| Mid-action start | timeline offset + CAM shake + PT debris · SFX in-progress impact |
| Rapid montage | hard cuts 0.3–0.5s + SH flash frames + KT · SFX beat-locked |
| Mascot double-take | MS (squash/stretch rig) + CAM zoom on face · SFX boing |
| Offer slam | KT ("-50%") + PT (debris) + SH (shockwave ring) + CAM shake · SFX boom |
| Map zoom | CAM (fly-to) + PD (route) + MS (pin bounce) · SFX whoosh + drop |
| Notification drop | MS (card spring from top) + KT + blur backdrop · SFX ding |

---

## 7. Pre-render checklist (AI director must pass all)

**Hook (0–3s)**
- [ ] Frame 0 has motion, content, and readable hook text (no black, fade-in, or logo intro).
- [ ] Hook stacks one visual mechanism, one text promise, and one sound event within 0.5s.
- [ ] Hook is understandable **muted** in ≤1s.
- [ ] Hook text ≤ 7 words and ≥ 80px on 1080-wide.
- [ ] Ads: product or brand appears by 1.5s, integrated into the hook.
- [ ] 3–5 hook variants generated for ads (same body).

**Retention**
- [ ] A visual state change at least every 3–5s (shorter per niche table). No static stretch over 5s.
- [ ] First value or proof delivered by 6s. Main payoff in the last 20%, partial payoff by 15s.
- [ ] Every open loop is closed (no clickbait).
- [ ] Duration fits the platform table.
- [ ] Organic: seamless loop (first/last frame diff under threshold) or a split-sentence loop. Ads: 1–2s CTA end card.

**Text & captions**
- [ ] Reading pace ≤ 5–10 words/sec. Each text beat stays on screen ≥ max(1.2s, words × 0.3s).
- [ ] Captions burned in for every spoken claim, with contrast ≥ 4.5:1 (stroke, shadow, or chip).
- [ ] All critical text, logo, product, and numbers sit inside the platform safe zone (Meta ads: top 14% / bottom 35% / sides 6%). Nothing in the right rail.

**Sound**
- [ ] Music cuts land on the beat grid. Whooshes peak on cut or landing frames. Impacts on type slams.
- [ ] Brand or CTA spoken if VO exists ("see and say"). Loudness about −14 LUFS for short-form.
- [ ] The video still works with sound off.

**Brand & format**
- [ ] Brand color, font, and logo bug consistent. Brand present early and throughout, never as the hook itself.
- [ ] Exports: 9:16 (1080×1920), 4:5 (1080×1350), 1:1, 16:9 as the platform needs. ≥720p. 30fps (LinkedIn below 30fps).
- [ ] No CTA button baked into Meta's bottom zone. No imitation of real platform or system UI or third-party brands.

**Safety & quality**
- [ ] No more than 3 flashes/sec (photosensitive epilepsy safety). Strobes are luminance-limited.
- [ ] Claims (numbers, prices, "#1") come from user data, not invented.
- [ ] Render a safe-zone debug overlay per platform and visually inspect the frames at 0s, 1s, 3s, 6s, and the end.
