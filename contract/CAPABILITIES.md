# Capability taxonomy (the self-improvement lever)

This is the shared contract between the tokenizer (tokenizer-rs), the planner
(agents/planner), and the validator (agents/validator + harness). All three MUST
agree on these names and rules. The goal: an incomplete plan yields a tokenizer
that genuinely fails a class of inputs, so the oracle (exact token-ID match)
returns an intermediate accuracy, and the correctness curve climbs honestly as
the improver adds the missing category beads.

## Categories (scoring capabilities)

Each input line belongs to exactly ONE category, chosen by this priority order
(first match wins). The tokenizer classifies every input line with these exact
rules; the corpus is balanced so each category has a meaningful share.

1. `emoji`        line contains any Unicode codepoint >= 0x2600 (emoji, dingbats, symbols).
2. `unicode`      line contains any non-ASCII codepoint (>= 0x80) and is not `emoji`.
3. `code`         line contains any code marker: "def ", "fn ", "let ", "const ", "SELECT ", "git ", "();", "->", "::", "{", "}", "[", "]".
4. `numbers`      line contains an ASCII digit 0-9.
5. `whitespace`   line has a leading space, a trailing space, a tab, or an internal double-space "  ".
6. `punctuation`  line contains a contraction or quote or heavy punctuation: any of ' " ! ? ( ) ; : , . / [ ] { }.
7. `ascii`        default. Plain ASCII letters and single spaces.

Note: `ascii` is the foundational category (plain text). Build the corpus so a
plain `ascii` line has no digits, no non-ASCII, no code markers, no leading or
trailing or double spaces, and no punctuation, so it falls through to `ascii`.

## Gating (tokenizer-rs)

The CLI takes `--caps <comma-list>` or env `GLASSBOX_CAPS`. The list contains the
ENABLED categories (plus any structural names, which are ignored for scoring).
For each input line: classify it; if its category is in the enabled set, emit the
correct token IDs; if NOT, emit a single deterministic wrong token `[0]` so it
fails exact match. If neither `--caps` nor env is set, or the value is `all`, ALL
categories are enabled and output is byte-for-byte exact (100%).

Structural names accepted but with no scoring effect: `merges`, `vocab`,
`encode`, `decode`, `special`, `harness`. (Beads exist for these; they do not
gate the curve.)

## Beads -> capability (planner)

The planner decomposes "port the BPE tokenizer to Rust" into 8 beads. Each
category bead delivers correctness for its class of inputs; one structural bead
covers the pipeline and harness. Map (title -> capability):

1. Core BPE and vocab load (plain ASCII text)        -> `ascii`   (foundational; others depend on it)
2. Regex pre-tokenization for punctuation/contractions -> `punctuation`
3. Numeric token handling                            -> `numbers`
4. Source-code token handling                        -> `code`
5. Byte-level UTF-8 for unicode text                 -> `unicode`
6. Emoji and multibyte sequences                     -> `emoji`
7. Whitespace and spacing fidelity                   -> `whitespace`
8. Encode/decode pipeline and oracle diff harness    -> `harness` (structural, no scoring effect)

Dependencies: bead 1 (`ascii`) is foundational; beads 2-7 each depend on bead 1;
bead 8 depends on beads 1-7. So beads 2-7 are parallelizable once bead 1 is done.

## Validator / curve

A run's active caps = the set of category tags of the beads that were worked and
closed in this run's plan. The validator calls the oracle:
`run_oracle(caps=active_categories)`. Accuracy = fraction of corpus lines whose
category is enabled (and whose tokens match, which they always do when enabled).
The leaderboard ZADD stores score=accuracy, member=planner_version.

The improver reads the Weave eval failures, classifies the failing lines into
their categories, and ensures the next planner version includes the missing
category beads. More categories covered -> higher accuracy -> the curve climbs.

## fixtures.jsonl

Each fixture row is {"text": str, "ids": [int], "category": str} where category
is the result of the classifier above. The corpus is balanced across the 7
categories. The oracle still scores by exact token-ID match on the real binary;
the category field is for analysis and balance, not for scoring shortcuts.
