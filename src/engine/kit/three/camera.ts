/**
 * Camera language (pure functions of t): orbit keyframes (motion.ts cameraAt) + a named move + optional spline
 * path + seeded handheld shake. Returns a full camera pose; ThreeView/rigs apply it.
 *
 * Moves: dolly-zoom (vertigo: distance × k while fov keeps the subject's frustum height constant), god-shot
 * (top-down → three-quarter, rolling out), macro-push / macro-pull (edge-detail macro ↔ hero), whip-pan / whip-out
 * (fast pan of the look direction; the post stack averages sub-frames while it is fast), push-in, pull-out,
 * crane-up, orbit (360° × amount).
 */
import * as THREE from "three";
import { EASING, clamp01, ease } from "../../core/animate";
import type { EaseName } from "../../core/animate";
import { type Animation3D, type OrbitKf, cameraAt } from "./motion";

export const CAMERA_MOVES = ["none", "dolly-zoom", "god-shot", "macro-push", "macro-pull", "whip-pan", "whip-out", "push-in", "pull-out", "crane-up", "orbit"] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export type PathKey = { t: number; pos: [number, number, number]; target?: [number, number, number]; fov?: number; ease?: EaseName };
export type CameraSpec = {
  move?: CameraMove;
  at?: number;
  duration?: number;
  amount?: number;
  /** spline camera path: positions in fit units (1 = the auto-framing distance), target in model units */
  path?: PathKey[];
  fov?: number;
  /** handheld micro-shake 0..1 */
  shake?: number;
  roll?: number;
  /** look-at point (model units), default the object center */
  target?: [number, number, number];
};

export type CamPose = { pos: THREE.Vector3; target: THREE.Vector3; fov: number; roll: number; panYaw: number; panPitch: number };

export const BASE_FOV = 24;
const D2R = Math.PI / 180;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const inOutCubic = (x: number) => EASING.inOut(clamp01(x));
const inOutSine = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));

export const MOVE_DEFAULTS: Record<CameraMove, { duration: number; amount: number }> = {
  none: { duration: 0, amount: 0 },
  "dolly-zoom": { duration: 3, amount: 1.2 },
  "god-shot": { duration: 2.6, amount: 1 },
  "macro-push": { duration: 3, amount: 1 },
  "macro-pull": { duration: 2.6, amount: 1 },
  "whip-pan": { duration: 0.5, amount: 40 },
  "whip-out": { duration: 0.5, amount: 40 },
  "push-in": { duration: 3, amount: 1 },
  "pull-out": { duration: 3, amount: 1 },
  "crane-up": { duration: 3, amount: 1 },
  orbit: { duration: 6, amount: 1 },
};

/** smooth seeded 1D value noise in [-1, 1] */
const vnoise = (x: number, seed: number) => {
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u);
};

/** Catmull-Rom through key positions with per-segment easing; keys hit exactly at their t. */
const pathAt = (keys: PathKey[], t: number, pick: (k: PathKey) => [number, number, number] | undefined, fallback: THREE.Vector3): THREE.Vector3 => {
  const ks = keys.filter((k) => pick(k)).sort((a, b) => a.t - b.t);
  if (!ks.length) return fallback.clone();
  const pts = ks.map((k) => new THREE.Vector3(...pick(k)!));
  if (ks.length === 1 || t <= ks[0].t) return pts[0];
  if (t >= ks[ks.length - 1].t) return pts[pts.length - 1];
  let i = 0;
  while (i < ks.length - 2 && t > ks[i + 1].t) i++;
  const u = ease(ks[i + 1].ease, clamp01((t - ks[i].t) / Math.max(1e-6, ks[i + 1].t - ks[i].t)), "inOut");
  if (pts.length === 2) return pts[0].clone().lerp(pts[1], u);
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  return curve.getPoint((i + u) / (pts.length - 1));
};

export type CameraCtx = {
  orbit?: OrbitKf[];
  anim: Animation3D;
  cam?: CameraSpec;
  t: number;
  /** distance that frames the subject at BASE_FOV */
  fitDist: number;
  /** subject size (model units) for macro targets */
  size: { w: number; h: number };
};

