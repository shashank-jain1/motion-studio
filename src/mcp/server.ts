/**
 * Motion Studio MCP server (stdio). stdout is reserved for the MCP protocol — everything else goes to stderr.
 */
// Route any stray console output to stderr before anything else can log.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FORMATS } from "../engine/spec/schema";
import { STYLES, DEFAULT_STYLE } from "../engine/spec/styles";
import { DOCS_DIR, PROJECTS_DIR } from "../core/paths";
import { FONT_NAMES } from "../core/fontNames";
import {
  addAsset,
  computeTimeline,
  createProject,
  getAssetInfo,
  getProject,
  listAssets,
  listProjects,
  loadSpec,
  readSpec,
  updateScene,
  writeSpec,
  type ValidationResult,
} from "../core/projects";
import { thumbnail } from "../core/probe";
import { analyzeAudio } from "../core/audio";
import { renderFrames, renderVideo } from "../core/render";
import { listCustomComponents, readCustomComponent, writeCustomComponent } from "../core/custom";
import type { SpecInput } from "../engine/spec/schema";

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
type ToolResult = { content: Content[]; isError?: boolean };

const text = (t: string): Content => ({ type: "text", text: t });
const json = (v: unknown): Content => text(JSON.stringify(v, null, 2));
const image = (buf: Buffer, mimeType = "image/jpeg"): Content => ({ type: "image", data: buf.toString("base64"), mimeType });

/** Wrap a handler so thrown errors become isError results instead of protocol errors. */
const safe =
  <A>(fn: (args: A, extra: Extra) => Promise<ToolResult> | ToolResult) =>
  async (args: A, extra: Extra): Promise<ToolResult> => {
    try {
      return await fn(args, extra);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[motion-studio] tool error: ${e instanceof Error ? e.stack : msg}`);
      return { content: [text(`Error: ${msg}`)], isError: true };
    }
  };

type Extra = {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification: (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
};

/** Some clients send nested objects as JSON strings; accept both. */
const parseMaybeJson = (v: unknown, what: string): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    throw new Error(`${what} is a string but not valid JSON: ${(e as Error).message}`);
  }
};

const formatValidation = (res: ValidationResult): string => {
  if (!res.ok) {
    return [
      "INVALID — spec was NOT saved. Fix these and call again:",
      ...res.errors.map((e) => `  • ${e}`),
    ].join("\n");
  }
  return [
    `OK — spec ${res.written ? "saved" : "is valid"}. Total duration: ${res.durationSeconds.toFixed(2)}s.`,
    res.warnings.length ? `Warnings (${res.warnings.length}):\n${res.warnings.map((w) => `  • ${w}`).join("\n")}` : "No warnings.",
    res.written ? "Next: preview_frames to look at it." : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const specSummary = (spec: SpecInput | null) => {
  if (!spec) return null;
  const tl = computeTimeline(spec);
  return {
    title: spec.title,
    format: spec.format,
    size: spec.width && spec.height ? `${spec.width}x${spec.height}` : undefined,
    fps: spec.fps ?? 30,
    style: spec.style,
    audio: spec.audio?.src,
    totalSeconds: tl.total,
    scenes: spec.scenes.map((s, i) => ({
      index: i,
      id: s.id,
      start: Math.round(tl.scenes[i].start * 100) / 100,
      duration: s.duration,
      transition: s.transition?.type,
      layers: (s.layers ?? []).map((l) => l.type + (l.id ? `#${l.id}` : "")).join(", "),
      notes: s.notes,
    })),
  };
};

