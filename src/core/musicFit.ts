/**
 * Fit a finished music track (library or upload) to a film's timeline — pure, no I/O.
 *
 * A composed score is written for the film; a library track has its own structure, so we choose WHERE in the track the
 * film starts (trimStart) and, rarely, a short delayed start (at). Candidates are the track's beats; each is scored:
 *   - the track's drop (or another big energy rise) lands on the film's peak         (most important)
 *   - scene cuts land on beats
 *   - the film's end meets the track's own ending (best) or a bar line, never past the track's end
 *   - the opening isn't silent; a delayed start is short
 */

export type TrackAnalysis = { duration: number; bpm: number; beats: number[]; energyCurve: number[]; dropAt: number | null; beatConfidence?: number };
export type FilmTiming = { total: number; peak: number; cuts: number[] };
export type MusicFit = {
  trimStart: number; at: number; fadeIn: number; fadeOut: number;
  /** film time where the chosen drop lands */
  dropFilmTime: number | null;
  /** distance (s) between that drop and the film's peak */
  dropErr: number;
  cutErrMs: number;
  /** the track's natural ending lands on the film's end */
  endsWithTrack: boolean;
  /** the track runs out before the film ends (s short); 0 when covered */
  shortBy: number;
  /** beats in FILM time (for sound.music) */
  beats: number[];
  notes: string[];
};

const at = (curve: number[], t: number) => curve[Math.max(0, Math.min(curve.length - 1, Math.round(t * 2)))] ?? 0;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Big sustained loudness rises (2 Hz curve): the drop plus secondary lifts, strongest first. */
export const energyRises = (curve: number[], dropAt: number | null): number[] => {
  const out: { t: number; d: number }[] = [];
  for (let i = 2; i < curve.length - 2; i++) {
    const before = (curve[i - 2] + curve[i - 1]) / 2, after = (curve[i] + curve[i + 1] + curve[i + 2]) / 3;
    const d = after - before;
    if (d > 0.12 && after > 0.45) out.push({ t: i / 2, d });
  }
  // keep local maxima ≥ 2 s apart
  out.sort((a, b) => b.d - a.d);
  const picked: number[] = dropAt != null ? [dropAt] : [];
  for (const o of out) if (picked.every((p) => Math.abs(p - o.t) >= 2)) picked.push(o.t);
  return picked.slice(0, 6);
};

export const fitTrack = (track: TrackAnalysis, film: FilmTiming): MusicFit => {
  const { total, peak } = film;
  const beat = track.bpm > 0 ? 60 / track.bpm : 0.5;
  const anchors = energyRises(track.energyCurve, track.dropAt);
  const grid = track.beats.length ? track.beats : Array.from({ length: Math.floor(track.duration / beat) }, (_, i) => i * beat);
  const bars = grid.filter((_, i) => i % 4 === 0);
  const cuts = film.cuts.filter((c) => c > 0.05 && c < total - 0.05);
  const naturalEnd = (() => {
    // where the music actually ends (energy falls under 10% for good), not the file's silent tail
    for (let i = track.energyCurve.length - 1; i >= 0; i--) if (track.energyCurve[i] > 0.1) return Math.min(track.duration, (i + 1) / 2);
    return track.duration;
  })();

  // candidate offsets o = track time at film time 0 (negative = the music starts o seconds into the film)
  const cands = new Set<number>([0, ...grid.map((b) => r3(b)), ...anchors.map((a) => r3(a - peak))]);
  let best: { o: number; score: number; dropErr: number; cutErr: number; endsWithTrack: boolean; shortBy: number; drop: number | null } | null = null;
  for (const o of cands) {
    if (o < -1.5 || o > Math.max(0, track.duration - 2)) continue;
    // drop: the anchor nearest to landing on the peak
    let dropErr = Infinity, drop: number | null = null;
    for (const a of anchors) { const ft = a - o; if (ft < 0.5 || ft > total) continue; const e = Math.abs(ft - peak); if (e < dropErr) { dropErr = e; drop = ft; } }
    if (!anchors.length) dropErr = 0;
    const cutErr = cuts.length ? cuts.reduce((s, c) => { const tt = c + o; const n = grid.reduce((m, b) => Math.min(m, Math.abs(b - tt)), Infinity); return s + Math.min(n, beat / 2); }, 0) / cuts.length : 0;
    const endT = o + total;
    const shortBy = Math.max(0, endT - naturalEnd);
    const endsWithTrack = Math.abs(endT - naturalEnd) < 1.2;
    const barEnd = bars.length ? bars.reduce((m, b) => Math.min(m, Math.abs(b - endT)), Infinity) : beat;
    const intro = at(track.energyCurve, Math.max(0, o) + 0.25);
    const score =
      (Number.isFinite(dropErr) ? Math.min(dropErr, 4) : 4) * 3 +
      (cutErr / beat) * 2 +
      shortBy * 4 +
      (endsWithTrack ? -1.5 : Math.min(barEnd, beat) / beat) +
      (intro < 0.12 ? 1.5 : 0) +
      (o < 0 ? -o * 1.5 : 0);
    if (!best || score < best.score) best = { o, score, dropErr: Number.isFinite(dropErr) ? dropErr : 0, cutErr, endsWithTrack, shortBy, drop };
  }
  const b = best ?? { o: 0, score: 0, dropErr: 0, cutErr: 0, endsWithTrack: false, shortBy: Math.max(0, total - naturalEnd), drop: null };
  const trimStart = r3(Math.max(0, b.o)), start = r3(Math.max(0, -b.o));
  const notes: string[] = [];
  if (anchors.length && b.dropErr > 0.25) notes.push(`The track's lift lands ${b.dropErr.toFixed(2)}s from the film's peak — move the peak scene or pick another track.`);
  if (!anchors.length) notes.push("No clear drop in this track: fitted for beats and the ending only.");
  if (b.shortBy > 0.05) notes.push(`The track runs out ${b.shortBy.toFixed(1)}s before the film ends — pick a longer track or shorten the film.`);
  if ((track.beatConfidence ?? 1) < 0.35) notes.push("Weak beat in this track: cut alignment is approximate.");
  return {
    trimStart, at: start,
    fadeIn: trimStart > 0.05 && at(track.energyCurve, trimStart) > 0.3 ? 0.12 : 0,
    fadeOut: b.endsWithTrack ? 0.25 : 1.2,
    dropFilmTime: b.drop != null ? r3(b.drop) : null, dropErr: r3(b.dropErr), cutErrMs: Math.round(b.cutErr * 1000),
    endsWithTrack: b.endsWithTrack, shortBy: r3(b.shortBy),
    beats: grid.map((x) => r3(x - b.o)).filter((x) => x >= 0 && x < total),
    notes,
  };
};
