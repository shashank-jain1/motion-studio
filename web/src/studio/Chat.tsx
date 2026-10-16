import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, chatUrl, postSSE, type ChatEvent, type UiMessage, type UiPart } from "../api";
import { useStudio } from "./context";
import { useToast } from "../components/Toast";
import { Markdown } from "../lib/markdown";
import { Dialog, Lightbox } from "../components/ui";
import {
  IconAlert, IconArrowUp, IconBrain, IconKey, IconCheck, IconChevron, IconCode, IconEraser, IconFilm, IconImage, IconMusic,
  IconPaperclip, IconSparkle, IconStop, IconUpload, IconWand, Logo, Spinner,
} from "../components/Icons";

/** Local message model: the server's UiMessage plus live-run state. */
type LivePart = UiPart & { id?: string; running?: boolean };
type LiveMessage = Omit<UiMessage, "parts"> & { parts: (LivePart | { type: "error"; text: string })[]; status?: string; live?: boolean };

const SUGGESTIONS = [
  { icon: <IconFilm size={15} />, title: "15s launch Reel", text: "Make a 15s vertical Reel launching our app — logo attached. Punchy hook, show 3 features, end on the logo lockup." },
  { icon: <IconWand size={15} />, title: "Kinetic-type hype edit", text: "Kinetic-type hype edit for our Friday drop: bold display type slamming on the beat, neon palette, 10 seconds." },
  { icon: <IconSparkle size={15} />, title: "Logo reveal sting", text: "A 5-second premium logo reveal for our brand: the icon draws itself, then the wordmark cascades in. Calm and expensive." },
  { icon: <IconMusic size={15} />, title: "Beat-synced promo", text: "Cut a 20s product promo synced to the music track I uploaded — every scene change on a downbeat, energy builds to the CTA." },
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
      case "tool_start": patchLast((m) => ({ ...m, parts: [...m.parts, { type: "tool", id: ev.id, name: ev.name, summary: ev.summary, running: true }] })); break;
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
      { id: `local-a-${Date.now()}`, role: "assistant", createdAt: now, parts: [], status: "Thinking…", live: true },
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
  return (
    <div className="chat">
      <div className="pane-head">
        <span className="panel-title"><IconSparkle size={13} />Director</span>
        {running && <span className="live-pill"><i />Live</span>}
        <div className="spacer" />
        {!!messages?.length && (
          <button className="icon-btn ghost sm" onClick={() => setConfirmClear(true)} disabled={running} aria-label="Clear conversation" title="Clear conversation"><IconEraser size={14} /></button>
        )}
      </div>

      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {!messages && (
          <div className="chat-skeleton">
            {[70, 90, 55].map((w, i) => <div key={i} className={`skeleton bubble-sk ${i % 2 ? "right" : ""}`} style={{ width: `${w}%` }} />)}
          </div>
        )}
        {empty && (
          <div className="chat-empty">
            <div className="chat-empty-mark"><Logo size={40} /><span className="ring" /><span className="ring r2" /></div>
            <h3>What are we making?</h3>
            <p className="muted">Describe the feeling, the length and the format. The director writes the scenes, previews its own frames and fixes what looks off.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((sg, i) => (
                <button key={sg.title} className="suggestion" style={{ animationDelay: `${120 + i * 60}ms` }} onClick={() => { setInput(sg.text); taRef.current?.focus(); }}>
                  <span className="suggestion-icon">{sg.icon}</span>
                  <span className="suggestion-text"><strong>{sg.title}</strong><span>{sg.text}</span></span>
                </button>
              ))}
            </div>
            <button className="hint-row" onClick={openUploader}>
              <IconUpload size={14} />
              <span><strong>Tip:</strong> upload your logo, screenshots or music first — the director builds around real assets.</span>
            </button>
          </div>
        )}
        {messages?.map((m) => (
          <Message key={m.id} m={m} onImage={(images, index) => setLightbox({ images, index })} onSettings={openSettings} />
        ))}
        {watching && (
          <div className="watching">
            <Spinner size={13} />
            <span><span className="shimmer-text">The director is still working…</span><em>Updates appear here every few seconds.</em></span>
          </div>
        )}
      </div>

      {noKey && (
        <div className="nokey">
          <span className="nokey-icon"><IconKey size={15} /></span>
          <div className="nokey-text">
            <strong>Connect the director</strong>
            <span>Add your Anthropic API key to start chatting. Player, timeline, spec, assets and renders all work without one.</span>
          </div>
          <button className="btn sm primary" onClick={openSettings}>Add key</button>
        </div>
      )}
      <div className={`composer ${running ? "is-running" : ""}`}>
        <div className="composer-box">
          <textarea ref={taRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
            placeholder={running ? "The director is working…" : noKey ? "Add an API key in Settings to brief the director…" : "Describe a video, or ask for a change…"} aria-label="Message the director" />
          <div className="composer-actions">
            <button className="icon-btn ghost sm" onClick={openUploader} aria-label="Attach assets" title="Upload assets"><IconPaperclip size={15} /></button>
            <span className="composer-hint"><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline</span>
            {running ? (
              <button className="send-btn stop" onClick={stop} disabled={stopping} aria-label="Stop" title="Stop the director">
                {stopping ? <Spinner size={13} /> : <IconStop size={12} />}
              </button>
            ) : (
              <button className="send-btn" onClick={() => send(input)} disabled={!input.trim() || noKey} aria-label="Send"><IconArrowUp size={15} /></button>
            )}
          </div>
        </div>
      </div>

      {lightbox && (
        <Lightbox images={lightbox.images.map((u, i) => ({ url: u, label: `Preview ${i + 1}` }))} index={lightbox.index}
          onClose={() => setLightbox(null)} onIndex={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))} />
      )}
      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear conversation?" width={400}
        subtitle="The director forgets this thread. Your spec, assets and renders stay."
        footer={<><button className="btn ghost" onClick={() => setConfirmClear(false)}>Cancel</button><button className="btn danger" data-autofocus onClick={clear}>Clear</button></>}>
        <></>
      </Dialog>
    </div>
  );
};

