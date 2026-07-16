"""Public error hierarchy for KIS-NET YTM retrieval."""

from __future__ import annotations

from datetime import date


class YtmError(Exception):
    """Base class for errors intentionally exposed by this package."""

    code = "ytm_error"


class InvalidInputError(YtmError, ValueError):
    """The caller supplied an invalid date, kind, or fallback window."""

    code = "invalid_input"


class DataUnavailableError(YtmError):
    """KIS-NET confirmed that no matrix data exists for the attempted dates."""

    code = "data_unavailable"

    def __init__(self, message: str, *, requested_date: date, attempted_dates: tuple[date, ...]):
        super().__init__(message)
        self.requested_date = requested_date
        self.attempted_dates = attempted_dates


class SourceTransportError(YtmError):
    """The KIS-NET request failed before a usable response was received."""

    code = "source_transport"


class SourceFormatError(YtmError):
    """KIS-NET returned data that violates the expected source schema."""

    code = "source_format"
