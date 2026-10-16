/**
 * The curated CC0 recorded library: which packs, which files, and how each is tagged. Feeds scripts/sfx-ingest.ts.
 *
 *   tsx scripts/sfx-curate.ts [--root ~/.cache/ms-sfx-dl] [--fetch]
 *
 * --fetch downloads the pack archives listed below with curl into <root> (then unzip them by hand / with `unzip`).
 * Every pack below was checked by hand on its page on the verification date: Kenney packs state "License: Creative
 * Commons CC0" (and ship a License.txt saying CC0); each OpenGameArt page lists exactly one license, "CC0".
 * Never add a pack that is CC-BY / CC-BY-SA / GPL / NC / "multi-license" here: the ingest refuses non-CC0 packs.
 *
 * Tags: category = taxonomy slot (docs/research/04-sound-design.md §2), material = what it is made of, emotions /
 * palettes = intent hints for the planner. weight / speed / brightness / pitch / peakAt are measured by the analyzer.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ingest, type Curation, type CurationItem, type PackInfo } from "./sfx-ingest";

const VERIFIED = "2026-10-16";
const CC0 = { license: "CC0 1.0 (public domain dedication)", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", verified: VERIFIED };

const kenney = (slug: string, title: string, dl: string): PackInfo => ({
  id: `kenney-${slug}`, title: `Kenney — ${title}`, url: `https://kenney.nl/assets/${slug}`, author: "Kenney (kenney.nl)", ...CC0,
  download: dl, root: `kenney/x/${slug}/Audio`,
});
const oga = (slug: string, title: string, author: string, dl: string, sub = "x"): PackInfo => ({
  id: `oga-${slug}`, title: `OpenGameArt — ${title}`, url: `https://opengameart.org/content/${slug}`, author, ...CC0,
  download: dl, root: sub ? `oga/${slug}/${sub}` : `oga/${slug}`,
});
const F = "https://opengameart.org/sites/default/files";

export const PACKS: PackInfo[] = [
  kenney("impact-sounds", "Impact Sounds", "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip"),
  kenney("interface-sounds", "Interface Sounds", "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip"),
  kenney("ui-audio", "UI Audio", "https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip"),
  kenney("rpg-audio", "RPG Audio", "https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip"),
  kenney("casino-audio", "Casino Audio", "https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip"),
  kenney("digital-audio", "Digital Audio", "https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip"),
  kenney("sci-fi-sounds", "Sci-fi Sounds", "https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip"),
  oga("sound-effects-pack", "Sound Effects Pack (recorded foley)", "OwlishMedia", `${F}/Owlish%20Media%20Sound%20Effects.zip`),
  oga("202-more-sound-effects", "202 More Sound Effects (recorded household foley)", "OwlishMedia", `${F}/MoreSounds.zip`),
  oga("87-clickety-clips", "87 Clickety Clips", "OwlishMedia", `${F}/Click_Clips.zip`),
  oga("100-cc0-sfx", "100 CC0 SFX", "rubberduck", `${F}/100-CC0-SFX_0.zip`),
  oga("100-cc0-sfx-2", "100 CC0 SFX #2", "rubberduck", `${F}/sfx_100_v2.zip`),
  oga("75-cc0-breaking-falling-hit-sfx", "75 CC0 breaking / falling / hit sfx", "rubberduck", `${F}/sfx_breaking_and_falling.zip`),
  oga("40-cc0-water-splash-slime-sfx", "40 CC0 water / splash / slime SFX", "rubberduck", `${F}/water-splash-slime-sfx.zip`),
  oga("swishes-sound-pack", "Swishes Sound Pack", "artisticdude", `${F}/swishes.zip`),
  oga("10-book-page-flips", "10 Book Page Flips", "StarNinjas", `${F}/book_flips_-_starninjas.zip`),
  oga("book-flip-sounds", "Book Flip Sounds", "Voltiment555", `${F}/BookFlip_SFX.zip`),
  oga("12-coin-sound-effects", "12 Coin Sound Effects", "StarNinjas", `${F}/coins_-_starninjas.zip`),
  oga("keyboard-soundpack-1-typing-and-single-keystrokes", "Keyboard Soundpack #1", "unicaegames", `${F}/unicae_games_keyboard_soundpack_1_0.zip`),
  oga("bubble-sound-effects", "Bubble Sound Effects", "BMacZero", `${F}/bubbles-single1.wav`, ""),
  oga("bell-dingschimes", "Bell dings/chimes", "PWL", `${F}/bell_ding1.wav`, ""),
  oga("camerashudder", "Camera shutter", "FacadeGaikan", `${F}/camera_0.ogg`, ""),
  oga("coin-drop", "Coin Drop", "Vinrax", `${F}/coin_drop.wav`, ""),
  oga("zipper", "Zipper", "AntumDeluge", `${F}/zipper-1.wav`, ""),
  oga("air-whoosh", "Air Whoosh", "pyranostudios", `${F}/whoosh2_0.wav`, ""),
];

// ----------------------------------------------------------------------------------------------- tagging helpers

type Tags = Omit<CurationItem, "name" | "pack" | "file">;
const items: CurationItem[] = [];
/** Add a numbered family: files[i] → `${base}-${i+1}`. */
const fam = (pack: string, base: string, files: string[], tags: Tags) => files.forEach((file, i) => items.push({ name: `${base}-${i + 1}`, pack, file, ...tags }));
const K = (s: string) => `kenney-${s}`, O = (s: string) => `oga-${s}`;
const range = (fmt: (i: number) => string, ids: number[]) => ids.map(fmt);
const p3 = (i: number) => String(i).padStart(3, "0");
const p2 = (i: number) => String(i).padStart(2, "0");

