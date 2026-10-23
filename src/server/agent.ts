/**
 * The in-app AI director: a Claude API agent loop per project (manual streaming loop over the beta Messages API).
 *
 * - Tools: src/core/tools.ts bound to the project (projectId injected), sent with `eager_input_streaming: true`;
 *   every parsed input is validated with its zod schema before running (invalid / truncated → is_error result).
 * - Streaming: thinking (summarized) + text deltas → ChatEvents; tool calls run sequentially and ALL results go back
 *   in ONE user message. Images (preview sheets, logo maps) go back inside tool_result content so Claude sees them.
 * - Prompt caching: one stable system block (role + Director Guide + Story Engine + Kit Reference, cache_control) + deterministic
 *   tool order + top-level automatic caching for the growing history. Volatile project state goes in the user turn.
 * - Persistence: projects/<id>/chat.json holds the exact API messages (append-only; assistant content replayed
 *   unchanged so preserved thinking stays valid) and a parallel UiMessage[]; image bytes live in projects/<id>/chat/.
 * - Server-side refusal fallback (`fallbacks: "default"`, beta server-side-fallback-2026-07-01) where supported.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";
import { getProject, listAssets, readSpec, validateSpec } from "../core/projects";
import { callTool, describeToolCall, listRenders, parseToolInput, readDoc, specSummary, toolsFor, type Timeline, type ToolPolicy, type ToolResult } from "../core/tools";
import { agentSettings, FALLBACK_MODELS, keySource, makeClient } from "./settings";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;
type ToolResultBlock = Anthropic.Beta.BetaToolResultBlockParam;
type StreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;
type Message = Anthropic.Beta.BetaMessage;
type StreamParams = BetaMessageStreamParams;

// ---------------------------------------------------------------- public types (docs/WEB_API.md)

export type RenderInfo = { file: string; url: string; quality: "draft" | "final"; createdAt: string; sizeBytes: number; seconds?: number; width?: number; height?: number };

export type ChatEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; id: string; name: string; summary: string }
  | { type: "tool_end"; id: string; ok: boolean; summary: string; images?: string[] }
  | { type: "spec"; spec: object; timeline: Timeline }
  | { type: "render"; render: RenderInfo }
  | { type: "error"; message: string }
  | { type: "done" };

export type UiPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; id?: string; name: string; summary: string; ok?: boolean; images?: string[] };

export type UiMessage = { id: string; role: "user" | "assistant"; createdAt: string; parts: UiPart[] };

/** Minimal client surface the loop needs (lets tests inject a fake stream). */
export type StreamLike = AsyncIterable<StreamEvent> & { finalMessage(): Promise<Message> };
export type AgentClient = { beta: { messages: { stream(params: StreamParams, options?: { signal?: AbortSignal }): StreamLike } } };

// ---------------------------------------------------------------- constants

const MAX_TOKENS = 64000;
const MAX_ITERATIONS = 40;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** get_guide is redundant here: the full guide + kit reference are in the system prompt. */
const EXCLUDED_TOOLS = ["get_guide"];
const IMAGE_MARKER = "@file:";

export const fileUrl = (projectId: string, rel: string) => `/files/${encodeURIComponent(projectId)}/${rel.split("/").map(encodeURIComponent).join("/")}`;

// ---------------------------------------------------------------- system prompt (stable per project)

const GUIDE = readDoc("DIRECTOR_GUIDE.md");
const KIT = readDoc("KIT_REFERENCE.md");
const STORY = readDoc("STORY_ENGINE.md");
const MOTION = readDoc("MOTION_PLAYBOOK.md");

