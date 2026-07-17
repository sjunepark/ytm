"""Opt-in tests of the public API against the live KIS-NET service."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import pytest
from hypothesis import Phase, given, settings
from hypothesis import strategies as st

from kisnet_ytm import Matrix, fetch_matrix, list_kinds

pytestmark = pytest.mark.live


@dataclass(frozen=True)
class LiveConfig:
    base_date: date
    kind: str
    lookback: int


LIVE_SAMPLE_KINDS = ("국채", "지방채", "특수채")


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

    assert_live_matrix(matrix, live_config.base_date, live_config.lookback)


@pytest.mark.live_property
@settings(max_examples=3, deadline=None, phases=[Phase.generate])
@given(
    days_before_base=st.integers(min_value=0, max_value=2),
    kind=st.sampled_from(LIVE_SAMPLE_KINDS),
)
def test_live_generated_matrix_sample(
    live_config: LiveConfig,
    days_before_base: int,
    kind: str,
) -> None:
    requested_date = live_config.base_date - timedelta(days=days_before_base)
    matrix = fetch_matrix(
        requested_date,
        kind,
        previous_available_days=live_config.lookback,
    )

    assert_live_matrix(matrix, requested_date, live_config.lookback)
    assert matrix.kind.name == kind


def assert_live_matrix(matrix: Matrix, requested_date: date, lookback: int) -> None:
    earliest_date = requested_date - timedelta(days=lookback)

    assert earliest_date <= matrix.base_date <= requested_date
    assert matrix.requested_date == requested_date
    assert matrix.date_resolution.attempted_dates[0] == requested_date
    assert matrix.date_resolution.attempted_dates[-1] == matrix.base_date
    assert matrix.rows
    assert matrix.tenors
    assert all(row.yields.keys() == row.yield_text.keys() for row in matrix.rows)
    assert any(value is not None for row in matrix.rows for value in row.yields.values())
