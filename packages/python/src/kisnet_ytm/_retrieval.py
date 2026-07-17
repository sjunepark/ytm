"""Validation, date resolution, and source-independent matrix normalization."""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from ._nexacro import TENORS
from ._source import KisnetSource
from .errors import DataUnavailableError, InvalidInputError, SourceFormatError
from .models import _MAX_PREVIOUS_AVAILABLE_DAYS, DateResolution, Kind, Matrix, MatrixRow

logger = logging.getLogger(__name__)

_DECIMAL_TEXT = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)")

STATIC_KINDS: tuple[Kind, ...] = (
    Kind(code="10", name="국채"),
    Kind(code="20", name="지방채"),
    Kind(code="30", name="특수채"),
    Kind(code="40", name="통안채"),
    Kind(code="50", name="은행채"),
    Kind(code="60", name="기타금융채"),
    Kind(code="70", name="회사채(무보증)"),
)


def fetch_matrix_from_source(
    source: KisnetSource,
    base_date: date,
    kind: str,
    *,
    previous_available_days: int | None = None,
) -> Matrix:
    requested_date = _validate_date(base_date)
    requested_kind = _validate_kind(kind)
    lookback = _validate_previous_available_days(previous_available_days)
    if lookback >= requested_date.toordinal():
        raise InvalidInputError("previous_available_days extends before datetime.date.min")
    attempts = tuple(requested_date - timedelta(days=offset) for offset in range(lookback + 1))
    attempted: list[date] = []

    for attempt in attempts:
        attempted.append(attempt)
        logger.debug(
            "Attempting KIS-NET matrix date",
            extra={
                "requested_date": requested_date.isoformat(),
                "attempted_date": attempt.isoformat(),
            },
        )
        kinds = source.list_kinds(attempt)
        if not kinds:
            continue
        resolved_kind = _resolve_kind(requested_kind, kinds)
        if resolved_kind is None:
            raise InvalidInputError(f"Unknown 종류: {requested_kind}")
        source_rows = source.fetch_rows(attempt, resolved_kind.code)
        if not source_rows:
            continue
        rows = tuple(_normalize_row(row) for row in source_rows)
        resolution = DateResolution(
            requested_date=requested_date,
            resolved_date=attempt,
            attempted_dates=tuple(attempted),
            previous_available_days=previous_available_days,
            used_previous_available=attempt != requested_date,
        )
        logger.info(
            "Resolved KIS-NET matrix date",
            extra={
                "requested_date": requested_date.isoformat(),
                "resolved_date": attempt.isoformat(),
                "attempt_count": len(attempted),
            },
        )
        return Matrix(
            base_date=attempt,
            requested_date=requested_date,
            date_resolution=resolution,
            kind=resolved_kind,
            tenors=tuple(label for _, label in TENORS),
            rows=rows,
        )

    raise DataUnavailableError(
        f"KIS-NET returned no YTM Matrix rows for {requested_date.isoformat()}"
        + (
            f" or the prior {lookback} calendar day(s)"
            if previous_available_days is not None
            else ""
        ),
        requested_date=requested_date,
        attempted_dates=tuple(attempted),
    )


def list_kinds_from_source(source: KisnetSource, base_date: date) -> tuple[Kind, ...]:
    requested_date = _validate_date(base_date)
    kinds = source.list_kinds(requested_date)
    if not kinds:
        raise DataUnavailableError(
            f"KIS-NET returned no 종류 values for {requested_date.isoformat()}",
            requested_date=requested_date,
            attempted_dates=(requested_date,),
        )
    return kinds


def _normalize_row(row: dict[str, str]) -> MatrixRow:
    required = ("pricingGroupCode", "pricingGroupName", *(key for key, _ in TENORS))
    missing = tuple(column for column in required if column not in row)
    if missing:
        raise SourceFormatError(
            f"KIS-NET matrix row is missing required column(s): {', '.join(missing)}"
        )
    pricing_group_code = row["pricingGroupCode"].strip()
    pricing_group_name = row["pricingGroupName"].strip()
    if not pricing_group_code or not pricing_group_name:
        raise SourceFormatError("KIS-NET matrix row contains an empty pricing group code or name")

    yields: dict[str, Decimal | None] = {}
    yield_text: dict[str, str] = {}
    for source_key, tenor in TENORS:
        raw = row[source_key].strip()
        yield_text[tenor] = raw
        if raw in {"", "-"}:
            yields[tenor] = None
            continue
        if _DECIMAL_TEXT.fullmatch(raw) is None:
            raise SourceFormatError(
                f"KIS-NET matrix column {source_key} contains an invalid numeric value"
            )
        try:
            value = Decimal(raw)
        except InvalidOperation as error:
            raise SourceFormatError(
                f"KIS-NET matrix column {source_key} contains an invalid numeric value"
            ) from error
        if not value.is_finite():
            raise SourceFormatError(
                f"KIS-NET matrix column {source_key} contains a non-finite numeric value"
            )
        yields[tenor] = value

    return MatrixRow(
        pricing_group_code=pricing_group_code,
        pricing_group_name=pricing_group_name,
        yields=yields,
        yield_text=yield_text,
        raw=dict(row),
    )


def _resolve_kind(value: str, kinds: tuple[Kind, ...]) -> Kind | None:
    compact_value = "".join(value.split())
    return next(
        (
            kind
            for kind in kinds
            if kind.code == value
            or kind.name == value
            or "".join(kind.name.split()) == compact_value
        ),
        None,
    )


def _validate_date(value: date) -> date:
    if type(value) is not date:
        raise InvalidInputError("base_date must be a datetime.date")
    return value


def _validate_kind(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InvalidInputError("kind must be a non-empty 종류 code or label")
    return value.strip()


def _validate_previous_available_days(value: int | None) -> int:
    if value is None:
        return 0
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= _MAX_PREVIOUS_AVAILABLE_DAYS
    ):
        raise InvalidInputError(
            f"previous_available_days must be an integer from 0 to "
            f"{_MAX_PREVIOUS_AVAILABLE_DAYS}, or None"
        )
    return value
