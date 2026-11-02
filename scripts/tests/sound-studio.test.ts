/**
 * Voice, music, captions and cinematic SFX (Phase 7). Run: npx tsx scripts/tests/sound-studio.test.ts
 * Gemini is exercised against a mocked API (request shapes from the official docs); local voices, the composer, the
 * engine's ducking/captions and a real render are exercised for real. Throwaway projects/config dirs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-sound-"));
process.env.MOTION_STUDIO_PROJECTS = path.join(tmp, "projects");
process.env.MOTION_STUDIO_CONFIG_DIR = path.join(tmp, "config");
delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;

const gemini = await import("../../src/core/gemini");
const voice = await import("../../src/core/voice");
const { composeScore, scoreWav, MOODS, fitTempo, parseKey } = await import("../../src/core/music");
const { decodeWav, makeBuf, encodeWav, SR } = await import("../../src/engine/audio/dsp");
const { SpecSchema } = await import("../../src/engine/spec/schema");
const { preprocessSpec } = await import("../../src/engine/spec/preprocess");
const { speechSpans, voiceDuckGain } = await import("../../src/engine/audio/SoundTrack");
const { filmCaptionWords } = await import("../../src/engine/render/FilmCaptions");
const { SFX } = await import("../../src/engine/audio/library");
const { createProject, writeSpec, readSpec, listSpecVersions } = await import("../../src/core/projects");
const { callTool } = await import("../../src/core/tools");
const { measureLoudness } = await import("../../src/core/audioMaster");
const { runMediaTool } = await import("../../src/core/mediaTool");

let passed = 0;
const test = async (name: string, fn: () => unknown) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n${(e as Error).stack}`); process.exitCode = 1; }
};
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("\n");

/** A 24 kHz mono 16-bit WAV of "speech-like" bursts (what Gemini TTS returns). */
const fakeSpeechWav = (secs = 2.4) => {
  const b = makeBuf(secs);
  for (let i = 0; i < b.n; i++) { const t = i / SR; const on = (t % 0.8) < 0.55 ? 1 : 0; b.L[i] = b.R[i] = on * 0.3 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)); }
  const stereo48 = Buffer.from(encodeWav(b));
  // downmix to 24 kHz mono PCM (every 2nd frame, left channel)
  const pcm = Buffer.alloc(Math.floor(b.n / 2) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(stereo48.readInt16LE(44 + i * 2 * 4), i * 2);
  return gemini.pcm16Wav(pcm, 24000, 1);
};

type Call = { url: string; init: RequestInit };
const mock = (respond: (c: Call, n: number) => Response) => {
  const calls: Call[] = [];
  gemini.setFetch((async (url: string | URL, init?: RequestInit) => { const c = { url: String(url), init: init ?? {} }; calls.push(c); return respond(c, calls.length); }) as typeof fetch);
  return calls;
};
const jsonRes = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
const body = (c: Call) => JSON.parse(String(c.init.body));

