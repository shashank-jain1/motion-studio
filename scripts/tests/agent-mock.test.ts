/**
 * The in-app director loop against a FAKE Claude client (no API key needed): streaming events → ChatEvents,
 * request shape (fallbacks, thinking, effort, eager_input_streaming, caching, bound tools), zod validation of tool
 * inputs, parallel tool results in one user message, preview images passed back as image blocks, refusal handling,
 * JSON-retry, stop, and chat.json persistence. Renders one small preview frame.
 * Run: npx tsx scripts/tests/agent-mock.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { createProject, deleteProject } from "../../src/core/projects";
import { clearChat, getChat, runChat, stopChat, type AgentClient, type ChatEvent, type StreamLike } from "../../src/server/agent";

type Msg = Anthropic.Beta.BetaMessage;
type Ev = Anthropic.Beta.BetaRawMessageStreamEvent;
type Block =
  | { type: "thinking"; thinking: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

/** Build a stream (events + final message) from a scripted assistant turn. */
const scripted = (blocks: Block[], stop: Msg["stop_reason"], extra: Partial<Msg> = {}): StreamLike => {
  const content = blocks.map((b) =>
    b.type === "thinking" ? { type: "thinking", thinking: b.thinking, signature: "sig" } : b.type === "text" ? { type: "text", text: b.text, citations: null } : { ...b, caller: { type: "direct" } },
  ) as unknown as Msg["content"];
  const msg = {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...extra,
  } as unknown as Msg;
  const events: Ev[] = [];
  blocks.forEach((b, index) => {
    if (b.type === "thinking") {
      events.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } } as unknown as Ev);
      events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: b.thinking } } as unknown as Ev);
    } else if (b.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } } as unknown as Ev);
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } } as unknown as Ev);
    } else {
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } } as unknown as Ev);
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } } as unknown as Ev);
    }
    events.push({ type: "content_block_stop", index } as unknown as Ev);
  });
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    finalMessage: async () => msg,
  };
};

const failing = (err: Error): StreamLike => ({
  // eslint-disable-next-line require-yield
  async *[Symbol.asyncIterator]() {
    throw err;
  },
  finalMessage: async () => {
    throw err;
  },
});

const fakeClient = (turns: (() => StreamLike)[], seen: Anthropic.Beta.Messages.BetaMessageStreamParams[]): AgentClient => ({
  beta: {
    messages: {
      stream: (params) => {
        seen.push(JSON.parse(JSON.stringify(params)));
        const next = turns.shift();
        if (!next) throw new Error("fake client: no more scripted turns");
        return next();
      },
    },
  },
});

const SPEC = {
  concept: { truth: "Hello helps tests pass", verb: "clarify" },
  scenes: [
    { id: "hello", duration: 2, background: { type: "solid", color: "#101010" }, layers: [{ type: "text", text: "Hello", fontSize: 180 }] },
    { id: "bye", duration: 1.5, transition: { type: "fade", duration: 0.3 }, layers: [{ type: "text", text: "Bye", fontSize: 180 }] },
  ],
};

