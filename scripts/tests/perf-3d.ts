// ms/frame for scenes of a project (default test-3d), measured inside headless Chrome (Remotion renderFrames,
// concurrency 1, no encoding): reports per-scene mean/median/max frame time and WebGL context warnings.
//   flock /tmp/claude-1000/ms-heavy.lock node_modules/.bin/tsx scripts/tests/perf-3d.ts <sceneId,...> [--scale=0.5] [--frames=12] [--project=test-3d]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBrowser, renderFrames, selectComposition } from "@remotion/renderer";
import { computeTimeline, loadSpec } from "../../src/core/projects";
import { COMPOSITION_ID, RENDER_GL, getBundle } from "../../src/core/render";
import { startAssetServer } from "../../src/core/assetServer";

const args = process.argv.slice(2);
const flag = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const project = flag("project") ?? "test-3d";
const scale = Number(flag("scale") ?? 0.5);
const nFrames = Number(flag("frames") ?? 12);
const spec = loadSpec(project);
const tl = computeTimeline(spec as never);
const wanted = (args.find((a) => !a.startsWith("--")) ?? "").split(",").filter(Boolean);
const scenes = tl.scenes.filter((s) => !wanted.length || wanted.includes(String(s.id)));

const server = await startAssetServer();
const inputProps = { spec, assetBase: server.baseUrlFor(project), projectId: project, libraryBase: server.libraryBase };
const serveUrl = await getBundle();
const chromiumOptions = { gl: RENDER_GL };
const browser = await openBrowser("chrome", { chromiumOptions, logLevel: "warn" });
const out = fs.mkdtempSync(path.join(os.tmpdir(), "perf3d-"));
try {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, puppeteerInstance: browser, chromiumOptions, logLevel: "warn" });
  const fps = composition.fps;
  console.log(`gl=${RENDER_GL} scale=${scale} (${Math.round(composition.width * scale)}x${Math.round(composition.height * scale)})`);
  for (const s of scenes) {
    const a = Math.round(s.start * fps), b = Math.min(Math.round(s.end * fps) - 1, composition.durationInFrames - 1);
    const step = Math.max(1, Math.floor((b - a + 1) / nFrames));
    const frames: number[] = [];
    for (let f = a; f <= b && frames.length < nFrames; f += step) frames.push(f);
    const times: number[] = [];
    const layerMs: number[] = [];
    let ctxWarn = 0;
    await renderFrames({
      composition, serveUrl, inputProps, outputDir: out, imageFormat: "jpeg", jpegQuality: 80, scale,
      frames, concurrency: 1, puppeteerInstance: browser, chromiumOptions, logLevel: "warn", envVariables: { MS_PERF3D: "1" },
      onStart: () => undefined,
      onFrameUpdate: (_n, _f, ms) => times.push(ms),
      onBrowserLog: (l) => {
        if (/WebGL contexts|context lost|CONTEXT_LOST/i.test(l.text)) ctxWarn++;
        const m = /\[perf3d\] ([\d.]+)/.exec(l.text);
        if (m) layerMs.push(Number(m[1]));
        if (l.type === "error" && !/perf3d/.test(l.text)) console.log(`  [browser] ${l.text.slice(0, 200)}`);
      },
    });
    const warm = times.slice(1); // the first frame includes shader compiles / geometry builds
    const sorted = [...warm].sort((x, y) => x - y);
    const mean = warm.reduce((x, y) => x + y, 0) / Math.max(1, warm.length);
    // 3D work per frame inside the page (all 3D layers, CPU + GPU, synced): skip the first (compile) samples
    const lw = layerMs.slice(Math.min(2, Math.max(0, layerMs.length - 3))).sort((x, y) => x - y);
    const l3d = lw.length ? lw[Math.floor(lw.length / 2)] : 0;
    console.log(`${String(s.id).padEnd(22)} 3D ${l3d.toFixed(1).padStart(6)} ms (median, in-page) | frame first ${times[0]?.toFixed(0).padStart(5)} ms | mean ${mean.toFixed(0).padStart(4)} | median ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(0).padStart(4)} | max ${(sorted[sorted.length - 1] ?? 0).toFixed(0).padStart(4)} ms/frame  (${times.length} frames, ctx warnings ${ctxWarn})`);
  }
} finally {
  await browser.close({ silent: true }).catch(() => undefined);
  fs.rmSync(out, { recursive: true, force: true });
  process.exit(0);
}
