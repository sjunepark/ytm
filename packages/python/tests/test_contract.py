from __future__ import annotations

import json
import pickle
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from kisnet_ytm import (
    DataUnavailableError,
    DateResolution,
    InvalidInputError,
    SourceFormatError,
    SourceTransportError,
    list_kinds,
)
from kisnet_ytm._nexacro import (
    build_request_xml,
    parse_kinds_response,
    parse_matrix_response,
)
from kisnet_ytm._retrieval import fetch_matrix_from_source
from kisnet_ytm.models import Kind


def resolve_contract_directory() -> Path:
    test_file = Path(__file__).resolve()
    candidates = (
        test_file.parents[1] / "contracts" / "kisnet",
        test_file.parents[3] / "contracts" / "kisnet",
    )
    for candidate in candidates:
        if (candidate / "cases.json").is_file():
            return candidate
    raise RuntimeError("KIS-NET contract fixtures are missing from the source tree")


CONTRACT_DIRECTORY = resolve_contract_directory()
CONTRACT = json.loads((CONTRACT_DIRECTORY / "cases.json").read_text(encoding="utf-8"))
FIXTURES = {
    name: (CONTRACT_DIRECTORY / filename).read_text(encoding="utf-8")
    for name, filename in CONTRACT["fixtures"].items()
}
REQUESTED_DATE = date.fromisoformat(CONTRACT["request"]["baseDate"])


@dataclass
class FixtureSource:
    matrix_by_date: dict[date, str]
    empty_kind_dates: set[date] = field(default_factory=set)
    calls: list[tuple[str, date]] = field(default_factory=list)

    def list_kinds(self, base_date: date) -> tuple[Kind, ...]:
        self.calls.append(("kinds", base_date))
        if base_date in self.empty_kind_dates:
            return ()
        return parse_kinds_response(FIXTURES["init"])

    def fetch_rows(self, base_date: date, kind_code: str) -> tuple[dict[str, str], ...]:
        self.calls.append((f"matrix:{kind_code}", base_date))
        return parse_matrix_response(self.matrix_by_date[base_date])


@pytest.mark.parametrize("fixture_name", ["initMalformedMixed", "initMalformedAll"])
def test_malformed_kind_rows_are_source_format_errors(fixture_name: str) -> None:
    with pytest.raises(SourceFormatError):
        parse_kinds_response(FIXTURES[fixture_name])


def test_request_mapping_and_canonical_tenors() -> None:
    request = build_request_xml(REQUESTED_DATE, CONTRACT["request"]["kind"]["code"], initial=False)

    assert f'<Col id="calBaseDt">{CONTRACT["request"]["baseDateCompact"]}</Col>' in request
    assert f'<Col id="cboYtmSort">{CONTRACT["request"]["kind"]["code"]}</Col>' in request
    assert CONTRACT["request"]["matrixEndpoint"] in request

    result = fetch_matrix_from_source(
        FixtureSource({REQUESTED_DATE: FIXTURES["matrix"]}),
        REQUESTED_DATE,
        CONTRACT["request"]["kind"]["name"],
    )
    assert result.tenors == tuple(item["label"] for item in CONTRACT["canonicalTenors"])
    assert result.base_date == REQUESTED_DATE
    assert result.requested_date == REQUESTED_DATE
    assert result.date_resolution.attempted_dates == (REQUESTED_DATE,)
    assert not result.date_resolution.used_previous_available
    assert (
        result.rows[0].pricing_group_code == CONTRACT["expectations"]["matrix"]["pricingGroupCode"]
    )
    assert result.rows[0].yields["3M"] == Decimal(CONTRACT["expectations"]["matrix"]["threeMonth"])
    assert result.rows[0].yields["10Y"] == Decimal(CONTRACT["expectations"]["matrix"]["tenYear"])


def test_missing_yield_values_preserve_source_text() -> None:
    result = fetch_matrix_from_source(
        FixtureSource({REQUESTED_DATE: FIXTURES["missingValues"]}),
        REQUESTED_DATE,
        "10",
    )

    for tenor in CONTRACT["expectations"]["missingValues"]["nullTenors"]:
        assert result.rows[0].yields[tenor] is None
        assert (
            result.rows[0].yield_text[tenor]
            == CONTRACT["expectations"]["missingValues"]["rawValues"][tenor]
        )


