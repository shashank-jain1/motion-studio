/**
 * Story Engine over MCP stdio: tools/list has story_kit / score_concepts / check_story; get_guide returns STORY_ENGINE.md;
 * set_spec surfaces story/* warnings; check_story returns the sparkline. Run: npx tsx scripts/tests/story-mcp.test.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT } from "../../src/core/paths";
import { deleteProject } from "../../src/core/projects";

type Res = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };
const textOf = (r: Res) => r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");

const S = (s: string) => {
  const [hook, surprise, emotionalPeak, payoff, brandLinkage, clarity, uniqueness, feasibility] = s.split(" ").map(Number);
  return { hook, surprise, emotionalPeak, payoff, brandLinkage, clarity, uniqueness, feasibility };
};
const CANDIDATES = [
  { title: "Moon, stars, counting sheep", technique: "control", logline: "a yawning woman counts sheep under the moon", scores: S("2 0 1 2 2 5 0 5"), typicality: 0.9 },
  { title: "Sheep on strike", technique: "inversion (benign violation, humour)", logline: "the counting sheep strike because the snoring keeps them awake", scores: S("4 4 3 3 3 4 4 4"), typicality: 0.2 },
  { title: "Comb the noise", technique: "sensory transposition + satisfying completion", logline: "an earbud-shaped comb combs jagged noise waveforms into one flat line that becomes the logo underline", scores: S("4 4 4 5 5 4 5 4"), typicality: 0.05 },
  { title: "7 hours in 7 seconds", technique: "consequence / time leap", logline: "a night of undisturbed sleep in fast-forward", scores: S("3 3 3 3 3 4 3 4") },
  { title: "Silent planet", technique: "exaggeration (extreme situation)", logline: "zoom out from one bedroom to a silent planet", scores: S("3 3 4 4 3 3 4 2") },
  { title: "Volume knob", technique: "metaphor mining", logline: "the world's volume knob is turned down", scores: S("4 4 3 3 3 3 4 4") },
  { title: "Pillow's night shift", technique: "perspective shift (POV)", logline: "the pillow narrates its night shift", scores: S("3 3 4 4 3 3 4 4") },
  { title: "Silence as the signature", technique: "sound-led constraint", logline: "every noise cuts out one by one until only the brand's chime remains", scores: S("3 3 3 4 4 3 4 4") },
];

const main = async () => {
  const transport = new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "src/mcp/server.ts")], stderr: "ignore" });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  let projectId = "";
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const t of ["story_kit", "score_concepts", "check_story", "get_guide"]) assert.ok(names.includes(t), `tools/list has ${t}`);
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as unknown as Res;

    const guide = textOf(await call("get_guide", {}));
    assert.ok(guide.includes("Story Engine — the operating manual") && guide.includes("score_concepts"), "get_guide returns STORY_ENGINE.md");

    const kit = await call("story_kit", { niche: "wellness", seconds: 15 });
    assert.ok(!kit.isError);
    const kitText = textOf(kit);
    assert.ok(kitText.includes("counting sheep") && kitText.includes("Gates (hard fail)") && kitText.includes("sensory-transposition"), kitText.slice(0, 400));
    console.log(`story_kit: ${kitText.split(/\s+/).length} words`);

    const scored = await call("score_concepts", { candidates: CANDIDATES });
    assert.ok(!scored.isError, textOf(scored));
    const st = textOf(scored);
    assert.ok(/#2\s+88 .*WINNER/.test(st), st);
    assert.ok(/#0 .*discarded|#0 .*GATE FAIL/.test(st), st);
    console.log(st);

    const bad = await call("score_concepts", { candidates: [{ title: "x", technique: "y", logline: "z", scores: { hook: 9 } }] });
    assert.ok(bad.isError, "invalid scores are rejected");

    const created = await call("create_project", { name: "zz-story-mcp-test", format: "9:16" });
    projectId = JSON.parse((created.content[0] as { text: string }).text).projectId;
    assert.ok(projectId, textOf(created));

    // A cliché-ridden 12s film with no story block → story warnings on set_spec
    const set1 = await call("set_spec", { projectId, spec: {
      concept: { niche: "wellness", truth: "Hush helps light sleepers block noise, feeling held.", motif: "a moon" },
      scenes: [{ duration: 12, layers: [{ type: "morph", shapes: [{ at: 0, shape: "moon" }] }, { type: "text", text: "Stop counting sheep" }] }],
    } });
    const w1 = textOf(set1);
    assert.ok(!set1.isError, w1);
    for (const code of ["story/missing", "story/cliche", "story/brand"]) assert.ok(w1.includes(code), `${code} in:\n${w1}`);

    // The Hush winner with a story block → clean story
    const set2 = await call("set_spec", { projectId, spec: {
      concept: {
        niche: "wellness", truth: "Hush helps light sleepers block noise, feeling held.", motif: "an earbud-shaped comb",
        story: {
          insight: "I'm tired because of other people's noise.", structure: "transformation", template: "pictorial-analogy",
          candidates: CANDIDATES, chosen: 2,
          clicheControl: { obvious: "moon, stars, counting sheep, a yawning woman", banned: ["moon", "sheep", "yawn", "stars"] },
          beats: [
            { t: 0, beat: "hook", intensity: 7, sound: "snore hit" },
            { t: 1.5, beat: "tension", intensity: 6, to: 8 },
            { t: 5, beat: "hold", intensity: 5 },
            { t: 6, beat: "peak", intensity: 10, wow: "every waveform combed flat; total silence" },
            { t: 10, beat: "payoff", intensity: 9 },
            { t: 12.5, beat: "lock", intensity: 8, sound: "mnemonic" },
          ],
          peakAt: 6, mnemonic: { visual: "the flat line becomes the wordmark underline", sonic: "one soft chime", loop: true },
        },
      },
      scenes: [
        { id: "noise", duration: 10, layers: [{ type: "path", preset: "zigzag", color: "#ff3355" }, { type: "text", text: "3:12 a.m.", y: -300 }, { type: "text", text: "hush", start: 0.3, fontSize: 48, y: 200 }] },
        { id: "lock", duration: 5, layers: [{ type: "text", id: "word", text: "Hush", fontSize: 160 }, { type: "text", text: "The world, combed flat.", y: 160 }] },
      ],
      actors: [{ id: "comb", layer: { type: "morph", shapes: [{ at: 0, shape: "pill" }] }, poses: [{ scene: "noise", t: 0, x: -400 }, { scene: "lock", t: 0.5, x: 0 }] }],
    } });
    const w2 = textOf(set2);
    assert.ok(!set2.isError, w2);
    assert.ok(!w2.includes("story/"), `no story warnings expected:\n${w2}`);

    const chk = await call("check_story", { projectId });
    const ct = textOf(chk);
    assert.ok(!chk.isError && ct.includes("intensity |") && ct.includes("No story issues"), ct);
    console.log(ct);
    console.log("story mcp tests: OK");
  } finally {
    await client.close();
    if (projectId) deleteProject(projectId);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
