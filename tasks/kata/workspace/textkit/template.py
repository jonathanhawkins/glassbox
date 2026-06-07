"""Minimal ``{name}`` template rendering.

Replaces each ``{name}`` placeholder (where ``name`` matches ``\\w+``) with the
string form of the matching keyword argument. Placeholders without a provided
value are left unchanged.
"""

import re

_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def render(tpl: str, **vars: object) -> str:
    """Render ``tpl`` by substituting ``{name}`` placeholders from ``vars``.

    Unknown placeholders are left literally unchanged.

    Examples:
        render("Hi {name}", name="Sam") -> "Hi Sam"
        render("{a}+{b}={c}", a=1, b=2, c=3) -> "1+2=3"
        render("keep {unknown}") -> "keep {unknown}"
        render("{x} and {x}", x="y") -> "y and y"
        render("no vars") -> "no vars"
    """

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in vars:
            return str(vars[name])
        return match.group(0)

    return _PLACEHOLDER.sub(_replace, tpl)
