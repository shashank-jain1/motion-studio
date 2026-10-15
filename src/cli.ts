/**
 * Motion Studio CLI.
 *   pnpm cli render <projectId> [--final]
 *   pnpm cli preview <projectId> [t1,t2,...] [--scale=0.5]
 *   pnpm cli validate <projectId>
 *   pnpm cli list
 */
import { getProject, listProjects, readSpec, validateSpec } from "./core/projects";
import { renderFrames, renderVideo } from "./core/render";
import { computeTimeline } from "./core/projects";

const usage = `Usage:
  pnpm cli render <projectId> [--final]
  pnpm cli preview <projectId> [t1,t2,...] [--scale=0.5]
  pnpm cli validate <projectId>
  pnpm cli list`;

const main = async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const args = rest.filter((a) => !a.startsWith("--"));
  const flagValue = (name: string) => [...flags].find((f) => f.startsWith(`--${name}=`))?.split("=")[1];

  switch (cmd) {
    case "list": {
      for (const p of listProjects()) console.log(`${p.id}\t${p.format}\t${p.hasSpec ? "spec" : "no spec"}\t${p.name}`);
      return;
    }
    case "validate": {
      const id = args[0];
      if (!id) throw new Error(usage);
      const spec = readSpec(id);
      if (!spec) throw new Error(`Project "${id}" has no spec.json`);
      const res = validateSpec(id, spec);
      if (!res.ok) {
        console.log("INVALID:");
        for (const e of res.errors) console.log(`  - ${e}`);
        process.exitCode = 1;
        return;
      }
      console.log(`OK: ${res.durationSeconds.toFixed(2)}s`);
      for (const w of res.warnings) console.log(`  warning: ${w}`);
      return;
    }
    case "preview": {
      const id = args[0];
      if (!id) throw new Error(usage);
      let times = args[1]?.split(",").map(Number).filter((n) => Number.isFinite(n));
      if (!times?.length) {
        const spec = readSpec(id);
        if (!spec) throw new Error(`Project "${id}" has no spec.json`);
        const tl = computeTimeline(spec);
        times = tl.scenes.map((s) => Math.round((s.start + s.overlapIn + (s.duration - s.overlapIn) * 0.5) * 100) / 100);
      }
      const scale = Number(flagValue("scale") ?? 0.5);
      const res = await renderFrames(id, times, { scale });
      for (const f of res.frames) console.log(`t=${f.time.toFixed(2)}s\t${f.path}`);
      if (res.sheet) console.log(`sheet\t${res.sheet}`);
      return;
    }
    case "render": {
      const id = args[0];
      if (!id) throw new Error(usage);
      getProject(id);
      let last = -1;
      const res = await renderVideo(id, {
        quality: flags.has("--final") ? "final" : "draft",
        onProgress: (p) => {
          const pct = Math.floor(p.progress * 100);
          if (pct !== last && pct % 10 === 0) {
            last = pct;
            console.error(`  ${pct}%`);
          }
        },
      });
      console.log(res.path);
      console.log(`${res.width}x${res.height} @ ${res.fps}fps, ${res.seconds.toFixed(2)}s, ${(res.sizeBytes / 1e6).toFixed(2)} MB, ${res.renderSeconds}s`);
      return;
    }
    default:
      console.log(usage);
      if (cmd) process.exitCode = 1;
  }
};

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
