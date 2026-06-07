"""Slugify text into a URL-safe slug.

Strips and lowercases the input, collapses each run of non-alphanumeric
characters into a single hyphen, and trims leading/trailing hyphens.
"""

import re


def slugify(text: str) -> str:
    """Convert ``text`` into a lowercase, hyphen-separated slug.

    Examples:
        "Hello, World!" -> "hello-world"
        "  Multiple   Spaces " -> "multiple-spaces"
        "Foo_Bar.Baz" -> "foo-bar-baz"
        "--Trim--" -> "trim"
        "" -> ""
    """
    lowered = text.strip().lower()
    hyphenated = re.sub(r"[^a-z0-9]+", "-", lowered)
    return hyphenated.strip("-")
