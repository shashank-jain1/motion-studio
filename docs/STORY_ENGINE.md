# Story Engine — the operating manual

You run this pipeline **before you write a single scene**. Its job: every film has a story that hooks in the first second,
peaks once, ends high, and could only belong to this brand. The evidence lives in `docs/research/06-story-psychology.md`;
this is the procedure. Tools: `story_kit` (rubric, structures, techniques, templates, the niche's cliché blacklist),
`score_concepts` (ranks concepts, applies the gates), `check_story` (curve sparkline + issues on the saved spec).
`set_spec` also lints the story (`story/*` warnings).

**Why the procedure exists.** Your first idea is everyone's first idea, and an LLM's first idea is every LLM's
(the "artificial hivemind"). Every coffee brand gets steam; every fintech gets a rising arrow. Divergence must be forced.

```
(a) truth & tension → (b) 8 concepts, 8 techniques → (c) score_concepts → (d) develop the winner:
beats + intensity curve + wow + sound + mnemonic → (e) self-critique → set_spec → check_story → preview_frames
```

---

## (a) Truth and tension — five lines, all required

1. **Truth:** "<Brand> helps <who> <verb> <object>, feeling <adj>." → `concept.truth`
2. **Inherent drama:** the most dramatic *second* in how the product works (a round-up, a drop, a click). → `story.inherentDrama`
3. **Audience tension:** what they feel and don't say, usually a contradiction ("I want to save, but saving feels like a diet"). → `story.audienceTension`
4. **Category orthodoxy:** 3–5 things every competitor's ad does. → `story.orthodoxy`
5. **One true thing:** short, specific, slightly uncomfortable ("Nobody misses 37 cents"). → `story.insight`

Set `concept.niche` (fintech, crypto, saas, ai, food, beauty, wellness, real-estate, app, education, events, fitness,
travel, sustainability, creator) and call `story_kit {niche, seconds}`.
**Never invent facts.** If the brief has no number, the film states none.

## (b) Cliché control, then 8 concepts

**Cliché control first.** Write the deliberately obvious idea (`clicheControl.obvious`), name its elements, and put them
plus the niche blacklist's relevant items in `clicheControl.banned`. A blacklisted item may appear **only as the object of
a twist** ("the counting sheep go on strike", not "sheep counting"); declare each one in `clicheControl.twists`
`[{item, twist}]`, or the linter flags it. Matching covers on-screen text, morph/logo/3D shape sources (`coin`, `arrow`,
`moon`…), particle presets, icons/emoji and concept text.

**Eight one-line concepts.** Each = protagonist + twist + how it becomes the brand.
- **#0 is the control** (the obvious idea). It is your score floor and should fail the Uniqueness gate.
- **#1–#7 each use a different technique card:**

| # | Card | Prompt |
|---|---|---|
| 1 | inherent-drama | The 1-second moment in the product's mechanism that is already dramatic |
| 2 | metaphor-mining | A *non-category* domain (a kitchen for finance, weather for software); the silhouette rhymes with the logo |
| 3 | inversion | List 5 category conventions; do the opposite of one (Think Small) |
| 4 | exaggeration | Push one attribute to an absurd extreme |
| 5 | perspective-shift | Tell it from the POV of the object, the problem, the motif or the competitor |
| 6 | forced-connection | A random kit shape (bean pin bolt spiral eye moon…) forced onto the truth |
| 7 | constraint | One shape, one colour, no words — or one continuous shot |
| 8 | cultural-tension | "Everyone in the category says X, but the audience secretly feels Y" |
| 9 | consequence | Day 1 vs day 365; the ripple effect of one action |
| 10 | sensory-transposition | Taste as sound, speed as colour, quiet as a straight line |

Across the eight, include **≥1 Goldenberg template, ≥1 sound-led concept, ≥1 humorous one** (benign violation: wrong
*and* okay — the motif suffers comic, not real, harm) unless the brand is somber. Goldenberg templates fit 89% of top
award-winning ads:

| Template | Motion-kit translation |
|---|---|
| pictorial-analogy | `morph` A→B, logo `window`, the motif becomes the product |
| extreme-situation | scale jumps, the world-without structure, physics gags |
| consequences | time-leap `counter`, chain-reaction `path`, collapse vs order |
| competition | split-screen race, "vs." card, the product in an odd job |
| interactive-experiment | "pause now" / "count the dots"; the viewer completes the shape |
| dimensionality-alteration | time-lapse, ×100 `repeat`, split into parts, infinite `zoom-into` |

For each concept estimate **typicality** (0–1: how likely 10 other agencies would pitch it). Above 0.3 → discarded.
Then the **hostile critic pass**: a jaded CD asks "I've seen this — where?" If you can name the ad, Uniqueness −2.

## (c) Score with `score_concepts`

Score each 0–5. **Total = Σ(weight × score) / 75 × 100.**

| Dim | W | 1 = | 3 = | 5 = |
|---|---|---|---|---|
| hook | 2 | logo/title card, static | moving, generic "why watch" | frame 0 shows an impossible or unfinished thing with a precise question |
| surprise | 2 | nothing unexpected | one mild, guessable twist | prior built, violated, resolved in <1s |
| emotionalPeak | 2 | flat | mild or mistimed peak | unmistakable named emotion at 60–80%, tension before it |
| payoff | 2 | fades to a logo card | logo lands, gap half-closed | the end is a second high (snap + mnemonic) and loops |
| brandLinkage | 2 | swap-a-logo test fails | brand at the peak, generic idea | the story IS the product truth; owned motif/colour/sound |
| clarity | 1.5 | needs a voiceover | clear on 2nd watch | a stranger retells it in one sentence after one view |
| uniqueness | 2 | a blacklisted cliché is central | fresh execution of a familiar idea | no competitor could run it; no precedent |
| feasibility | 1.5 | needs footage/character animation | needs a custom component | documented primitives only |

**Gates (hard fails): uniqueness, brandLinkage, clarity, feasibility ≥ 3.** Winner = highest total that passes. Ties →
higher emotionalPeak + payoff. A runner-up ≥70 with a stronger hook becomes an **alternate hook variant** (same body).
**Graft** one element from a strong loser if it raises a dimension without hurting clarity (sound ideas graft easily).
Score honestly: an inflated score only hides the problem until the preview. Record all eight in `story.candidates` and
the winner's index in `story.chosen`.

## (d) Develop the winner

**1. Pick the structure after the concept** (it is a container, not an idea). `story_kit` has the beat timings.

| Runtime | Prefer |
|---|---|
| ≤10s | `abt`, `volta`, `pattern-break`, `reveal` (one move) |
| 15s | anything except `heros-journey` |
| 30s+ | `story-spine`, `heros-journey`, `contrast` |
| organic | `loop`, or any structure with a loop seam |

All 14: story-spine, abt (default when unsure), pas, before-after-bridge, heros-journey, volta, metaphor,
transformation, reveal, loop, mystery-box, contrast, world-without, pattern-break. Every structure still maps onto
Hook → Tension → Transformation → Payoff → Lockup. Even in 15s the motif is a **protagonist with a want, an obstacle and a
change**; feature callouts are not a story.

**2. Beat sheet = the intensity curve.** `story.beats: [{t, beat, emotion, intensity 0–10, to?, wow?, sound?}]`. A beat holds
from its `t` until the next beat; `to` ramps linearly to a new value by the beat's end. The rules (checked):

- **Hook:** ≥5 from 0.5s through 1.5s; frame 0 already holds the gap or the violation. Motion onset + a specific question.
- **Body:** never below 3 and rising toward the peak (stack escalating micro-rewards); no flat stretch > 5s.
- **Teach a prior, then break it:** 1–3 beats set the expectation (the same move twice, a rhythm) before the violation.
- **Dip:** a 0.3–0.6s near-silence or freeze, ≥3 below the peak, right before it. The payoff is only as big as the tension before it.
- **ONE dominant peak** of 9–10 at **60–80% of the runtime**. No second equal peak.
- **Peak-end:** the ending is **≥80% of the peak**. The lockup has its own hit: the motif snaps into the logo plus the sonic mnemonic. Never a fade to a logo card.
- **Open loops** keep people watching; close every one before the lockup.

**3. The wow** (`wow` on the peak beat; `peakAt` = its time): the film's single biggest surprise, and it **contains the
brand asset**. Mechanisms: impossible transformation, scale jump (awe, needs 1.5–3s, rarely fits in 6s), pattern break,
satisfying completion (precision fit, 1:1 sound), reinterpretation (volta).

**4. Brand linkage.** One isolate per frame, and the isolate is the brand: keep tension scenes grey so the brand colour
lives only on the motif. Pulse the brand 2–4 times: colour in the hook, the motif in the middle, the logo at the end.
The motif is a **reusable brand asset** — the same object in every film for this brand — and a motif actor that ends as the
logo counts as early brand presence. Generic category symbols (coins, leaves, rockets) are shared, not ownable.

**5. Sound tells the same story** (Sound section of the guide; KIT_REFERENCE → Sound): a transient ≤0.2s in the hook;
sparse high ticks for curiosity; `heartbeat-low` / riser into the peak; **silence 0.3–0.6s before the hit**; a hit on the
apex frame; the brand's fixed 2–4-note signature on the logo-lock frame, the same in every film.

**6. The ending** = `mnemonic: {visual, sonic, loop}`: the motif becomes the logo (actor `snapTo`), the sonic signature,
and a loop seam (the last frame returns the motif to its frame-0 pose). For ads, the CTA arrives *on* the payoff hit.

## (e) Self-critique (before `set_spec`, and again after `preview_frames`)

- Can I say it in one sentence: protagonist + twist + brand? Is frame 0 the gap, not a setup to one?
- Is the prior established before I break it? Is the twist resolvable in under a second?
- Exactly one peak at 60–80%, after a dip? Does the end score ≥80% of the peak, with the CTA on the hit?
- Swap-a-logo test: would this work for the #1 competitor? (If yes, fail.)
- Brand colour the only isolate in tension scenes? Brand pulsed 2–4×, not one long logo block?
- Anything on the niche blacklist that isn't the object of a declared twist?
- ≤3 claims (ideally one), ≤7 words per beat, readable sound-off? Does the motif show intention (anticipation, a look, a reaction)?
- Have I invented a number or a claim? Can a jaded CD name the ad this copies?

Then `set_spec` → read the `story/*` warnings → `check_story` (fix the curve until the sparkline has one tall spike in the
`=` window with a `v` just before it and a high tail) → `preview_frames` and confirm the *picture* delivers the curve.

---

## Worked example 1 — Penny (fintech round-ups, 15s, 9:16)

Truth: Penny helps people who "can't save" save from spare change automatically, feeling effortless. Tension: saving
feels like a diet. Insight: nobody misses the change from a coffee. Control: coins into a jar + a green arrow + "Save
smarter" → banned: jar, piggy bank, arrow, "smarter". Winner (80, metaphor-mining + inherent drama, with the sound-led
concept grafted): every purchase sheds gold **crumbs** that fall away; we follow them down to find they've piled into a
perfect coin that becomes the Penny "O". Coin is blacklisted, so it is declared as a twist.

