import { useEffect, useRef, useState } from "react";
import { api, uploadAsset, type Asset, type LogoSummary } from "../api";
import { useStudio } from "./context";
import { useToast } from "../components/Toast";
import { Lightbox, Skeleton } from "../components/ui";
import { IconAt, IconClose, IconFile, IconFilm, IconImage, IconMusic, IconTrash, IconUpload, Spinner } from "../components/Icons";
import { basename, fmtBytes, fmtDuration } from "../lib/format";

type Upload = { key: string; name: string; progress: number; error?: string };
const isLogo = (a: Asset) => /\.svg$/i.test(a.path);

export const AssetsPanel = () => {
  const { id, assets, setAssets, uploaderNonce, insertIntoChat } = useStudio();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [detail, setDetail] = useState<Asset | null>(null);
  const [preview, setPreview] = useState<Asset | null>(null);

  useEffect(() => { if (uploaderNonce) inputRef.current?.click(); }, [uploaderNonce]);

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      try {
        const info = await uploadAsset(id, file, (p) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))));
        const a: Asset = { ...info, url: info.url ?? `/files/${id}/${info.path}` };
        setAssets((list) => [...list.filter((x) => x.path !== a.path), a]);
        setUploads((u) => u.filter((x) => x.key !== key));
        if (info.logo) toast.success("Logo analyzed", `${basename(info.path)} · ${info.logo.parts ?? "?"} parts — the director can animate each one`);
        else if (info.logoError) toast.info("Uploaded — logo analysis failed", `${basename(info.path)}: ${info.logoError}. It still works as an image.`);
        else toast.success("Uploaded", basename(info.path));
      } catch (e) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x)));
        setTimeout(() => setUploads((u) => u.filter((x) => x.key !== key)), 5000);
        toast.error(`Couldn't upload ${file.name}`, (e as Error).message);
      }
    }
  };

  const remove = async (a: Asset) => {
    const prev = assets;
    setAssets((list) => list.filter((x) => x.path !== a.path)); // optimistic
    if (detail?.path === a.path) setDetail(null);
    try { await api.deleteAsset(id, a.path); } catch (e) {
      setAssets(() => prev);
      toast.error("Couldn't delete asset", (e as Error).message);
    }
  };

  const mention = (a: Asset) => { insertIntoChat(`@${a.path} `); };

  return (
    <div className="assets-panel"
      onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
      <input ref={inputRef} type="file" multiple hidden accept="image/*,video/*,audio/*,.svg,.json,.lottie,.ttf,.otf,.woff,.woff2"
        onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} />

      <button className={`dropzone ${drag ? "is-drag" : ""}`} onClick={() => inputRef.current?.click()}>
        <span className="dropzone-icon"><IconUpload size={16} /></span>
        <span className="dropzone-text">
          <strong>{drag ? "Release to ingest" : "Ingest — drop files or browse"}</strong>
          <span className="mono">SVG LOGO · IMAGES · VIDEO · AUDIO · FONTS · LOTTIE</span>
        </span>
      </button>

      {uploads.map((u) => (
        <div key={u.key} className={`upload-row ${u.error ? "is-error" : ""}`}>
          {u.error ? <IconClose size={12} /> : <Spinner size={12} />}
          <span className="upload-name">{u.name}</span>
          <span className="upload-pct mono">{u.error ? "failed" : `${Math.round(u.progress * 100)}%`}</span>
          <div className="upload-bar" style={{ transform: `scaleX(${u.error ? 1 : u.progress})` }} />
        </div>
      ))}

      {assets.length === 0 && uploads.length === 0 && (
        <div className="panel-empty">
          <span className="label">Bin is empty</span>
          <span className="dim">Upload a logo, product shots or a track, then mention them in a brief with <code className="mono">@</code>. SVG logos get part analysis.</span>
        </div>
      )}

      <div className="asset-grid">
        {assets.map((a) => (
          <AssetTile key={a.path} a={a} onOpen={() => (isLogo(a) ? setDetail(a) : a.kind === "image" ? setPreview(a) : undefined)} onMention={() => mention(a)} onDelete={() => remove(a)} />
        ))}
      </div>

      {detail && <LogoDrawer a={detail} onClose={() => setDetail(null)} onMention={() => mention(detail)} />}
      {preview && <Lightbox images={[{ url: preview.url, label: preview.path }]} index={0} onClose={() => setPreview(null)} onIndex={() => {}} />}
    </div>
  );
};

const AssetTile = ({ a, onOpen, onMention, onDelete }: { a: Asset; onOpen: () => void; onMention: () => void; onDelete: () => void }) => {
  const vref = useRef<HTMLVideoElement>(null);
  const name = basename(a.path);
  return (
    <div className="asset-tile" onMouseEnter={() => vref.current?.play().catch(() => {})} onMouseLeave={() => { const v = vref.current; if (v) { v.pause(); v.currentTime = 0.1; } }}>
      <button className="asset-thumb checker" onClick={onOpen} aria-label={`Open ${name}`}>
        {a.kind === "image" && <img src={a.url} alt="" loading="lazy" />}
        {a.kind === "video" && <video ref={vref} src={`${a.url}#t=0.1`} muted loop playsInline preload="metadata" />}
        {a.kind === "audio" && <div className="asset-audio"><IconMusic size={16} /><Wave seed={name} />{a.duration != null && <span>{fmtDuration(a.duration)}</span>}</div>}
        {(a.kind === "lottie" || a.kind === "font" || a.kind === "other") && <div className="asset-audio"><IconFile size={16} /><span>{a.kind}</span></div>}
        {isLogo(a) && <span className="asset-badge mono">LOGO</span>}
        {a.kind === "video" && a.duration != null && <span className="asset-badge right mono">{fmtDuration(a.duration)}</span>}
      </button>
      <div className="asset-info">
        <span className="asset-name" title={a.path}>{name}</span>
        <span className="asset-sub mono">
          {a.width && a.height ? `${a.width}×${a.height} · ` : ""}{fmtBytes(a.sizeBytes)}
        </span>
        {!!a.palette?.length && <span className="swatches">{a.palette.slice(0, 6).map((c) => <i key={c} style={{ background: c }} title={c} />)}</span>}
      </div>
      <div className="asset-actions">
        <button className="icon-btn xs" onClick={onMention} title="Mention in brief" aria-label="Mention in brief"><IconAt size={14} /></button>
        <button className="icon-btn xs danger-hover" onClick={onDelete} title="Delete" aria-label="Delete"><IconTrash size={14} /></button>
      </div>
    </div>
  );
};

