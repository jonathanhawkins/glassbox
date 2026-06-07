"""textkit: a small collection of text utilities."""

from .slug import slugify
from .wrap import wrap_words
from .numbers import comma
from .template import render

__all__ = ["slugify", "wrap_words", "comma", "render"]
