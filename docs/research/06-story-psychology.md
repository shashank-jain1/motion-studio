# 06 — Story Psychology: hooking, moving, and being remembered in 6–60s motion films

Research brief for the AI director. It goes past `DIRECTOR_GUIDE.md` (the creative method: truth → metaphor → motif → arc) and `03-hooks-retention.md` (platform data, hook catalogue, pacing, safe zones). Those docs tell the director **how to build** a film. This one tells it **why a story works on a brain** and **how to find a story nobody else would have made**. It ends with a Story Engine pipeline the director runs before it writes a spec. Compiled Oct 2026.

**Evidence legend.**
- **[A] Strong:** a meta-analysis or a large body of replicated work.
- **[B] Moderate:** solid peer-reviewed studies, but few of them, or lab results that have not been tested on ads.
- **[C] Weak/mixed:** failed replications, single small studies, or vendor data.
- **[CRAFT]:** a practitioner heuristic or our own synthesis.

Treat [A] as a default, [B] as a strong prior, and [C] or [CRAFT] as hypotheses to A/B test.

---

## 0. TL;DR for the director

1. **Memory of a film is its peak plus its ending, not its average.** Design one unmistakable peak at 60–80% of the runtime and end high. Don't fade out [A].
2. **Surprise means the viewer's expectation changes, not randomness.** First set up an expectation, then break it, then resolve it within about a second [A/B].
3. **Curiosity is a gap the viewer can almost close.** Show 30–70% of the answer and withhold the rest until the payoff [B].
4. **The brand has to be inside the peak**, not stuck on after it. Distinctive assets (motif, colour, sound) are what turn an enjoyable film into a remembered brand [B].
5. **The first ideas are everyone's ideas, and an LLM's first ideas are every LLM's ideas.** Generate many concepts with forced, different techniques. Name the obvious one and ban it. Then score with the rubric in §4 [B].

---

## 1. Psychology of attention, emotion and memory

Each entry gives the **mechanism**, the **evidence**, and the **creative rule** that applies to our engine.

