"use client";

// One session's detail: console on the left (terminal + command box), the loop-archetype
// rail on the right (and the skillvault skills menu + tldraw board next). This is the
// "click the chat -> the worker view + how-to-loop on the right" surface.

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { sendCommand } from "@/lib/voxherd/client";
import { useSessions } from "@/lib/voxherd/useSessions";
import { ArchetypeRail } from "@/components/fleet/ArchetypeRail";
import { AnsiLines } from "@/components/fleet/AnsiLines";
import { SkillsMenu } from "@/components/fleet/SkillsMenu";
import type { Archetype } from "@/lib/fleet/archetypes";
import type { SkillPackage } from "@/lib/skillvault/client";
import { openTerminalStream } from "@/lib/voxherd/ws";
import { startArchetypeLoop, type LoopHandle, type LoopState } from "@/lib/voxherd/loop";

// Send modes you cycle with Shift+Tab (like Ghostty / Claude Code's mode cycle). Each one
// just frames the message before it goes to the worker over the send-keys transport, so the
// box stays a plain text field but the worker gets a different instruction per mode.
type SendMode = {
  key: string;
  label: string;
  hint: string;
  // ring + text accent for the pill; default mode stays neutral (no orange).
  accent: boolean;
  frame: (text: string) => string;
};
const SEND_MODES: SendMode[] = [
  {
    key: "default",
    label: "default",
    hint: "send as typed",
    accent: false,
    frame: (t) => t,
  },
  {
    key: "plan",
    label: "plan mode",
    hint: "propose a plan first, no edits",
    accent: true,
    frame: (t) =>
      `[Plan mode] Think it through and propose a plan before changing anything. ` +
      `Do not edit files or run side-effecting commands yet, just lay out the approach.\n\n${t}`,
  },
  {
    key: "auto",
    label: "auto-accept",
    hint: "proceed without pausing to ask",
    accent: true,
    frame: (t) =>
      `[Auto-accept] Proceed autonomously and do not pause to ask for confirmation. ` +
      `Make reasonable assumptions and keep going until it is done.\n\n${t}`,
  },
];

