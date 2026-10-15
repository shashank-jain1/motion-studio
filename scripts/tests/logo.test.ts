/**
 * analyzeLogo sanity tests. Run: npx tsx scripts/tests/logo.test.ts
 * Creates a temp project, adds hand-written SVG logos through addAsset (which writes <asset>.logo.json),
 * checks parts/holes/groups/orders/palette/kit, then deletes the project.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPathArea, isValidPath, parsePathString } from "svg-path-commander/util";
import { addAsset, createProject, deleteProject, listAssets } from "../../src/core/projects";
import { logoJsonPath, logoSummary, renderLogoPreviewPng, suggestLogoModes, type LogoAnalysis } from "../../src/core/logo";

const SVGS: Record<string, string> = {
  // (a) multi-colour icon + wordmark "NOVA" (O and A have counters), white full-canvas background
  "a-icon-wordmark.svg": `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120" width="720" height="240">
  <rect width="360" height="120" fill="#ffffff"/>
  <circle cx="60" cy="60" r="40" fill="#ff6a3d"/>
  <path fill="#2ec4b6" d="M45 75 C45 50 60 40 80 40 C80 62 68 75 45 75 Z"/>
  <g fill="#1a1a2e">
    <path d="M130 85 V35 H142 L162 67 V35 H174 V85 H162 L142 53 V85 Z"/>
    <path d="M205 35 A24 25 0 0 1 229 60 A24 25 0 0 1 205 85 A24 25 0 0 1 181 60 A24 25 0 0 1 205 35 Z
             M205 46 A13 14 0 0 0 192 60 A13 14 0 0 0 205 74 A13 14 0 0 0 218 60 A13 14 0 0 0 205 46 Z"/>
    <path d="M232 35 H245 L256 70 L267 35 H280 L262 85 H250 Z"/>
    <path d="M285 85 L304 35 H318 L337 85 H324 L320 74 H302 L298 85 Z M306 63 H316 L311 48 Z"/>
  </g>
</svg>`,

  // (b) transforms, nested groups, <use> (+symbol), <style> class rules, gradient, hidden stuff
  "b-transforms.svg": `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 260 200">
  <style>.p { fill: #7c3aed } #special { fill: #22d3ee }</style>
  <defs>
    <path id="petal" d="M0 0 C10 -20 30 -20 40 0 C30 20 10 20 0 0 Z"/>
    <linearGradient id="grad"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
    <symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#111111"/></symbol>
  </defs>
  <g transform="translate(100 100)">
    <g class="p">
      <use href="#petal"/>
      <use xlink:href="#petal" transform="rotate(90)"/>
      <use href="#petal" transform="rotate(180)"/>
    </g>
    <use id="special" href="#petal" transform="rotate(270)"/>
  </g>
  <g transform="scale(2)"><rect x="80" y="30" width="20" height="20" rx="4" fill="url(#grad)"/></g>
  <use href="#dot" x="190" y="150" width="20" height="20"/>
  <g opacity="0"><rect x="0" y="0" width="50" height="50" fill="red"/></g>
  <rect x="0" y="0" width="30" height="30" fill="red" style="display:none"/>
  <rect x="0" y="0" width="30" height="30" fill="none"/>
</svg>`,

  // (c) evenodd holes drawn with SAME winding
  "c-evenodd.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120">
  <path fill-rule="evenodd" fill="#0b5fff" d="
    M60 10 A50 50 0 1 1 59.99 10 Z
    M60 25 A35 35 0 1 1 59.99 25 Z
    M60 40 A20 20 0 1 1 59.99 40 Z"/>
  <path style="fill:#0b5fff;fill-rule:evenodd" d="M150 10 H250 V110 H150 Z M175 35 H225 V85 H175 Z"/>
</svg>`,

  // (e) bottom-aligned badge icon + lowercase wordmark "lipyo": ascender, i-dot, descenders (p, y), counters (p, o)
  "e-lowercase.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 130">
  <rect x="0" y="5" width="60" height="95" rx="12" fill="#6d28d9"/>
  <g fill="#222">
    <rect x="90" y="35" width="10" height="65"/>
    <rect x="110" y="60" width="10" height="40"/><circle cx="115" cy="47" r="6"/>
    <path d="M130 60 H165 A20 20 0 0 1 165 100 H140 V115 H130 Z M140 70 V90 H160 A10 10 0 0 0 160 70 Z"/>
    <polygon points="175,60 186,60 195,85 204,60 215,60 197,115 186,115 192,98"/>
    <path fill-rule="evenodd" d="M240 60 A20 20 0 1 1 239.99 60 Z M240 70 A10 10 0 1 1 239.99 70 Z"/>
  </g>
</svg>`,

  // (d) stroke-only line icon (feather-style home), colour through currentColor
  "d-line-icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" color="#0f766e">
  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
  <polyline points="9 22 9 12 15 12 15 22"/>
</svg>`,
};

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ≈${b}, got ${a}`);

const checkCommon = (a: LogoAnalysis, name: string) => {
  assert.equal(a.version, 1);
  assert.ok(isValidPath(a.unionD), `${name}: unionD must parse`);
  assert.ok(parsePathString(a.unionD).length > 0);
  const ids = a.parts.map((p) => p.id);
  for (const [k, ord] of Object.entries(a.orders)) assert.deepEqual([...ord].sort((x, y) => x - y), ids, `${name}: order ${k} is a permutation`);
  assert.deepEqual([...a.groups.icon, ...a.groups.wordmark].sort((x, y) => x - y), ids, `${name}: groups partition parts`);
  near(a.palette.reduce((s, p) => s + p.weight, 0), 1, 0.01, `${name}: palette weights sum`);
  for (const p of a.parts) {
    assert.ok(isValidPath(p.d), `${name}: part ${p.id} d parses`);
    if (!p.strokeOnly) {
      // winding normalized: outer positive, holes negative → signed area of the whole d == net area
      near(getPathArea(p.d), p.area, Math.max(0.5, p.area * 0.02), `${name}: part ${p.id} signed area (winding normalized)`);
      assert.ok(p.area > 0);
    }
    for (const h of p.holeIds) assert.equal(a.holes[h].partId, p.id);
  }
  for (const h of a.holes) assert.ok(getPathArea(h.d) < 0, `${name}: hole d is counter-clockwise`);
};

const main = async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-logo-test-"));
  const proj = createProject({ name: "zz-logo-test" });
  const results: Record<string, LogoAnalysis> = {};
  try {
    for (const [file, svg] of Object.entries(SVGS)) {
      const src = path.join(tmpDir, file);
      fs.writeFileSync(src, svg);
      const info = await addAsset(proj.id, { path: src });
      const jsonFile = logoJsonPath(info.file);
      assert.ok(fs.existsSync(jsonFile), `${file}: ${jsonFile} written by addAsset`);
      const a = JSON.parse(fs.readFileSync(jsonFile, "utf8")) as LogoAnalysis;
      assert.equal(a.source, info.path);
      checkCommon(a, file);
      results[file] = a;
    }
    // .logo.json files are not listed as assets
    const listed = await listAssets(proj.id);
    assert.ok(listed.every((x) => !x.path.endsWith(".logo.json")), "listAssets hides .logo.json");

    // (a)
    {
      const a = results["a-icon-wordmark.svg"];
      assert.deepEqual(a.viewBox, [0, 0, 360, 120]);
      assert.equal(a.parts.length, 6, "a: circle + leaf + N O V A (white bg skipped)");
      assert.deepEqual(a.groups.icon, [0, 1]);
      assert.deepEqual(a.groups.wordmark, [2, 3, 4, 5]);
      assert.ok(a.parts.slice(2).every((p) => p.kind === "glyph"));
      assert.equal(a.holes.length, 2, "a: O and A counters");
      assert.deepEqual(a.parts[3].holeIds.length, 1);
      assert.deepEqual(a.parts[5].holeIds.length, 1);
      near(a.holes[0].areaRatio, (13 * 14) / (24 * 25), 0.02, "a: O counter ratio");
      near(a.parts[0].circularity, 1, 0.01, "a: circle circularity");
      near(a.parts[0].area, Math.PI * 40 * 40, 15, "a: circle area");
      assert.equal(a.orders.leftToRight[0], 0);
      assert.equal(a.orders.bySizeDesc[0], 0);
      assert.deepEqual(a.palette.map((p) => p.role).sort(), ["accent", "dark", "primary"]);
      assert.equal(a.palette.find((p) => p.role === "primary")!.hex, "#ff6a3d");
      assert.equal(a.palette.find((p) => p.role === "dark")!.hex, "#1a1a2e");
      assert.ok(a.kit.angles.includes(90), "a: vertical stems");
      assert.ok(a.warnings?.some((w) => /white/.test(w)));
      const sum = logoSummary(a);
      assert.equal(sum.secondaryBeat?.mode, "cascade", "a: cascade is suggested as the wordmark's secondary beat");
      assert.ok(suggestLogoModes(a).find((m) => m.mode === "cascade")!.score > 1);
    }
    // (b)
    {
      const a = results["b-transforms.svg"];
      assert.equal(a.parts.length, 6, "b: 4 petals + gradient rect + symbol dot (hidden ones skipped)");
      const petals = a.parts.slice(0, 4);
      assert.deepEqual(petals.map((p) => p.fill), ["#7c3aed", "#7c3aed", "#7c3aed", "#22d3ee"]);
      // petal 0 points right from (100,100), petal 1 down (rotate 90), petal 2 left, petal 3 up
      near(petals[0].bbox.x, 100, 0.5, "b: petal0 x");
      near(petals[0].bbox.w, 40, 0.5, "b: petal0 w");
      near(petals[1].bbox.y, 100, 0.5, "b: petal1 y (rotated down)");
      near(petals[2].bbox.x, 60, 0.5, "b: petal2 x (rotated left)");
      near(petals[3].bbox.y, 60, 0.5, "b: petal3 y (rotated up)");
      const rect = a.parts[4];
      near(rect.bbox.x, 160, 0.01, "b: scaled rect x");
      near(rect.bbox.w, 40, 0.01, "b: scaled rect w");
      assert.equal(rect.fill, "#800080", "b: gradient average");
      assert.deepEqual(rect.gradient, ["#ff0000", "#0000ff"]);
      near(a.kit.cornerRadius, 8, 0.6, "b: rounded rect corner radius (rx 4 × scale 2)");
      const dot = a.parts[5];
      near(dot.centroid[0], 200, 0.1, "b: symbol dot cx");
      near(dot.centroid[1], 160, 0.1, "b: symbol dot cy");
      near(dot.bbox.w, 20, 0.05, "b: symbol scaled to use width");
      assert.equal(dot.fill, "#111111");
    }
    // (c)
    {
      const a = results["c-evenodd.svg"];
      assert.equal(a.parts.length, 3, "c: ring, inner disc, square frame");
      assert.equal(a.holes.length, 2);
      const ring = a.parts.find((p) => p.holeIds.length && p.bbox.w > 99 && p.bbox.x < 20)!;
      near(ring.area, Math.PI * (50 * 50 - 35 * 35), 20, "c: ring area");
      const disc = a.parts.find((p) => !p.holeIds.length)!;
      near(disc.area, Math.PI * 400, 5, "c: inner disc area");
      const frame = a.parts.find((p) => p.bbox.x > 140)!;
      near(frame.area, 100 * 100 - 50 * 50, 1, "c: square frame area");
      near(a.holes.find((h) => h.partId === frame.id)!.areaRatio, 0.25, 0.001, "c: frame hole ratio");
      assert.ok(a.parts.every((p) => p.fillRule === "evenodd"));
      assert.equal(a.palette.length, 1);
      assert.equal(a.palette[0].role, "primary");
    }
    // (d)
    {
      const a = results["d-line-icon.svg"];
      assert.equal(a.parts.length, 2);
      assert.ok(a.parts.every((p) => p.strokeOnly && p.fill === "#0f766e" && p.strokeWidth === 2 && p.thinness === 1));
      assert.equal(a.kit.strokeWeight, 2);
      assert.equal(a.kit.symmetry, "x", "d: house is left/right symmetric");
      const modes = suggestLogoModes(a);
      assert.equal(modes[0].mode, "draw", "d: draw is the top suggestion for a line icon");
    }

    // (e)
    {
      const a = results["e-lowercase.svg"];
      assert.equal(a.parts.length, 7, "e: badge, l, i, i-dot, p, y, o");
      assert.deepEqual(a.groups.icon, [0], "e: the bottom-aligned badge stays an icon");
      assert.deepEqual(a.groups.wordmark, [1, 2, 3, 4, 5, 6], "e: letters incl. dot and descenders are glyphs");
      assert.equal(a.holes.length, 2, "e: p and o counters");
      assert.deepEqual(a.orders.reading.slice(0, 2), [0, 1]);
      assert.ok(a.orders.leftToRight.indexOf(3) > a.orders.leftToRight.indexOf(1), "e: dot after l");
      near(a.kit.cornerRadius, 12, 1, "e: badge corner radius");
    }

    // summary + preview render
    for (const [file, a] of Object.entries(results)) {
      const s = logoSummary(a, { values: ["playful"], industry: "food" });
      console.log(`\n== ${file}: ${a.parts.length} parts, icon ${JSON.stringify(a.groups.icon)} wordmark ${JSON.stringify(a.groups.wordmark)}`);
      console.log(`   palette ${JSON.stringify(a.palette)}`);
      console.log(`   kit ${JSON.stringify(a.kit)}`);
      console.log(`   modes ${s.suggestedModes.map((m) => `${m.mode}(${m.score})`).join(", ")}`);
      if (a.warnings) console.log(`   warnings ${JSON.stringify(a.warnings)}`);
      const png = await renderLogoPreviewPng(a, "bySizeDesc", 384);
      assert.ok(png.subarray(1, 4).toString() === "PNG", `${file}: preview is a PNG`);
      if (process.env.KEEP_PREVIEWS) fs.writeFileSync(path.join(process.env.KEEP_PREVIEWS, `${file}.png`), png);
    }
    console.log("\nlogo tests: OK");
  } finally {
    deleteProject(proj.id);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