### 1.1 Curiosity / information gap (Loewenstein)
- **Mechanism.** Curiosity is a feeling of deprivation that comes from noticing a specific gap in your knowledge, and it needs some prior knowledge to start ([Loewenstein 1994, *Psych Bulletin*](https://stafforini.com/works/loewenstein-1994-psychology-curiosity-review/); [summary](https://nautil.us/curiosity-depends-on-what-you-already-know-235803)). In fMRI, curiosity activates the caudate (reward anticipation), and people pay tokens or wait to resolve it. Curiosity also improves memory for surprising answers 1–2 weeks later ([Kang et al. 2009](https://pubmed.ncbi.nlm.nih.gov/19619181/)). High-curiosity states also improve memory for *incidental* material shown during the wait, but the effect is small: 42.4% vs 38.2% face recognition immediately, and after a day the difference survives only for confident responses ([Gruber, Gelman & Ranganath 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4252494/)).
- **Evidence.** [B]: a robust lab phenomenon. The memory spill-over effect is small.
- **Rule.** The gap must be **specific**: "what is this object?", not "something amazing is coming". It must be **almost closable** (show half the object, the first two letters, or a silhouette) and it must **close inside the film**. Place a brand cue during the wait (a colour, the motif) and the full brand at the reveal. Never open a gap you can't pay off. 03 §2.1 already warns that clickbait erodes trust.

### 1.2 Prediction error and Bayesian surprise
- **Mechanism.** Dopamine neurons signal *reward prediction error*: firing rises when an outcome beats expectation and dips when it falls short. With learning, the response moves to the cue that predicts the reward ([Schultz 1997, reviewed](https://pmc.ncbi.nlm.nih.gov/articles/PMC6117220)). Itti & Baldi define surprise as the distance between the observer's prior and posterior beliefs. On TV and game footage, **72% of gaze shifts landed on locations that were more surprising than average, and 84% where all observers agreed** ([Itti & Baldi 2009, *Vision Research*](https://ilab.usc.edu/publications/Itti_Baldi09vr.html)). In video ads, the *level* of surprise concentrates attention, while the *velocity* (rate of increase) of joy is what keeps viewers from zapping ([Teixeira, Wedel & Pieters 2012, *JMR*](https://research.tilburguniversity.edu/en/publications/emotion-induced-engagement-in-internet-video-ads/)).
- **Evidence.** [A] for prediction-error neuroscience, [B] for its transfer to ads.
- **Rule.** Surprise needs a prior. Spend 1–3 beats **teaching a pattern** (the same move twice, a rhythm, a predictable path), then violate it. Random novelty with no prior produces little Bayesian surprise; it reads as noise. For retention, **joy must keep rising**: stack escalating micro-rewards (each reveal bigger than the last) instead of one flat high.

### 1.3 Schema violation and incongruity resolution (delight)
- **Mechanism.** Mandler's schema-congruity theory predicts an inverted U: *moderately* incongruent things get the best evaluations, because resolving them feels like discovery, while extreme incongruity frustrates people ([Meyers-Levy & Tybout 1989, *JCR*](https://www.kellogg.northwestern.edu/academics-research/research/detail/1989/schema-congruity-as-a-basis-for-product-evaluation/)). In TV ads, surprise is *necessary but not sufficient* for humour. Familiarity with the schema, playfulness, ease of resolution and warmth decide whether surprise becomes humour or fear ([Alden, Mukherjee & Hoyer 2000, *J. Advertising*](https://searchworks.jioinstitute.edu.in/articles/edb__3823723)).
- **Evidence.** [B]. Note a methodological critique: most tests use only three incongruity levels, between subjects.
- **Rule.** **One violation per film, resolvable in under 1s.** Build it as "wrong, then right": the coin rolls *uphill*, and then we see the slope is the app's chart. If a test viewer can't explain the twist in one sentence, the violation is too extreme.

### 1.4 Humour in ads
- **Mechanism.** In benign violation theory, something is funny when it is wrong and okay at the same time. Psychological distance, an alternative norm, or weak commitment to the norm makes a violation benign ([McGraw & Warren 2010, *Psych Science*](https://leeds-faculty.colorado.edu/mcgrawp/pdf/mcgraw.warren.2010.pdf)). Eisend's meta-analysis of humour in advertising found the largest effects on **attention and attitude toward the ad**, with weaker effects on brand outcomes ([Eisend 2009, *JAMS*](https://doi.org/10.1007/s11747-008-0096-y); [Marketing Week summary](https://marketingweek.com/three-ways-humour-helps-brands-sell)). The "vampire" risk is that the execution steals recall from the brand; strong brand–execution links prevent it ([Erfgen, Zenker & Sattler 2015](https://ideas.repec.org/a/eee/ijrema/v32y2015i2p155-163.html)).
- **Evidence.** [B].
- **Rule.** **The joke must be the product truth.** If you can swap in a competitor's logo and the joke still works, kill it. Put the brand *in* the punchline frame. Keep it benign: the motif suffers comic, not real, harm (squash, bonk, embarrassment).

### 1.5 Peak-end rule (Kahneman)
- **Mechanism.** Retrospective judgments of an experience track its most intense moment and its final moment. Duration barely matters ([Kahneman et al. 1993](https://ius.uzh.ch/dam/jcr:5ae9adc9-61ec-4174-b37c-4b752f36c23b/Kahnemann%20et%20al.%20-%20When%20More%20Pain%20is%20Preferred%20to%20Less%20(1993).pdf)). A meta-analysis of 174 effect sizes found a **large peak-end effect (r = .58) and near-zero duration effect** ([Alaybek et al. 2022, *OBHDP*](https://ideas.repec.org/a/eee/jobhdp/v170y2022ics0749597822000334.html)). It holds **for ads specifically**: overall ad judgments are dominated by the peak and the final moment, and longer ads win only if they build toward a peak ([Baumgartner, Sujan & Padgett 1997, *JMR*](https://pure.psu.edu/en/publications/patterns-of-affective-reactions-to-advertisements-the-integration/)).
- **Evidence.** [A].
- **Rule.** Plot intensity per second (§4d). Put **one peak at 60–80% of the runtime** and make the **end at least 80% of peak intensity**. That rules out "fade to logo on white". The lockup *is* the end, so it must land with its own hit (motif snaps into logo, sonic mnemonic, last joke beat). Improving trajectories are preferred, so tension should go up, never sideways.

### 1.6 Zeigarnik / open loops (weak)
- **Mechanism.** The claim is that unfinished tasks are remembered better. A 2025 meta-analysis found **no memory advantage for interrupted tasks**, but a reliable tendency to *resume* them (the Ovsiankina effect) ([Ghibellini & Meier 2025, *HSSC*](https://ideas.repec.org/a/pal/palcom/v12y2025i1d10.1057_s41599-025-05000-w.html)).
- **Evidence.** [C] for memory, [B] for the urge to resume.
- **Rule.** Use open loops to make people **keep watching**, not to make them **remember**. Memory comes from the peak, distinctiveness and brand linkage. Close every loop before the lockup.

### 1.7 Processing fluency and aesthetic pleasure
- **Mechanism.** The easier a stimulus is to process, the more people like it and the more they believe it. Symmetry, figure-ground contrast, repetition and prototypicality all work through fluency ([Reber, Schwarz & Winkielman 2004, *PSPR*](https://pages.ucsd.edu/~pwinkielman/reber-schwarz-winkielman-beauty-PSPR-2004.pdf)).
- **Evidence.** [A] for the general effect.
- **Rule.** Disfluency in the hook (something odd), **fluency in the payoff** (symmetric, centred, high-contrast logo resolve with a clean rhythm). The brand message must be the easiest thing in the film to read: ≤7 words, one idea, high contrast.

### 1.8 Novelty vs familiarity: MAYA ("Most Advanced Yet Acceptable")
- **Mechanism.** Aesthetic preference peaks at a combination of typicality and novelty (Loewy's MAYA, formalised by Hekkert et al.). The two map onto evolutionary needs for safety and for exploration ([IJDesign](https://ijdesign.org/index.php/IJDesign/article/download/1146/474); [Thurgood, Hekkert & Blijlevens](https://figshare.swinburne.edu.au/articles/conference_contribution/The_Joint_Effect_of_Typicality_and_Novelty_on_Aesthetic_Pleasure_for_Product_Designs_Influences_of_Safety_and_Risk/26250971/1)). In *rich*, crowded categories novelty gets more weight; in *poor* ones, typicality does ([Chen et al. 2025](https://pure.cardiffmet.ac.uk/en/publications/categorization-and-aesthetic-preference-examining-typicality-and-/)).
- **Evidence.** [B].
- **Rule.** **Novel idea, familiar grammar** (or the reverse), never both at once. A strange metaphor told with a classic arc and clean type reads as fresh. A strange metaphor in a strange structure with experimental type reads as confusing. Push novelty harder in saturated categories: SaaS, fintech, D2C beauty and AI tools.

### 1.9 Mere exposure
- **Mechanism.** Liking rises with repeated exposure and then falls: a meta-analysis of 268 curves found an **inverted U** ([Montoya et al. 2017, *Psych Bulletin*](https://researchportal.murdoch.edu.au/esploro/outputs/journalArticle/A-re-examination-of-the-mere-exposure/991005635870307891)).
- **Evidence.** [A].
- **Rule.** Within a film, show the motif 3–5 times **with variation** (new pose, scale or colour), never as identical repeats. Across a campaign, keep the *assets* constant (motif, sonic mnemonic, colour) and vary the *story*.

### 1.10 Awe: vastness plus accommodation
- **Mechanism.** Awe needs perceived **vastness** (physical, conceptual or social) and a **need for accommodation**, which means updating your mental model ([Keltner & Haidt 2003](https://pubmed.ncbi.nlm.nih.gov/29715721/)). A **60-second awe ad** (waterfalls, whales, space) made people feel they had more time, become less impatient, and prefer experiences ([Rudd, Vohs & Aaker 2012](https://gsb.stanford.edu/insights/jennifer-aaker-how-feel-you-have-more-time)).
- **Evidence.** [B].
- **Rule.** Awe = **scale jump + new meaning**. Examples: a 100× zoom-out that shows the dots were a city, or an infinite zoom that lands back on the product. Accommodation needs time, so hold 1.5–3s with a slow camera and low, wide sound (`boom-sub`, `shimmer`). Awe rarely fits in 6s; use it in 15s or longer.

### 1.11 Emotional contagion, agency and motion cues
- **Mechanism.** People automatically mimic and converge with the emotions they see ([Hatfield et al. 2014 review](https://interpersona.psychopen.eu/article/view/162/pdf)). Viewers read **intentions and emotions into simple moving shapes**: in Heider & Simmel's triangles they saw chasing, protecting and fear ([Heider & Simmel 1944](https://www.cs.uky.edu/~sgware/reading/papers/heider1944experimental.pdf)). Point-light motion alone conveys action, emotion and personality ([Johansson, Lancaster glossary](https://www.lancaster.ac.uk/fas/psych/glossary/biological_motion/)). Baby-schema proportions (big head, big eyes, round shapes) increase rated cuteness and the motivation to care for something ([Glocker et al. 2009](https://repository.upenn.edu/cog_neuro_pubs/11)).
- **Evidence.** [B].
- **Rule.** **Give the motif a mind.** It hesitates (anticipation), looks before it jumps (a small rotation toward the target), is startled (squash), or is pleased (overshoot bounce). A dot with intention is a character, and characters drive narrative transportation (§1.17). For playful brands, round the motif and give it a "head".

### 1.12 Mirror neurons: be careful
The popular story ("viewers' mirror neurons fire, so they feel it") is overstated. Hickok argues the link from mirror neurons to understanding and empathy is weak and that disconfirming evidence was ignored ([Hickok 2014, reviewed](https://metapsychology.net/?p=7290); [SBM](https://sciencebasedmedicine.org/mirror-neurons-and-the-pitfalls-of-brain-research/)). **[C]. Never use it as a rationale.** The useful, better-supported claims are contagion and agency perception (§1.11).

### 1.13 "Oddly satisfying", ASMR and Gestalt closure
- **Mechanism.** ASMR is a real, self-reported, relaxing "tingle" response to crisp sounds, slow movements and close attention ([Barratt & Davis 2015, *PeerJ*](https://pmc.ncbi.nlm.nih.gov/articles/PMC4380153)). There is almost **no peer-reviewed research on "oddly satisfying" videos specifically**. The explanations offered (a "just right" feeling, completion, order) are commentary ([Discover](https://www.discovermagazine.com/why-are-oddly-satisfying-videos-sosatisfying-218)). An adjacent finding: the IKEA effect disappears when the build is *not completed* ([Norton, Mochon & Ariely 2012](https://dash.harvard.edu/handle/1/12136084)). Completion matters.
- **Evidence.** [C]/[CRAFT] for satisfying video, [B] for ASMR as a phenomenon.
- **Rule.** Use satisfying motion as **the transformation beat**, not the whole story. Its grammar: a precision fit (sub-pixel snap), completion (always finishes), symmetry, and 1:1 tactile sound (`pop-snap`, `click-ui`). The viewer's brain closes the shape just before it completes: the Gestalt closure moment. Put the brand there.

### 1.14 Von Restorff isolation effect
- **Mechanism.** An item that differs from its context (perceptually or semantically) is remembered better. Distinctiveness is always *relative to context* ([Hunt 1995](https://doi.org/10.3758/BF03214414); [Hunt's chapter](https://academic.oup.com/book/26463/chapter/194908697)).
- **Evidence.** [A].
- **Rule.** **One isolate per frame, and the isolate is the brand.** Keep tension scenes neutral and grey so the brand colour appears *only* on the motif or hero. Thirty grey windows and one lit window: the lit one is remembered. Don't spend the isolate on decoration.

### 1.15 Distinctive brand assets (Sharp / Romaniuk)
- **Mechanism.** Brand assets are non-name cues that trigger the brand. Their strength is **fame** (the share of category buyers who link the asset to the brand) times **uniqueness** (how exclusively the brand owns it). The Ehrenberg-Bass grid's quadrants are "Use or lose", "Invest", "Avoid" (famous but shared) and "Ignore". Marketers overestimate their assets' fame ([Marketing Science](https://marketingscience.info/news-and-insights/brands-of-distinction); [Marketing Week](https://www.marketingweek.com/marketers-judgement-strength-brand-assets-rarely-accurate/)). Brand *pulsing* (short, repeated brand moments) reduces ad avoidance compared with one long brand block. Brand size doesn't help, and centred brand positions *increase* avoidance ([Teixeira, Wedel & Pieters 2010, *Marketing Science*](https://research.tilburguniversity.edu/en/publications/moment-to-moment-optimal-branding-in-tv-commercials-preventing-av/)).
- **Evidence.** [B]: industry science with large datasets, with fewer controlled tests.
- **Rule.**
  - **The motif is a brand asset**: reuse it across every film for the brand, never invent a new one per film.
  - Pulse the brand 2–4 times: colour in the hook, the motif in the middle, the logo at the end.
  - Generic category symbols (coins, leaves, clouds, rockets) are "Avoid" assets: famous but shared.
  - A unique motif, even a small one, can build fame. A shared one can't.

### 1.16 Emotional vs rational (Binet & Field) and right-brain features
- **Mechanism.** In 996 IPA effectiveness cases (700 brands), emotional campaigns produced more brand and business effects than rational ones. They were "almost twice as likely" to deliver top-box profit growth over the long term, while rational messaging won mainly short-term, direct-response goals ([Murrell summary](https://www.alexmurrell.co.uk/summaries/les-binet-and-peter-field-the-long-and-the-short-of-it); [Marketing Week](https://www.marketingweek.com/this-much-i-learned-les-binet-peter-field/)). Wood's *Lemon* (System1 data) links "flat", abstract, left-brain execution to lower effectiveness, and narrative, character and humour to higher ([LBB](https://lbbonline.com/news/ipa-publishes-lemon-a-repair-manual-to-reverse-the-crisis-in-creative-effectiveness)).
- **Evidence.** [B]: observational, with award-entry bias. Lemon is [C] (vendor data).
- **Rule.** Even a 10s performance ad needs **an emotional peak**. The rational claim (one claim) rides *on* that peak; it is not the peak. Avoid "flat" motion: floating abstract UI with no character, no place, and no cause and effect.

### 1.17 Narrative transportation
- **Mechanism.** People who are absorbed in a story adopt its beliefs more and counter-argue less ([Green & Brock 2000](https://www.onfiction.ca/2014/02/research-bulletin-summarizing-over.html)). A meta-analysis of 76 studies modelled the antecedents of transportation: an identifiable character, an imaginable plot and verisimilitude ([van Laer et al. 2014, *JCR*](https://openaccess.city.ac.uk/id/eprint/6755/)). In Super Bowl ads, the **number of Freytag acts present** (exposition, rising action, climax, falling action, denouement) predicted favourability ([Quesenberry & Coolsen 2014](https://mosaic.messiah.edu/bus_ed/31); [JHU](https://hub.jhu.edu/2014/01/31/super-bowl-ads/)).
- **Evidence.** [B]. The Super Bowl study is correlational, with n = 108 ads.
- **Rule.** Even in 15s, have a **protagonist (usually the motif) with a want, an obstacle and a change**. A "story" made of feature callouts has none of these. Compress the five acts; don't skip any.

### 1.18 Rule of three
- **Mechanism.** With a persuasion-motivated source, **three claims** are optimal. A fourth triggers scepticism that discounts all of them ([Shu & Carlson 2014, *J. Marketing*](https://marginalrevolution.com/marginalrevolution/2014/05/make-three-claims-when-trying-to-persuade.html)). In comedy, three beats (setup, setup, twist) are the minimum that establishes a pattern before breaking it [CRAFT].
- **Evidence.** [B] for claims, [CRAFT] for comedy.
- **Rule.** **Use at most three claims per film**, and ideally one. Use the triple to *create a prior and then violate it* (§1.2): beat 1 and beat 2 are the same, and beat 3 breaks the pattern.

### 1.19 Tension–release and excitation transfer
- **Mechanism.** Leftover arousal from suspense is misattributed to, and amplifies, the emotion of the resolution ([Zillmann's excitation-transfer theory](https://en.wikipedia.org/wiki/Excitation-transfer_theory); [Cantor, Zillmann & Bryant 1975](https://link.springer.com/doi/10.1007/BF00998188)). Huron's ITPRA model splits the response to an expectation into tension (uncertainty before the event) and prediction, reaction and appraisal responses (after it) ([Huron 2006](https://researchgate.net/profile/David-Huron-2/publication/209436188_Sweet_Anticipation_Music_and_the_Psychology_of_Expectation/links/0c96052e02be139f9f000000/Sweet-Anticipation-Music-and-the-Psychology-of-Expectation.pdf)).
- **Evidence.** [B]. The classic studies are old; the media applications are extensions.
- **Rule.** The payoff is only as big as the tension before it. Build tension with a slowing camera, a rising riser, compression (things squeeze or crowd), or **a 0.3–0.6s near-silence or freeze right before the hit**. The release should be fast (0.2–0.4s) and fluent.

### 1.20 Anticipation and reward timing
- **Mechanism.** In music, dopamine is released in the **caudate during anticipation** and in the **nucleus accumbens at the peak** ([Salimpoor et al. 2011](https://brams.org/2011/01/09/salimpoor/)). Anticipation is rewarding in its own right.
- **Evidence.** [B].
- **Rule.** **Telegraph *that* a payoff is coming, not *what* it is.** Use 1–3s of wind-up (a counter accelerating, a path drawing toward a target, a riser, the motif crouching). "Wait for it" works when the outcome is certain and its form is uncertain.

### 1.21 Music and sound
- **Mechanism.** Music evokes emotion through several mechanisms (BRECVEMA): brain-stem reflex (sudden, loud, dissonant), rhythmic entrainment, evaluative conditioning, contagion, visual imagery, episodic memory, musical expectancy and aesthetic judgement ([Juslin & Västfjäll 2008, *BBS*](https://www.cambridge.org/core/journals/behavioral-and-brain-sciences/article/abs/emotional-responses-to-music-the-need-to-consider-underlying-mechanisms/DEEDFFC61393C84BB417AE8B132EB34E)). Evidence that sonic logos help recall is mostly vendor data (Ipsos, Veritonic). One academic thesis found no cued-recall benefit, and recognition without the brand name embedded in the audio is poor ([YouGov](https://yougov.com/articles/40973-invest-sonic-branding-boost-consumer-recall-and-re); [Mizzou thesis](https://mospace.umsystem.edu/items/3ef128aa-1dc9-4777-b69a-17bd1b1607bb)).
- **Evidence.** [B] for the mechanisms, [C] for sonic-logo recall.
- **Rule.** Map each mechanism to a beat:
  - **Hook:** brain-stem reflex (a transient, a hit).
  - **Body:** entrainment (lock to BPM).
  - **Payoff:** expectancy (a riser that resolves on the downbeat).
  - **End:** conditioning (the *same* 2–4-note mnemonic on every film, always paired with the logo, so the pairing is learned).

  Sound is part of the story, not a garnish (see the sound-emotion map in §4d).

### 1.22 Colour psychology (weak; say so)
Elliot & Maier's own review flags methodological weaknesses ([Annual Review 2014](https://www.scinapse.io/papers/2164901293)). The famous "red impairs performance" effect failed to replicate ([Steele poster](https://www.appstate.edu/~steelekm/documents/Psychonomics2015Poster_Steele.pdf)), and a 2020 review doubts that robust colour priming exists ([PB&R 2020](https://link.springer.com/article/10.3758/s13423-020-01772-1)). Colour–brand-personality *fit* has some support ([Labrecque & Milne 2012, *JAMS*](https://link.springer.com/article/10.1007/s11747-010-0245-y)).
- **Evidence.** [C] for "colour X causes feeling Y".
- **Rule.** Use colour for **contrast, isolation (§1.14), a colour script (grey → brand) and ownership**, never for "blue = trust". The brand palette beats any chart of colour meanings.

### 1.23 IKEA / effort effects: judged mostly irrelevant
The IKEA effect requires *the consumer's own labour* ([Norton et al. 2012](https://dash.harvard.edu/handle/1/12136084)), and passive viewing isn't labour. There are two weak transfers.
- **Viewer completion.** Let the viewer mentally finish a shape, a pun or a pattern half a beat before the film does. Goldenberg's "interactive experiment" template is the advertising form of this (§3).
- **Visible craft.** 03 §5 already covers handmade texture as an authenticity signal.

Don't build stories on the IKEA effect.

---

## 2. Story structures for short-form motion

All timings are in seconds. "Lock" means the lockup is held still for ≥1.5s, or ≥2.5s at 15s+ (DIRECTOR_GUIDE §1). Each structure still maps onto the guide's Hook → Tension → Transformation → Payoff → Lockup arc. These structures decide *what happens* inside those beats.

| Structure | Beats | 10s | 15s | 30s | Use when | Example concept |
|---|---|---|---|---|---|---|
| **Pixar Story Spine** ([Adams / Coats](https://www.openculture.com/2013/03/pixars_22_rules_of_good_storytelling.html)) | Once upon a time / every day → until one day → because of that ×2 → until finally → ever since | 0–1.5 / 1.5–3 / 3–7 / 7–8 / 8–10 | 0–2 / 2–4 / 4–10 / 10–12 / 12–15 | 0–4 / 4–8 / 8–20 / 20–25 / 25–30 | Character-led brands; the motif as hero | A delivery dot does the same lonely loop every day, until one day it meets a second dot; because of that the route branches… until finally the routes draw the logo |
| **ABT** ([Olson](https://www.sesync.org/resources/communications-toolkit-and-therefore-statement)) | And (world) → But (conflict) → Therefore (brand action) | 0–2.5 / 2.5–5 / 5–10 | 0–4 / 4–8 / 8–15 | 0–8 / 8–16 / 16–30 | Explainers, B2B, one-claim ads. The default when unsure | "Your team ships every day **and** the work gets done, **but** status lives in 40 tabs, **therefore** Relay." |
| **PAS** (problem → agitation → solution) | Problem → it gets worse → resolved | 0–2 / 2–5 / 5–10 | 0–3 / 3–8 / 8–15 | 0–5 / 5–15 / 15–30 | Pain-led performance ads. Risk: negative tone, so keep the agitation comic or abstract | Notification badges multiply until the phone sags; one swipe and they fold into a single card |
| **Before / After / Bridge** | Hook on the *After*, then Before → Bridge (brand) → After again | 0–1.5 After / 1.5–4 Before / 4–8 Bridge / 8–10 | 0–2 / 2–6 / 6–12 / 12–15 | 0–3 / 3–12 / 12–25 / 25–30 | Visible transformations (D2C, design tools) | Open on the finished, beautiful room; rewind to chaos; the brand's brush sweeps it back |
| **Compressed hero's journey** | Ordinary world → call → threshold → ordeal → reward → return | not recommended | 0–2 / 2–4 / 4–6 / 6–10 / 10–13 / 13–15 | 0–3 / 3–6 / 6–10 / 10–20 / 20–26 / 26–30 | Launches, brand manifestos, fitness | A paper plane (motif) leaves a desk, crosses a storm of to-dos, lands on a summit that is the logo's peak |
| **The turn (volta)** | Long setup in one register → one-cut reinterpretation → landing | 0–6.5 / 6.5–7.5 / 7.5–10 | 0–10 / 10–11 / 11–15 | 0–20 / 20–22 / 22–30 | Humour, social causes, "it was X all along" | What looks like a galaxy for 10s is revealed by a zoom-out as latte foam |
| **Metaphor-driven (fusion)** | Show A → A behaves like B → A *becomes* B → B is the brand | 0–2 / 2–5 / 5–8 / 8–10 | 0–2 / 2–6 / 6–12 / 12–15 | 0–4 / 4–14 / 14–25 / 25–30 | Abstract products (software, finance, insurance) | Insurance: an umbrella's ribs fold into the shield in the logo |
| **Transformation arc** | State A (grey, chaotic) → process → state B (brand colour, ordered) | 0–2 / 2–7 / 7–10 | 0–3 / 3–11 / 11–15 | 0–6 / 6–24 / 24–30 | The verb is "clarify / organise / grow" | Scattered dots sort themselves by colour into the logo grid |
| **Reveal** | Partial (macro, silhouette, blur) → clues → full reveal | 0–4 / 4–7 / 7–10 | 0–6 / 6–11 / 11–15 | 0–12 / 12–24 / 24–30 | Product launches, mystery, unboxing | A macro texture zooms out to a sneaker sole, then the shoe, then the logo on the heel |
| **Loop narrative** | Last frame = first frame. The story implies a cycle | 0–9 + seam | 0–14 + seam | 0–29 + seam | Organic Reels/TikTok, web heroes (replays count) | A drop falls, becomes a river, the sea, a cloud, rain, and the same drop |
| **Mystery box** | An unexplained object or question → withheld → partial answers → answer *plus* a new question | 0–2 / 2–6 / 6–9 / 9–10 | 0–3 / 3–9 / 9–13 / 13–15 | 0–5 / 5–18 / 18–27 / 27–30 | Series content, teasers, edu ("what does this word mean?") | A sealed box that ticks; each beat removes one side |
| **Contrast story** | Two lanes in parallel (split screen or alternating cuts); the lanes diverge, then one wins | 0–1.5 / 1.5–7 / 7–10 | 0–2 / 2–11 / 11–15 | 0–3 / 3–24 / 24–30 | Comparison claims without naming rivals | Left: a day of meetings; right: a day of Relay. Same clock, different lives |
| **World without → with** | The world with the product absent, shown absurdly → the product appears → the world snaps right | 0–5 / 5–7 / 7–10 | 0–7 / 7–10 / 10–15 | 0–14 / 14–20 / 20–30 | Category-defining utilities (Goldenberg's "absurd alternative") | A world without maps: everyone navigates by smell, a cartoon of noses. Then a pin drops |
| **Pattern-break triple** | Beat, same beat, broken beat | 0–2 / 2–4 / 4–7 / 7–10 | 0–3 / 3–6 / 6–10 / 10–15 | (use as a sub-structure) | Humour, 6–10s bumpers | Coffee rounds up. Bus rounds up. Rent… the app politely looks away |

**Picking rules [CRAFT].**
- ≤10s: ABT, the turn, pattern-break or reveal (one move).
- 15s: anything except the hero's journey.
- 30s+: spine, hero's journey or contrast.
- Organic content should always be a loop narrative, or have a loop seam.
- The structure is chosen *after* the concept (§4c). It is a container, not an idea.

---

## 3. How great creative directors find unique ideas

### 3.1 Why the first idea is always the obvious one
- **Later ideas are more original.** In divergent thinking, later responses are more creative than earlier ones (the serial-order effect). People underestimate how much better their ideas get if they keep going (the "creative cliff illusion": 66% more ideas than predicted, rated more creative) ([Beaty & Silvia 2012; Lucas & Nordgren 2015, via](https://jgregoryjones.notion.site/How-to-Be-More-Creative-The-Atlantic-f7dff944dee1822cadfc0101052d5fdd); [2024 replication](https://ifp.nyu.edu/?p=1715782)) [B].
- **LLMs make this worse.** Different models give strikingly similar answers to open-ended prompts, and one model repeats itself across runs (the "Artificial Hivemind", NeurIPS 2025 best paper) ([Jiang et al. 2025](https://arxiv.org/abs/2510.22954)). AI help makes individual stories better but *collectively more alike* ([Doshi & Hauser 2024, *Science Advances*](https://pmc.ncbi.nlm.nih.gov/articles/PMC11244532)). Part of the cause is **typicality bias** in human preference data, which teaches models that the familiar answer is the good one ([Zhang et al. 2025, Verbalized Sampling](https://arxiv.org/html/2510.01171v1)) [B].
- **What helps.** Chain-of-thought ideation raised the number of unique GPT-4 ideas from about 3,700 to 4,700 ([Meincke, Mollick & Terwiesch 2024](https://papers.ssrn.com/abstract=4708466)). Asking for several responses *with their probabilities* (verbalised sampling) raised creative-writing diversity 1.6–2.1× ([Zhang et al. 2025](https://arxiv.org/html/2510.01171v1)) [B].

**Implication.** Our director is a hivemind by default. Without a deliberate divergence procedure, every coffee brand gets steam and every fintech gets a rising arrow.

### 3.2 What the great shops actually do [CRAFT unless cited]
- **Find the inherent drama (Leo Burnett).** Every product has drama already in it. The job is to find it, not to bolt cleverness on ([Burnett](https://en.wikipedia.org/wiki/Leo_Burnett); [ANBHF](https://anbhf.org/laureates/leo-burnett/)). For us: search the product's *mechanism* for a moment that is already dramatic (a round-up, a drop, a click) before reaching for an external metaphor.
- **Be interesting, or the truth goes unheard (Bernbach / DDB).** "Rules are what the artist breaks; the memorable never emerged from a formula." Truth persuades only once it's believed, and it's believed only once it's heard ([Print](https://www.printmag.com/featured/legends-in-advertising-bill-bernbach/)). Bernbach's VW "Think Small" *inverted the category convention*: big American cars were sold big, so the VW was sold small and honest.
- **Walk in stupid (Wieden+Kennedy).** "Walk in stupid every morning" means dropping assumptions ([B&T](https://www.bandt.com.au/opinion/innovation-importance-walking-stupid)). Nike work sells the athlete's *truth* and a cultural tension, not the shoe's features.
- **Cultural tension (Holt).** Mature categories fall into a "cultural orthodoxy" where every brand mimics the others. Breakthroughs answer an ideological opportunity that social change opens up, often borrowing from subcultures ([Holt & Cameron, *Cultural Strategy*](https://www.goodreads.com/book/show/9398076)). For us: list the category's orthodoxy, then find the tension the audience feels that the orthodoxy ignores.
- **Product as proof (Apple).** One idea per spot, the product is the hero, and the demonstration is the drama ("Shot on iPhone" made the users' photos the ad).
- **Redefine the problem (Trott, Droga5).** "Predatory thinking": go upstream and change a problem you can't solve into one you can ([Trott](https://www.procopywriters.co.uk/2013/08/predatory-thinking-by-dave-trott/)). Droga5's "Decode Jay-Z" turned a book launch into a city-wide hunt, solving distribution instead of making an ad.

### 3.3 Creativity templates (the only quantified ideation method for ads)
Goldenberg, Mazursky & Solomon found that **89% of 200 top award-winning ads fit six templates, against 50% of other award winners and 2.5% of non-winning ads**. Teams taught the templates produced ads rated higher on creativity, brand attitude and recall. Pictorial analogy accounted for 38% of the template-matching top ads and consequences for 21% ([*Marketing Science* 1999](https://business.columbia.edu/sites/default/files-efs/pubfiles/3384/fundamental.pdf)) [B]. Mapped to our kit:

| Template (versions) | What it does | Motion-kit translation |
|---|---|---|
| **Pictorial analogy** (replacement, extreme analogy) | A symbol enters the product space | `morph` A→B, the logo as window, the motif becomes a product |
| **Extreme situation** (absurd alternative, extreme attribute, extreme worth) | An unrealistic situation exaggerates one attribute | Scale jumps, the "world without" structure, physics gags |
| **Consequences** (extreme, inverted) | Shows the extreme result of using, or *not* using, the product | A time-leap counter, a chain-reaction path, collapse vs. order |
| **Competition** (attribute, worth, uncommon use) | The product competes with something from another class | Split-screen race, a "vs." card, the product in an odd job |
| **Interactive experiment** (activation, imaginary) | The viewer does or imagines an experiment | "Pause now" / "tap to…" / "count the dots" overlays; the viewer completes the shape |
| **Dimensionality alteration** (new parameter connection, multiplication, division, time leap) | Changes the product's dimension relative to its world | Time-lapse, ×100 repeat, split into parts, infinite zoom |

### 3.4 Technique cards for the AI (each produces 1 concept in §4b)

1. **Inherent drama.** Find the 1-second moment in the product's mechanism that is already dramatic.
2. **Metaphor mining.** DIRECTOR_GUIDE Step 2, but force a *non-category* domain: a kitchen for finance, weather for software.
3. **Inversion / category-convention flip.** List 5 category conventions and do the opposite of one (Think Small).
4. **Exaggeration / extreme situation.** Push one attribute to an absurd extreme.
5. **Perspective shift.** Tell it from the POV of the object, the problem, the motif or the competitor.
6. **Forced connection.** Pick a random noun from the kit's shape library (`bean pin bolt spiral eye moon…`) and force a link to the brand truth.
7. **Constraint.** One shape, one colour, no words. Or the entire film in one continuous shot.
8. **Cultural tension.** "Everyone in the category says X, but the audience secretly feels Y."
9. **Consequence / time leap.** Show day 1 against day 365, or the ripple effect of one action.
10. **Sensory transposition.** Show taste as sound, speed as colour, quiet as a straight line.

**Originality × relevance × craftability.** Score them *multiplicatively*, because a zero on any one kills the idea. An original but irrelevant idea is art-school work; a relevant but unoriginal one is wallpaper; an original, relevant idea we can't render is a pitch deck.

### 3.5 Making an AI avoid cliché
1. **Generate the obvious on purpose.** Concept #1 is always "the control": the first idea anyone would have. Name its elements and add them to the per-project ban list. It also serves as the score floor.
2. **Run the blacklist (§4f).** Any central element on the niche list caps Uniqueness at 1, unless the concept *explicitly subverts* that cliché (sheep on strike is fine; sheep counting is not).
3. **Force technique diversity.** The 8 concepts must use 8 different technique cards. This makes the model run through the ideas a single prompt would never reach (§3.1).
4. **Verbalised probabilities.** Have the model estimate how likely each concept is to be "a typical first idea from 10 other agencies" (0–1). Discard anything above 0.3.
5. **Distance check.** Compare the one-line concept with the control and with the brand's previous concepts (project history). If it shares the motif *and* the structure, it's a rerun.
6. **Hostile critic pass.** A second pass role-plays a jaded CD: "I've seen this. Where?" If the critic can name a well-known ad it resembles, the concept loses 2 Uniqueness points.

---

## 4. The Story Engine (the pipeline the director runs before `set_spec`)

```
(a) Truth & tension → (b) 8 concepts via 8 techniques → (c) rubric scoring + gates
→ (d) develop the winner: beat sheet + intensity curve + wow + sound map + mnemonic ending → (e) self-critique → spec
```

### (a) Extract the brand truth and audience tension (5 lines, all required)
1. **Truth:** "<Brand> helps <who> <verb> <object>, feeling <adj>." (DIRECTOR_GUIDE Step 1.)
2. **Inherent drama:** the most dramatic second in how the product works.
3. **Audience tension:** what they feel and don't say, usually a contradiction ("I want to save but saving feels like a diet").
4. **Category orthodoxy:** 3–5 things every competitor's ad does (feeds the blacklist).
5. **One true thing:** a short, specific, slightly uncomfortable insight that a customer would nod at ("Nobody misses 37 cents").

Never invent facts. If the brief lacks a number, the film doesn't state one.

### (b) Generate 8 concept candidates
- #1 is the control (§3.5).
- #2–#8 each use a different technique card (§3.4). At least one must be a Goldenberg template, one must be sound-led, and one must be humorous (benign violation) unless the brand is somber.
- Each concept is **one line**: the protagonist, the violation or twist, and how it becomes the brand.

### (c) Score with the rubric

Score each dimension 0–5. Total = Σ(weight × score) / 75 × 100.

| Dim | Weight | What it measures (psychology) | 1 = | 3 = | 5 = |
|---|---|---|---|---|---|
| **H**: hook strength | 2 | Motion onset + a prediction error or specific gap in ≤1s (§1.1, 1.2) | Logo or title card, static start | Moving and readable, but the "why keep watching" is generic | Frame 0 shows an impossible or unfinished thing with a precise question |
| **S**: surprise / schema violation | 2 | A prior is set, then violated, then resolved (§1.2, 1.3) | Nothing unexpected | One mild twist, guessable | Expectation built, then violated, resolved in <1s; viewers re-watch |
| **E**: emotional peak | 2 | A named emotion (delight, awe, relief, triumph, warmth) peaking at 60–80% (§1.5, 1.10, 1.19) | Flat throughout | A peak exists but is mild or mistimed | Unmistakable peak with tension before it and fast release |
| **P**: payoff and ending | 2 | Peak-end: the ending resolves the gap and is ≥80% of peak; the motif becomes the logo (§1.5) | Fades to a logo card | The logo lands but the gap is half-closed | The end is a second high (snap + mnemonic) and loops |
| **B**: brand linkage | 2 | The idea only works for this brand; distinctive assets sit inside the peak; pulsed (§1.4, 1.14, 1.15) | Swap-a-logo test fails | The brand appears at the peak but the idea is generic | The story *is* the product truth; the motif/colour/sound are owned assets |
| **C**: clarity / fluency | 1.5 | One idea, ≤3 claims, readable sound-off, resolves in a sentence (§1.7, 1.18) | Needs a voiceover to understand | Clear on the second watch | A stranger can retell it in one sentence after one view |
| **U**: uniqueness | 2 | Distance from the control, the blacklist and known ads (§3.5) | Uses a blacklisted cliché centrally | Fresh execution of a familiar idea (MAYA acceptable) | A concept no competitor could run; the critic can't name a precedent |
| **F**: feasibility with our kit | 1.5 | Buildable with morph, actors, logo modes, path, particles, counter, device, 3D and sfx | Needs footage or character animation we don't have | Needs a custom component | Built entirely from documented primitives |

**Gates (hard fails, regardless of total).** U ≥ 3, B ≥ 3, C ≥ 3, F ≥ 3.

**Decision rules.**
- Winner = the highest total that passes the gates.
- Ties go to the higher E + P (peak-end beats everything).
- A runner-up that is ≥70 and has a stronger hook becomes an **alternate hook variant** with the same body (03 §4 recommends 3–5 hook variants).
- **Graft:** one element from a high-scoring loser may be added to the winner if it raises a dimension without breaking clarity. Sound ideas graft easily.

### (d) Develop the winner

1. **Beat sheet.** One row per beat: time, beat job (Hook / Tension / Transformation / Peak / Payoff / Lock), picture (kit primitives), sound, on-screen text (≤7 words), intensity (0–10).

2. **Intensity curve (one value per second) [derived from §1.2, 1.5, 1.19].**
   - Frame 0: ≥5.
   - The tension beat may dip, but never below 3.
   - Rise monotonically toward the peak (joy velocity, §1.2).
   - **A 0.3–0.6s dip right before the peak** (silence or freeze).
   - Peak 9–10 at 60–80% of runtime.
   - End ≥8 (the lockup has its own hit).
   - No two consecutive seconds identical in the body, except at the deliberate pre-peak hold.

3. **The wow moment.** Place it at 60–80% (the peak). It has to be the film's single biggest Bayesian surprise *and* contain the brand asset. Valid mechanisms: an impossible transformation, a scale jump (awe), a pattern break, a satisfying completion, or a reinterpretation (volta).

4. **Sound–emotion map (kit names from KIT_REFERENCE → Sound).**

| Emotion / beat | Mechanism (§1.21) | Kit choice |
|---|---|---|
| Hook / startle | Brain-stem reflex | `impact-punch`, `hit-slam`, `glitch-stutter`; first transient at ≤0.2s |
| Curiosity | Expectancy (unresolved) | Sparse `tick-mech` / `tick-digital`, high register, no downbeat yet |
| Tension | Expectancy + arousal (§1.19) | `heartbeat-low`, `riser-long` timed so `at = peak − 2.33`; the music drops out 0.3–0.6s before the hit |
| Surprise / violation | Brain-stem + prediction error | `impact-deep` or a *wrong* sound (a pop where a thud was expected) |
| Delight / humour | Contagion, playful timbre | `pop-bubble`, `morph-wobble`, `pop-snap`; Playful palette |
| Satisfaction / completion | Precise 1:1 sync | `click-ui`, `pop-snap`, `ding-success` exactly on the snap frame |
| Awe | Low and wide, slow | `boom-sub` + `shimmer`, long holds, intensity ≤0.5; Cinematic or Luxury palette |
| Triumph / payoff | Expectancy resolved on the downbeat | `drop-bass` / `chime-bright` on the apex frame (`"beat:N@apex"`) |
| End / mnemonic | Evaluative conditioning | The brand's fixed 2–4-note signature (same for every film), ending exactly on the logo-lock frame |

5. **A memorable ending.** It needs three things:
   - a **visual mnemonic**: the motif becomes the logo (actor `snapTo`);
   - a **sonic mnemonic**: the fixed signature;
   - a **loop seam**: the last frame returns the motif to its frame-0 pose.

   For ads, the CTA arrives *on* the payoff hit, not as a separate dead card after it.

6. **Proposed spec fields (no code change made).** The director can record the work in `concept` today (`hook`, `arc`). For tooling, a future `concept.story` could hold:
   ```json
   { "insight": "...", "tension": "...", "technique": "metaphor-mining",
     "structure": "transformation", "candidates": [{"line": "...", "scores": {"H":4,"S":4,"E":3,"P":4,"B":5,"C":4,"U":4,"F":4}, "total": 80}],
     "curve": [6,5,4,5,6,7,8,9,7,4,10,9,8,8,9], "wow": {"at": 10.2, "mechanism": "pattern break"},
     "mnemonic": {"visual": "crumb → logo O", "sonic": "3-note rising tick"}, "loop": true }
   ```

### (e) Self-critique checklist (answer every item before `set_spec`, and again after `preview_frames`)
- [ ] Can I say the film in one sentence: protagonist + twist + brand?
- [ ] Does frame 0 contain the gap or the violation, not a setup to one?
- [ ] Is the prior (the expectation) clearly established before I break it?
- [ ] Is there exactly **one** peak, at 60–80%, preceded by a dip or hold?
- [ ] Does the end score ≥80% of the peak? Is the CTA on the hit?
- [ ] Swap-a-logo test: would this film work for the #1 competitor? (If yes, fail.)
- [ ] Is the brand colour the *only* isolate in the tension scenes?
- [ ] Is the brand pulsed 2–4 times, with no single long logo block?
- [ ] Does anything central appear on the niche blacklist (§4f)? Is it subverted or removed?
- [ ] ≤3 claims (ideally one), ≤7 words per beat, readable with sound off?
- [ ] Does the motif show intention (anticipation, a look, a reaction)?
- [ ] Does every open loop close? Have I invented any number or claim?
- [ ] Can a jaded CD name the ad this copies? (If yes, U −2.)
- [ ] Does sound tell the same story: silence before the hit, the mnemonic on the lock?

### (f) Per-niche cliché blacklist

**The subversion clause:** a blacklisted item is allowed only as the *object of a twist*.

| Niche | Banned as a central idea |
|---|---|
| **Fintech / banking** | Rising arrows or green line charts going up; coins dropping into a piggy bank or jar; stacks of cash or gold bars; a spinning credit card; a padlock or shield for "secure"; a handshake; a rocket "to the moon"; a sprouting money plant; a graduation cap |
| **Crypto / web3** | Glowing blockchain cubes, a network of nodes, neon circuitry, "to the moon" rockets, a Bitcoin coin spin, matrix code rain |
| **SaaS / B2B** | Floating glassy dashboards; a 3D isometric office; a node network "connecting teams"; a cursor clicking "Get started"; puzzle pieces; gears turning; a lightbulb idea; people high-fiving at a laptop; "all-in-one" icons orbiting a logo |
| **AI products** | Glowing brain; a robot hand touching a human hand; purple-blue particle nebula; a sparkle ✨ icon on everything; typing chat bubbles as the whole story; "magic wand" |
| **Food & beverage** | Slow-motion pours; rising steam; flying ingredients exploding in slo-mo; fire and flames for "spicy"; a cheese pull; a fork twirling pasta; the "mmm" bite-and-close-eyes; a water-splash crown on fruit |
| **D2C beauty / personal care** | Water droplets on skin; a botanical leaf swirl for "natural"; a product rotating on a pastel pedestal; before/after skin split; a model touching her cheek; floating ingredient molecules |
| **Health / wellness / sleep** | Moon and stars; counting sheep; a yawning person; a lotus or meditation silhouette at sunset; a heartbeat line for "health"; leaves and water ripples |
| **Real estate** | Drone flyover of the skyline at golden hour; keys handed over; "Your dream home awaits"; a map pin bouncing; a family carrying boxes and laughing; a house icon with a heart |
| **App launch / consumer apps** | A phone spinning in space; app icons raining down; a notification confetti burst; a hand holding a phone with a glowing screen; "Download now" with App Store badges as the climax |
| **Language / education** | Flags; speech bubbles saying "Hola/Bonjour/Ciao"; a spinning globe; passport stamps; a graduation cap; a lightbulb; stacks of books; a streak flame |
| **Events / music** | Countdown 3-2-1; crowd hands in the air in silhouette; laser beams; speaker cones pulsing; confetti cannons; "See you there" |
| **Fitness** | Sweat drops in slo-mo; a lifting silhouette; a heartbeat line; a stopwatch; "No pain no gain" type slams; a sunrise run |
| **Travel** | A plane crossing a map with a dotted line; a passport and suitcase; a beach hammock; polaroids scattering; a spinning globe |
| **Sustainability** | A leaf in a hand; the Earth in palms; a green check over a globe; wind turbines at sunset; recycling arrows |
| **Creator / social** | Like hearts floating up; follower counters ticking up; a ring light; "link in bio" arrows as the payoff |

### (g) Six worked examples

Scores are listed as H S E P B C U F → total. Concept #1 is always the control. Fictional brands; numbers in beat sheets are placeholders the brief must supply.

---

**Example 1: Penny (fintech, round-up savings). 15s, 9:16, paid social.**
*Truth:* Penny helps people who "can't save" save from spare change automatically, feeling effortless. *Tension:* saving feels like a diet. *One true thing:* nobody misses the change from a coffee. *Logo:* a round "O" with a slot.

| # | Technique | Concept (one line) | Scores | Total |
|---|---|---|---|---|
| 1 | Control | Coins drop into a jar, a green arrow rises, "Save smarter" | 2 0 1 2 2 5 0 5 | 39 (U gate fail) |
| 2 | Metaphor mining + inherent drama | Every purchase sheds a few gold **crumbs** that fall off-screen; we follow them down and find they've quietly piled into a perfect coin, which becomes the Penny "O" | 4 4 3 4 5 4 4 4 | **80** |
| 3 | POV shift | Spare change narrates its forgotten life in a sofa cushion | 3 3 3 3 4 3 4 3 | 65 |
| 4 | Time leap | One day's round-up → fast-forward a year → the crumbs have built a staircase to a plane ticket | 3 3 4 4 3 3 3 4 | 67 |
| 5 | Competition | A New Year resolution card crumbles by Jan 17 while round-ups keep stacking | 3 3 3 3 3 4 3 4 | 64 |
| 6 | Pattern-break triple | Coffee rounds up. Bus rounds up. Rent… Penny politely looks away | 4 4 3 3 4 4 4 4 | 75 (alt hook) |
| 7 | Sound-led | Every round-up plays one note; a week of purchases composes the sonic logo | 3 3 3 4 4 3 4 3 | 68 (graft) |
| 8 | Cultural tension | "Quiet money": loud spending vs the silent stack | 2 2 2 2 2 3 3 4 | 49 |

*Winner #2, with #7's sound grafted in* (each crumb plays a tick note, and the notes resolve into the mnemonic).

| t | Beat | Picture | Sound | Int |
|---|---|---|---|---|
| 0–1.5 | Hook | A coffee cup `card` slides in; as it lands, 3 gold crumbs (`particles` + `morph` actor `circle`) chip off its corner and fall out of frame. "Where did that go?" | `pop-snap` + 3 rising `tick-mech` notes | 6 |
| 1.5–5 | Tension (prior ×3) | Bus ticket, groceries, a movie ticket: each sheds crumbs that fall away (the same move 3×, teaching the pattern). Grey palette; only the crumbs are gold (Von Restorff) | Tick notes continue, a scale climbing | 5→6 |
| 5–9 | Transformation | The camera tilts down, following the crumbs (`path` + camera move) past the floor into a dark space where crumbs drift and converge | `whoosh-long`, low pad, music thins | 7→4 (dip at 8.6–9) |
| 9–11 | **Wow / peak** | The crumbs snap into a perfect, gleaming coin (`logo assemble`-style convergence; `inertia`); a counter on the coin reads the user's saved total (placeholder) | Silence 0.4s → `ding-success` + the mnemonic's 3 notes resolve | 10 |
| 11–12.5 | Payoff | The coin rolls up and **becomes the "O" of Penny** (actor `snapTo: "logo#2"`, wordmark `cascade`) | `chime-bright` | 9 |
| 12.5–15 | Lock + CTA | "Spare change, saved." + button card; one new crumb falls from the top (loop seam) | The mnemonic tail; one tick | 8 |

Curve: `[6,6,5,5,6,6,7,7,4,10,10,9,8,8,8]`.

---

**Example 2: Relay (SaaS, async standups). 30s, 16:9, LinkedIn/web.**
*Truth:* Relay helps remote teams share status without meetings, feeling unblocked. *Tension:* the calendar is full but nothing moved. *Orthodoxy:* dashboards, node networks, high-fives.

| # | Technique | Concept | Scores | Total |
|---|---|---|---|---|
| 1 | Control | Floating glass dashboards and connected nodes, "Boost productivity" | 2 0 1 1 2 4 0 5 | 34 |
| 2 | Uncommon use (falling-blocks game schema) + satisfying completion | Meeting blocks fall into a weekly calendar like a falling-block game until it's nearly full; Relay cards (thin 4-second updates) slot in, rows clear with satisfying pops, and the cleared space reveals a free Friday afternoon shaped like the logo | 5 4 4 5 4 5 4 4 | **87** |
| 3 | POV | A meeting invite's existential crisis | 3 3 2 3 3 4 3 4 | 61 |
| 4 | Dimensionality (division) | A 30-minute block is squeezed into a 4-second card, and the leftover time spills out as daylight | 4 4 3 3 3 4 4 4 | 72 |
| 5 | Extreme situation | The 9:00 standup grows until it swallows the city | 4 4 3 3 2 3 4 3 | 65 |
| 6 | Contrast story | Two day-timelines side by side | 3 2 3 4 4 4 3 5 | 69 |
| 7 | Stat slam | A counter of hours returned (needs a real number) | 2 2 2 2 2 5 2 5 | 52 |
| 8 | Metaphor | A relay baton is passed across time zones as the sun moves | 3 3 3 4 4 3 4 4 | 70 |

*Winner #2.* Structure: ABT inside a transformation arc.

| t | Beat | Picture | Sound | Int |
|---|---|---|---|---|
| 0–2 | Hook | A week grid; a fat "Sync" block drops from the top and slams onto Monday (`drop-in` + `inertia`). "Your week, stacked." | `hit-slam` | 6 |
| 2–9 | And / But | Blocks rain faster ("Standup", "Status", "Sync re: sync") and stack up; the grid is 90% full and the camera pushes in. Grey blocks, red overflow warnings | Accelerating `tick-digital`, `heartbeat-low` from 6s | 5→8 |
| 9–10 | Pre-peak hold | One last huge block hovers at the top. Freeze. | Silence 0.5s | 4 |
| 10–17 | Therefore (transformation) | A thin brand-colour Relay card slides in *instead*; a full row clears with a pop and a flash; then another and another, in cascade (`repeat`, stagger 0.08) | `pop-snap` ×n synced 1:1, building pitch | 7→9 |
| 17–22 | **Wow** | The last rows clear at once; the remaining empty cells form the Relay logo shape in negative space (`logo mask`) | `drop-bass` on the downbeat | 10 |
| 22–26 | Payoff | Friday afternoon is empty, sunlit (shader); one small card reads "Shipped ✓". "Status without the meeting." | Warm pad | 8 |
| 26–30 | Lock | Logo + "Try Relay free". One block starts to fall from the top: the loop seam | Mnemonic | 8 |

---

**Example 3: Ember (food, small-batch hot sauce). 15s, 9:16.**
*Truth:* Ember helps home cooks turn bland food exciting, feeling bold. *Tension:* weeknight food is grey. *Inherent drama:* a single drop changes a dish.

| # | Technique | Concept | Scores | Total |
|---|---|---|---|---|
| 1 | Control | Slow-mo pour, flames, steam, chilis exploding | 3 0 2 2 2 5 0 4 | 42 |
| 2 | Inherent drama + transformation + colour script | **One drop**: a greyscale world; one drop hangs from the bottle lip ("wait for it"), falls, and on impact colour floods out from the plate across the whole world while the music switches from lo-fi to brass; the splash crown morphs into the logo's ember | 4 4 4 5 4 5 4 5 | **87** |
| 3 | POV | A bland plate of rice waits to be loved | 3 3 3 3 3 4 4 4 | 67 |
| 4 | Sensory transposition | Taste shown as sound: each dish has a note, Ember adds the bass | 4 4 3 3 3 4 4 3 | 70 |
| 5 | Benign violation | The other condiments evacuate the fridge | 4 4 4 3 3 3 4 3 | 71 |
| 6 | Stat (needs a real Scoville figure) | Counter slam of heat units | 3 3 3 3 4 4 4 4 | 69 |
| 7 | Extreme consequence | One drop melts through the plate, the table, the floor, the planet's core and out the other side | 4 4 4 4 4 3 4 3 | 76 |
| 8 | Recipe montage | Five dishes, five pours | 2 2 2 3 3 4 2 5 | 55 |

*Winner #2* (flames are banned; the drop and the colour do the work).

| t | Beat | Picture | Sound | Int |
|---|---|---|---|---|
| 0–1 | Hook | Extreme close-up: a red drop swells at a bottle lip; the only colour in a grey frame | `heartbeat-low` | 6 |
| 1–5 | Tension | Pull back slowly: a grey kitchen, a grey plate of noodles, grey steam (allowed, because it's grey and incidental). "Tuesday dinner." The drop stretches (anticipation) | Lo-fi loop, muffled; riser starts at 3.6 | 5→7 |
| 5–6.5 | Pre-peak | The drop releases; it falls in slow motion along an arc (`path`) | Music cuts to silence | 4 |
| 6.5–9 | **Wow** | Impact → `expand` transition from the impact point: colour floods across the plate, the room and the window view, beat-locked | `impact-deep` + a brass hit on the downbeat | 10 |
| 9–12 | Payoff | The splash crown `morph`s → flame-ember shape → the Ember logo icon (`snapTo`) | `shimmer` | 9 |
| 12–15 | Lock | Logo + "One drop. Whole new dinner." A new drop swells at the lip (loop) | Mnemonic (3 brass stabs) | 8 |

---

**Example 4: Hush (D2C, sleep earbuds). 15s, 9:16.**
*Truth:* Hush helps light sleepers block noise, feeling held. *Tension:* "I'm tired because of other people's noise." *Orthodoxy:* moons, sheep, yawns.

| # | Technique | Concept | Scores | Total |
|---|---|---|---|---|
| 1 | Control | Moon, stars, counting sheep, a yawning woman | 2 0 1 2 2 5 0 5 | 39 |
| 2 | Subverted cliché (benign violation) | The counting sheep go on strike because the snoring keeps *them* awake | 4 4 3 3 3 4 4 4 | 72 |
| 3 | Sensory transposition + satisfying completion | **Comb the noise**: snores, traffic and a barking dog drawn as jagged waveforms crossing the frame; a comb shaped like the earbud's silhouette sweeps through and combs them into one flat line, which becomes the horizon and then the logo underline; the sound literally drops out | 4 4 4 5 5 4 5 4 | **88** |
| 4 | Time leap | 7 hours in 7 seconds of undisturbed sleep | 3 3 3 3 3 4 3 4 | 64 |
| 5 | Awe | Zoom out from one bedroom to a silent planet | 3 3 4 4 3 3 4 2 | 66 (F weak) |
| 6 | Inversion | The world's volume knob is turned down | 4 4 3 3 3 3 4 4 | 70 |
| 7 | POV | The pillow's night shift | 3 3 4 4 3 3 4 4 | 70 |
| 8 | Product spin | A 3D earbud with feature callouts | 3 2 2 3 3 4 3 5 | 61 |

*Winner #3.* The silence is the distinctive sonic asset.

| t | Beat | Picture | Sound | Int |
|---|---|---|---|---|
| 0–1.5 | Hook | A jagged red waveform (`path` draw, zigzag) rips across a dark-blue frame. "3:12 a.m." | A loud snore SFX hit (brain-stem) | 7 |
| 1.5–5 | Tension | More waveforms layer in: traffic (zigzag), dog (spikes), neighbour's bass (wave); a tangle of noise | Noise builds; mixed SFX | 6→8 |
| 5–6 | Pre-peak | The earbud silhouette appears at the left edge, tilted like a comb (motif with agency: it "looks" at the mess) | A single `tap-soft` | 5 |
| 6–10 | **Wow** | The comb sweeps right; behind it every waveform is combed into one perfectly flat, soft line (morph lines → line; a precision fit). Satisfying completion | Each layer of sound cuts out as it's combed; by 9.5, **total silence** | 10 (silence as peak) |
| 10–12.5 | Payoff | The flat line glows and becomes the horizon; the sky warms slightly; the line becomes the underline of the Hush wordmark (`logo draw`) | One soft `chime-bright` in silence | 9 |
| 12.5–15 | Lock | "Hush. The world, combed flat." + CTA; a tiny squiggle starts at the far left (loop) | A breath of the mnemonic | 8 |

---

**Example 5: Nook (real estate / co-living for newcomers). 30s, 4:5.**
*Truth:* Nook helps people new to a city find home and people, feeling belonging. *Tension:* "a new city is 8 million people and nobody." *Orthodoxy:* skylines, keys, "dream home".

| # | Technique | Concept | Scores | Total |
|---|---|---|---|---|
| 1 | Control | Golden-hour drone skyline, a key handover, "Your dream home awaits" | 2 0 1 1 1 5 0 5 | 33 |
| 2 | Pictorial analogy | A map pin morphs into a house, then a heart | 4 3 3 4 3 4 3 4 | 69 |
| 3 | Von Restorff + rule of three + gather | **One lit window**: a night facade of 30 dark windows, one lit (you). "Day 1." "Day 2." Same. "Day 3": a second window lights and a warm line draws between them; then windows light in a cascade, lines connect, and the network of lines forms the Nook logo | 4 4 5 5 5 4 4 4 | **88** |
| 4 | POV | The door's view of arrivals | 3 3 3 3 3 4 3 4 | 64 |
| 5 | Pattern-break triple | Dinner for one, dinner for one, then a table of six | 3 3 4 4 3 4 3 4 | 69 |
| 6 | Inversion | "We don't rent rooms. We rent hallways." | 3 4 3 3 4 4 3 3 | 67 |
| 7 | Metaphor | The city as a sea, home as an island | 4 3 4 3 3 3 4 3 | 68 |
| 8 | Amenity list | Gym, Wi-Fi, rooftop | 3 2 2 3 2 4 2 5 | 55 |

*Winner #3* (it absorbs #5's triple).

| t | Beat | Picture | Sound | Int |
|---|---|---|---|---|
| 0–3 | Hook | A grid of 30 dark windows (`cloud grid` of `rounded-square`); one is warm amber. "Day 1." | A single low piano note, city hum | 5 |
| 3–9 | Tension (prior) | Slow push; the same lone window. "Day 2." The silhouette inside eats alone (simple shape with agency: it sighs, a slow scale-down) | The hum continues; the same note | 4→5 |
| 9–13 | Break (beat 3) | "Day 3." A window two floors down lights. The two silhouettes notice each other (rotation toward); a warm line draws between them (`path` draw) | `sparkle-up`; the music enters | 6→7 |
| 13–20 | Transformation | Windows light in a radial cascade (stagger 0.08); lines connect them; the camera pulls back | Building rhythm, `pop-bubble` per window | 7→9 |
| 20–20.5 | Hold | Everything lit; the line network trembles | Silence 0.4s | 5 |
| 20.5–25 | **Wow / payoff** | The lines tighten and **snap into the Nook logo** (`morph` → `svg:logo#icon`, `snapTo`); the building behind glows | `drop-bass` + chord resolve | 10 |
| 25–30 | Lock | "New city. Not alone." + "Find your Nook"; all windows dim except one (loop to frame 0) | Mnemonic (piano note + chord) | 8 |

---

**Example 6: Parla (app launch, language learning). 15s, 9:16 organic (series-able).**
*Truth:* Parla helps curious adults learn the words people actually use, feeling fluent in feelings, not phrasebooks. *Tension:* textbook language doesn't match how people talk. *Orthodoxy:* flags, "Hola" bubbles, globes, streak flames.

| # | Technique | Concept | Scores | Total |
|---|---|---|---|---|
| 1 | Control | Flags, "Hola/Bonjour/Ciao" bubbles, a spinning globe | 2 0 1 2 2 5 0 5 | 39 |
| 2 | Benign violation | A mispronunciation morph: "coffee" becomes "cough" (icon morph), corrected by Parla | 4 4 4 4 3 4 4 4 | 77 |
| 3 | Subtitles of life | Your daily scenes, captioned in Italian, more each day | 4 4 3 3 3 3 4 3 | 68 |
| 4 | Curiosity gap + kinetic type acting + mystery box | **Untranslatable**: "abbiocco (it.)" appears with a redacted definition; the letters start drooping, yawning, and slumping onto each other (the type *acts* the meaning); reveal: "the drowsiness after a big lunch"; the last "o" curls up asleep and becomes Parla's speech-dot logo; "next: a word for…" opens the next episode | 5 4 4 5 4 4 5 4 | **88** |
| 5 | Word slot | "Hello" cycles through 10 languages | 3 3 3 3 3 4 3 4 | 64 |
| 6 | Pictorial analogy | A letter becomes a door into a city street | 3 4 3 4 3 4 4 4 | 72 |
| 7 | Streak | A streak counter (blacklisted-adjacent) | 3 3 3 3 4 3 3 3 | 63 |
| 8 | Testimonials | Review cards | 3 3 2 3 3 3 3 4 | 59 |

*Winner #4.* The word's meaning must be verified before use; the brief or a dictionary supplies it, and the director never invents it.

| t | Beat | Picture | Sound | Int |
|---|---|---|---|---|
| 0–1 | Hook | "abbiocco" slams in huge (`stretch`); under it, "(n.) = ████████" redacted. "No English word for this." | `hit-slam` | 7 |
| 1–5 | Curiosity | The letters go heavy: the "b"s droop, the "i" dot slides down, and letters lean on each other (`physics` / per-glyph rotate with `lag`). Slow push | Slow `tick-mech`, a lazy tuba-ish pad (Playful) | 6→7 |
| 5–7 | Clues | Small icons drift in: a plate of pasta, a clock at 14:00, a sofa (3 clues, rule of three) | `pop-bubble` ×3 | 7→8 |
| 7–7.5 | Hold | The redaction bar trembles | Silence | 5 |
| 7.5–10 | **Wow** | The bar wipes away: "the drowsiness after a big lunch." All the letters slump into a pile together (benign: they're napping) | `pop-snap` + a soft snore gag + `chime-bright` | 10 |
| 10–12.5 | Payoff | The last "o" curls up like a sleeping cat and morphs into Parla's speech-dot icon (`snapTo`), wordmark `cascade` | `sparkle-up` | 9 |
| 12.5–15 | Lock + loop | "Learn the words people actually feel." Then a new redacted word slides in at the bottom: "Next: ████" (Ovsiankina resumption; it opens the next episode) | Mnemonic (2 notes) | 8 |

---

### Notes on the examples
- In every case the **control scored 33–42 and failed the Uniqueness gate**. That is the point: it marks where generic AI output lands.
- Winners scored 80–88 by combining one *inherent-drama or metaphor* idea with a *satisfying or pattern-break* peak and a motif-to-logo ending. That is the general recipe the engine converges on, so the hostile critic (§3.5) should push variety across a brand's series. Rotate structures between films and keep the assets fixed.
- Each winner is buildable from documented primitives: `morph`, actors with `snapTo`, `path`, `cloud`, `expand`, `logo` modes, counters, text presets, and the listed sfx. F ≥ 4 everywhere.