```json
"concept": { "niche": "fintech", "truth": "Penny helps people who can't save save spare change automatically, feeling effortless.",
  "story": { "insight": "Nobody misses the change from a coffee.", "audienceTension": "Saving feels like a diet.",
    "structure": "transformation", "template": "pictorial-analogy", "chosen": 1,
    "clicheControl": { "obvious": "Coins drop into a jar, a green arrow rises, 'Save smarter'",
      "banned": ["jar", "piggy bank", "arrow", "smarter"],
      "twists": [{ "item": "coin", "twist": "the coin is never dropped in: it assembles itself from forgotten crumbs" }] },
    "beats": [
      { "t": 0, "beat": "hook", "emotion": "curiosity", "intensity": 6, "sound": "pop-snap + 3 rising ticks" },
      { "t": 1.5, "beat": "tension (prior ×3)", "emotion": "curiosity", "intensity": 5, "to": 6 },
      { "t": 5, "beat": "transformation", "emotion": "anticipation", "intensity": 7, "to": 8 },
      { "t": 8.6, "beat": "hold", "intensity": 4, "sound": "silence 0.4s" },
      { "t": 9, "beat": "peak", "emotion": "delight", "intensity": 10, "wow": "crumbs snap into a perfect coin", "sound": "ding-success" },
      { "t": 11, "beat": "payoff", "emotion": "satisfaction", "intensity": 9, "sound": "chime-bright" },
      { "t": 12.5, "beat": "lock", "emotion": "warmth", "intensity": 8, "sound": "mnemonic" } ],
    "peakAt": 9,
    "mnemonic": { "visual": "the coin rolls into the O of Penny (snapTo)", "sonic": "3-note rising tick", "loop": true } } }
```

