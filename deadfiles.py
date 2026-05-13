"""
Dead File Detector — Full Edition
Scans a project directory and reports files, folders, assets,
packages, and environment variables that appear to be unused,
redundant, or safe to delete.

Now includes CSS class usage analysis.
"""

from __future__ import annotations

import os
import re
import json
import time
import hashlib
from pathlib import Path
from typing import NamedTuple


# ─────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────

DIRECTORY = "."

SCAN_EXTENSIONS: tuple[str, ...] = (
    ".py", ".js", ".ts", ".tsx", ".jsx",
    ".html", ".css", ".scss", ".sass", ".less",
    ".vue", ".svelte", ".json", ".yaml", ".yml",
    ".go", ".rs", ".java", ".rb", ".php",
    ".c", ".cpp", ".h", ".hpp",
    ".swift", ".kt", ".dart",
    ".md", ".txt", ".cfg", ".ini", ".toml",
    ".sh", ".bat",
)

ASSET_EXTENSIONS: tuple[str, ...] = (
    # Images
    ".png", ".jpg", ".jpeg", ".gif", ".svg",
    ".webp", ".ico", ".bmp", ".tiff",
    # Fonts
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    # Video / Audio
    ".mp4", ".webm", ".mp3", ".wav", ".ogg",
    # Documents
    ".pdf",
)

CSS_EXTENSIONS: set[str] = {
    ".css", ".scss", ".sass", ".less",
}

