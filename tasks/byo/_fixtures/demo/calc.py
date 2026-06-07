"""A tiny calculator. Deliberately seeded with one fixable bug for the BYO demo."""


def add(a, b):
    # BUG: should return the sum, not the difference.
    return a - b


def double(a):
    return a * 2
