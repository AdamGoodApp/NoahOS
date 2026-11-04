"""Structured JSON logs on stdout (one object per line) for container log collection."""

from __future__ import annotations

import json
import logging
import sys
import time

_CONTEXT: dict[str, str] = {}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
            **_CONTEXT,
        }
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, ensure_ascii=False)


def setup(level: str = "INFO", **context: str) -> None:
    _CONTEXT.update({k: v for k, v in context.items() if v})
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    for noisy in ("websockets", "aioice", "aiortc", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
