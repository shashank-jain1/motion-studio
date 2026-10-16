// Determinism / out-of-order check for 3D v2: renders frames of projects/test-3d in one order, then again in
// reverse order (fresh page state per still is NOT guaranteed — that's the point), and byte-compares the PNGs.
//   flock /tmp/claude-1000/ms-heavy.lock node_modules/.bin/tsx scripts/tests/three-determinism.ts [sceneId,...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { computeTimeline, loadSpec } from "../../src/core/projects";
import { COMPOSITION_ID, RENDER_GL, getBundle } from "../../src/core/render";
import { startAssetServer } from "../../src/core/assetServer";

const project = "test-3d";
const want = (process.argv[2] ?? "c-sweep,c-burst-collapse,p-chaos,post-rack-focus,cam-whip-pan,k-stack-echo,d-twist").split(",");
const spec = loadSpec(project);
const tl = computeTimeline(spec as never);
const server = await startAssetServer();
const inputProps = { spec, assetBase: server.baseUrlFor(project), projectId: project, libraryBase: server.libraryBase };
const serveUrl = await getBundle();
const chromiumOptions = { gl: RENDER_GL };
const browser = await openBrowser("chrome", { chromiumOptions, logLevel: "warn" });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "det3d-"));
let bad = 0;
try {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, puppeteerInstance: browser, chromiumOptions, logLevel: "warn" });
  const frames: number[] = [];
  for (const id of want) {
    const s = tl.scenes.find((x) => x.id === id);
    if (!s) continue;
    for (const k of [0.3, 0.55, 0.8]) frames.push(Math.round((s.start + (s.end - s.start) * k) * composition.fps));
  }
  const shot = async (f: number, tag: string) => {
    const output = path.join(dir, `${f}-${tag}.png`);
    await renderStill({ composition, serveUrl, output, frame: f, inputProps, imageFormat: "png", scale: 0.5, puppeteerInstance: browser, chromiumOptions, logLevel: "warn", overwrite: true });
    return fs.readFileSync(output);
  };
  const a = new Map<number, Buffer>();
  for (const f of frames) a.set(f, await shot(f, "fwd"));
  for (const f of [...frames].reverse()) {
    const b = await shot(f, "rev");
    const same = Buffer.compare(a.get(f)!, b) === 0;
    if (!same) {
      bad++;
      fs.copyFileSync(path.join(dir, `${f}-fwd.png`), path.join(os.tmpdir(), `det3d-${f}-fwd.png`));
      fs.copyFileSync(path.join(dir, `${f}-rev.png`), path.join(os.tmpdir(), `det3d-${f}-rev.png`));
    }
    console.log(`frame ${f}: ${same ? "identical" : "DIFFERENT"}`);
  }
} finally {
  await browser.close({ silent: true }).catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(bad ? `determinism: ${bad} frame(s) differ` : "determinism: all frames identical (forward vs reverse order)");
process.exit(bad ? 1 : 0);