export const systemPrompt = (projectId: string): string =>
  [
    `You are Motion Studio's creative director: a senior motion designer who turns a brief into a finished motion-graphics video by writing a JSON Scene Spec, looking at rendered frames, and iterating until it is genuinely good.`,
    ``,
    `## Where you are`,
    `- You work inside the Motion Studio web app with one user, on project "${projectId}" ONLY. Every tool already targets this project (there is no projectId parameter). The project already exists, so skip the guide's get_guide / create_project / list_projects steps: the full Director's Guide, Story Engine and Kit Reference are below.`,
    `- The user sees a live Player of the saved spec, every preview image you render, and a compact log of your tool calls. Don't paste spec JSON into chat unless asked.`,
    `- Each user message starts with a <project_state> block generated by the app (assets, spec summary, validation, renders). It is context, not the user's words.`,
    `- The user uploads assets in the app; they show up in <project_state>. You can also import from an http(s) URL with add_asset.`,
    ``,
    `## How you work (follow the Director's Guide workflow)`,
    `1. Story first (Story Engine below): brand truth, audience tension, the obvious idea named and banned, 8 concepts via different techniques → score_concepts → develop the winner into beats with an intensity curve, a wow on the peak and a mnemonic ending (spec.concept + concept.story); check_story after set_spec. If the brief is thin, make sensible assumptions and state them in one line instead of stalling; ask only when a wrong guess would waste real work.`,
    `2. Storyboard: one line per scene (its key frame and how it becomes the next). Share it briefly in chat.`,
    `2a. Motion direction: use motion_recipes and build_motion_scene for a choreographed starting point; choose different motion grammar for hook, build, climax and resolve. Adapt to brand tokens. Use gesture + accents for deliberate motion/sound contact; custom and internal 3D actions need numeric accents. A list of entrance presets is not choreography.`,
    `2b. Continuity direction: define one motion language and one sonic world for the film. Prefer build_motion_sequence or persistent actors with motion:"flow" when one idea should evolve through cuts. Let decay from one sound prepare the next action; inspect_sound exposes phrases/bridges. Keep continuity enabled unless the brief calls for deliberate sonic contrast. Vary within a related material family rather than swapping unrelated effects at every cut.`,
    `3. set_spec; fix every validation error and the warnings that matter.`,
    `4. preview_frames and critique like a picky senior designer (hierarchy, legibility, safe margins, overlaps, mushy in-betweens, continuity of the motif). Fix with update_scene / set_spec and preview again. At least two critique passes before you call it done.`,
    `4a. inspect_sound after every timing change. Fix unresolved anchors and inadequate holds, inspect contact ±2 frames using its previewTimes (in small batches), and explain deliberately dropped competing accents. Play/review the rendered audio before claiming sound quality; cue timing alone does not prove it.`,
    `5. render_video only when the user asks for a video/render or clearly wants a finished file: draft first, final only when asked.`,
    `5a. After rendering, inspect_render_sound checks the exported file's real waveform timing and loudness against the current spec. Correct meaningful drift before delivery. It does not replace playing the whole video with sound.`,
    ``,
    `## Talking to the user`,
    `- Before your first tool call, say in one sentence what you're about to do. End with a short recap: what you made, the key creative choices, what to look at, and an offer for next steps.`,
    `- Be concise and concrete; markdown is fine. Never claim you looked at something you didn't preview.`,
    ``,
    `---`,
    ``,
    `# Director's Guide`,
    ``,
    GUIDE.trim(),
    ``,
    `---`,
    ``,
    `# Story Engine`,
    ``,
    STORY.trim(),
    ``,
    `---`,
    ``,
    `# Kit Reference (Scene Spec format)`,
    ``,
    KIT.trim(),
    ``, `# Motion and sound playbook`, ``, MOTION.trim(),
  ].join("\n");

// ---------------------------------------------------------------- chat persistence

type ChatFile = { version: 1; messages: MessageParam[]; ui: UiMessage[] };

const chatFile = (projectId: string) => path.join(getProject(projectId).dir, "chat.json");
const chatDir = (projectId: string) => path.join(getProject(projectId).dir, "chat");

const loadChat = (projectId: string): ChatFile => {
  try {
    const v = JSON.parse(fs.readFileSync(chatFile(projectId), "utf8")) as ChatFile;
    if (v && Array.isArray(v.messages) && Array.isArray(v.ui)) return v;
  } catch {
    /* none yet */
  }
  return { version: 1, messages: [], ui: [] };
};

const saveChat = (projectId: string, chat: ChatFile) => {
  const file = chatFile(projectId);
  const tmp = `${file}.${process.pid}.tmp`;
  const ui = chat.ui.map((m) => ({ ...m, parts: m.parts.filter((p) => p.type === "tool" || p.text.length > 0) }));
  fs.writeFileSync(tmp, JSON.stringify({ ...chat, ui }) + "\n");
  fs.renameSync(tmp, file);
};

