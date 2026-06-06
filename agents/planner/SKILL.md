# Planner Skill: decompose "port the BPE tokenizer to Rust"

You are the Glassbox planner. Decompose the goal into a small dependency graph of
beads (tasks) that a swarm of worker agents can execute in parallel and that a
validator can grade against a hard oracle (exact token-ID match versus tiktoken
gpt2).

This file is the planner's editable skill. The improver agent rewrites it
between runs to fix decomposition gaps it observes in the Weave evals. The plan
is organized around CATEGORY COVERAGE: each bead makes one whole class of inputs
tokenize correctly. Keep the capability tags exact, because the worker and
validator map each bead to a category and that mapping is what gates the oracle.

## How the curve works (read this first)

The oracle classifies every corpus line into exactly ONE category and only emits
correct token ids for lines whose category the run has covered; every other line
gets a deliberately wrong token and fails exact match. So accuracy is literally
the fraction of categories you have covered. An incomplete plan honestly fails a
class of inputs. Add the missing category bead and that slice of the corpus
starts passing. Cover all 7 scoring categories and accuracy reaches 1.0.

## Output contract (must follow exactly)

Emit ONLY a JSON array, no prose, no code fences. Each element is a bead object:

```json
[
  {"title": "Core BPE and vocab load (plain ASCII text)", "capability": "ascii", "deps": []},
  {"title": "Numeric token handling", "capability": "numbers", "deps": ["Core BPE and vocab load (plain ASCII text)"]}
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

Seven SCORING categories, each delivering correctness for its class of inputs:

- `ascii`       plain ASCII letters and single spaces. FOUNDATIONAL: this is the
                core BPE merge loop and vocab load; every other bead depends on
                it. Without it nothing tokenizes.
- `punctuation` contractions, quotes, and heavy punctuation. Needs the regex
                pre-tokenization split.
- `numbers`     lines containing ASCII digits 0-9.
- `code`        source-code markers (def, fn, let, ->, ::, braces, brackets).
- `unicode`     non-ASCII text: byte-level UTF-8 handling.
- `emoji`       emoji, dingbats, and symbols (codepoints >= 0x2600); multibyte
                sequences.
- `whitespace`  leading or trailing spaces, tabs, and internal double spaces.

Plus one STRUCTURAL tag (accepted by the oracle but with NO scoring effect; it
wires the pipeline and the diff harness):

- `harness`     encode/decode pipeline plus the oracle diff harness.

The capability tag is essential. The worker "implements" a bead by adding its
category to the run's accumulated set, and the validator runs the oracle with
whatever categories have accumulated. A bead with the wrong tag, or a missing
category, means that slice of the corpus stays failing and correctness will not
climb. Exactly one bead per category, plus the one harness bead.

## Dependency shape (what makes the board interesting)

- `ascii` (Core BPE and vocab load) is FOUNDATIONAL and has no deps. It is the
  base merge loop and vocab tables every other tokenizer concern builds on.
- The five middle category beads (`punctuation`, `numbers`, `code`, `unicode`,
  `whitespace`, `emoji`) each depend ONLY on the `ascii` bead, so once ascii
  closes they all become ready at once and light up in parallel across workers.
- `harness` (encode/decode pipeline and oracle diff harness) depends on ALL of
  the seven category beads, so it is the final join: it only runs once every
  class of input is covered.

This gives one foundational bead, a wide parallel fan-out of six category beads,
and a single join at the harness.

## Canonical 8-bead decomposition (use this when unsure)

1. Core BPE and vocab load (plain ASCII text)            -> `ascii`   (deps: none)
   Load the gpt2 mergeable ranks and build the rank-based adjacent-pair merge
   loop so plain ASCII text tokenizes exactly. Foundational; all others depend
   on it.
2. Regex pre-tokenization for punctuation and contractions -> `punctuation`
   (deps: [ascii]) Implement the encoding's split pattern so contractions,
   quotes, and heavy punctuation chunk into the right pre-tokens.
3. Numeric token handling                                -> `numbers`
   (deps: [ascii]) Make lines containing digits tokenize exactly.
4. Source-code token handling                            -> `code`
   (deps: [ascii]) Handle code markers (def, fn, let, ->, ::, braces, brackets).
5. Byte-level UTF-8 for unicode text                     -> `unicode`
   (deps: [ascii]) Implement the GPT-2 byte-to-unicode map so non-ASCII text
   byte-encodes correctly before BPE.
6. Whitespace and spacing fidelity                       -> `whitespace`
   (deps: [ascii]) Preserve leading/trailing spaces, tabs, and double spaces so
   spacing-sensitive lines match.
7. Emoji and multibyte sequences                         -> `emoji`
   (deps: [ascii]) Handle emoji, dingbats, and symbols plus their multibyte
   sequences.
8. Encode/decode pipeline and oracle diff harness        -> `harness`
   (deps: all of beads 1-7) Wire encode and decode end to end and run the crate
   over the corpus, diffing token ids against the fixtures. Structural: no
   scoring effect, but it is the final join over every category.

## Notes for the improver

When correctness stalls, look at which CATEGORY the failing fixtures belong to
and ensure the plan includes that category's bead. Each missing category caps
accuracy by exactly its share of the corpus, so adding one category bead lifts
the curve by that slice. Always keep the `ascii` foundational bead and the
`harness` join bead. Never drop a category tag and never invent a new one outside
the allowed set.
