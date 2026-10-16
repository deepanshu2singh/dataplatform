import hashlib
from pathlib import Path
from typing import Any

import pandas as pd

PYTHON_EXPORT_ROW_LIMIT = 10_000
PYTHON_EXPORT_MAX_BYTES = 10 * 1024 * 1024


class PythonSnapshotTooLarge(ValueError):
    pass


def prepare_python_snapshot(path: Path, source_row_count: int | None) -> tuple[bytes, dict[str, Any]]:
    try:
        frame = pd.read_csv(path, nrows=PYTHON_EXPORT_ROW_LIMIT + 1)
        truncated = len(frame) > PYTHON_EXPORT_ROW_LIMIT
        frame = frame.iloc[:PYTHON_EXPORT_ROW_LIMIT]
        content = frame.to_csv(index=False).encode("utf-8")
    except Exception as exc:
        raise ValueError("Could not prepare this CSV for browser Python") from exc
    if len(content) > PYTHON_EXPORT_MAX_BYTES:
        raise PythonSnapshotTooLarge(
            "This dataset snapshot is too large for browser Python. "
            "The V1 bridge is limited to 10 MB after CSV serialization."
        )
    loaded = len(frame)
    return content, {
        "csv_size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "source_row_count": source_row_count,
        "loaded_row_count": loaded,
        "truncated": truncated or (source_row_count is not None and source_row_count > loaded),
        "row_limit": PYTHON_EXPORT_ROW_LIMIT,
    }
