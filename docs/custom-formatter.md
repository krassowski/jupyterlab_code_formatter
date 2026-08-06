# Adding Custom Formatters

To define a custom formatter, you can do so in the Jupyter notebook configuration (usually found `~/.jupyter/jupyter_notebook_config.py` or something along those lines), the following example adds a rather useless formatter as a example.

```python

from jupyterlab_code_formatter.formatters import BaseFormatter, handle_line_ending_and_magic, SERVER_FORMATTERS

class ExampleCustomFormatter(BaseFormatter):

    label = "Apply Example Custom Formatter"

    @property
    def importable(self) -> bool:
        return True

    @handle_line_ending_and_magic
    def format_code(self, code: str, notebook: bool, **options) -> str:
        return "42"

SERVER_FORMATTERS["example"] = ExampleCustomFormatter()

```

When implementing your custom formatter using third party library, you will likely use `try... except` in the `importable` block instead of always returning `True`.

The `handle_line_ending_and_magic` decorator hides notebook-specific syntax from the
formatter. Most of it (shell commands with `!`, `?` help lines, `run` scripts) only makes
sense for Python, so formatters for other languages should declare which language they
format:

```python
class ExampleRustFormatter(BaseFormatter):
    language = "rust"
    ...
```

The language defaults to `"python"`, so a formatter which does not declare one keeps
receiving the full set of escapes. Only `"python"` and `"r"` escape anything today — cell
magics and Quarto cell options are hidden from both, as neither is valid code in either
language and `#` starts a comment in both. Any other language, `"rust"` above included,
disables escaping altogether and gets the cell exactly as it was written.

Remember you are always welcomed to submit a pull request!
