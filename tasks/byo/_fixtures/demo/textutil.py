"""Tiny text helpers. Deliberately seeded with one fixable bug for the BYO demo."""


def shout(s):
    # BUG: should upper-case, not lower-case.
    return s.lower()


def repeat(s, n):
    return s * n
