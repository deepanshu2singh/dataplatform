import json
import time
from pathlib import Path
from threading import Timer
from typing import Any

import duckdb
from sqlglot import exp, parse
from sqlglot.errors import ParseError

from app.core.config import settings


MAX_QUERY_LENGTH = 50_000
MAX_RESULT_ROWS = 1_000
MAX_DATASET_REFERENCES = 4

QUERY_TIMEOUT_SECONDS = 10

DUCKDB_MEMORY_LIMIT = "512MB"
DUCKDB_THREADS = 2


class SQLValidationError(ValueError):
    """Raised when user SQL violates the V1 SQL safety rules."""


class SQLExecutor:
    def execute(
        self,
        query: str,
        dataset_config: dict[str, Any],
        limit: int = 1000,
    ) -> dict[str, Any]:
        """
        Execute one read-only SQL query against exactly one
        authorised dataset.

        A new DuckDB connection is created for every execution.
        No SQL state is shared between users or requests.
        """

        file_path = self._validate_dataset_file(
            dataset_config,
        )

        normalized_query = self.validate_query(
            query,
        )

        effective_limit = max(
            1,
            min(
                int(limit),
                MAX_RESULT_ROWS,
            ),
        )

        connection: (
            duckdb.DuckDBPyConnection | None
        ) = None

        timer: Timer | None = None
        timed_out = False

        started = time.perf_counter()

        try:
            connection = self._create_connection(
                file_path,
            )

            def interrupt_query() -> None:
                nonlocal timed_out

                timed_out = True

                try:
                    if connection is not None:
                        connection.interrupt()
                except Exception:
                    # The query may already have finished.
                    pass

            timer = Timer(
                QUERY_TIMEOUT_SECONDS,
                interrupt_query,
            )

            timer.daemon = True
            timer.start()

            
             # We deliberately fetch one more row than the
             # requested limit.
             #
             # That allows us to tell the frontend whether
             # the displayed result was truncated.
             
            fetch_limit = effective_limit + 1

            wrapped_query = (
                "SELECT * "
                f"FROM ({normalized_query}) AS _user_query "
                f"LIMIT {fetch_limit}"
            )

            dataframe = (
                connection
                .execute(wrapped_query)
                .fetchdf()
            )

            truncated = (
                len(dataframe) > effective_limit
            )

            if truncated:
                dataframe = dataframe.head(
                    effective_limit
                )

            # Converting through JSON gives us JSON-safe
            # values and changes NaN/NaT to null.
            data = json.loads(
                dataframe.to_json(
                    orient="records",
                    date_format="iso",
                )
            )

            execution_ms = round(
                (
                    time.perf_counter()
                    - started
                )
                * 1000,
                2,
            )

            return {
                "success": True,
                "columns": (
                    dataframe.columns.tolist()
                ),
                "data": data,
                "row_count": len(dataframe),
                "dtypes": {
                    column: str(dtype)
                    for column, dtype
                    in dataframe.dtypes.items()
                },
                "truncated": truncated,
                "limit": effective_limit,
                "execution_ms": execution_ms,
                "error": None,
            }

        except duckdb.Error as exc:
            execution_ms = round(
                (
                    time.perf_counter()
                    - started
                )
                * 1000,
                2,
            )

            if timed_out:
                error_message = (
                    "Query exceeded the "
                    f"{QUERY_TIMEOUT_SECONDS}-second "
                    "execution limit."
                )
            else:
                error_message = (
                    self._safe_duckdb_error(
                        exc,
                        file_path,
                    )
                )

            return {
                "success": False,
                "columns": [],
                "data": [],
                "row_count": 0,
                "dtypes": {},
                "truncated": False,
                "limit": effective_limit,
                "execution_ms": execution_ms,
                "error": error_message,
            }

        finally:
            if timer is not None:
                timer.cancel()

            if connection is not None:
                connection.close()

    def validate_query(
        self,
        query: str,
    ) -> str:
        clean_query = query.strip()

        if not clean_query:
            raise SQLValidationError(
                "SQL query cannot be empty."
            )

        if len(clean_query) > MAX_QUERY_LENGTH:
            raise SQLValidationError(
                "SQL query is too large."
            )

        try:
            statements = parse(
                clean_query,
                read="duckdb",
            )
        except ParseError as exc:
            raise SQLValidationError(
                "SQL could not be parsed."
            ) from exc

        if len(statements) != 1:
            raise SQLValidationError(
                "Only one SQL statement is allowed."
            )

        expression = statements[0]

        allowed_root_types = (
            exp.Select,
            exp.Union,
            exp.Intersect,
            exp.Except,
        )

        if not isinstance(
            expression,
            allowed_root_types,
        ):
            raise SQLValidationError(
                "Only read-only SELECT queries are allowed."
            )

        # Prevent SELECT ... INTO style operations.
        for select_expression in (
            expression.find_all(exp.Select)
        ):
            if (
                select_expression.args.get("into")
                is not None
            ):
                raise SQLValidationError(
                    "SELECT INTO is not allowed."
                )

        # Recursive CTEs can create very expensive workloads.
        # They are unnecessary for V1.
        for with_expression in (
            expression.find_all(exp.With)
        ):
            if with_expression.args.get(
                "recursive"
            ):
                raise SQLValidationError(
                    "Recursive CTEs are not supported in V1."
                )

        cte_names = {
            cte.alias_or_name.casefold()
            for cte in expression.find_all(
                exp.CTE
            )
            if cte.alias_or_name
        }

        # Do not allow a CTE to pretend to be the
        # protected dataset table.
        if "dataset" in cte_names:
            raise SQLValidationError(
                'A CTE cannot be named "dataset".'
            )

        dataset_reference_count = 0

        for table in expression.find_all(
            exp.Table
        ):
            
             # A normal table reference has an Identifier
             # as `table.this`.
             #
             # Table functions such as read_csv(...)
             # do not satisfy this requirement.
             
            if not isinstance(
                table.this,
                exp.Identifier,
            ):
                raise SQLValidationError(
                    "Table functions are not allowed."
                )

            if table.catalog or table.db:
                raise SQLValidationError(
                    "Catalog-qualified or "
                    "schema-qualified tables "
                    "are not allowed."
                )

            table_name = (
                table.name.casefold()
            )

            if table_name == "dataset":
                dataset_reference_count += 1

                if (
                    dataset_reference_count
                    > MAX_DATASET_REFERENCES
                ):
                    raise SQLValidationError(
                        "The selected dataset may be "
                        f"referenced at most "
                        f"{MAX_DATASET_REFERENCES} times."
                    )

                continue

            if table_name in cte_names:
                continue

            raise SQLValidationError(
                f'Table "{table.name}" is not allowed. '
                'Use the selected dataset as "dataset".'
            )

        if dataset_reference_count == 0:
            raise SQLValidationError(
                'The query must read from "dataset".'
            )

        self._validate_functions(
            expression,
        )

        # Re-serialize from the parsed syntax tree.
        # This also removes trailing semicolons.
        return expression.sql(
            dialect="duckdb",
        )

    def _validate_functions(
        self,
        expression: exp.Expression,
    ) -> None:
        blocked_exact_names = {
            "glob",
            "query",
            "query_table",
            "current_setting",
            "getenv",
            "which_secret",
        }

        blocked_prefixes = (
            "read_",
            "scan_",
            "pragma_",
            "duckdb_",
            "http_",
            "https_",
            "s3_",
            "azure_",
        )

        for function in expression.find_all(
            exp.Func
        ):
            if isinstance(
                function,
                exp.Anonymous,
            ):
                function_name = (
                    function.name.casefold()
                )
            else:
                function_name = str(
                    function.sql_name()
                ).casefold()

            if (
                function_name
                in blocked_exact_names
            ):
                raise SQLValidationError(
                    f'Function "{function_name}" '
                    "is not allowed."
                )

            if function_name.startswith(
                blocked_prefixes
            ):
                raise SQLValidationError(
                    f'Function "{function_name}" '
                    "is not allowed."
                )

    def _validate_dataset_file(
        self,
        dataset_config: dict[str, Any],
    ) -> Path:
        file_path_value = (
            dataset_config.get("file_path")
        )

        if not file_path_value:
            raise SQLValidationError(
                "Dataset file configuration is missing."
            )

        upload_root = Path(
            settings.UPLOAD_DIR
        ).resolve()

        file_path = Path(
            file_path_value
        ).resolve()

        if (
            file_path == upload_root
            or upload_root not in file_path.parents
        ):
            raise SQLValidationError(
                "Dataset file path is invalid."
            )

        if file_path.suffix.lower() != ".csv":
            raise SQLValidationError(
                "Phase 4 currently supports "
                "CSV datasets only."
            )

        if not file_path.is_file():
            raise SQLValidationError(
                "Dataset file is missing."
            )

        return file_path

    def _create_connection(
        self,
        file_path: Path,
    ) -> duckdb.DuckDBPyConnection:
        
         # Every query gets its own in-memory DuckDB
         # connection. Nothing is shared across users.
         
        connection = duckdb.connect(
            database=":memory:",
        )

        connection.execute(
            f"SET threads = {DUCKDB_THREADS}"
        )

        connection.execute(
            "SET memory_limit = "
            f"'{DUCKDB_MEMORY_LIMIT}'"
        )

        # Prevent automatic extension installation/loading.
        connection.execute(
            "SET autoinstall_known_extensions = false"
        )

        connection.execute(
            "SET autoload_known_extensions = false"
        )

        connection.execute(
            "SET allow_community_extensions = false"
        )

        connection.execute(
            "SET allow_persistent_secrets = false"
        )

        path_literal = self._sql_string(
            str(file_path)
        )

        
         # Even with external access disabled,
         # DuckDB permits explicitly allowed paths.
         #
         # We allow exactly ONE file: the dataset
         # that the authenticated user selected.
         
        connection.execute(
            "SET allowed_paths = "
            f"[{path_literal}]"
        )

        connection.execute(
            "SET enable_external_access = false"
        )

        connection.execute(
    "CREATE TEMP VIEW dataset AS "
    "SELECT * FROM read_csv("
    f"{path_literal}, "
    "header = true, "
    "delim = ',', "
    "auto_detect = true, "
    "strict_mode = false"
    ")"
)

        
         # From this point forward, even if a query
         # somehow reached a configuration command,
         # it cannot change our security settings.
         
        connection.execute(
            "SET lock_configuration = true"
        )

        return connection

    @staticmethod
    def _sql_string(
        value: str,
    ) -> str:
        escaped = value.replace(
            "'",
            "''",
        )

        return f"'{escaped}'"

    @staticmethod
    def _safe_duckdb_error(
        exc: Exception,
        file_path: Path,
    ) -> str:
        message = str(exc)

        # Never expose internal filesystem paths.
        message = message.replace(
            str(file_path),
            "<dataset>",
        )

        # Avoid sending huge internal errors to the UI.
        if len(message) > 1000:
            message = (
                message[:1000]
                + "..."
            )

        return message


sql_executor = SQLExecutor()