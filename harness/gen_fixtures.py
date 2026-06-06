"""Generate the oracle ground truth from tiktoken gpt2, BALANCED across the 7
capability categories defined in contract/CAPABILITIES.md.

The corpus is the lever for the self-improvement curve: each input line belongs
to exactly ONE category (by the priority rules below), the categories are roughly
balanced (~25-35 lines each, ~210-230 total), and every line is constructed so it
classifies into its INTENDED category under the exact rules. When the Rust
tokenizer gates on a set of enabled categories, accuracy equals the fraction of
corpus lines whose category is enabled, so adding category beads climbs the curve
honestly.

Outputs (all under harness/data/, committed as ground truth):
  - gpt2.tiktoken    exact mergeable ranks (base64(token) <space> rank), the SAME
                     data the Rust port must load to match tiktoken byte-for-byte
  - meta.json        regex pattern, special tokens, n_vocab, categories list
  - corpus.txt       one text per line (no internal newlines)
  - fixtures.jsonl   {"text","ids","category"} canonical token IDs + category

Run: uv run python harness/gen_fixtures.py
(Use dangerouslyDisableSandbox; tiktoken may touch the network on first use,
though the gpt2 encoding is normally cached.)
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

import tiktoken

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "harness" / "data"
DATA.mkdir(parents=True, exist_ok=True)

enc = tiktoken.get_encoding("gpt2")

# ---------------------------------------------------------------------------
# Category taxonomy (mirror of contract/CAPABILITIES.md and tokenizer-rs).
# Priority order, first match wins:
#   1 emoji        any codepoint >= 0x2600
#   2 unicode      any non-ASCII codepoint (>= 0x80), not emoji
#   3 code         any code marker substring
#   4 numbers      any ASCII digit 0-9
#   5 whitespace   leading/trailing space, a tab, or an internal double-space
#   6 punctuation  any of ' " ! ? ( ) ; : , . / [ ] { }
#   7 ascii        default (plain ASCII letters and single spaces)
# ---------------------------------------------------------------------------

CATEGORIES = ["ascii", "punctuation", "numbers", "code", "unicode", "emoji", "whitespace"]

CODE_MARKERS = [
    "def ", "fn ", "let ", "const ", "SELECT ", "git ",
    "();", "->", "::", "{", "}", "[", "]",
]
PUNCT_SET = set("'\"!?();:,./[]{}")


def classify(line: str) -> str:
    """Classify a line into exactly one category (mirror of the Rust classify)."""
    # 1 emoji: any codepoint >= 0x2600.
    if any(ord(c) >= 0x2600 for c in line):
        return "emoji"
    # 2 unicode: any non-ASCII codepoint (>= 0x80) and not emoji.
    if any(ord(c) >= 0x80 for c in line):
        return "unicode"
    # 3 code: any code marker substring.
    if any(m in line for m in CODE_MARKERS):
        return "code"
    # 4 numbers: any ASCII digit.
    if any(("0" <= c <= "9") for c in line):
        return "numbers"
    # 5 whitespace: leading/trailing space, a tab, or an internal double-space.
    if line[:1] == " " or line[-1:] == " " or "\t" in line or "  " in line:
        return "whitespace"
    # 6 punctuation: any char in the punctuation set.
    if any(c in PUNCT_SET for c in line):
        return "punctuation"
    # 7 ascii: default.
    return "ascii"


# A pool of plain ASCII words (no digits, no punctuation, no non-ASCII). Used as
# filler so generated lines read like real text while staying in their category.
WORDS = [
    "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "river",
    "stone", "cloud", "maple", "silver", "forest", "ocean", "quiet", "amber",
    "cedar", "harbor", "meadow", "ranger", "velvet", "copper", "willow",
    "garden", "sparrow", "thunder", "marble", "lantern", "compass", "anchor",
    "harvest", "morning", "shadow", "valley", "summit", "ember", "frost",
    "glimmer", "hollow", "ridge", "drift", "haze", "north", "south", "east",
    "west", "wander", "linger", "gather",
]


def _w(i: int) -> str:
    return WORDS[i % len(WORDS)]


# ---------------------------------------------------------------------------
# Per-category line generators. Each returns ~30 lines that all classify into
# the intended category. Constraints per category:
#   ascii        plain words + single spaces only.
#   punctuation  a safe punct char (NOT a code-marker bracket), no digits, no
#                non-ASCII, no whitespace trigger, no code-marker substrings.
#   numbers      contains a digit; no non-ASCII, no emoji, no code markers.
#   code         contains a code marker; no non-ASCII, no emoji.
#   unicode      contains a non-ASCII cp in [0x80, 0x2600); everything else lower.
#   emoji        contains a cp >= 0x2600.
#   whitespace   leading/trailing/tab/double-space; plain ASCII letters only
#                (no digits, no punct, no code markers, no non-ASCII).
# ---------------------------------------------------------------------------

def gen_ascii(n: int) -> list[str]:
    out = []
    for i in range(n):
        a, b, c, d = _w(i), _w(i * 3 + 1), _w(i * 5 + 2), _w(i * 7 + 3)
        out.append(f"the {a} and the {b} near a {c} and a {d}")
    return out


def gen_punctuation(n: int) -> list[str]:
    # Only safe punctuation: comma, period, semicolon, colon, bang, question,
    # parens, slash, apostrophe, double quote. NEVER use [] {} (code markers),
    # and avoid the literal substrings "();", "::", "->".
    forms = [
        "oh, the {a}; truly, the {b}, indeed so",
        "really, yes, the {a} and the {b} both",
        "wait, the {a} and the {b}, surely now",
        "yes, the {a} and the {b} as well, fine",
        "the {a} or the {b}, a real choice here",
        "note, the {a} and the {b} matter, yes",
        "it is the {a} way and the {b} way, too",
        'he said, "the {a} and {b}", quite softly',
        "is it the {a}, or is it the {b}, friend",
        "well, the {a}; also, the {b}; and more",
        "good, the {a}, and better, the {b}, sir",
        "the {a}, the {b}, and the rest, in turn",
    ]
    out = []
    for i in range(n):
        f = forms[i % len(forms)]
        out.append(f.format(a=_w(i), b=_w(i * 2 + 1)))
    return out


def gen_numbers(n: int) -> list[str]:
    # Contains an ASCII digit. May contain punctuation (lower priority). No code
    # markers, no non-ASCII, no emoji.
    forms = [
        "the {a} counted {n} stones by the {b}",
        "there were {n} of them near the {a} hill",
        "we walked {n} miles past the {a} and {b}",
        "the {a} weighed {n} pounds that morning",
        "exactly {n} birds rose above the {a} trees",
        "the {a} took {n} turns around the {b} pond",
        "she found {n} shells along the {a} shore",
        "the {a} held {n} lanterns through the night",
    ]
    out = []
    for i in range(n):
        f = forms[i % len(forms)]
        out.append(f.format(a=_w(i), b=_w(i * 2 + 1), n=(i * 7 + 3)))
    return out


def gen_code(n: int) -> list[str]:
    # Contains a code marker. ASCII only (no non-ASCII, no emoji). Digits and
    # punctuation are allowed (lower priority than code).
    forms = [
        "def handle_{a}(value): return value",
        "fn compute_{a}(input): tokenize the input",
        "let result = make_{a}(value)",
        "const total = sum_{a}(values)",
        "SELECT name from {a} where active",
        "git commit the {a} and push it",
        "node.run({a})();",
        "value -> the {a} pipeline",
        "module::{a} loads the table",
        "open the brace then close it {x}",
        "index the list at slot [k]",
        "the map of {a} keys [here]",
    ]
    out = []
    for i in range(n):
        f = forms[i % len(forms)]
        out.append(f.format(a=_w(i), x="{ }"))
    return out


def gen_unicode(n: int) -> list[str]:
    # Contains a non-ASCII codepoint in [0x80, 0x2600), and NOT emoji. Use Latin
    # accents, Greek, Cyrillic, CJK. Keep everything else plain.
    accents = [
        "the cafe {a} felt naive and resume worthy: Cafe naive resume",
        "we visited Zurich and Koln and Malmo by the {a}",
        "the jalapeno and the creme brulee near the {a}",
        "Greek letters alpha beta gamma over the {a}: alpha beta",
        "Russian words near the {a}: Россия Москва город",
        "Greek city near the {a}: Ελλάδα Αθήνα Πειραιάς",
        "Japanese near the {a}: 日本語 東京 横浜 名古屋",
        "Chinese near the {a}: 中文 北京 上海 广州 深圳",
        "the naive {a} wrote a resume in a Parisian cafe",
        "Zurich {a} and Geneve and Lausanne by the lake",
    ]
    # Make sure each actually has a non-ASCII char: append a marker word.
    markers = ["café", "naïve", "résumé", "Zürich", "Köln", "Россия", "Ελλάδα",
               "日本語", "中文", "jalapeño"]
    out = []
    for i in range(n):
        base = accents[i % len(accents)].format(a=_w(i))
        # Guarantee a non-ASCII codepoint regardless of template.
        if all(ord(c) < 0x80 for c in base):
            base = f"{base} {markers[i % len(markers)]}"
        out.append(base)
    return out


def gen_emoji(n: int) -> list[str]:
    # Contains a codepoint >= 0x2600. Mix dingbats/symbols (>= 0x2600) and modern
    # emoji (>= 0x1F300) so the >= 0x2600 rule clearly fires.
    glyphs = ["🤖", "🚀", "🔥", "✨", "🧠", "📊", "🎯", "⭐", "☀", "☂", "♥",
              "✈", "✅", "⚙", "🌍", "🎉", "💡", "📈", "🛰", "🧩"]
    forms = [
        "the {a} crew launched the rocket {g}",
        "we cheered for the {a} team {g} today",
        "the {a} report shipped on time {g}",
        "a bright {a} morning by the sea {g}",
        "the {a} idea finally landed {g} well",
        "the {a} and the {b} celebrated {g}",
    ]
    out = []
    for i in range(n):
        f = forms[i % len(forms)]
        out.append(f.format(a=_w(i), b=_w(i * 2 + 1), g=glyphs[i % len(glyphs)]))
    return out


def gen_whitespace(n: int) -> list[str]:
    # Trigger via leading space, trailing space, a tab, or an internal
    # double-space. Plain ASCII letters only so nothing higher-priority fires
    # (no digits, no punctuation, no code markers, no non-ASCII).
    out = []
    for i in range(n):
        a, b, c = _w(i), _w(i * 3 + 1), _w(i * 5 + 2)
        kind = i % 4
        if kind == 0:
            out.append(f"  {a} {b} {c} with leading spaces")
        elif kind == 1:
            out.append(f"{a} {b} {c} with trailing spaces  ")
        elif kind == 2:
            out.append(f"{a}\t{b} {c} separated by a tab")
        else:
            out.append(f"the {a}  and  the {b}  with  doubles")
    return out


GENERATORS = {
    "ascii": gen_ascii,
    "punctuation": gen_punctuation,
    "numbers": gen_numbers,
    "code": gen_code,
    "unicode": gen_unicode,
    "emoji": gen_emoji,
    "whitespace": gen_whitespace,
}

# Target per-category counts (balanced, each in [25, 35], total ~217).
PER_CATEGORY = {
    "ascii": 31,
    "punctuation": 31,
    "numbers": 31,
    "code": 31,
    "unicode": 31,
    "emoji": 31,
    "whitespace": 31,
}


def build_corpus() -> list[tuple[str, str]]:
    """Build (text, intended_category) rows, balanced and de-duplicated.

    Every line is verified to classify into its intended category; if a generated
    line collides or misclassifies it is skipped and replaced by extending the
    generator, so each category hits its target count exactly.
    """
    rows: list[tuple[str, str]] = []
    seen: set[str] = set()
    for cat in CATEGORIES:
        gen = GENERATORS[cat]
        target = PER_CATEGORY[cat]
        kept = 0
        attempt = target
        # Generate in growing batches until we have `target` valid, unique lines.
        produced: list[str] = []
        idx = 0
        while kept < target:
            batch = gen(attempt + 8)
            for line in batch[idx:]:
                idx += 1
                line = line.replace("\r", " ").replace("\n", " ")
                if not line or line in seen:
                    continue
                if classify(line) != cat:
                    # Should not happen; the generators are constrained. Skip.
                    continue
                seen.add(line)
                produced.append(line)
                kept += 1
                if kept >= target:
                    break
            attempt += 16
            if attempt > target + 512:
                raise RuntimeError(
                    f"could not build {target} unique '{cat}' lines (got {kept})"
                )
        rows.extend((line, cat) for line in produced)
    return rows


def main() -> None:
    rows = build_corpus()

    # Hard invariant: every line classifies to its intended category.
    counts: dict[str, int] = {c: 0 for c in CATEGORIES}
    for text, cat in rows:
        got = classify(text)
        assert got == cat, f"line misclassified: want {cat} got {got}: {text!r}"
        assert "\n" not in text and "\r" not in text, f"newline in line: {text!r}"
        counts[cat] += 1

    # Balance invariant: each category in [25, 35], total in [210, 230].
    for cat in CATEGORIES:
        assert 25 <= counts[cat] <= 35, f"category {cat} unbalanced: {counts[cat]}"
    total = sum(counts.values())
    assert 210 <= total <= 230, f"total out of band: {total}"

    corpus = [text for text, _ in rows]
    fixtures = [
        {"text": text, "ids": enc.encode(text, disallowed_special=()), "category": cat}
        for text, cat in rows
    ]

    (DATA / "corpus.txt").write_text("\n".join(corpus) + "\n", encoding="utf-8")
    with (DATA / "fixtures.jsonl").open("w", encoding="utf-8") as f:
        for fx in fixtures:
            f.write(json.dumps(fx, ensure_ascii=False) + "\n")

    ranks: dict[bytes, int] = enc._mergeable_ranks
    with (DATA / "gpt2.tiktoken").open("w", encoding="utf-8") as f:
        for tok, rank in sorted(ranks.items(), key=lambda kv: kv[1]):
            f.write(base64.b64encode(tok).decode("ascii") + " " + str(rank) + "\n")

    meta = {
        "encoding": "gpt2",
        "n_vocab": enc.n_vocab,
        "pattern": enc._pat_str,
        "special_tokens": enc._special_tokens,
        "categories": CATEGORIES,
    }
    (DATA / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    total_tokens = sum(len(fx["ids"]) for fx in fixtures)
    print(f"corpus lines : {len(corpus)}")
    print(f"total tokens : {total_tokens}")
    print(f"ranks        : {len(ranks)}")
    print(f"n_vocab      : {enc.n_vocab}")
    print("per-category counts (balanced):")
    for cat in CATEGORIES:
        print(f"  {cat:12s} {counts[cat]}")
    print(f"wrote        : {DATA}")


if __name__ == "__main__":
    main()
