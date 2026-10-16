import math
import json
from collections.abc import Iterable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.db.transactions import commit_with_optimistic_lock
from app.models.dashboard import Dashboard as DashboardModel
from app.models.dataset import Dataset as DatasetModel, DatasetType
from app.models.notebook import Notebook as NotebookModel
from app.models.user import User as UserModel
from app.schemas.dashboard import (
    DashboardChartConfig,
    DashboardCreate,
    DashboardLayout,
    DashboardMetricConfig,
    DashboardRead,
    DashboardReferenceIssue,
    DashboardTableConfig,
    DashboardUpdate,
    DashboardWidget,
    DashboardWidgetDataResponse,
    DashboardWidgetPreviewRequest,
    DashboardWidgetVisualization,
    MAX_CHART_POINTS,
)
from app.services.sql_executor import SQLValidationError, sql_executor
from app.services.dataset_execution import execute_dataset_sql
from app.services.dataset_files import DatasetFileError

router = APIRouter()


@router.post(
    "",
    response_model=DashboardRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_dashboard(
    dashboard_in: DashboardCreate,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    await validate_layout_references(
        db,
        dashboard_in.layout,
        current_user.id,
    )

    dashboard = DashboardModel(
        name=dashboard_in.name,
        description=dashboard_in.description,
        layout=dashboard_in.layout.model_dump(mode="json"),
        owner_id=current_user.id,
        is_public=False,
    )

    db.add(dashboard)
    await db.commit()
    await db.refresh(dashboard)

    return await build_dashboard_read(
        db,
        dashboard,
        current_user.id,
    )


@router.get("", response_model=list[DashboardRead])
async def list_dashboards(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    result = await db.execute(
        select(DashboardModel)
        .where(DashboardModel.owner_id == current_user.id)
        .order_by(
            func.coalesce(
                DashboardModel.updated_at,
                DashboardModel.created_at,
            ).desc(),
            DashboardModel.id.desc(),
        )
        .offset(skip)
        .limit(limit)
    )

    dashboards = result.scalars().all()

    return await build_dashboard_reads(
        db,
        dashboards,
        current_user.id,
    )




@router.post(
    "/widgets/preview",
    response_model=DashboardWidgetDataResponse,
)
async def preview_dashboard_widget(
    request: DashboardWidgetPreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """Execute an unsaved widget definition for the dashboard builder.

    The request never supplies a file path. Dataset ownership and the same
    SQL safety rules used by notebook execution are enforced before the query
    reaches DuckDB.
    """

    return await execute_widget_data(
        db=db,
        widget=request.widget,
        owner_id=current_user.id,
        dashboard_id=None,
    )


@router.post(
    "/{dashboard_id}/widgets/{widget_id}/execute",
    response_model=DashboardWidgetDataResponse,
)
async def execute_saved_dashboard_widget(
    dashboard_id: int,
    widget_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    dashboard = await get_owned_dashboard(
        db,
        dashboard_id,
        current_user.id,
    )

    layout = parse_dashboard_layout(dashboard)

    widget = next(
        (
            candidate
            for candidate in layout.widgets
            if candidate.id == widget_id
        ),
        None,
    )

    if widget is None:
        raise HTTPException(
            status_code=404,
            detail="Dashboard widget not found",
        )

    return await execute_widget_data(
        db=db,
        widget=widget,
        owner_id=current_user.id,
        dashboard_id=dashboard.id,
    )


@router.get("/{dashboard_id}", response_model=DashboardRead)
async def get_dashboard(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    dashboard = await get_owned_dashboard(
        db,
        dashboard_id,
        current_user.id,
    )

    return await build_dashboard_read(
        db,
        dashboard,
        current_user.id,
    )


@router.put("/{dashboard_id}", response_model=DashboardRead)
async def update_dashboard(
    dashboard_id: int,
    dashboard_in: DashboardUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    dashboard = await get_owned_dashboard(
        db,
        dashboard_id,
        current_user.id,
    )

    stored_layout = parse_dashboard_layout(dashboard)
    if dashboard_in.layout is not None and dashboard_in.layout.version < stored_layout.version:
        raise HTTPException(status_code=409, detail="This dashboard uses newer presentation settings. Reload this page before editing.")
    canvas_update = stored_layout.version >= 2 or (dashboard_in.layout is not None and dashboard_in.layout.version >= 2)
    if canvas_update and dashboard_in.expected_version != dashboard.version:
        raise HTTPException(status_code=409, detail="This dashboard changed in another tab. Your draft is still here; open the latest dashboard in another tab before deciding which changes to keep.")
    if dashboard_in.expected_version is not None and dashboard_in.expected_version != dashboard.version:
        raise HTTPException(status_code=409, detail="Dashboard changed in another tab. Reload before saving.")
    update_data = dashboard_in.model_dump(exclude_unset=True, exclude={"expected_version"})

    if "layout" in update_data and dashboard_in.layout is not None:
        await validate_layout_references(
            db,
            dashboard_in.layout,
            current_user.id,
        )

        update_data["layout"] = dashboard_in.layout.model_dump(
            mode="json"
        )

    # Public sharing is deliberately disabled until the dashboard
    # viewer is implemented and tested in a later phase.
    if "is_public" in update_data:
        update_data["is_public"] = False

    for field, value in update_data.items():
        setattr(dashboard, field, value)

    await commit_with_optimistic_lock(
        db,
        resource_name="Dashboard",
    )
    await db.refresh(dashboard)

    return await build_dashboard_read(
        db,
        dashboard,
        current_user.id,
    )


@router.delete(
    "/{dashboard_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_dashboard(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    dashboard = await get_owned_dashboard(
        db,
        dashboard_id,
        current_user.id,
    )

    await db.delete(dashboard)
    await commit_with_optimistic_lock(
        db,
        resource_name="Dashboard",
    )


async def execute_widget_data(
    *,
    db: AsyncSession,
    widget: DashboardWidget,
    owner_id: int,
    dashboard_id: int | None,
) -> DashboardWidgetDataResponse:
    if widget.type == "markdown":
        raise HTTPException(
            status_code=400,
            detail="Markdown widgets do not execute data queries.",
        )

    source = widget.source

    if source is None:
        raise HTTPException(
            status_code=400,
            detail="This widget has no data source.",
        )

    datasets = await get_owned_datasets(
        db,
        {source.dataset_id},
        owner_id,
    )
    dataset = datasets.get(source.dataset_id)

    if dataset is None:
        if dashboard_id is None:
            raise HTTPException(
                status_code=404,
                detail="Dataset not found",
            )

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "The dataset used by this widget is no longer available. "
                "Edit the dashboard and choose a replacement dataset."
            ),
        )

    if dataset.type != DatasetType.FILE:
        raise HTTPException(
            status_code=400,
            detail="V1 dashboard execution supports file datasets only.",
        )

    execution_limit = source.limit

    if widget.type == "chart":
        execution_limit = min(execution_limit, MAX_CHART_POINTS)
    elif widget.type == "metric":
        # Fetch at most two rows so we can detect an ambiguous metric query.
        execution_limit = min(execution_limit, 2)

    try:
        result = await execute_dataset_sql(
            dataset,
            source.query,
            execution_limit,
        )
    except DatasetFileError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except SQLValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    raise_for_failed_widget_execution(result)

    visualization = build_widget_visualization(
        widget,
        result,
    )

    return DashboardWidgetDataResponse(
        dashboard_id=dashboard_id,
        widget_id=widget.id,
        widget_type=widget.type,
        dataset_id=dataset.id,
        dataset_name=dataset.name,
        columns=result["columns"],
        data=result["data"],
        row_count=result["row_count"],
        dtypes=result["dtypes"],
        truncated=result["truncated"],
        limit=result["limit"],
        execution_ms=result["execution_ms"],
        visualization=visualization,
    )


def build_widget_visualization(
    widget: DashboardWidget,
    result: dict[str, Any],
) -> DashboardWidgetVisualization:
    columns = result["columns"]
    data = result["data"]

    if widget.type == "table":
        config = DashboardTableConfig.model_validate(widget.config)
        display_columns = config.columns or columns
        missing_columns = [
            column
            for column in display_columns
            if column not in columns
        ]

        if missing_columns:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Table widget references result columns that do not "
                    f"exist: {', '.join(missing_columns)}"
                ),
            )

        option_columns = set(config.column_options)
        if config.sort_column:
            option_columns.add(config.sort_column)
        if not option_columns.issubset(columns):
            raise HTTPException(400, "Table sort/format settings reference missing result columns.")

        return DashboardWidgetVisualization(
            kind="table",
            display_columns=display_columns,
            options=config.model_dump(mode="json", exclude_none=True),
        )

    if widget.type == "metric":
        config = DashboardMetricConfig.model_validate(widget.config)

        if config.value_column not in columns:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Metric value column "{config.value_column}" was not '
                    "returned by the saved query."
                ),
            )

        if result["truncated"] or len(data) != 1:
            raise HTTPException(
                status_code=400,
                detail="Metric queries must return exactly one row.",
            )

        value = data[0].get(config.value_column)

        if (
            config.format in {"number", "currency", "percent"}
            and value is not None
            and not is_number(value)
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Metric column "{config.value_column}" must contain '
                    "a numeric value for the selected format."
                ),
            )

        return DashboardWidgetVisualization(
            kind="metric",
            value_column=config.value_column,
            metric_value=value,
            format=config.format,
            decimals=config.decimals,
            prefix=config.prefix,
            suffix=config.suffix,
            options=config.model_dump(mode="json", exclude_none=True),
        )

    if widget.type == "chart":
        config = DashboardChartConfig.model_validate(widget.config)

        required_columns = [config.x_column, config.y_column]
        if config.chart_type == "combo" and config.y2_column:
            required_columns.append(config.y2_column)

        if config.series_column is not None:
            required_columns.append(config.series_column)

        missing_columns = [
            column
            for column in required_columns
            if column not in columns
        ]

        if missing_columns:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Chart configuration references result columns that do "
                    f"not exist: {', '.join(missing_columns)}"
                ),
            )

        numeric_columns = [config.y_column]
        if config.chart_type == "scatter":
            numeric_columns.append(config.x_column)
        if config.chart_type == "combo" and config.y2_column:
            numeric_columns.append(config.y2_column)
        for column in numeric_columns:
            values = [row.get(column) for row in data if row.get(column) is not None]
            if not all(is_number(value) for value in values):
                raise HTTPException(400, f'Chart numeric column "{column}" must contain finite numeric values or nulls.')
        y_values = [row.get(config.y_column) for row in data if row.get(config.y_column) is not None]
        if config.chart_type in {"pie", "donut"} and any(value < 0 for value in y_values):
            raise HTTPException(400, "Pie and donut charts cannot display negative values.")
        series_keys: set[str] = set()
        pairs: set[str] = set()
        for row in data:
            if isinstance(row.get(config.x_column), (dict, list)):
                raise HTTPException(400, "Chart labels must be scalar values, not nested objects or arrays.")
            if config.series_column and config.chart_type not in {"pie", "donut"}:
                value = row.get(config.series_column)
                if isinstance(value, (dict, list)):
                    raise HTTPException(400, "Chart series must be scalar values.")
                series_key = json.dumps([type(value).__name__, value], ensure_ascii=False)
                series_keys.add(series_key)
                if len(series_keys) > 12:
                    raise HTTPException(400, "Chart supports at most 12 series. Limit or aggregate series in your SQL query.")
                pair = json.dumps([type(row.get(config.x_column)).__name__, row.get(config.x_column), series_key], ensure_ascii=False)
                if config.chart_type != "scatter" and pair in pairs:
                    raise HTTPException(400, "Multiple rows have the same category and series. Aggregate the query with GROUP BY first.")
                pairs.add(pair)

        return DashboardWidgetVisualization(
            kind=config.chart_type,
            options=config.model_dump(mode="json", exclude_none=True),
            x_column=config.x_column,
            y_column=config.y_column,
            series_column=config.series_column,
            show_legend=config.show_legend,
        )

    raise HTTPException(
        status_code=400,
        detail="This widget type cannot execute data.",
    )


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def raise_for_failed_widget_execution(
    result: dict[str, Any],
) -> None:
    if result.get("success"):
        return

    error = result.get("error") or "Dashboard widget query failed."

    if "execution limit" in error.lower():
        status_code = status.HTTP_408_REQUEST_TIMEOUT
    else:
        status_code = status.HTTP_400_BAD_REQUEST

    raise HTTPException(
        status_code=status_code,
        detail=error,
    )


