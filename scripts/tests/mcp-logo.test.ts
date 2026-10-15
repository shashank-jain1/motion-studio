/**
 * End-to-end over MCP stdio: add_asset (SVG) returns a logo summary, analyze_logo returns summary + PNG part map,
 * set_spec with a "text:" morph writes glyphs.json. Run: npx tsx scripts/tests/mcp-logo.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT } from "../../src/core/paths";
import { deleteProject } from "../../src/core/projects";

type Res = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">
  <circle cx="30" cy="30" r="25" fill="#e11d48"/><circle cx="30" cy="30" r="10" fill="#fff"/>
  <g fill="#111"><rect x="70" y="15" width="10" height="35"/><rect x="85" y="15" width="10" height="35"/><rect x="100" y="15" width="10" height="35"/>
  <path d="M120 50 L130 15 H140 L150 50 H140 L135 32 L130 50 Z"/></g></svg>`;

const main = async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-mcp-"));
  const svgFile = path.join(tmp, "brand.svg");
  fs.writeFileSync(svgFile, SVG);
  const transport = new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "src/mcp/server.ts")], stderr: "ignore" });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  let projectId = "";
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "analyze_logo"));
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as unknown as Res;
    const created = await call("create_project", { name: "zz-mcp-logo-test" });
    projectId = JSON.parse((created.content[0] as { text: string }).text).projectId;

    const added = await call("add_asset", { projectId, path: svgFile });
    assert.ok(!added.isError, JSON.stringify(added));
    const sumText = added.content.find((c) => c.type === "text" && c.text.startsWith("Logo analysis")) as { text: string } | undefined;
    assert.ok(sumText, "add_asset returns a logo summary for SVGs");
    console.log(sumText.text.slice(0, 1500));

    const an = await call("analyze_logo", { projectId, asset: "assets/brand.svg", values: ["secure"], industry: "fintech" });
    assert.ok(!an.isError, JSON.stringify(an));
    const summary = JSON.parse((an.content[0] as { text: string }).text);
    assert.equal(summary.parts, 6, "red disc + painted white dot + 3 bars + A");
    assert.equal(summary.groups.wordmark.length, 4);
    assert.ok(an.content.some((c) => c.type === "image" && c.mimeType === "image/png"), "analyze_logo returns a PNG part map");
    console.log("modes:", summary.suggestedModes.map((m: { mode: string; score: number }) => `${m.mode}(${m.score})`).join(", "));

    const set = await call("set_spec", {
      projectId,
      spec: { scenes: [{ duration: 2, layers: [{ type: "morph", shapes: [{ at: 0.2, shape: "circle" }, { at: 1.2, shape: "text:Hey" }] }] }] },
    });
    assert.ok(!set.isError, JSON.stringify(set));
    const glyphs = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", projectId, "glyphs.json"), "utf8"));
    assert.ok(glyphs["Inter|700|Hey"], "glyphs.json has the default-font entry");
    console.log("mcp logo tests: OK");
  } finally {
    await client.close();
    if (projectId) deleteProject(projectId);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
