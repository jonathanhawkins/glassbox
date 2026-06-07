from textkit import wrap_words


def test_basic_wrap():
    assert wrap_words("the quick brown fox", 9) == ["the quick", "brown fox"]


def test_pack_single_chars():
    assert wrap_words("a b c d", 3) == ["a b", "c d"]


def test_single_word():
    assert wrap_words("hello", 3) == ["hello"]


def test_empty_text():
    assert wrap_words("", 5) == []


def test_word_longer_than_width_gets_own_line():
    assert wrap_words("supercalifragilistic ok", 5) == ["supercalifragilistic", "ok"]
