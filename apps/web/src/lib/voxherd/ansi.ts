// Pure (framework-free) ANSI -> styled-segment parser, ported from vibe-view's
// parseAnsiLine (src/components/hub/AgentTerminalPanel.tsx). voxherd streams terminal
// output captured via `tmux capture-pane -e`, so lines carry SGR escape sequences. This
// turns each line into colored segments so the cockpit terminal matches what Ghostty
// shows (cyan/blue links, bold white headings, dim gray, colored sub-agent menus).
//
// Supports: reset (0), bold (1), dim (2), italic (3), underline (4) and their resets
// (22/23/24/39/49), the standard 16-color palette (30-37, 90-97 fg / 40-47, 100-107 bg),
// the xterm 256-color cube (38;5;n / 48;5;n), and 24-bit RGB (38;2;r;g;b / 48;2;r;g;b).
// The 16-color palette matches Ghostty (Catppuccin-ish), same hexes vibe-view uses.

import type { CSSProperties } from "react";

/** Default foreground for un-colored text: light-on-dark, like Ghostty (not muted). */
export const ANSI_DEFAULT_FG = "#d4d4d4";

// ANSI color code -> Ghostty-matching CSS color (same palette as vibe-view).
const ANSI_COLORS: Record<number, string> = {
  30: "#45475a", // black (surface)
  31: "#f38ba8", // red
  32: "#a6e3a1", // green
  33: "#f9e2af", // yellow
  34: "#89b4fa", // blue
  35: "#cba6f7", // magenta/purple
  36: "#94e2d5", // cyan
  37: "#cdd6f4", // white (text)
  90: "#585b70", // bright black (overlay)
  91: "#f38ba8", // bright red
  92: "#a6e3a1", // bright green
  93: "#f9e2af", // bright yellow
  94: "#89b4fa", // bright blue
  95: "#cba6f7", // bright magenta
  96: "#94e2d5", // bright cyan
  97: "#ffffff", // bright white
};

/** Convert a 256-color ANSI index to a hex / rgb() color (Ghostty 16-color base). */
function ansi256ToHex(n: number): string {
  // Standard colors 0-7
  const standard = [
    "#45475a",
    "#f38ba8",
    "#a6e3a1",
    "#f9e2af",
    "#89b4fa",
    "#cba6f7",
    "#94e2d5",
    "#cdd6f4",
  ];
  // Bright colors 8-15
  const bright = [
    "#585b70",
    "#f38ba8",
    "#a6e3a1",
    "#f9e2af",
    "#89b4fa",
    "#cba6f7",
    "#94e2d5",
    "#ffffff",
  ];
  if (n < 8) return standard[n];
  if (n < 16) return bright[n - 8];
  // 216 color cube (16-231)
  if (n < 232) {
    const idx = n - 16;
    const r = Math.floor(idx / 36) * 51;
    const g = Math.floor((idx % 36) / 6) * 51;
    const b = (idx % 6) * 51;
    return `rgb(${r},${g},${b})`;
  }
  // Grayscale ramp (232-255)
  const gray = (n - 232) * 10 + 8;
  return `rgb(${gray},${gray},${gray})`;
}

export interface AnsiSegment {
  text: string;
  style: CSSProperties;
}

/**
 * Parse one line of (possibly ANSI-escaped) text into styled segments. Each segment's
 * style carries color / backgroundColor / fontWeight (bold) / opacity (dim) / fontStyle
 * (italic) / textDecoration (underline). Un-colored text gets ANSI_DEFAULT_FG so plain
 * lines render light-on-dark like Ghostty. Never throws; unknown SGR codes are ignored.
 */
export function parseAnsi(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];

  let fg: string | undefined;
  let bg: string | undefined;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;
  let lastIndex = 0;

  const push = (text: string) => {
    if (!text) return;
    const style: CSSProperties = { color: fg ?? ANSI_DEFAULT_FG };
    if (bg) style.backgroundColor = bg;
    if (bold) style.fontWeight = 700;
    if (dim) style.opacity = 0.6;
    if (italic) style.fontStyle = "italic";
    if (underline) style.textDecoration = "underline";
    segments.push({ text, style });
  };

  // Match all CSI sequences (ESC [ ... letter). \u001b is the ESC byte tmux emits;
  // built via RegExp so the source stays plain ASCII (no embedded control byte).
  const ansiRegex = new RegExp("\\u001b\\[([0-9;]*)([a-zA-Z])", "g");
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(line)) !== null) {
    if (match.index > lastIndex) push(line.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;

    // Only SGR (set graphics rendition) sequences end in 'm' affect styling; others
    // (cursor moves, clears, etc.) are simply swallowed so they don't render as text.
    if (match[2] !== "m") continue;

    const codes = (match[1] === "" ? "0" : match[1]).split(";").map(Number);
    let i = 0;
    while (i < codes.length) {
      const code = codes[i];
      if (code === 0) {
        fg = undefined;
        bg = undefined;
        bold = false;
        dim = false;
        italic = false;
        underline = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code === 3) {
        italic = true;
      } else if (code === 4) {
        underline = true;
      } else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 23) {
        italic = false;
      } else if (code === 24) {
        underline = false;
      }
      // Standard foreground colors
      else if (code >= 30 && code <= 37) {
        fg = ANSI_COLORS[code];
      }
      // 256-color foreground: 38;5;N
      else if (code === 38 && codes[i + 1] === 5) {
        fg = ansi256ToHex(codes[i + 2] ?? 0);
        i += 2;
      }
      // 24-bit RGB foreground: 38;2;R;G;B
      else if (code === 38 && codes[i + 1] === 2) {
        fg = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`;
        i += 4;
      } else if (code === 39) {
        fg = undefined;
      }
      // Bright foreground colors
      else if (code >= 90 && code <= 97) {
        fg = ANSI_COLORS[code];
      }
      // Background colors (40-47, 100-107, 48;5;N, 48;2;R;G;B)
      else if (code >= 40 && code <= 47) {
        bg = ANSI_COLORS[code - 10];
      } else if (code === 48 && codes[i + 1] === 5) {
        bg = ansi256ToHex(codes[i + 2] ?? 0);
        i += 2;
      } else if (code === 48 && codes[i + 1] === 2) {
        bg = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`;
        i += 4;
      } else if (code === 49) {
        bg = undefined;
      } else if (code >= 100 && code <= 107) {
        bg = ANSI_COLORS[code - 60];
      }
      i++;
    }
  }

  // Remaining text after the last escape sequence.
  if (lastIndex < line.length) push(line.slice(lastIndex));

  // Ensure even a blank line yields one segment (keeps line height + default color).
  if (segments.length === 0) push(line);

  return segments;
}
