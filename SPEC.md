# KIS-NET YTM Matrix Contract

## Capability

Retrieve KIS-NET YTM Matrix rows from the mobile Nexacro source at
<https://kis-net.kr/kisnet_mobile/index.html> by:

- `baseDate` / `base_date` (`기준일`), sent as `calBaseDt=YYYYMMDD`
- `kind` (`종류`), accepted as a source code or Korean label and sent as
  `cboYtmSort=<code>`

The packages reproduce the source request directly; neither drives a browser.

## Source request contract

The inspected form is `rateinfo::YtmMatrix.xfdl`.

Initial load and 종류 discovery use:

- `POST https://kis-net.kr/rateInfo/ytmMatrixMobileInitList.do`
- Nexacro XML PlatformData body
- input dataset `ds_search=ds_search`
- output datasets `ds_tymSort=output1 ds_list=output2`
- parameters `pageIndex=1`, `pageSize=10`, `pageUnit=10`, `calBaseDt`, and
  `cboYtmSort=10`

Matrix lookup uses:

- `POST https://kis-net.kr/rateInfo/ytmMatrixMobileList.do`
- Nexacro XML PlatformData body
- input dataset `ds_search=ds_search`
- output dataset `ds_list=output1`
- parameters `pageIndex=1`, `pageSize=10`, `pageUnit=10`, `calBaseDt`, and
  `cboYtmSort`

## Shared behavior

- Lookup is exact-date unless the caller explicitly requests previous-available
  resolution.
- Fallback tries the requested date first, then earlier calendar dates in order
  within the caller's bounded window.
- Only a confirmed no-data response advances fallback. Transport, nonzero
  Nexacro protocol status, and source-format failures stop immediately.
- A successful matrix contains at least one row and records the requested,
  attempted, and resolved dates.
- Missing `-` or empty yield cells become null-like values while the original
  cell text remains available.
- Invalid numeric cells and missing required columns are source-format errors,
  not unavailable data.
- KIS-NET 종류 and tenor strings remain source-compatible rather than closed
  public enums.

The versioned fixtures and expected cases under `contracts/kisnet` are the
executable source contract for both implementations.

## Node surface

The CLI is:

```sh
ytm matrix --base-date <기준일> --kind <종류> [--fallback previous-available] [--lookback-days <days>] [--format json|csv|tsv] [--pretty]
ytm kinds [--base-date <기준일>] [--format json|csv|tsv] [--pretty]
```

`baseDate` accepts `YYYY-MM-DD`, `YYYY.MM.DD`, or `YYYYMMDD`. JSON is the
default; failures print one structured JSON object and exit non-zero.

`@sjunepark/ytm/toolset` exports `createKisnetYtmToolset()` with `help`,
`listOperations`, `getOperation`, `getCommandHelp`, `validateInput`, `execute`,
and `serializeError`.

A Node matrix uses camelCase fields: `baseDate`, `requestedBaseDate`,
`dateResolution`, `kind`, `tenors`, `rows`, and `source`. Each row includes
`pricingGroupCode`, `pricingGroupName`, numeric `yields`, source `yieldText`,
and raw columns. Source missing values are `null` in `yields`.

Node source failures use `source_data_unavailable`, `source_transport_error`,
`source_protocol_error`, and `source_format_error`. A protocol error preserves
the nonzero Nexacro status as `sourceErrorCode` and `sourceErrorMessage`.
Validation failures retain the CLI/toolset's more specific structured codes
and recovery metadata.

## Python surface

The synchronous API is:

```python
fetch_matrix(base_date, kind, *, previous_available_days=None) -> Matrix
list_kinds(base_date=None) -> tuple[Kind, ...]
```

`base_date` is a `datetime.date`. Omitting `previous_available_days` performs
one exact lookup. Values from `0` through `31` permit at most that many prior
calendar dates after the requested date; larger or impossible date windows are
`InvalidInputError`.

A Python `Matrix` uses snake_case fields: `base_date`, `requested_date`,
`date_resolution`, `kind`, `tenors`, and `rows`. Yield values are
`Decimal | None`; tuples and Pydantic frozen models protect the outer result
structure. Each row also preserves `yield_text` and raw columns.

Public Python failures inherit `YtmError`: `InvalidInputError`,
`DataUnavailableError`, `SourceTransportError`, `SourceProtocolError`, and
`SourceFormatError`. `DataUnavailableError` exposes the requested and attempted
dates. `SourceProtocolError` exposes the nonzero Nexacro `error_code` and
`error_message`.