const ALL = ["cinematic", "tech", "playful", "minimal", "luxury", "hype"];
const PREMIUM = ["cinematic", "minimal", "luxury", "tech"];
const PLAYFUL = ["playful", "hype", "tech"];
const GAMEY = ["playful", "hype"];

// --- impacts by weight × material (Kenney Impact Sounds: dry, close, consistent)
const imp = (kind: string, w: "light" | "medium" | "heavy", ids: number[]) => range((i) => `impact${kind}_${w}_${p3(i)}.ogg`, ids);
fam(K("impact-sounds"), "glass-tap", imp("Glass", "light", [0, 1, 2, 3, 4]), { category: "impact.light", material: ["glass"], emotions: ["premium", "precise", "fragile"], palettes: PREMIUM });
fam(K("impact-sounds"), "glass-knock", imp("Glass", "medium", [0, 1, 2, 3, 4]), { category: "impact.medium", material: ["glass"], emotions: ["premium", "solid"], palettes: PREMIUM });
fam(K("impact-sounds"), "glass-thud", imp("Glass", "heavy", [0, 1, 4]), { category: "impact.heavy", material: ["glass"], emotions: ["solid", "premium"], palettes: PREMIUM });
fam(K("impact-sounds"), "metal-tick", imp("Metal", "light", [0, 1, 2, 3, 4]), { category: "impact.light", material: ["metal-thin"], emotions: ["precise", "premium"], palettes: ALL });
fam(K("impact-sounds"), "metal-knock", imp("Metal", "medium", [0, 1, 2, 3, 4]), { category: "impact.medium", material: ["metal-thin", "metal"], emotions: ["precise", "solid"], palettes: ALL });
fam(K("impact-sounds"), "metal-hit", imp("Metal", "heavy", [0, 1, 2, 3, 4]), { category: "impact.heavy", material: ["metal"], emotions: ["power", "solid"], palettes: ["cinematic", "tech", "hype"] });
fam(K("impact-sounds"), "bell-strike", range((i) => `impactBell_heavy_${p3(i)}.ogg`, [0, 1, 2, 3]), { category: "impact.heavy", material: ["metal"], emotions: ["resonant", "power"], palettes: ["cinematic", "hype"], maxDur: 1.6 });
fam(K("impact-sounds"), "wood-tap", imp("Wood", "light", [0, 1, 2, 3, 4]), { category: "impact.light", material: ["wood"], emotions: ["warm", "organic"], palettes: ["minimal", "playful", "cinematic"] });
fam(K("impact-sounds"), "wood-knock", imp("Wood", "medium", [0, 1, 2, 3, 4]), { category: "impact.medium", material: ["wood"], emotions: ["warm", "solid"], palettes: ["minimal", "playful", "cinematic"] });
fam(K("impact-sounds"), "wood-thud", imp("Wood", "heavy", [0, 1, 2, 3, 4]), { category: "impact.heavy", material: ["wood"], emotions: ["warm", "power"], palettes: ["cinematic", "minimal"] });
fam(K("impact-sounds"), "ceramic-tap", imp("Plate", "light", [0, 1, 2, 3, 4]), { category: "impact.light", material: ["ceramic"], emotions: ["tactile", "warm"], palettes: ["minimal", "luxury", "playful"] });
fam(K("impact-sounds"), "ceramic-knock", imp("Plate", "medium", [0, 1, 2]), { category: "impact.medium", material: ["ceramic"], emotions: ["tactile", "solid"], palettes: ["minimal", "luxury"] });
fam(K("impact-sounds"), "ceramic-hit", imp("Plate", "heavy", [0, 1, 2]), { category: "impact.heavy", material: ["ceramic"], emotions: ["solid"], palettes: ["cinematic", "minimal"] });
fam(K("impact-sounds"), "soft-thud", imp("Soft", "medium", [0, 1, 2, 3, 4]), { category: "impact.light", material: ["cloth", "cardboard"], emotions: ["gentle", "calm"], palettes: ALL });
fam(K("impact-sounds"), "soft-boom", imp("Soft", "heavy", [0, 1, 2, 3, 4]), { category: "impact.heavy", material: ["cloth", "cardboard"], emotions: ["weight", "calm"], palettes: ALL });
fam(K("impact-sounds"), "punch", imp("Punch", "medium", [0, 1, 2, 3, 4]), { category: "impact.medium", material: ["body"], emotions: ["energy", "confident"], palettes: ["hype", "tech", "playful"] });
fam(K("impact-sounds"), "punch-heavy", imp("Punch", "heavy", [0, 1, 2, 3, 4]), { category: "impact.heavy", material: ["body"], emotions: ["power", "energy"], palettes: ["hype", "cinematic", "tech"] });
fam(K("impact-sounds"), "tap-generic", imp("Generic", "light", [0, 1, 2, 3, 4]), { category: "impact.light", material: ["plastic"], emotions: ["precise", "gentle"], palettes: ALL });

