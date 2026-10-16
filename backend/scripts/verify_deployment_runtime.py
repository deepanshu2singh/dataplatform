"""Check the reduced runtime locally, without contacting DB or cloud Storage."""
import hashlib
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.core.health import EXPECTED_ALEMBIC_HEAD
from app.api.routes.datasets import infer_csv_schema
from app.services.python_snapshot import prepare_python_snapshot
from app.services.sql_executor import SQLExecutor, SQLValidationError


def main():
    if any(importlib.util.find_spec(name) is not None for name in ("pyarrow", "openpyxl", "xlrd")):
        raise RuntimeError("Rebuild the runtime image: removed dependencies are still installed.")
    if EXPECTED_ALEMBIC_HEAD != "20261011_0005":
        raise RuntimeError("Deployment migration assets are incomplete.")
    original_upload_dir = settings.UPLOAD_DIR
    try:
        with TemporaryDirectory() as temporary:
            settings.UPLOAD_DIR = temporary
            path = Path(temporary) / "deployment-smoke.csv"
            path.write_text("product,revenue\nLaptop,12\nMonitor,5\n", encoding="utf-8")
            if infer_csv_schema(path)["row_count"] != 2:
                raise RuntimeError("CSV schema check failed.")
            executor = SQLExecutor()
            result = executor.execute("SELECT SUM(revenue) AS revenue FROM dataset", {"file_path": str(path)})
            if not result["success"] or result["data"] != [{"revenue": 17.0}]:
                raise RuntimeError("CSV SQL check failed.")
            try:
                executor.execute("DELETE FROM dataset", {"file_path": str(path)})
            except SQLValidationError:
                pass
            else:
                raise RuntimeError("Write SQL was accepted.")
            content, metadata = prepare_python_snapshot(path, 2)
            if metadata["loaded_row_count"] != 2 or metadata["sha256"] != hashlib.sha256(content).hexdigest():
                raise RuntimeError("Python snapshot check failed.")
            with TestClient(app, base_url=settings.FRONTEND_URL) as client:
                checks = [
                    client.get("/health/live").status_code == 200,
                    client.get("/api/v1/datasets/upload-config").status_code == 401,
                    client.get("/api/v1/not-a-route").status_code == 404,
                    client.post("/api/v1/datasets/uploads/prepare", headers={"Origin": "https://untrusted.example.test"}, json={}).status_code == 403,
                ]
                if not all(checks):
                    raise RuntimeError("Health/auth/CSRF checks failed.")
    finally:
        settings.UPLOAD_DIR = original_upload_dir
    print(json.dumps({"DEPLOYMENT_RUNTIME": "PASS", "CSV_SQL_SNAPSHOT": "PASS", "AUTH_CSRF": "PASS", "LIVE_CLOUD_ACCEPTANCE": "pending"}))


if __name__ == "__main__":
    main()
