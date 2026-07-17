"""KIS-NET Nexacro request construction and response parsing."""

from __future__ import annotations

import re
from datetime import date
from html import escape
from xml.etree import ElementTree

from .errors import SourceFormatError, SourceProtocolError
from .models import Kind

SOURCE_BASE_URL = "https://kis-net.kr"
INIT_ENDPOINT = "/rateInfo/ytmMatrixMobileInitList.do"
MATRIX_ENDPOINT = "/rateInfo/ytmMatrixMobileList.do"
ERROR_CODE_PATTERN = re.compile(r"[+-]?[0-9]+")

TENORS: tuple[tuple[str, str], ...] = (
    ("m3", "3M"),
    ("m6", "6M"),
    ("m9", "9M"),
    ("y1", "1Y"),
    ("y15a", "1.5Y"),
    ("y2", "2Y"),
    ("y25", "2.5Y"),
    ("y3", "3Y"),
    ("y5", "5Y"),
    ("y7", "7Y"),
    ("y10", "10Y"),
    ("y15", "15Y"),
    ("y20", "20Y"),
    ("y30", "30Y"),
    ("y50", "50Y"),
)


def build_request_xml(base_date: date, kind_code: str, *, initial: bool) -> str:
    """Build the source-native PlatformData request without exposing transport details."""
    endpoint = INIT_ENDPOINT if initial else MATRIX_ENDPOINT
    service_id = "search" if initial else "search1"
    out_datasets = "ds_tymSort=output1 ds_list=output2" if initial else "ds_list=output1"
    compact_date = f"{base_date.year:04d}{base_date.month:02d}{base_date.day:02d}"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Root xmlns="http://www.nexacroplatform.com/platform/dataset">
  <Parameters/>
  <Dataset id="ds_search">
    <ColumnInfo>
      <Column id="pageIndex" type="STRING" size="256"/>
      <Column id="pageSize" type="STRING" size="256"/>
      <Column id="pageUnit" type="STRING" size="256"/>
      <Column id="calBaseDt" type="STRING" size="256"/>
      <Column id="cboYtmSort" type="STRING" size="256"/>
    </ColumnInfo>
    <Rows><Row>
      <Col id="pageIndex">1</Col>
      <Col id="pageSize">10</Col>
      <Col id="pageUnit">10</Col>
      <Col id="calBaseDt">{compact_date}</Col>
      <Col id="cboYtmSort">{escape(kind_code)}</Col>
    </Row></Rows>
  </Dataset>
  <Dataset id="gds_tranInfo">
    <ColumnInfo>
      <Column id="svcID" type="STRING" size="32"/>
      <Column id="URL" type="STRING" size="32"/>
      <Column id="inDatasets" type="STRING" size="32"/>
      <Column id="outDatasets" type="STRING" size="32"/>
      <Column id="browserType" type="STRING" size="32"/>
    </ColumnInfo>
    <Rows><Row>
      <Col id="svcID">{service_id}</Col>
      <Col id="URL">{endpoint}</Col>
      <Col id="inDatasets">ds_search=ds_search gds_tranInfo=gds_tranInfo</Col>
      <Col id="outDatasets">{out_datasets}</Col>
      <Col id="browserType">Chrome</Col>
    </Row></Rows>
  </Dataset>
</Root>"""


def parse_kinds_response(xml: str | bytes) -> tuple[Kind, ...]:
    rows = _parse_dataset(xml, "output1")
    kinds: list[Kind] = []
    for row in rows:
        code = row.get("divCode", "").strip()
        name = row.get("divName", "").strip()
        if not code or not name:
            raise SourceFormatError("KIS-NET kind row is missing divCode or divName")
        kinds.append(Kind(code=code, name=name))
    return tuple(kinds)


def parse_matrix_response(xml: str | bytes) -> tuple[dict[str, str], ...]:
    return _parse_dataset(xml, "output1")


def _parse_dataset(xml: str | bytes, dataset_id: str) -> tuple[dict[str, str], ...]:
    try:
        root = ElementTree.fromstring(xml)
    except (ElementTree.ParseError, LookupError, ValueError) as error:
        raise SourceFormatError("KIS-NET returned malformed Nexacro XML") from error

    error_code = _find_parameter(root, "ErrorCode")
    if error_code is None:
        raise SourceFormatError("KIS-NET response is missing the required ErrorCode parameter")
    if ERROR_CODE_PATTERN.fullmatch(error_code) is None:
        raise SourceFormatError("KIS-NET response contains an invalid ErrorCode parameter")
    if error_code.lstrip("+-").strip("0"):
        error_message = _find_parameter(root, "ErrorMsg") or _find_parameter(root, "ErrorMessage")
        message_suffix = f" ({error_message})" if error_message else ""
        raise SourceProtocolError(
            f"KIS-NET returned nonzero Nexacro ErrorCode {error_code}{message_suffix}",
            error_code=error_code,
            error_message=error_message,
        )

    dataset = next(
        (
            element
            for element in root.iter()
            if _local_name(element.tag) == "Dataset" and element.get("id") == dataset_id
        ),
        None,
    )
    if dataset is None:
        raise SourceFormatError(f"KIS-NET response is missing required dataset {dataset_id}")

    rows: list[dict[str, str]] = []
    for row_element in dataset.iter():
        if _local_name(row_element.tag) != "Row":
            continue
        row: dict[str, str] = {}
        for column in row_element:
            if _local_name(column.tag) == "Col" and column.get("id"):
                row[column.get("id", "")] = column.text or ""
        rows.append(row)
    return tuple(rows)


def _find_parameter(root: ElementTree.Element, parameter_id: str) -> str | None:
    return next(
        (
            (element.text or "").strip()
            for element in root.iter()
            if _local_name(element.tag) == "Parameter" and element.get("id") == parameter_id
        ),
        None,
    )


def _local_name(tag: str) -> str:
    return tag.rsplit("}", maxsplit=1)[-1]
