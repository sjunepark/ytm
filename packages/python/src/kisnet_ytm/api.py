"""Small synchronous public retrieval interface."""

from __future__ import annotations

from datetime import date

from ._retrieval import STATIC_KINDS, fetch_matrix_from_source, list_kinds_from_source
from ._source import CurlCffiSource
from .models import Kind, Matrix


def fetch_matrix(
    base_date: date,
    kind: str,
    *,
    previous_available_days: int | None = None,
) -> Matrix:
    """Fetch one exact date or an explicit window of at most 31 prior dates."""
    with CurlCffiSource() as source:
        return fetch_matrix_from_source(
            source,
            base_date,
            kind,
            previous_available_days=previous_available_days,
        )


def list_kinds(base_date: date | None = None) -> tuple[Kind, ...]:
    """Return static known 종류 values, or refresh them for a KIS-NET date."""
    if base_date is None:
        return STATIC_KINDS
    with CurlCffiSource() as source:
        return list_kinds_from_source(source, base_date)