export function SessionDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  // Shared poller (de-duped with the fleet view); derive this one session from it.
  const { sessions, error } = useSessions();
  const session = useMemo(
    () => sessions.find((s) => s.session_id === id) ?? null,
    [sessions, id],
  );
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [pastedImages, setPastedImages] = useState<{ path: string; preview: string }[]>([]);
  const [sentImages, setSentImages] = useState<{ path: string; preview: string }[]>([]);
  const [liveLines, setLiveLines] = useState<string[]>([]);
  const termRef = useRef<HTMLPreElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [loop, setLoop] = useState<LoopState | null>(null);
  const loopRef = useRef<LoopHandle | null>(null);
  const [modeIdx, setModeIdx] = useState(0);
  const mode = SEND_MODES[modeIdx];

  // Clear the live transcript during render when the session id changes, rather than
  // synchronously inside the stream effect. React's "adjust state on dependency change"
  // pattern: behavior-identical (the stream repopulates) but without the extra cascading
  // render an in-effect setState queues.
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    if (id) setLiveLines([]);
  }

  // Live terminal stream (best effort; falls back to the polled preview on any failure).
  useEffect(() => {
    if (!id) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void openTerminalStream(id, (lines) => {
      // Streaming terminal text is non-urgent (same call the swarm console makes):
      // a transition keeps typing/scrolling responsive under a flood of 0.5s updates.
      if (!cancelled) startTransition(() => setLiveLines(lines));
    }).then((fn) => {
      if (cancelled) fn();
      else cleanup = fn;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [id]);

  // Stick to the newest output ONLY when the user is already at the bottom, so
  // scrolling up to read history (the deep transcript voxherd streams, including a
  // sub-agent's turns) is not yanked back down on the next 0.5s update.
  const onTermScroll = useCallback(() => {
    const el = termRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickRef.current = near;
    setAtBottom(near);
  }, []);
  const jumpToLatest = useCallback(() => {
    const el = termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setAtBottom(true);
  }, []);
  useEffect(() => {
    const el = termRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [liveLines, session?.terminal_preview]);

  // Stop any running loop when leaving the session.
  useEffect(() => () => loopRef.current?.stop(), []);

  const send = useCallback(async () => {
    if (!session) return;
    const text = input.trim();
    if (!text && pastedImages.length === 0) return;
    const framed = mode.frame(text);
    const imageNote =
      pastedImages.length === 1
        ? `[The user pasted an image. Read it at: ${pastedImages[0].path}]`
        : pastedImages.length > 1
          ? `[The user pasted ${pastedImages.length} images. Read them at: ` +
            `${pastedImages.map((img) => img.path).join(", ")}]`
          : "";
    const message = imageNote ? `${framed}${framed ? "\n\n" : ""}${imageNote}` : framed;
    setNote("sending...");
    const r = await sendCommand({
      project: session.project,
      session_id: session.session_id,
      message,
    });
    setNote(r.ok ? "sent" : `failed: ${r.error ?? "?"}`);
    if (r.ok) {
      if (pastedImages.length) {
        const imgs = pastedImages;
        setSentImages((s) => [...imgs, ...s].slice(0, 8));
      }
      setInput("");
      setPastedImages([]);
    }
  }, [session, input, pastedImages, mode]);

  const cycleMode = useCallback((dir: 1 | -1) => {
    setModeIdx((i) => (i + dir + SEND_MODES.length) % SEND_MODES.length);
  }, []);

  // Ctrl/Cmd+V of an image: save it locally and attach its path. On send the worker gets
  // a message pointing at the file so its Read tool opens it, like Ghostty/Claude Code's
  // [Image #N] paste, adapted to our text-only send-keys transport.
  const onPaste = useCallback(async (e: ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = Array.from(items)
      .filter((it) => it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => Boolean(f));
    if (files.length === 0) return;
    e.preventDefault();
    setNote(files.length > 1 ? `uploading ${files.length} images...` : "uploading image...");
    let ok = 0;
    let failed = 0;
    // Upload each pasted image and append it; a single paste can carry several.
    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      }).catch(() => "");
      if (!dataUrl) {
        failed += 1;
        continue;
      }
      try {
        const resp = await fetch("/api/voxherd/paste-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl }),
        });
        const j = (await resp.json()) as { ok?: boolean; path?: string; error?: string };
        if (j.ok && j.path) {
          const path = j.path;
          setPastedImages((imgs) => [...imgs, { path, preview: dataUrl }]);
          ok += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    setNote(
      failed === 0
        ? ok > 1
          ? `${ok} images attached`
          : "image attached"
        : `${ok} attached, ${failed} failed`,
    );
  }, []);

  const runArchetype = useCallback(
    (a: Archetype, goal: string) => {
      if (!session || !goal.trim()) return;
      loopRef.current?.stop();
      setNote("");
      loopRef.current = startArchetypeLoop({
        session: { project: session.project, session_id: session.session_id },
        archetype: a,
        goal: goal.trim(),
        onState: setLoop,
      });
    },
    [session],
  );

  const giveSkill = useCallback(
    async (p: SkillPackage) => {
      if (!session) return;
      setNote(`installing ${p.display_name ?? p.name}...`);
      const msg =
        `Install the skillvault package "${p.id}" into this project so you can use its skills: ` +
        `download https://skillvault.md/api/packages/${p.id}/download and unzip it into the ` +
        `project's .claude/ directory (it contains skills/, and maybe agents/). Then use those ` +
        `skills. The package is: ${p.tagline ?? p.display_name ?? p.name}.`;
      const r = await sendCommand({
        project: session.project,
        session_id: session.session_id,
        message: msg,
      });
      setNote(r.ok ? `sent install for ${p.name}` : `failed: ${r.error ?? "?"}`);
    },
    [session],
  );

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink-mid">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <Link href="/fleet" className="font-mono text-sm text-ink-dim transition hover:text-ink">
          &larr; fleet
        </Link>
        {session ? (
          <>
            <span className="font-semibold text-ink">
              {session.project}
              {session.agent_number ? ` #${session.agent_number}` : ""}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink-dim">
              {session.status}
            </span>
            <span className="font-mono text-[11px] text-ink-dim">
              {session.assistant}
              {session.activity_type ? ` · ${session.activity_type}` : ""}
              {session.sub_agent_count ? ` · ${session.sub_agent_count} sub-agents` : ""}
            </span>
          </>
        ) : (
          <span className="text-sm text-ink-dim">
            {error ? `bridge: ${error}` : "loading session..."}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: the worker's console */}
        <main className="flex min-h-0 flex-1 flex-col p-5">
          {session?.last_summary && (
            <p className="mb-2 text-sm text-ink-mid">{session.last_summary}</p>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <pre
              ref={termRef}
              onScroll={onTermScroll}
              style={{ color: "#d4d4d4" }}
              className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas/60 p-4 font-mono text-[11px] leading-relaxed"
            >
              <AnsiLines
                lines={
                  liveLines.length
                    ? liveLines
                    : session?.terminal_preview
                      ? session.terminal_preview.split("\n")
                      : ["no terminal output yet."]
                }
              />
            </pre>
            {!atBottom && (
              <button
                type="button"
                onClick={jumpToLatest}
                className="absolute bottom-2 right-3 rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-[11px] font-semibold text-accent shadow transition hover:bg-accent/25"
              >
                ↓ latest
              </button>
            )}
          </div>
          {sentImages.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 overflow-x-auto">
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-dim">
                sent
              </span>
              {sentImages.map((img, i) => (
                // next/image can't optimize ephemeral data: URLs and adds nothing at
                // thumbnail size; raw <img> with explicit dims (no CLS) + lazy load.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${img.path}-${i}`}
                  src={img.preview}
                  alt="sent"
                  title={img.path}
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  className="h-8 w-8 shrink-0 rounded border border-line object-cover opacity-80 transition hover:opacity-100"
                />
              ))}
            </div>
          )}
          {pastedImages.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {pastedImages.map((img, i) => (
                <div key={`${img.path}-${i}`} className="group relative">
                  {/* data: URL thumbnail; explicit dims (no CLS) + lazy decode. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.preview}
                    alt="pasted"
                    title={img.path}
                    width={36}
                    height={36}
                    loading="lazy"
                    decoding="async"
                    className="h-9 w-9 rounded border border-line object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setPastedImages((imgs) => imgs.filter((_, j) => j !== i))
                    }
                    title="remove"
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-canvas text-[10px] leading-none text-ink-dim opacity-0 transition group-hover:opacity-100 hover:text-fail"
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className="text-[11px] text-ink-dim">
                {pastedImages.length === 1
                  ? "image attached"
                  : `${pastedImages.length} images attached`}{" "}
                &middot; paste more to add
              </span>
              <button
                type="button"
                onClick={() => setPastedImages([])}
                className="text-[11px] text-ink-dim transition hover:text-fail"
              >
                clear
              </button>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => cycleMode(1)}
              title="Shift+Tab to cycle (Alt+Shift+Tab reverses)"
              className={`rounded-md border px-2 py-0.5 font-mono font-semibold transition ${
                mode.accent
                  ? "border-accent/50 bg-accent/15 text-accent hover:bg-accent/25"
                  : "border-line bg-raised/70 text-ink-dim hover:text-ink"
              }`}
            >
              {mode.accent ? "⏵⏵ " : ""}
              {mode.label}
            </button>
            <span className="text-ink-dim">
              {mode.hint} <span className="text-ink-dim/70">· shift+tab to cycle</span>
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                // Shift+Tab cycles send modes (Shift+Shift+Tab would reverse, but Tab+Shift
                // alone steps backward); plain Enter sends. preventDefault keeps focus in the box.
                if (e.key === "Tab" && e.shiftKey) {
                  e.preventDefault();
                  cycleMode(e.altKey ? -1 : 1);
                  return;
                }
                if (e.key === "Enter") void send();
              }}
              placeholder="send a command to this session, or paste an image..."
              disabled={!session}
              spellCheck={false}
              className="flex-1 rounded-lg border border-line bg-raised/70 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-accent/60 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!session || (!input.trim() && pastedImages.length === 0)}
              className="rounded-lg border border-accent/40 bg-accent/15 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
            >
              Send
            </button>
            {note && <span className="text-xs text-ink-dim">{note}</span>}
          </div>
        </main>

        {/* Right: loop archetypes (and the skills menu + board mount next) */}
        <aside className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-line p-4">
          {loop && (
            <div className="mb-3 rounded-lg border border-accent/40 bg-accent/10 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-accent">
                  {loop.archetype} loop · round {loop.round}/{loop.maxRounds}
                  {loop.reason ? ` · ${loop.reason}` : loop.running ? " · running" : ""}
                </span>
                {loop.running && (
                  <button
                    type="button"
                    onClick={() => loopRef.current?.stop()}
                    className="rounded-md border border-line px-2 py-0.5 text-[10px] font-semibold text-ink-mid transition hover:bg-raised"
                  >
                    Stop
                  </button>
                )}
              </div>
              {loop.lastSummary && (
                <p className="mt-1 line-clamp-2 text-[10px] text-ink-dim">{loop.lastSummary}</p>
              )}
            </div>
          )}
          <ArchetypeRail onRun={runArchetype} disabled={!session} />
          <div className="mt-5 flex min-h-0 flex-1 flex-col border-t border-line pt-3">
            <SkillsMenu onGive={giveSkill} disabled={!session} />
          </div>
        </aside>
      </div>
    </div>
  );
}