// --- recorded impacts / material hits (OpenGameArt CC0)
fam(O("100-cc0-sfx"), "glass-clink", range((i) => `glass_${p2(i)}.ogg`, [1, 2, 3, 4, 5]), { category: "impact.light", material: ["glass"], emotions: ["premium", "bright"], palettes: PREMIUM, maxDur: 0.6 });
fam(O("100-cc0-sfx-2"), "glass-ting", range((i) => `sfx100v2_glass_${p2(i)}.ogg`, [1, 4, 5]), { category: "impact.light", material: ["glass"], emotions: ["premium", "delight"], palettes: PREMIUM, tonal: true });
fam(O("75-cc0-breaking-falling-hit-sfx"), "glass-hit", ["bfh1_glass_hit_01.ogg", "bfh1_glass_hit_02.ogg"], { category: "impact.light", material: ["glass"], emotions: ["bright", "fragile"], palettes: PREMIUM });
fam(O("75-cc0-breaking-falling-hit-sfx"), "glass-shatter", ["bfh1_glass_breaking_02.ogg", "bfh1_glass_breaking_05.ogg"], { category: "impact.medium", material: ["glass"], emotions: ["shock", "energy"], palettes: ["hype", "cinematic"] });
fam(O("100-cc0-sfx"), "metal-clang", range((i) => `metal_${p2(i)}.ogg`, [1, 3, 4, 7, 10]), { category: "impact.medium", material: ["metal"], emotions: ["solid", "industrial"], palettes: ["cinematic", "hype", "tech"], maxDur: 0.6 });
fam(O("100-cc0-sfx"), "metal-slam", ["metal_08.ogg", "metal_09.ogg"], { category: "impact.heavy", material: ["metal"], emotions: ["power", "industrial"], palettes: ["cinematic", "hype"] });
fam(O("100-cc0-sfx"), "wood-block", range((i) => `wooden_${p2(i)}.ogg`, [1, 2, 3]), { category: "impact.light", material: ["wood"], emotions: ["warm", "organic"], palettes: ["minimal", "playful"] });
fam(O("100-cc0-sfx-2"), "wood-hit", ["sfx100v2_wood_hit_01.ogg", "sfx100v2_wood_hit_02.ogg"], { category: "impact.medium", material: ["wood"], emotions: ["warm", "solid"], palettes: ["minimal", "cinematic"] });
fam(O("75-cc0-breaking-falling-hit-sfx"), "wood-snap", ["bfh1_wood_hit_01.ogg", "bfh1_wood_hit_03.ogg"], { category: "impact.light", material: ["wood"], emotions: ["warm"], palettes: ["minimal", "playful"] });
fam(O("75-cc0-breaking-falling-hit-sfx"), "stone-tick", ["bfh1_rock_falling_02.ogg", "bfh1_rock_falling_04.ogg", "bfh1_rock_falling_07.ogg", "bfh1_rock_hit_01.ogg"], { category: "impact.light", material: ["stone"], emotions: ["tactile", "precise"], palettes: ["minimal", "cinematic"] });
fam(O("75-cc0-breaking-falling-hit-sfx"), "thud", ["bfh1_hit_06.ogg", "bfh1_hit_07.ogg", "bfh1_hit_08.ogg"], { category: "impact.medium", material: ["cardboard"], emotions: ["solid"], palettes: ALL });
fam(O("sound-effects-pack"), "clank", range((i) => `Impacts/clamour${i}.wav`, [3, 5, 7, 8, 10]), { category: "impact.medium", material: ["metal"], emotions: ["industrial", "tactile"], palettes: ["tech", "cinematic"] });
fam(O("sound-effects-pack"), "soft-thump", ["Impacts/fruit1.wav", "Impacts/fruit2.wav", "Impacts/fruit3.wav"], { category: "impact.light", material: ["organic"], emotions: ["gentle", "organic"], palettes: ["minimal", "playful"] });
fam(O("sound-effects-pack"), "hand-drum", ["Impacts/djembe1.wav", "Impacts/djembe2.wav", "Impacts/djembe3.wav"], { category: "impact.light", material: ["body", "wood"], emotions: ["warm", "human"], palettes: ["playful", "minimal"] });
fam(O("sound-effects-pack"), "toaster-click", range((i) => `Impacts/alt-toasterstep${i}.wav`, [1, 2, 3, 4]), { category: "mech.click", material: ["metal-thin"], emotions: ["tactile", "precise"], palettes: ["tech", "minimal", "playful"] });
items.push({ name: "finger-snap-1", pack: O("sound-effects-pack"), file: "Human/click-finger-snap.wav", category: "ui.snap", material: ["body"], emotions: ["human", "casual"], palettes: ["playful", "minimal", "hype"] });
items.push({ name: "clap-1", pack: O("sound-effects-pack"), file: "Human/solo-clap.wav", category: "impact.light", material: ["body"], emotions: ["human", "delight"], palettes: GAMEY, maxDur: 0.7 });
fam(O("100-cc0-sfx"), "gong", ["gong_02.ogg"], { category: "impact.heavy", material: ["metal"], emotions: ["resonant", "epic"], palettes: ["cinematic"], tonal: true });
fam(K("sci-fi-sounds"), "scifi-metal", range((i) => `impactMetal_${p3(i)}.ogg`, [0, 2, 3, 4]), { category: "impact.heavy", material: ["metal"], emotions: ["power", "industrial"], palettes: ["cinematic", "hype", "tech"], world: "abstract" });
fam(K("sci-fi-sounds"), "crunch", ["explosionCrunch_000.ogg", "explosionCrunch_004.ogg"], { category: "impact.heavy", material: ["stone"], emotions: ["power", "shock"], palettes: ["hype", "cinematic"], maxDur: 1.3, world: "abstract" });
fam(K("sci-fi-sounds"), "sub-boom", ["lowFrequency_explosion_000.ogg", "lowFrequency_explosion_001.ogg"], { category: "sub.boom", material: ["air"], emotions: ["weight", "awe"], palettes: ["cinematic", "hype"], world: "abstract" });