/** Default preview times: settled moments after each scene's entrance, plus late-in-scene moments. */
const autoTimes = (projectId: string): { times: number[]; labels: Map<number, string> } => {
  const spec = loadSpec(projectId);
  const tl = computeTimeline(spec);
  const fps = spec.fps;
  const end = Math.max(0, tl.total - 1 / fps);
  const pts: { t: number; label: string }[] = [];
  const sceneName = (i: number) => `scene ${i}${spec.scenes[i].id ? ` "${spec.scenes[i].id}"` : ""}`;
  if (tl.scenes.length === 1) {
    for (const f of [0.08, 0.25, 0.42, 0.6, 0.78, 0.95]) pts.push({ t: tl.total * f, label: `${sceneName(0)} @${Math.round(f * 100)}%` });
  } else if (tl.scenes.length <= 4) {
    for (const s of tl.scenes) {
      const settled = s.start + s.overlapIn + Math.min(0.8, (s.duration - s.overlapIn) * 0.3);
      pts.push({ t: settled, label: `${sceneName(s.index)} early` });
      pts.push({ t: s.start + s.duration * 0.75, label: `${sceneName(s.index)} late` });
    }
  } else {
    let list = tl.scenes;
    if (list.length > 9) list = Array.from({ length: 9 }, (_, i) => tl.scenes[Math.round((i * (tl.scenes.length - 1)) / 8)]);
    for (const s of list) pts.push({ t: s.start + s.overlapIn + (s.duration - s.overlapIn) * 0.5, label: `${sceneName(s.index)} mid` });
  }
  const labels = new Map<number, string>();
  const times: number[] = [];
  for (const p of pts) {
    const t = Math.round(Math.max(0, Math.min(end, p.t)) * 100) / 100;
    if (!labels.has(t)) {
      labels.set(t, p.label);
      times.push(t);
    }
  }
  return { times, labels };
};

const sceneAt = (projectId: string, t: number): string => {
  try {
    const spec = loadSpec(projectId);
    const tl = computeTimeline(spec);
    const hits = tl.scenes.filter((s) => t >= s.start - 1e-6 && t < s.end - 1e-6);
    if (!hits.length) return "";
    return hits.map((s) => `scene ${s.index}${spec.scenes[s.index].id ? ` "${spec.scenes[s.index].id}"` : ""} +${(t - s.start).toFixed(2)}s`).join(" / ");
  } catch {
    return "";
  }
};

const readDoc = (name: string): string => {
  const file = path.join(DOCS_DIR, name);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return `(${name} not found at ${file})`;
  }
};

// ---------------------------------------------------------------- server

const server = new McpServer(
  { name: "motion-studio", version: "0.1.0" },
  {
    instructions:
      "Motion Studio turns a JSON Scene Spec into motion-graphics videos (Remotion). Workflow: get_guide (read once) → create_project → add_asset (logos, screenshots, music) → set_spec → preview_frames (LOOK at the frames, critique, fix with set_spec/update_scene, repeat) → render_video draft → final.",
  },
);

server.registerTool(
  "get_guide",
  {
    title: "Director guide",
    description:
      "Read this FIRST. Returns the Director Guide (how to plan and art-direct a video, pacing, the self-critique loop) and the Kit Reference (every layer type, preset, transition and option in the Scene Spec). All spec times are seconds; positions are px from the canvas center.",
    inputSchema: {},
  },
  safe(async () => ({ content: [text(readDoc("DIRECTOR_GUIDE.md")), text(readDoc("KIT_REFERENCE.md"))] })),
);

server.registerTool(
  "list_styles",
  {
    title: "List style presets",
    description:
      "List style presets (fonts, palette, finishing FX). Put one in spec.style to get a coherent look; override with spec.theme. Also lists the available fonts and canvas formats.",
    inputSchema: {},
  },
  safe(async () => ({
    content: [
      json({
        default: DEFAULT_STYLE,
        styles: Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, { description: s.description, fonts: s.fonts, colors: s.colors, fx: s.fx }])),
        fonts: FONT_NAMES,
        formats: Object.fromEntries(Object.entries(FORMATS).map(([k, [w, h]]) => [k, `${w}x${h}`])),
      }),
    ],
  })),
);

const FormatEnum = z.enum(Object.keys(FORMATS) as [keyof typeof FORMATS, ...(keyof typeof FORMATS)[]]);

server.registerTool(
  "create_project",
  {
    title: "Create project",
    description:
      "Create a new video project (a folder with assets/, renders/, previews/). Returns the projectId to use with every other tool. format: 16:9 (YouTube/landscape, default), 9:16 (Reels/TikTok/Shorts), 1:1, 4:5 (feed), 21:9.",
    inputSchema: { name: z.string().min(1).describe("human-readable project name"), format: FormatEnum.optional() },
  },
  safe(async ({ name, format }) => {
    const p = createProject({ name, format });
    return { content: [json({ projectId: p.id, name: p.name, format: p.format, dir: p.dir }), text("Next: add_asset for any logos/screenshots/music, then set_spec.")] };
  }),
);

