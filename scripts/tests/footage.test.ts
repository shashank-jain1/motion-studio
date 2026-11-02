/**
 * Footage editing without Whisper (fast, CI-safe): ffmpeg silence/shot detection on generated media, the plan → spec
 * compiler, edit styles, and the edit_footage tool fed a pre-seeded transcript. The real-transcription path is covered
 * by scripts/tests/footage-e2e.ts (slow, builds whisper.cpp).
 * Run: npx tsx scripts/tests/footage.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-footage-"));
process.env.MOTION_STUDIO_PROJECTS = path.join(tmp, "projects");
process.env.MOTION_STUDIO_LIBRARY = path.join(tmp, "library");
const { createProject, addAsset, readSpec, listSpecVersions } = await import("../../src/core/projects");
const { callTool } = await import("../../src/core/tools");
const { runMediaTool } = await import("../../src/core/mediaTool");
const { detectSilences, detectShots, footageSpec, saveEditStyle, getEditStyle, listEditStyles, suggestFromMeasurements } = await import("../../src/core/footage");
const { planEdit } = await import("../../src/core/editPlan");
const { SpecSchema } = await import("../../src/engine/spec/schema");
const { preprocessSpec } = await import("../../src/engine/spec/preprocess");

let passed = 0;
const test = async (name: string, fn: () => unknown) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n${(e as Error).stack}`); process.exitCode = 1; }
};
const ff = (args: string[]) => runMediaTool("ffmpeg", ["-y", "-v", "error", ...args]);
/** Minimal truecolour PNG of one colour (zlib + crc32 from node:zlib). */
const solidPng = (w: number, h: number, rgb: readonly number[]) => {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
};
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("\n");