// --- UI: clicks / taps / toggles / pings
fam(K("interface-sounds"), "ui-click", range((i) => `click_${p3(i)}.ogg`, [1, 2, 3, 5]), { category: "ui.click", material: ["plastic"], emotions: ["precise"], palettes: ALL, world: "abstract" });
fam(K("ui-audio"), "ui-tap", ["click1.ogg", "click3.ogg", "click4.ogg", "click5.ogg", "mouseclick1.ogg", "mouserelease1.ogg"], { category: "ui.click", material: ["plastic"], emotions: ["precise"], palettes: ALL, world: "abstract" });
fam(K("ui-audio"), "ui-switch", range((i) => `switch${i}.ogg`, [10, 11, 17, 23, 26, 27, 30]), { category: "mech.switch", material: ["plastic"], emotions: ["tactile", "precise"], palettes: ALL });
fam(K("interface-sounds"), "ui-select", range((i) => `select_${p3(i)}.ogg`, [1, 2, 3, 4, 5, 6]), { category: "ui.tick", material: ["digital"], emotions: ["precise", "subtle"], palettes: ["tech", "minimal", "playful"], world: "abstract" });
fam(K("interface-sounds"), "ui-tick", ["tick_001.ogg", "tick_002.ogg", "tick_004.ogg"], { category: "ui.tick", material: ["digital"], emotions: ["precise"], palettes: ALL, world: "abstract" });
fam(K("interface-sounds"), "toggle", ["toggle_001.ogg", "toggle_002.ogg", "toggle_004.ogg"], { category: "ui.toggle", material: ["plastic"], emotions: ["precise"], palettes: ["tech", "minimal", "playful"], world: "abstract" });
fam(K("interface-sounds"), "switch-snap", range((i) => `switch_${p3(i)}.ogg`, [2, 4, 5, 6, 7]), { category: "mech.switch", material: ["plastic"], emotions: ["tactile"], palettes: ALL });
fam(K("interface-sounds"), "glass-ping", range((i) => `glass_${p3(i)}.ogg`, [1, 2, 3, 5, 6]), { category: "ui.ping", material: ["glass"], emotions: ["premium", "delight"], palettes: PREMIUM, world: "abstract" });
fam(K("interface-sounds"), "confirm", range((i) => `confirmation_${p3(i)}.ogg`, [1, 2, 3, 4]), { category: "ui.confirm", material: ["digital"], emotions: ["delight", "success"], palettes: ["tech", "playful", "minimal"], world: "abstract" });
fam(K("interface-sounds"), "error", ["error_004.ogg", "error_007.ogg", "error_008.ogg"], { category: "ui.error", material: ["digital"], emotions: ["friction"], palettes: ["tech", "playful"], world: "abstract" });
fam(K("interface-sounds"), "bloop", range((i) => `drop_${p3(i)}.ogg`, [1, 2, 3, 4]), { category: "ui.pop", material: ["liquid", "digital"], emotions: ["playful", "delight"], palettes: ["playful", "tech", "minimal"], world: "abstract" });
fam(K("interface-sounds"), "pluck", ["pluck_001.ogg", "pluck_002.ogg"], { category: "ui.pop", material: ["digital"], emotions: ["playful"], palettes: PLAYFUL, world: "abstract" });
fam(K("interface-sounds"), "zip-up", ["maximize_001.ogg", "maximize_003.ogg", "maximize_005.ogg"], { category: "whoosh.micro", material: ["air", "digital"], emotions: ["uplift", "playful"], palettes: ["tech", "playful"], world: "abstract" });
fam(K("interface-sounds"), "zip-down", ["minimize_001.ogg", "minimize_002.ogg", "minimize_004.ogg"], { category: "whoosh.micro", material: ["air", "digital"], emotions: ["release"], palettes: ["tech", "playful"], world: "abstract" });
fam(K("interface-sounds"), "glitch", range((i) => `glitch_${p3(i)}.ogg`, [1, 2, 3, 4]), { category: "digital.glitch", material: ["digital"], emotions: ["disruption"], palettes: ["tech", "hype"], world: "abstract" });
fam(O("87-clickety-clips"), "click", range((i) => `click${i}.wav`, [2, 10, 17, 21, 26, 27, 30, 37, 53, 59, 73, 79]), { category: "ui.click", material: ["plastic"], emotions: ["tactile", "precise"], palettes: ALL });
fam(O("sound-effects-pack"), "ui-knock", range((i) => `UI/UI_0${i}.wav`, [23, 24, 25, 26, 27]), { category: "ui.tap", material: ["wood", "plastic"], emotions: ["gentle", "tactile"], palettes: ["minimal", "luxury", "playful"], maxDur: 0.5 });
fam(O("sound-effects-pack"), "ui-snap", range((i) => `UI/UI_0${i}.wav`, [33, 34, 35, 37, 38]), { category: "ui.click", material: ["plastic"], emotions: ["crisp", "precise"], palettes: ALL, maxDur: 0.45 });
fam(O("sound-effects-pack"), "chime", range((i) => `UI/UI_0${i}.wav`, [10, 11, 12, 13]), { category: "magic.chime", material: ["glass", "digital"], emotions: ["delight", "premium"], palettes: ["luxury", "tech", "minimal", "playful"], tonal: true, world: "abstract", maxDur: 1.5 });
fam(O("bell-dingschimes"), "ding-bell", ["bell_ding1.wav", "bell_ding2.wav", "bell_ding3.wav", "bell_ding4.wav"], { category: "magic.chime", material: ["metal"], emotions: ["delight", "success"], palettes: ["playful", "minimal", "luxury"], tonal: true, maxDur: 1.4 });
fam(O("100-cc0-sfx"), "bell-small", ["bell_02.ogg"], { category: "ui.ping", material: ["metal"], emotions: ["delight"], palettes: ["playful", "minimal"], tonal: true });

// --- mechanical: switches, latches, locks, keys, camera, typing
fam(O("100-cc0-sfx"), "wall-switch", ["switch_01.ogg", "switch_02.ogg"], { category: "mech.switch", material: ["plastic"], emotions: ["tactile"], palettes: ALL });
fam(K("rpg-audio"), "latch", ["metalClick.ogg", "metalLatch.ogg"], { category: "mech.latch", material: ["metal-thin"], emotions: ["satisfying", "precise"], palettes: ALL });
fam(O("202-more-sound-effects"), "lock-click", range((i) => `Keys, Locks, Door/Key_Lock_Door_${p2(i)}.wav`, [4, 25, 31, 51]), { category: "mech.latch", material: ["metal"], emotions: ["satisfying", "secure"], palettes: ["tech", "minimal", "cinematic"], maxDur: 0.6 });
fam(O("100-cc0-sfx"), "key-turn", ["key_open_01.ogg", "key_open_02.ogg"], { category: "mech.latch", material: ["metal-thin"], emotions: ["secure"], palettes: ["tech", "minimal"] });
fam(O("100-cc0-sfx-2"), "lock-open", ["sfx100v2_lock_open_01.ogg"], { category: "mech.latch", material: ["metal"], emotions: ["secure", "release"], palettes: ["tech", "minimal"] });
fam(O("202-more-sound-effects"), "keys-jingle", range((i) => `Keys, Locks, Door/Key_Lock_Door_${p2(i)}.wav`, [5, 11, 13, 16, 30, 35]), { category: "foley.keys", material: ["metal-thin"], emotions: ["tactile", "everyday"], palettes: ["minimal", "playful"], maxDur: 0.8, hp: 300 });
fam(O("202-more-sound-effects"), "shutter", ["Camera/Camera_01.wav", "Camera/Camera_02.wav"], { category: "foley.camera", material: ["plastic", "metal-thin"], emotions: ["snapshot"], palettes: ALL });
fam(O("camerashudder"), "shutter-b", ["camera_0.ogg"], { category: "foley.camera", material: ["metal-thin"], emotions: ["snapshot"], palettes: ALL, maxDur: 0.45 });
fam(O("keyboard-soundpack-1-typing-and-single-keystrokes"), "key", range((i) => `Single Keys/keypress-${p3(i)}.wav`, [1, 3, 4, 6, 7, 13, 14, 17]), { category: "foley.typing", material: ["plastic"], emotions: ["process", "human"], palettes: ALL, maxDur: 0.2 });

