# Glassbox cockpit (apps/web)

The Next.js 15 glass cockpit: a tldraw board over the agent swarm, a CopilotKit
command bar, and per-task correctness curves, all driven by the Redis event stream
(SSE from `/api/events`). Runs on port **3100** and talks to the swarm backend on
**8100** (3000/8000 are reserved on this machine; never use them).

```bash
# from the repo root
pnpm web                                  # dev server on :3100
# or production (no dev overlay, for the demo)
pnpm --filter web build && pnpm --filter web start
```

Open `http://localhost:3100`. Needs the backend (`pnpm backend`) and Redis
(`pnpm redis`) running. See the root `README.md` for the full stack and run steps,
and `docs/DEMO.md` for the demo script.
