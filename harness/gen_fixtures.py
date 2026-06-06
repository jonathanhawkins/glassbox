"""Generate the oracle ground truth from tiktoken gpt2.

Outputs (all under harness/data/, committed as ground truth):
  - gpt2.tiktoken    exact mergeable ranks (base64(token) <space> rank), the SAME
                     data the Rust port must load to match tiktoken byte-for-byte
  - meta.json        regex pattern, special tokens, n_vocab
  - corpus.txt       one text per line (no internal newlines)
  - fixtures.jsonl   {"text": ..., "ids": [...]} canonical token IDs per line

Run: uv run python harness/gen_fixtures.py
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

LITERALS: list[str] = [
    "Hello, world!",
    "The quick brown fox jumps over the lazy dog.",
    "She said, \"It's a beautiful day, isn't it?\"",
    "Agent swarms are black boxes; Glassbox is the glass cockpit.",
    "Weave traces every session, turn, and sub-agent.",
    "Redis Streams carry the live event bus for the cockpit.",
    "tiktoken gives us a hard oracle: exact token-ID match.",
    "Don't count your chickens before they hatch.",
    "    leading and trailing spaces should round-trip    ",
    "Tabs\tand   multiple    spaces   matter.",
    "Numbers: 0 1 2 3 42 1000 3.14159 -273.15 1e9 0xFF 0b1010.",
    "Dates like 2026-06-06 and times like 13:45:07 appear often.",
    "Email: jonathan@whiteelkstudios.com, URL: https://wandb.ai/glassbox.",
    "Punctuation!?... (parentheses) [brackets] {braces} <angles> /slashes/.",
    "snake_case, camelCase, PascalCase, kebab-case, SCREAMING_SNAKE.",
    "def encode(text: str) -> list[int]: return bpe(text)",
    "fn main() { println!(\"{}\", tokenize(input)); }",
    "const xs = arr.map((x) => x * 2).filter(Boolean);",
    "SELECT id, title FROM beads WHERE status = 'ready';",
    "git commit -m \"Phase 1: oracle harness + tokenizer skeleton\"",
    "Café, naïve, résumé, jalapeño, Zürich, Köln, Malmö.",
    "Россия, Москва; Ελλάδα, Αθήνα; 日本語, 東京; 中文, 北京.",
    "العربية مرحبا بالعالم; עברית שלום עולם.",
    "Emoji: 🤖🚀🔥✨🧠📊🎯 and a family 👨‍👩‍👧‍👦 and flags 🇺🇸🇯🇵.",
    "Math: ∑ x_i = ∫ f(x) dx ≈ 3.14; α + β ≠ γ; ∞ > 0.",
    "Mixed 中文 with English and 123 and 🤖 in one line.",
    "Whitespace   between   words,\tand a trailing tab\t",
    "A very very very very very very very long run of repeated words words words.",
    "BPE merges rank-based adjacent pairs until none remain.",
    "The planner rewrites its own skill from the Weave evals.",
]


def build_corpus() -> list[str]:
    lines: list[str] = list(LITERALS)
    for i in range(1, 46):
        lines.append(f"The value of x{i} is {i * 7} and y is {i / 3:.4f}.")
        lines.append(f"def func_{i}(a, b): return a * {i} + b  # comment number {i}")
        lines.append(f"let mut v{i}: Vec<u32> = vec![{i}, {i + 1}, {i + 2}];")
        lines.append(f"Item {i}: price ${i * 1.25:.2f}, qty {i}, total ${i * i * 1.25:.2f}.")
    for word in ("tokenizer", "coordinator", "validation", "improvement", "observability"):
        lines.append(f"We talk about {word} and {word}s and {word}-driven design a lot.")
    # de-duplicate and strip any internal newlines (one text per line invariant)
    seen: set[str] = set()
    clean: list[str] = []
    for line in lines:
        line = line.replace("\r", " ").replace("\n", " ")
        if line and line not in seen:
            seen.add(line)
            clean.append(line)
    return clean


def main() -> None:
    corpus = build_corpus()
    fixtures = [{"text": t, "ids": enc.encode(t, disallowed_special=())} for t in corpus]

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
    }
    (DATA / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    total_tokens = sum(len(fx["ids"]) for fx in fixtures)
    print(f"corpus lines : {len(corpus)}")
    print(f"total tokens : {total_tokens}")
    print(f"ranks        : {len(ranks)}")
    print(f"n_vocab      : {enc.n_vocab}")
    print(f"pattern      : {enc._pat_str}")
    print(f"special      : {enc._special_tokens}")
    print(f"wrote        : {DATA}")


if __name__ == "__main__":
    main()