// --- paper / card / cloth / plastic foley
fam(K("casino-audio"), "card-slide", range((i) => `card-slide-${i}.ogg`, [1, 2, 3, 4, 5, 7, 8]), { category: "foley.paper", material: ["paper", "cardboard"], emotions: ["tactile"], palettes: ["minimal", "playful", "luxury", "tech"] });
fam(K("casino-audio"), "card-place", range((i) => `card-place-${i}.ogg`, [1, 2, 3, 4]), { category: "impact.light", material: ["paper", "cardboard"], emotions: ["tactile", "gentle"], palettes: ["minimal", "playful", "luxury", "tech"] });
fam(K("casino-audio"), "card-shove", range((i) => `card-shove-${i}.ogg`, [1, 2, 3]), { category: "whoosh.micro", material: ["paper"], emotions: ["tactile"], palettes: ["minimal", "playful", "tech"] });
fam(K("casino-audio"), "card-fan", ["card-fan-1.ogg", "card-fan-2.ogg"], { category: "foley.paper", material: ["paper"], emotions: ["tactile", "reveal"], palettes: ["playful", "minimal"] });
fam(K("casino-audio"), "chip-click", ["chips-collide-1.ogg", "chips-collide-2.ogg", "chips-collide-3.ogg", "chips-collide-4.ogg", "chips-stack-1.ogg", "chips-stack-2.ogg", "chips-stack-5.ogg", "chips-stack-6.ogg"], { category: "ui.tick", material: ["plastic", "ceramic"], emotions: ["tactile", "reward"], palettes: ALL });
fam(K("casino-audio"), "chip-lay", ["chip-lay-1.ogg", "chip-lay-2.ogg"], { category: "impact.light", material: ["plastic"], emotions: ["tactile"], palettes: ALL });
fam(K("rpg-audio"), "book-place", ["bookPlace1.ogg", "bookPlace2.ogg", "bookPlace3.ogg"], { category: "impact.light", material: ["paper", "cardboard"], emotions: ["gentle", "solid"], palettes: ["minimal", "luxury", "cinematic"] });
fam(K("rpg-audio"), "book-close", ["bookClose.ogg", "bookOpen.ogg"], { category: "impact.light", material: ["paper", "cardboard"], emotions: ["solid"], palettes: ["minimal", "cinematic"] });
fam(K("rpg-audio"), "page-flick", ["bookFlip1.ogg", "bookFlip2.ogg", "bookFlip3.ogg"], { category: "whoosh.micro", material: ["paper"], emotions: ["tactile", "editorial"], palettes: ["minimal", "luxury", "playful"] });
fam(O("10-book-page-flips"), "page-flip", range((i) => `book_flip.${i}.ogg`, [2, 4, 5, 6, 8, 10]), { category: "whoosh.paper", material: ["paper"], emotions: ["editorial", "tactile"], palettes: ["minimal", "luxury", "playful", "cinematic"], maxDur: 0.8, hp: 120 });
fam(O("book-flip-sounds"), "page-turn", range((i) => `BookFlip${i}.wav`, [2, 4, 9, 10, 11]), { category: "whoosh.paper", material: ["paper"], emotions: ["editorial"], palettes: ["minimal", "luxury", "cinematic"], maxDur: 0.9, hp: 120 });
fam(O("100-cc0-sfx"), "paper-rustle", range((i) => `paper_${p2(i)}.ogg`, [1, 2, 3, 4]), { category: "foley.paper", material: ["paper"], emotions: ["tactile"], palettes: ["minimal", "playful", "luxury"], hp: 150 });
fam(O("202-more-sound-effects"), "paper-slide", range((i) => `Paper & Stationery/Stationery_${p2(i)}.wav`, [4, 11, 16, 27, 30, 41]), { category: "whoosh.paper", material: ["paper"], emotions: ["tactile", "editorial"], palettes: ["minimal", "luxury", "playful", "tech"], maxDur: 0.8, hp: 150 });
fam(O("202-more-sound-effects"), "desk-tick", range((i) => `Paper & Stationery/Stationery_${p2(i)}.wav`, [10, 17, 23, 24, 25, 43]), { category: "foley.desk", material: ["paper", "plastic"], emotions: ["tactile", "precise"], palettes: ["minimal", "tech", "playful"], maxDur: 0.5, hp: 150 });
fam(O("sound-effects-pack"), "crumple", ["Paper/crumples1.wav"], { category: "foley.paper", material: ["paper"], emotions: ["rejection", "tactile"], palettes: ["playful", "minimal"], maxDur: 0.9, hp: 150 });
fam(O("sound-effects-pack"), "page-turn-b", ["Paper/pageturn1.wav"], { category: "whoosh.paper", material: ["paper"], emotions: ["editorial"], palettes: ["minimal", "luxury"], hp: 150 });
fam(O("202-more-sound-effects"), "plastic-crinkle", range((i) => `Plastic/Plastic_${p2(i)}.wav`, [1, 5, 9, 11]), { category: "foley.plastic", material: ["plastic"], emotions: ["tactile"], palettes: ["playful", "minimal"], maxDur: 0.5, hp: 150 });
fam(K("rpg-audio"), "cloth-swish", ["cloth1.ogg", "cloth2.ogg", "cloth3.ogg", "cloth4.ogg"], { category: "whoosh.cloth", material: ["cloth"], emotions: ["soft", "organic"], palettes: ["minimal", "luxury", "cinematic", "playful"], hp: 90 });
fam(O("202-more-sound-effects"), "cloth-flap", ["Cloth/Cloth_04.wav", "Cloth/Cloth_05.wav", "Cloth/Cloth_07.wav"], { category: "whoosh.cloth", material: ["cloth"], emotions: ["soft"], palettes: ["minimal", "luxury", "cinematic"], hp: 180 });
fam(K("rpg-audio"), "leather", ["dropLeather.ogg", "handleSmallLeather.ogg"], { category: "impact.light", material: ["leather", "cloth"], emotions: ["soft", "warm"], palettes: ["luxury", "minimal", "cinematic"], hp: 60 });
fam(O("zipper"), "zipper", ["zipper-1.wav"], { category: "whoosh.micro", material: ["cloth", "metal-thin"], emotions: ["tactile"], palettes: ["playful", "minimal"], maxDur: 0.7 });

