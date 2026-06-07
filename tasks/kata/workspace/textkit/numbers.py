"""Integer formatting helpers."""


def comma(n: int) -> str:
    """Format integer ``n`` with thousands separators (commas).

    Handles negatives.

    Examples:
        comma(0) -> "0"
        comma(1000) -> "1,000"
        comma(1234567) -> "1,234,567"
        comma(-9876543) -> "-9,876,543"
        comma(100) -> "100"
    """
    return f"{n:,}"