const main = async () => {
  const p = createProject({ name: "zz agent mock test", format: "16:9" });
  try {
    // ------------------------------------------------------------ run 1: full loop
    const seen: Anthropic.Beta.Messages.BetaMessageStreamParams[] = [];
    const events: ChatEvent[] = [];
    const client = fakeClient(
      [
        () => scripted([{ type: "thinking", thinking: "Plan: a title card." }, { type: "text", text: "Writing the spec." }, { type: "tool_use", id: "tu_1", name: "set_spec", input: { spec: SPEC } }], "tool_use"),
        // malformed tool JSON → SDK-style parse error → the turn is re-issued
        () => failing(new SyntaxError("Unexpected token in JSON")),
        () =>
          scripted(
            [
              { type: "tool_use", id: "tu_2", name: "preview_frames", input: { times: [0.8], scale: 0.25 } },
              { type: "tool_use", id: "tu_3", name: "get_spec", input: {} },
              { type: "tool_use", id: "tu_4", name: "update_scene", input: { index: -1, scene: {} } },
            ],
            "tool_use",
          ),
        () => scripted([{ type: "text", text: "Done — a 3.2s title card." }], "end_turn"),
      ],
      seen,
    );
    await runChat(p.id, "make a 3-second title card that says Hello", (e) => events.push(e), { client, model: "claude-opus-5-5", effort: "low" });

    const types = events.map((e) => e.type);
    assert.equal(types.at(-1), "done");
    assert.ok(!types.includes("error"), JSON.stringify(events.filter((e) => e.type === "error")));
    assert.ok(events.some((e) => e.type === "thinking" && e.delta.includes("Plan")));
    assert.ok(events.some((e) => e.type === "text" && e.delta.includes("Writing")));
    const specEv = events.find((e) => e.type === "spec") as Extract<ChatEvent, { type: "spec" }>;
    assert.ok(specEv && specEv.timeline.scenes.length === 2, "spec event with timeline");
    const ends = events.filter((e): e is Extract<ChatEvent, { type: "tool_end" }> => e.type === "tool_end");
    assert.equal(ends.length, 4);
    assert.match(ends[0].summary, /^Saved spec · 2 scenes · 3\.2s/);
    assert.ok(ends[1].ok && ends[1].images?.length === 1 && ends[1].images[0].startsWith(`/files/${p.id}/chat/`), JSON.stringify(ends[1]));
    assert.equal(ends[3].ok, false, "invalid input rejected by zod");
    console.log("tool summaries:", ends.map((e) => `${e.ok ? "✓" : "✗"} ${e.summary}`).join(" | "));

    // request shape
    assert.equal(seen.length, 4);
    const r0 = seen[0];
    assert.equal(r0.model, "claude-opus-5-5");
    assert.deepEqual(r0.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(r0.fallbacks, "default");
    assert.deepEqual(r0.thinking, { type: "adaptive", display: "summarized" });
    assert.deepEqual(r0.output_config, { effort: "low" });
    assert.deepEqual(r0.tool_choice, { type: "auto" });
    assert.equal(r0.max_tokens, 64000);
    const sys = r0.system as Anthropic.Beta.BetaTextBlockParam[];
    assert.equal(sys.length, 1);
    assert.deepEqual(sys[0].cache_control, { type: "ephemeral" });
    assert.ok(sys[0].text.includes(p.id) && sys[0].text.includes("# Director's Guide") && sys[0].text.includes("# Kit Reference"));
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(sys[0].text), "no timestamps in the system prompt");
    const tools = r0.tools as Anthropic.Beta.BetaTool[];
    assert.ok(tools.every((t) => t.eager_input_streaming === true));
    const names = tools.map((t) => t.name);
    for (const hidden of ["create_project", "list_projects", "open_studio_hint", "get_guide"]) assert.ok(!names.includes(hidden), `${hidden} hidden`);
    assert.ok(tools.every((t) => !("projectId" in ((t.input_schema as { properties?: object }).properties ?? {}))), "no projectId in bound schemas");
    assert.deepEqual(names, (seen[3].tools as Anthropic.Beta.BetaTool[]).map((t) => t.name), "deterministic tool order");
    assert.equal(seen[0].system && JSON.stringify(seen[0].system), JSON.stringify(seen[3].system), "stable system prompt");
    // first user turn: project_state + user text
    const u0 = r0.messages[0].content as Anthropic.Beta.BetaTextBlockParam[];
    assert.ok(u0[0].text.startsWith("<project_state>") && u0[1].text.startsWith("make a 3-second"));
    // retry re-issued the identical request
    assert.deepEqual(seen[1].messages, seen[2].messages);
    // parallel tool results in ONE user message, with the preview image hydrated to base64
    const last = seen[3].messages;
    const results = last[last.length - 1];
    assert.equal(results.role, "user");
    const blocks = results.content as Anthropic.Beta.BetaToolResultBlockParam[];
    assert.deepEqual(blocks.map((b) => b.tool_use_id), ["tu_2", "tu_3", "tu_4"]);
    const img = (blocks[0].content as { type: string; source?: { type: string; data: string; media_type: string } }[]).find((c) => c.type === "image");
    assert.ok(img && img.source!.media_type === "image/jpeg" && img.source!.data.length > 1000 && !img.source!.data.startsWith("@file:"), "image passed back as base64");
    assert.equal(blocks[2].is_error, true);
    // assistant turns replayed unchanged (thinking block kept with its signature)
    const a0 = last[1].content as { type: string; signature?: string }[];
    assert.equal(a0[0].type, "thinking");
    assert.equal(a0[0].signature, "sig");

    // persistence
    const chatJson = JSON.parse(fs.readFileSync(path.join(p.dir, "chat.json"), "utf8"));
    assert.equal(chatJson.messages.length, 6, "user, assistant, user(results), assistant, user(results), assistant");
    assert.ok(JSON.stringify(chatJson).includes("@file:chat/tu_2-0.jpg"), "images stored by reference");
    assert.ok(fs.existsSync(path.join(p.dir, "chat", "tu_2-0.jpg")));
    const ui = getChat(p.id);
    assert.equal(ui.running, false);
    assert.equal(ui.messages.length, 2);
    assert.deepEqual(
      ui.messages[1].parts.map((x) => x.type),
      ["thinking", "text", "tool", "tool", "tool", "tool", "text"],
    );

    // ------------------------------------------------------------ run 2: refusal + history continuity
    const seen2: Anthropic.Beta.Messages.BetaMessageStreamParams[] = [];
    const ev2: ChatEvent[] = [];
    const refused = () =>
      scripted([{ type: "text", text: "partial" }], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: "Policy." } as unknown as Msg["stop_details"] });
    await runChat(p.id, "now something refused", (e) => ev2.push(e), { client: fakeClient([refused], seen2), model: "claude-opus-5-5", effort: "low" });
    const err = ev2.find((e) => e.type === "error") as { message: string } | undefined;
    assert.ok(err && /declined/.test(err.message) && /cyber/.test(err.message), JSON.stringify(ev2));
    assert.equal(seen2[0].messages.length, 7, "full history replayed + new user turn");
    const chat2 = JSON.parse(fs.readFileSync(path.join(p.dir, "chat.json"), "utf8"));
    assert.equal(chat2.messages.length, 7, "refused partial output not appended");

    // ------------------------------------------------------------ run 3: haiku (no fallback) + stop
    const seen3: Anthropic.Beta.Messages.BetaMessageStreamParams[] = [];
    const ev3: ChatEvent[] = [];
    const slow = (): StreamLike => ({
      async *[Symbol.asyncIterator]() {
        stopChat(p.id);
        await new Promise((r) => setTimeout(r, 20));
        throw Object.assign(new Error("Request was aborted."), { name: "AbortError" });
      },
      finalMessage: async () => {
        throw new Error("aborted");
      },
    });
    await runChat(p.id, "stop me", (e) => ev3.push(e), { client: fakeClient([slow], seen3), model: "claude-haiku-5-5", effort: "low" });
    assert.equal(seen3[0].fallbacks, undefined);
    assert.equal(seen3[0].betas, undefined);
    assert.ok(ev3.some((e) => e.type === "status" && e.text === "Stopped."), JSON.stringify(ev3));
    assert.ok(!ev3.some((e) => e.type === "error"));

    clearChat(p.id);
    assert.equal(getChat(p.id).messages.length, 0);
    console.log("agent mock tests: OK");
  } finally {
    deleteProject(p.id);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
