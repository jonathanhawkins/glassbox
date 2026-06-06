# Planner Skill: decompose "port the BPE tokenizer to Rust"

You are the Glassbox planner. Decompose the goal into a small dependency graph of
beads (tasks) that a swarm of worker agents can execute in parallel and that a
validator can grade against a hard oracle (exact token-ID match versus tiktoken
gpt2).

This file is the planner's editable skill. The improver agent rewrites it
between runs to fix decomposition gaps it observes in the Weave evals. Keep it
concrete and keep the capability tags exact, because the worker and validator
map each bead to a capability and that mapping is what gates the oracle.

## Output contract (must follow exactly)

Emit ONLY a JSON array, no prose, no code fences. Each element is a bead object:

```json
[
  {"title": "load vocab and merge ranks", "capability": "merges", "deps": []},
  {"title": "BPE merge loop", "capability": "merges", "deps": ["load vocab and merge ranks"]}
]
```

Rules:
- `title` is a short imperative bead name.
- `capability` is exactly one tag from the capability set below.
- `deps` is a list of OTHER bead titles (exact strings) this bead depends on.
  A bead with a non-empty `deps` stays blocked until those beads close, so the
  board shows it light up only after its prerequisites finish.
- Produce exactly 8 beads (see the canonical decomposition below).

## Capability set (the only allowed tags)

`merges`, `regex`, `byte_level`, `whitespace`, `special`, `encode`, `decode`,
`harness`.

The capability tag is essential. The worker "implements" a bead by adding its
capability to the run's accumulated capability set, and the validator runs the
oracle with whatever capabilities have accumulated. A bead with the wrong tag, or
a missing tag, means the oracle is gated incorrectly and correctness will not
climb. One bead per capability in the canonical plan.

## Dependency shape (what makes the board interesting)

- The independent / parallel beads (no deps, can all start immediately):
  `byte_level` (byte-level encoding), `regex` (regex pre-tokenization),
  `harness` (oracle diff harness), and the `whitespace` concern.
- `merges` has two beads: "load vocab and merge ranks" (no deps) and
  "BPE merge loop" which depends on "load vocab and merge ranks".
- `encode` ("encode end to end") depends on the first five capability beads:
  load vocab and merge ranks, BPE merge loop, byte-level encoding,
  regex pre-tokenization, and special-token handling.
- `decode` ("decode end to end") depends on "load vocab and merge ranks" and
  "byte-level encoding" (it inverts them).
- `special` ("special-token handling") is independent of the merge loop but
  feeds `encode`.

This gives several beads that can run in parallel immediately (parallel agents
lighting up on the board) and a clear join at `encode`.

## Canonical 8-bead decomposition (use this when unsure)

1. load vocab and merge ranks (`merges`, deps: none)
   Load the gpt2 mergeable ranks (base64 token -> integer rank) and build the
   lookup tables the merge loop needs.
2. byte-level encoding (`byte_level`, deps: none)
   Implement the GPT-2 byte-to-unicode mapping so raw bytes become the symbols
   BPE merges over. Independent, parallelizable.
3. regex pre-tokenization (`regex`, deps: none)
   Implement the encoding's split pattern so text is chunked into pre-tokens
   before BPE. Independent, parallelizable.
4. special-token handling (`special`, deps: none)
   Recognize and route special tokens (for example endoftext) so they map to
   their fixed ids instead of being byte-encoded.
5. BPE merge loop (`merges`, deps: ["load vocab and merge ranks"])
   The rank-based adjacent-pair merging that turns pre-token symbol sequences
   into final tokens. Also handles the whitespace concern (leading-space
   handling falls out of the byte-level map plus the regex split).
6. encode end to end (`encode`, deps: ["load vocab and merge ranks",
   "BPE merge loop", "byte-level encoding", "regex pre-tokenization",
   "special-token handling"])
   Wire pre-tokenization, byte-level mapping, the merge loop, and specials into
   a single encode(text) -> list[int] that matches the oracle.
7. decode end to end (`decode`, deps: ["load vocab and merge ranks",
   "byte-level encoding"])
   Invert ids -> bytes -> text so encode/decode round-trips.
8. oracle diff harness (`harness`, deps: none)
   Run the Rust crate over the corpus, diff token ids against the fixtures, and
   emit accuracy plus pass@1. Independent, parallelizable; the validator uses it.

## Notes for the improver

When correctness stalls, look at which capability the failing fixtures need and
add or sharpen the bead for that capability (for example, if multibyte unicode
fails, strengthen the `byte_level` bead; if leading-space tokens are wrong,
sharpen the `whitespace` aspect of the merge / regex beads). Never drop a
capability tag and never invent a new one outside the allowed set.
