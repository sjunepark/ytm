# Python Package and Monorepo Plan

Status: implementation in progress; shared source contracts and the Node
workspace migration are complete, while the Python package is not yet present.

Last updated: 2026-07-16.

## Current state

The root is now a private Bun workspace with a frozen lockfile. The unchanged
`@sjunepark/ytm` CLI/toolset package lives under `packages/node`, still ships
the same eight npm artifact paths, and consumes shared fixtures from
`contracts/kisnet` for request, normalization, and error-boundary coverage.

Next: add the buildable `packages/python` distribution, public Pydantic models,
and explicit error hierarchy before connecting the production source adapter.

## Objective

Publish a native Python package that retrieves KIS-NET YTM Matrix data without
requiring Node.js. Keep the existing npm CLI and toolset behavior stable while
both language packages share source-protocol fixtures, behavioral invariants,
and one product version.

The planned distribution name is `kisnet-ytm`; callers import `kisnet_ytm`.
The minimum supported Python version is 3.11.

## Target repository shape

```text
.
├── package.json               # private Bun workspace and root commands
├── packages/
│   ├── node/                  # existing @sjunepark/ytm package
│   └── python/
│       ├── pyproject.toml
│       ├── uv.lock
│       ├── src/kisnet_ytm/
│       └── tests/
├── contracts/kisnet/          # shared XML fixtures and expected behavior
├── docs/
├── skills/
└── release-please-config.json
```

Keep the Python `pyproject.toml` and lockfile inside `packages/python` while it
is the repository's only Python package. A root uv workspace is warranted only
after a second Python package needs a shared lock and workspace dependencies.

The root README remains a product-level entry point. Each published package
owns its installation and language-specific usage documentation. The agent
skill remains at the repository root and routes callers to the appropriate
language surface.

## Python interface

Start with a small synchronous interface rather than copying the Node
toolset's generic operation dispatcher:

```python
from datetime import date
from kisnet_ytm import fetch_matrix

matrix = fetch_matrix(
    date(2026, 6, 7),
    "국채",
    previous_available_days=10,
)

print(matrix.base_date)
print(matrix.rows[0].yields["10Y"])
```

The initial public interface consists of:

- `fetch_matrix(base_date, kind, *, previous_available_days=None)`
- `list_kinds(...)`
- Pydantic result models for matrices, rows, kinds, and date resolution
- `YtmError` with specific invalid-input, unavailable-data, source-transport,
  and source-format subclasses

Do not expose curl-cffi sessions, Nexacro records, internal transport types, or
the Node toolset's `execute(operation, input)` shape. Add an asynchronous
interface or a session-owning public client only after a concrete caller needs
one.

## Behavioral invariants

- Exact-date lookup is the default. No result may silently substitute another
  date.
- `previous_available_days=N` tries the requested date and then at most `N`
  earlier calendar dates in order.
- Previous-date probing continues only after KIS-NET confirms that matrix data
  is unavailable. Transport and source-format failures stop immediately.
- Results record the requested date, resolved date, and every attempted date.
- Yield values use `Decimal`; source `-` or empty yield cells become `None`.
- Successful matrices contain at least one row. Invalid numeric cells and
  missing required columns are source-format errors, not missing data.
- 종류 and tenor values remain source-compatible strings rather than closed
  enums, so upstream additions do not require an interface change.
- Python callers never require a Node.js installation or subprocess.

## Runtime seams and dependencies

```text
Python caller
    │
    ▼
public retrieval interface ──► validation and date resolution
    │
    ▼
private KIS-NET source seam
    ├── curl-cffi adapter ──► KIS-NET Nexacro endpoints
    └── fixture adapter    ──► deterministic tests
```

KIS-NET is a true external dependency. The private source seam isolates HTTP,
browser impersonation, Nexacro XML construction and parsing, and upstream
error classification. Tests use the fixture adapter through the same retrieval
logic.

Runtime dependencies:

- Pydantic for validated public result models
- curl-cffi for the production transport and browser impersonation
- Python standard-library `logging`; the package installs no handlers and
  never logs raw response bodies

Development and packaging tools:

- uv for dependency locking, environments, builds, and publishing
- Ruff for formatting and linting
- ty for static checking, pinned exactly while its compatibility is pre-stable
- pytest for deterministic behavior and contract tests

Browser impersonation stays an implementation detail. Normal CI uses captured
responses; a scheduled or manually triggered smoke test detects KIS-NET or
fingerprint changes without making pull requests depend on the live source.

## Shared source contract

`contracts/kisnet` owns representative init, matrix, unavailable-data,
malformed-response, and missing-value fixtures. Node and Python tests must
exercise the same cases and preserve these shared semantics:

- base-date and 종류 request mapping
- canonical tenor order
- `-` and empty-cell handling
- exact and previous-available date resolution
- distinction between unavailable data, transport failure, and malformed
  source data

Semantic parity does not require identical JavaScript and Python object shapes
or field casing. Each package should remain idiomatic for its language.

## Lockstep releases

Release Please remains the only version authority. Configure `packages/node`
and `packages/python` as components in one linked-version group so a releasable
change to either package advances both to the same version. Use one combined
release PR and component-prefixed tags, such as `node-vX.Y.Z` and
`python-vX.Y.Z`, to avoid tag collisions.

After the release PR merges, Release Please creates both component tags. Those
tags trigger registry workflows that publish both packages even when only one
package's implementation changed. This is an accepted cost of presenting the
Node and Python packages as two interfaces to one product.

The existing unprefixed tags remain historical. Do not switch workflows or
documentation to component-prefixed tags until the monorepo migration is
complete. The first shared release version is intentionally undecided and must
be confirmed before any release PR merge, tag, or registry publication.

Publishing targets:

- npm: `@sjunepark/ytm`
- PyPI: `kisnet-ytm`, using trusted publishing without a long-lived token

## Validation gates

Every pull request runs:

- the existing Node build, tool-surface validation, and npm pack dry run
- Ruff formatting and lint checks
- ty against `packages/python`
- Python tests across the supported-version matrix
- Python wheel and source-distribution builds
- installation and `import kisnet_ytm` from the built wheel in a clean
  environment
- shared contract fixtures in both implementations

Live KIS-NET smoke validation is scheduled or manual rather than a merge gate.
Before publishing, confirm that curl-cffi supplies wheels for every advertised
Python and operating-system target.

## Implementation sequence

1. [x] Add shared KIS-NET fixtures and characterize the existing Node behavior.
2. [x] Move the npm package to `packages/node` without changing its published
   interface, output, or validation behavior.
3. [ ] Add `packages/python`, its public models and errors, and package-build
   validation.
4. [ ] Implement the private Nexacro source seam, curl-cffi adapter, retrieval
   flow, fallback behavior, and logging.
5. [ ] Add cross-language contract tests, Python CI, scheduled network smoke
   validation, and clean-wheel installation tests.
6. [ ] Configure linked Release Please components and PyPI trusted publishing;
   update current-state release docs only after the new flow is operational.
7. [ ] Update the root README, package READMEs, source specification, and agent
   skill to describe shipped behavior, then run a final review of both public
   interfaces.

## Progress log

- 2026-07-16: Added versioned shared Nexacro fixtures and Node contract tests.
  `bun run test`, `npm pack --dry-run`, and `git diff --check` pass. Source
  transport and format failures are now distinct from confirmed unavailable
  data, so previous-date fallback cannot hide upstream breakage. Next: package
  the unchanged Node surface under `packages/node`.
- 2026-07-16: Converted the root to a private Bun workspace, moved the npm
  package to `packages/node`, and added the root `bun.lock`. Frozen install,
  root-delegated Node tests, npm pack dry-run, and artifact inspection pass.
  The package still contains the same eight published paths; package-owned
  docs avoid coupling npm contents to the cross-language root docs. Next: add
  the native Python package and build validation.

## Non-goals for the initial release

- Calling the Node CLI or toolset from Python
- A public generic transport or provider plugin system
- A public async client or batch-fetching interface
- Caching or persistence
- Identical serialized object shapes across languages
- Live external requests in ordinary pull-request validation
