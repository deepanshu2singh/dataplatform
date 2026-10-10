import pytest

from app.services.sql_executor import SQLExecutor, SQLValidationError


@pytest.fixture()
def executor() -> SQLExecutor:
    return SQLExecutor()


def test_allows_simple_dataset_select(executor: SQLExecutor) -> None:
    normalized = executor.validate_query("SELECT * FROM dataset")
    assert "dataset" in normalized.casefold()


def test_allows_non_recursive_cte(executor: SQLExecutor) -> None:
    normalized = executor.validate_query(
        "WITH totals AS ("
        "SELECT product, SUM(revenue) AS total_revenue "
        "FROM dataset GROUP BY product"
        ") SELECT * FROM totals"
    )
    assert "totals" in normalized.casefold()


@pytest.mark.parametrize(
    "query",
    [
        "SELECT * FROM users",
        "DELETE FROM dataset",
        "SELECT * FROM dataset; SELECT * FROM dataset",
        "SELECT * FROM read_text('/etc/passwd')",
        "SELECT * FROM main.dataset",
        "WITH RECURSIVE x AS (SELECT * FROM dataset) SELECT * FROM x",
        "WITH dataset AS (SELECT * FROM dataset) SELECT * FROM dataset",
        (
            "SELECT a.order_id FROM dataset a "
            "CROSS JOIN dataset b "
            "CROSS JOIN dataset c "
            "CROSS JOIN dataset d "
            "CROSS JOIN dataset e"
        ),
    ],
)
def test_rejects_unsafe_or_out_of_scope_sql(
    executor: SQLExecutor,
    query: str,
) -> None:
    with pytest.raises(SQLValidationError):
        executor.validate_query(query)
