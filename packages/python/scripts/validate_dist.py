"""Validate that the wheel is lean and the source archive is self-testable."""

from __future__ import annotations

import argparse
import inspect
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import zipfile
from pathlib import Path, PurePosixPath


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--python-version",
        default=f"{sys.version_info.major}.{sys.version_info.minor}",
        help="Python version used for the extracted source test environment",
    )
    return parser.parse_args()


def run(
    command: list[str],
    *,
    cwd: Path,
    environment_updates: dict[str, str] | None = None,
) -> None:
    environment = os.environ.copy()
    environment.pop("VIRTUAL_ENV", None)
    environment.update(environment_updates or {})
    subprocess.run(command, cwd=cwd, check=True, env=environment)


def environment_python(environment: Path) -> Path:
    if os.name == "nt":
        return environment / "Scripts" / "python.exe"
    return environment / "bin" / "python"


def validate_wheel(wheel_path: Path) -> None:
    with zipfile.ZipFile(wheel_path) as wheel:
        names = wheel.namelist()
    unexpected = [
        name for name in names if {"contracts", "tests"}.intersection(PurePosixPath(name).parts)
    ]
    if unexpected:
        raise RuntimeError(f"wheel contains source-only test assets: {unexpected}")


def validate_sdist_members(archive: tarfile.TarFile, root_name: str) -> None:
    names = {member.name for member in archive.getmembers()}
    contract_prefix = f"{root_name}/contracts/kisnet"
    cases_path = f"{contract_prefix}/cases.json"
    tests_path = f"{root_name}/tests/test_contract.py"
    build_hook_path = f"{root_name}/hatch_build.py"
    missing = {build_hook_path, cases_path, tests_path} - names
    if missing:
        raise RuntimeError(f"sdist is missing required test assets: {sorted(missing)}")

    cases_file = archive.extractfile(cases_path)
    if cases_file is None:
        raise RuntimeError(f"sdist contract manifest is not a file: {cases_path}")
    contract = json.load(cases_file)
    fixture_paths = {f"{contract_prefix}/{filename}" for filename in contract["fixtures"].values()}
    missing_fixtures = fixture_paths - names
    if missing_fixtures:
        raise RuntimeError(f"sdist is missing manifest fixtures: {sorted(missing_fixtures)}")


def extract_safely(
    archive: tarfile.TarFile,
    destination: Path,
    root_name: str,
) -> None:
    destination = destination.resolve()
    expected_root = (destination / root_name).resolve()
    for member in archive.getmembers():
        if member.name != root_name and not member.name.startswith(f"{root_name}/"):
            raise RuntimeError(f"sdist member is outside {root_name}: {member.name}")
        if not member.isfile() and not member.isdir():
            raise RuntimeError(f"unsupported sdist member type: {member.name}")
        target = (destination / member.name).resolve()
        if target != expected_root and not target.is_relative_to(expected_root):
            raise RuntimeError(f"unsafe sdist member: {member.name}")
    if "filter" in inspect.signature(archive.extractall).parameters:
        archive.extractall(destination, filter="data")
    else:
        archive.extractall(destination)


def main() -> None:
    args = parse_args()
    package_root = Path(__file__).resolve().parents[1]
    pyproject = tomllib.loads((package_root / "pyproject.toml").read_text(encoding="utf-8"))
    version = pyproject["project"]["version"]
    distribution_name = f"kisnet_ytm-{version}"
    dist_directory = package_root / "dist"
    sdist_path = dist_directory / f"{distribution_name}.tar.gz"
    wheel_paths = sorted(dist_directory.glob(f"{distribution_name}-*.whl"))

    if not sdist_path.is_file():
        raise RuntimeError(f"expected source distribution does not exist: {sdist_path}")
    if len(wheel_paths) != 1:
        raise RuntimeError(f"expected exactly one wheel for {version}, found: {wheel_paths}")
    validate_wheel(wheel_paths[0])

    with tempfile.TemporaryDirectory(prefix="kisnet-ytm-sdist-") as temporary:
        temporary_path = Path(temporary)
        with tarfile.open(sdist_path, "r:gz") as archive:
            validate_sdist_members(archive, distribution_name)
            extract_safely(archive, temporary_path, distribution_name)

        extracted_root = temporary_path / distribution_name
        rebuilt_distributions = temporary_path / "rebuilt-distributions"
        test_environment = temporary_path / "test-environment"
        run(
            ["uv", "build", "--out-dir", str(rebuilt_distributions)],
            cwd=extracted_root,
        )
        rebuilt_sdist_path = rebuilt_distributions / f"{distribution_name}.tar.gz"
        if not rebuilt_sdist_path.is_file():
            raise RuntimeError(
                f"expected source distribution rebuilt from the sdist: {rebuilt_sdist_path}"
            )
        with tarfile.open(rebuilt_sdist_path, "r:gz") as rebuilt_archive:
            validate_sdist_members(rebuilt_archive, distribution_name)

        rebuilt_wheel_paths = sorted(rebuilt_distributions.glob(f"{distribution_name}-*.whl"))
        if len(rebuilt_wheel_paths) != 1:
            raise RuntimeError(
                f"expected exactly one wheel rebuilt from the sdist, found: {rebuilt_wheel_paths}"
            )
        run(
            [
                "uv",
                "sync",
                "--locked",
                "--no-install-project",
                "--project",
                str(extracted_root),
                "--python",
                args.python_version,
            ],
            cwd=temporary_path,
            environment_updates={"UV_PROJECT_ENVIRONMENT": str(test_environment)},
        )
        test_python = environment_python(test_environment)
        run(
            [
                "uv",
                "pip",
                "install",
                "--python",
                str(test_python),
                "--no-deps",
                str(rebuilt_wheel_paths[0]),
            ],
            cwd=temporary_path,
        )
        run(
            [str(test_python), "-I", "-m", "pytest", str(extracted_root / "tests")],
            cwd=temporary_path,
        )

    message = "Python distributions valid: wheel excludes tests; sdist tests pass"
    print(f"{message} on Python {args.python_version}")


if __name__ == "__main__":
    main()
