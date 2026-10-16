import { loadSpec } from "../../src/core/projects";
import { sceneTimeline } from "../../src/engine/spec/preprocess";
import { resolveActor } from "../../src/engine/render/Actors";
const spec = loadSpec(process.argv[2]);
const tl = sceneTimeline(spec.scenes, spec.fps);
const ra = resolveActor(spec.actors![0], 0, spec, tl.scenes, tl.totalFrames / spec.fps);
console.log(JSON.stringify(ra?.keyframes));