/** Replace "@file:chat/x.jpg" image markers with the bytes (the API needs base64; chat.json stays small). */
const hydrate = (projectId: string, messages: MessageParam[]): MessageParam[] => {
  const dir = getProject(projectId).dir;
  const load = (data: string) => {
    if (!data.startsWith(IMAGE_MARKER)) return data;
    try {
      return fs.readFileSync(path.join(dir, data.slice(IMAGE_MARKER.length))).toString("base64");
    } catch {
      return null;
    }
  };
  const mapBlocks = (blocks: unknown[]): unknown[] =>
    blocks.map((b) => {
      const blk = b as { type?: string; content?: unknown; source?: { type?: string; data?: string } };
      if (blk.type === "image" && blk.source?.type === "base64" && typeof blk.source.data === "string" && blk.source.data.startsWith(IMAGE_MARKER)) {
        const data = load(blk.source.data);
        return data ? { ...blk, source: { ...blk.source, data } } : { type: "text", text: "(image no longer available)" };
      }
      if (blk.type === "tool_result" && Array.isArray(blk.content)) return { ...blk, content: mapBlocks(blk.content) };
      return b;
    });
  return messages.map((m) => (Array.isArray(m.content) ? ({ ...m, content: mapBlocks(m.content) } as MessageParam) : m));
};

// ---------------------------------------------------------------- runs

type Run = { controller: AbortController; startedAt: number };
const runs = new Map<string, Run>();

export const isRunning = (projectId: string) => runs.has(projectId);

export const getChat = (projectId: string): { messages: UiMessage[]; running: boolean } => {
  getProject(projectId);
  return { messages: loadChat(projectId).ui, running: isRunning(projectId) };
};

export const stopChat = (projectId: string): boolean => {
  const r = runs.get(projectId);
  if (!r) return false;
  r.controller.abort();
  return true;
};

export const clearChat = (projectId: string) => {
  getProject(projectId);
  stopChat(projectId);
  fs.rmSync(chatFile(projectId), { force: true });
  fs.rmSync(chatDir(projectId), { recursive: true, force: true });
};

// ---------------------------------------------------------------- per-turn context

const projectState = async (projectId: string): Promise<string> => {
  const p = getProject(projectId);
  const lines: string[] = [`<project_state>`, `Project: "${p.name}" (${p.id}), format ${p.format}`];
  try {
    const assets = await listAssets(projectId);
    if (!assets.length) lines.push("Assets: none yet");
    else {
      lines.push("Assets:");
      for (const a of assets) {
        const bits: string[] = [a.kind];
        if (a.width && a.height) bits.push(`${a.width}x${a.height}`);
        if (a.duration) bits.push(`${a.duration.toFixed(1)}s`);
        if (a.hasAudio) bits.push("has audio");
        if (a.palette?.length) bits.push(`palette ${a.palette.slice(0, 5).join(" ")}`);
        if (a.path.toLowerCase().endsWith(".svg")) bits.push("logo analysis available (analyze_logo)");
        lines.push(`- ${a.path} (${bits.join(", ")})`);
      }
    }
  } catch (e) {
    lines.push(`Assets: (could not list: ${(e as Error).message})`);
  }
  const spec = readSpec(projectId);
  if (!spec) lines.push("Spec: none yet");
  else {
    try {
      lines.push(`Spec summary: ${JSON.stringify(specSummary(spec))}`);
      const v = validateSpec(projectId, spec);
      if (!v.ok) lines.push(`Saved spec is INVALID: ${v.errors.slice(0, 8).join(" | ")}`);
      else if (v.warnings.length) lines.push(`Spec warnings (${v.warnings.length}): ${v.warnings.slice(0, 8).join(" | ")}`);
      else lines.push("Spec warnings: none");
    } catch (e) {
      lines.push(`Spec: present but unreadable (${(e as Error).message})`);
    }
  }
  const renders = listRenders(projectId);
  lines.push(renders.length ? `Latest render: ${renders[0].file} (${renders[0].quality}, ${renders[0].createdAt})` : "Renders: none yet");
  lines.push(`</project_state>`);
  return lines.join("\n");
};

// ---------------------------------------------------------------- helpers

const newId = () => crypto.randomBytes(6).toString("hex");

/**
 * Assistant content as it must be echoed back. After a mid-output server-side fallback, thinking / redacted_thinking /
 * tool_use (and unknown model-internal) blocks BEFORE the last `fallback` block are omitted; everything else is kept
 * unchanged (preserved thinking needs the blocks byte-identical).
 */
const KEEP_BEFORE_FALLBACK = new Set(["text", "fallback", "server_tool_use", "web_search_tool_result", "web_fetch_tool_result", "code_execution_tool_result"]);
export const historyContent = (content: ContentBlock[]): ContentBlock[] => {
  let last = -1;
  content.forEach((b, i) => {
    if (b.type === "fallback") last = i;
  });
  if (last < 0) return content;
  return content.filter((b, i) => i >= last || KEEP_BEFORE_FALLBACK.has(b.type));
};

const describeApiError = (e: unknown, model: string): string => {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API rejected the credentials. Add a valid API key in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return `This API key is not allowed to use ${model} (${e.message}). Pick another model in Settings or check the key.`;
  if (e instanceof Anthropic.NotFoundError) return `Model "${model}" was not found. Pick another model in Settings.`;
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and try again.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "The Anthropic API timed out. Try again.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API (network error).";
  if (e instanceof Anthropic.BadRequestError) return `The API rejected the request: ${e.message}`;
  if (e instanceof Anthropic.InternalServerError) return `The Anthropic API had a server error (${e.status}). Try again.`;
  if (e instanceof Anthropic.APIError) return `Anthropic API error${e.status ? ` ${e.status}` : ""}: ${e.message}`;
  if (e instanceof Anthropic.AnthropicError) return `${e.message}${/auth|credential|api key/i.test(e.message) ? " — add an API key in Settings." : ""}`;
  return e instanceof Error ? e.message : String(e);
};

const refusalMessage = (msg: Message): string => {
  const d = msg.stop_details;
  const parts = ["Claude declined to continue this request"];
  if (d?.category) parts.push(`(category: ${d.category})`);
  let s = parts.join(" ") + ".";
  if (d?.explanation) s += ` ${d.explanation}`;
  return s + " Try rephrasing the request.";
};

// ---------------------------------------------------------------- the loop

/** policy: user / mode scoping for the tools (src/server/scope.ts toolPolicyFor); render_video then goes through the job queue. */
export type RunDeps = { client?: AgentClient; model?: string; effort?: string; policy?: ToolPolicy };

/**
 * One run of the agent loop for a user message. Emits ChatEvents (always ending with "done"); never throws.
 * Rejects concurrent runs on the same project (caller should check isRunning first → 409).
 */
