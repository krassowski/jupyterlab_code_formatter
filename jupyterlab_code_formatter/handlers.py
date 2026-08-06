import json

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

from jupyterlab_code_formatter.formatters import SERVER_FORMATTERS


class FormattersAPIHandler(APIHandler):
    @tornado.web.authenticated
    def get(self) -> None:
        """Show what formatters are installed and available."""
        use_cache = self.get_query_argument("cached", default=None)
        self.finish(
            json.dumps({
                "formatters": {
                    name: {
                        "enabled": formatter.cached_importable
                        if use_cache
                        else formatter.importable,
                        "label": formatter.label,
                    }
                    for name, formatter in SERVER_FORMATTERS.items()
                }
            })
        )


class FormatAPIHandler(APIHandler):
    def _finish_with_error(self, status_code: int, message: str) -> None:
        """Report an error as JSON, as the other Jupyter Server APIs do.

        A plain-text reason in the status line is not reliably available to the
        client (it is dropped by HTTP/2 and by some proxies), so the message is
        sent in the body instead.
        """
        self.set_status(status_code)
        self.finish(json.dumps({"message": message}))

    @tornado.web.authenticated
    def post(self) -> None:
        data = json.loads(self.request.body.decode("utf-8"))
        formatter_name = data["formatter"]
        formatter_instance = SERVER_FORMATTERS.get(formatter_name)
        use_cache = self.get_query_argument("cached", default=None)

        if formatter_instance is None:
            known = ", ".join(sorted(SERVER_FORMATTERS))
            self._finish_with_error(
                404,
                f"Formatter {formatter_name!r} is unknown, please check the "
                f"`default_formatter` setting; known formatters are: {known}.",
            )
        elif not (
            formatter_instance.cached_importable
            if use_cache
            else formatter_instance.importable
        ):
            self._finish_with_error(
                404,
                f"Formatter {formatter_name!r} is not available, please make sure "
                "that it is installed in the environment running Jupyter Server.",
            )
        else:
            notebook = data["notebook"]
            options = data.get("options", {})
            formatted_code = []
            for code in data["code"]:
                try:
                    formatted_code.append({
                        "code": formatter_instance.format_code(
                            code, notebook, **options
                        )
                    })
                except Exception as e:
                    formatted_code.append({"error": str(e)})
            self.finish(json.dumps({"code": formatted_code}))


def setup_handlers(web_app):
    host_pattern = ".*$"

    base_url = web_app.settings["base_url"]

    web_app.add_handlers(
        host_pattern,
        [
            (
                url_path_join(base_url, "jupyterlab_code_formatter/formatters"),
                FormattersAPIHandler,
            )
        ],
    )

    web_app.add_handlers(
        host_pattern,
        [
            (
                url_path_join(base_url, "/jupyterlab_code_formatter/format"),
                FormatAPIHandler,
            )
        ],
    )
