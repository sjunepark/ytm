# KIS-NET YTM Matrix Tool Surface Spec

## Capability

Lookup KIS-NET YTM Matrix rows from the mobile Nexacro source at <https://kis-net.kr/kisnet_mobile/index.html> using:

- `baseDate` (`기준일`): accepted as `YYYY-MM-DD`, `YYYY.MM.DD`, or `YYYYMMDD`; sent as `calBaseDt=YYYYMMDD`.
- `kind` (`종류`): accepted as a source code or Korean label; sent as `cboYtmSort=<code>`.

## Source request contract

The inspected form is `rateinfo::YtmMatrix.xfdl`.

### Initial load / 종류 discovery

- Endpoint: `POST https://kis-net.kr/rateInfo/ytmMatrixMobileInitList.do`
- Body format: Nexacro XML PlatformData
- Input dataset: `ds_search=ds_search`
- Output datasets: `ds_tymSort=output1 ds_list=output2`
- Parameters in `ds_search`: `pageIndex=1`, `pageSize=10`, `pageUnit=10`, `calBaseDt`, `cboYtmSort=10`

### `검색` click / matrix lookup

- Endpoint: `POST https://kis-net.kr/rateInfo/ytmMatrixMobileList.do`
- Body format: Nexacro XML PlatformData
- Input dataset: `ds_search=ds_search`
- Output dataset: `ds_list=output1`
- Parameters in `ds_search`: `pageIndex=1`, `pageSize=10`, `pageUnit=10`, `calBaseDt`, `cboYtmSort`

## Public surfaces

### CLI

```sh
ytm matrix --base-date <기준일> --kind <종류> [--format json|csv|tsv] [--pretty]
ytm kinds [--base-date <기준일>] [--format json|csv|tsv] [--pretty]
```

- `json` is default and prints one JSON object.
- Successful `csv` and `tsv` output is tabular.
- Failures always print one JSON object and exit non-zero.

### Toolset SDK

`kisnet-ytm/toolset` exports `createKisnetYtmToolset()` with `help`, `listOperations`, `getOperation`, `getCommandHelp`, `validateInput`, `execute`, and `serializeError`.

## Result shape

`matrix` returns:

- `baseDate`: normalized `YYYY-MM-DD`
- `kind`: `{ code, name }`
- `tenors`: `3M`, `6M`, `9M`, `1Y`, `1.5Y`, `2Y`, `2.5Y`, `3Y`, `5Y`, `7Y`, `10Y`, `15Y`, `20Y`, `30Y`, `50Y`
- `rows`: one per `적용대상채권`, with `pricingGroupCode`, `pricingGroupName`, numeric `yields`, raw `yieldText`, and raw source columns
- `source`: endpoint and request metadata

`-` yield cells are represented as `null` in `yields` and preserved in `yieldText`.
