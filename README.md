# KIS-NET YTM

Language-native access to the KIS-NET YTM Matrix, with exact-date lookup by
default and explicit previous-available date resolution.

## Packages

- [`@sjunepark/ytm`](packages/node): Node.js 20.18.1+ CLI and runtime-neutral
  toolset SDK
- [`kisnet-ytm`](packages/python): typed, synchronous Python 3.11+ API that does
  not invoke Node.js

Both packages send the same deterministic Nexacro requests and share fixtures
for source parsing, missing values, unavailable dates, fallback order, and
failure classification. Their language-specific result shapes are documented
in [SPEC.md](SPEC.md).

## Quick start

Node CLI:

```sh
npx -y @sjunepark/ytm matrix --base-date 2026-06-08 --kind 국채 --format json
```

Python:

```python
from datetime import date
from kisnet_ytm import fetch_matrix

matrix = fetch_matrix(date(2026, 6, 8), "국채")
print(matrix.rows[0].yields["10Y"])
```

The Python package is complete in this repository; its selected first shared
release is `0.2.0`, with publication pending external trusted-publisher setup.

## Repository validation

```sh
bun install --frozen-lockfile
uv sync --locked --project packages/python
bun run validate
bun run test
bun run build
bun run pack:node
bun run pack:python
```

Live KIS-NET smoke checks are scheduled and manually dispatchable rather than
pull-request gates. See [docs/release.md](docs/release.md) for the repository-ready
lockstep release flow and the external setup that remains.