const Message = memo(({ m, onImage, onSettings }: { m: LiveMessage; onImage: (images: string[], i: number) => void; onSettings: () => void }) => {
  if (m.role === "user") {
    const text = m.parts.map((p) => ("text" in p ? p.text : "")).join("\n");
    return <div className="msg msg-user"><div className="bubble">{renderMentions(text)}</div></div>;
  }
  const allImages = m.parts.flatMap((p) => (p.type === "tool" ? p.images ?? [] : []));
  const lastIdx = m.parts.length - 1;
  const hasText = m.parts.some((p) => p.type === "text" && p.text.trim());
  return (
    <div className={`msg msg-assistant ${m.live ? "is-live" : ""}`}>
      <div className="msg-avatar"><Logo size={22} /></div>
      <div className="msg-body">
        {m.parts.map((p, i) => {
          if (p.type === "text") return <Markdown key={i} text={p.text} className={m.live && i === lastIdx ? "is-streaming" : ""} />;
          if (p.type === "thinking") return <Thinking key={i} text={p.text} live={!!m.live && i === lastIdx} />;
          if (p.type === "tool") {
            const lp = p as LivePart & { type: "tool" };
            return <ToolChip key={i} p={lp} onImage={(url) => onImage(allImages, Math.max(0, allImages.indexOf(url)))} />;
          }
          return (
            <div key={i} className="msg-error"><IconAlert size={13} /><span>{p.text}</span>
              {/api key|settings/i.test(p.text) && <button className="btn xs" onClick={onSettings}>Open Settings</button>}
            </div>
          );
        })}
        {m.live && m.status && (!hasText || m.parts[lastIdx]?.type !== "text") && <div className="status-line"><span className="shimmer-text">{m.status}</span></div>}
        {m.live && !m.parts.length && !m.status && <div className="typing"><i /><i /><i /></div>}
      </div>
    </div>
  );
});

const renderMentions = (text: string) =>
  text.split(/(@assets\/[^\s,;]+)/g).map((seg, i) => (seg.startsWith("@assets/") ? <span key={i} className="mention">{seg}</span> : seg));

const Thinking = ({ text, live }: { text: string; live: boolean }) => {
  const [open, setOpen] = useState(false);
  const lines = text.trim().split("\n").filter(Boolean);
  const preview = lines[lines.length - 1] ?? "";
  return (
    <div className={`thinking ${open ? "is-open" : ""} ${live ? "is-live" : ""}`}>
      <button className="thinking-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <IconBrain size={13} />
        <span className={live ? "shimmer-text" : ""}>{live ? "Thinking" : "Thought process"}</span>
        {!open && <span className="thinking-preview">{preview}</span>}
        <IconChevron size={12} className="chev" />
      </button>
      {open && <div className="thinking-body"><Markdown text={text} /></div>}
    </div>
  );
};

const TOOL_ICON: Record<string, React.ReactNode> = {
  set_spec: <IconCode size={12} />, update_scene: <IconCode size={12} />, get_spec: <IconCode size={12} />,
  preview_frames: <IconImage size={12} />, render_video: <IconFilm size={12} />, analyze_audio: <IconMusic size={12} />,
  analyze_logo: <IconSparkle size={12} />, write_custom_component: <IconWand size={12} />,
};

const ToolChip = ({ p, onImage }: { p: LivePart & { type: "tool" }; onImage: (url: string) => void }) => (
  <div className="tool">
    <div className={`tool-chip ${p.running ? "is-running" : p.ok === false ? "is-error" : "is-ok"}`} title={p.name}>
      <span className="tool-state">{p.running ? <Spinner size={12} /> : p.ok === false ? <IconAlert size={12} /> : <IconCheck size={12} />}</span>
      <span className="tool-icon">{TOOL_ICON[p.name] ?? <IconWand size={12} />}</span>
      <span className="tool-summary">{p.summary || p.name}</span>
    </div>
    {!!p.images?.length && (
      <div className="tool-images">
        {p.images.map((u, i) => (
          <button key={u + i} className="tool-thumb" onClick={() => onImage(u)} style={{ animationDelay: `${i * 70}ms` }} aria-label={`Open preview ${i + 1}`}>
            <img src={u} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    )}
  </div>
);