export const runChat = async (projectId: string, userText: string, emit: (e: ChatEvent) => void, deps: RunDeps = {}): Promise<void> => {
  const send = (e: ChatEvent) => {
    try {
      emit(e);
    } catch {
      /* client went away: the run continues and is persisted */
    }
  };
  if (runs.has(projectId)) {
    send({ type: "error", message: "The director is already working on this project. Stop it first." });
    send({ type: "done" });
    return;
  }
  const controller = new AbortController();
  runs.set(projectId, { controller, startedAt: Date.now() });
  const signal = controller.signal;

  let chat: ChatFile | null = null;
  let assistantUi: UiMessage | null = null;
  const settings = await agentSettings().catch(() => ({ model: "claude-opus-5-5", effort: "high" as const }));
  const model = deps.model ?? settings.model;
  const effort = (deps.effort ?? settings.effort) as NonNullable<StreamParams["output_config"]>["effort"];

  try {
    getProject(projectId);
    let client = deps.client;
    if (!client) {
      if ((await keySource()) === "none") {
        send({ type: "error", message: "No Anthropic API key found. Add an API key in Settings (or set ANTHROPIC_API_KEY)." });
        return;
      }
      client = (await makeClient()) as unknown as AgentClient;
    }

    chat = loadChat(projectId);
    const userMsg: MessageParam = {
      role: "user",
      content: [
        { type: "text", text: await projectState(projectId) },
        { type: "text", text: userText },
      ],
    };
    chat.messages.push(userMsg);
    chat.ui.push({ id: newId(), role: "user", createdAt: new Date().toISOString(), parts: [{ type: "text", text: userText }] });
    assistantUi = { id: newId(), role: "assistant", createdAt: new Date().toISOString(), parts: [] };
    chat.ui.push(assistantUi);
    saveChat(projectId, chat);

    const tools = toolsFor({ projectId, policy: deps.policy }, { exclude: EXCLUDED_TOOLS });
    const apiTools: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.jsonSchema as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: systemPrompt(projectId), cache_control: { type: "ephemeral" } }];
    const withFallback = FALLBACK_MODELS.has(model);

    let jsonRetries = 0;
    let truncations = 0;
    send({ type: "status", text: "Thinking…" });

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (signal.aborted) break;
      const params: StreamParams = {
        model,
        max_tokens: MAX_TOKENS,
        ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort },
        system,
        tools: apiTools,
        tool_choice: { type: "auto" },
        cache_control: { type: "ephemeral" },
        messages: hydrate(projectId, chat.messages),
      };

      // ---- stream one assistant turn
      let current: UiPart | null = null;
      let msg: Message;
      try {
        const stream = client.beta.messages.stream(params, { signal });
        for await (const ev of stream) {
          if (ev.type === "content_block_start") {
            const b = ev.content_block;
            current = null;
            if (b.type === "thinking") {
              current = { type: "thinking", text: "" };
              assistantUi.parts.push(current);
            } else if (b.type === "text") {
              current = { type: "text", text: "" };
              assistantUi.parts.push(current);
            } else if (b.type === "tool_use") {
              send({ type: "status", text: `${describeToolCall(b.name, {})}…` });
            } else if (b.type === "fallback") {
              send({ type: "status", text: `Continuing with ${b.to.model}` });
            }
          } else if (ev.type === "content_block_delta") {
            const d = ev.delta;
            if (d.type === "text_delta") {
              if (current?.type !== "text") {
                current = { type: "text", text: "" };
                assistantUi.parts.push(current);
              }
              current.text += d.text;
              send({ type: "text", delta: d.text });
            } else if (d.type === "thinking_delta") {
              if (current?.type !== "thinking") {
                current = { type: "thinking", text: "" };
                assistantUi.parts.push(current);
              }
              current.text += d.thinking;
              if (d.thinking) send({ type: "thinking", delta: d.thinking });
            }
          } else if (ev.type === "content_block_stop") {
            current = null;
          }
        }
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (e) {
        if (signal.aborted) break;
        if (e instanceof Anthropic.APIError || e instanceof Anthropic.AnthropicError) throw e;
        // With eager input streaming the SDK rejects when a tool input is not parseable JSON at all: no tool_use_id to
        // answer, so re-issue the turn (capped).
        if (jsonRetries++ < 2) {
          console.error(`[motion-studio] agent ${projectId}: unparseable tool input, retrying turn: ${(e as Error).message}`);
          send({ type: "status", text: "Retrying (malformed tool input)…" });
          continue;
        }
        throw e;
      }

      const u = msg.usage;
      console.error(
        `[motion-studio] agent ${projectId}: ${msg.model} stop=${msg.stop_reason} in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`,
      );

      if (msg.stop_reason === "refusal") {
        // Partial output of a refused turn is discarded (not appended to history).
        send({ type: "error", message: refusalMessage(msg) });
        break;
      }

      const content = historyContent(msg.content);
      if (content.length) {
        chat.messages.push({ role: "assistant", content });
        saveChat(projectId, chat);
      }

      if (msg.stop_reason === "pause_turn") continue;
      if (msg.stop_reason === "model_context_window_exceeded" || msg.stop_reason === "compaction") {
        send({ type: "error", message: "This conversation is too long for the model's context. Clear the chat to start fresh (the project is kept)." });
        break;
      }

      const toolUses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (!toolUses.length) {
        if (msg.stop_reason === "max_tokens") send({ type: "error", message: "The reply was cut off (max_tokens)." });
        break;
      }

      // A tool input cut off at max_tokens can still parse; never run it — ask for a smaller resend instead.
      if (msg.stop_reason === "max_tokens") {
        const results: ToolResultBlock[] = toolUses.map((tu) => ({
          type: "tool_result",
          tool_use_id: tu.id,
          is_error: true,
          content: "Your tool input was cut off by the output token limit and was NOT run. Resend it smaller (e.g. set_spec with fewer scenes, then update_scene per scene).",
        }));
        chat.messages.push({ role: "user", content: results });
        saveChat(projectId, chat);
        if (++truncations > 2) {
          send({ type: "error", message: "Tool input kept getting cut off (max_tokens). Try asking for a shorter video or fewer changes at once." });
          break;
        }
        continue;
      }

      // ---- run tools (sequentially, in order) and return ALL results in one user message
      const results: ToolResultBlock[] = [];
      for (const tu of toolUses) {
        results.push(await runTool(projectId, tu, signal, send, assistantUi, deps.policy));
        saveChat(projectId, chat);
      }
      chat.messages.push({ role: "user", content: results });
      saveChat(projectId, chat);
      if (signal.aborted) break;
      send({ type: "status", text: "Thinking…" });
      if (iter === MAX_ITERATIONS - 1) send({ type: "error", message: `Stopped after ${MAX_ITERATIONS} steps. Send a message to continue.` });
    }
    if (signal.aborted) send({ type: "status", text: "Stopped." });
  } catch (e) {
    if (!signal.aborted) {
      const message = describeApiError(e, model);
      console.error(`[motion-studio] agent ${projectId} error: ${e instanceof Error ? e.stack : String(e)}`);
      send({ type: "error", message });
      if (assistantUi) assistantUi.parts.push({ type: "text", text: `**Error:** ${message}` });
    } else send({ type: "status", text: "Stopped." });
  } finally {
    if (chat) {
      try {
        saveChat(projectId, chat);
      } catch {
        /* project deleted mid-run */
      }
    }
    runs.delete(projectId);
    send({ type: "done" });
  }
};

