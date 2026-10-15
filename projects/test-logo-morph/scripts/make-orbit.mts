import fs from "node:fs";
import { analyzeLogoFile } from "/home/shashank/motion-studio/src/core/logo";
const dir = "/home/shashank/motion-studio/projects/test-logo-morph/assets";
// ring authored as two SAME-direction circles with evenodd (the classic pitfall), a stroked orbit arc, a satellite dot
const circ = (cx: number, cy: number, r: number) => `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} Z`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <path d="${circ(200, 200, 120)} ${circ(200, 200, 70)}" fill="#5b5bf7" fill-rule="evenodd"/>
  <path d="M 60 270 C 120 360 300 340 345 200" fill="none" stroke="#ff5fa2" stroke-width="16" stroke-linecap="round"/>
  <circle cx="345" cy="150" r="26" fill="#22c7a9"/>
</svg>`;
fs.writeFileSync(`${dir}/orbit-logo.svg`, svg);
const a = analyzeLogoFile(`${dir}/orbit-logo.svg`, "assets/orbit-logo.svg");
console.log(a.parts.map((p) => `${p.id}:${p.kind}:${p.fill}:${p.fillRule}:so=${p.strokeOnly ?? ""}:sw=${p.strokeWidth ?? ""}:subs=${(p.d.match(/M/gi) || []).length}`).join("\n"), JSON.stringify(a.groups));
