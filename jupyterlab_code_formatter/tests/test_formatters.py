import json
import os
import sys
import typing as t
from subprocess import run
from unittest import mock

import pytest

from jupyterlab_code_formatter.formatters import (
    SERVER_FORMATTERS,
    BaseFormatter,
    handle_line_ending_and_magic,
)


def test_env_pollution_on_import():
    # should not pollute environment on import
    code = "; ".join([
        "from jupyterlab_code_formatter import formatters",
        "import json",
        "import os",
        "assert formatters",
        "print(json.dumps(os.environ.copy()))",
    ])
    result = run(
        [sys.executable, "-c", f"{code}"],
        capture_output=True,
        text=True,
        check=True,
        env={},
    )
    environ = json.loads(result.stdout)
    assert set(environ.keys()) - {"LC_CTYPE"} == set()


@pytest.mark.parametrize("name", SERVER_FORMATTERS)
def test_env_pollution_on_importable_check(name):
    formatter = SERVER_FORMATTERS[name]
    # should not pollute environment on `importable` check
    with mock.patch.dict(os.environ, {}, clear=True):
        # invoke the property getter
        is_importable = formatter.importable
        # the environment should have no extra keys
        assert set(os.environ.keys()) == set()
        if not is_importable:
            pytest.skip(
                f"{name} formatter was not importable, the test may yield false negatives"
            )


class EchoFormatter(BaseFormatter):
    """A formatter which records the code it receives and returns it unchanged."""

    label = "Apply Echo Formatter"
    importable = True

    def __init__(self, language: str) -> None:
        self.language = language
        self.seen: t.List[str] = []

    @handle_line_ending_and_magic
    def format_code(self, code: str, notebook: bool, **options) -> str:
        self.seen.append(code)
        return code


class IndentingFormatter(EchoFormatter):
    """A formatter which indents every line, like `styler` does with comments."""

    label = "Apply Indenting Formatter"

    def __init__(self, language: str, indent: int) -> None:
        super().__init__(language)
        self.indent = indent

    @handle_line_ending_and_magic
    def format_code(self, code: str, notebook: bool, **options) -> str:
        self.seen.append(code)
        return "\n".join(" " * self.indent + line for line in code.splitlines())


IPYTHON_ONLY_SYNTAX = ["!ls", "%time x = 1", "x?", "run script.py", "#| eval: false"]


@pytest.mark.parametrize("code", IPYTHON_ONLY_SYNTAX)
def test_escapes_ipython_syntax_for_python(code):
    """IPython-specific syntax should be hidden from Python formatters."""
    formatter = EchoFormatter(language="python")
    assert formatter.format_code(code, notebook=True) == code
    assert formatter.seen == [f"# \x01 {code}"]


@pytest.mark.parametrize("code", IPYTHON_ONLY_SYNTAX)
@pytest.mark.parametrize("language", ["r", "R", "rust", "scala", "c++"])
def test_does_not_escape_ipython_syntax_for_other_languages(code, language):
    """IPython-specific syntax does not exist in other languages, see issue #407."""
    formatter = EchoFormatter(language=language)
    assert formatter.format_code(code, notebook=True) == code
    assert formatter.seen == [code]


@pytest.mark.parametrize("indent", range(1, 6))
def test_unescapes_lines_moved_by_formatter(indent):
    """Formatters may re-indent the escaped line, which must still be unescaped."""
    formatter = IndentingFormatter(language="python", indent=indent)
    assert formatter.format_code("  !ls", notebook=True) == "  !ls"
