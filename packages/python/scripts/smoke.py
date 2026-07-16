"""Run the non-gating live KIS-NET smoke check."""

from __future__ import annotations

import argparse
from datetime import date

from kisnet_ytm import fetch_matrix


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-date", type=date.fromisoformat, default=date.today())
    parser.add_argument("--kind", default="국채")
    parser.add_argument("--previous-available-days", type=int, default=10)
    args = parser.parse_args()

    matrix = fetch_matrix(
        args.base_date,
        args.kind,
        previous_available_days=args.previous_available_days,
    )
    print(
        "KIS-NET Python smoke passed:",
        f"requested={matrix.requested_date.isoformat()}",
        f"resolved={matrix.base_date.isoformat()}",
        f"kind={matrix.kind.code}:{matrix.kind.name}",
        f"rows={len(matrix.rows)}",
    )


if __name__ == "__main__":
    main()
