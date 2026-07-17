"""Hatch build hooks for repository and extracted-sdist layouts."""

from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    """Include shared contracts without making extracted sdists depend on the monorepo."""

    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if self.target_name != "sdist":
            return

        project_root = Path(self.root)
        repository_contracts = project_root.parent.parent / "contracts" / "kisnet"
        archived_contracts = project_root / "contracts" / "kisnet"
        contracts = archived_contracts if archived_contracts.is_dir() else repository_contracts
        if not contracts.is_dir():
            raise RuntimeError("KIS-NET contract fixtures are required to build the source archive")

        build_data["force_include"][str(contracts)] = "contracts/kisnet"