# Extensions where we look for class usage
TEMPLATE_EXTENSIONS: set[str] = {
    ".html", ".jsx", ".tsx", ".js", ".ts",
    ".vue", ".svelte", ".php", ".erb",
    ".jinja", ".jinja2", ".j2", ".njk",
    ".pug", ".ejs",
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
    ".pnpm",            # Add this (Fixes the massive node_modules list)
    "res",              # Add this (Fixes the android image list)
    "generated",        # Add this
    "dist",             # Should already be there
    "build",            # Should already be there
    "objects",          # Add this (Fixes the .git folder list

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

SKIP_UNREFERENCED_DIRS: set[str] = {
    "app",
    "__tests__",
    "__mocks__",
    "tests",
    "test",
    "scripts",
    "public",
    "e2e",
    "modules",
}

IGNORE_PATTERNS: tuple[str, ...] = (
    ".min.js",
    ".min.css",
    ".bundle.js",
    ".chunk.js",
    ".map",
    ".d.ts",
)

PLATFORM_SUFFIXES: tuple[str, ...] = (
    ".native.ts",
    ".native.tsx",
    ".native.js",
    ".web.ts",
    ".web.tsx",
    ".web.js",
    ".ios.ts",
    ".ios.tsx",
    ".android.ts",
    ".android.tsx",
)

PROTECTED_FILES: set[str] = {
    "package.json",
    "tsconfig.json",
    "tailwind.config.js",
    "tailwind.config.ts",
    "postcss.config.js",
    "postcss.config.mjs",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "vite.config.ts",
    "vite.config.js",
    "nuxt.config.ts",
    "nuxt.config.js",
    "svelte.config.js",
    "eslint.config.js",
    "eslint.config.mjs",
    ".eslintrc.js",
    ".eslintrc.json",
    ".prettierrc",
    ".prettierrc.json",
    ".gitignore",
    ".env",
    ".env.local",
    ".env.example",
    "readme.md",
    "license",
    "license.md",
    "changelog.md",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "makefile",
    "procfile",
    "requirements.txt",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "manage.py",
    "app.json",
    "eas.json",
    "babel.config.js",
    "metro.config.js",
    "jest.config.js",
    "jest.config.ts",
    "vitest.config.ts",
    "playwright.config.ts",
    "firebase.json",
    "firestore.rules",
    "storage.rules",
    "database.rules.json",
    "remixicon.css",
    "global.css",
    "globals.css",
    "index.html",
    "index.ts",
    "index.js",
    "main.ts",
    "main.js",
    "app.tsx",
    "app.ts",
    "app.js",
    "commitlint.config.js",
    "commitlint.config.ts",
    "lint-staged.config.js",
    "prettier.config.js",
    "stylelint.config.js",
    "deadfiles.py",
    "auditor.py",
}

TINY_FILE_EXCEPTIONS: set[str] = {
    ".json", ".yaml", ".yml",
    ".cfg", ".ini", ".toml",
    ".md", ".txt",
    ".sh", ".bat",
}

IMPORTABLE_EXTENSIONS: set[str] = {
    ".ts", ".tsx", ".js", ".jsx",
    ".py", ".vue", ".svelte",
    ".css", ".scss", ".sass", ".less",
}

FRAMEWORK_STEMS: set[str] = {
    "_layout", "_app", "layout", "page",
    "index", "main", "app", "global",
    "middleware", "not-found", "error",
    "loading", "template", "head",
    "globals", "reset", "base",
    "root", "entry",
}

BACKUP_PATTERNS: tuple[str, ...] = (
    ".bak", ".backup", ".old", ".orig",
    ".copy", ".tmp", ".temp",
    " copy", " - copy",
    "(1)", "(2)", "(3)",
    "_old", "_backup", "_bak",
    "_copy", "_temp", "_tmp",
    ".deprecated", ".unused",
)

TEMP_PATTERNS: tuple[str, ...] = (
    "test_scratch", "scratch",
    "todo_delete", "delete_me", "remove_me",
    "temp_", "tmp_",
    "junk", "trash",
    "wip_", "draft_",
    "experiment", "playground",
    "sandbox", "throwaway",
    "quick_test", "debug_",
)

# Size threshold for flagging large assets (5MB)
LARGE_ASSET_THRESHOLD_BYTES = 5 * 1024 * 1024

# Only report CSS classes if a file has at least this many defined
CSS_MIN_CLASSES_TO_REPORT = 1

# CSS classes that are always used — frameworks inject these at runtime
# or they are pseudo-states, so never flag them
CSS_ALWAYS_USED_PREFIXES: tuple[str, ...] = (
    # Tailwind utilities (generated — never in source as class names)
    "hover:", "focus:", "active:", "disabled:",
    "sm:", "md:", "lg:", "xl:", "2xl:",
    "dark:", "light:", "motion:",
    "group-", "peer-",
    # Common framework classes
    "ng-", "v-", "nuxt-", "svelte-",
    # Animation states
    "is-", "has-", "was-",
    # JS-added state classes (used at runtime)
    "active", "open", "closed", "visible",
    "hidden", "show", "hide", "selected",
    "disabled", "enabled", "loading",
    "error", "success", "warning", "info",
    "fade", "slide", "collapse",
    "animate", "transition",
)

# Patterns that indicate a class is dynamically generated
# If a class name contains these, skip it — we can't trace it statically
CSS_DYNAMIC_INDICATORS: tuple[str, ...] = (
    "${", "#{", "@{",          # Template literals / interpolation
    "+", "*", ">", "~",        # CSS combinators (not class names)
)


# ─────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────

class FileInfo(NamedTuple):
    path: str
    filename: str
    extension: str
    size_bytes: int
    line_count: int
    code_lines: int
    comment_lines: int
    top_folder: str


class DeadFileResult(NamedTuple):
    path: str
    reason: str
    reason_rank: int
    size_bytes: int
    line_count: int
    category: str


class UnusedCssClass(NamedTuple):
    css_file: str
    class_name: str
    line_number: int
    confidence: str   # "high", "medium", "low"


class ScanStats(NamedTuple):
    total_files_scanned: int
    total_assets_scanned: int
    total_dead_found: int
    empty_count: int
    backup_count: int
    duplicate_count: int
    content_duplicate_count: int
    unreferenced_count: int
    temp_count: int
    comment_count: int
    tiny_count: int
    empty_folder_count: int
    unused_asset_count: int
    large_asset_count: int
    unused_package_count: int
    unused_env_count: int
    unused_css_class_count: int
    scan_time: float


# ─────────────────────────────────────────────
# REASONS
# ─────────────────────────────────────────────

REASONS: dict[str, tuple[str, int]] = {
    "empty":             ("🔴 EMPTY FILE",          6),
    "content_duplicate": ("🔴 EXACT DUPLICATE",      6),
    "backup":            ("🟠 BACKUP / OLD COPY",    5),
    "duplicate_name":    ("🟠 DUPLICATE NAME",       5),
    "large_asset":       ("🟠 LARGE ASSET",          5),
    "unused_package":    ("🟠 UNUSED PACKAGE",       5),
    "unreferenced":      ("🟡 POSSIBLY UNUSED",      4),
    "unused_asset":      ("🟡 UNUSED ASSET",         4),
    "unused_env":        ("🟡 UNUSED ENV VAR",       4),
    "empty_folder":      ("🟡 EMPTY FOLDER",         4),
    "temp":              ("🟡 TEMP / TEST FILE",     4),
    "dead_comment":      ("🟢 MOSTLY COMMENTS",      2),
    "tiny":              ("🟢 SUSPICIOUSLY TINY",    1),
}


# ─────────────────────────────────────────────
# CORE HELPERS
# ─────────────────────────────────────────────

def analyze_file(file_path: str) -> tuple[int, int, int]:
    """
    Analyze a file in a single pass.
    Returns (total_lines, code_lines, comment_lines).
    Returns (-1, 0, 0) on failure.
    """
    total_lines = 0
    code_lines = 0
    comment_lines = 0

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            in_block_comment = False

            for line in f:
                total_lines += 1
                stripped = line.strip()

                if not stripped:
                    continue

                if "/*" in stripped and "*/" not in stripped:
                    in_block_comment = True
                    comment_lines += 1
                    continue

                if in_block_comment:
                    comment_lines += 1
                    if "*/" in stripped:
                        in_block_comment = False
                    continue

                if (
                    stripped.startswith("//")
                    or stripped.startswith("#")
                    or stripped.startswith("<!--")
                    or stripped.startswith("/*")
                    or stripped.startswith("*")
                    or stripped.startswith('"""')
                    or stripped.startswith("'''")
                ):
                    comment_lines += 1
                else:
                    code_lines += 1

    except (OSError, IOError, PermissionError):
        return -1, 0, 0

    return total_lines, code_lines, comment_lines


def hash_file(file_path: str) -> str | None:
    """Return MD5 hash of a file's content. Returns None on failure."""
    try:
        hasher = hashlib.md5()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                hasher.update(chunk)
        return hasher.hexdigest()
    except (OSError, IOError, PermissionError):
        return None


def get_file_size(file_path: str) -> int:
    """Get file size in bytes. Returns -1 on failure."""
    try:
        return os.path.getsize(file_path)
    except OSError:
        return -1


def get_top_folder(relative_path: str) -> str:
    """Get the top-level folder name from a relative path."""
    parts = Path(relative_path).parts
    return parts[0].lower() if len(parts) > 1 else ""


def should_ignore_dir(dirname: str) -> bool:
    """Return True if a directory should be skipped."""
    lower_name = dirname.lower()
    return (
        lower_name.startswith(".")
        or lower_name in IGNORE_DIRS
        or lower_name.endswith(".egg-info")
    )


def should_ignore_file(filename: str) -> bool:
    """Return True if a file should be skipped."""
    lower_name = filename.lower()
    return any(pattern in lower_name for pattern in IGNORE_PATTERNS)


def is_protected(filename: str) -> bool:
    """Return True if a file should never be flagged."""
    return filename.lower() in PROTECTED_FILES


def is_platform_specific(filename: str) -> bool:
    """Return True if a file is a platform-specific variant."""
    lower = filename.lower()
    return any(lower.endswith(suffix) for suffix in PLATFORM_SUFFIXES)


def format_size(size_bytes: int) -> str:
    """Format bytes into a human readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"


def format_number(value: int) -> str:
    """Format an integer with commas."""
    return f"{value:,}"


# ─────────────────────────────────────────────
# CSS CLASS ANALYSIS
# ─────────────────────────────────────────────

# Matches standard .class-name selectors
# Handles: .foo, .foo-bar, .foo__bar, .foo--bar, .foo_bar
_CSS_CLASS_DEFINITION = re.compile(
    r"\.(-?[a-zA-Z_][a-zA-Z0-9_\-]*)"
)

# Strips out pseudo-classes and pseudo-elements so we get the bare class name
# e.g.  .btn:hover  →  .btn
_CSS_PSEUDO = re.compile(r"::?[\w-]+")

# Strips attribute selectors:  .btn[disabled]  →  .btn
_CSS_ATTR = re.compile(r"\[.*?\]")

# Lines that look like CSS property declarations — skip these
# e.g.  color: red;   background-color: blue;
_CSS_PROPERTY_LINE = re.compile(r"^\s*[\w-]+\s*:")

# Animation keyframe names — never count these as class names
_CSS_AT_RULE = re.compile(r"^\s*@")

# Matches class usage in HTML/JSX/templates
_HTML_CLASS_ATTR = re.compile(
    r"""class(?:Name)?\s*[=:]\s*["'`]([^"'`]*)["'`]"""
)

# Matches clsx / classnames / cn() utility calls
# clsx("foo", "bar", { active: isActive })
_CLSX_CALL = re.compile(
    r"""(?:clsx|classnames|cn|cva|tv)\s*\(([^)]{0,500})\)""",
    re.DOTALL,
)

# Matches string literals inside JS/TS for class-like values
# e.g.  addClass("btn-primary")   classList.add("active")
_JS_CLASS_STRING = re.compile(
    r"""(?:addClass|classList\.add|classList\.toggle|classList\.remove|classList\.contains)\s*\(\s*["'`]([^"'`]+)["'`]"""
)

# Matches template literal fragments — catches static parts
# e.g.  `btn ${variant}`  →  captures "btn"
_TEMPLATE_LITERAL_STATIC = re.compile(
    r"`([^`$]*?)(?:\$\{|`)"
)


def _is_always_used(class_name: str) -> bool:
    """Return True if this class should never be flagged."""
    lower = class_name.lower()
    return any(lower.startswith(prefix) for prefix in CSS_ALWAYS_USED_PREFIXES)


def _has_dynamic_indicator(text: str) -> bool:
    """Return True if text contains dynamic/runtime indicators."""
    return any(ind in text for ind in CSS_DYNAMIC_INDICATORS)


def extract_defined_classes(css_file_path: str) -> list[tuple[str, int]]:
    """
    Parse a CSS / SCSS / SASS / LESS file and extract all defined class names.

    Returns a list of (class_name, line_number) tuples.
    Skips:
      - Property declarations (color: red)
      - @keyframe / @media names
      - Pseudo-elements (::before)
      - SCSS variables ($var)
      - SCSS/LESS mixin definitions
    """
    defined: list[tuple[str, int]] = []
    seen: set[str] = set()

    try:
        with open(css_file_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
    except (OSError, IOError, PermissionError):
        return defined

    in_block_comment = False
    in_keyframes = False
    keyframe_depth = 0
    brace_depth = 0

    for line_num, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()

        # ── Skip block comments ──
        if "/*" in line and "*/" not in line:
            in_block_comment = True
            continue
        if in_block_comment:
            if "*/" in line:
                in_block_comment = False
            continue

        # ── Skip single-line comments ──
        if line.startswith("//") or line.startswith("*"):
            continue

        # ── Track @keyframes blocks — classes inside are animation steps ──
        if re.search(r"@keyframes", line, re.IGNORECASE):
            in_keyframes = True
            keyframe_depth = brace_depth
            continue

        brace_depth += line.count("{") - line.count("}")

        if in_keyframes:
            if brace_depth <= keyframe_depth:
                in_keyframes = False
            continue

        # ── Skip @rules that aren't selectors ──
        if _CSS_AT_RULE.match(line) and "{" not in line:
            continue

        # ── Skip property declarations ──
        if _CSS_PROPERTY_LINE.match(line) and "{" not in line:
            continue

        # ── Skip SCSS variables and mixin definitions ──
        if line.startswith("$") or line.startswith("@{"):
            continue
        if re.match(r"@mixin|@include|@extend|@function|@return", line):
            continue

        # ── Strip pseudo-classes and attribute selectors ──
        cleaned = _CSS_PSEUDO.sub("", line)
        cleaned = _CSS_ATTR.sub("", cleaned)

        # ── Extract class names ──
        for match in _CSS_CLASS_DEFINITION.finditer(cleaned):
            class_name = match.group(1)

            # Skip empty, single character (unlikely real class),
            # and dynamically-looking names
            if len(class_name) < 2:
                continue
            if _has_dynamic_indicator(class_name):
                continue
            if _is_always_used(class_name):
                continue
            if class_name in seen:
                continue

            seen.add(class_name)
            defined.append((class_name, line_num))

    return defined


def extract_used_classes(all_files: list[FileInfo]) -> set[str]:
    """
    Scan all template and JS/TS files to find every CSS class that
    is actually referenced in the project.

    Handles:
      - className="foo bar"              (JSX/TSX)
      - class="foo bar"                  (HTML)
      - clsx("foo", { bar: condition })  (clsx / classnames / cn)
      - classList.add("foo")             (vanilla JS)
      - Template literals with static parts
    """
    used: set[str] = set()

    # Valid class name chars — bare minimum
    _valid_class = re.compile(r"^-?[a-zA-Z_][a-zA-Z0-9_\-]*$")

    for file_info in all_files:
        if file_info.extension not in TEMPLATE_EXTENSIONS:
            continue

        file_path = os.path.join(DIRECTORY, file_info.path)
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except (OSError, IOError, PermissionError):
            continue

        # ── 1. class="..." and className="..." ──
        for match in _HTML_CLASS_ATTR.finditer(content):
            value = match.group(1)
            if _has_dynamic_indicator(value):
                # Still extract static parts before the ${ marker
                static_part = value.split("${")[0].strip()
                for cls in static_part.split():
                    if _valid_class.match(cls):
                        used.add(cls)
            else:
                for cls in value.split():
                    if _valid_class.match(cls):
                        used.add(cls)

        # ── 2. clsx() / classnames() / cn() calls ──
        for match in _CLSX_CALL.finditer(content):
            inner = match.group(1)
            # Extract all quoted strings inside the call
            for string_match in re.finditer(r"""["'`]([^"'`]+)["'`]""", inner):
                value = string_match.group(1)
                if not _has_dynamic_indicator(value):
                    for cls in value.split():
                        if _valid_class.match(cls):
                            used.add(cls)

        # ── 3. classList.add("foo") and similar ──
        for match in _JS_CLASS_STRING.finditer(content):
            value = match.group(1)
            for cls in value.split():
                if _valid_class.match(cls):
                    used.add(cls)

        # ── 4. Static parts of template literals ──
        for match in _TEMPLATE_LITERAL_STATIC.finditer(content):
            static = match.group(1).strip()
            for cls in static.split():
                if _valid_class.match(cls):
                    used.add(cls)

        # ── 5. Any remaining bare string literals that look like class lists ──
        # This catches things like:  toggle("btn-active")
        for string_match in re.finditer(
            r"""["']([a-zA-Z][\w\s\-]{2,100})["']""", content
        ):
            value = string_match.group(1)
            # Only process if it looks like space-separated class names
            parts = value.split()
            if 1 <= len(parts) <= 8:
                for cls in parts:
                    if _valid_class.match(cls) and len(cls) >= 2:
                        used.add(cls)

    return used


def find_unused_css_classes(
    all_files: list[FileInfo],
) -> list[UnusedCssClass]:
    """
    Main CSS analysis entry point.

    1. Finds all CSS class definitions across .css/.scss/.sass/.less files.
    2. Finds all class usages across HTML/JSX/TSX/Vue/Svelte files.
    3. Reports classes that are defined but never used.

    Confidence levels:
      high   — class is not found anywhere in the project source
      medium — class is only found inside its own CSS file (i.e. nested rules)
      low    — class appears in other contexts but not as a usage
    """
    results: list[UnusedCssClass] = []

    # Collect all CSS files
    css_files: list[FileInfo] = [
        f for f in all_files if f.extension in CSS_EXTENSIONS
    ]

    if not css_files:
        return results

    # Build the set of all used class names from templates
    print("  Extracting class usages from templates...")
    used_classes = extract_used_classes(all_files)

    # Also read all project source as a raw string for a final fallback check
    # This catches unconventional usages we may have missed
    raw_project_content = _build_raw_content(all_files)

    print(f"  Found {format_number(len(used_classes))} unique class references")
    print(f"  Scanning CSS files for definitions...")

    for file_info in css_files:
        if is_protected(file_info.filename):
            continue

        file_path = os.path.join(DIRECTORY, file_info.path)
        defined = extract_defined_classes(file_path)

        if len(defined) < CSS_MIN_CLASSES_TO_REPORT:
            continue

        for class_name, line_num in defined:
            if class_name in used_classes:
                continue

            if _is_always_used(class_name):
                continue

            # Fallback: raw string search across entire project
            # This catches dynamic usages we can't parse structurally
            confidence = _assess_confidence(class_name, raw_project_content)

            if confidence is None:
                # Found somewhere in raw content — probably used dynamically
                continue

            results.append(UnusedCssClass(
                css_file=file_info.path,
                class_name=class_name,
                line_number=line_num,
                confidence=confidence,
            ))

    # Sort: high confidence first, then by file, then by line number
    confidence_order = {"high": 0, "medium": 1, "low": 2}
    results.sort(key=lambda r: (
        confidence_order.get(r.confidence, 9),
        r.css_file,
        r.line_number,
    ))

    return results


def _build_raw_content(all_files: list[FileInfo]) -> str:
    """
    Build a single large string of all project content.
    Used as a last-resort fallback to check if a class name
    appears anywhere at all.
    """
    parts: list[str] = []

    for file_info in all_files:
        # Skip the CSS files themselves — we only want template/JS usage
        if file_info.extension in CSS_EXTENSIONS:
            continue

        file_path = os.path.join(DIRECTORY, file_info.path)
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                parts.append(f.read())
        except (OSError, IOError, PermissionError):
            continue

    return "\n".join(parts)


def _assess_confidence(class_name: str, raw_content: str) -> str | None:
    """
    Determine how confident we are that a class is unused.

    Returns:
      "high"    — not found anywhere in non-CSS source
      "medium"  — appears somewhere but not in a class attribute
      None      — appears to be used — do not report
    """
    # If the class name doesn't appear anywhere in raw content at all
    if class_name not in raw_content:
        return "high"

    # It appears somewhere — check if it looks like actual class usage
    # Search for the class name surrounded by typical usage patterns
    usage_patterns = [
        re.compile(rf"""["'\s`]({re.escape(class_name)})["'\s`]"""),
        re.compile(rf"""class[Nn]ame.*?{re.escape(class_name)}"""),
        re.compile(rf"""add\s*\(\s*["']{re.escape(class_name)}"""),
        re.compile(rf"""toggle\s*\(\s*["']{re.escape(class_name)}"""),
    ]

    for pattern in usage_patterns:
        if pattern.search(raw_content):
            # Looks like it might be used — don't report with high confidence
            return None

    # Found in raw content but not in a clear usage pattern
    return "medium"


# ─────────────────────────────────────────────
# COLLECTORS
# ─────────────────────────────────────────────

def collect_all_files() -> list[FileInfo]:
    """Collect all scannable source files in the project."""
    all_files: list[FileInfo] = []

    for root, dirs, files in os.walk(DIRECTORY, topdown=True):
        dirs[:] = [d for d in dirs if not should_ignore_dir(d)]
        dirs.sort()

        for filename in sorted(files):
            ext = Path(filename).suffix.lower()

            if ext not in SCAN_EXTENSIONS:
                continue

            if should_ignore_file(filename):
                continue

            file_path = os.path.join(root, filename)
            size_bytes = get_file_size(file_path)
            total_lines, code_lines, comment_lines = analyze_file(file_path)

            if total_lines < 0 or size_bytes < 0:
                continue

            relative_path = os.path.relpath(file_path, DIRECTORY)
            top_folder = get_top_folder(relative_path)

            all_files.append(FileInfo(
                path=relative_path,
                filename=filename,
                extension=ext,
                size_bytes=size_bytes,
                line_count=total_lines,
                code_lines=code_lines,
                comment_lines=comment_lines,
                top_folder=top_folder,
            ))

    return all_files


def collect_all_assets() -> list[tuple[str, int]]:
    """Collect all asset files (images, fonts, etc.) with their sizes."""
    assets: list[tuple[str, int]] = []

    for root, dirs, files in os.walk(DIRECTORY, topdown=True):
        dirs[:] = [d for d in dirs if not should_ignore_dir(d)]
        dirs.sort()

        for filename in sorted(files):
            ext = Path(filename).suffix.lower()

            if ext not in ASSET_EXTENSIONS:
                continue

            file_path = os.path.join(root, filename)
            size_bytes = get_file_size(file_path)

            if size_bytes < 0:
                continue

            relative_path = os.path.relpath(file_path, DIRECTORY)
            assets.append((relative_path, size_bytes))

    return assets


def collect_empty_folders() -> list[str]:
    """Find all empty folders in the project."""
    empty_folders: list[str] = []

    # These top-level folders should never be checked for empty subfolders
    SKIP_EMPTY_FOLDER_ROOTS: set[str] = {
        "node_modules",
        "dist",
        ".git",
        "build",
        "out",
        ".next",
        ".nuxt",
        ".expo",
        "android",
        "ios",
        "web-push",
    }

    for root, dirs, files in os.walk(DIRECTORY, topdown=False):
        dirs[:] = [d for d in dirs if not should_ignore_dir(d)]

        relative_root = os.path.relpath(root, DIRECTORY)

        if relative_root == ".":
            continue

        # Skip anything whose top-level parent is in the skip list
        top = Path(relative_root).parts[0].lower()
        if top in SKIP_EMPTY_FOLDER_ROOTS:
            continue

        has_files = len(files) > 0
        has_subdirs = any(
            not should_ignore_dir(d) for d in os.listdir(root)
            if os.path.isdir(os.path.join(root, d))
        )

        if not has_files and not has_subdirs:
            empty_folders.append(relative_root)

    return empty_folders


# ─────────────────────────────────────────────
# ANALYSIS HELPERS
# ─────────────────────────────────────────────

def build_import_index(all_files: list[FileInfo]) -> set[str]:
    """
    Build a set of all filenames and modules referenced
    by import / require / include statements across the project.
    """
    referenced: set[str] = set()

    import_patterns = [
        re.compile(r"""(?:import|export)\s+.*?from\s+['"](.*?)['"]"""),
        re.compile(r"""require\(\s*['"](.*?)['"]\s*\)"""),
        re.compile(r"""import\(\s*['"](.*?)['"]\s*\)"""),
        re.compile(r"""from\s+([\w.]+)\s+import"""),
        re.compile(r"""^import\s+([\w.]+)""", re.MULTILINE),
        re.compile(r"""@import\s+['"](.*?)['"]"""),
        re.compile(r"""(?:src|href|url)\s*[=(:]\s*['"](.*?)['"]"""),
    ]

    for file_info in all_files:
        file_path = os.path.join(DIRECTORY, file_info.path)
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            for pattern in import_patterns:
                for match in pattern.findall(content):
                    clean = match.strip()
                    if not clean:
                        continue

                    parts = clean.replace("\\", "/").split("/")
                    module_name = parts[-1]
                    base_name = Path(module_name).stem

                    referenced.add(base_name.lower())
                    referenced.add(module_name.lower())
                    referenced.add(clean.lower())

        except (OSError, IOError, PermissionError):
            continue

    return referenced


def find_content_duplicates(
    all_files: list[FileInfo],
) -> dict[str, list[str]]:
    """
    Find files with identical content using MD5 hashing.
    Returns a dict of hash -> list of paths.
    """
    hash_map: dict[str, list[str]] = {}

    for file_info in all_files:
        if file_info.size_bytes > 500 * 1024:
            continue

        file_path = os.path.join(DIRECTORY, file_info.path)
        file_hash = hash_file(file_path)

        if file_hash:
            hash_map.setdefault(file_hash, []).append(file_info.path)

    return {h: paths for h, paths in hash_map.items() if len(paths) > 1}


def check_unused_packages(all_files: list[FileInfo]) -> list[str]:
    """
    Read package.json and check which dependencies are never
    imported in the source code.
    """
    unused: list[str] = []

    package_json_path = os.path.join(DIRECTORY, "package.json")
    if not os.path.exists(package_json_path):
        return unused

    try:
        with open(package_json_path, "r", encoding="utf-8") as f:
            package_data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return unused

    dependencies: dict[str, str] = {}
    dependencies.update(package_data.get("dependencies", {}))
    dependencies.update(package_data.get("devDependencies", {}))

    if not dependencies:
        return unused

    all_content = ""
    for file_info in all_files:
        if file_info.extension not in IMPORTABLE_EXTENSIONS:
            continue
        file_path = os.path.join(DIRECTORY, file_info.path)
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                all_content += f.read() + "\n"
        except (OSError, IOError, PermissionError):
            continue

    always_needed: set[str] = {
        "react", "react-dom", "react-native",
        "typescript", "next", "expo",
        "webpack", "vite", "rollup", "esbuild",
        "eslint", "prettier", "jest", "vitest",
        "@types/node", "@types/react",
        "tailwindcss", "postcss", "autoprefixer",
        "babel-loader", "@babel/core",
        "ts-node", "tsx",
    }

    for package_name in sorted(dependencies.keys()):
        if package_name.lower() in always_needed:
            continue

        search_name = package_name.replace("-", "").replace("_", "").lower()
        content_clean = all_content.replace("-", "").replace("_", "").lower()

        if (
            package_name.lower() not in all_content.lower()
            and search_name not in content_clean
        ):
            unused.append(package_name)

    return unused


def check_unused_env_vars(all_files: list[FileInfo]) -> list[str]:
    """
    Read .env files and check which variables are never
    referenced in the source code.
    """
    unused: list[str] = []

    env_vars: list[str] = []
    env_files = [
        ".env", ".env.local", ".env.example",
        ".env.production", ".env.development",
    ]

    for env_file in env_files:
        env_path = os.path.join(DIRECTORY, env_file)
        if not os.path.exists(env_path):
            continue

        try:
            with open(env_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        var_name = line.split("=")[0].strip()
                        if var_name:
                            env_vars.append(var_name)
        except (OSError, IOError):
            continue

    if not env_vars:
        return unused

    all_content = ""
    for file_info in all_files:
        if file_info.extension not in IMPORTABLE_EXTENSIONS:
            continue
        file_path = os.path.join(DIRECTORY, file_info.path)
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                all_content += f.read() + "\n"
        except (OSError, IOError, PermissionError):
            continue

    for var in env_vars:
        if var not in all_content:
            unused.append(var)

    return unused


# ─────────────────────────────────────────────
# MAIN DETECTION
# ─────────────────────────────────────────────

def detect_dead_files(
    all_files: list[FileInfo],
    referenced: set[str],
    content_duplicates: dict[str, list[str]],
) -> list[DeadFileResult]:
    """Analyze all source files and flag potentially dead ones."""
    results: list[DeadFileResult] = []

    duplicate_paths: set[str] = set()
    for paths in content_duplicates.values():
        for path in paths[1:]:
            duplicate_paths.add(path)

    seen_in_folder: dict[str, list[FileInfo]] = {}
    for file_info in all_files:
        parent = str(Path(file_info.path).parent)
        key = f"{parent}|{Path(file_info.filename).stem.lower()}"
        seen_in_folder.setdefault(key, []).append(file_info)

    for file_info in all_files:
        if is_protected(file_info.filename):
            continue

        lower_name = file_info.filename.lower()
        stem = Path(file_info.filename).stem.lower()
        parent = str(Path(file_info.path).parent)
        key = f"{parent}|{stem}"

        # ── Check 1: Empty files ──
        if file_info.line_count == 0:
            reason, rank = REASONS["empty"]
            results.append(DeadFileResult(
                path=file_info.path, reason=reason,
                reason_rank=rank, size_bytes=file_info.size_bytes,
                line_count=file_info.line_count, category="file",
            ))
            continue

        # ── Check 2: Exact content duplicates ──
        if file_info.path in duplicate_paths:
            reason, rank = REASONS["content_duplicate"]
            results.append(DeadFileResult(
                path=file_info.path, reason=reason,
                reason_rank=rank, size_bytes=file_info.size_bytes,
                line_count=file_info.line_count, category="file",
            ))
            continue

        # ── Check 3: Backup / old copy ──
        if any(pattern in lower_name for pattern in BACKUP_PATTERNS):
            reason, rank = REASONS["backup"]
            results.append(DeadFileResult(
                path=file_info.path, reason=reason,
                reason_rank=rank, size_bytes=file_info.size_bytes,
                line_count=file_info.line_count, category="file",
            ))
            continue

        # ── Check 4: Temp / test file ──
        if any(pattern in lower_name for pattern in TEMP_PATTERNS):
            reason, rank = REASONS["temp"]
            results.append(DeadFileResult(
                path=file_info.path, reason=reason,
                reason_rank=rank, size_bytes=file_info.size_bytes,
                line_count=file_info.line_count, category="file",
            ))
            continue

        # ── Check 5: Duplicate name in same folder ──
        siblings = seen_in_folder.get(key, [])
        if len(siblings) > 1:
            if file_info.extension not in (".json", ".yaml", ".yml"):
                reason, rank = REASONS["duplicate_name"]
                results.append(DeadFileResult(
                    path=file_info.path, reason=reason,
                    reason_rank=rank, size_bytes=file_info.size_bytes,
                    line_count=file_info.line_count, category="file",
                ))
                continue

        # ── Check 6: Mostly comments ──
        if file_info.line_count > 10:
            total_meaningful = file_info.code_lines + file_info.comment_lines
            if (
                total_meaningful > 0
                and file_info.comment_lines / total_meaningful > 0.8
            ):
                reason, rank = REASONS["dead_comment"]
                results.append(DeadFileResult(
                    path=file_info.path, reason=reason,
                    reason_rank=rank, size_bytes=file_info.size_bytes,
                    line_count=file_info.line_count, category="file",
                ))
                continue

        # ── Check 7: Suspiciously tiny ──
        if (
            file_info.line_count <= 3
            and file_info.extension not in TINY_FILE_EXCEPTIONS
            and not is_platform_specific(file_info.filename)
        ):
            reason, rank = REASONS["tiny"]
            results.append(DeadFileResult(
                path=file_info.path, reason=reason,
                reason_rank=rank, size_bytes=file_info.size_bytes,
                line_count=file_info.line_count, category="file",
            ))
            continue

        # ── Check 8: Not referenced anywhere ──
        if file_info.extension in IMPORTABLE_EXTENSIONS:
            if file_info.top_folder in SKIP_UNREFERENCED_DIRS:
                continue
            if is_platform_specific(file_info.filename):
                continue
            if stem not in referenced and lower_name not in referenced:
                if stem not in FRAMEWORK_STEMS and not any(
                    p in stem for p in FRAMEWORK_STEMS
                ):
                    reason, rank = REASONS["unreferenced"]
                    results.append(DeadFileResult(
                        path=file_info.path, reason=reason,
                        reason_rank=rank, size_bytes=file_info.size_bytes,
                        line_count=file_info.line_count, category="file",
                    ))

    results.sort(key=lambda r: (r.reason_rank, r.path), reverse=True)
    return results


def detect_dead_assets(
    all_assets: list[tuple[str, int]],
    referenced: set[str],
) -> list[DeadFileResult]:
    """Check assets for unused or oversized files."""
    results: list[DeadFileResult] = []

    for asset_path, size_bytes in all_assets:
        filename = Path(asset_path).name
        stem = Path(filename).stem.lower()
        lower_name = filename.lower()

        if size_bytes > LARGE_ASSET_THRESHOLD_BYTES:
            reason, rank = REASONS["large_asset"]
            results.append(DeadFileResult(
                path=asset_path, reason=reason,
                reason_rank=rank, size_bytes=size_bytes,
                line_count=0, category="asset",
            ))
            continue

        if stem not in referenced and lower_name not in referenced:
            if asset_path.lower().replace("\\", "/") not in referenced:
                reason, rank = REASONS["unused_asset"]
                results.append(DeadFileResult(
                    path=asset_path, reason=reason,
                    reason_rank=rank, size_bytes=size_bytes,
                    line_count=0, category="asset",
                ))

    results.sort(key=lambda r: (r.reason_rank, r.size_bytes), reverse=True)
    return results


# ─────────────────────────────────────────────
# OUTPUT
# ─────────────────────────────────────────────

def print_section(
    title: str,
    results: list,
    width: int,
    show_size: bool = True,
) -> None:
    """Print a report section."""
    if not results:
        return

    print(f"  {'─' * (width - 4)}")
    print(f"  {title}")
    print(f"  {'─' * (width - 4)}")

    if results and isinstance(results[0], str):
        for item in results:
            print(f"  ⚠️  {item}")
    else:
        current_rank = None
        for result in results:
            if not isinstance(result, DeadFileResult):
                continue
            if current_rank is not None and result.reason_rank != current_rank:
                print()
            current_rank = result.reason_rank

            size_str = format_size(result.size_bytes) if show_size else ""
            lines_str = str(result.line_count) if result.line_count > 0 else "—"

            print(
                f"  {lines_str:<8} "
                f"{size_str:<10} "
                f"{result.reason:<26} "
                f"{result.path}"
            )

    print()


def print_css_section(
    unused_classes: list[UnusedCssClass],
    width: int,
) -> None:
    """Print the CSS class analysis section."""
    if not unused_classes:
        return

    print(f"  {'─' * (width - 4)}")
    print("  UNUSED CSS CLASSES")
    print(f"  {'─' * (width - 4)}")
    print()
    print(
        f"  {'CONFIDENCE':<12} {'LINE':<7} {'CLASS NAME':<35} FILE"
    )
    print()

    confidence_icons = {
        "high":   "🔴",
        "medium": "🟡",
        "low":    "🟢",
    }

    # Group by file for readability
    current_file = None
    for entry in unused_classes:
        if entry.css_file != current_file:
            if current_file is not None:
                print()
            current_file = entry.css_file
            print(f"  📄 {entry.css_file}")

        icon = confidence_icons.get(entry.confidence, "⚪")
        conf_label = f"{icon} {entry.confidence.upper()}"

        print(
            f"  {conf_label:<16} "
            f"L{entry.line_number:<6} "
            f".{entry.class_name:<35}"
        )

    print()
    print(
        "  ℹ️  High   = not found anywhere in project source\n"
        "  ℹ️  Medium = found in source but not as a class usage\n"
        "  ℹ️  Low    = possibly dynamic — review manually\n"
        "  ⚠️  Dynamic classes (e.g. `btn-${variant}`) cannot be detected.\n"
    )


def print_report(
    file_results: list[DeadFileResult],
    asset_results: list[DeadFileResult],
    empty_folders: list[str],
    unused_packages: list[str],
    unused_env_vars: list[str],
    content_duplicates: dict[str, list[str]],
    unused_css_classes: list[UnusedCssClass],
    stats: ScanStats,
) -> None:
    """Print the full dead file report."""
    width = 110

    print()
    print("=" * width)
    print("  DEAD FILE DETECTION REPORT — FULL AUDIT")
    print("=" * width)
    print()
    print(f"  {'LINES':<8} {'SIZE':<10} {'STATUS':<26} FILE")
    print()

    if file_results:
        print_section("SOURCE FILES", file_results, width)

    if asset_results:
        print_section("ASSETS (Images / Fonts / Media)", asset_results, width)

    if empty_folders:
        print(f"  {'─' * (width - 4)}")
        print("  EMPTY FOLDERS")
        print(f"  {'─' * (width - 4)}")
        for folder in sorted(empty_folders):
            print(f"  🟡 EMPTY FOLDER            {folder}")
        print()

    if content_duplicates:
        print(f"  {'─' * (width - 4)}")
        print("  EXACT CONTENT DUPLICATES")
        print(f"  {'─' * (width - 4)}")
        for _file_hash, paths in content_duplicates.items():
            print("  🔴 These files are identical:")
            for path in paths:
                print(f"       {path}")
            print()

    if unused_packages:
        print(f"  {'─' * (width - 4)}")
        print("  UNUSED NPM PACKAGES  (verify before removing)")
        print(f"  {'─' * (width - 4)}")
        for pkg in unused_packages:
            print(f"  🟠 UNUSED PACKAGE          {pkg}")
        print()

    if unused_env_vars:
        print(f"  {'─' * (width - 4)}")
        print("  UNUSED ENVIRONMENT VARIABLES  (verify before removing)")
        print(f"  {'─' * (width - 4)}")
        for var in unused_env_vars:
            print(f"  🟡 UNUSED ENV VAR          {var}")
        print()

    # CSS classes section
    print_css_section(unused_css_classes, width)

    # Summary
    print("=" * width)
    print()
    print("  SUMMARY")
    print("  " + "-" * 50)
    print(f"  🔴 Empty / exact duplicates:  {stats.empty_count + stats.content_duplicate_count}")
    print(f"  🟠 Backup / name duplicates:  {stats.backup_count + stats.duplicate_count}")
    print(f"  🟠 Large assets:              {stats.large_asset_count}")
    print(f"  🟠 Unused packages:           {stats.unused_package_count}")
    print(f"  🟡 Possibly unused files:     {stats.unreferenced_count + stats.temp_count}")
    print(f"  🟡 Unused assets:             {stats.unused_asset_count}")
    print(f"  🟡 Unused env vars:           {stats.unused_env_count}")
    print(f"  🟡 Empty folders:             {stats.empty_folder_count}")
    print(f"  🟡 Unused CSS classes:        {stats.unused_css_class_count}")
    print(f"  🟢 Comments / tiny:           {stats.comment_count + stats.tiny_count}")
    print(f"  📁 Total flagged:             {stats.total_dead_found}")
    print()
    print("  SCAN STATS")
    print("  " + "-" * 50)
    print(f"  Source files scanned:         {format_number(stats.total_files_scanned)}")
    print(f"  Asset files scanned:          {format_number(stats.total_assets_scanned)}")
    print(f"  Scan time:                    {stats.scan_time:.3f}s")
    print()
    print("  LEGEND")
    print("  " + "-" * 50)
    print("  🔴 EMPTY / EXACT DUPLICATE  — safe to delete")
    print("  🟠 BACKUP / LARGE / PKG     — very likely removable")
    print("  🟡 POSSIBLY UNUSED          — verify before deleting")
    print("  🟢 COMMENTS / TINY          — worth a quick look")
    print()
    print("  CSS CLASS CONFIDENCE")
    print("  " + "-" * 50)
    print("  🔴 High   — not found anywhere in project source")
    print("  🟡 Medium — found in source, but not as a class usage")
    print("  🟢 Low    — may be dynamically generated")
    print()
    print("  ⚠️  WARNING: Always verify before deleting!")
    print("  Some files may be loaded dynamically or by config.")
    print("  Dynamic CSS classes (e.g. btn-${variant}) cannot be detected.")
    print()
    print("=" * width)
    print()


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main() -> None:
    start_time = time.time()

    print()
    print("  Scanning files...")
    all_files = collect_all_files()
    all_assets = collect_all_assets()
    empty_folders = collect_empty_folders()

    print("  Building reference index...")
    referenced = build_import_index(all_files)

    print("  Checking for content duplicates...")
    content_duplicates = find_content_duplicates(all_files)

    print("  Checking npm packages...")
    unused_packages = check_unused_packages(all_files)

    print("  Checking environment variables...")
    unused_env_vars = check_unused_env_vars(all_files)

    print("  Analyzing CSS classes...")
    unused_css_classes = find_unused_css_classes(all_files)

    print("  Analyzing files...")
    file_results = detect_dead_files(all_files, referenced, content_duplicates)
    asset_results = detect_dead_assets(all_assets, referenced)

    scan_time = time.time() - start_time

    stats = ScanStats(
        total_files_scanned=len(all_files),
        total_assets_scanned=len(all_assets),
        total_dead_found=(
            len(file_results)
            + len(asset_results)
            + len(empty_folders)
            + len(unused_packages)
            + len(unused_env_vars)
            + len(unused_css_classes)
        ),
        empty_count=sum(1 for r in file_results if "EMPTY" in r.reason),
        backup_count=sum(1 for r in file_results if "BACKUP" in r.reason),
        duplicate_count=sum(1 for r in file_results if "DUPLICATE NAME" in r.reason),
        content_duplicate_count=sum(1 for r in file_results if "EXACT" in r.reason),
        unreferenced_count=sum(1 for r in file_results if "UNUSED" in r.reason),
        temp_count=sum(1 for r in file_results if "TEMP" in r.reason),
        comment_count=sum(1 for r in file_results if "COMMENTS" in r.reason),
        tiny_count=sum(1 for r in file_results if "TINY" in r.reason),
        empty_folder_count=len(empty_folders),
        unused_asset_count=sum(1 for r in asset_results if "UNUSED ASSET" in r.reason),
        large_asset_count=sum(1 for r in asset_results if "LARGE" in r.reason),
        unused_package_count=len(unused_packages),
        unused_env_count=len(unused_env_vars),
        unused_css_class_count=len(unused_css_classes),
        scan_time=scan_time,
    )

    print_report(
        file_results,
        asset_results,
        empty_folders,
        unused_packages,
        unused_env_vars,
        content_duplicates,
        unused_css_classes,
        stats,
    )


if __name__ == "__main__":
    main()