## Worked example 2 — Hush (sleep earbuds, 15s, 9:16)

Truth: Hush helps light sleepers block noise, feeling held. Tension: "I'm tired because of other people's noise."
Orthodoxy: moons, sheep, yawns. Control (39, U-gate fail): moon, stars, counting sheep. Runner-up (72, alt hook): the
sheep go on strike. Winner (88, sensory transposition + satisfying completion): **comb the noise** — snores, traffic and
a dog are jagged waveforms; an earbud-shaped comb sweeps through and combs them into one flat line that becomes the
horizon, then the logo underline, while the sound literally drops out. The silence is the owned sonic asset.

Beats: `0 hook 7` (red waveform rips across, snore hit) → `1.5 tension 6→8` (noise layers tangle) → `5 hold 5` (the comb
appears and "looks" at the mess; one tap) → `6 peak 10, wow: "every waveform combed flat; total silence"` →
`10 payoff 9` (line becomes horizon, then the wordmark underline; one chime) → `12.5 lock 8` ("Hush. The world, combed
flat." + CTA; a tiny squiggle starts at the far left: loop). Peak 6–10s overlaps the 9–12s window, dip 5 before it,
end 8 = 80% of the peak. No moon, no sheep, no yawn anywhere in the spec.

**The general recipe the winners converge on:** one inherent-drama or metaphor idea + a satisfying or pattern-break peak +
a motif-to-logo ending. Rotate structures across a brand's films; keep the assets (motif, colour, sonic signature) fixed.