// --- whooshes / swishes / air
fam(O("swishes-sound-pack"), "swish", range((i) => `swishes/swish-${i}.wav`, [1, 3, 4, 6, 7, 8, 9, 10]), { category: "whoosh.micro", material: ["air"], emotions: ["energy", "nimble"], palettes: ALL });
fam(K("rpg-audio"), "blade-swipe", ["knifeSlice.ogg", "knifeSlice2.ogg", "drawKnife1.ogg", "drawKnife2.ogg", "drawKnife3.ogg"], { category: "whoosh.micro", material: ["metal-thin", "air"], emotions: ["sharp", "precise"], palettes: ["tech", "hype", "cinematic"] });
fam(O("100-cc0-sfx-2"), "air-swell", ["sfx100v2_air_02.ogg"], { category: "whoosh.medium", material: ["air"], emotions: ["calm", "airy"], palettes: ["minimal", "luxury", "cinematic"] });
fam(O("100-cc0-sfx-2"), "air-puff", ["sfx100v2_air_03.ogg"], { category: "whoosh.micro", material: ["air"], emotions: ["airy"], palettes: ALL });
fam(O("100-cc0-sfx-2"), "air-release", ["sfx100v2_air_01.ogg"], { category: "whoosh.burst", material: ["air"], emotions: ["release", "energy"], palettes: ["tech", "hype", "cinematic"], maxDur: 1.1 });
items.push({ name: "air-pass-1", pack: O("air-whoosh"), file: "whoosh2_0.wav", from: 3.2, category: "whoosh.long", material: ["air"], emotions: ["cinematic", "grand"], palettes: ["cinematic", "luxury"], maxDur: 2.0 });
fam(K("sci-fi-sounds"), "air-suck", ["doorClose_000.ogg", "doorClose_002.ogg"], { category: "whoosh.in", material: ["air"], emotions: ["tension", "anticipation"], palettes: ["tech", "cinematic", "hype"], world: "abstract" });
fam(K("sci-fi-sounds"), "air-hiss", ["doorOpen_000.ogg", "doorOpen_002.ogg"], { category: "whoosh.out", material: ["air"], emotions: ["release"], palettes: ["tech", "cinematic"], world: "abstract" });