export const cameraPose = (c: CameraCtx): CamPose => {
  const spec = c.cam ?? {};
  const t = c.t;
  const base = cameraAt(c.orbit, c.anim, t);
  let yaw = base.yaw, pitch = base.pitch, distK = base.distance;
  const fov0 = spec.fov ?? BASE_FOV;
  // fit distance scales with the fov so a narrower lens frames the same
  const fit = c.fitDist * (Math.tan((BASE_FOV * D2R) / 2) / Math.tan((fov0 * D2R) / 2));
  let fov = fov0;
  let roll = spec.roll ?? 0;
  let panYaw = 0, panPitch = 0;
  const target = new THREE.Vector3(...(spec.target ?? [0, 0, 0]));
  const move = spec.move ?? "none";
  const d = MOVE_DEFAULTS[move];
  const at = spec.at ?? 0;
  const dur = Math.max(0.05, spec.duration ?? d.duration);
  const amt = spec.amount ?? d.amount;
  const u = clamp01((t - at) / dur);
  switch (move) {
    case "dolly-zoom": {
      const e = inOutCubic(u);
      const kEnd = amt >= 0 ? 1 + amt : 1 / (1 - amt);
      const k = lerp(1, kEnd, e);
      distK *= k;
      fov = (2 * Math.atan(Math.tan((fov0 * D2R) / 2) / k)) / D2R;
      break;
    }
    case "god-shot": {
      const e = ease("inOutQuint", u);
      pitch = lerp(88.5, pitch, e);
      yaw = yaw + lerp(-35, 0, e) * amt;
      roll += lerp(-25, 0, e) * amt;
      distK *= lerp(1.45, 1, e);
      break;
    }
    case "macro-push":
    case "macro-pull": {
      const e0 = move === "macro-push" ? inOutCubic(u) : 1 - ease("inOutExpo", u);
      const detail = new THREE.Vector3(...(spec.target ?? [-c.size.w * 0.32, c.size.h * 0.18, 0.05]));
      const ek = Math.min(1, e0 * amt);
      target.lerp(detail, ek);
      // amount > 1 goes closer than the default macro (0.24×): 1.25 → 0.05× (inside a single clone)
      distK *= Math.max(0.02, lerp(1, 0.24, e0 * amt));
      fov = lerp(fov0, fov0 * 0.82, e0);
      yaw += lerp(0, -22, ek);
      pitch += lerp(0, 6, ek);
      break;
    }
    case "whip-pan":
    case "whip-out": {
      // one fast pan of the look direction (≈ 0 → peak speed → 0); whip-pan ends ON the subject
      const e = inOutCubic(u);
      const k = move === "whip-pan" ? 1 - e : e;
      panYaw = amt * k * D2R;
      panPitch = -amt * 0.06 * k * D2R;
      roll += amt * 0.05 * Math.sin(Math.PI * e);
      break;
    }
    case "push-in":
      distK *= lerp(1.18, 0.9, inOutSine(u) * amt);
      break;
    case "pull-out":
      distK *= lerp(0.9, 1.2, inOutSine(u));
      break;
    case "crane-up": {
      const e = inOutCubic(u);
      pitch = lerp(pitch - 12, pitch + 24 * amt, e);
      distK *= lerp(1.08, 1, e);
      break;
    }
    case "orbit":
      yaw += 360 * amt * inOutSine(u);
      break;
    default:
      break;
  }
  if (spec.shake) {
    const s = spec.shake;
    yaw += s * (1.1 * vnoise(t * 0.9, 1) + 0.35 * vnoise(t * 2.7, 2));
    pitch += s * (0.8 * vnoise(t * 0.8, 3) + 0.3 * vnoise(t * 2.3, 4));
    roll += s * 0.6 * vnoise(t * 0.6, 5);
  }
  const dist = fit * distK;
  pitch = Math.max(-88.5, Math.min(88.5, pitch));
  const yr = yaw * D2R, pr = pitch * D2R;
  let pos = new THREE.Vector3(Math.sin(yr) * Math.cos(pr), Math.sin(pr), Math.cos(yr) * Math.cos(pr)).multiplyScalar(dist).add(target);
  let tgt = target;
  if (spec.path?.length) {
    pos = pathAt(spec.path, t, (k) => k.pos, pos.clone().sub(target).divideScalar(fit)).multiplyScalar(fit);
    tgt = pathAt(spec.path, t, (k) => k.target, target);
    const fk = spec.path.filter((k) => typeof k.fov === "number").sort((a, b) => a.t - b.t);
    if (fk.length) {
      fov = fk[0].fov!;
      for (let i = 1; i < fk.length; i++) {
        if (t >= fk[i].t) fov = fk[i].fov!;
        else if (t > fk[i - 1].t) {
          fov = lerp(fk[i - 1].fov!, fk[i].fov!, ease(fk[i].ease, (t - fk[i - 1].t) / Math.max(1e-6, fk[i].t - fk[i - 1].t), "inOut"));
          break;
        }
      }
    }
  }
  return { pos, target: tgt, fov, roll: roll * D2R, panYaw, panPitch };
};

/** Apply a pose to a perspective camera. */
export const applyCamera = (camera: THREE.PerspectiveCamera, p: CamPose, aspect: number, nearHint: number) => {
  camera.fov = p.fov;
  camera.aspect = aspect;
  const dist = p.pos.distanceTo(p.target);
  camera.near = Math.max(0.005, Math.min(nearHint, dist * 0.05));
  camera.far = Math.max(60, dist * 40);
  camera.position.copy(p.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(p.target);
  if (p.panYaw) camera.rotateY(p.panYaw);
  if (p.panPitch) camera.rotateX(p.panPitch);
  if (p.roll) camera.rotateZ(p.roll);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
};

/** Angular speed proxy (degrees of view-direction change per frame) — drives auto motion blur. */
export const viewDelta = (a: THREE.PerspectiveCamera, b: THREE.PerspectiveCamera) => {
  const fa = new THREE.Vector3(0, 0, -1).applyQuaternion(a.quaternion);
  const fb = new THREE.Vector3(0, 0, -1).applyQuaternion(b.quaternion);
  return Math.acos(Math.max(-1, Math.min(1, fa.dot(fb)))) / D2R;
};
