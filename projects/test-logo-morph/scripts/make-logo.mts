// Fixture: a "Brew" coffee logo (icon parts + wordmark glyphs) → assets/brew-logo.svg (+ analyzer JSON, + PNG)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { getTextOutline } from "/home/shashank/motion-studio/src/core/glyphs";
import { analyzeLogoFile } from "/home/shashank/motion-studio/src/core/logo";
import { libraryShape } from "/home/shashank/motion-studio/src/engine/shapes/library";
import { transformD } from "/home/shashank/motion-studio/src/engine/shapes/geom";

const dir = "/home/shashank/motion-studio/projects/test-logo-morph/assets";
const ESP = "#3a2218", ORANGE = "#e8743b", CARAMEL = "#f2b25c";
// icon: cup (library cup with handle hole) scaled into ~ (40..300, 90..330)
const cup = transformD(libraryShape("cup")!, [0.33, 0, 0, 0.33, 20, 30]);
const saucer = transformD(libraryShape("pill")!, [0.36, 0, 0, 0.075, -10, 300]);
// steam wisps: tapered S ribbons (filled outlines)
const wisp = (x: number) => `M ${x} 118 C ${x - 22} 96 ${x + 22} 70 ${x} 40 C ${x + 2} 37 ${x + 6} 37 ${x + 8} 40 C ${x + 34} 72 ${x - 10} 96 ${x + 10} 118 C ${x + 8} 122 ${x + 2} 122 ${x} 118 Z`;
const word = await getTextOutline("Bricolage Grotesque", 700, "brew");
const k = Math.min(0.32, 410 / word.width); // glyph size 1000 → ~300
const wd = word.glyphs.filter((g) => g.d).map((g) => transformD(g.d, [k, 0, 0, k, 395, 296]));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 360" width="840" height="360">
  <path d="${cup}" fill="${ESP}"/>
  <path d="${saucer}" fill="${CARAMEL}"/>
  <path d="${wisp(130)}" fill="${ORANGE}"/>
  <path d="${wisp(190)}" fill="${ORANGE}"/>
  ${wd.map((d) => `<path d="${d}" fill="${ESP}"/>`).join("\n  ")}
</svg>`;
fs.writeFileSync(`${dir}/brew-logo.svg`, svg);
const a = analyzeLogoFile(`${dir}/brew-logo.svg`, "assets/brew-logo.svg");
console.log("parts", a.parts.length, "groups", JSON.stringify(a.groups), "palette", a.palette.map((p) => p.hex).join(","), "vb", a.viewBox, "bbox", JSON.stringify(a.bbox));
console.log("orders", JSON.stringify(a.orders));
console.log(a.parts.map((p) => `${p.id}:${p.kind}:${p.fill}:${p.fillRule}:${p.strokeOnly ?? ""}:${Math.round(p.area)}`).join(" "));
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", `${dir}/brew-logo.svg`, "-vf", "scale=1680:720", "-frames:v", "1", `${dir}/brew-logo.png`]);
console.log(fs.statSync(`${dir}/brew-logo.png`).size);
