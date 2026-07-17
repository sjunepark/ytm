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
NEXACRO_NAMESPACE = "http://www.nexacroplatform.com/platform/dataset"
MAX_RESPONSE_BODY_BYTES = 1_048_576
MAX_ELEMENT_DEPTH = 64
ERROR_CODE_PATTERN = re.compile(r"[+-]?[0-9]+")
ZERO_ERROR_CODE_PATTERN = re.compile(r"[+-]?0+")
XML_VERSION_ATTRIBUTE = re.compile(r'^version\s*=\s*(["\'])([^"\']+)\1(?:\s|$)')
XML_ENCODING_ATTRIBUTE = re.compile(r'(?:^|\s)encoding\s*=\s*(["\'])([^"\']+)\1(?:\s|$)')
XML_DECLARATION_START = re.compile(r"\A<\?xml(?:\s|\?>)")
PROTOCOL_ELEMENTS = frozenset({"Root", "Parameters", "Parameter", "Dataset", "Rows", "Row", "Col"})

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
    source = _normalize_xml(xml)
    _validate_xml_declaration(source)
    try:
        parser = ElementTree.XMLParser(target=_StrictTreeBuilder())
        root = ElementTree.fromstring(source, parser=parser)
    except SourceFormatError:
        raise
    except (ElementTree.ParseError, LookupError, ValueError) as error:
        raise SourceFormatError("KIS-NET returned malformed Nexacro XML") from error

    if root.tag != _protocol_tag("Root"):
        raise SourceFormatError("KIS-NET response root must be a Nexacro Root element")
    _validate_protocol_tree(root)

    parameter_containers = _direct_children(root, "Parameters")
    if len(parameter_containers) != 1:
        raise SourceFormatError(
            "KIS-NET response must contain exactly one direct Parameters element"
        )
    parameters = _direct_children(parameter_containers[0], "Parameter")
    error_codes = _parameters_by_id(parameters, "ErrorCode")
    error_messages = _parameters_by_id(parameters, "ErrorMsg")
    legacy_error_messages = _parameters_by_id(parameters, "ErrorMessage")
    if len(error_codes) != 1:
        raise SourceFormatError("KIS-NET response must contain exactly one ErrorCode parameter")
    if len(error_messages) > 1 or len(legacy_error_messages) > 1:
        raise SourceFormatError("KIS-NET response contains duplicate error-message parameters")

    error_code = _scalar_text(error_codes[0], "ErrorCode").strip()
    if ERROR_CODE_PATTERN.fullmatch(error_code) is None:
        raise SourceFormatError("KIS-NET response contains an invalid ErrorCode parameter")
    if ZERO_ERROR_CODE_PATTERN.fullmatch(error_code) is None:
        primary_message = (
            _scalar_text(error_messages[0], "ErrorMsg").strip() if error_messages else ""
        )
        legacy_message = (
            _scalar_text(legacy_error_messages[0], "ErrorMessage").strip()
            if legacy_error_messages
            else ""
        )
        error_message = primary_message or legacy_message or None
        message_suffix = f" ({error_message})" if error_message else ""
        raise SourceProtocolError(
            f"KIS-NET returned nonzero Nexacro ErrorCode {error_code}{message_suffix}",
            error_code=error_code,
            error_message=error_message,
        )

    datasets = tuple(
        element for element in _direct_children(root, "Dataset") if element.get("id") == dataset_id
    )
    if len(datasets) != 1:
        raise SourceFormatError(
            f"KIS-NET response must contain exactly one direct dataset {dataset_id}"
        )
    rows_containers = _direct_children(datasets[0], "Rows")
    if len(rows_containers) != 1:
        raise SourceFormatError(
            f"KIS-NET dataset {dataset_id} must contain exactly one direct Rows element"
        )

    return tuple(_parse_row(row) for row in _direct_children(rows_containers[0], "Row"))


