from textkit import render


def test_single_var():
    assert render("Hi {name}", name="Sam") == "Hi Sam"


def test_multiple_vars_non_string():
    assert render("{a}+{b}={c}", a=1, b=2, c=3) == "1+2=3"


def test_unknown_left_unchanged():
    assert render("keep {unknown}") == "keep {unknown}"


def test_repeated_var():
    assert render("{x} and {x}", x="y") == "y and y"


def test_no_vars():
    assert render("no vars") == "no vars"
