# ytm

`ytm` is a deterministic CLI plus runtime-neutral `./toolset` SDK for KIS-NET YTM Matrix lookups from <https://kis-net.kr/kisnet_mobile/index.html>.

The agent-facing contract is English, while official KIS-NET terms such as `기준일`, `종류`, `국채`, and `회사채(무보증)` are preserved.

## Request inspection summary

The mobile site is a Nexacro app. The YTM Matrix form is `rateinfo::YtmMatrix.xfdl`.

- Initial YTM Matrix load posts Nexacro XML PlatformData to `/rateInfo/ytmMatrixMobileInitList.do`.
  - Input dataset: `ds_search=ds_search`
  - Output datasets: `ds_tymSort=output1 ds_list=output2`
  - `cboYtmSort` is hard-coded to `10`.
- Each `검색` click posts Nexacro XML PlatformData to `/rateInfo/ytmMatrixMobileList.do`.
  - Input dataset: `ds_search=ds_search`
  - Output dataset: `ds_list=output1`
  - `calBaseDt` comes from `기준일`; `cboYtmSort` comes from selected `종류`.

The tool reproduces that deterministic POST shape directly instead of driving the browser.

## CLI

The published npm CLI requires Node 20.18.1 or newer. Local development uses Bun 1.3 or newer.

```sh
# Source-run CLI, no build needed
bun run cli
bun run cli --help
bun run cli matrix --help
bun run cli matrix --base-date 2026-06-08 --kind 국채 --format json --pretty
bun run cli kinds --format tsv

# Built CLI
bun run build
node dist/cli.js --help
node dist/cli.js matrix --base-date 2026-06-08 --kind 국채 --format json --pretty

# Published package
npx @sjunepark/ytm --help
npm install --global @sjunepark/ytm

# Installed/link binary name
ytm --help
ytm matrix --base-date 2026-06-08 --kind 국채
```

Use `kinds` to see accepted `kind` / `종류` values. Command help is the authoritative menu for current inputs:

```sh
ytm <command> --help
```

Default output is one JSON object. Successful `csv` and `tsv` commands print tabular rows. Failures always print one JSON object and exit non-zero.

## Agent skill

This repository publishes an agent skill at `skills/kisnet-ytm/SKILL.md` so agents can discover how to use the CLI and SDK.

```sh
# Inspect available skills from this repo
bunx skills add https://github.com/sjunepark/ytm/tree/main/skills --list

# Install the skill globally for Pi and Claude Code
bunx skills add https://github.com/sjunepark/ytm/tree/main/skills --skill kisnet-ytm --copy -g -a pi -a claude-code -y

# Use it directly without installing
bunx skills use sjunepark/ytm --skill kisnet-ytm
```

If you edit the skill locally, commit and push before installing from the GitHub URL. For local validation, use `bunx skills add ./skills --list`.

## Operations

### `matrix`

Input:

```json
{ "baseDate": "2026-06-08", "kind": "국채" }
```

- `baseDate` maps to `기준일`. Accepted forms: `YYYY-MM-DD`, `YYYY.MM.DD`, `YYYYMMDD`.
- `kind` maps to `종류`. Use a Korean label or source code.

Result includes resolved `kind`, tenor labels, rows by `적용대상채권`, numeric yields, raw source cell text, and source request metadata. Source `-` cells become `null` in `yields` and remain `-` in `yieldText`.

### `kinds`

Input:

```json
{}
```

Without `baseDate`, returns the inspected source list without a network request. With `baseDate`, refreshes from KIS-NET's init endpoint.

Known inspected `종류` values:

| code | name |
| --- | --- |
| 10 | 국채 |
| 20 | 지방채 |
| 30 | 특수채 |
| 40 | 통안채 |
| 50 | 은행채 |
| 60 | 기타금융채 |
| 70 | 회사채(무보증) |

## Toolset SDK

```js
import { createKisnetYtmToolset } from "@sjunepark/ytm/toolset";

const toolset = createKisnetYtmToolset();
const validation = toolset.validateInput("matrix", {
  baseDate: "2026-06-08",
  kind: "국채"
});
if (!validation.valid) throw validation.error;
const result = await toolset.execute("matrix", validation.normalizedInput);
```

The SDK exposes `help()`, `listOperations()`, `getOperation()`, `getCommandHelp()`, `validateInput()`, `execute()`, and `serializeError()`.

## Validation

```sh
bun run build
bun run validate
KISNET_SMOKE_NETWORK=1 bun run validate
```

Structured validation failures include `code`, `operationName`, `parameter`, `expected`, safe `actual`, `exampleInput`, `recoveryHint`, `recoveryAction`, `recoverable`, and retry metadata where applicable.
