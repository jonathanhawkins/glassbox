"use client";

// The Glassbox pitch deck shell.
//
// Full-viewport, one slide at a time. Keyboard-first: ArrowRight / Space / PageDown
// advance, ArrowLeft / PageUp go back, Home / End jump to ends. Optional click
// zones (left third back, right two-thirds forward) for clickers. A thin top
// progress bar and a mono slide counter orient the presenter. Each slide does a
// short self-contained entrance keyed to the index, so navigating re-triggers it
// without any scroll observer (which would risk a mid-fade flash on a projector).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SLIDES } from "./slides";

export function Deck() {
  const [index, setIndex] = useState(0);
  const total = SLIDES.length;

  const go = useCallback(
    (next: number) => {
      setIndex((prev) => {
        const clamped = Math.max(0, Math.min(total - 1, next));
        return clamped === prev ? prev : clamped;
      });
    },
    [total],
  );

  const next = useCallback(() => go(index + 1), [go, index]);
  const prev = useCallback(() => go(index - 1), [go, index]);

  // Export to PDF via the browser's print dialog (Save as PDF). The print-only
  // stack below renders every slide one-per-landscape-page; see the @media print
  // rules in the style block. Kept dependency-free on purpose.
  const exportPdf = useCallback(() => window.print(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          next();
          break;
        case " ": // Space advances (Shift+Space goes back)
          e.preventDefault();
          if (e.shiftKey) prev();
          else next();
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(total - 1);
          break;
        case "p":
        case "P":
          e.preventDefault();
          exportPdf();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, go, total, exportPdf]);

  const slide = SLIDES[index];
  const progress = total > 1 ? (index / (total - 1)) * 100 : 100;

  return (
    <>
      {/* Deck-scoped styles. Kept here (not globals.css) so the deck stays fully
          additive. The entrance keyframe plays once on mount; re-mounting via the
          slide `key` replays it on navigate. The @media print block drives PDF
          export: it hides the interactive deck and lays out the print-only stack
          one slide per landscape page, preserving the dark cockpit colors. */}
      <style>{`
        .gb-slide { animation: gb-slide-in 480ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        @keyframes gb-slide-in {
          from { opacity: 0; transform: translateY(14px) scale(0.992); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .gb-slide { animation: none; }
        }

        .gb-print { display: none; }
        @media print {
          @page { size: landscape; margin: 0; }
          html, body {
            background: #060a14 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .gb-deck-screen { display: none !important; }
          .gb-print { display: block !important; }
          .gb-print-page {
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            background: #060a14;
            break-after: page;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .gb-print-page:last-child { break-after: auto; }
        }
      `}</style>

    <main className="gb-deck-screen relative h-full w-full overflow-hidden bg-[#060a14] text-slate-200">

      {/* Top progress bar. */}
      <div className="absolute inset-x-0 top-0 z-30 h-0.5 bg-slate-800/60">
        <div
          className="h-full bg-gradient-to-r from-cyan-400 via-cyan-300 to-violet-400 transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* The active slide. `key` re-mounts so the entrance animation replays. */}
      <div key={slide.id} className="gb-slide h-full w-full">
        {slide.render()}
      </div>

      {/* Click zones for a clicker / mouse: left = back, right = forward. */}
      <button
        type="button"
        aria-label="previous slide"
        onClick={prev}
        className="absolute inset-y-0 left-0 z-20 w-1/3 cursor-default focus:outline-none"
        tabIndex={-1}
      />
      <button
        type="button"
        aria-label="next slide"
        onClick={next}
        className="absolute inset-y-0 right-0 z-20 w-2/3 cursor-default focus:outline-none"
        tabIndex={-1}
      />

      {/* Bottom chrome: back-to-cockpit link, dot rail, and slide counter. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-center justify-between px-7 py-5">
        <Link
          href="/"
          className="pointer-events-auto font-mono text-xs uppercase tracking-[0.18em] text-slate-500 transition hover:text-cyan-300"
        >
          {"<-"} live cockpit
        </Link>

        {/* Dot rail. Clickable for direct jumps during Q and A. */}
        <div className="pointer-events-auto flex items-center gap-2">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`go to ${s.title}`}
              aria-current={i === index}
              onClick={() => go(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index
                  ? "w-6 bg-cyan-300"
                  : "w-1.5 bg-slate-600 hover:bg-slate-400"
              }`}
            />
          ))}
        </div>

        <div className="pointer-events-auto flex items-center gap-4">
          <button
            type="button"
            onClick={exportPdf}
            title="Export the deck to PDF (P)"
            className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500 transition hover:text-cyan-300"
          >
            export pdf
          </button>
          <div className="font-mono text-xs tabular-nums tracking-[0.18em] text-slate-500">
            <span className="text-slate-300">
              {String(index + 1).padStart(2, "0")}
            </span>{" "}
            / {String(total).padStart(2, "0")}
          </div>
        </div>
      </div>
    </main>

    {/* Print-only stack: every slide, one per landscape page. Hidden on screen
        (.gb-print is display:none), revealed by the @media print rules above when
        the user exports to PDF. */}
    <div className="gb-print" aria-hidden>
      {SLIDES.map((s) => (
        <div key={s.id} className="gb-print-page">
          {s.render()}
        </div>
      ))}
    </div>
    </>
  );
}
