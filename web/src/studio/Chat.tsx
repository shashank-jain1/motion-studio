import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, chatUrl, postSSE, type ChatEvent, type UiMessage, type UiPart } from "../api";
import { useStudio } from "./context";
import { useToast } from "../components/Toast";
import { Markdown } from "../lib/markdown";
import { Dialog, Lightbox, SlateStripe, TallyDot } from "../components/ui";
import { IconAlert, IconCheck, IconChevron, IconClose, IconEraser, IconKey, IconPaperclip, IconReturn, IconStop, Spinner } from "../components/Icons";
import { Treatment } from "./Treatment";
import { fmtClock, fmtDate, RES } from "../lib/format";

/** Local message model: the server's UiMessage plus live-run state. */
type LivePart = UiPart & { id?: string; running?: boolean; at?: number };
type LiveMessage = Omit<UiMessage, "parts"> & { parts: (LivePart | { type: "error"; text: string })[]; status?: string; live?: boolean; startedAt?: number };

/** Producer's notes: terse, specific, the way a brief arrives on a call sheet. */
const TEMPLATES = [
  { slug: "LAUNCH", meta: "15S · 9:16", text: "Launch reel for our app, 15s vertical. Hook inside the first second, three features in one beat each, end on the logo lockup held 2s. Logo attached." },
  { slug: "LOGO STING", meta: "5S · ANY", text: "5s logo sting. The icon draws itself on, the wordmark cascades in after. Calm, expensive, lots of air. No music." },
  { slug: "BEAT CUT", meta: "20S · 16:9", text: "20s promo cut to the track I uploaded. Every scene change on a downbeat, energy builds into the CTA. Keep type big and few words." },
];

const toLive = (m: UiMessage): LiveMessage => ({ ...m, parts: m.parts.map((p) => ({ ...p })) });

