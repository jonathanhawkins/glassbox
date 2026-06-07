from textkit import comma


def test_zero():
    assert comma(0) == "0"


def test_thousand():
    assert comma(1000) == "1,000"


def test_millions():
    assert comma(1234567) == "1,234,567"


def test_negative():
    assert comma(-9876543) == "-9,876,543"


def test_under_thousand():
    assert comma(100) == "100"