def parse_dashboard_layout(
    dashboard: DashboardModel,
) -> DashboardLayout:
    try:
        return DashboardLayout.model_validate(dashboard.layout or {})
    except ValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "A stored dashboard layout is invalid. "
                "Re-save or recreate this dashboard before continuing."
            ),
        ) from exc


async def get_owned_dashboard(
    db: AsyncSession,
    dashboard_id: int,
    owner_id: int,
) -> DashboardModel:
    result = await db.execute(
        select(DashboardModel).where(
            DashboardModel.id == dashboard_id,
            DashboardModel.owner_id == owner_id,
        )
    )

    dashboard = result.scalar_one_or_none()

    if not dashboard:
        raise HTTPException(
            status_code=404,
            detail="Dashboard not found",
        )

    return dashboard


async def validate_layout_references(
    db: AsyncSession,
    layout: DashboardLayout,
    owner_id: int,
) -> None:
    dataset_ids: set[int] = set()
    notebook_ids: set[int] = set()

    for widget in layout.widgets:
        source = widget.source

        if widget.type == "markdown":
            if source is not None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f'Markdown widget "{widget.title}" cannot have a '
                        "data source."
                    ),
                )
            continue

        if source is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Widget "{widget.title}" requires a data source.'
                ),
            )

        try:
            sql_executor.validate_query(source.query)
        except SQLValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Widget "{widget.title}" has invalid SQL: {exc}'
                ),
            ) from exc

        dataset_ids.add(source.dataset_id)

        if source.notebook_id is not None:
            notebook_ids.add(source.notebook_id)

    datasets = await get_owned_datasets(
        db,
        dataset_ids,
        owner_id,
    )

    missing_dataset_ids = dataset_ids - set(datasets)

    if missing_dataset_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                "One or more dashboard datasets do not exist or are not "
                "available to this account."
            ),
        )

    unsupported_dataset_ids = {
        dataset_id
        for dataset_id, dataset in datasets.items()
        if dataset.type != DatasetType.FILE
    }

    if unsupported_dataset_ids:
        raise HTTPException(
            status_code=400,
            detail="V1 dashboards currently support file datasets only.",
        )

    notebooks = await get_owned_notebooks(
        db,
        notebook_ids,
        owner_id,
    )

    if notebook_ids - set(notebooks):
        raise HTTPException(
            status_code=400,
            detail=(
                "One or more referenced notebooks do not exist or are not "
                "available to this account."
            ),
        )


