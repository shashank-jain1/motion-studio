/**
 * Motion Studio MCP server (stdio). stdout is reserved for the MCP protocol — everything else goes to stderr.
 * Tools live in src/core/tools.ts (shared with the web app's in-app director); this file only maps them to MCP.
 */
// Route any stray console output to stderr before anything else can log.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PROJECTS_DIR } from "../core/paths";
import { TOOLS, callTool, type ToolContent } from "../core/tools";

type Extra = {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification: (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
};

const server = new McpServer(
  { name: "motion-studio", version: "0.1.0" },
  {
    instructions:
      "Motion Studio turns a JSON Scene Spec into motion-graphics videos (Remotion). Workflow: get_guide (read once) → create_project → add_asset (logos, screenshots, music) → set_spec → preview_frames (LOOK at the frames, critique, fix with set_spec/update_scene, repeat) → render_video draft → final.",
  },
);

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.shape },
    async (args: Record<string, unknown>, extra: Extra) => {
      const token = extra._meta?.progressToken;
      const res = await callTool(tool.name, args, {
        signal: extra.signal,
        onProgress:
          token === undefined
            ? undefined
            : (p) => {
                extra
                  .sendNotification({
                    method: "notifications/progress",
                    params: { progressToken: token, progress: Math.round(p.progress * 100), total: 100, ...(p.message ? { message: p.message } : {}) },
                  })
                  .catch(() => undefined);
              },
      });
      return { content: res.content as ToolContent[], ...(res.isError ? { isError: true } : {}) };
    },
  );
}

const main = async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[motion-studio] MCP server ready (projects: ${PROJECTS_DIR})`);
};

main().catch((e) => {
  console.error("[motion-studio] fatal:", e);
  process.exit(1);
});
