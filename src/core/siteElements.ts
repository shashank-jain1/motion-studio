/**
 * Website element scraper: renders a page in headless Chrome (so JS-built sites work), scrolls it to trigger lazy
 * loading, and collects every reusable visual element — <img>/<picture> sources, INLINE <svg>s (with their computed
 * CSS fills/strokes baked in, so they survive outside the page), CSS background / mask images, icons and og:image —
 * ranked by how prominent they are on the page. A contact sheet of the candidates (numbered tiles) lets the director
 * SEE them before importing. Results are cached per project so import can refer to them by id.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { openBrowser } from "@remotion/renderer";
import { assertPublicUrl } from "./safe-download";

export type SiteElement = {
  id: number;
  kind: "svg-inline" | "svg" | "png" | "jpg" | "webp" | "gif" | "avif" | "ico" | "image";
  /** remote URL (absent for inline SVG) */
  url?: string;
  /** inline SVG markup with computed styles baked in */
  svg?: string;
  width: number;
  height: number;
  /** alt / aria-label / title / filename */
  label: string;
  /** nearest heading or section id on the page */
  context: string;
  /** where it was found */
  source: "img" | "inline-svg" | "background" | "icon" | "og-image";
  /** visual prominence 0..1 (size, position near the top) */
  score: number;
};

export type SiteScrape = { url: string; title: string; scrapedAt: string; elements: SiteElement[]; colors: string[]; fonts: string[] };

/** In-page collector (serialized and evaluated in the browser). Returns raw candidates. */
const COLLECT = String.raw`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // scroll through the page so lazy images / scroll-triggered sections mount
  const H = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  for (let y = 0; y < Math.min(H(), 24000); y += Math.round(innerHeight * 0.8)) { scrollTo(0, y); await sleep(160); }
  scrollTo(0, 0); await sleep(400);
  const docH = H();
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 12) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return null;
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  };
  const ctxOf = (el) => {
    let n = el;
    for (let i = 0; n && i < 12; i++, n = n.parentElement) {
      const h = n.querySelector && n.querySelector("h1,h2,h3,h4");
      if (h && h.textContent.trim()) return h.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
      if (n.id) return "#" + n.id;
    }
    return "";
  };
  const score = (r) => Math.min(1, Math.sqrt(r.w * r.h) / 500) * 0.75 + (1 - Math.min(1, r.y / Math.max(1, docH))) * 0.25;
  const out = [];
  // <img> (currentSrc picks the srcset winner)
  for (const img of document.querySelectorAll("img")) {
    const r = vis(img); const src = img.currentSrc || img.src;
    if (!r || !src || src.startsWith("data:image/gif")) continue;
    if (img.naturalWidth && img.naturalWidth < 8) continue;
    out.push({ source: "img", url: src, w: img.naturalWidth || r.w, h: img.naturalHeight || r.h, rect: r,
      label: img.alt || img.getAttribute("aria-label") || img.title || "", context: ctxOf(img) });
  }
  // inline <svg>: bake computed paint into a clone so it renders the same outside the page
  const PAINT = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "font-family", "font-size", "font-weight"];
  for (const svg of document.querySelectorAll("svg")) {
    if (svg.parentElement && svg.parentElement.closest("svg")) continue;
    const r = vis(svg); if (!r) continue;
    const clone = svg.cloneNode(true);
    const a = [svg, ...svg.querySelectorAll("*")], b = [clone, ...clone.querySelectorAll("*")];
    a.forEach((el, i) => {
      const cs = getComputedStyle(el), t = b[i];
      if (!t || !t.setAttribute) return;
      for (const p of PAINT) { const v = cs.getPropertyValue(p); if (v && v !== "normal") t.setAttribute(p, v); }
      // parts still parked in a scroll-reveal "before" state (hidden, undrawn) are shown in their final state
      if (cs.opacity === "0") t.setAttribute("opacity", "1");
      if (cs.visibility === "hidden") t.setAttribute("visibility", "visible");
      const dash = cs.getPropertyValue("stroke-dashoffset");
      if (dash && parseFloat(dash) !== 0 && cs.getPropertyValue("stroke-dasharray") !== "none") { t.setAttribute("stroke-dasharray", "none"); t.removeAttribute("stroke-dashoffset"); }
      if (cs.transform && cs.transform !== "none" && /scale\(0|matrix\(0, 0, 0, 0/.test(cs.transform)) t.removeAttribute("transform");
      t.removeAttribute("class"); t.removeAttribute("style");
    });
    // <use href="#sprite"> pointing outside this svg: copy the referenced symbol in
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    for (const u of clone.querySelectorAll("use")) {
      const ref = (u.getAttribute("href") || u.getAttribute("xlink:href") || "");
      if (ref.startsWith("#") && !clone.querySelector(ref)) { const s = document.querySelector(ref); if (s) defs.appendChild(s.cloneNode(true)); }
    }
    if (defs.childNodes.length) clone.insertBefore(defs, clone.firstChild);
    if (!clone.getAttribute("viewBox")) {
      try { const bb = svg.getBBox(); if (bb.width && bb.height) clone.setAttribute("viewBox", [bb.x, bb.y, bb.width, bb.height].join(" ")); } catch {}
      if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", "0 0 " + r.w + " " + r.h);
    }
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(Math.round(r.w))); clone.setAttribute("height", String(Math.round(r.h)));
    const markup = clone.outerHTML;
    if (markup.length < 120 || markup.length > 400000) continue;
    out.push({ source: "inline-svg", svg: markup, w: r.w, h: r.h, rect: r,
      label: svg.getAttribute("aria-label") || (svg.querySelector("title") || {}).textContent || "", context: ctxOf(svg) });
  }
  // CSS background / mask images
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    for (const prop of ["background-image", "mask-image", "-webkit-mask-image"]) {
      const v = cs.getPropertyValue(prop);
      if (!v || !v.includes("url(")) continue;
      const r = vis(el); if (!r || r.w * r.h < 32 * 32) continue;
      for (const m of v.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        if (m[1].startsWith("data:") && m[1].length > 300000) continue;
        out.push({ source: "background", url: new URL(m[1], location.href).href, w: r.w, h: r.h, rect: r, label: el.getAttribute("aria-label") || "", context: ctxOf(el) });
      }
    }
  }
  // icons + og:image
  for (const l of document.querySelectorAll("link[rel~='icon'],link[rel='apple-touch-icon'],link[rel='mask-icon']")) {
    if (l.href) out.push({ source: "icon", url: l.href, w: Number((l.getAttribute("sizes") || "0x0").split("x")[0]) || 64, h: 64, rect: { x: 0, y: 0, w: 64, h: 64 }, label: l.rel, context: "head" });
  }
  const og = document.querySelector("meta[property='og:image'],meta[name='twitter:image']");
  if (og && og.content) out.push({ source: "og-image", url: new URL(og.content, location.href).href, w: 1200, h: 630, rect: { x: 0, y: 0, w: 600, h: 315 }, label: "og:image", context: "head" });
  // brand hints: most-used colors + font families on the page
  const colors = {}, fonts = {};
  for (const el of [...document.querySelectorAll("body *")].slice(0, 4000)) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), a = r.width * r.height;
    if (!a) continue;
    for (const c of [cs.backgroundColor, cs.color]) if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) colors[c] = (colors[c] || 0) + Math.sqrt(a);
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const f = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(); fonts[f] = (fonts[f] || 0) + 1;
    }
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
  return { title: document.title, items: out.map((o) => ({ ...o, score: score(o.rect) })), colors: top(colors, 10), fonts: top(fonts, 6) };
})()`;