export const ChatPanel = () => {
  const s = useStudio();
  const { id, setChatRunning, applyServerSpec, addRender, refreshSide, registerChatInsert, openUploader, settings, openSettings } = s;
  const noKey = !!settings && !settings.hasApiKey;
  const toast = useToast();
  const [messages, setMessages] = useState<LiveMessage[] | null>(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  /** A run is in flight that this tab isn't streaming (started elsewhere / before reload): poll GET /chat. */
  const [watching, setWatching] = useState(false);
  const watchingRef = useRef(false);
  watchingRef.current = watching;
  const [input, setInput] = useState("");
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useEffect(() => { setChatRunning(running); }, [running, setChatRunning]);

  // initial history
  useEffect(() => {
    let alive = true;
    api.chat(id).then((r) => {
      if (!alive || abortRef.current) return;
      setMessages(r.messages.map(toLive));
      setRunning(r.running);
      setWatching(r.running);
    }).catch((e) => { if (alive) { setMessages((m) => m ?? []); toast.error("Couldn't load chat", e.message); } });
    return () => { alive = false; abortRef.current?.abort(); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // runs are single-shot streams: when one is in flight but not ours, poll every 2s until it finishes
  useEffect(() => {
    if (!watching) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tickPoll = () => api.chat(id).then(async (r) => {
      if (!alive) return;
      setMessages(r.messages.map(toLive));
      if (r.running) { timer = setTimeout(tickPoll, 2000); return; }
      setWatching(false); setRunning(false); setStopping(false);
      refreshSide();
      try { const st = await api.project(id); if (st.spec) applyServerSpec(st.spec, st.timeline); } catch { /* ignore */ }
    }).catch(() => { if (alive) timer = setTimeout(tickPoll, 3000); });
    timer = setTimeout(tickPoll, 2000);
    return () => { alive = false; clearTimeout(timer); };
  }, [watching, id, refreshSide, applyServerSpec]);

  // mention insertion from Assets panel
  useEffect(() => registerChatInsert((text) => {
    setInput((v) => (v && !/\s$/.test(v) ? v + " " : v) + text);
    setTimeout(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0);
  }), [registerChatInsert]);

  // autoscroll when near the bottom
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current && messages?.length) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onScroll = () => {
    const el = listRef.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // autosize textarea
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(220, ta.scrollHeight) + "px";
  }, [input]);

  const patchLast = useCallback((fn: (m: LiveMessage) => LiveMessage) => {
    setMessages((ms) => {
      if (!ms?.length) return ms;
      const last = ms[ms.length - 1];
      if (last.role !== "assistant" || !last.live) return ms;
      return [...ms.slice(0, -1), fn(last)];
    });
  }, []);

  const onEvent = useCallback((ev: ChatEvent) => {
    switch (ev.type) {
      case "status": patchLast((m) => ({ ...m, status: ev.text })); break;
      case "text":
      case "thinking": patchLast((m) => {
        const parts = [...m.parts];
        const last = parts[parts.length - 1];
        if (last && last.type === ev.type) parts[parts.length - 1] = { ...last, text: last.text + ev.delta };
        else parts.push({ type: ev.type, text: ev.delta });
        return { ...m, parts, status: ev.type === "text" ? undefined : m.status };
      }); break;
      case "tool_start": patchLast((m) => ({ ...m, parts: [...m.parts, { type: "tool", id: ev.id, name: ev.name, summary: ev.summary, running: true, at: Date.now() - (m.startedAt ?? Date.now()) }] })); break;
      case "tool_end": patchLast((m) => ({
        ...m,
        parts: m.parts.map((p) => (p.type === "tool" && (p as LivePart).id === ev.id ? { ...p, running: false, ok: ev.ok, summary: ev.summary || (p as { summary: string }).summary, images: ev.images } : p)),
      })); break;
      case "spec": applyServerSpec(ev.spec, ev.timeline); break;
      case "render": addRender(ev.render); toast.success("Render ready", `${ev.render.quality} · ${ev.render.file.split("/").pop()}`); break;
      case "error": patchLast((m) => ({ ...m, parts: [...m.parts, { type: "error", text: ev.message }] })); break;
      case "done": break;
    }
  }, [patchLast, applyServerSpec, addRender, toast]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || running) return;
    if (noKey) { openSettings(); return; }
    const now = new Date().toISOString();
    stick.current = true;
    setInput("");
    setMessages((ms) => [...(ms ?? []),
      { id: `local-u-${Date.now()}`, role: "user", createdAt: now, parts: [{ type: "text", text: msg }] },
      { id: `local-a-${Date.now()}`, role: "assistant", createdAt: now, parts: [], status: "Thinking…", live: true, startedAt: Date.now() },
    ]);
    setRunning(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      await postSSE(chatUrl(id), { message: msg }, (event, data) => {
        const ev = (data && typeof data === "object" && "type" in data ? data : { ...(data as object), type: event }) as ChatEvent;
        onEvent(ev);
      }, ctl.signal);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // already running (another tab/session): drop the optimistic pair and follow it by polling
        setMessages((ms) => ms?.filter((m) => !m.id.startsWith("local-")) ?? ms);
        watchingRef.current = true;
        setWatching(true);
        toast.info("The director is already working on this project", "Following along…");
        return;
      } else if ((e as Error).name !== "AbortError") {
        patchLast((m) => ({ ...m, parts: [...m.parts, { type: "error", text: (e as Error).message }] }));
        toast.error("Director run failed", (e as Error).message);
      }
    } finally {
      patchLast((m) => ({ ...m, live: false, status: undefined, parts: m.parts.map((p) => (p.type === "tool" && (p as LivePart).running ? { ...p, running: false } : p)) }));
      if (abortRef.current === ctl) abortRef.current = null;
      if (!watchingRef.current) { setRunning(false); setStopping(false); refreshSide(); }
    }
  };

  const stop = async () => {
    setStopping(true);
    const ctl = abortRef.current;
    try { await api.stopChat(id); } catch { /* fall through to abort */ }
    // the server ends the stream after stopping; if it doesn't, detach and follow by polling
    setTimeout(() => { if (abortRef.current === ctl && ctl) { watchingRef.current = true; setWatching(true); ctl.abort(); } }, 4000);
  };

  const clear = async () => {
    setConfirmClear(false);
    const prev = messages;
    setMessages([]);
    try { await api.clearChat(id); } catch (e) { setMessages(prev); toast.error("Couldn't clear chat", (e as Error).message); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const empty = messages && messages.length === 0;
  const briefs = messages?.filter((m) => m.role === "user").length ?? 0;
  const concept = (s.info?.spec.concept ?? null) as Record<string, unknown> | null;
  return (
    <div className="director">
      <div className="pane-head">
        <span className="label">Director</span>
        {settings && <span className="mono dim small ellipsis" title="Model · effort">{settings.model} · {settings.effort.toUpperCase()}</span>}
        {running && <span className="onair"><TallyDot />LIVE</span>}
        <span className="spacer" />
        {!!messages?.length && (
          <button className="icon-btn ghost sm" onClick={() => setConfirmClear(true)} disabled={running} aria-label="Clear the script" title="Clear the script"><IconEraser size={16} /></button>
        )}
      </div>

      <div className="script" ref={listRef} onScroll={onScroll}>
        {concept && <Treatment />}
        {!messages && (
          <div className="script-skeleton">
            {[70, 90, 55].map((w, i) => <div key={i} className="skeleton" style={{ width: `${w}%`, height: 12 }} />)}
          </div>
        )}
        {empty && (
          <div className="call-sheet">
            <div className="slate">
              <SlateStripe />
              <div className="slate-grid mono">
                <span className="label">Prod</span><span className="slate-val">{s.project.name}</span>
                <span className="label">Format</span><span className="slate-val">{s.project.format} · {RES[s.project.format]?.join("×")}</span>
                <span className="label">Date</span><span className="slate-val">{fmtDate(new Date().toISOString())}</span>
                <span className="label">Scene</span><span className="slate-val">—</span>
                <span className="label">Take</span><span className="slate-val">01</span>
              </div>
            </div>
            <p className="serif-line">What should the audience feel?</p>
            <p className="dim">Write the brief like a producer's note: length, format, the feeling, the one thing to remember. The director writes the scenes, previews its own frames and fixes what looks off.</p>
            <div className="label">Brief templates</div>
            <div className="templates">
              {TEMPLATES.map((t, i) => (
                <button key={t.slug} className="template rise" style={{ ["--i" as string]: i }} onClick={() => { setInput(t.text); taRef.current?.focus(); }}>
                  <span className="template-head mono"><span>NOTE {String(i + 1).padStart(2, "0")}</span><span>{t.slug}</span><span className="dim">{t.meta}</span></span>
                  <span className="template-text">{t.text}</span>
                </button>
              ))}
            </div>
            <button className="hint-row" onClick={openUploader}>
              <IconPaperclip size={14} />
              <span>Attach the logo, product shots or the track first — the director builds around real assets.</span>
            </button>
          </div>
        )}
        {messages?.map((m, i) => (
          <Message key={m.id} m={m} n={messages.slice(0, i + 1).filter((x) => x.role === "user").length} onImage={(images, index) => setLightbox({ images, index })} onSettings={openSettings} />
        ))}
        {watching && (
          <div className="log-line is-running">
            <Spinner size={12} />
            <span className="mono">FOLLOW</span>
            <span className="dim">The director is still working — updates every few seconds.</span>
          </div>
        )}
      </div>

      {noKey ? (
        <div className="offline">
          <SlateStripe tally />
          <div className="offline-body">
            <div className="offline-head"><IconKey size={14} /><span className="label">Director offline</span></div>
            <p>Add an Anthropic API key to brief the director. The viewer, timeline, spec, assets and renders all work without one.</p>
            <div className="row gap">
              <button className="btn primary sm" onClick={openSettings}>Add key</button>
              <span className="mono dim small">Stored server-side · never sent to the browser</span>
            </div>
          </div>
        </div>
      ) : (
        <div className={`composer ${running ? "is-running" : ""}`}>
          <div className="composer-head">
            <span className="label">Brief {String(briefs + 1).padStart(2, "0")}</span>
            <span className="spacer" />
            <span className="mono dim small">↵ send · ⇧↵ newline · @ asset</span>
          </div>
          <div className="composer-box">
            <span className="composer-caret mono" aria-hidden>›</span>
            <textarea ref={taRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
              placeholder={running ? "The director is working…" : "15s vertical launch. Warm, confident. End on the logo."} aria-label="Brief the director" />
          </div>
          <div className="composer-actions">
            <button className="btn ghost xs" onClick={openUploader} title="Upload assets"><IconPaperclip size={14} />Attach</button>
            <span className="spacer" />
            {running ? (
              <button className="btn sm stop-btn" onClick={stop} disabled={stopping} aria-label="Stop the director">
                {stopping ? <Spinner size={12} /> : <IconStop size={12} />}Stop
              </button>
            ) : (
              <button className="btn primary sm" onClick={() => send(input)} disabled={!input.trim()} aria-label="Send brief"><IconReturn size={14} />Send</button>
            )}
          </div>
        </div>
      )}

      {lightbox && (
        <Lightbox images={lightbox.images.map((u, i) => ({ url: u, label: `${String(i + 1).padStart(2, "0")}` }))} index={lightbox.index}
          onClose={() => setLightbox(null)} onIndex={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))} />
      )}
      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear the script?" label="Director" width={420}
        subtitle="The director forgets this thread. Your spec, assets and renders stay."
        footer={<><button className="btn ghost" onClick={() => setConfirmClear(false)}>Cancel</button><button className="btn danger" data-autofocus onClick={clear}>Clear</button></>}>
        <></>
      </Dialog>
    </div>
  );
};

const clock = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "--:--" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const Message = memo(({ m, n, onImage, onSettings }: { m: LiveMessage; n: number; onImage: (images: string[], i: number) => void; onSettings: () => void }) => {
  if (m.role === "user") {
    const text = m.parts.map((p) => ("text" in p ? p.text : "")).join("\n");
    return (
      <div className="beat brief">
        <div className="slug mono"><span>BRIEF {String(n).padStart(2, "0")}</span><span className="dim">{clock(m.createdAt)}</span></div>
        <div className="brief-text">{renderMentions(text)}</div>
      </div>
    );
  }
  const allImages = m.parts.flatMap((p) => (p.type === "tool" ? p.images ?? [] : []));
  const lastIdx = m.parts.length - 1;
  const hasText = m.parts.some((p) => p.type === "text" && p.text.trim());
  return (
    <div className={`beat reply ${m.live ? "is-live" : ""}`}>
      <div className="cue mono">DIRECTOR</div>
      {m.parts.map((p, i) => {
        if (p.type === "text") return <Markdown key={i} text={p.text} className={`dialogue ${m.live && i === lastIdx ? "is-streaming" : ""}`} />;
        if (p.type === "thinking") return <Thinking key={i} text={p.text} live={!!m.live && i === lastIdx} />;
        if (p.type === "tool") {
          const lp = p as LivePart & { type: "tool" };
          return <LogLine key={i} p={lp} fallbackClock={clock(m.createdAt)} onImage={(url) => onImage(allImages, Math.max(0, allImages.indexOf(url)))} />;
        }
        return (
          <div key={i} className="log-line is-error" role="alert">
            <span className="mono">FAULT</span><span>{p.text}</span>
            {/api key|settings/i.test(p.text) && <button className="btn xs" onClick={onSettings}>Open settings</button>}
          </div>
        );
      })}
      {m.live && m.status && (!hasText || m.parts[lastIdx]?.type !== "text") && (
        <div className="log-line is-running"><Spinner size={12} /><span className="mono">{m.status.replace(/…$/, "").toUpperCase()}</span></div>
      )}
      {m.live && !m.parts.length && !m.status && <div className="log-line is-running"><Spinner size={12} /><span className="mono">STANDBY</span></div>}
    </div>
  );
});

const renderMentions = (text: string) =>
  text.split(/(@assets\/[^\s,;]+)/g).map((seg, i) => (seg.startsWith("@assets/") ? <span key={i} className="mention mono">{seg}</span> : seg));

/** Reasoning as a screenplay parenthetical — collapsed to its last line. */
const Thinking = ({ text, live }: { text: string; live: boolean }) => {
  const [open, setOpen] = useState(false);
  const lines = text.trim().split("\n").filter(Boolean);
  const preview = lines[lines.length - 1] ?? "";
  return (
    <div className={`paren ${open ? "is-open" : ""} ${live ? "is-live" : ""}`}>
      <button className="paren-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <IconChevron size={12} className="chev" />
        <span className="paren-text">({live ? "thinking" : "considers"}{!open && preview ? <>: <em>{preview}</em></> : null})</span>
      </button>
      {open && <div className="paren-body"><Markdown text={text} /></div>}
    </div>
  );
};

/** Terse tool log: `00:41  SET_SPEC  5 scenes · 14.2s  ✓` + previews as a perforated contact strip. */
const LogLine = ({ p, fallbackClock, onImage }: { p: LivePart & { type: "tool" }; fallbackClock: string; onImage: (url: string) => void }) => (
  <div className="log">
    <div className={`log-line ${p.running ? "is-running" : p.ok === false ? "is-error" : "is-ok"}`} title={p.name}>
      <span className="mono log-tc">{p.at != null ? fmtClock(p.at) : fallbackClock}</span>
      <span className="mono log-name">{p.name.toUpperCase()}</span>
      <span className="log-summary">{p.summary || p.name}</span>
      <span className="log-state">{p.running ? <Spinner size={12} /> : p.ok === false ? <IconClose size={12} /> : <IconCheck size={12} />}</span>
    </div>
    {!!p.images?.length && (
      <div className="contact perf">
        {p.images.map((u, i) => (
          <button key={u + i} className="strip-frame" onClick={() => onImage(u)} aria-label={`Open preview frame ${i + 1}`}>
            <img src={u} alt="" loading="lazy" />
            <span>{String(i + 1).padStart(2, "0")}</span>
          </button>
        ))}
      </div>
    )}
  </div>
);