server.registerTool(
  "list_projects",
  { title: "List projects", description: "List existing projects (most recently edited first).", inputSchema: {} },
  safe(async () => {
    const list = listProjects().map((p) => ({ projectId: p.id, name: p.name, format: p.format, createdAt: p.createdAt, updatedAt: p.updatedAt, hasSpec: p.hasSpec }));
    return { content: [list.length ? json(list) : text(`No projects yet in ${PROJECTS_DIR}. Use create_project.`)] };
  }),
);

server.registerTool(
  "get_project",
  {
    title: "Get project",
    description: "Project info, its assets (kind, size, duration, dominant palette — reference them in the spec as their `path`), the current spec summary (scenes with start times) and recent renders.",
    inputSchema: { projectId: z.string() },
  },
  safe(async ({ projectId }) => {
    const p = getProject(projectId);
    const assets = (await listAssets(projectId)).map(({ file: _file, ...a }) => a);
    const rendersDir = path.join(p.dir, "renders");
    const renders = fs.existsSync(rendersDir)
      ? fs.readdirSync(rendersDir).filter((f) => f.endsWith(".mp4")).sort().reverse().slice(0, 5).map((f) => path.join(rendersDir, f))
      : [];
    return { content: [json({ projectId: p.id, name: p.name, format: p.format, createdAt: p.createdAt, dir: p.dir, assets, spec: specSummary(readSpec(projectId)), renders })] };
  }),
);

server.registerTool(
  "add_asset",
  {
    title: "Add asset",
    description:
      "Import an ingredient (logo, product shot, screenshot, screen recording, music, sfx, Lottie JSON) into the project from an absolute local path or an http(s) URL. Returns its spec path (e.g. \"assets/logo.png\"), kind, dimensions, duration, hasAudio and dominant palette (use it to pick theme colors that match the brand). Images and videos also come back as a small preview image so you can see them.",
    inputSchema: {
      projectId: z.string(),
      path: z.string().optional().describe("absolute path of a local file"),
      url: z.string().url().optional().describe("http(s) URL to download (max 500MB)"),
      name: z.string().optional().describe("optional filename to store it as, e.g. logo.png"),
    },
  },
  safe(async ({ projectId, path: p, url, name }) => {
    const info = await addAsset(projectId, { path: p, url, name });
    const { file, ...rest } = info;
    const content: Content[] = [json(rest)];
    if (info.kind === "image" || info.kind === "video") {
      try {
        const seek = info.kind === "video" && info.duration ? Math.min(1, info.duration * 0.1) : 0;
        content.push(image(await thumbnail(file, { size: 384, seek })));
      } catch (e) {
        console.error(`[motion-studio] thumbnail failed: ${(e as Error).message}`);
      }
    }
    if (info.kind === "audio") content.push(text(`Tip: call analyze_audio {projectId, asset: "${info.path}"} to get BPM, beats and the drop for beat-synced cuts.`));
    return { content };
  }),
);

