"""Generated contract checks for pure parsing and date-resolution behavior."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree

import pytest
from hypothesis import given
from hypothesis import strategies as st

from kisnet_ytm import DataUnavailableError, SourceFormatError
from kisnet_ytm._nexacro import (
    INIT_ENDPOINT,
    MATRIX_ENDPOINT,
    build_request_xml,
    parse_matrix_response,
)
from kisnet_ytm._retrieval import fetch_matrix_from_source
from kisnet_ytm.models import Kind

KIND = Kind(code="10", name="국채")


def resolve_contract_directory() -> Path:
    test_file = Path(__file__).resolve()
    candidates = (
        test_file.parents[1] / "contracts" / "kisnet",
        test_file.parents[3] / "contracts" / "kisnet",
    )
    for candidate in candidates:
        if (candidate / "matrix-success.xml").is_file():
            return candidate
    raise RuntimeError("KIS-NET contract fixtures are missing from the source tree")


MATRIX_RESPONSE = (resolve_contract_directory() / "matrix-success.xml").read_text(encoding="utf-8")


@dataclass
class AvailabilitySource:
    requested_date: date
    statuses: tuple[str, ...]
    calls: list[tuple[str, date]] = field(default_factory=list)

    def _status(self, base_date: date) -> str:
        offset = (self.requested_date - base_date).days
        return self.statuses[offset]

    def list_kinds(self, base_date: date) -> tuple[Kind, ...]:
        self.calls.append(("kinds", base_date))
        return () if self._status(base_date) == "no_kinds" else (KIND,)

    def fetch_rows(self, base_date: date, kind_code: str) -> tuple[dict[str, str], ...]:
        self.calls.append((f"matrix:{kind_code}", base_date))
        return (
            parse_matrix_response(MATRIX_RESPONSE) if self._status(base_date) == "success" else ()
        )


@dataclass
class RowSource:
    response: str

    def list_kinds(self, base_date: date) -> tuple[Kind, ...]:
        return (KIND,)

    def fetch_rows(self, base_date: date, kind_code: str) -> tuple[dict[str, str], ...]:
        return parse_matrix_response(self.response)


@given(
    requested_date=st.dates(min_value=date.min + timedelta(days=31), max_value=date.max),
    statuses=st.lists(
        st.sampled_from(("no_kinds", "no_rows", "success")),
        min_size=1,
        max_size=32,
    ),
)
def test_fallback_matches_generated_availability_model(
    requested_date: date,
    statuses: list[str],
) -> None:
    source = AvailabilitySource(requested_date, tuple(statuses))
    success_offset = next(
        (offset for offset, status in enumerate(statuses) if status == "success"),
        None,
    )
    final_offset = success_offset if success_offset is not None else len(statuses) - 1
    expected_dates = tuple(
        requested_date - timedelta(days=offset) for offset in range(final_offset + 1)
    )

    if success_offset is None:
        with pytest.raises(DataUnavailableError) as caught:
            fetch_matrix_from_source(
                source,
                requested_date,
                KIND.name,
                previous_available_days=len(statuses) - 1,
            )

        assert caught.value.attempted_dates == expected_dates
    else:
        matrix = fetch_matrix_from_source(
            source,
            requested_date,
            KIND.name,
            previous_available_days=len(statuses) - 1,
        )

        assert matrix.base_date == expected_dates[-1]
        assert matrix.date_resolution.attempted_dates == expected_dates
        assert matrix.date_resolution.used_previous_available == (success_offset != 0)

    expected_calls: list[tuple[str, date]] = []
    for offset, attempted_date in enumerate(expected_dates):
        expected_calls.append(("kinds", attempted_date))
        if statuses[offset] != "no_kinds":
            expected_calls.append((f"matrix:{KIND.code}", attempted_date))
    assert source.calls == expected_calls


CANONICAL_DECIMAL_TEXT = st.from_regex(
    r"[+-]?(?:[0-9]{1,20}(?:\.[0-9]{0,20})?|\.[0-9]{1,20})",
    fullmatch=True,
)


@given(
    raw=CANONICAL_DECIMAL_TEXT,
    leading=st.sampled_from(("", " ", "\t")),
    trailing=st.sampled_from(("", " ", "\t")),
)
def test_canonical_numeric_text_round_trips(raw: str, leading: str, trailing: str) -> None:
    response = MATRIX_RESPONSE.replace(
        '<Col id="m3">2.500</Col>',
        f'<Col id="m3">{leading}{raw}{trailing}</Col>',
        1,
    )

    matrix = fetch_matrix_from_source(RowSource(response), date(2026, 6, 8), KIND.name)

    assert matrix.rows[0].yield_text["3M"] == raw
    assert matrix.rows[0].yields["3M"] == Decimal(raw)


NONCANONICAL_DECIMAL_TEXT = st.one_of(
    st.from_regex(
        r"[+-]?[0-9]{1,12}(?:_[0-9]+|[eE][+-]?[0-9]+|,[0-9]+)",
        fullmatch=True,
    ),
    st.sampled_from(("NaN", "Infinity", "+Infinity", "--1", "++1", ".", "+", "-.")),
)


@given(raw=NONCANONICAL_DECIMAL_TEXT)
def test_noncanonical_numeric_text_fails_closed(raw: str) -> None:
    response = MATRIX_RESPONSE.replace(
        '<Col id="m3">2.500</Col>',
        f'<Col id="m3">{raw}</Col>',
        1,
    )

    with pytest.raises(SourceFormatError):
        fetch_matrix_from_source(RowSource(response), date(2026, 6, 8), KIND.name)


XML_TEXT = st.text(
    alphabet=st.characters(
        min_codepoint=0x20,
        max_codepoint=0xD7FF,
        exclude_characters=("\ufffe", "\uffff"),
    ),
    min_size=1,
    max_size=40,
)


@given(base_date=st.dates(), kind_code=XML_TEXT, initial=st.booleans())
def test_request_xml_round_trips_generated_values(
    base_date: date,
    kind_code: str,
    initial: bool,
) -> None:
    request = build_request_xml(base_date, kind_code, initial=initial)

    root = ElementTree.fromstring(request)
    columns = {
        element.get("id"): element.text or ""
        for element in root.iter()
        if element.tag.rsplit("}", maxsplit=1)[-1] == "Col"
    }
    assert columns["calBaseDt"] == f"{base_date.year:04d}{base_date.month:02d}{base_date.day:02d}"
    assert columns["cboYtmSort"] == kind_code
    assert columns["URL"] == (INIT_ENDPOINT if initial else MATRIX_ENDPOINT)
