from textkit import slugify


def test_basic_punctuation():
    assert slugify("Hello, World!") == "hello-world"


def test_collapse_multiple_spaces():
    assert slugify("  Multiple   Spaces ") == "multiple-spaces"


def test_underscores_and_dots():
    assert slugify("Foo_Bar.Baz") == "foo-bar-baz"


def test_trim_leading_trailing_hyphens():
    assert slugify("--Trim--") == "trim"


def test_empty_string():
    assert slugify("") == ""


def test_already_slug():
    assert slugify("already-a-slug") == "already-a-slug"