/** Validate + run one tool call; emit tool_start / tool_end (+ spec / render); return its tool_result block. */
const runTool = async (
  projectId: string,
  tu: Anthropic.Beta.BetaToolUseBlock,
  signal: AbortSignal,
  send: (e: ChatEvent) => void,
  ui: UiMessage,
  policy?: ToolPolicy,
): Promise<ToolResultBlock> => {
  const part: UiPart & { type: "tool" } = { type: "tool", id: tu.id, name: tu.name, summary: describeToolCall(tu.name, tu.input) };
  ui.parts.push(part);
  send({ type: "tool_start", id: tu.id, name: tu.name, summary: part.summary });

  const finish = (ok: boolean, summary: string, images?: string[]) => {
    part.ok = ok;
    part.summary = summary;
    if (images?.length) part.images = images;
    send({ type: "tool_end", id: tu.id, ok, summary, ...(images?.length ? { images } : {}) });
  };

  if (signal.aborted) {
    finish(false, "Stopped");
    return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Stopped by the user before this tool ran." };
  }

  // Eager input streaming: the server no longer validates inputs — validate before running.
  const parsed = parseToolInput(tu.name, tu.input, { projectId, policy });
  if (!parsed.ok) {
    finish(false, "Invalid input — asking to resend");
    return {
      type: "tool_result",
      tool_use_id: tu.id,
      is_error: true,
      content: JSON.stringify({ error: `Invalid or truncated input for ${tu.name}. Fix it and call the tool again.`, issues: parsed.error, INVALID_JSON: JSON.stringify(tu.input).slice(0, 4000) }),
    };
  }

  let lastPct = -1;
  const res: ToolResult = await callTool(tu.name, tu.input, {
    projectId,
    policy,
    signal,
    onProgress: (p) => {
      const pct = Math.round(p.progress * 100);
      if (p.message?.startsWith("Waiting")) send({ type: "status", text: p.message });
      else if (p.message && p.progress === 0) send({ type: "status", text: `${part.summary} · ${p.message}` });
      else if (pct !== lastPct) {
        lastPct = pct;
        send({ type: "status", text: `${part.summary} · ${pct}%` });
      }
    },
  });

  // Images: persist under chat/ (stable URLs for the UI, small chat.json), pass them to Claude inside the tool_result.
  const blocks: Exclude<ToolResultBlock["content"], string | undefined> = [];
  const images: string[] = [];
  const dir = path.join(getProject(projectId).dir, "chat");
  for (const c of res.content) {
    if (c.type === "text") blocks.push({ type: "text", text: c.text });
    else {
      const ext = c.mimeType === "image/png" ? "png" : c.mimeType === "image/webp" ? "webp" : c.mimeType === "image/gif" ? "gif" : "jpg";
      const rel = `chat/${tu.id}-${images.length}.${ext}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(getProject(projectId).dir, rel), Buffer.from(c.data, "base64"));
      images.push(fileUrl(projectId, rel));
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: c.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: `${IMAGE_MARKER}${rel}` },
      });
    }
  }

  for (const ev of res.events ?? []) {
    if (ev.type === "spec") send({ type: "spec", spec: ev.spec, timeline: ev.timeline });
    else if (ev.type === "render") send({ type: "render", render: { ...ev.render, url: fileUrl(projectId, ev.render.file) } });
  }
  finish(!res.isError, res.summary ?? (res.isError ? "Failed" : "Done"), images);
  return { type: "tool_result", tool_use_id: tu.id, ...(res.isError ? { is_error: true } : {}), content: blocks.length ? blocks : "(no output)" };
};

