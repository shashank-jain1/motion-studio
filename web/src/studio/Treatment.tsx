import { useMemo, useState } from "react";
import { useStudio } from "./context";
import { IconChevronDown } from "../components/Icons";
import { fmtTC } from "../lib/format";
import { inkOn, sceneColor, themeColors, toHex } from "../lib/sceneColor";

type Concept = { truth?: string; metaphor?: string; motif?: string; verb?: string; hook?: string; arc?: string[]; colorScript?: string[] };

/** Map beat i of n onto a scene: by name (beat "hook: …" ↔ scene id "hook"), else proportionally. */
const beatScene = (name: string, i: number, n: number, ids: (string | undefined)[]) => {
  const byName = ids.findIndex((id) => id && id.toLowerCase() === name.toLowerCase());
  if (byName >= 0) return byName;
  return n <= 1 ? 0 : Math.round((i * (ids.length - 1)) / (n - 1));
};

/** The director's concept as a treatment page: truth · metaphor · motif · verb, arc beats on the scenes, color script. */
export const Treatment = () => {
  const { info, bus, selectScene } = useStudio();
  const [open, setOpen] = useState(true);
  const c = (info?.spec.concept ?? {}) as Concept;
  const data = useMemo(() => {
    if (!info) return null;
    const theme = themeColors(info.spec);
    const ids = info.spec.scenes.map((s) => s.id);
    const colors = info.spec.scenes.map((_, i) => sceneColor(info.spec, i, theme));
    const arc = (c.arc ?? []).map((b, i, all) => {
      const m = /^\s*([^:—–-]{1,24})\s*[:—–-]\s*(.*)$/.exec(b);
      const name = (m?.[1] ?? `beat ${i + 1}`).trim();
      const scene = beatScene(name, i, all.length, ids);
      return { name, text: m?.[2] ?? b, scene };
    });
    const script = (c.colorScript ?? []).map((label, i, all) => {
      const hex = toHex(/#[0-9a-f]{3,6}\b/i.exec(label)?.[0]);
      const scene = all.length <= 1 ? 0 : Math.round((i * (ids.length - 1)) / (all.length - 1));
      return { label, color: hex ?? colors[scene] ?? "#2A2925" };
    });
    return { arc, script, colors };
  }, [info, c.arc, c.colorScript]);
  if (!info || !data) return null;
  const scenes = info.timeline.scenes;
  const total = info.seconds;
  const jump = (i: number) => { selectScene(i); bus.seek(Math.round((scenes[i].start + scenes[i].overlapIn) * info.fps)); };

  return (
    <section className={`treatment ${open ? "is-open" : ""}`} aria-label="Treatment">
      <button className="treatment-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="label">Treatment</span>
        {c.verb && <span className="mono dim small ellipsis">VERB · {c.verb.split(/[ →(]/)[0].toUpperCase()}</span>}
        <span className="spacer" />
        <IconChevronDown size={14} className="chev" />
      </button>
      {open && (
        <div className="treatment-body">
          {c.truth && <blockquote className="truth">{c.truth}</blockquote>}
          <dl className="kv treatment-kv">
            {c.metaphor && <><dt className="label">Metaphor</dt><dd>{c.metaphor}</dd></>}
            {c.motif && <><dt className="label">Motif</dt><dd>{c.motif}</dd></>}
            {c.verb && <><dt className="label">Verb</dt><dd>{c.verb}</dd></>}
            {c.hook && <><dt className="label">Hook</dt><dd>{c.hook}</dd></>}
          </dl>
          {!!data.arc.length && (
            <div className="arc">
              <div className="label">Arc on the cut</div>
              <div className="arc-strip" aria-hidden>
                {scenes.map((sc, i) => (
                  <span key={i} className="arc-seg" style={{ flexGrow: Math.max(0.05, sc.end - sc.start - sc.overlapIn), background: data.colors[i], color: inkOn(data.colors[i]) }}>
                    <span className="mono">{String(i + 1).padStart(2, "0")}</span>
                  </span>
                ))}
              </div>
              <ol className="beats">
                {data.arc.map((b, i) => (
                  <li key={i}>
                    <button className="beat-row" onClick={() => jump(b.scene)} title={`Go to scene ${b.scene + 1}`}>
                      <span className="beat-chip" style={{ background: data.colors[b.scene] }} />
                      <span className="mono beat-name">{b.name.toUpperCase()}</span>
                      <span className="beat-text">{b.text}</span>
                      <span className="mono dim beat-tc">SC{String(b.scene + 1).padStart(2, "0")} {fmtTC(scenes[b.scene]?.start ?? 0, info.fps).slice(3)}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="arc-total mono dim">{fmtTC(total, info.fps)} total</div>
            </div>
          )}
          {!!data.script.length && (
            <div className="color-script">
              <div className="label">Color script</div>
              <div className="swatches">
                {data.script.map((s, i) => (
                  <div key={i} className="swatch">
                    <span className="swatch-chip" style={{ background: s.color }} />
                    <span className="swatch-label">{s.label}</span>
                    <span className="mono dim">{s.color.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