// "speech": 1s tone · 2.5s silence · 1s tone · 0.2s silence · 1s tone (= 5.7s), over video that cuts colour at 2s and
// 4s. Built only from inputs Remotion's minimal bundled FFmpeg supports (sine, anullsrc, PNG stills).
const take = path.join(tmp, "take.mp4");
{
  const a = path.join(tmp, "a.wav");
  await ff(["-f", "lavfi", "-i", "sine=frequency=220:duration=1", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=2.5", "-f", "lavfi", "-i", "sine=frequency=330:duration=1",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=0.2", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-filter_complex", "[0]aresample=44100[a0];[2]aresample=44100[a2];[4]aresample=44100[a4];[a0][1][a2][3][a4]concat=n=5:v=0:a=1[a]", "-map", "[a]", "-ac", "1", a]);
  const stills = ([[220, 40, 40], [40, 60, 220], [40, 200, 90]] as const).map((c, k) => { const f = path.join(tmp, `c${k}.png`); fs.writeFileSync(f, solidPng(64, 36, c)); return f; });
  await ff(["-loop", "1", "-framerate", "30", "-t", "2", "-i", stills[0], "-loop", "1", "-framerate", "30", "-t", "2", "-i", stills[1], "-loop", "1", "-framerate", "30", "-t", "1.7", "-i", stills[2], "-i", a,
    "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-map", "3:a", "-c:v", "libx264", "-c:a", "aac", "-shortest", take]);
}

try {
  await test("silencedetect finds the long pause, not the short one", async () => {
    const s = await detectSilences(take, -35, 0.3);
    assert.equal(s.length, 1, JSON.stringify(s));
    assert.ok(Math.abs(s[0].start - 1) < 0.15 && Math.abs(s[0].end - 3.5) < 0.15, JSON.stringify(s));
  });

  await test("scene detection finds both hard cuts", async () => {
    const cuts = await detectShots(take);
    assert.equal(cuts.length, 2, JSON.stringify(cuts));
    assert.ok(Math.abs(cuts[0] - 2) < 0.1 && Math.abs(cuts[1] - 4) < 0.1, JSON.stringify(cuts));
  });

  const words = [
    { text: "Coffee", start: 0.1, end: 0.5 }, { text: "tastes", start: 0.55, end: 0.95 },
    { text: "um", start: 3.55, end: 3.8 }, { text: "like", start: 3.9, end: 4.2 }, { text: "morning.", start: 4.3, end: 4.9 },
  ];

  await test("plan → spec: one trimmed footage scene per stretch, rebased captions, punch-in alternation, validates", () => {
    const plan = planEdit(words, 5.7);
    const spec = footageSpec(plan, { src: "assets/take.mp4", format: "9:16", punchIn: { every: 1, scale: 1.12 }, captions: { style: "karaoke", wordsPerPage: 2 } });
    const parsed = SpecSchema.safeParse(preprocessSpec(spec));
    assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3)));
    assert.equal(spec.scenes.length, plan.keep.length);
    const [a, b] = spec.scenes as { duration: number; layers: Record<string, unknown>[] }[];
    assert.equal(a.layers[0].trimStart, plan.keep[0].start);
    assert.equal(a.layers[0].volume, 1);
    assert.equal(a.layers[0].scale, undefined);
    assert.equal(b.layers[0].scale, 1.12);
    const capB = b.layers[1] as { words: { text: string; start: number; end: number }[]; style: string };
    assert.equal(capB.style, "karaoke");
    assert.deepEqual(capB.words.map((w) => w.text), ["like", "morning."]);
    assert.ok(capB.words[0].start >= 0 && capB.words[capB.words.length - 1].end <= b.duration + 1e-6);
    assert.ok(Math.abs(spec.scenes.reduce((s, x) => s + x.duration, 0) - plan.editedSeconds) < 0.01);
    const noCaps = footageSpec(plan, { src: "assets/take.mp4", format: "16:9", captions: false, punchIn: false });
    assert.ok(noCaps.scenes.every((s) => s.layers.length === 1 && s.layers[0].scale === undefined));
  });

  await test("edit styles: suggestions from measurements, save/update/list", () => {
    const fast = suggestFromMeasurements([{ seconds: 30, shots: { count: 15, cutsPerMinute: 28, medianShot: 1.8, p25Shot: 1.2, p75Shot: 2.6, firstCut: 0.9 }, speech: { words: 100, wordsPerMinute: 200, medianGap: 0.08, p90Gap: 0.18, longestPause: 0.6 } }]);
    assert.deepEqual(fast.punchIn, { every: 1, scale: 1.12 });
    assert.equal(fast.edit.maxPause, 0.18);
    assert.equal((fast.captions as { wordsPerPage: number }).wordsPerPage, 2);
    const slow = suggestFromMeasurements([{ seconds: 60, shots: { count: 4, cutsPerMinute: 3, medianShot: 14, p25Shot: 10, p75Shot: 18, firstCut: 12 } }]);
    assert.equal(slow.punchIn, false);
    saveEditStyle({ name: "My Reels", edit: { maxPause: 0.2 }, punchIn: { every: 2, scale: 1.1 }, captions: { style: "pop" }, notes: "whip transitions between topics" });
    const again = saveEditStyle({ ...getEditStyle("my reels"), edit: { maxPause: 0.15 } });
    assert.equal(again.edit.maxPause, 0.15);
    assert.equal(listEditStyles().length, 1);
    assert.throws(() => getEditStyle("nope"), /No edit style "nope". Saved styles: My Reels/);
  });

  await test("edit_footage tool: plan first (writes nothing), then apply with a style; overrides win", async () => {
    const p = createProject({ name: "footage", format: "9:16" });
    const asset = await addAsset(p.id, { path: take, name: "take.mp4" });
    const file = path.join(p.dir, "assets", "take.mp4");
    const st = fs.statSync(file);
    // seed the transcript cache so no Whisper run is needed
    fs.writeFileSync(`${file}.transcript.json`, JSON.stringify({ model: "base", language: "en", seconds: 5.7, words, source: { file: "take.mp4", bytes: st.size, mtimeMs: st.mtimeMs } }));
    assert.equal(asset.path, "assets/take.mp4");

    const plan = await callTool("edit_footage", { projectId: p.id, asset: "assets/take.mp4" });
    assert.ok(!plan.isError, textOf(plan));
    assert.match(textOf(plan), /^Edit plan: 0:05\.7 → /);
    assert.match(textOf(plan), /FILLER\s+“um”/);
    assert.match(textOf(plan), /Nothing is written yet/);
    assert.equal(readSpec(p.id), null);

    const ap = await callTool("edit_footage", { projectId: p.id, asset: "assets/take.mp4", apply: true, style: "My Reels", punchIn: false }, { author: { kind: "director" } });
    assert.ok(!ap.isError, textOf(ap));
    assert.match(textOf(ap), /Style notes \(My Reels\): whip transitions/);
    const spec = readSpec(p.id) as unknown as { format: string; scenes: { layers: { type: string; scale?: number; style?: string }[] }[] };
    assert.equal(spec.format, "9:16");
    assert.ok(spec.scenes.every((s) => s.layers[0].scale === undefined), "explicit punchIn:false overrides the style");
    assert.equal(spec.scenes[0].layers[1].style, "pop", "captions from the style");
    const v = listSpecVersions(p.id)[0];
    assert.equal(v.author.kind, "director");
    assert.match(v.summary, /^Footage edit · \d+ cuts · 5\.7s → /);
  });

  await test("rendered edit shows the right source footage in each cut (real Remotion frames)", async () => {
    if (process.env.FOOTAGE_DEBUG_DIR) fs.copyFileSync(take, path.join(process.env.FOOTAGE_DEBUG_DIR, "take.mp4"));
    const pid = (await import("../../src/core/projects")).listProjects().find((x) => x.name === "footage")!.id;
    const spec = readSpec(pid) as unknown as { scenes: { duration: number; layers: { trimStart: number }[] }[] };
    // output time → expected source colour (red < 2s ≤ blue < 4s ≤ green), probing well inside each scene
    const probes: { t: number; want: "red" | "blue" | "green" }[] = [];
    let at = 0;
    for (const sc of spec.scenes) {
      const local = sc.duration * 0.7, src = sc.layers[0].trimStart + local;
      if (Math.abs(src - 2) > 0.15 && Math.abs(src - 4) > 0.15) probes.push({ t: +(at + local).toFixed(3), want: src < 2 ? "red" : src < 4 ? "blue" : "green" });
      at += sc.duration;
    }
    assert.ok(probes.some((p) => p.want === "red") && probes.some((p) => p.want === "green"), JSON.stringify(probes));
    const res = await callTool("preview_frames", { projectId: pid, times: probes.map((p) => p.t), individual: true, scale: 0.25 });
    assert.ok(!res.isError, textOf(res));
    const imgs = res.content.filter((c): c is { type: "image"; data: string; mimeType: string } => c.type === "image");
    assert.equal(imgs.length, probes.length);
    for (const [k, img] of imgs.entries()) {
      const f = path.join(tmp, `probe${k}.${img.mimeType.includes("png") ? "png" : "jpg"}`), avi = path.join(tmp, `probe${k}.avi`);
      fs.writeFileSync(f, Buffer.from(img.data, "base64"));
      if (process.env.FOOTAGE_DEBUG_DIR) fs.copyFileSync(f, path.join(process.env.FOOTAGE_DEBUG_DIR, path.basename(f)));
      await ff(["-i", f, "-vf", "crop=iw/4:ih/4,scale=1:1,format=bgr24", "-c:v", "rawvideo", "-f", "avi", avi]);
      // first video chunk after "movi" (the idx1 index at the end also contains "00db" ids)
      const b = fs.readFileSync(avi), movi = b.indexOf("movi");
      const i = [b.indexOf("00db", movi), b.indexOf("00dc", movi)].filter((x) => x >= 0).sort((x, y) => x - y)[0];
      const [B, G, R] = [b[i + 8], b[i + 9], b[i + 10]];
      const got = R > G && R > B ? "red" : B > G ? "blue" : "green";
      assert.equal(got, probes[k].want, `t=${probes[k].t}s rgb(${R},${G},${B})`);
    }
  });

  await test("tools are registered with the right scopes; yt-dlp import hidden in hosted mode", async () => {
    const { TOOLS } = await import("../../src/core/tools");
    const by = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
    for (const n of ["transcribe_media", "edit_footage", "analyze_reference_style", "save_edit_style", "list_edit_styles", "import_reference_url"]) assert.ok(by[n], n);
    assert.equal((by.import_reference_url as { hosted?: string }).hosted, "hidden");
    assert.equal(by.save_edit_style.scope, "global");
    const bad = await callTool("import_reference_url", { projectId: "x", url: "http://insecure.example/v" });
    assert.ok(bad.isError);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
