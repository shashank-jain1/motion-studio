/**
 * Free music libraries + fitting + licensing (Phase 8). Run: npx tsx scripts/tests/music-library.test.ts
 * Providers are mocked with their real response shapes (Free To Use live sample, Openverse documented schema); the
 * fitter, credits, linter and composer variations run for real. Throwaway projects / cache dirs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-music-"));
process.env.MOTION_STUDIO_PROJECTS = path.join(tmp, "projects");
const lib = await import("../../src/core/musicLibrary");
const { fitTrack, energyRises } = await import("../../src/core/musicFit");
const { composeScore } = await import("../../src/core/music");
const { createProject, writeSpec, validateSpec } = await import("../../src/core/projects");
const { filmCredits, writeRenderCredits } = await import("../../src/core/credits");
const { CACHE_DIR } = await import("../../src/core/paths");

let passed = 0;
const test = async (name: string, fn: () => unknown) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n${(e as Error).stack}`); process.exitCode = 1; }
};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

const ftuTrack = (id: string, title: string, o: { premium?: boolean; duration?: number } = {}) => ({
  id, title, status: 1, record_label: "Free To Use (freetouse.com)", duration: o.duration ?? 130.5, genre: "Orchestral", lyrics: null, is_premium: !!o.premium,
  artists: [[1, { id: "b", name: "Second" }], [0, { id: "a", name: "Johny Grimes" }]], categories: [[0, { id: "c", name: "Cinematic" }]], tags: [[0, "majestic"]],
  waveform: Array.from({ length: 300 }, (_, i) => (i > 200 ? 90 : 30)), files: { mp3: `https://eu.data.freetouse.com/music/tracks/${id}/file/mp3/x.mp3` },
});
const ovTrack = (id: string, license: string, o: Record<string, unknown> = {}) => ({
  id, title: `Track ${id}`, creator: "Ann Artist", url: `https://cdn.example.org/${id}.mp3`, foreign_landing_url: `https://www.jamendo.com/track/${id}`, license, license_version: "4.0",
  license_url: `https://creativecommons.org/licenses/${license}/4.0/`, attribution: `"Track ${id}" by Ann Artist is licensed under CC ${license.toUpperCase()} 4.0.`, duration: 95000, genres: ["electronic"], tags: [{ name: "upbeat" }], source: "jamendo", category: "music", mature: false, ...o,
});
// never let the tests touch the real search cache
fs.rmSync(path.join(CACHE_DIR, "music-search"), { recursive: true, force: true });

try {
  await test("license policy: CC0 / PD / BY accepted; SA, NC, ND refused; Free To Use is personal-only with the documented credit", () => {
    assert.ok(lib.ccLicense("cc0", "1.0", undefined, "x")!.commercial);
    const by = lib.ccLicense("by", "4.0", "https://cc/by", "\"T\" by A, CC BY 4.0")!;
    assert.equal(by.name, "CC BY 4.0");
    assert.ok(by.attribution && by.commercial && by.modification);
    for (const bad of ["by-sa", "by-nc", "by-nd", "by-nc-sa", "sampling+", "nc-sampling+"]) assert.equal(lib.ccLicense(bad, "4.0", undefined, ""), null, bad);
    const ftu = lib.freeToUseLicense("Reasons To Run", "Johny Grimes");
    assert.equal(ftu.credit, "Music from Free To Use\nSource: https://freetouse.com/music\nReasons To Run by Johny Grimes");
    assert.equal(ftu.creditWhere, "video description");
    assert.ok(lib.allowedFor(ftu, "personal") && lib.allowedFor(ftu, undefined) && !lib.allowedFor(ftu, "commercial"));
    assert.ok(lib.allowedFor(by, "commercial"));
  });

  await test("search: both providers parsed, premium + disallowed licenses dropped, results interleaved, cached", async () => {
    let calls = 0;
    lib.setMusicFetch((async (url: string) => {
      calls++;
      if (String(url).includes("freetouse")) return json({ ok: true, data: [ftuTrack("aaaaaa-1", "Rise"), ftuTrack("bbbbbb-2", "Paid", { premium: true }), ftuTrack("cccccc-3", "Short", { duration: 8 })], pagination: {} });
      assert.match(String(url), /category=music&license=cc0,pdm,by/);
      return json({ result_count: 3, results: [ovTrack("ov0001", "by"), ovTrack("ov0002", "by-sa"), ovTrack("ov0003", "cc0", { mature: true })] });
    }) as typeof fetch);
    const r = await lib.searchMusic("cinematic rise", { minSeconds: 20 });
    assert.deepEqual(r.hits.map((h) => `${h.provider}:${h.title}`), ["freetouse:Rise", "openverse:Track ov0001"]);
    assert.equal(r.hits[0].artist, "Johny Grimes & Second", "artists ordered by sequence");
    assert.equal(r.hits[0].energy!.length, 300);
    assert.equal(r.hits[1].seconds, 95);
    assert.match(r.hits[1].license.credit, /CC BY 4\.0/);
    const before = calls;
    await lib.searchMusic("cinematic rise", { minSeconds: 20 });
    assert.equal(calls, before, "second identical search served from cache");
  });

  await test("search: commercial usage skips Free To Use; a failing provider becomes a note, not an error", async () => {
    lib.setMusicFetch((async (url: string) => (String(url).includes("openverse") ? new Response("gateway", { status: 504 }) : json({ data: [] }))) as typeof fetch);
    const r = await lib.searchMusic("dark tension", { usage: "commercial" });
    assert.equal(r.hits.length, 0);
    assert.ok(r.notes.some((n) => /Free To Use is skipped/.test(n)));
    assert.ok(r.notes.some((n) => /Openverse is unavailable right now \(HTTP 504\)/.test(n)));
  });

  await test("lookup re-checks the provider: premium and refused licenses never import", async () => {
    lib.setMusicFetch((async (url: string) => {
      if (String(url).includes("freetouse")) return json({ ok: true, data: ftuTrack("dddddd-4", "Paid", { premium: true }) });
      return json(ovTrack("ov0009", "by-nc"));
    }) as typeof fetch);
    await assert.rejects(lib.lookupTrack("freetouse", "dddddd-4"), /premium — it needs a paid license/);
    await assert.rejects(lib.lookupTrack("openverse", "ov0009"), /license \(by-nc\) is not one this studio accepts/);
    await assert.rejects(lib.lookupTrack("openverse", "../../etc"), /Invalid track id/);
  });

  // ------------------------------------------------------------------ fitting
  const grid = (bpm: number, dur: number) => Array.from({ length: Math.floor(dur / (60 / bpm)) }, (_, i) => +(i * (60 / bpm)).toFixed(3));
  const curve = (dur: number, f: (t: number) => number) => Array.from({ length: Math.ceil(dur * 2) }, (_, i) => f(i / 2));

  await test("fit: the drop lands on the peak; beats returned in film time", () => {
    const track = { duration: 120, bpm: 120, beats: grid(120, 120), dropAt: 48, energyCurve: curve(120, (t) => (t < 48 ? 0.35 : t < 100 ? 0.9 : 0.3)), beatConfidence: 0.9 };
    const f = fitTrack(track, { total: 15, peak: 10, cuts: [0, 2.5, 5, 7.5, 10, 12.5] });
    assert.equal(f.trimStart, 38);
    assert.equal(f.dropFilmTime, 10);
    assert.equal(f.dropErr, 0);
    assert.equal(f.cutErrMs, 0, "2.5 s cuts sit on a 120 bpm grid");
    assert.equal(f.beats[0], 0);
    assert.equal(f.shortBy, 0);
  });

  await test("fit: drop earlier than the peak → a short delayed start; too short a track is flagged", () => {
    const track = { duration: 40, bpm: 100, beats: grid(100, 40), dropAt: 9.6, energyCurve: curve(40, (t) => (t < 9.6 ? 0.4 : 0.9)) };
    const f = fitTrack(track, { total: 14, peak: 10.6, cuts: [] });
    assert.ok(f.at > 0 && f.at <= 1.5, JSON.stringify(f));
    assert.ok(Math.abs((f.dropFilmTime ?? 0) - 10.6) < 0.05);
    const short = fitTrack({ duration: 10, bpm: 100, beats: grid(100, 10), dropAt: null, energyCurve: curve(10, () => 0.7) }, { total: 14, peak: 9, cuts: [] });
    assert.ok(short.shortBy > 3.5);
    assert.ok(short.notes.some((n) => /runs out/.test(n)));
  });

  await test("fit: prefers ending with the track's own ending when the drop allows it", () => {
    // ending at 60 s; a lift at 50 s; film 12 s with peak at 2 s → start 48 s ends at 60 s exactly
    const track = { duration: 62, bpm: 120, beats: grid(120, 62), dropAt: 50, energyCurve: curve(62, (t) => (t < 50 ? 0.4 : t < 60 ? 0.9 : 0.02)) };
    const f = fitTrack(track, { total: 12, peak: 2, cuts: [] });
    assert.equal(f.trimStart, 48);
    assert.ok(f.endsWithTrack);
    assert.equal(f.fadeOut, 0.25);
  });

  await test("energy rises: the analysed drop first, then distinct lifts ≥ 2 s apart", () => {
    const rises = energyRises(curve(60, (t) => (t < 20 ? 0.3 : t < 35 ? 0.9 : t < 45 ? 0.3 : 0.95)), 20);
    assert.equal(rises[0], 20);
    assert.ok(rises.some((r) => Math.abs(r - 45) <= 1));
  });

  // ------------------------------------------------------------------ credits + linter
  await test("credits: written from the license sidecar, removed when no longer required", async () => {
    const p = createProject({ name: "credits", format: "9:16" });
    fs.mkdirSync(path.join(p.dir, "assets"), { recursive: true });
    const mp3 = path.join(p.dir, "assets", "music.mp3"); fs.writeFileSync(mp3, "x");
    lib.writeTrackLicense(mp3, { provider: "freetouse", id: "x", title: "Rise", artist: "Ann", license: lib.freeToUseLicense("Rise", "Ann"), importedAt: new Date().toISOString() });
    await writeSpec(p.id, { fps: 30, usage: "personal", audio: { src: "assets/music.mp3" }, scenes: [{ duration: 2, layers: [] }] });
    assert.match(filmCredits(p.id)!, /^Music from Free To Use\nSource: https:\/\/freetouse\.com\/music\nRise by Ann\n\(Required by Free To Use — Free License: publish this in the video description\.\)$/);
    const mp4 = path.join(p.dir, "renders", "a.mp4"); fs.mkdirSync(path.dirname(mp4), { recursive: true }); fs.writeFileSync(mp4, "");
    writeRenderCredits(p.id, mp4);
    assert.ok(fs.readFileSync(`${mp4}.credits.txt`, "utf8").startsWith("Music from Free To Use"));
    await writeSpec(p.id, { fps: 30, audio: { src: "assets/other.wav", credit: { license: "Original score", commercial: true } }, scenes: [{ duration: 2, layers: [] }] });
    writeRenderCredits(p.id, mp4);
    assert.ok(!fs.existsSync(`${mp4}.credits.txt`), "stale credits file removed");
  });

  await test("linter: personal-only music in a commercial film is flagged; unset usage asks", async () => {
    const p = createProject({ name: "lint", format: "9:16" });
    const base = { fps: 30, audio: { src: "assets/m.mp3", credit: { title: "Rise", license: "Free To Use — Free License", commercial: false } }, scenes: [{ duration: 2, layers: [] }, { duration: 2, layers: [] }] };
    const c = validateSpec(p.id, { ...base, usage: "commercial" });
    assert.ok(c.ok && c.warnings.some((w) => /^license\/music: “Rise” is licensed .* NOT allowed in commercial content/.test(w)), JSON.stringify(c.warnings));
    const u = validateSpec(p.id, base);
    assert.ok(u.ok && u.warnings.some((w) => w.startsWith("license/usage:")));
    const ok = validateSpec(p.id, { ...base, usage: "personal" });
    assert.ok(ok.ok && !ok.warnings.some((w) => w.startsWith("license/")));
  });

  // ------------------------------------------------------------------ composer variations
  await test("composer variations: different key / harmony, same timeline fit", () => {
    const a = composeScore({ seconds: 10, mood: "warm", cuts: [0, 3, 6], peak: 6, variation: 0 });
    const b = composeScore({ seconds: 10, mood: "warm", cuts: [0, 3, 6], peak: 6, variation: 1 });
    assert.notEqual(a.meta.key, b.meta.key);
    assert.equal(a.meta.bpm, b.meta.bpm);
    assert.deepEqual(a.meta.sections, b.meta.sections);
    let diff = 0; for (let i = 0; i < a.buf.n; i += 101) diff += Math.abs(a.buf.L[i] - b.buf.L[i]);
    assert.ok(diff > 1, "audibly different");
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(path.join(CACHE_DIR, "music-search"), { recursive: true, force: true });
}
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