try {
  // ------------------------------------------------------------------ gemini client
  await test("no key → clear message; key from env or config file", () => {
    assert.equal(gemini.geminiKey(), null);
    fs.mkdirSync(process.env.MOTION_STUDIO_CONFIG_DIR!, { recursive: true });
    fs.writeFileSync(path.join(process.env.MOTION_STUDIO_CONFIG_DIR!, "config.json"), JSON.stringify({ geminiApiKey: "cfg-key-0123456789abcdef" }));
    assert.equal(gemini.geminiKey(), "cfg-key-0123456789abcdef");
    process.env.GEMINI_API_KEY = "env-key-0123456789abcdef";
    assert.equal(gemini.geminiKey(), "env-key-0123456789abcdef");
  });

  await test("TTS: documented Interactions request; WAV returned; style + voice", async () => {
    const wav = fakeSpeechWav();
    const calls = mock(() => jsonRes({ status: "completed", steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/wav", data: wav.toString("base64") }] }] }));
    const out = await gemini.geminiSpeech({ text: "Have a wonderful day!", voice: "Puck", style: "cheerful and friendly" });
    assert.equal(out.subarray(0, 4).toString(), "RIFF");
    const c = calls[0];
    assert.equal(c.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    assert.equal((c.init.headers as Record<string, string>)["x-goog-api-key"], "env-key-0123456789abcdef");
    assert.deepEqual(body(c), {
      model: "gemini-3.8-flash-tts",
      input: [{ type: "user_input", content: [{ type: "text", text: "Have a wonderful day!", annotations: [{ type: "speech_metadata", style: "cheerful and friendly" }] }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Puck" }] },
    });
  });

  await test("TTS: two-speaker dialogue shape; raw L16 is wrapped; unknown voice rejected", async () => {
    const pcm = Buffer.alloc(4800);
    const calls = mock(() => jsonRes({ steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/l16", data: pcm.toString("base64") }] }] }));
    const out = await gemini.geminiSpeech({ text: "", dialogue: [{ speaker: "Joe", text: "Hi Jane?", style: "cheerful" }, { speaker: "Jane", text: "Hey." }], speakers: { Joe: "Puck", Jane: "Kore" } });
    assert.equal(out.subarray(0, 4).toString(), "RIFF");
    assert.equal(out.readUInt32LE(24), 24000);
    const b = body(calls[0]);
    assert.deepEqual(b.generation_config.speech_config, { speakers: [{ speaker: "Joe", voice: "Puck" }, { speaker: "Jane", voice: "Kore" }] });
    assert.equal(b.input[0].content[1].annotations[0].speaker, "Jane");
    await assert.rejects(gemini.geminiSpeech({ text: "x", voice: "Nobody" }), /Unknown Gemini voice "Nobody"/);
  });

  await test("errors: 429 explains the free-tier limit, 403 the key", async () => {
    mock(() => jsonRes({ error: { message: "Resource exhausted" } }, 429));
    await assert.rejects(gemini.geminiSpeech({ text: "hi" }), /free-tier limit was reached \(HTTP 429\)/);
    mock(() => jsonRes({ error: { message: "API key not valid" } }, 403));
    await assert.rejects(gemini.geminiSpeech({ text: "hi" }), /API key was rejected/);
  });

  await test("transcribe: verbatim + word timestamps request; word_info offsets parsed", async () => {
    const calls = mock(() => jsonRes({ steps: [{ type: "model_output", content: [{ type: "text", text: "Hello world", annotations: [
      { type: "word_info", text: "Hello", speaker: "spk_1", start_offset: "0.100s", end_offset: "0.400s" },
      { type: "word_info", text: "world", start_offset: "0.500s", end_offset: "0.800s" },
    ] }] }] }));
    const r = await gemini.geminiTranscribe(Buffer.from("RIFFfake"), "audio/wav", { languages: ["en-US"] });
    assert.deepEqual(r.words, [{ text: "Hello", start: 0.1, end: 0.4, speaker: "spk_1" }, { text: "world", start: 0.5, end: 0.8 }]);
    const b = body(calls[0]);
    assert.equal(b.model, "gemini-3.5-transcribe");
    assert.equal(b.input[0].type, "audio");
    assert.equal(b.input[0].mime_type, "audio/wav");
    assert.deepEqual(b.generation_config.transcription_config, { language_codes: ["en-US"], mode: { type: "verbatim", timestamp_granularities: ["word"] } });
  });

  await test("transcribe: large audio goes through the resumable Files API (and waits for ACTIVE)", async () => {
    const calls = mock((c, n) => {
      if (n === 1) return new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://upload.example/session" } });
      if (n === 2) return jsonRes({ file: { name: "files/abc", uri: "https://files/abc", state: "PROCESSING" } });
      if (n === 3) return jsonRes({ name: "files/abc", uri: "https://files/abc", state: "ACTIVE" });
      return jsonRes({ steps: [{ type: "model_output", content: [{ type: "text", text: "ok", annotations: [{ type: "word_info", text: "ok", start_offset: "1s", end_offset: "1.2s" }] }] }] });
    });
    const r = await gemini.geminiTranscribe(Buffer.alloc(15 * 1024 * 1024), "audio/wav");
    assert.equal(r.words[0].start, 1);
    assert.equal((calls[0].init.headers as Record<string, string>)["X-Goog-Upload-Protocol"], "resumable");
    assert.equal((calls[1].init.headers as Record<string, string>)["X-Goog-Upload-Command"], "upload, finalize");
    assert.equal(calls[1].url, "https://upload.example/session");
    assert.equal(body(calls[3]).input[0].uri, "https://files/abc");
  });

  // ------------------------------------------------------------------ voice
  await test("script helpers: tags never spoken; alignment keeps script spelling and interpolates", () => {
    assert.equal(voice.spokenText("Wait... <short pause> look! <laugh> Wow"), "Wait... look! Wow");
    const heard = [{ text: "brew", start: 0, end: 0.3 }, { text: "delivers", start: 0.35, end: 0.8 }, { text: "fresh", start: 0.85, end: 1.1 }, { text: "beans", start: 1.4, end: 1.8 }];
    const a = voice.alignScript("Brew delivers fresh, roasted beans.", heard);
    assert.deepEqual(a.map((w) => w.text), ["Brew", "delivers", "fresh,", "roasted", "beans."]);
    assert.equal(a[0].start, 0);
    assert.ok(a[3].start >= a[2].end - 1e-6 && a[3].end <= a[4].start + 1e-6, JSON.stringify(a));
  });

  await test("Gemini voice end to end (mocked): normalized 48 kHz file + Gemini word timing", async () => {
    const wav = fakeSpeechWav(2.4);
    mock((c) => body(c).model === "gemini-3.5-transcribe"
      ? jsonRes({ steps: [{ type: "model_output", content: [{ type: "text", text: "a b c", annotations: ["Mornings", "are", "hard."].map((w, i) => ({ type: "word_info", text: w, start_offset: `${i * 0.8}s`, end_offset: `${i * 0.8 + 0.5}s` })) }] }] })
      : jsonRes({ steps: [{ type: "model_output", content: [{ type: "audio", data: wav.toString("base64") }] }] }));
    const out = path.join(tmp, "g.wav");
    const r = await voice.synthesizeVoice({ text: "Mornings are hard.", provider: "gemini", voice: "Kore" }, out);
    assert.equal(r.provider, "gemini");
    const b = decodeWav(fs.readFileSync(out));
    assert.ok(Math.abs(b.n / SR - r.seconds) < 0.01);
    const t = await voice.timeWords(out, "Mornings are hard.");
    assert.equal(t.method, "gemini");
    assert.deepEqual(t.words.map((w) => w.text), ["Mornings", "are", "hard."]);
  });

  if (process.platform === "darwin") {
    await test("system voice (macOS say, real): loudness-normalized, trimmed, estimated timing is ordered and in bounds", async () => {
      delete process.env.GEMINI_API_KEY;
      fs.rmSync(path.join(process.env.MOTION_STUDIO_CONFIG_DIR!, "config.json"));
      const out = path.join(tmp, "s.wav");
      const r = await voice.synthesizeVoice({ text: "Mornings are hard. Your coffee shouldn't be.", provider: "auto", voice: "Samantha" }, out);
      assert.equal(r.provider, "system");
      const L = await measureLoudness(out);
      assert.ok(L && L.lufs > -24 && L.lufs < -14 && L.truePeak <= -1, JSON.stringify(L));
      const t = await voice.timeWords(out, "Mornings are hard. Your coffee shouldn't be.");
      assert.equal(t.method, "estimate");
      assert.equal(t.words.length, 7);
      t.words.forEach((w, i) => { assert.ok(w.end > w.start && w.start >= 0 && w.end <= r.seconds + 0.01); if (i) assert.ok(w.start >= t.words[i - 1].start); });
      assert.ok(t.words[3].start - t.words[2].end > 0.1, "the sentence break lands on the pause");
    });
  }

  // ------------------------------------------------------------------ music
  await test("composer: exact length, drop exactly on the peak, cuts on beats, deterministic", () => {
    const cuts = [0, 2.1, 4.3, 7.9, 10.6, 13.0];
    const a = composeScore({ seconds: 15, mood: "tech", cuts, peak: 10.6 });
    assert.equal(a.buf.n, Math.round(15 * SR));
    assert.ok(a.meta.sections.some((s) => s.name === "peak" && Math.abs(s.from - 10.6) < 1e-3), JSON.stringify(a.meta.sections));
    assert.ok(a.meta.bars.some((b) => Math.abs(b - 10.6) < 1e-3));
    const beat = 60 / a.meta.bpm;
    a.meta.beats.slice(1).forEach((b, i) => { if (a.meta.beats[i] > 0) assert.ok(Math.abs(b - a.meta.beats[i] - beat) < 2e-3); });
    assert.ok(a.meta.cutAlignmentMs <= 50, String(a.meta.cutAlignmentMs));
    const b = composeScore({ seconds: 15, mood: "tech", cuts, peak: 10.6 });
    assert.ok(Buffer.from(encodeWav(a.buf)).equals(Buffer.from(encodeWav(b.buf))), "same request, same file");
    assert.deepEqual(parseKey("F# minor"), { root: 6, minor: true });
    assert.deepEqual(parseKey("Eb"), { root: 3, minor: false });
    assert.equal(fitTempo(120, [], 0).bpm, 120);
  });

  await test("composer: every mood renders finite audio at bed level with a quieter intro than peak", async () => {
    for (const mood of MOODS) {
      const { buf, meta } = composeScore({ seconds: 9, mood, cuts: [0, 3, 6], peak: 6 });
      let bad = 0; for (let i = 0; i < buf.n; i += 7) if (!Number.isFinite(buf.L[i])) bad++;
      assert.equal(bad, 0, mood);
      const f = path.join(tmp, `m-${mood}.wav`); fs.writeFileSync(f, scoreWav(buf));
      const L = (await measureLoudness(f))!;
      assert.ok(L.lufs > -26 && L.lufs < -14 && L.truePeak < -1, `${mood} ${JSON.stringify(L)}`);
      const rms = (a: number, z: number) => { let s = 0; for (let i = Math.round(a * SR); i < Math.round(z * SR); i++) s += buf.L[i] ** 2; return s / ((z - a) * SR); };
      assert.ok(rms(0.1, 1.5) < rms(6.1, 7.5), `${mood}: intro quieter than peak`);
      assert.equal(meta.mood, mood);
    }
  });

  // ------------------------------------------------------------------ engine
  await test("schema: voiceover + film captions + duckUnderVoice validate", () => {
    const spec = { fps: 30, format: "9:16", audio: { src: "assets/m.wav", duckUnderVoice: 0.5 }, voiceover: [{ src: "assets/vo.wav", at: 0.5, words: [{ text: "Hi", start: 0, end: 0.3 }] }], captions: { style: "karaoke", position: "lower" }, scenes: [{ duration: 2, layers: [] }] };
    assert.ok(SpecSchema.safeParse(preprocessSpec(spec)).success);
    assert.ok(!SpecSchema.safeParse(preprocessSpec({ ...spec, captions: { style: "nope" } })).success);
  });

  await test("ducking: phrases merge across short gaps; music dips during speech and recovers", () => {
    const spans = speechSpans([{ src: "a", at: 1, words: [{ text: "a", start: 0, end: 0.4 }, { text: "b", start: 0.6, end: 1 }, { text: "c", start: 2.5, end: 3 }] }], 10);
    assert.deepEqual(spans, [{ from: 1, to: 2 }, { from: 3.5, to: 4 }]);
    assert.equal(voiceDuckGain(spans, 1.5, 0.6), 1 - 0.6);
    assert.equal(voiceDuckGain(spans, 0.5, 0.6), 1);
    assert.ok(voiceDuckGain(spans, 2.2, 0.6) > 0.4 && voiceDuckGain(spans, 2.2, 0.6) < 1);
    assert.equal(voiceDuckGain(spans, 1.5, 0), 1);
    const words = filmCaptionWords({ voiceover: [{ src: "a", at: 2, trimStart: 0.5, words: [{ text: "x", start: 0.2, end: 0.4 }, { text: "y", start: 0.6, end: 0.9 }] }] });
    assert.deepEqual(words.map((w) => [w.text, +w.start.toFixed(2)]), [["y", 2.1]]);
  });

  await test("new cinematic SFX are in the library with sane apex metadata", () => {
    const names = ["whoosh-whip", "whoosh-flutter", "whoosh-reverse-in", "swoosh-cinematic", "typing-burst", "typing-fast", "keyboard-enter", "rewind-tape", "recap-swoosh", "tape-stop", "reverse-cymbal",
      "light-leak-swell", "film-projector", "film-burn", "tension-drone", "braam", "downlifter", "trailer-hit-metal", "riser-tension", "camera-flash", "clock-ticking", "glitch-transition"];
    for (const n of names) {
      const e = SFX[n];
      assert.ok(e, n);
      assert.equal(e.source, "synth");
      assert.ok(e.peakAt >= 0 && e.peakAt < e.durationSec, n);
      assert.ok(e.description.length > 20, n);
    }
    assert.equal(SFX["rewind-tape"].category, "transition.rewind");
    assert.equal(SFX["whoosh-reverse-in"].category, "whoosh.in");
    assert.equal(SFX["light-leak-swell"].category, "ambience.light");
  });

  // ------------------------------------------------------------------ tools (real render)
  await test("tools: list_sfx, list_voices, lyria needs consent", async () => {
    const s = await callTool("list_sfx", { q: "rewind recap" });
    assert.match(textOf(s), /sfx:rewind-tape/);
    assert.match(textOf(s), /sfx:recap-swoosh/);
    const v = await callTool("list_voices", {});
    assert.match(textOf(v), /"Kore": "firm"/);
    const p = createProject({ name: "lyria", format: "9:16" });
    await writeSpec(p.id, { fps: 30, scenes: [{ duration: 2, layers: [] }] });
    const l = await callTool("compose_music", { projectId: p.id, provider: "lyria" });
    assert.ok(l.isError);
    assert.match(textOf(l), /paid on the Gemini API/);
  });

  if (process.platform === "darwin") {
    await test("tools: voiceover + score on a film → spec, captions, versions, and a render with audio", async () => {
      const p = createProject({ name: "sound film", format: "9:16" });
      await writeSpec(p.id, { fps: 30, theme: { colors: { bg: "#101014", fg: "#ffffff", accent: "#ffd43b" } }, scenes: [
        { id: "a", duration: 2.2, layers: [{ type: "text", text: "Mornings" }] }, { id: "b", duration: 2.2, transition: { type: "fade" }, layers: [{ type: "text", text: "Brew" }] },
      ] }, { author: { kind: "you" } });
      const vo = await callTool("generate_voiceover", { projectId: p.id, text: "Mornings are hard. Brew makes them easy.", provider: "system", voice: "Samantha", timing: "estimate", captions: { style: "karaoke" } }, { author: { kind: "director" } });
      assert.ok(!vo.isError, textOf(vo));
      assert.match(textOf(vo), /Sentences \(film time\):\n\s+1\. 0\.00–/);
      const spec = readSpec(p.id) as unknown as { voiceover: { src: string; words: unknown[] }[]; captions: { style: string } };
      assert.equal(spec.voiceover.length, 1);
      assert.match(spec.voiceover[0].src, /^assets\/vo-[0-9a-f]{10}\.wav$/);
      assert.equal(spec.voiceover[0].words.length, 7);
      assert.equal(spec.captions.style, "karaoke");
      const mu = await callTool("compose_music", { projectId: p.id, mood: "warm" }, { author: { kind: "director" } });
      assert.ok(!mu.isError, textOf(mu));
      const s2 = readSpec(p.id) as unknown as { audio: { src: string; volume: number }; sound: { music: { bpm: number; beats: number[] } } };
      assert.equal(s2.audio.volume, 0.55, "quieter bed under a voice");
      assert.ok(s2.sound.music.bpm > 0 && s2.sound.music.beats.length > 4);
      assert.deepEqual(listSpecVersions(p.id).slice(0, 2).map((v) => v.summary.split(" ·")[0]), ["Music", "Voiceover"]);

      // a frame mid-word shows the film captions (bright text in the lower third)
      const pf = await callTool("preview_frames", { projectId: p.id, times: [0.6], individual: true, scale: 0.5 });
      const img = pf.content.find((c) => c.type === "image") as { data: string };
      const jpg = path.join(tmp, "cap.jpg"), avi = path.join(tmp, "cap.avi");
      fs.writeFileSync(jpg, Buffer.from(img.data, "base64"));
      await runMediaTool("ffmpeg", ["-y", "-v", "error", "-i", jpg, "-vf", "crop=iw*0.8:ih*0.14:iw*0.1:ih*0.68,scale=40:8,format=gray", "-c:v", "rawvideo", "-f", "avi", avi]);
      const b = fs.readFileSync(avi), i = b.indexOf("00db", b.indexOf("movi"));
      const px = b.subarray(i + 8, i + 8 + 320);
      assert.ok(Math.max(...px) > 200, `caption pixels present (max ${Math.max(...px)})`);

      const r = await callTool("render_video", { projectId: p.id, quality: "draft" });
      assert.ok(!r.isError, textOf(r));
      const mp4 = textOf(r).match(/renders\/[^\s"]+\.mp4/)![0];
      const L = await measureLoudness(path.join(process.env.MOTION_STUDIO_PROJECTS!, p.id, mp4));
      assert.ok(L && L.lufs > -30, `render has audio: ${JSON.stringify(L)}`);
    });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