// --- liquid
fam(O("40-cc0-water-splash-slime-sfx"), "bubble", ["bubble_01.ogg", "bubble_02.ogg", "bubble_03.ogg"], { category: "liquid.bubble", material: ["liquid"], emotions: ["playful", "organic"], palettes: ["playful", "minimal"] });
fam(O("bubble-sound-effects"), "bubble-pop", ["bubbles-single1.wav", "bubbles-single2.wav", "bubbles-single3.wav"], { category: "liquid.bubble", material: ["liquid"], emotions: ["playful"], palettes: ["playful", "minimal"] });
fam(O("40-cc0-water-splash-slime-sfx"), "goo", range((i) => `slime_${p2(i)}.ogg`, [1, 2, 4, 6, 10, 11, 16]), { category: "liquid.drop", material: ["liquid"], emotions: ["organic", "playful"], palettes: ["playful", "minimal", "tech"] });
fam(O("40-cc0-water-splash-slime-sfx"), "splash", range((i) => `splash_${p2(i)}.ogg`, [3, 6, 9, 10, 15]), { category: "liquid.splash", material: ["liquid"], emotions: ["fresh", "energy"], palettes: ["playful", "minimal", "cinematic"], maxDur: 0.8 });
fam(O("100-cc0-sfx"), "plop", ["plop_01.ogg", "plop_02.ogg"], { category: "liquid.drop", material: ["liquid"], emotions: ["playful"], palettes: ["playful", "minimal"] });
fam(K("sci-fi-sounds"), "slime", ["slime_000.ogg"], { category: "liquid.drop", material: ["liquid"], emotions: ["playful"], palettes: ["playful", "tech"], world: "abstract" });

// --- coins / money
fam(O("12-coin-sound-effects"), "coin", range((i) => `coin.${i}.ogg`, [2, 4, 7, 8, 10, 12]), { category: "foley.coins", material: ["metal-thin", "coins"], emotions: ["reward", "delight"], palettes: ["playful", "hype", "tech"] });
fam(O("coin-drop"), "coin-drop", ["coin_drop.wav"], { category: "foley.coins", material: ["metal-thin", "coins"], emotions: ["reward"], palettes: ["playful", "tech", "minimal"] });
fam(O("202-more-sound-effects"), "coin-clink", range((i) => `Money/Money_${p2(i)}.wav`, [6, 8, 12, 14, 15, 16, 27]), { category: "foley.coins", material: ["metal-thin", "coins"], emotions: ["reward", "tactile"], palettes: ["playful", "tech", "minimal", "luxury"], maxDur: 0.7, hp: 200 });

// --- digital / synthetic game-UI (abstract; kept out of luxury / minimal palettes)
fam(K("digital-audio"), "blip", ["twoTone1.ogg", "threeTone1.ogg", "tone1.ogg", "pepSound1.ogg", "pepSound3.ogg", "pepSound5.ogg"], { category: "digital.blip", material: ["digital"], emotions: ["digital", "gamey"], palettes: ["tech", "playful", "hype"], world: "abstract" });
fam(K("digital-audio"), "power-up", ["powerUp1.ogg", "powerUp4.ogg", "powerUp6.ogg", "powerUp10.ogg", "powerUp12.ogg"], { category: "digital.powerup", material: ["digital"], emotions: ["delight", "gamey"], palettes: GAMEY, world: "abstract" });
fam(K("digital-audio"), "zap", ["zap1.ogg", "zapTwoTone2.ogg"], { category: "digital.zap", material: ["digital"], emotions: ["charge"], palettes: ["tech", "hype"], world: "abstract", maxDur: 0.8 });

export const CURATION: Curation = { packs: PACKS, items };
/** Round-robin set sizes (default 3): bigger pools where the sound repeats a lot within one film (ticks, keys, clicks). */
export const GROUP_CAPS: Record<string, number> = { click: 6, key: 5, swish: 5, "ui-tap": 4, "chip-click": 4, "card-slide": 4, "page-flip": 4, "paper-slide": 4, "coin-clink": 4, goo: 4 };

const isMain = (() => { try { return path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) {
  const ri = process.argv.indexOf("--root");
  const root = ri > 0 ? path.resolve(process.argv[ri + 1]) : path.join(os.homedir(), ".cache", "ms-sfx-dl");
  if (process.argv.includes("--fetch")) {
    for (const p of PACKS) {
      const dir = path.join(root, p.id.startsWith("kenney-") ? "kenney" : `oga/${p.id.slice(4)}`);
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, p.id.startsWith("kenney-") ? `${p.id.slice(7)}.zip` : decodeURIComponent(path.basename(p.download)).replace(/ /g, "_"));
      if (!fs.existsSync(out)) execFileSync("curl", ["-sL", "-m", "600", "-A", "Mozilla/5.0", "-o", out, p.download], { stdio: "inherit" });
      console.error(`[curate] ${p.id}: ${out}`);
    }
    console.error("[curate] downloaded; unzip each archive into <pack dir>/x (Kenney: kenney/x/<slug>) and re-run without --fetch");
  } else {
    const names = new Set<string>();
    for (const it of items) { if (names.has(it.name)) throw new Error(`duplicate name ${it.name}`); names.add(it.name); }
    await ingest(CURATION, { baseDir: root, prune: true, maxPerGroup: 3, groupCaps: GROUP_CAPS });
  }
}