server.registerTool(
  "analyze_audio",
  {
    title: "Analyze music",
    description:
      "Analyze an audio (or video) asset for beat-synced editing: bpm, beatConfidence, beats (seconds), strongest onsets (hits/accents), energyCurve (0..1 loudness every 0.5s — find quiet intros, builds and drops) and dropAt. Cut scenes on beats (scene durations = multiples of 60/bpm), put camera.punch / fx.flashes on onsets, start the hero reveal at dropAt.",
    inputSchema: { projectId: z.string(), asset: z.string().describe('asset path like "assets/song.mp3" (or just the filename)') },
  },
  safe(async ({ projectId, asset }) => {
    const file = asset.replace(/^\.?\/?assets\//, "");
    const info = await getAssetInfo(projectId, file);
    if (info.kind !== "audio" && !(info.kind === "video" && info.hasAudio)) throw new Error(`${info.path} is a ${info.kind} without audio`);
    const a = await analyzeAudio(info.file);
    const beatLen = a.bpm ? 60 / a.bpm : 0;
    const summary = a.bpm
      ? `bpm ≈ ${a.bpm} (beat = ${beatLen.toFixed(3)}s, bar of 4 = ${(beatLen * 4).toFixed(3)}s), confidence ${a.beatConfidence}${a.dropAt !== null ? `, likely drop at ${a.dropAt}s` : ""}.`
      : "No tempo found.";
    return { content: [text(summary), json({ asset: info.path, ...a })] };
  }),
);

server.registerTool(
  "set_spec",
  {
    title: "Set scene spec",
    description:
      "Validate and save the whole Scene Spec (JSON object) for a project. If invalid nothing is saved and you get precise errors with JSON paths (e.g. scenes[1].layers[0].preset). If valid you get the total duration and warnings (missing assets, unknown fonts, layers that start after their scene ends). See get_guide for the schema.",
    inputSchema: {
      projectId: z.string(),
      spec: z.union([z.record(z.string(), z.any()), z.string()]).describe("the full Scene Spec object (a JSON string is accepted too)"),
    },
  },
  safe(async ({ projectId, spec }) => {
    const res = writeSpec(projectId, parseMaybeJson(spec, "spec"));
    return { content: [text(formatValidation(res))], isError: !res.ok };
  }),
);

server.registerTool(
  "get_spec",
  { title: "Get scene spec", description: "Return the project's current Scene Spec JSON exactly as saved.", inputSchema: { projectId: z.string() } },
  safe(async ({ projectId }) => {
    const spec = readSpec(projectId);
    return { content: [spec ? json(spec) : text("No spec yet. Use set_spec.")] };
  }),
);

server.registerTool(
  "update_scene",
  {
    title: "Update one scene",
    description:
      "Replace a single scene (0-based index) in the saved spec — cheaper than resending the whole spec when iterating. index === number of scenes appends a new scene. The whole spec is re-validated; nothing is saved if invalid.",
    inputSchema: {
      projectId: z.string(),
      index: z.number().int().min(0),
      scene: z.union([z.record(z.string(), z.any()), z.string()]).describe("the full scene object (a JSON string is accepted too)"),
    },
  },
  safe(async ({ projectId, index, scene }) => {
    const res = updateScene(projectId, index, parseMaybeJson(scene, "scene"));
    return { content: [text(formatValidation(res))], isError: !res.ok };
  }),
);

server.registerTool(
  "preview_frames",
  {
    title: "Preview frames",
    description:
      "Render still frames of the current spec and return them as an image so you can SEE the video. Use it after every meaningful change and critique honestly: hierarchy, legibility, spacing/safe margins, overlap, contrast, empty or cluttered frames, brand fit. Default: ~6 auto-picked moments (just after each scene settles, and late in each scene) as one labelled contact sheet (tile numbers match the listing). Pass `times` (seconds) to inspect specific moments, e.g. mid-transition or a beat. individual: true returns each frame as its own larger image instead of a sheet.",
    inputSchema: {
      projectId: z.string(),
      times: z.array(z.number().min(0)).max(16).optional().describe("seconds on the global timeline"),
      scale: z.number().min(0.1).max(1).optional().describe("render scale, default 0.5 (0.35 for many frames, 1 for fine detail)"),
      individual: z.boolean().optional().describe("return separate images instead of a contact sheet"),
    },
  },
  safe(async ({ projectId, times, scale, individual }) => {
    let labels = new Map<number, string>();
    let ts = times;
    if (!ts || ts.length === 0) {
      const auto = autoTimes(projectId);
      ts = auto.times;
      labels = auto.labels;
    }
    const t0 = Date.now();
    const res = await renderFrames(projectId, ts, { scale: scale ?? 0.5, sheet: !individual });
    const lines = res.frames.map((f, i) => {
      const where = sceneAt(projectId, f.time);
      const lab = labels.get(Math.round(f.time * 100) / 100);
      return `${i + 1}. t=${f.time.toFixed(2)}s (frame ${f.frame})${where ? ` — ${where}` : ""}${lab && !where.includes(lab) ? ` [${lab}]` : ""}`;
    });
    const header = `Rendered ${res.frames.length} frame(s) of a ${res.durationSeconds.toFixed(2)}s video at ${res.width}x${res.height} in ${((Date.now() - t0) / 1000).toFixed(1)}s.`;
    const content: Content[] = [];
    if (individual || !res.sheet) {
      content.push(text(`${header}\n${lines.join("\n")}`));
      res.frames.forEach((f, i) => {
        content.push(text(lines[i]));
        content.push(image(fs.readFileSync(f.path)));
      });
    } else {
      content.push(text(`${header} Contact sheet is ${res.columns} column(s) x ${res.rows} row(s), read left-to-right, top-to-bottom:\n${lines.join("\n")}`));
      content.push(image(fs.readFileSync(res.sheet)));
    }
    return { content };
  }),
);

server.registerTool(
  "render_video",
  {
    title: "Render MP4",
    description:
      "Render the project to an MP4 (H.264). quality \"draft\" = half resolution, fast (use to check timing/motion); \"final\" = full resolution, high quality. Takes from seconds to minutes depending on length. Returns the file path, duration, size and render time. Only render after preview_frames looks right.",
    inputSchema: { projectId: z.string(), quality: z.enum(["draft", "final"]).optional() },
  },
  safe(async ({ projectId, quality }, extra) => {
    const token = extra._meta?.progressToken;
    let last = -1;
    const res = await renderVideo(projectId, {
      quality: quality ?? "draft",
      signal: extra.signal,
      onProgress: (p) => {
        const pct = Math.floor(p.progress * 100);
        if (pct === last || (pct % 5 !== 0 && pct !== 100)) return;
        last = pct;
        console.error(`[motion-studio] render ${projectId}: ${pct}% (${p.renderedFrames} rendered, ${p.encodedFrames} encoded)`);
        if (token !== undefined) {
          extra
            .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: pct, total: 100, message: `${p.stage}: ${p.renderedFrames} frames` } })
            .catch(() => undefined);
        }
      },
    });
    return {
      content: [
        text(`Rendered ${res.quality} video: ${res.path}\n${res.width}x${res.height} @ ${res.fps}fps, ${res.seconds.toFixed(2)}s, ${(res.sizeBytes / 1e6).toFixed(2)} MB, took ${res.renderSeconds}s.`),
        json(res),
      ],
    };
  }),
);

