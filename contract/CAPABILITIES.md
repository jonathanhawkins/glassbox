# Tokenizer task: group taxonomy (the self-improvement lever)

This is the shared contract for the **tokenizer task** between the tokenizer
(tokenizer-rs), the planner (agents/planner), and the validator (agents/validator +
harness). It is one task's group taxonomy: the textkit task defines its own groups (its
pytest modules). The goal: an incomplete tokenizer genuinely fails a class of inputs,
so the oracle (exact token-ID match against tiktoken gpt2, on the real built binary)
returns an intermediate accuracy, and the correctness curve climbs honestly as the
swarm writes the missing pretokenizer feature and the improver adds the missing bead.

There is **no gating**. Earlier versions emitted a wrong-token sentinel for disabled
categories; that is removed. The binary always runs the exact tiktoken algorithm over
whatever its source (`tokenizer-rs/src/pretok.rs`) currently defines, so accuracy is a
genuine consequence of the code the workers write.

## Groups (the scoring capabilities)

Each corpus line belongs to exactly ONE group, chosen by this priority order (first
match wins). The classifier lives in the fixture generator; the corpus is balanced so
each group has a meaningful share. The fixtures carry a `category` field used only to
report a per-group (by_group) pass/fail breakdown, which steers the improver.

1. `emoji`        line contains any Unicode codepoint >= 0x2600 (emoji, dingbats, symbols).
2. `unicode`      line contains any non-ASCII codepoint (>= 0x80) and is not `emoji`.
3. `code`         line contains a code marker ("def ", "fn ", "let ", "const ", "SELECT ", "git ", "();", "->", "::", "{", "}", "[", "]").
4. `numbers`      line contains an ASCII digit 0-9.
5. `whitespace`   line has a leading space, a trailing space, a tab, or an internal double-space.
6. `punctuation`  line contains a contraction, quote, or heavy punctuation (' " ! ? ( ) ; : , . / [ ] { }).
7. `ascii`        default. Plain ASCII letters and single spaces.

`ascii` is the foundational group (plain text), always present in the baseline.

## How a group is covered (genuinely)

Correctness for the tokenizer lives in its pretokenizer regex (`pretok.rs`): tiktoken
splits text with the gpt2 regex, then byte-pair-merges each piece. A partial regex
carves the wrong pieces for some inputs and those lines fail the oracle's exact match.
A worker covers a group by writing the regex branch / letter-class / byte handling
that makes that class of input tokenize correctly (the model authors it; a vetted
reference render is the fallback). Adding a group is a real code change, graded by the
real binary. Note that some groups overlap in the regex (the symbol branch that fixes
`punctuation` also helps `code` and `emoji`), so the per-group steps are uneven, which
is honest.

## Beads -> group (planner)

The planner decomposes the goal into the foundational `ascii` bead, one bead per
covered group, and a structural `harness` join bead. Each group bead depends on
`ascii`; `harness` depends on all of them (so the group beads are parallelizable once
`ascii` is done). Titles come from the task's SkillConfig.

## Validator / curve

The workers author the source; the validator BUILDS the crate and runs the oracle
over the full corpus on the real binary (no caps). Accuracy = fraction of corpus lines
whose token IDs match exactly. The per-group breakdown (`by_group`) tells the improver
which group is the biggest gap. The leaderboard ZADDs score=accuracy,
member=planner_version, under the per-task key `glassbox:planner_scores:tokenizer`.

The improver reads the real per-group failures and rewrites the planner skill to add
the missing group's bead. More groups written -> higher accuracy -> the curve climbs.

## fixtures.jsonl

Each row is `{"text": str, "ids": [int], "category": str}` where `category` is the
classifier result above. The corpus is balanced across the 7 groups. The oracle scores
by exact token-ID match on the real binary; the category field is for the by_group
breakdown and corpus balance, never a scoring shortcut.
