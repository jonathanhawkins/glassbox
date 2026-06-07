from textutil import repeat, shout


def test_shout():
    assert shout("hi") == "HI"


def test_repeat():
    assert repeat("ab", 2) == "abab"
