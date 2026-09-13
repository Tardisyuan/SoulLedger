"""One JSON object per log line, escaped by `json.dumps` (IS-22).

The production formatter used to be a `%`-template shaped like JSON. A quote
in a message ended the string early and a newline split the record in two, so
a line-oriented collector dropped or misparsed exactly the records with
exception text in them. No dependency: requirements.txt has no JSON logger.
"""
import json
import logging


class JsonFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "time": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)
