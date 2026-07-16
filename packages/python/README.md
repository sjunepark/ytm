# kisnet-ytm

`kisnet-ytm` provides synchronous, native Python access to the KIS-NET YTM
Matrix. It requires Python 3.11 or newer and does not invoke Node.js.

```python
from datetime import date

from kisnet_ytm import fetch_matrix

matrix = fetch_matrix(date(2026, 6, 7), "국채", previous_available_days=10)
print(matrix.base_date)
print(matrix.rows[0].yields["10Y"])
```

Exact-date lookup is the default. Pass `previous_available_days=N` only when a
caller explicitly wants the requested date followed by at most `N` earlier
calendar dates. Transport and source-format errors stop probing immediately.

## Development

```sh
uv sync --locked
uv run ruff format --check .
uv run ruff check .
uv run ty check
uv run pytest
uv build
```
