"""Private KIS-NET source seam and curl-cffi production adapter."""

from __future__ import annotations

import logging
from datetime import date
from types import TracebackType
from typing import Protocol, Self

from curl_cffi import CurlError, requests

from ._nexacro import (
    INIT_ENDPOINT,
    MATRIX_ENDPOINT,
    SOURCE_BASE_URL,
    build_request_xml,
    parse_kinds_response,
    parse_matrix_response,
)
from .errors import SourceTransportError
from .models import Kind

logger = logging.getLogger(__name__)


class KisnetSource(Protocol):
    def list_kinds(self, base_date: date) -> tuple[Kind, ...]: ...

    def fetch_rows(self, base_date: date, kind_code: str) -> tuple[dict[str, str], ...]: ...


class CurlCffiSource:
    """Production adapter; browser impersonation and sessions remain private."""

    def __init__(self, *, timeout: float = 20.0) -> None:
        self._session = requests.Session(
            headers={"content-type": "text/xml; charset=UTF-8", "accept": "text/xml, */*"},
            timeout=timeout,
            impersonate="chrome",
        )

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self._session.close()

    def list_kinds(self, base_date: date) -> tuple[Kind, ...]:
        body = build_request_xml(base_date, "10", initial=True)
        return parse_kinds_response(self._post(INIT_ENDPOINT, body))

    def fetch_rows(self, base_date: date, kind_code: str) -> tuple[dict[str, str], ...]:
        body = build_request_xml(base_date, kind_code, initial=False)
        return parse_matrix_response(self._post(MATRIX_ENDPOINT, body))

    def _post(self, endpoint: str, body: str) -> bytes:
        try:
            response = self._session.post(f"{SOURCE_BASE_URL}{endpoint}", data=body.encode())
        except (CurlError, OSError) as error:
            raise SourceTransportError(
                "KIS-NET request failed before a response was received"
            ) from error
        logger.debug(
            "KIS-NET response received",
            extra={"endpoint": endpoint, "status_code": response.status_code},
        )
        if response.status_code != 200:
            raise SourceTransportError(f"KIS-NET returned HTTP {response.status_code}")
        return response.content
