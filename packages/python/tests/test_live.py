"""Opt-in tests of the public API against the live KIS-NET service."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import pytest

from kisnet_ytm import fetch_matrix, list_kinds

pytestmark = pytest.mark.live


@dataclass(frozen=True)
class LiveConfig:
    base_date: date
    kind: str
    lookback: int


@pytest.fixture(scope="module")
def live_config(pytestconfig: pytest.Config) -> LiveConfig:
    raw_base_date = pytestconfig.getoption("--live-base-date") or date.today().isoformat()
    try:
        base_date = date.fromisoformat(raw_base_date)
    except ValueError:
        pytest.fail(f"--live-base-date must use YYYY-MM-DD: {raw_base_date!r}", pytrace=False)

    return LiveConfig(
        base_date=base_date,
        kind=pytestconfig.getoption("--live-kind"),
        lookback=pytestconfig.getoption("--live-lookback"),
    )


def test_live_list_kinds(live_config: LiveConfig) -> None:
    kinds = list_kinds(live_config.base_date)

    assert kinds
    assert len({kind.code for kind in kinds}) == len(kinds)
    assert len({kind.name for kind in kinds}) == len(kinds)
    assert any(
        live_config.kind in {kind.code, kind.name}
        or "".join(live_config.kind.split()) == "".join(kind.name.split())
        for kind in kinds
    )


def test_live_fetch_matrix(live_config: LiveConfig) -> None:
    matrix = fetch_matrix(
        live_config.base_date,
        live_config.kind,
        previous_available_days=live_config.lookback,
    )

    earliest_date = live_config.base_date - timedelta(days=live_config.lookback)
    assert earliest_date <= matrix.base_date <= live_config.base_date
    assert matrix.requested_date == live_config.base_date
    assert matrix.date_resolution.attempted_dates[0] == live_config.base_date
    assert matrix.date_resolution.attempted_dates[-1] == matrix.base_date
    assert matrix.rows
    assert matrix.tenors
    assert all(row.yields.keys() == row.yield_text.keys() for row in matrix.rows)
    assert any(value is not None for row in matrix.rows for value in row.yields.values())
