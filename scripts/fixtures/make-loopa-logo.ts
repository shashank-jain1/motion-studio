// Builds a test brand logo: "Loopa" (split-bills app) — two interlocking rings (connection) + a wordmark as real outlines.
import fs from "node:fs";
import { getTextOutline } from "../../src/core/glyphs";

const out = process.argv[2] ?? "loopa-logo.svg";
const g = await getTextOutline("Sora", 700, "loopa");
const scale = 0.16, baseX = 300, baseY = 200; // 1000-unit glyph size → 160px type
const word = g.glyphs.filter((x) => x.d).map((x) => {
  // place each glyph: translate by its x, scale, then shift to (baseX, baseY)
  return `<path transform="translate(${baseX} ${baseY}) scale(${scale})" d="${x.d}" fill="#14213d"/>`;
}).join("\n  ");
const ring = (cx: number, color: string) =>
  `<path fill="${color}" fill-rule="evenodd" d="M ${cx - 80} 140 a 80 80 0 1 0 160 0 a 80 80 0 1 0 -160 0 Z M ${cx - 46} 140 a 46 46 0 1 1 92 0 a 46 46 0 1 1 -92 0 Z"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${baseX + g.width * scale + 30} 280">
  ${ring(110, "#ff5a5f")}
  ${ring(200, "#2ec4b6")}
  ${word}
</svg>`;
fs.writeFileSync(out, svg);
console.log(out, g.usedWeight);
