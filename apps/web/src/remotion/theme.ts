// Design tokens for the Remotion marketing video, mirrored from the cockpit's
// globals.css so the video IS the product visually: warm near-black, one orange
// accent, disciplined grayscale, pass-green only for genuine stop conditions.
// Inline values (not CSS vars) because the composition must also render through
// the Remotion CLI, where the app stylesheet is not loaded.

export const T = {
  canvas: "#0b0b0c",
  panel: "#141416",
  raised: "#1c1c1f",
  line: "#26262a",
  ink: "#f5f5f4",
  inkMid: "#a1a1a6",
  inkDim: "#6e6e73",
  inkFaint: "#46464b",
  accent: "#ff6a1a",
  accentBright: "#ff8a3d",
  accentBg: "rgba(255, 106, 26, 0.1)",
  accentLine: "rgba(255, 106, 26, 0.35)",
  pass: "#5ba372",
} as const;

export const MONO =
  "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, 'Cascadia Mono', monospace";
export const SANS =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, 'Segoe UI', system-ui, sans-serif";

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 1920, // 64s
} as const;
