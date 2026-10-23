import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import opentype from "opentype.js";
import { SpecSchema, FontFaceSchema } from "../../src/engine/spec/schema";
import { canonicalFontFamily, customFontIdentity, facesForFamily, glyphFontFamily } from "../../src/engine/core/fontIdentity";
import { createProject, loadSpec, readSpec, writeSpec, getAssetInfo } from "../../src/core/projects";
import { registerProjectFont } from "../../src/core/projectFonts";
import { inspectFontAsset, localFontPath, FONT_LIBRARY_DIR } from "../../src/core/fontAssets";
import { readGlyphFile, glyphKey, syncGlyphs } from "../../src/core/glyphs";
import { isKnownFont } from "../../src/core/fontNames";

const project = createProject({ name: "Internal custom font contract", format: "16:9" });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-fonts-"));
try {
  // Original tiny fonts: no network dependency and visibly different outlines under the same family.
  const makeFont = (advance: number) => {
    const p = new opentype.Path(); p.moveTo(20, 0); p.lineTo(advance - 20, 0); p.lineTo(advance / 2, 700); p.close();
    const font = new opentype.Font({ familyName: "Test Cinema", styleName: "Regular", unitsPerEm: 1000, ascender: 800, descender: -200,
      glyphs: [new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }), new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: advance, path: p })] });
    font.tables.os2.usWeightClass = 400;
    return font;
  };
  for (const [name, width] of [["a.ttf", 500], ["b.ttf", 900]] as const) fs.writeFileSync(path.join(project.dir, "assets", name), Buffer.from(makeFont(width).toArrayBuffer()));
  const meta = inspectFontAsset(path.join(project.dir, "assets/a.ttf"));
  assert.equal(meta.family, "Test Cinema"); assert.equal(meta.weight, 400); assert.equal(meta.style, "normal"); assert.equal(meta.outlineSupport, true);
  assert.notEqual(meta.hash, inspectFontAsset(path.join(project.dir, "assets/b.ttf")).hash);
  const initial = SpecSchema.parse({ format: "16:9", scenes: [{ duration: 2, layers: [{ type: "morph", shapes: [{ at: 0, shape: "circle" }] }] }] });
  assert.ok((await writeSpec(project.id, initial)).ok);
  const registered = await registerProjectFont(project.id, "a.ttf", { role: "display" });
  assert.equal(registered.saved, true); assert.equal(loadSpec(project.id).theme?.fonts?.display, "Test Cinema");
  assert.equal((await getAssetInfo(project.id, "a.ttf")).kind, "font");
  assert.ok(isKnownFont('"test cinema", serif', loadSpec(project.id).fontFaces));
  let spec = loadSpec(project.id);
  spec.scenes[0].layers = [{ type: "morph", shapes: [{ at: 0, shape: "text:AA" }], weight: 400 }, { type: "three", source: "text:AA", weight: 400 }];
  assert.ok((await writeSpec(project.id, spec)).ok);
  const firstKey = glyphKey(glyphFontFamily("Test Cinema", spec.fontFaces), 400, "AA");
  const first = readGlyphFile(project.dir)[firstKey];
  assert.ok(first?.d.length > 10 && first.width > 0, "project font generates shared morph/3D outline data");
  await registerProjectFont(project.id, "b.ttf", { role: "display" });
  spec = loadSpec(project.id);
  const secondKey = glyphKey(glyphFontFamily("Test Cinema", spec.fontFaces), 400, "AA");
  assert.notEqual(firstKey, secondKey, "changed source cannot reuse a same-named stale glyph run");
  assert.ok(readGlyphFile(project.dir)[secondKey].width > first.width);
  await registerProjectFont(project.id, "b.ttf", { role: "display" });
  assert.equal(readSpec(project.id)?.fontFaces?.length, 1, "same family/weight/style registration is idempotent");
  await registerProjectFont(project.id, "a.ttf", { style: "italic" });
  assert.equal(loadSpec(project.id).fontFaces?.length, 2, "other styles remain registered");
  assert.equal(canonicalFontFamily('"cinzel", serif'), "Cinzel");
  assert.equal(facesForFamily("test cinema", spec.fontFaces).length, 1);
  assert.notEqual(customFontIdentity(spec.fontFaces!, (s) => `project-one/${s}`), customFontIdentity(spec.fontFaces!, (s) => `project-two/${s}`), "same-named faces in different Players need independent CSS aliases");
  assert.equal(FontFaceSchema.safeParse({ family: "Test", src: "assets/../private.ttf" }).success, false);
  assert.equal(FontFaceSchema.safeParse({ family: "Test", src: "https://example.com/font.ttf" }).success, false);
  const invalid = path.join(tmp, "bad.otf"); fs.writeFileSync(invalid, "not a font");
  assert.throws(() => inspectFontAsset(invalid), /signature/);
  const link = path.join(FONT_LIBRARY_DIR, `.test-outside-${process.pid}.ttf`);
  try { fs.symlinkSync(path.join(project.dir, "assets/a.ttf"), link); assert.throws(() => localFontPath(path.basename(link)), /directory/); }
  finally { fs.rmSync(link, { force: true }); }
  const woff2 = path.join(project.dir, "assets/test.woff2"); fs.writeFileSync(woff2, Buffer.from("wOF2" + "0".repeat(44)));
  assert.equal(inspectFontAsset(woff2).outlineSupport, false);
  const unsupported = SpecSchema.parse({ ...spec, fontFaces: [{ family: "WOFF2 Only", src: "assets/test.woff2" }], theme: { fonts: { display: "WOFF2 Only" } } });
  assert.ok((await syncGlyphs(project.dir, unsupported)).warnings.some((w) => /TTF\/OTF\/WOFF counterpart/.test(w)), "unsupported outlines get a concrete warning rather than a substitute font download");
  if (process.argv.includes("--render")) {
    spec.scenes[0].layers = [
      { type: "text", text: "AAAA", font: "Test Cinema", weight: 400, fontSize: 180, preset: "none", y: -230, color: "#101010" },
      { type: "morph", shapes: [{ at: 0, shape: "text:AA" }], weight: 400, width: 500, height: 280, x: -400, y: 130, fill: "#222222" },
      { type: "three", source: "text:AA", weight: 400, width: 620, height: 440, x: 400, y: 130, material: "pearl", lighting: "studio", color: "#8b5cf6", animation: "none" },
    ];
    assert.ok((await writeSpec(project.id, spec)).ok);
    const { renderFrames } = await import("../../src/core/render");
    const proof = await renderFrames(project.id, [0.5], { scale: 0.5, sheet: false });
    fs.mkdirSync("showcase", { recursive: true });
    fs.copyFileSync(proof.frames[0].path, "showcase/custom-font-proof.jpg");
    console.log("Custom TTF browser text + morph + 3D render completed.");
  }
  console.log("Fonts: metadata, native asset kind, registration/roles, style merging, local morph/3D outlines, versioned glyph identity, Player isolation, invalid sources and WOFF2 limits passed.");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(project.dir, { recursive: true, force: true }); }
if (process.argv.includes("--render")) process.exit(0);