class _StrictTreeBuilder(ElementTree.TreeBuilder):
    def __init__(self) -> None:
        super().__init__()
        self._depth = 0

    def start(self, tag: str, attrs: dict[str, str]) -> ElementTree.Element:
        self._depth += 1
        if self._depth > MAX_ELEMENT_DEPTH:
            raise SourceFormatError(
                f"KIS-NET response exceeds the maximum XML element depth of {MAX_ELEMENT_DEPTH}"
            )
        return super().start(tag, attrs)

    def end(self, tag: str) -> ElementTree.Element:
        element = super().end(tag)
        self._depth -= 1
        return element

    def doctype(self, name: str, public_id: str | None, system_id: str | None) -> None:
        raise SourceFormatError("KIS-NET response must not contain a DOCTYPE declaration")


def _normalize_xml(xml: str | bytes) -> str:
    if isinstance(xml, bytes):
        if len(xml) > MAX_RESPONSE_BODY_BYTES:
            raise SourceFormatError(
                f"KIS-NET response exceeds the maximum body size of {MAX_RESPONSE_BODY_BYTES} bytes"
            )
        try:
            source = xml.decode("utf-8")
        except UnicodeDecodeError as error:
            raise SourceFormatError("KIS-NET response is not valid UTF-8") from error
    else:
        try:
            body_size = len(xml.encode("utf-8"))
        except UnicodeEncodeError as error:
            raise SourceFormatError("KIS-NET response is not valid UTF-8") from error
        if body_size > MAX_RESPONSE_BODY_BYTES:
            raise SourceFormatError(
                f"KIS-NET response exceeds the maximum body size of {MAX_RESPONSE_BODY_BYTES} bytes"
            )
        source = xml

    if source.startswith("\ufeff"):
        source = source[1:]
        if source.startswith("\ufeff"):
            raise SourceFormatError("KIS-NET response must contain at most one UTF-8 BOM")
    return source


def _validate_xml_declaration(source: str) -> None:
    if XML_DECLARATION_START.match(source) is None:
        return
    declaration_end = source.find("?>")
    if declaration_end < 0:
        return
    declaration = source[5:declaration_end].strip()
    version = XML_VERSION_ATTRIBUTE.match(declaration)
    if version is None or version.group(2) != "1.0":
        raise SourceFormatError("KIS-NET response must use XML 1.0")
    encoding = XML_ENCODING_ATTRIBUTE.search(declaration)
    if encoding is not None and encoding.group(2).lower() != "utf-8":
        raise SourceFormatError("KIS-NET response must use UTF-8 encoding")


def _parse_row(row_element: ElementTree.Element) -> dict[str, str]:
    row: dict[str, str] = {}
    for column in _direct_children(row_element, "Col"):
        column_id = column.get("id")
        if column_id is None or not column_id.strip():
            raise SourceFormatError("KIS-NET response contains a Col without a nonempty id")
        if column_id in row:
            raise SourceFormatError(f"KIS-NET response row contains duplicate column {column_id}")
        row[column_id] = _scalar_text(column, f"Col {column_id}")
    return row


def _validate_protocol_tree(root: ElementTree.Element) -> None:
    for element in root.iter():
        local_name = _local_name(element.tag)
        if local_name in PROTOCOL_ELEMENTS and element.tag != _protocol_tag(local_name):
            raise SourceFormatError(
                f"KIS-NET protocol element {local_name} has an invalid namespace"
            )


def _direct_children(
    parent: ElementTree.Element, local_name: str
) -> tuple[ElementTree.Element, ...]:
    tag = _protocol_tag(local_name)
    return tuple(child for child in parent if child.tag == tag)


def _parameters_by_id(
    parameters: tuple[ElementTree.Element, ...], parameter_id: str
) -> tuple[ElementTree.Element, ...]:
    return tuple(element for element in parameters if element.get("id") == parameter_id)


def _scalar_text(element: ElementTree.Element, label: str) -> str:
    if len(element):
        raise SourceFormatError(f"KIS-NET response {label} contains nested element content")
    return element.text or ""


def _protocol_tag(local_name: str) -> str:
    return f"{{{NEXACRO_NAMESPACE}}}{local_name}"


def _local_name(tag: str) -> str:
    return tag.rsplit("}", maxsplit=1)[-1]