async def build_dashboard_read(
    db: AsyncSession,
    dashboard: DashboardModel,
    owner_id: int,
) -> DashboardRead:
    results = await build_dashboard_reads(
        db,
        [dashboard],
        owner_id,
    )

    return results[0]


async def build_dashboard_reads(
    db: AsyncSession,
    dashboards: Iterable[DashboardModel],
    owner_id: int,
) -> list[DashboardRead]:
    dashboard_list = list(dashboards)
    parsed_layouts: dict[int, DashboardLayout] = {}
    dataset_ids: set[int] = set()
    notebook_ids: set[int] = set()

    for dashboard in dashboard_list:
        layout = parse_dashboard_layout(dashboard)

        parsed_layouts[dashboard.id] = layout

        for widget in layout.widgets:
            if widget.source is None:
                continue

            dataset_ids.add(widget.source.dataset_id)

            if widget.source.notebook_id is not None:
                notebook_ids.add(widget.source.notebook_id)

    datasets = await get_owned_datasets(
        db,
        dataset_ids,
        owner_id,
    )
    notebooks = await get_owned_notebooks(
        db,
        notebook_ids,
        owner_id,
    )

    response: list[DashboardRead] = []

    for dashboard in dashboard_list:
        layout = parsed_layouts[dashboard.id]
        issues: list[DashboardReferenceIssue] = []

        for widget in layout.widgets:
            source = widget.source

            if widget.type == "markdown":
                if source is not None:
                    issues.append(
                        DashboardReferenceIssue(
                            widget_id=widget.id,
                            reference_type="widget",
                            message=(
                                "This markdown widget has legacy data-source "
                                "configuration and should be re-saved."
                            ),
                        )
                    )
                continue

            if source is None:
                issues.append(
                    DashboardReferenceIssue(
                        widget_id=widget.id,
                        reference_type="widget",
                        message=(
                            "This legacy widget has no validated data source. "
                            "Edit and re-save it before use."
                        ),
                    )
                )
                continue

            dataset = datasets.get(source.dataset_id)

            if dataset is None:
                issues.append(
                    DashboardReferenceIssue(
                        widget_id=widget.id,
                        reference_type="dataset",
                        reference_id=source.dataset_id,
                        message=(
                            "The dataset used by this widget is no longer "
                            "available."
                        ),
                    )
                )
            elif dataset.type != DatasetType.FILE:
                issues.append(
                    DashboardReferenceIssue(
                        widget_id=widget.id,
                        reference_type="dataset",
                        reference_id=source.dataset_id,
                        message=(
                            "This widget references a dataset type that is "
                            "not supported by V1 dashboards."
                        ),
                    )
                )

            if (
                source.notebook_id is not None
                and source.notebook_id not in notebooks
            ):
                issues.append(
                    DashboardReferenceIssue(
                        widget_id=widget.id,
                        reference_type="notebook",
                        reference_id=source.notebook_id,
                        message=(
                            "The notebook referenced by this widget is no "
                            "longer available."
                        ),
                    )
                )

        read_model = DashboardRead.model_validate(dashboard)
        read_model.layout = layout
        read_model.reference_issues = issues
        response.append(read_model)

    return response


async def get_owned_datasets(
    db: AsyncSession,
    dataset_ids: set[int],
    owner_id: int,
) -> dict[int, DatasetModel]:
    if not dataset_ids:
        return {}

    result = await db.execute(
        select(DatasetModel).where(
            DatasetModel.id.in_(dataset_ids),
            DatasetModel.owner_id == owner_id,
        )
    )

    return {
        dataset.id: dataset
        for dataset in result.scalars().all()
    }


async def get_owned_notebooks(
    db: AsyncSession,
    notebook_ids: set[int],
    owner_id: int,
) -> dict[int, NotebookModel]:
    if not notebook_ids:
        return {}

    result = await db.execute(
        select(NotebookModel).where(
            NotebookModel.id.in_(notebook_ids),
            NotebookModel.owner_id == owner_id,
        )
    )

    return {
        notebook.id: notebook
        for notebook in result.scalars().all()
    }
