"""Validated public result models."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

_MAX_PREVIOUS_AVAILABLE_DAYS = 31


class _ResultModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Kind(_ResultModel):
    """A source-compatible KIS-NET 종류 code and name."""

    code: str = Field(min_length=1)
    name: str = Field(min_length=1)


class DateResolution(_ResultModel):
    """The requested, attempted, and resolved dates for one matrix lookup."""

    requested_date: date
    resolved_date: date
    attempted_dates: tuple[date, ...] = Field(min_length=1)
    previous_available_days: int | None = Field(
        default=None,
        ge=0,
        le=_MAX_PREVIOUS_AVAILABLE_DAYS,
        strict=True,
    )
    used_previous_available: bool

    @model_validator(mode="after")
    def validate_resolution(self) -> Self:
        if self.attempted_dates[0] != self.requested_date:
            raise ValueError("attempted_dates must begin with requested_date")
        if self.attempted_dates[-1] != self.resolved_date:
            raise ValueError("attempted_dates must end with resolved_date")
        if any(
            previous.toordinal() - current.toordinal() != 1
            for previous, current in zip(
                self.attempted_dates,
                self.attempted_dates[1:],
                strict=False,
            )
        ):
            raise ValueError("attempted_dates must be consecutive dates in descending order")
        if self.previous_available_days is None and len(self.attempted_dates) != 1:
            raise ValueError("exact-date resolution must contain only requested_date")
        if (
            self.previous_available_days is not None
            and len(self.attempted_dates) > self.previous_available_days + 1
        ):
            raise ValueError("attempted_dates exceeds previous_available_days")
        if self.used_previous_available != (self.requested_date != self.resolved_date):
            raise ValueError("used_previous_available must reflect the resolved date")
        return self


class MatrixRow(_ResultModel):
    """One 적용대상채권 row with parsed and source-text yield values."""

    pricing_group_code: str = Field(min_length=1)
    pricing_group_name: str = Field(min_length=1)
    yields: dict[str, Decimal | None]
    yield_text: dict[str, str]
    raw: dict[str, str]

    @model_validator(mode="after")
    def validate_yield_keys(self) -> Self:
        if self.yields.keys() != self.yield_text.keys():
            raise ValueError("yields and yield_text must use the same tenor keys")
        return self


class Matrix(_ResultModel):
    """A successful KIS-NET YTM Matrix lookup."""

    base_date: date
    requested_date: date
    date_resolution: DateResolution
    kind: Kind
    tenors: tuple[str, ...] = Field(min_length=1)
    rows: tuple[MatrixRow, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_matrix(self) -> Self:
        if self.base_date != self.date_resolution.resolved_date:
            raise ValueError("base_date must match date_resolution.resolved_date")
        if self.requested_date != self.date_resolution.requested_date:
            raise ValueError("requested_date must match date_resolution.requested_date")
        tenor_set = set(self.tenors)
        if any(set(row.yields) != tenor_set for row in self.rows):
            raise ValueError("every row must contain exactly the declared tenors")
        return self