const kindOf = (url: string | undefined, svg: string | undefined): SiteElement["kind"] => {
  if (svg) return "svg-inline";
  const u = (url ?? "").toLowerCase();
  if (u.startsWith("data:image/svg")) return "svg";
  const ext = (u.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/) ?? [])[1];
  if (ext === "svg") return "svg";
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "webp") return "webp";
  if (ext === "gif") return "gif";
  if (ext === "avif") return "avif";
  if (ext === "ico") return "ico";
  const dm = u.match(/^data:image\/([a-z+]+)/);
  if (dm) return (dm[1] === "jpeg" ? "jpg" : dm[1] === "svg+xml" ? "svg" : dm[1]) as SiteElement["kind"];
  return "image";
};

/** Image-optimizer URLs (Next.js /_next/image, Nuxt /_ipx, Vercel) → the original full-resolution file. */
export const unwrapImageUrl = (u: string | undefined): string | undefined => {
  if (!u) return u;
  try {
    const url = new URL(u);
    if (/\/_next\/image\/?$|\/_vercel\/image\/?$/.test(url.pathname)) {
      const inner = url.searchParams.get("url");
      if (inner) return new URL(inner, url.origin).href;
    }
  } catch { /* data: or invalid — keep */ }
  return u;
};

const rgbHex = (c: string) => {
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}` : c;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Numbered contact-sheet tiles for the candidates (rendered in the same browser). */
const sheetHtml = (els: SiteElement[]) => `<!doctype html><html><head><style>
  body{margin:0;background:#16161a;font:12px/1.2 ui-monospace,Menlo,monospace;color:#ddd;width:1200px}
  .g{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:10px}
  .t{background:repeating-conic-gradient(#2a2a30 0 25%,#222227 0 50%) 0 0/16px 16px;height:170px;position:relative;border-radius:4px;overflow:hidden}
  .t img,.t svg{position:absolute;inset:10px 10px 26px;width:calc(100% - 20px);height:calc(100% - 36px);object-fit:contain}
  .n{position:absolute;left:0;top:0;background:#ff3d1f;color:#fff;font-weight:700;padding:3px 6px;font-size:14px}
  .l{position:absolute;left:4px;right:4px;bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#aaa}
</style></head><body><div class="g">${els.map((e) => `<div class="t">${e.svg ? e.svg.replace(/^<svg/, '<svg preserveAspectRatio="xMidYMid meet"') : `<img src="${esc(e.url!)}">`}<span class="n">${e.id}</span><span class="l">${esc(`${e.kind} ${Math.round(e.width)}×${Math.round(e.height)} ${e.label || e.context}`)}</span></div>`).join("")}</div></body></html>`;

export const scrapeSiteElements = async (rawUrl: string, opts: { max?: number; signal?: AbortSignal } = {}): Promise<{ scrape: SiteScrape; sheetJpeg: Buffer | null }> => {
  const target = await assertPublicUrl(rawUrl);
  const browser = await openBrowser("chrome", { chromiumOptions: { gl: "angle" }, logLevel: "error" });
  try {
    const page = await browser.newPage({ context: () => null, logLevel: "error", indent: false, pageIndex: 0, onBrowserLog: () => {}, onLog: () => {} } as never);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const cdp = (page as unknown as { _client: () => { send: (m: string, p?: object) => Promise<{ value: unknown }> } })._client();
    await page.goto({ url: target.href, timeout: 60_000 } as never);
    await new Promise((r) => setTimeout(r, 2500));
    if (opts.signal?.aborted) throw new Error("Cancelled");
    const ev = await cdp.send("Runtime.evaluate", { expression: COLLECT, awaitPromise: true, returnByValue: true }) as unknown as { value: { result: { value?: { title: string; items: Array<Record<string, unknown>>; colors: string[]; fonts: string[] } }; exceptionDetails?: { text: string } } };
    const res = ev.value.result.value;
    if (!res) throw new Error(`Could not read ${target.href}: ${ev.value.exceptionDetails?.text ?? "page script failed"}`);

    // dedupe (same URL, or identical inline SVG), rank, cap
    const seen = new Set<string>();
    const items = res.items
      .map((it) => {
        const svg = it.svg as string | undefined, url = unwrapImageUrl(it.url as string | undefined);
        const key = svg ? crypto.createHash("sha1").update(svg).digest("hex") : url!;
        return { it, svg, url, key };
      })
      .filter(({ key, url }) => key && !seen.has(key) && seen.add(key) && !(url && /\.(mp4|webm|mov)(\?|$)/i.test(url)))
      .sort((a, b) => Number(b.it.score) - Number(a.it.score))
      .slice(0, opts.max ?? 60);
    const elements: SiteElement[] = items.map(({ it, svg, url }, i) => ({
      id: i + 1, kind: kindOf(url, svg), url, svg,
      width: Math.round(Number(it.w)), height: Math.round(Number(it.h)),
      label: String(it.label || (url ? decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "") : "")).slice(0, 80),
      context: String(it.context ?? ""), source: it.source as SiteElement["source"], score: Math.round(Number(it.score) * 100) / 100,
    }));

    let sheetJpeg: Buffer | null = null;
    if (elements.length) {
      try {
        await cdp.send("Runtime.evaluate", { expression: `document.open();document.write(${JSON.stringify(sheetHtml(elements))});document.close();`, returnByValue: true });
        await cdp.send("Runtime.evaluate", { expression: `Promise.race([Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r}))),new Promise(r=>setTimeout(r,8000))])`, awaitPromise: true });
        const hEval = await cdp.send("Runtime.evaluate", { expression: "document.body.scrollHeight", returnByValue: true }) as unknown as { value: { result: { value: number } } };
        const h = Math.min(4000, Math.ceil(hEval.value.result.value));
        await page.setViewport({ width: 1200, height: h, deviceScaleFactor: 1 });
        const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 70, clip: { x: 0, y: 0, width: 1200, height: h, scale: 1 } }) as unknown as { value: { data: string } };
        sheetJpeg = Buffer.from(shot.value.data, "base64");
      } catch { sheetJpeg = null; }
    }
    return {
      scrape: { url: target.href, title: res.title, scrapedAt: new Date().toISOString(), elements, colors: [...new Set(res.colors.map(rgbHex).filter((c) => c.startsWith("#")))], fonts: res.fonts },
      sheetJpeg,
    };
  } finally {
    await browser.close({ silent: true } as never).catch(() => {});
  }
};

const cacheFile = (projectDir: string) => path.join(projectDir, ".cache", "site-elements.json");
export const saveScrape = (projectDir: string, s: SiteScrape) => {
  fs.mkdirSync(path.dirname(cacheFile(projectDir)), { recursive: true });
  fs.writeFileSync(cacheFile(projectDir), JSON.stringify(s));
};
export const loadScrape = (projectDir: string): SiteScrape | null => {
  try { return JSON.parse(fs.readFileSync(cacheFile(projectDir), "utf8")) as SiteScrape; } catch { return null; }
};

/** A filesystem-safe asset name for an element. */
export const elementFileName = (e: SiteElement, siteHost: string): string => {
  const base = (e.label || e.context || `${siteHost}-${e.id}`).toLowerCase()
    .replace(/\.(svg|png|jpe?g|webp|gif|avif|ico)$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `element-${e.id}`;
  const ext = e.kind === "svg-inline" ? "svg" : e.kind === "image" ? "png" : e.kind;
  return `${base}-${e.id}.${ext}`;
};
