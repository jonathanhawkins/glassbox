"""Greedy word wrapping.

Packs whitespace-separated words into lines of at most ``width`` characters,
counting the single space between words toward the width. Words longer than
``width`` are never split and get their own line.
"""


def wrap_words(text: str, width: int) -> list[str]:
    """Greedily wrap ``text`` into lines no longer than ``width`` chars.

    Examples:
        wrap_words("the quick brown fox", 9) -> ["the quick", "brown fox"]
        wrap_words("a b c d", 3) -> ["a b", "c d"]
        wrap_words("hello", 3) -> ["hello"]
        wrap_words("", 5) -> []
    """
    words = text.split()
    if not words:
        return []

    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        if len(current) + 1 + len(word) <= width:
            current = f"{current} {word}"
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines
