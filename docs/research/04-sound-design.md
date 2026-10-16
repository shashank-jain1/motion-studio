# 04: Sound Design for Motion Graphics (craft, vocabulary, legal sourcing, intent-driven selection)

This is a research brief for the motion-studio sound system (`src/engine/audio/*`, `scripts/gen-sfx.ts`, `library/sfx/manifest.json`, `src/core/audioMaster.ts`). It was compiled in Oct 2026.

**Evidence legend:**
- **[DOC]**: a primary source such as a license text, official docs or a studio's own statement.
- **[PRACT]**: a practitioner tutorial or vendor blog.
- **[CRAFT]**: our own synthesis or observation from watching the work. It is not documented anywhere.

Studios almost never publish frame-level sound breakdowns. That includes Apple, Stripe, Linear, Vercel and the Buck/Antfood collaborations. Anything labelled [CRAFT] should be treated as a hypothesis to A/B test.

**Not legal advice.** Section 3 is a conservative reading of license texts as they read in Oct 2026. Re-read each license on the day files are downloaded and keep a copy with the files. Get a lawyer's sign-off before shipping third-party audio in a commercial SaaS.

---

## 0. Diagnosis: why the current system sounds "common, repetitive, basic"

Reading `autoSound.ts`, `gen-sfx.ts` and the manifest (36 synthesized files: 6 whoosh, 5 impact, 3 riser, 4 ui, 2 tick, 3 chime, 3 glitch, 3 magic, 5 foley, 2 bass) turns up these problems:

| # | Symptom | Where | Why it reads as "basic" |
|---|---|---|---|
| 1 | **One file per role per palette.** Every `pop` in a `tech` film is `pop-snap.wav`, every logo hit is `hit-slam.wav`, and so on. | `PALETTES` table | The ear spots an identical sample on its 2nd or 3rd repeat, the "machine-gun effect". Games solve this with random containers, avoid-repeat and pitch/volume jitter ([Unity Audio Random Container](https://docs.unity3d.com/Manual/AudioRandomContainer-UI.html), [Godot AudioStreamRandomizer](https://docs.godotengine.org/en/latest/classes/class_audiostreamrandomizer.html)). |
| 2 | **Everything is synthesized**: seeded noise, sines, an SVF filter and Freeverb. | `gen-sfx.ts` | Real premium SFX get their "expensive" quality from recorded micro-detail: material resonances, real air, real rooms and non-periodic transients. Filtered noise plus a sine thump is the sound of a 2010s preset. Pros layer recorded and synthetic material, "recorded whoosh with a synthetic one gives you the best of both" ([Violet Recording](https://violetrecording.com/how-to-make-whoosh-sounds/)). |
| 3 | **No runtime layering.** Each event plays exactly one file. | `planSound` → one `Cue` per event | A pro hit is 3–5 layers (transient + body + sub + tail + sweetener), each chosen for the moment ([Ableton](https://www.ableton.com/en/blog/learn-how-to-make-high-impact-sounds-for-movies-and-trailers/), [IRPR impact glossary](https://sounddesign.irpr.agency/glossary/impact/)). |
| 4 | **Sound ignores the music.** There is no key or chord awareness, and cues are not related to the beat grid even when `spec.beats` exists. | `autoSound.ts` never reads `bpm`/`beats`; `src/core/audio.ts` has no key detection | Tonal SFX (chimes, risers, booms, shimmer) clash with the track's key. Pitched risers "pair well with a key and land on a chord" ([IRPR riser glossary](https://sounddesign.irpr.agency/glossary/impact/), [Audiokinetic Q&A on harmonising UI sounds](https://blog.audiokinetic.com/qa/10334/harmonising-ui-sounds-according-to-music)). |
| 5 | **The mapping is by event type, not intent.** Transition → whoosh and slam → impact, whatever the beat's role in the story. | `Planner.*` | Premium work is subtractive. Most motions get no sound, a few get signature sounds, and silence is used before reveals ([Krotos trailer tips](https://www.krotosaudio.com/trailer-sound-design-tips-tricks/), [Rareform on stopdowns](https://www.rareformaudio.com/blog/trailer-music-drop-vs-stopdown)). Our `intensity` threshold drops low-priority cues uniformly, which is not the same thing. |
| 6 | **Rate changes preserve pitch.** | `Cue.rate` comment: "time-stretch, pitch preserved" | The physical cue for size and weight is pitch: bigger means lower and slower ([Morphic whoosh guide](https://morphic.com/resources/sounds/whoosh-sound-effect)). We cannot make a big object sound bigger. Remotion exposes `preservePitch` and `toneFrequency` on audio (see `node_modules/remotion/dist/cjs/audio/props.d.ts`), but pre-rendered pitched variants are safer for Player/render parity. |
| 7 | **Coarse palettes.** There are 6 labels, and `luxury`/`minimal`/`cinematic` share most files. | `PALETTES` | A brand's "sonic palette" is defined by material, tonal centre and envelope ([Material sound choreography](https://m2.material.io/design/sound/sound-choreography.html), [Swell sonic branding FAQ](https://swellmusicsound.com/learn-more/sonic-branding-faq-strategy-process-and-investment/)). A mood word is not enough. |
| 8 | **No stereo movement.** Pan does not follow on-screen x-motion. | `SoundTrack.tsx` | Following lateral motion with pan is a basic motion-graphics technique ([Lynda "Sound Design for Motion Graphics"](https://www.lynda.com/Audition-tutorials/Creating-motion-through-sound/175586/414218-4.html)). |
| 9 | **No glue.** Each file bakes its own Freeverb room. There is no shared bus reverb and no EQ carve against the music, only volume ducking. | `gen-sfx.ts`, `SoundTrack.tsx` | Different baked spaces make the sounds read as pasted on, not as one designed world. |

What already works and should be kept: the `peakAt` apex alignment, whoosh length fitted to the move, the volume hierarchy, the duck envelope, the de-dup rules (80 ms apex spacing, ≤3 bodies, one hit per 220 ms), voice allocation, and −14 LUFS mastering. These are correct pro rules. The problems are **material, variety, layering, musicality and restraint**.

---

## 1. How pro motion-design sound is made

### 1.1 Who does it and what is documented

| Studio / team | Known for | What is documented about their method |
|---|---|---|
| **Antfood** (Brooklyn/Lisbon/LA) | Sound and music for motion design: CBS sonic rebrand, US Open, Buck films | They join at concept stage and treat music, sound design and audio post as one discipline. They explore broadly, then refine. They blend analog capture with digital processing, starting in Ableton/Max and finishing in Pro Tools ([Motionographer "The other half with Antfood"](https://motionographer.com/2018/09/05/the)). For Buck's *The Art Department*, sound was built from the same keywords, themes and colours Buck used for the visuals. It was one palette ("The Zone") of organic recordings, processed real instruments and analog synths, mapped onto Buck's visual objects ([LBB](https://lbbonline.com/news/the-art-department-representing-the-creative-process), via search summary). *Christopher at Sea* took ~10 months of sound design, from ocean beds to tiny foley ([Antfood Labs](https://antfood.com/labs/christopher-at-sea)). [DOC] |
| **Wesley Slover / Sono Sanctus** | Brand + UX sound: Discord, Asana, Dolby, Spotify, Google, Airbnb | "Outcome-first" audio: decide what the sound must *do* (grab attention, reduce friction, build confidence, recede) before deciding how it sounds. Avoid temp tracks ("demo love"). Build a *system*: an audio logo defines the palette, which then extends into UX and product sounds. Don't chase trendy "cool" sounds that undermine credibility. Keep sound subtle relative to context ([By The Booth interview](https://www.bythebooth.com/insights/creative-tangent-wesley-slover-sound-the-invisible-brand-layer); also [Motion Hatch ep. 13](https://motionhatch.transistor.fm/episodes/013-how-to-think-about-sound-design-music-as-an-animator-w-wesley-slover)). [DOC] |
| **Sonic Union** (NYC) | Mix/sound for brand spots; also motion design in-house | Studio background only (founded 2008 by mixers). No published method ([Shoot](https://shootonline.com/?p=118465)). |
| **Echolab** (Gavin Little) | Cinematic sound + audio branding for ads, trailers, VR | Talks on "the link between motion and sound". No published recipe found ([DDD speaker page](https://milano.ddd.live/program/speakers/gavin-little/)). |
| **Plan8, Mint Sound, Swell, AMP** | Sonic branding agencies | Typical deliverable: **mnemonic + sonic palette + deployment guidelines + (optional) music library**. The palette doc lists instrumentation, tempo range, mood and explicit "not this" examples ([Swell FAQ](https://swellmusicsound.com/learn-more/sonic-branding-faq-strategy-process-and-investment/), [AMP](https://ampsoundbranding.com/sonic-identity-experience)). Nothing Plan8- or Mint-specific was found publicly. |
| **Apple** | Product films, keynote, UI sound | UI-sound philosophy is covered in Twenty Thousand Hertz with Apple's design team: Tri-tone history, Apple Watch sounds ([20k "Facebook & Google Pixel"/Apple episodes](https://20k.org/episodes/facebook-and-google-pixel)). Product-film sound credits are not public. Observed [CRAFT]: hyper-real, close-miked material foley (aluminium, glass, magnets, soft clicks) cut on exact frames, very sparse, often over near-silence or a pulsing bed, with the tonal parts in the music's key. |
| **Google** | Pixel/Material sound | Material: sounds that follow each other in a flow should share timbre, melody or envelope, and grouped sounds form a set ([Material sound choreography](https://m2.material.io/design/sound/sound-choreography.html)). Sound lead Conor O'Sullivan: feedback "doesn't jump out too much" ([Google Design](https://design.google/library/google-pixel-sound-design-ux-conor-osullivan)). [DOC] |
| **Stripe / Linear / Vercel launch films** | "Premium SaaS" launch aesthetic | **No public sound credits or breakdowns were found.** Observed [CRAFT]: a music-led mix with few SFX. The SFX are soft, low-mid "thocks", airy filtered whooshes, glassy UI ticks tuned to the track, sub drops only at the 1–2 biggest moments, and a hard music stop or filter-down before the product/logo reveal. |
| **TikTok / brand idents** | Sound-on short form | Sound lifts Shorts ad conversions by more than 20% (see doc 03). Idents typically run 2–5 s; one academic summary reports an average of ~2.7 s with 3–5 tones ([IRPR sonic logo guide](https://sounddesign.irpr.agency/guides/how-to-design-a-sonic-logo/), [Heardis](https://www.heardis.com/services/sound-logo/)). |

### 1.2 Principles, turned into concrete rules

**A. Layering (the anatomy of a designed sound).** [PRACT] ([Ableton](https://www.ableton.com/en/blog/learn-how-to-make-high-impact-sounds-for-movies-and-trailers/), [IRPR impact](https://sounddesign.irpr.agency/glossary/impact/), [IRPR sweetener](https://sounddesign.irpr.agency/glossary/sweetener/))

| Layer | Band | Job | Typical source | Timing relative to apex |
|---|---|---|---|---|
| Transient / click | 2–10 kHz | Defines sync and perceived power ("the ear judges power by the attack") | Recorded snap, stick, metal tick, paper flick, keyboard | Exactly at apex (0–5 ms) |
| Body | 150 Hz–2 kHz | Identity: *what* material hit | Recorded material foley: wood knock, glass tap, plastic, cardboard thump, kick | Apex → +80–300 ms |
| Sub | 30–90 Hz | Weight, felt not heard | Synth sine/808 drop, **tunable to key** | Apex → +200–1500 ms |
| Tail / space | Broadband, HP'd | Size of the world: a short tail is small, a long tail is epic | Reverb send, reversed tail, metallic ring-out | +50 ms → +2 s |
| Air / sweetener | 6–16 kHz | Sparkle and "expense", sits under consciousness | Shimmer, breath, noise burst, granular glints | Around the apex, −6 to −15 dB |

- Rule: **EQ every layer into its own band** and never let two layers fight in the same octave. Ableton: "EQ every layer individually".
- Rule: the **sweetener is mixed so you don't consciously hear it, but you'd miss it** (IRPR).
- Rule: **only the body layer carries the material.** Transient, sub and air are largely generic and are the parts a synthesizer can supply.

**B. Hyper-real vs abstract.**
- *Hyper-real* is recorded foley exaggerated: closer mic, cleaner, bigger. Use it when the screen shows physical objects such as devices, cards, paper, product hardware or 3D objects. It is Apple's language.
- *Abstract* is synthetic or tonal. Use it when the screen shows flat shapes, data, gradients, light or particles.
- Premium work **chooses one per film (or per world) and stays consistent**. Mixing a cartoon "boing" with a hyper-real glass tap breaks the world. [CRAFT]
- Rule: abstract visuals can take hyper-real sound for a "tactile" brand (paper-cut, clay, glass UI). Hyper-real visuals should not take cartoon sound unless the brand is playful.

**C. Sonic palette and identity.** A brand's sound is defined by (1) **material family**, (2) **tonal centre / key and scale**, (3) **envelope shape** (snappy versus soft attack, short versus long tail), (4) **space** (dry/close versus big hall), and (5) a **mnemonic** of 2–5 s. Sounds adjacent in a flow should share timbre, melody or envelope ([Material](https://m2.material.io/design/sound/sound-choreography.html)). The palette should include explicit "not this" examples ([Swell](https://swellmusicsound.com/learn-more/sonic-branding-faq-strategy-process-and-investment/)). Antfood/Buck derived the palette from the *same keywords and colours* as the visuals (LBB). That maps directly onto our `concept`/style data.

**D. Material-based design.** Pick 1–2 materials per film and derive every UI tick, pop, landing and transition from them [CRAFT]:

| Material | Visual cue | Sound character | Good for |
|---|---|---|---|
| Glass / crystal | Glassmorphism, refraction, chrome | Bright tonal ping, inharmonic partials, long shimmer | Luxury, fintech, AI |
| Metal (thin/aluminium) | Devices, hardware, chrome type | Tight click plus a short metallic ring | Apple-style product |
| Metal (heavy) | Big 3D slabs, industrial | Clang, low resonance, long ring | Hype, automotive |
| Paper / card | Cards, lists, docs, flat illustration | Flick, slide friction, soft thump | Productivity SaaS, editorial |
| Wood | Organic, craft, warm brands | Knock, hollow resonance | Wellness, food, craft |
| Plastic / rubber | Toy-like 3D, playful | Bounce, squeak, dull pop | Kids, playful consumer |
| Liquid | Blobs, morphs, gradients, liquid logo | Bloops, drips, pours, underwater swells | Morph, liquid reveal |
| Digital / electric | Data, HUD, code, glitch | Bleeps, bitcrush, servo, sine blips | Dev tools, cyber |
| Air / cloth | Soft UI, fades, floaty | Breath, fabric swish, low whoosh | Minimal, calm |
| Organic / body | Characters, hand-drawn | Mouth pops, finger snaps, claps | Social, friendly |

**E. Pitch and rhythm relationships with music.**
- **Tonal SFX must be in the track's key**: chimes, shimmer, sub drops, booms with a pitch, tonal risers, mnemonics. Noise-based whooshes, clicks and most transients are key-agnostic ([IRPR riser](https://sounddesign.irpr.agency/glossary/impact/)). Game audio does the same thing for UI sounds ([Audiokinetic Q&A](https://blog.audiokinetic.com/qa/10334/harmonising-ui-sounds-according-to-music)).
- Rule: a sub/boom is tuned to the **root** (or the fifth). A chime/ding uses notes of the **tonic triad** (root, 3rd, 5th, octave). Rising sparkles use the **pentatonic** of the key, which can't clash.
- Rhythm: the hits that matter land **on downbeats**. Minor UI ticks may fall on 8th or 16th subdivisions. Ticks on a counter should be quantized to the grid when a grid exists. A whoosh's apex lands on the beat the cut is on.

**F. Spatialization.** Pan follows the on-screen x-velocity: a lateral whoosh sweeps L→R, with equal-power pan limited to ±0.6 so it survives mono phones. Big/close elements are wider in stereo and small/far ones narrower. Subs stay **mono and centred**. On 9:16 (phone, often mono speaker) keep pan subtle. [PRACT]+[CRAFT] ([Lynda](https://www.lynda.com/Audition-tutorials/Creating-motion-through-sound/175586/414218-4.html), [Ableton](https://www.ableton.com/en/blog/learn-how-to-make-high-impact-sounds-for-movies-and-trailers/))

**G. Dynamics and silence.**
- "The quiet before a hit matters as much as the hit." Constant loudness leaves impacts "nowhere to land" ([IRPR](https://sounddesign.irpr.agency/guides/why-does-my-trailer-lack-impact/)).
- A **stopdown** (music cuts for a beat, then returns) makes the drop feel bigger ([Rareform](https://www.rareformaudio.com/blog/trailer-music-drop-vs-stopdown)).
- Krotos recipe: build a riser, then cut almost everything and leave "only a transient of the hit and a low-end drop", creating a void ([Krotos](https://www.krotosaudio.com/trailer-sound-design-tips-tricks/)).
- Rule for us: **before the hero reveal** (logo, product, key claim) duck or filter the music to −12 to −20 dB for 0.25–1.0 s (or 1–2 beats), optionally with a reverse swell. Then hit, and bring the music back on the downbeat.
- Rule: **an aftershock**. After a big hit, keep a low drone or tail instead of instantly piling on more SFX (Krotos).

**H. Micro-variation (anti-repetition).**
- Round-robin / random-without-repeat (Unity "Avoid Repeating Last").
- Pitch jitter in cents or semitones and volume jitter in ±dB ([Godot](https://docs.godotengine.org/en/latest/classes/class_audiostreamrandomizer.html)).
- Randomised layer banks: "four banks of five assets = 625 combinations" ([Krotos](https://www.krotosaudio.com/trailer-sound-design-tips-tricks/)).
- Typical values [CRAFT]:

  | Element | Pitch jitter | Volume jitter | Timing jitter | Avoid-repeat |
  |---|---|---|---|---|
  | UI ticks/pops | ±50–100 cents | ±1.5 dB | 0–8 ms | last 3 |
  | Hits | ±30 cents (and keep in key) | ±1 dB | — | last 2 |
  | Whooshes | ±1 semitone (noise, so free) | ±1 dB | — | — |

- Rule: **an entrance and its matching exit should be related but not identical**. Mirror the same family, reverse it or pitch it down ([Lynda](https://www.lynda.com/Audition-tutorials/Stretching-shrinking-sound-effects-picture/175586/414212-4.html)).

**I. Design to the picture's speed, size and weight.**
- Bigger means lower, slower and longer tail. Faster means higher, shorter and brighter. A falling pitch reads heavy, thin reads air ([Morphic](https://morphic.com/resources/sounds/whoosh-sound-effect), [Krotos whoosh tutorial](https://sound.krotosaudio.com/?p=1555)).
- Concrete mapping [CRAFT]:
  - Object screen area 2× → −2 to −3 semitones, tail +30%.
  - Move speed 2× → whoosh +2 to +4 semitones, length ×0.6.
  - Overshoot/bounce → one soft secondary tick at the settle frame, −8 dB.
  - A long move with a hard landing → riser/whoosh **into** a short hit, not a whoosh *after* the landing.

**J. Sync.**
- Audio *leading* picture is detected sooner than audio lagging. ITU-R BT.1359: detectability is about +45 ms audio early and −125 ms audio late ([TV Technology](https://www.tvtechnology.com/opinions/av-synchronization-how-bad-is-bad), [ForaSoft summary](https://www.forasoft.com/learn/audio-for-video/articles-audio/lip-sync-itu-r-bt-1359-tolerance-windows)).
- Rule: transient **on the impact frame**, or at most 1 frame early at 30 fps (33 ms). Never 2 or more frames early. 0–2 frames late is acceptable and often feels "heavier".
- Whoosh apex: on the cut frame or the frame of maximum velocity. Riser apex: exactly on the cut. A reverse swell ends on the frame *before* the hit.
- Our `peakAt` system already implements this. Keep it.

**K. Mixing.**
- SFX bus: HP at 30–40 Hz (except sub layers). Carve 2–4 kHz in the music by 2–3 dB under transients (dynamic EQ or multiband sidechain) instead of only full-band ducking.
- **One shared reverb send** (a short plate for "product" films, a hall for "epic" ones) on all non-sub layers glues the sounds into one space. Records should be stored **dry**.
- Sidechain the music under hits: our duck envelope already does this.
- Master: −14 LUFS, −1 dBTP (already done in `audioMaster.ts`).
- Check that sub layers carry harmonics (saturation) so phones reproduce the weight. `drop-bass` already does this.

### 1.3 Stock whooshes vs premium sound design: the checklist

| "Basic stock" | Premium |
|---|---|
| Same file for every instance | Variant pools, pitch/volume jitter, layer re-combination |
| Sound on every motion | 30–50% of motions sounded. Silence is designed in. |
| Generic whoosh on every cut | Cut sound reflects *what* moves (material) and *how big* (pitch/length) |
| SFX in random keys over the music | Tonal SFX tuned to the music's key; sub on the root |
| Each file has its own baked reverb | Dry sources, one shared space |
| Even loudness throughout | Energy curve: quiet → build → stopdown → hero hit → aftershock |
| Hit placed "near" the frame | Transient on the frame, apex-aligned, whoosh length = move length |
| Stereo-static | Pan follows motion; width follows size |
| One-layer sounds | Transient + body + sub + tail + air, band-separated |
| Palette = "cinematic" | Palette = materials + tonal centre + envelope + space + mnemonic |

---

## 2. Sound vocabulary for motion graphics (84 types)

Duration is the typical file length. "Layers" follows §1.2A: T = transient, B = body, S = sub, Tl = tail, A = air. "Tonal" means it should be key-tuned.

### 2.1 Transitions and whooshes (by speed and size)

| Type | Use when / visual | Emotion | Layers | Dur |
|---|---|---|---|---|
| Whoosh – micro | Tiny element flicks in; icon slide | Light, nimble | A (band-passed noise 3–8 kHz) | 0.1–0.25 s |
| Whoosh – short/tight | Whip pan, fast push, word slide | Energy | A + faint B swish | 0.25–0.5 s |
| Whoosh – medium | Card/scene slide, standard push | Neutral momentum | B swish + A | 0.5–0.8 s |
| Whoosh – long pass-by | Slow camera move, big object crossing | Cinematic, grand | B + S rumble + doppler pitch fall | 0.8–1.6 s |
| Whoosh – heavy/deep | Zoom-through, huge object | Power | S + B + A, pitch falling | 0.7–1.2 s |
| Whoosh – airy/breath | Elegant fade, soft slide, luxury | Calm, refined | A only (breath, fabric) | 0.5–1.0 s |
| Swish – cloth/fabric | Ribbon, curtain wipe, soft mask | Organic, tactile | B (fabric) | 0.3–0.6 s |
| Whip – zip | Whip transition, rapid zoom | Snappy, comedic, hype | A + tonal zip (pitch up) | 0.15–0.35 s |
| Swoosh-up (rising) | Zoom-into, element launching up | Uplift, anticipation | A + tonal rise into click | 0.4–0.7 s |
| Swoosh-down (falling) | Exit, drop, settling | Release, closure | A + pitch fall | 0.4–0.7 s |
| Doppler pass | Object flies past camera | Speed, 3D depth | B with pitch fall + pan sweep | 0.5–1.0 s |
| Spin/rotational whoosh | Spin-in, flip, card rotate | Playful, dynamic | AM-modulated noise (rate = rotation) | 0.3–0.8 s |
| Reverse swell / suck | Into a cut, mask reveal, expand | Tension → release | Reversed reverb tail (tonal, tuned) | 0.5–2 s |
| Glitch cut | Glitch transition | Digital disruption | Bitcrush bursts + digital clicks | 0.1–0.5 s |
| Tape stop | Hype stop, "record scratch" moment | Humour, interruption | Pitch-dive of the music itself or a chord | 0.3–0.8 s |
| Paper/page flip | Book-flip, card flip, slice | Editorial, tangible | B paper + T flick | 0.2–0.5 s |
| Shutter / iris | Camera wipe, photo reveal | Snapshot | T mechanical double click | 0.1–0.3 s |
| Film burn / light leak | Film-burn transition | Nostalgic, warm | Projector flutter + soft swell | 0.6–1.5 s |
| Underwater / filter sweep | Dreamy zoom, ripple, crosswarp | Dreamy, surreal | LP sweep on the bed + bubbles | 0.5–1.5 s |
| Match-cut tick | Match cut | Clever, precise | Single soft T, tonal | 0.05–0.2 s |

### 2.2 Impacts and hits (by weight)

| Type | Use when / visual | Emotion | Layers | Dur |
|---|---|---|---|---|
| Tap / tick-hit | Small element lands | Precise | T + tiny B | 0.05–0.15 s |
| Soft thud (felt) | Small type lands, card settles | Gentle, friendly | B (felt/cardboard) + light S | 0.2–0.5 s |
| Punch | Camera punch, beat-synced word | Energy, confidence | T (crack) + B (kick) | 0.3–0.7 s |
| Slam | Type slam, big claim | Assertive | T + B + S + short Tl | 0.5–1.0 s |
| Heavy impact | Hero object lands, logo lock | Epic, power | T (metal) + B + S drop + long Tl | 1.5–3 s |
| Boom / sub drop | Shake, beat drop | Gravity, awe | S (tuned) + saturation | 1–3 s |
| Braam | Trailer title, dramatic reveal | Ominous, monumental | Low brass layers in octaves + reverb ([Ableton](https://www.ableton.com/en/blog/learn-how-to-make-high-impact-sounds-for-movies-and-trailers/)) | 2–5 s |
| Metallic clang | Industrial slab, heavy 3D | Hard, cold | B (metal) + ring Tl | 1–2 s |
| Glass hit / tink | Glass card lands | Premium, fragile | T + tonal ring (tuned) | 0.3–1.5 s |
| Wood knock | Organic brand landing | Warm, honest | B (wood) | 0.1–0.3 s |
| Stomp / clap | Rhythmic social edits | Human, fun | Body percussion | 0.1–0.4 s |
| Downer | Exit to dark, failure, before a twist | Deflation | Pitch-falling tonal + S | 1–3 s |
| Flash hit | Flash transition, white frame | Shock | Bright T + noise burst + S | 0.3–1.0 s |
| Logo hit | Logo resolves | Finality, brand | Brand material body + tuned S + Tl + air | 1–3 s |

### 2.3 Risers, builds and swells

| Type | Use when | Emotion | Layers | Dur |
|---|---|---|---|---|
| Noise riser | Build into a cut, key-agnostic | Tension | Filtered noise, rising HP/LP + volume | 1–4 s |
| Tonal riser | Build into a drop **in key** | Musical anticipation | Pitch-rising synth/strings (tuned), LFO speeding up | 1–4 s |
| Shepard riser | Long suspense, infinite zoom | Endless tension | Shepard tone stack | 3–10 s |
| Reverse cymbal | Short lead into a hit | Classic anticipation | Reversed cymbal | 0.5–2 s |
| Swell (pad) | Slow logo or hero reveal | Wonder | Tuned pad crescendo | 1–3 s |
| Tick-tock build | Countdown, loading | Urgency | Accelerating ticks on the grid | 1–4 s |
| Heartbeat build | Suspense before a reveal | Anxiety | Low lub-dub, accelerating | 1–4 s |
| Stopdown / void | Right before hero hit | Breath-hold | *Silence* or LP filter on the music (a mix action, not a file) | 0.25–1 s |

### 2.4 UI and product

| Type | Use when | Emotion | Layers | Dur |
|---|---|---|---|---|
| Click (button) | Cursor press, toggle | Confirmation | T (plastic/metal) | 20–80 ms |
| Tap (soft) | Touch interaction, card settle | Gentle | T soft + B | 50–120 ms |
| Toggle on/off | Switch flips | Binary state | Two-tone T, up = on, down = off | 80–150 ms |
| Hover / focus | Cursor over element | Subtle attention | A blip −15 dB | 30–100 ms |
| Notification ping | Notification/toast card | Alert, friendly | 2-note tonal (tuned) | 0.3–0.8 s |
| Success / confirm | Checkmark, task done, payment | Satisfaction | Rising major 3rd/5th (tuned) | 0.3–1.2 s |
| Error / deny | Red state, failed | Friction | Falling minor 2nd or a low buzz | 0.2–0.5 s |
| Message send | Chat bubble right | Momentum | Short swoosh-up + pop | 0.2–0.4 s |
| Message receive | Chat bubble left | Arrival | Pop + soft tonal | 0.2–0.4 s |
| Keyboard typing | Typewriter/terminal text | Process, human | T keycaps, round-robin, timing jitter | 30–90 ms each |
| Cursor move | Fake cursor glides | Guidance | Very soft A (often silent) | — |
| Scroll tick | List scroll, picker | Tactile | Detent ticks on the grid | 20–50 ms |
| Slider / drag | Value scrub | Continuous control | Grainy friction loop with pitch tied to value | var |
| Camera shutter | Photo capture, screenshot | Snapshot | T mechanical | 0.1–0.3 s |
| Haptic thunk | Face ID / Apple Pay success | Premium confirm | S thump + T (Apple-like) | 0.1–0.3 s |
| Cash / coin | Price, revenue counter | Reward | Coin clink + bell | 0.3–0.9 s |

### 2.5 Typography and data

| Type | Use when | Emotion | Layers | Dur |
|---|---|---|---|---|
| Letter tick cascade | Per-char reveals (stretch, pop) | Precision | **One** gesture sound, not one per char; or ≤6 ticks on the grid | 0.2–0.8 s |
| Word punch | Word-by-word kinetic type on beats | Rhythm | T + B per word, quantized to beats | 0.1–0.3 s |
| Scramble / decode | Scramble text, hacker reveal | Tech, mystery | Digital bleeps random-pitched in scale | 0.3–1 s |
| Counter roll ticks | Number roll-ups | Momentum | Tick round-robin, rate-limited, getting brighter as it nears the end | 30–60 ms each |
| Counter land | Final value lands | Payoff | Ding (tuned) or soft hit | 0.3–1.2 s |
| Slot-machine roll | Slot text swap | Fun, chance | Ratchet + click on each stop | 0.2–0.6 s |
| Chart grow | Bars/lines draw | Growth | Rising tonal glide (tuned) or soft whoosh | 0.5–1.5 s |
| Data blip | HUD element, data point appears | Tech | Sine blip (tuned, pentatonic) | 30–100 ms |
| Underline / stroke draw | Line or path draws on | Craft | Pen/marker scratch or a filtered noise line | 0.3–1 s |
| Highlight swipe | Marker highlight | Emphasis | Marker squeak or soft swish | 0.2–0.5 s |

### 2.6 Reveals, magic, shimmer and liquid

| Type | Use when | Emotion | Layers | Dur |
|---|---|---|---|---|
| Shimmer | Logo draw, sparkles | Magic, premium | Tuned glassy partials + A | 0.8–2 s |
| Sparkle / glint | Single highlight glint across chrome | Polish | Tiny high tonal ping (tuned) | 0.1–0.4 s |
| Fairy-dust arpeggio | Confetti, success | Delight | Pentatonic glints, rising | 0.5–1.2 s |
| Bloom / light reveal | Glow-up, light rays | Awe | Pad swell + air | 1–2 s |
| Mask reveal | Wipe/mask uncovers | Discovery | Reverse swell → soft hit | 0.5–1.5 s |
| Blob / bloop | Liquid morph, blob pop | Playful, organic | Liquid drop (pitched) | 0.1–0.4 s |
| Pour / splash | Liquid fill, wave transition | Fresh | Recorded liquid | 0.5–2 s |
| Drip | Liquid logo, melt | Viscous | Drip + small reverb | 0.1–0.3 s |
| Morph wobble | Shape morph | Transformation | FM/rubber stretch + soft land | 0.4–1 s |
| Bubble pop | Chat, stickers, bubbles | Light, fun | Pitched pop | 0.1–0.2 s |
| Particle burst | Burst particles | Celebration | Pop + scatter of tiny ticks | 0.3–0.8 s |
| Portal / whomp | Zoom-into a window, dimension shift | Sci-fi wonder | Reverse + sub + phaser | 0.8–2 s |

### 2.7 Mechanical, digital, glitch, organic foley and beds

| Type | Use when | Emotion | Layers | Dur |
|---|---|---|---|---|
| Servo / motor | Robotic 3D movement, device rotates | Precision engineering | Motor whine, pitch tied to speed | 0.3–2 s |
| Latch / lock | Pieces snap together, assemble | Satisfying fit | Metal/plastic latch double-click | 0.1–0.3 s |
| Magnet snap | Elements attract/snap (actor snapTo) | Satisfying | Click + tiny ring | 0.1–0.3 s |
| Gear ratchet | Dial, rotation steps | Mechanical | Ratchet ticks | var |
| Power-up hum | Device turns on | Activation | Rising hum + click | 0.5–1.5 s |
| Power-down | Screen off, ending | Closure | Falling hum | 0.5–1.5 s |
| Electric zap | Energy connection, line links | Charge | Arcs + crackle | 0.1–0.5 s |
| Digital glitch burst | Glitch text, error | Disruption | Bitcrushed burst | 0.1–0.6 s |
| Data stream | Code rain, data flows | Processing | Granular bleeps (bed) | loop |
| Modem / signal | Connection, network | Retro tech | FSK chirps | 0.3–1 s |
| Finger snap | Instant appear | Casual magic | Recorded snap | 0.1 s |
| Paper crumple | Discard, delete | Rejection | Recorded paper | 0.3–0.8 s |
| Footstep / walk-cycle | Character animation | Narrative | Recorded steps, round-robin | 0.1 s each |
| Room tone / air bed | Under quiet passages, so silence isn't "dead" | Presence | Recorded room/air at −40 dB | loop |
| Texture bed (tonal drone) | Under intro/suspense | Mood | Tuned drone/pad | loop |
| Nature bed | Outdoor/eco brands | Calm, place | Wind/birds/water | loop |
| City/crowd bed | Social proof, events | Energy | Crowd walla | loop |

### 2.8 Stingers and sonic logos

| Type | Use when | Emotion | Layers | Dur |
|---|---|---|---|---|
| Mnemonic (brand) | End card / logo | Brand recall | 3–5 tuned notes in the brand material + logo hit ([IRPR](https://sounddesign.irpr.agency/guides/how-to-design-a-sonic-logo/)) | 1.5–4 s |
| Stinger (short) | Section/chapter cards | Punctuation | Hit + tuned chord | 0.5–2 s |
| Bumper | Loop point, series ident | Familiarity | 2-note motif | 0.5–1.5 s |
| Button end | Music ends on a hit (not a fade) | Confidence | Final chord + hit + tail | 1–3 s |

---

## 3. Legal sourcing of recorded SFX (most important section)

### 3.1 What our product does with audio, and why it matters legally

1. **Server-side storage and streaming of raw files.** The web Player loads `/library/sfx/<name>.wav` directly in the user's browser. Any visitor can download the raw file.
2. **Baking into user videos.** Our users, who are third parties to any license *we* hold, render videos containing the sounds and publish them commercially.
3. **A tool or SDK, not a finished work.** Motion Studio is a *creation tool* that supplies sounds to others for use in *their* projects.

Most royalty-free SFX licenses allow (2) when *the licensee* makes the video. They usually **forbid (1) and (3)**: supplying sounds "as sound effects" to others, standalone distribution, SDK/template/asset-pack inclusion, or replicating a competing service. **Only public-domain (CC0) material, or a negotiated platform/API license with end-user sublicensing, is clean for all three.**

### 3.2 Source-by-source

| Source | License (exact) | Commercial use | Redistribution / bundling in our SaaS | Attribution | Automated download / API | Quality & size | Verdict |
|---|---|---|---|---|---|---|---|
| **Freesound – CC0 subset** | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) per sound ([FAQ](https://freesound.org/help/faq/)) | Yes | **Yes.** CC0 waives rights, so streaming raw files and baking them is fine. | Not required. Keep a provenance ledger anyway. | API: originals need OAuth2. Token auth gives search plus ~128 kbps MP3 / ~192 kbps OGG previews ([API docs](https://freesound.org/docs/api/resources_apiv2.html)). **API ToS: "Terms for commercial use of the API will be negotiated on a case by case basis with UPF"**. Bans "full copies of the database" and making Content available "from any location" via the API ([API ToS](https://freesound.org/help/tos_api/)). | Very uneven, from pro field recordings to phone junk. ~671k sounds total at end-2024; **72% of 2025 uploads were CC0** ([Freesound 2025](https://blog.freesound.org/?p=2347), [UPF](https://www.upf.edu/en/web/focus/w/20-years-freesound-platform)). Descriptors include brightness, loudness, pitch, tonality, onset_count. | **Bundle: YES**, via a curated, hand-reviewed set. Don't run a live API proxy in production without a UPF commercial agreement. |
| **Freesound – CC BY 4.0** | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Yes | Legally yes, but attribution travels with every user video | **Required** ("always mention the original creators") | Same | Many of the best recordists use BY | **Avoid for the auto library.** Every user video would need credits. Usable only if we auto-generate a credits block and users accept it. |
| **Freesound – CC BY-NC / Sampling+** | CC BY-NC 4.0; legacy Sampling+ (no ads) | **No** | No | — | — | — | **Exclude.** Filter `license:"Creative Commons 0"` only. |
| **Kenney.nl audio** | **CC0** ("all game assets… public domain licensed (CC0)", [Kenney support](https://kenney.nl/support)). Packs: Interface Sounds (100), UI Audio (50), Impact Sounds (130), Sci-fi Sounds (70), Digital Audio, RPG Audio, Casino Audio, Music Jingles ([kenney.nl audio](https://kenney.nl/assets/category:Audio), [interface](https://kenney.nl/assets/interface-sounds), [impact](https://kenney.nl/assets/impact-sounds), [ui-audio](https://kenney.nl/assets/ui-audio), [sci-fi](https://kenney.nl/assets/sci-fi-sounds)) | Yes | **Yes** | Optional; don't use the Kenney logo | Plain ZIP downloads, no API | Game-grade: short, clean, often OGG, somewhat "gamey". Good as transient/UI/impact **layers**, not as hero sounds. ~500 files total. | **Bundle: YES** (layer material) |
| **OpenGameArt – CC0 subset** | Per-asset; filter to CC0. E.g. Owlish Media "Sound Effects Pack" is CC0, 142 MB: impacts (metal/ceramic/dull), paper, UI, sci-fi, water, footsteps, fabric ([OGA](https://opengameart.org/content/sound-effects-pack)) | Yes (CC0 items) | **Yes (CC0 items only)**. Many items are CC-BY/CC-BY-SA/GPL, e.g. ViRiX UI pack is CC-BY 3.0. | CC0: no | Site downloads only | Mixed. The Owlish pack is a good real-material source (paper, ceramic, water). | **Bundle: YES**, CC0 items, checked one by one |
| **Sonniss GDC bundles** | "Sonniss GDC Game Audio Bundle" license, **v2.0 effective 27 Aug 2026** ([license](https://sonniss.com/gdc-bundle-license/)) | Yes, "personal and commercial projects", no attribution | **NO.** Licensee "may not distribute, publish, sub-license or otherwise supply the sound effects as sound effects to any other person… whether… modified or re-designed… as part of a sound effects library, sample pack, asset pack, project template, **software development kit** or anything similar." Finished projects are OK. | No | n/a (manual download) | Excellent: pro libraries, 20–30 GB per year, 96/24 WAV | **Do not bundle.** A user may upload Sonniss files into *their own* project (see §3.4). **Also: "No AI Training"**, so never use it to train or fine-tune a generator. |
| **Pixabay sound effects** | [Pixabay Content License](https://pixabay.com/service/license-summary/) / [Terms](https://pixabay.com/service/terms/) | Yes, no attribution | **NO for bundling.** "You cannot sell or distribute the Content… on a Standalone basis" (Standalone = no creative effort applied, substantially the same form). Bans using/compiling Content "to replicate a similar or competing service". "Bulk, large-scale or systematic copying… strictly prohibited" without permission. Scraping banned. | No | Scraping prohibited; the public API is images/video (we could not confirm an audio endpoint) | Good, large, uneven | **Do not bundle.** A user can download and upload to their own project. |
| **Mixkit SFX** | "Sound Effects Free License" ([mixkit.co/license](https://mixkit.co/license/)). Full text not machine-readable for us. User terms bar permitting third parties to "license, sublicense… or otherwise… make Mixkit [items] available" and reselling "in their original form" ([Mixkit info](https://mixkit.co/llm-info/)) | Yes, no attribution | **NO** (making items available to third parties) | No | Not addressed; assume no scraping | Decent, small (~hundreds per category) | **Do not bundle.** Exact SFX license text: **unclear, re-check by hand.** |
| **BBC Sound Effects (RemArc)** | RemArc Licence: personal, educational, research only ([BBC SFX site](https://sound-effects.bbcrewind.co.uk/licensing); summaries: [Mixmag](https://mixmag.net/read/bbc-sound-effect-archive-free-audio-samples-news), [Electronic Groove](https://electronicgroove.com/bbc-expands-sound-effect-library-to-33000-free-samples/)) | **No** (commercial via purchase; the commercial BBC library is sold by Pro Sound Effects, [MacTech](https://www.mactech.com/2010/05/19/pro-sound-effects-distribute-bbc-sound-effects-archive)) | No | Required | "Research" excludes AI training/data-mining | Superb archival, 33k files | **Exclude** (non-commercial) |
| **Zapsplat** | Standard (free) License: attribution "Sound effects from zapsplat.com". Gold removes attribution ([Zapsplat licensing guide](https://www.zapsplat.com/copyright-and-audio-licensing-for-beginners)). Official license page blocked our fetch (403). | Yes | **NO.** Third-party summaries: no redistribution "as standalone files or in competing SFX libraries on any plan" ([LicenseOrg](https://licenseorg.com/guide/music-audio/zapsplat)) | Free tier: required | Not verified | Large (150k+), decent | **Do not bundle.** Exact text **unclear**; treat as no. |
| **Soundsnap** | [Soundsnap licence](https://www.soundsnap.com/licence) | Yes, monetize Creative Works; no attribution | **NO.** May not "sell, sublicense, share, distribute, or make available any Sound on a standalone basis" or as "sound effects libraries… or similar competing products". | No | **No AI/ML training** without written permission | Pro-grade, 500k+ | **Do not bundle.** Good for a user's own uploads, or for the founder hand-designing house sounds that end up *only* inside finished demo videos. |
| **Epidemic Sound (Partner API)** | Partnership agreement ([developers](https://developers.epidemicsound.com/docs/), [partner API](https://go.epidemicsound.com/developers/partner-api/)) | Yes, under contract | **Yes, by design:** the API supports end-user sublicensing; VEED integrates it in-editor ([Epidemic × VEED](https://corporate.epidemicsound.com/press-and-media/press-releases/2026/veed-partners-with-epidemic-sound-to-bring-world-class-music-and-sound-to-its-global-creator-community/)). Free tier: prototyping only (lifetime caps of ~50 downloads / 100 streams, **no commercial publishing**). | Per contract | API is the sanctioned channel | 90k–200k SFX (sources differ) plus music, with search and beat detection | **Founder decision (paid)**: the strongest "real catalog" option |
| **Storyblocks API** | Enterprise API license, Standard vs Enhanced ([Storyblocks API](https://www.storyblocks.com/api)) | Yes | **Yes**: "provides your end users with a license"; files must be incorporated into a finished project. Pricing by libraries × MAU (custom). | Per contract | API | Large audio + SFX | **Founder decision (paid)** |
| **Artlist** | [Artlist license](https://artlist.io/help-center/privacy-terms/artlist-license); Enterprise custom ([enterprise](https://artlist.io/enterprise)) | Yes (subscriber's own productions) | **Unclear.** No public API/sublicensing terms found. Assets "not used to train or fine-tune AI". | No | No public API found | High quality | **Founder decision**, only with written enterprise terms |
| **Pro Sound Effects** | Commercial licenses; API via partnerships (e.g. Audio Network) ([PSE × Audio Network](https://us.audionetwork.com/support/sound-effects)) | Yes | Only via a negotiated deal | — | Custom API for partners | Top-tier (includes the BBC catalog commercially) | **Founder decision (enterprise)** |
| **Splice Sounds** | Splice ToS §3.1.1.3 ([Splice licensing FAQ](https://intercom.help/splice-b7a2d5b83f2e/en/articles/8652642-splice-sounds-licensing-faq)) | Yes (in your works) | **NO**: bans sublicensing sounds "in isolation" as SFX/loops and competitive repackaging | No | — | Music-oriented, great tonal one-shots | **Do not bundle** |
| **Adobe Audition SFX** | Adobe EULA ([download page](https://www.adobe.com/products/audition/offers/adobeauditiondlcsfx.html)) | Yes | **No** standalone distribution ("where the file is the primary value") | No | — | Good, older (~10k) | **Do not bundle** |

### 3.3 AI-generated SFX options

| Option | Output rights | Commercial | Cost | Specs | Notes |
|---|---|---|---|---|---|
| **ElevenLabs Sound Effects API** (`POST /v1/sound-generation`, model `eleven_text_to_sound_v2`) | ToS §4(c)(ii): "you retain all rights in and to your Output". §10: may produce "the same or similar Output" for others ([Terms](https://elevenlabs.io/terms-of-use)) | **Paid plans only.** Free users "may only use the Services for non-commercial purposes" (§1(c)(i)). Bundling/sublicensing Services falls under separate **OEM terms**, so ask ElevenLabs whether a generated *library* we ship to users needs them. | API pricing page: **$0.12/min** of SFX plus included generations per plan (Starter $6 → 150 … Business $990 → 30,000) ([pricing](https://elevenlabs.io/pricing/api)). Docs/help also say 100 credits per auto-duration generation or 20 credits/s with set duration ([help](https://elevenlabs.io/docs/help-center/product/content-production/sound-effects/how-much-does-it-cost-to-generate-sound-effects)). **Inconsistent, so verify on an invoice.** | 0.5–30 s, `prompt_influence` 0–1, `loop` option, WAV 48 kHz on higher tiers ([API ref](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)) | Best quality/ease today for bespoke, per-film material. Store outputs with prompt + seed + plan + date as provenance. |
| **Stability – Stable Audio 2.5 (API)** | Stability's terms (not fully verified by us) | Paid API | ~$0.20/generation per two third-party sources; **unverified** ([Costbench](https://www.costbench.com/software/ai-music-generators/stable-audio/hidden-costs/)) | Up to ~3 min, music-leaning | Strong for tonal beds/risers; weaker for crisp transients |
| **Stable Audio Open 1.0** (self-host) | You own outputs (between you and Stability) ([license](https://stability.ai/license)) | **Free under Stability AI Community License if annual revenue < US$1M**; Enterprise license above that | GPU cost only | ≤47 s, 44.1 kHz stereo. Trained on 472k Freesound + 14k FMA CC0/CC-BY/Sampling+ files ([model card](https://huggingface.co/stabilityai/stable-audio-open-1.0)) | Good offline option for beds and textures. Revocable on breach; register once commercial. |
| **AudioGen (Meta)** | — | **No.** Weights CC-BY-NC-4.0 ([HF](https://huggingface.co/facebook/audiogen-medium)) | — | 16 kHz | Exclude |
| **MMAudio** (video→audio) | — | **No** (weights reportedly CC-BY-NC; unverified) ([invideo summary](https://invideo.io/blog/open-ai-voice-audio-models/)) | — | — | Exclude |
| **HunyuanVideo-Foley** (video→audio) | Tencent Hunyuan Community License; **reportedly excludes EU/UK/South Korea** ([summary](https://studio.aifilms.ai/blog/hunyuanvideo-foley)) | Conditional | — | — | Avoid (territory clause is incompatible with a global SaaS) |
| **Mirelo** (video→SFX API) | Free tier non-commercial + watermark + attribution; paid terms not public ([comparison](https://sonilo.com/blog/comparisons/sonilo-vs-elevenlabs-vs-mirelo-sfx)) | Paid: unclear | — | — | Watch list |

**Caveats for AI audio:**
- Purely machine-generated material may not be copyrightable in the US ([US Copyright Office AI report](https://www.copyright.gov/ai/)). We can *use* it, but may not be able to stop others copying it. That is fine for SFX and weak for a client's "ownable" mnemonic, so a human must author mnemonics.
- Never train or fine-tune on Sonniss, Soundsnap, Pixabay-scraped, BBC or Artlist files. Each explicitly prohibits AI training.

### 3.4 Conclusions

**(a) Can legally bundle now (download, ship, stream raw, bake into user videos).** Conservative reading:
1. **Freesound CC0**, hand-curated. Download via the website as a normal user rather than a commercial API pipeline, or email UPF for API terms. Target: 300–800 files covering transients, material bodies (glass, metal, paper, wood, plastic, liquid, cloth), real whooshes/air, room tones. Prefer uploaders who clearly recorded their own material. CC0 carries no warranty: an uploader could have posted ripped commercial SFX. Reject anything that sounds like a known library and keep `{freesound_id, uploader, url, license, download_date, sha256}` per file.
2. **Kenney audio packs** (CC0): UI/impact/digital layer material.
3. **OpenGameArt CC0 items** (e.g. Owlish Media pack), checked per item.
4. **Our own synthesizer** (`gen-sfx.ts`): wholly ours.
5. **Founder-recorded foley.** A Zoom recorder plus glass, keys, paper, wood, phone, cloth for one afternoon gives the most distinctive and fully owned material. This is a cheap, high-value step [CRAFT].
6. **AI generations made on a paid ElevenLabs plan** (or Stable Audio Open while under $1M revenue), with the OEM/bundling question confirmed in writing with ElevenLabs before shipping them as a shared library.

**(b) Needs a paid/business license (founder decides):**
- **Epidemic Sound Partner API**: proven in VEED, explicit end-user sublicensing, SFX plus music.
- **Storyblocks API**: MAU-priced, end-user license.
- **Pro Sound Effects** (incl. BBC commercial).
- **Artlist Enterprise**: only with written API/sublicense terms.
- **ElevenLabs** paid plan, and OEM terms if we ship generated libraries.
- **Per-user "bring your own license"**: users upload their own Soundsnap/Sonniss/Zapsplat-Gold/Pixabay files into *their* project. Storage stays per-tenant, is never shared or pooled into the global library, and is never used for training. The auto-analyzer (§4.3) tags them so the planner can use them. Sonniss explicitly allows sharing within the licensee's own team/organisation.

**(c) AI option for bespoke sounds per film.** At *palette-build time* (once per brand/film, not per render), generate ~20–40 signature elements with the ElevenLabs SFX API:
- the brand-material body hits
- a logo-sting body
- 2–3 textured whooshes in the brand material
- a tonal bed or riser

Generate 3–4 variants each. Run them through the analyzer, tag them, tune them, and cache them in the project. Expected cost is roughly cents to low dollars per film. Fallback: self-hosted Stable Audio Open for beds and risers. Generic transients, sub and air still come from the bundled library and synth.

---

## 4. Intent-driven sound selection architecture

### 4.1 Model the film's intent ("sound brief")

The director (LLM) writes this into the spec. Defaults are derived from `concept`/style and music analysis:

```ts
sound: {
  brief: {
    voice: "precise" | "warm" | "playful" | "epic" | "luxury" | "raw" | "calm",
    world: "hyperreal" | "abstract" | "hybrid",
    materials: ["glass", "aluminium"],        // 1–2 primary, 1 accent
    space: "dry" | "studio" | "plate" | "hall", // one shared reverb
    tonalCenter?: "F# minor",                   // else from music analysis / brand
    mnemonic?: { notes: ["C5","G5","E6"], material: "glass" },
    density: 0.35,                              // fraction of motion events that get sound
    avoid?: ["cartoon", "laser", "braam"],      // explicit "not this"
  },
  beats?: [{ scene: "hook", role: "hook"|"build"|"tension"|"reveal"|"payoff"|"breath"|"cta", energy: 0..1 }]
}
```

- **Energy curve.** Per scene, from `beats[].energy`, else inferred from scene role, cut rate and music `energyCurve` (already in `src/core/audio.ts`). It controls density, layer count and hit weight.
- **Music key.** Add key estimation (chroma + Krumhansl key profiles) to `analyzeAudio`. Return `key`, `keyConfidence` and the beat grid. Below the confidence threshold, treat tonal SFX as "untuned-safe only" (noise-based choices).
- **On-screen objects.** Derived from layers: type (`device` means aluminium/glass, `card` means paper/plastic, `morph`/liquid logo means liquid, `particles` means air/shimmer), size (font size × scale, layer area), speed (Δpos/Δt from keyframes/enter presets) and x-direction (for pan).

### 4.2 Library tag schema (per file)

```ts
type SfxMeta = {
  id: string; src: string; source: "synth"|"freesound-cc0"|"kenney"|"oga-cc0"|"house"|"ai-11labs"|"user";
  license: { name: string; url: string; attribution?: string; proof: string /* sha256 + download date */ };
  // human/LLM-curated
  role: "transient"|"body"|"sub"|"tail"|"air"|"whole";     // layer slot
  category: string;          // from §2 taxonomy, e.g. "whoosh.medium", "impact.slam", "ui.success"
  materials: string[];       // glass, metal-thin, paper, liquid, digital…
  world: "hyperreal"|"abstract";
  emotion: string[];         // tension, delight, power, calm, precision…
  // auto-analyzed (§4.3)
  durationSec: number; peakAt: number; attackMs: number; decayT60: number;
  weight: number;            // 0..1 from low-band energy ratio + duration
  speed: number;             // 0..1 from attack slope / envelope length
  brightness: number;        // spectral centroid (Hz), normalized
  flatness: number;          // tonal (0) vs noisy (1)
  tonal: boolean; f0Hz?: number; pitchClass?: number; // for tuning
  lufsMomentaryMax: number; truePeak: number;
  stereoWidth: number; panMotion?: "LtoR"|"RtoL"|"static";
  loopable?: boolean;
  variantGroup: string;      // round-robin family id
};
```

### 4.3 Automatic analysis (so licensed packs can be dropped in)

Use lightweight tools with clear licenses. **Avoid Essentia for the SaaS**: it is AGPL-3.0, and its models are CC BY-NC-ND unless commercially licensed ([Essentia licensing](https://essentia.upf.edu/licensing_information.html)).

| Feature | Method | Tool |
|---|---|---|
| Duration, true peak, loudness | EBU R128 momentary max / integrated, true peak | `ffmpeg -af ebur128=peak=true` (already used in `audioMaster.ts`) |
| Onset / transient / `peakAt` | Spectral-flux onset (reuse the FFT + flux code in `src/core/audio.ts`) + max RMS window. For whooshes/risers, `peakAt` = argmax of smoothed RMS. | Our code |
| Attack / decay (T60) | Envelope follower: 10→90% rise time, −60 dB decay estimate | Our code |
| Spectral centroid, flatness, rolloff | Per-frame stats averaged around the apex | `ffmpeg aspectralstats` ([doxygen](https://ffmpeg.org/doxygen/7.0/af__aspectralstats_8c.html)) or [Meyda](https://meyda.js.org/) (MIT, [npm](https://npmjs.com/package/meyda)) |
| Pitch / tonalness | YIN/autocorrelation f0 on the sustained part; tonal if flatness is low and the f0 confidence is high | Our code (small YIN) |
| Weight | Energy share < 120 Hz × duration factor | Our code |
| Stereo width / pan motion | Mid/side ratio; L-R balance trend over time | Our code |
| Semantic tags (material, category) | Zero-shot audio-text embedding vs. the taxonomy labels, with the founder or LLM confirming | [LAION-CLAP](https://github.com/LAION-AI/CLAP) (checkpoints reportedly Apache-2.0; **verify**) run offline at ingest, not per render |
| Freesound metadata | Freesound already computes brightness, loudness, pitch, tonality, onset_count | Freesound API descriptors ([docs](https://freesound.org/docs/api/resources_apiv2.html)) |

Ingest pipeline:
1. Decode and trim silence.
2. Loudness-normalize to a −16 LUFS momentary max (matches `gen-sfx.ts`) at −1 dBTP.
3. Analyze, then CLAP-suggest tags.
4. Human or LLM review.
5. Write `manifest.json`, then pre-render pitched variants (see §4.5).

Run ingest offline/CLI, never in the render path. On this RAM-constrained machine, batch it.

### 4.4 Selection algorithm

**Step 1: Events → candidates.** Keep the existing `Planner` event extraction. Each event gains:
- `beatRole` and `energy` (from the scene)
- `object { material, size, speed, xDir }`
- `importance`: hero (logo/claim/product reveal) > structural (scene transition) > supporting (entrances) > micro (ticks)

**Step 2: Restraint pass (what NOT to sound).** Run this before choosing sounds:
- Budget per scene: `maxCues = round(scene.duration × (0.6 + 1.6·energy) × density)`, i.e. roughly 0.5–2 cues/s. Hero events are always kept and micro events are dropped first.
- **One gesture, one sound.** Staggered cascades (chars, list items, logo parts) get one designed gesture sound, or ≤3 ticks on the beat grid. This extends the current cascade collapse.
- **Music already says it.** If a music onset of strength above a threshold sits within ±60 ms of an event, prefer *no SFX* or a quiet transient only. Big music hits don't need an impact on top unless it's the hero moment. This uses the `onsets` from `analyzeAudio`.
- **Pre-hero silence.** Inside the 0.3–1.0 s before a hero event, delete non-hero cues and schedule a **music stopdown/filter-down** (a new `Cue` kind `mix`, executed by the duck envelope).
- Background or ambient motion (loops, parallax, slow drifts, particles idling) is never sounded. Sound only *state changes and arrivals*.
- No two consecutive cuts get the same treatment. Alternate whoosh / hit / silence / reverse.

**Step 3: Score library items per layer slot.**

```
score(item, ev) =
   3.0·matchCategory(item.category, ev.role)
 + 2.0·materialMatch(item.materials, ev.object.material ∪ brief.materials)
 + 1.5·worldMatch(item.world, brief.world)
 + 1.5·(1 − |item.weight − target.weight|)      // target.weight from size × energy × importance
 + 1.0·(1 − |item.speed  − target.speed|)       // from on-screen speed / lead time
 + 1.0·(1 − |log(item.peakAt / ev.lead)|)       // whoosh/riser fit (current pickWhoosh logic)
 + 0.8·emotionOverlap(item.emotion, beatRole)
 + 0.5·brightnessFit(item.brightness, brief.voice)   // luxury/calm darker, tech/playful brighter
 − 2.5·recentUse(item.variantGroup)              // decays over ~8 s; hard ban on same file within 3 uses
 − 1.0·tonalRisk(item)                           // tonal item and no confident key → penalty
 − ∞ if item in brief.avoid
```

Pick by weighted random from the top-k (k=3) using a deterministic seed (`hash(spec.id + event key)`). Renders stay reproducible and varied.

**Step 4: Layering recipes.** Each `role` maps to a recipe whose layer count scales with importance × energy:

| Role | Micro | Supporting | Structural | Hero |
|---|---|---|---|---|
| Hit/landing | T | T + B | T + B + S | T + B + S + Tl + A |
| Transition | A | A + B | riser/whoosh + B | reverse swell → (silence) → T + B + S + Tl |
| UI | T | T + tonal | — | T + tonal + A |
| Logo | — | — | B + Tl | mnemonic (tonal) + B (brand material) + S (root) + Tl + A |

Layer rules:
- Layers share the apex.
- The sub is −6 to −9 dB relative to the body and mono.
- The air layer sits −12 dB.
- Each layer gets its own ±cents jitter.
- Body layers come from the **brief's material**. T, S and A may come from the synth.

**Step 5: Tuning to the music key.**
- For tonal items, compute the semitone shift Δ to the nearest chord tone of the key (root/5th for subs and booms, triad tones for chimes, pentatonic for sparkles/blips). Limit to |Δ| ≤ 3 semitones to avoid artefacts. Beyond that, choose another item.
- Implementation: **pre-render pitched variants offline** (ffmpeg `rubberband` or `asetrate`+`aresample` varispeed for short hits, cached as `name@+2.wav`). This keeps the Player and Lambda identical. Remotion's `preservePitch`/`toneFrequency` props are an alternative, but behaviour differs between Player and render.
- Synth layers (sub, shimmer, tonal riser, mnemonic) are **generated directly at the target pitch**, which is the main reason to keep the synthesizer.

**Step 6: Timing and grid.**
- Apex on the event (current rule), with transients −1 to 0 frames.
- If `beats` exist and the event is within ±70 ms of a beat, snap the event's sound (not the visual) to the beat. For larger offsets, flag to the director that the *visual* should move to the beat.
- Counter ticks are quantized to the 1/8 or 1/16 grid.

**Step 7: Spatial and mix.**
- Pan = clamp(0.6 · normalized x-velocity direction). Sweep pan across the whoosh for lateral moves. Sub layers stay centred.
- Shared reverb send per `brief.space`. This needs a reverb on the SFX bus. In Remotion that means pre-rendering an SFX stem, or using dry files + per-cue "wet" variants rendered from one IR.
- Duck depth comes from importance. On hero hits, add a 2–4 kHz music dip.

**Step 8: Density control.** After selection, recompute cues/s per sliding 2 s window. If a window exceeds `1.5 × budget`, drop the lowest-importance cues. If a hero beat has nothing around it for >6 s in a high-energy scene, add a subtle air/texture element (re-hook every 3–5 s, see doc 03).

### 4.5 How pro editors decide what not to sound [CRAFT, consistent with the cited practice]

- Sound **causes and arrivals**, not continuous motion. One sound per gesture, not per element.
- If the music has a hit there, let the music do it.
- If an element is not where the eye goes, it doesn't get a sound.
- Save the biggest sound for the single most important moment. Everything else is at least 6 dB quieter.
- Leave at least one beat of space (or a stopdown) before the hero.
- Repeat a sound only when repetition *means* something (a motif). Otherwise vary it.
- Hero type gets weight. Body copy and supporting UI get nothing or a breath of air.

---

## 5. Recommendations for our engine (prioritized)

| P | Change | Effort | Impact |
|---|---|---|---|
| **P0** | **Variant pools + anti-repeat + jitter.** Turn `PALETTES[palette][role]` into lists of variant groups. Choose with a seeded weighted random and avoid the last 2–3. Add ±cents and ±dB jitter via pre-rendered pitch variants. Extend `gen-sfx.ts` to emit 4–6 seeded variants per synth sound today; this costs nothing. | S | High: kills the "same sample" tell immediately |
| **P0** | **Restraint pass.** Per-scene cue budget from energy × density. "One gesture, one sound". Skip events coinciding with strong music onsets. Pre-hero stopdown (`mix` cue that dips/filters the music). | S–M | High: biggest perceived jump to "designed" |
| **P0** | **Curate a CC0 recorded library** (Freesound CC0 + Kenney + OGA CC0 + an afternoon of house foley). Store **dry** as layer slots (T/B/S/Tl/A) with the §4.2 tags and a provenance ledger (`library/sfx/LICENSES.json`). | M (curation time) | High: real material detail |
| **P1** | **Runtime layering.** A cue becomes a stack of 1–5 layers chosen per §4.4 recipes, sharing the apex. SoundTrack voice allocation must count layers. Consider pre-mixing hero stacks offline into one file per cue at render prep, to respect the 4-voice Player limit. | M | High |
| **P1** | **Sound brief + material mapping.** Add `sound.brief` (voice, world, materials, space, tonalCenter, density, avoid). Map layer types to default materials. Let the director set them from `concept`. Keep `palette` as a preset that fills the brief. | S–M | High: intent, not event type |
| **P1** | **Key detection** in `analyzeAudio` (chroma + key profiles, with confidence) and **tuned synth layers** (sub on root, chimes/sparkles/mnemonic on chord tones). | M | High for music-led films |
| **P1** | **Ingest/analyzer CLI** (§4.3) so any licensed pack, or a user's BYO-license uploads, can be dropped in and auto-tagged. Per-tenant storage only. | M | Unlocks (b) sources and user libraries |
| **P2** | **Keep the synthesizer, but repurpose it** as a *layer generator*: sub/808 at any pitch, air/noise whooshes at any length (exact fit to the move instead of time-stretching), tonal risers/shimmer/blips in key, and mnemonic notes in a chosen timbre. Retire the synth "whole" sounds that pretend to be material (paper slide, typewriter, cash register, camera shutter) in favour of recorded CC0. | M | Medium–High |
| **P2** | **Pan from motion + shared reverb.** Pan follows x-velocity. One IR-based "space" per brief, via an SFX stem pre-render or wet variants. | M | Medium |
| **P2** | **Mnemonic generator.** 3–5 notes in key + brand material body + sub, 1.5–4 s, used on end cards. Store it per brand so every film reuses the *same* signature (identity = consistency). A human must approve it. | M | Medium–High for brands |
| **P3** | **AI bespoke pass** (ElevenLabs paid plan): at brief time, generate brand-material bodies, textured whooshes and a bed (3–4 variants each). Analyze, tune and cache per project. Confirm OEM terms before pooling outputs across users. | M | Medium (distinctiveness) |
| **P3** | **Paid catalog integration** (Epidemic Partner API or Storyblocks API) if the founder wants real-catalog depth plus music under one contract. | L + contract | Medium–High |
| **P3** | **A/B and QA tooling.** Cue-sheet viewer with "why" reasons (exists), plus per-film metrics: cues/s, repeats, % tonal-in-key, loudness range. Check the loudness of the 2 s before vs after the hero (target ≥6 LU contrast). | S | Keeps quality measurable |

**On keeping the synthesizer:** yes, as a **layer generator**, not the whole library.
- It is the only source that is fully ours, infinitely variable, and **tunable to the exact key, length and pitch** the moment needs. Subs, air whooshes, risers, shimmer and blips are where synthesis is indistinguishable from or better than recordings.
- Recorded CC0 or house foley should supply the **transient and body** layers, which carry material realism.
- Together this is the recorded-plus-synthetic hybrid practitioners recommend ([Violet Recording](https://violetrecording.com/how-to-make-whoosh-sounds/)).

**Immediate legal hygiene:**
- Add `library/sfx/LICENSES.json` with per-file provenance.
- Add a CI check that rejects any manifest entry without a CC0/house/synth/AI-paid license tag.
- Never mix BYO-license user uploads into the global `/library` route.
- Never use third-party library audio to train or fine-tune a generator (Sonniss, Soundsnap, Artlist and BBC all forbid it).
