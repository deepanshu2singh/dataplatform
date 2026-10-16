from typing import Any

from app.models.dataset import Dataset
from app.services.dataset_files import dataset_file, run_file_operation
from app.services.sql_executor import sql_executor


async def execute_dataset_sql(dataset: Dataset, query: str, limit: int) -> dict[str, Any]:
    # Reject unsafe SQL before performing a potentially large storage download.
    sql_executor.validate_query(query)
    async with dataset_file(dataset.config or {}, dataset.owner_id) as path:
        return await run_file_operation(
            sql_executor.execute, query, {"file_path": str(path)}, limit,
        )