server.registerTool(
  "write_custom_component",
  {
    title: "Write custom component",
    description:
      "Escape hatch when the kit can't express an idea: write a React (TSX) component that becomes usable in specs as {\"type\":\"custom\",\"component\":\"<Name>\",\"props\":{...}}. The file must `export default` a component receiving { t, duration, width, height, ...props } where t = seconds since the layer started — derive ALL animation from t (no CSS animations, timers, Math.random or useEffect-driven state; it must be deterministic per frame). You may import from \"remotion\" (interpolate, spring, Easing, Img, staticFile...) and \"react\". Size it to fill its layer (width/height). Syntax is checked before saving. Re-writing the same name replaces it.",
    inputSchema: {
      name: z.string().describe("PascalCase, e.g. OrbitingLogos"),
      code: z.string().describe("full TSX source with a default export"),
    },
  },
  safe(async ({ name, code }) => {
    const res = writeCustomComponent(name, code);
    return {
      content: [
        text(`${res.replaced ? "Replaced" : "Created"} custom component ${res.name} (${res.path}). Use it with {"type":"custom","component":"${res.name}","props":{...}} and preview_frames to check it. Available: ${res.components.join(", ")}`),
      ],
    };
  }),
);

server.registerTool(
  "list_custom_components",
  {
    title: "List custom components",
    description: "List custom components available to {\"type\":\"custom\"} layers. Pass name to get one component's source.",
    inputSchema: { name: z.string().optional() },
  },
  safe(async ({ name }) => {
    if (name) return { content: [text(readCustomComponent(name))] };
    const list = listCustomComponents();
    return { content: [text(list.length ? list.join("\n") : "No custom components yet.")] };
  }),
);

server.registerTool(
  "open_studio_hint",
  {
    title: "How to open Remotion Studio",
    description: "Explains how a human can open the live Remotion Studio to scrub through a project interactively.",
    inputSchema: { projectId: z.string().optional() },
  },
  safe(async ({ projectId }) => ({
    content: [
      text(
        [
          "Run in the repo root:  pnpm studio",
          "",
          "This starts Remotion Studio on src/engine/index.ts with --public-dir=projects, so project files are served as static files",
          "(staticFile(\"<projectId>/assets/...\")). In the Studio, select the \"Spec\" composition and set the input prop",
          `projectId to ${projectId ? `"${projectId}"` : "your project id"} — the engine then loads projects/<projectId>/spec.json and its assets.`,
          "Studio hot-reloads engine code; re-select the composition / refresh after set_spec to see spec changes.",
        ].join("\n"),
      ),
    ],
  })),
);

const main = async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[motion-studio] MCP server ready (projects: ${PROJECTS_DIR})`);
};

main().catch((e) => {
  console.error("[motion-studio] fatal:", e);
  process.exit(1);
});