const Wave = ({ seed }: { seed: string }) => {
  let h = 7;
  const bars = Array.from({ length: 22 }, (_, i) => { h = (h * 31 + seed.charCodeAt(i % seed.length)) % 997; return 0.25 + ((h % 100) / 100) * 0.75; });
  return <span className="wave">{bars.map((b, i) => <i key={i} style={{ transform: `scaleY(${b})` }} />)}</span>;
};

const LogoDrawer = ({ a, onClose, onMention }: { a: Asset; onClose: () => void; onMention: () => void }) => {
  const { id } = useStudio();
  const [data, setData] = useState<{ summary: LogoSummary; partMapUrl?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null); setErr(null);
    api.logo(id, a.path).then((d) => alive && setData(d)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [id, a.path]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const s = data?.summary;
  const modes = s?.suggestedModes ?? [];
  const maxScore = Math.max(1e-6, ...modes.map((m) => m.score ?? 0));
  const palette = (s?.palette ?? []).map((p) => (typeof p === "string" ? { hex: p } : p)).filter((p) => typeof p?.hex === "string");
  return (
    <div className="drawer" role="dialog" aria-label="Logo details">
      <div className="drawer-head">
        <div>
          <div className="drawer-title">{basename(a.path)}</div>
          <div className="drawer-sub mono">SVG LOGO · {fmtBytes(a.sizeBytes)}</div>
        </div>
        <button className="icon-btn ghost sm" onClick={onClose} aria-label="Close"><IconClose size={14} /></button>
      </div>
      <div className="drawer-body">
        <div className="logo-hero checker"><img src={a.url} alt="" /></div>
        {err && <div className="callout error">{err}</div>}
        {!data && !err && <><Skeleton h={120} /><Skeleton h={14} w="70%" /><Skeleton h={14} w="50%" /></>}
        {data?.partMapUrl && (
          <figure className="partmap">
            <img src={data.partMapUrl} alt="Part map" />
            <figcaption className="dim small">Part map — each numbered island animates on its own.</figcaption>
          </figure>
        )}
        {s && (
          <>
            <div className="stat-grid">
              <div><b className="mono">{s.parts ?? "–"}</b><span className="label">Parts</span></div>
              <div><b className="mono">{s.groups?.icon?.length ?? 0}</b><span className="label">Icon</span></div>
              <div><b className="mono">{s.groups?.wordmark?.length ?? 0}</b><span className="label">Wordmark</span></div>
              <div><b className="mono">{s.holes?.length ?? 0}</b><span className="label">Holes</span></div>
            </div>
            {!!palette.length && (
              <div className="drawer-section">
                <div className="label">Palette</div>
                <div className="palette-row">
                  {palette.map((c) => (
                    <button key={c.hex} className="palette-chip" onClick={() => navigator.clipboard?.writeText(c.hex)}
                      title={`Copy${c.weight != null ? ` · ${Math.round(c.weight * 100)}% of the logo` : ""}`}>
                      <i style={{ background: c.hex }} />{c.hex}{c.role && <em>{c.role}</em>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!!modes.length && (
              <div className="drawer-section">
                <div className="label">Suggested reveals</div>
                <div className="modes">
                  {modes.map((m, i) => (
                    <div key={m.mode + i} className="mode">
                      <div className="mode-head">
                        <code>{m.mode}</code>
                        {m.parts && <span className="tag">{m.parts}</span>}
                        {m.order && <span className="tag">{m.order}</span>}
                        <span className="mode-score"><span style={{ transform: `scaleX(${(m.score ?? 0) / maxScore})` }} /></span>
                      </div>
                      {m.why && <p>{m.why}</p>}
                    </div>
                  ))}
                </div>
                {s.secondaryBeat && (
                  <div className="mode secondary">
                    <div className="mode-head"><span className="tag">THEN</span><code>{s.secondaryBeat.mode}</code>{s.secondaryBeat.parts && <span className="tag">{s.secondaryBeat.parts}</span>}{s.secondaryBeat.order && <span className="tag">{s.secondaryBeat.order}</span>}</div>
                    {s.secondaryBeat.why && <p>{s.secondaryBeat.why}</p>}
                  </div>
                )}
              </div>
            )}
            {!!s.warnings?.length && s.warnings.map((w, i) => <div key={i} className="callout warn">{w}</div>)}
          </>
        )}
      </div>
      <div className="drawer-foot">
        <button className="btn block" onClick={onMention}><IconAt size={14} />Use in brief</button>
      </div>
    </div>
  );
};
