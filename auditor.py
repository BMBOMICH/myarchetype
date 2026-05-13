"""
File Length Audit Tool
Scans a project directory and reports files that exceed
recommended line count thresholds per file type.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import NamedTuple


# ─────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────

DIRECTORY = "."

LIMITS: dict[str, int] = {
    # Python
    ".py": 400,

    # JavaScript / TypeScript
    ".js": 300,
    ".ts": 300,
    ".tsx": 200,
    ".jsx": 200,

    # Web
    ".html": 400,
    ".css": 300,
    ".scss": 300,
    ".sass": 300,
    ".less": 300,

    # Frontend frameworks
    ".vue": 200,
    ".svelte": 200,

    # Other languages
    ".go": 500,
    ".rs": 500,
    ".java": 500,
    ".rb": 400,
    ".php": 400,
    ".c": 500,
    ".cpp": 500,
    ".h": 300,
    ".hpp": 300,
    ".swift": 400,
    ".kt": 400,
    ".dart": 400,
}

IGNORE_DIRS: set[str] = {
    # JavaScript / Node
    "node_modules",
    "bower_components",
    ".next",
    ".nuxt",
    ".cache",
    ".parcel-cache",
    ".turbo",

    # Build output
    "dist",
    "build",
    "out",
    "target",
    "bin",
    "obj",
    "lib",

    # Python
    "__pycache__",
    ".venv",
    "venv",
    "env",
    ".env",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "htmlcov",
    "eggs",
    "site-packages",

    # Django specific
    "migrations",
    "staticfiles",
    "media",
    "collected_static",

    # Version control
    ".git",
    ".svn",
    ".hg",

    # IDE
    ".idea",
    ".vscode",

    # Testing / Coverage
    "coverage",
    ".coverage",
    ".nyc_output",

    # Misc
    "vendor",
    "tmp",
    "temp",
    "logs",
}

IGNORE_PATTERNS: tuple[str, ...] = (
    ".min.js",
    ".min.css",
    ".bundle.js",
    ".chunk.js",
    ".map",
    ".lock",
    ".generated.",
    ".auto.",
    "-lock.",
    ".d.ts",
)

IGNORE_EXACT_FILES: set[str] = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "pipfile.lock",
    "composer.lock",
    "gemfile.lock",
    "auditor.py",
}

VALID_EXTENSIONS = tuple(LIMITS.keys())


# ─────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────

class FileResult(NamedTuple):
    lines: int
    limit: int
    over_by: int
    severity: str
    severity_rank: int
    path: str
    extension: str


class ScanStats(NamedTuple):
    total_files_scanned: int
    total_lines_scanned: int
    total_flagged: int
    red: int
    orange: int
    yellow: int
    green: int
    scan_time: float


# ─────────────────────────────────────────────
# CORE HELPERS
# ─────────────────────────────────────────────

def get_severity(line_count: int, limit: int) -> tuple[str, int]:
    """Return severity label and rank based on how far over the limit a file is."""
    ratio = line_count / limit

    if ratio >= 3:
        return "🔴 DEFINITELY SPLIT", 4
    if ratio >= 2:
        return "🟠 LIKELY SPLIT", 3
    if ratio >= 1.5:
        return "🟡 SHOULD REVIEW", 2
    return "🟢 MAYBE REVIEW", 1


def count_lines(file_path: str) -> int:
    """
    Safely count lines in a file.
    Returns -1 if the file cannot be read.
    """
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as file:
            return sum(1 for _ in file)
    except (OSError, IOError, PermissionError):
        return -1


def should_ignore_file(filename: str) -> bool:
    """Return True if a file should be skipped."""
    lower_name = filename.lower()

    if lower_name in IGNORE_EXACT_FILES:
        return True

    if lower_name.startswith("."):
        return True

    return any(pattern in lower_name for pattern in IGNORE_PATTERNS)


def should_ignore_dir(dirname: str) -> bool:
    """Return True if a directory should be skipped."""
    lower_name = dirname.lower()

    return (
        lower_name.startswith(".")
        or lower_name in IGNORE_DIRS
        or lower_name.endswith(".egg-info")
    )


# ─────────────────────────────────────────────
# SCAN LOGIC
# ─────────────────────────────────────────────

def scan_files() -> tuple[list[FileResult], ScanStats]:
    """Scan the configured directory and return flagged files plus summary stats."""
    results: list[FileResult] = []
    total_files_scanned = 0
    total_lines_scanned = 0
    start_time = time.time()

    for root, dirs, files in os.walk(DIRECTORY, topdown=True):
        dirs[:] = [directory for directory in dirs if not should_ignore_dir(directory)]
        dirs.sort()

        for filename in sorted(files):
            extension = Path(filename).suffix.lower()

            if extension not in VALID_EXTENSIONS:
                continue

            if should_ignore_file(filename):
                continue

            file_path = os.path.join(root, filename)
            limit = LIMITS[extension]
            line_count = count_lines(file_path)

            if line_count < 0:
                continue

            total_files_scanned += 1
            total_lines_scanned += line_count

            if line_count > limit:
                severity, severity_rank = get_severity(line_count, limit)
                relative_path = os.path.relpath(file_path, DIRECTORY)

                results.append(
                    FileResult(
                        lines=line_count,
                        limit=limit,
                        over_by=line_count - limit,
                        severity=severity,
                        severity_rank=severity_rank,
                        path=relative_path,
                        extension=extension,
                    )
                )

    scan_time = time.time() - start_time

    results.sort(
        key=lambda result: (result.severity_rank, result.over_by, result.lines),
        reverse=True,
    )

    stats = ScanStats(
        total_files_scanned=total_files_scanned,
        total_lines_scanned=total_lines_scanned,
        total_flagged=len(results),
        red=sum(1 for result in results if result.severity_rank == 4),
        orange=sum(1 for result in results if result.severity_rank == 3),
        yellow=sum(1 for result in results if result.severity_rank == 2),
        green=sum(1 for result in results if result.severity_rank == 1),
        scan_time=scan_time,
    )

    return results, stats


# ─────────────────────────────────────────────
# OUTPUT
# ─────────────────────────────────────────────

def format_number(value: int) -> str:
    """Format an integer with commas."""
    return f"{value:,}"


def print_report(results: list[FileResult], stats: ScanStats) -> None:
    """Print the audit report."""
    width = 100

    print()
    print("=" * width)
    print("  FILE LENGTH AUDIT REPORT")
    print("=" * width)
    print()

    if not results:
        print(f"  ✅ All {format_number(stats.total_files_scanned)} files are within limits.")
        print(f"  📊 Total lines scanned: {format_number(stats.total_lines_scanned)}")
        print(f"  ⏱️  Scan time: {stats.scan_time:.3f}s")
        print()
        print("=" * width)
        print()
        return

    print(f"  {'LINES':<8} {'LIMIT':<8} {'OVER BY':<10} {'STATUS':<24} FILE")
    print("  " + "-" * (width - 2))

    current_rank = None
    for result in results:
        if current_rank is not None and result.severity_rank != current_rank:
            print()
        current_rank = result.severity_rank

        print(
            f"  {result.lines:<8} "
            f"{result.limit:<8} "
            f"+{result.over_by:<9} "
            f"{result.severity:<24} "
            f"{result.path}"
        )

    print()
    print("  " + "-" * (width - 2))
    print()
    print("  SUMMARY")
    print("  " + "-" * 40)
    print(f"  🔴 Definitely split:  {stats.red}")
    print(f"  🟠 Likely split:      {stats.orange}")
    print(f"  🟡 Should review:     {stats.yellow}")
    print(f"  🟢 Maybe review:      {stats.green}")
    print(f"  📁 Total flagged:     {stats.total_flagged}")
    print()
    print("  SCAN STATS")
    print("  " + "-" * 40)
    print(f"  Files scanned:        {format_number(stats.total_files_scanned)}")
    print(f"  Total lines scanned:  {format_number(stats.total_lines_scanned)}")
    print(f"  Scan time:            {stats.scan_time:.3f}s")
    print()

    extension_groups: dict[str, list[FileResult]] = {}
    for result in results:
        extension_groups.setdefault(result.extension, []).append(result)

    print("  BREAKDOWN BY FILE TYPE")
    print("  " + "-" * 40)
    for extension in sorted(extension_groups):
        group = extension_groups[extension]
        worst = max(item.lines for item in group)
        print(f"  {extension:<12} {len(group)} file(s), worst: {worst} lines")

    print()
    print("  LEGEND")
    print("  " + "-" * 40)
    print("  🟢 MAYBE REVIEW     — slightly over, might be fine")
    print("  🟡 SHOULD REVIEW    — getting big, worth checking")
    print("  🟠 LIKELY SPLIT     — probably doing too much")
    print("  🔴 DEFINITELY SPLIT — way too big, should be split")
    print()
    print("=" * width)
    print()


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main() -> None:
    results, stats = scan_files()
    print_report(results, stats)


if __name__ == "__main__":
    main()