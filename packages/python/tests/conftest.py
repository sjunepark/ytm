"""Pytest controls for checks that call the live KIS-NET service."""

from __future__ import annotations

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("live KIS-NET")
    group.addoption(
        "--live-kisnet",
        action="store_true",
        help="run tests that make requests to the live KIS-NET service",
    )
    group.addoption(
        "--live-base-date",
        help="requested date for live tests (YYYY-MM-DD; defaults to today)",
    )
    group.addoption(
        "--live-kind",
        default="국채",
        help="KIS-NET kind code or label for live tests (default: 국채)",
    )
    group.addoption(
        "--live-lookback",
        default=10,
        type=int,
        help="maximum earlier calendar days for live tests (default: 10)",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.getoption("--live-kisnet"):
        return

    skip_live = pytest.mark.skip(reason="requires --live-kisnet and network access")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip_live)