def test_exact_unavailable_records_only_requested_date() -> None:
    with pytest.raises(DataUnavailableError) as caught:
        fetch_matrix_from_source(
            FixtureSource({REQUESTED_DATE: FIXTURES["unavailable"]}),
            REQUESTED_DATE,
            "국채",
        )

    assert caught.value.requested_date == REQUESTED_DATE
    assert caught.value.attempted_dates == (REQUESTED_DATE,)


def test_data_unavailable_error_round_trips_through_pickle() -> None:
    error = DataUnavailableError(
        "fixture unavailable",
        requested_date=REQUESTED_DATE,
        attempted_dates=(REQUESTED_DATE,),
    )

    restored = pickle.loads(pickle.dumps(error))

    assert type(restored) is DataUnavailableError
    assert str(restored) == str(error)
    assert restored.requested_date == error.requested_date
    assert restored.attempted_dates == error.attempted_dates


def test_previous_available_probes_calendar_dates_in_order() -> None:
    previous_one = date(2026, 6, 7)
    previous_two = date(2026, 6, 6)
    resolved = date(2026, 6, 5)
    source = FixtureSource(
        {
            previous_two: FIXTURES["unavailable"],
            resolved: FIXTURES["matrix"],
        },
        empty_kind_dates={previous_one},
    )

    result = fetch_matrix_from_source(
        source,
        previous_one,
        "국채",
        previous_available_days=2,
    )

    assert result.base_date == resolved
    assert result.date_resolution.attempted_dates == (previous_one, previous_two, resolved)
    assert result.date_resolution.used_previous_available
    assert source.calls == [
        ("kinds", previous_one),
        ("kinds", previous_two),
        ("matrix:10", previous_two),
        ("kinds", resolved),
        ("matrix:10", resolved),
    ]


@pytest.mark.parametrize("fixture_name", ["malformed", "invalidNumeric", "missingColumn"])
def test_source_format_failures_stop_fallback(fixture_name: str) -> None:
    source = FixtureSource({REQUESTED_DATE: FIXTURES[fixture_name]})

    with pytest.raises(SourceFormatError):
        fetch_matrix_from_source(
            source,
            REQUESTED_DATE,
            "국채",
            previous_available_days=10,
        )

    assert source.calls == [("kinds", REQUESTED_DATE), ("matrix:10", REQUESTED_DATE)]


def test_transport_failure_stops_fallback() -> None:
    class FailedSource:
        def list_kinds(self, base_date: date) -> tuple[Kind, ...]:
            raise SourceTransportError("fixture transport failure")

        def fetch_rows(self, base_date: date, kind_code: str) -> tuple[dict[str, str], ...]:
            raise AssertionError("matrix must not be called")

    with pytest.raises(SourceTransportError):
        fetch_matrix_from_source(
            FailedSource(),
            REQUESTED_DATE,
            "국채",
            previous_available_days=10,
        )


@pytest.mark.parametrize(
    ("base_date", "kind", "previous_available_days"),
    [
        ("2026-06-08", "국채", None),
        (REQUESTED_DATE, "", None),
        (REQUESTED_DATE, "국채", -1),
        (REQUESTED_DATE, "국채", 32),
        (REQUESTED_DATE, "국채", 1_000_000_000),
        (REQUESTED_DATE, "국채", True),
        (date.min, "국채", 1),
    ],
)
def test_invalid_inputs_are_explicit(
    base_date: object,
    kind: str,
    previous_available_days: int | None,
) -> None:
    with pytest.raises(InvalidInputError):
        fetch_matrix_from_source(
            FixtureSource({}),
            cast(date, base_date),
            kind,
            previous_available_days=previous_available_days,
        )


@pytest.mark.parametrize("previous_available_days", [0, 31])
def test_previous_available_days_accepts_documented_boundaries(
    previous_available_days: int,
) -> None:
    source = FixtureSource({REQUESTED_DATE: FIXTURES["matrix"]})

    result = fetch_matrix_from_source(
        source,
        REQUESTED_DATE,
        "국채",
        previous_available_days=previous_available_days,
    )

    assert result.base_date == REQUESTED_DATE
    assert result.date_resolution.previous_available_days == previous_available_days


def test_date_resolution_rejects_lookback_above_public_limit() -> None:
    with pytest.raises(ValidationError):
        DateResolution(
            requested_date=REQUESTED_DATE,
            resolved_date=REQUESTED_DATE,
            attempted_dates=(REQUESTED_DATE,),
            previous_available_days=32,
            used_previous_available=False,
        )


def test_list_kinds_without_a_date_is_network_free() -> None:
    assert list_kinds()[0] == Kind(code="10", name="국채")
