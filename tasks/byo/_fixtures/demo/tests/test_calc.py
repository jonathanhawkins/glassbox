from calc import add, double


def test_add():
    assert add(2, 3) == 5
    assert add(-1, 1) == 0


def test_double():
    assert double(4) == 8
