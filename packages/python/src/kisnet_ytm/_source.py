"""Private KIS-NET source seam and curl-cffi production adapter."""

from __future__ import annotations

import logging
from datetime import date
from types import TracebackType
from typing import Protocol, Self

from curl_cffi import CurlError, requests
from curl_cffi.curl import CURL_WRITEFUNC_ERROR

from ._nexacro import (
    INIT_ENDPOINT,
    MATRIX_ENDPOINT,
    MAX_RESPONSE_BODY_BYTES,
    SOURCE_BASE_URL,
    build_request_xml,
    parse_kinds_response,
    parse_matrix_response,
)
from .errors import SourceFormatError, SourceTransportError
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
        response_body = bytearray()
        oversized = False

        def collect_response_chunk(chunk: bytes) -> int:
            nonlocal oversized
            if len(chunk) > MAX_RESPONSE_BODY_BYTES - len(response_body):
                oversized = True
                return CURL_WRITEFUNC_ERROR
            response_body.extend(chunk)
            return len(chunk)

        try:
            response = self._session.post(
                f"{SOURCE_BASE_URL}{endpoint}",
                data=body.encode("utf-8"),
                content_callback=collect_response_chunk,
            )
        except (CurlError, OSError) as error:
            error_response = getattr(error, "response", None)
            error_status = getattr(error_response, "status_code", 0)
            if oversized and (not error_status or 200 <= error_status < 300):
                raise SourceFormatError(
                    f"KIS-NET response exceeds the maximum body size of "
                    f"{MAX_RESPONSE_BODY_BYTES} bytes"
                ) from error
            if error_status:
                raise SourceTransportError(f"KIS-NET returned HTTP {error_status}") from error
            raise SourceTransportError(
                "KIS-NET request failed before a response was received"
            ) from error
        logger.debug(
            "KIS-NET response received",
            extra={"endpoint": endpoint, "status_code": response.status_code},
        )
        if response.status_code != 200:
            raise SourceTransportError(f"KIS-NET returned HTTP {response.status_code}")
        if oversized:
            raise SourceFormatError(
                f"KIS-NET response exceeds the maximum body size of {MAX_RESPONSE_BODY_BYTES} bytes"
            )
        return bytes(response_body)
