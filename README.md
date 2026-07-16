# KIS-NET YTM

This monorepo provides language-native access to the KIS-NET YTM Matrix while
preserving exact-date lookup by default and explicit previous-available date
resolution.

## Packages

- [`@sjunepark/ytm`](packages/node): Node.js CLI and runtime-neutral toolset SDK
- `kisnet-ytm` (`kisnet_ytm`): Python 3.11+ package, under implementation in
  [`packages/python`](packages/python)

The source protocol and behavioral contract are documented in [SPEC.md](SPEC.md).
The approved migration and its current progress are tracked in
[docs/plans/python-monorepo.md](docs/plans/python-monorepo.md).

## Repository validation

```sh
bun install --frozen-lockfile
bun run test
bun run pack:node
```

Python validation commands will be added with the Python package.
