/**
 * glyph resolver tests (needs network on first run; fonts are cached in .cache/fonts/).
 * Run: npx tsx scripts/tests/glyphs.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { isValidPath, getPathBBox } from "svg-path-commander/util";
import { createProject, deleteProject, updateScene, writeSpec } from "../../src/core/projects";
import { collectTextShapes, glyphKey, glyphsFile, readGlyphFile, resolveFontFamily } from "../../src/core/glyphs";

const morph = (shape: string, extra: Record<string, unknown> = {}) => ({ type: "morph", shapes: [{ at: 0.5, shape: "circle" }, { at: 1.5, shape }], ...extra });

const spec = {
  style: "pastel-pop", // display = Bricolage Grotesque, body = Outfit
  scenes: [
    {
      duration: 3,
      layers: [
        morph("text:Brew"), // default font ($display) + weight 700
        { type: "group", layers: [morph("text:Hi there", { font: "$body", weight: 400 })] },
        { type: "device", model: "iphone", screens: [{ layers: [morph("text:fi", { font: "inter, sans-serif" })] }] },
        { type: "logo", src: "assets/none.svg", mode: "morph-from", from: "text:B" },
        morph("text:Nope", { font: "Definitely Not A Real Font Xyz" }),
      ],
    },
  ],
  actors: [{ id: "hero", layer: morph("text:GO", { font: "Anton", weight: 700 }), poses: [{ scene: 0 }] }],
};

const main = async () => {
  // pure resolution
  assert.equal(resolveFontFamily(undefined, { style: "pastel-pop" }), "Bricolage Grotesque");
  assert.equal(resolveFontFamily("$body", { style: "pastel-pop" }), "Outfit");
  assert.equal(resolveFontFamily("$display", { style: "pastel-pop", theme: { fonts: { display: "Sora" } } }), "Sora");
  assert.equal(resolveFontFamily("inter, sans-serif", {}), "Inter");
  assert.equal(resolveFontFamily(undefined, {}), "Inter"); // default style apple
  const refs = collectTextShapes(spec as never);
  assert.deepEqual(
    refs.map((r) => glyphKey(r.family, r.weight, r.text)),
    [
      "Bricolage Grotesque|700|Brew",
      "Outfit|400|Hi there",
      "Inter|700|fi",
      "Bricolage Grotesque|700|B",
      "Definitely Not A Real Font Xyz|700|Nope",
      "Anton|700|GO",
    ],
  );

  const proj = createProject({ name: "zz-glyph-test" });
  try {
    const t0 = Date.now();
    const res = await writeSpec(proj.id, spec);
    console.log(`writeSpec took ${Date.now() - t0}ms`, JSON.stringify(res, null, 2));
    assert.ok(res.ok && res.written, "spec saved even though one font fails");
    assert.ok(res.warnings.some((w) => /Definitely Not A Real Font Xyz/.test(w)), "missing font is a warning");
    assert.ok(res.warnings.some((w) => /Anton" has no weight 700; "text:" outlines use weight 400/.test(w)), "weight fallback warning");

    const g = readGlyphFile(proj.dir);
    const keys = Object.keys(g).sort();
    assert.deepEqual(keys, ["Anton|700|GO", "Bricolage Grotesque|700|B", "Bricolage Grotesque|700|Brew", "Inter|700|fi", "Outfit|400|Hi there"]);
    for (const [k, e] of Object.entries(g)) {
      const text = k.split("|").slice(2).join("|");
      assert.equal(e.size, 1000);
      assert.ok(e.ascent > 500 && e.ascent < 1300, `${k}: ascent ${e.ascent}`);
      assert.ok(e.descent > 0 && e.descent < 600, `${k}: descent ${e.descent}`);
      assert.ok(isValidPath(e.d), `${k}: d parses`);
      assert.equal(e.glyphs.length, Array.from(text).length, `${k}: one glyph per char (no ligatures)`);
      assert.equal(e.glyphs.map((x) => x.char).join(""), text);
      const bb = getPathBBox(e.d);
      assert.ok(bb.y < -400 && bb.y2 <= e.descent + 1 && bb.x >= -100 && bb.x2 <= e.width + 100, `${k}: baseline at y=0, text from x=0 (bbox ${JSON.stringify(bb)})`);
      for (let i = 1; i < e.glyphs.length; i++) {
        assert.ok(e.glyphs[i].x > e.glyphs[i - 1].x - 1e-6, `${k}: x increases`);
        assert.ok(Math.abs(e.glyphs[i - 1].x + e.glyphs[i - 1].advance - e.glyphs[i].x) < 0.02, `${k}: advance = distance to next glyph`);
      }
      const last = e.glyphs[e.glyphs.length - 1];
      assert.ok(Math.abs(last.x + last.advance - e.width) < 0.02, `${k}: width = last x + advance`);
      for (const gl of e.glyphs) if (gl.char.trim()) assert.ok(isValidPath(gl.d), `${k}: glyph ${gl.char} d parses`);
      assert.equal(e.glyphs.find((x) => x.char === " ")?.d ?? "", "", "spaces have empty d");
    }
    // kerning applies: "Brew" advances differ from plain advance sum is not guaranteed; just print
    console.log("Brew glyphs:", g["Bricolage Grotesque|700|Brew"].glyphs.map((x) => `${x.char}@${x.x}+${x.advance}`).join(" "));

    // merge: updating a scene adds a new key and keeps the old ones (even those no longer referenced)
    const r2 = await updateScene(proj.id, 0, { duration: 2, layers: [morph("text:Café", { font: "$display" })] });
    assert.ok(r2.ok, JSON.stringify(r2));
    const g2 = readGlyphFile(proj.dir);
    assert.ok(g2["Bricolage Grotesque|700|Café"], "new entry added");
    assert.ok(g2["Bricolage Grotesque|700|Brew"] && g2["Anton|700|GO"], "old entries kept");
    assert.ok(fs.existsSync(glyphsFile(proj.dir)));
    console.log("glyph tests: OK");
  } finally {
    deleteProject(proj.id);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
