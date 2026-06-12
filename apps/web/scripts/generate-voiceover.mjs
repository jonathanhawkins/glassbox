// Generate the marketing video's voiceover (per scene) and music bed with ElevenLabs.
// One-time asset generation, not a runtime dependency: the mp3s land in public/ and the
// composition plays them with <Audio>. Needs ELEVENLABS_API_KEY in the environment (it
// lives in the repo root .env, which is gitignored):
//
//   cd apps/web
//   export $(grep ELEVENLABS_API_KEY ../../.env | xargs) && node scripts/generate-voiceover.mjs
//
// Voice: Brian (deep, resonant narrator). Each line is written to FIT its scene window
// at a natural pace; if a regenerated line overruns, trim words, not the timeline.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("ELEVENLABS_API_KEY is not set");
  process.exit(1);
}

const VOICE_ID = "nPczCjzI2devNBz1zQrb"; // Brian: deep, resonant, comforting

// Scene windows (seconds): open 0-6, roles 6-18.6, models 18.6-29.3, loops 29.3-46.6,
// board 46.6-58.6, close 58.6-64.
const LINES = [
  { id: "open", text: "This is Glassbox. The swarm agent coordinator." },
  {
    id: "roles",
    text:
      "Give it a job, and it spawns a real team: planner, coordinator, workers, validator, " +
      "improver. Each one a live Claude Code session, on your normal account.",
  },
  {
    id: "models",
    text: "Every role gets its own brain. Pick each agent's model and effort level once, and Glassbox remembers.",
  },
  {
    id: "loops",
    text:
      "The team runs in a loop, and every loop is named by how it stops. Sweep stops when the " +
      "backlog is empty. Climb pushes a number until it stops improving. Then Glassbox lands the " +
      "swarm, all by itself.",
  },
  {
    id: "board",
    text:
      "And you watch it all, live. The work lives in Beads, messages travel by Agent Mail, and " +
      "every score lands on a Redis leaderboard, graded in Weights and Biases.",
  },
  { id: "close", text: "Glassbox. Give it a job. Watch it work. It stops when it's done." },
];

const VO_DIR = path.join(process.cwd(), "public", "vo");
const MUSIC_DIR = path.join(process.cwd(), "public", "music");
mkdirSync(VO_DIR, { recursive: true });
mkdirSync(MUSIC_DIR, { recursive: true });

async function tts({ id, text }) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25 },
    }),
  });
  if (!res.ok) throw new Error(`tts ${id}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  writeFileSync(path.join(VO_DIR, `${id}.mp3`), Buffer.from(await res.arrayBuffer()));
  console.log(`vo/${id}.mp3 written (${text.split(/\s+/).length} words)`);
}

// Music direction: a minimal dark electronic underscore in the cockpit's mood. Warm analog
// pulse, steady and hypnotic, no melody fighting the narration, a gentle lift mid-video,
// clean ending. Try the Eleven Music API first (full 64s composed track); fall back to a
// 20s sound-generation loop the composition tiles and shapes with volume automation.
async function music() {
  const prompt =
    "Minimal dark ambient electronic underscore for a modern developer tool product video. " +
    "Warm analog synth pulse at 112 bpm, deep soft kick, steady hypnotic groove, subtle " +
    "tension build in the middle, no vocals, no lead melody, clean fade ending.";
  const res = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ prompt, music_length_ms: 64000 }),
  });
  if (res.ok) {
    writeFileSync(path.join(MUSIC_DIR, "underscore.mp3"), Buffer.from(await res.arrayBuffer()));
    console.log("music/underscore.mp3 written (composed, 64s)");
    return;
  }
  console.warn(`music api: ${res.status}, falling back to a sound-generation loop`);
  const fallback = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text:
        "warm dark minimal electronic music loop, 112 bpm, deep soft kick and ambient analog " +
        "synth pad, steady hypnotic pulse, seamless loop, no vocals",
      duration_seconds: 20,
      prompt_influence: 0.4,
    }),
  });
  if (!fallback.ok) {
    throw new Error(`sound-generation: ${fallback.status} ${(await fallback.text()).slice(0, 200)}`);
  }
  writeFileSync(path.join(MUSIC_DIR, "underscore-loop.mp3"), Buffer.from(await fallback.arrayBuffer()));
  console.log("music/underscore-loop.mp3 written (20s loop)");
}

for (const line of LINES) await tts(line);
await music();
console.log("done");
