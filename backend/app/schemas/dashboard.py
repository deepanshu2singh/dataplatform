import json
from datetime import datetime
from typing import Any, Literal

from pydantic import (
    BaseModel,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)


MAX_DASHBOARD_WIDGETS = 40
MAX_DASHBOARD_DESCRIPTION_CHARS = 5_000
MAX_WIDGET_TITLE_CHARS = 255
MAX_WIDGET_CONFIG_BYTES = 64 * 1024
MAX_DASHBOARD_LAYOUT_BYTES = 512 * 1024
MAX_MARKDOWN_CHARS = 50_000
MAX_TABLE_COLUMNS = 100
MAX_CHART_POINTS = 500


class DashboardPosition(BaseModel):
    x: int = Field(default=0, ge=0, le=100_000)
    y: int = Field(default=0, ge=0, le=100_000)
    w: int = Field(default=600, ge=1, le=2_400)
    h: int = Field(default=300, ge=1, le=2_400)


class DashboardDataSource(BaseModel):
    dataset_id: int = Field(gt=0)
    notebook_id: int | None = Field(default=None, gt=0)
    query: str = Field(min_length=1, max_length=50_000)
    limit: int = Field(default=500, ge=1, le=1_000)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        clean_value = value.strip()

        if not clean_value:
            raise ValueError("Widget SQL query cannot be empty.")

        return clean_value


class DashboardChartConfig(BaseModel):
    chart_type: Literal["bar", "line", "pie", "donut"]
    x_column: str = Field(min_length=1, max_length=255)
    y_column: str = Field(min_length=1, max_length=255)
    series_column: str | None = Field(default=None, max_length=255)
    show_legend: bool = True

    @field_validator("x_column", "y_column", "series_column")
    @classmethod
    def normalize_column(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        clean_value = value.strip()

        if not clean_value:
            raise ValueError("Chart column names cannot be empty.")

        return clean_value


class DashboardMetricConfig(BaseModel):
    value_column: str = Field(min_length=1, max_length=255)
    label: str | None = Field(default=None, max_length=255)
    format: Literal["number", "currency", "percent", "text"] = "number"
    decimals: int = Field(default=2, ge=0, le=6)
    prefix: str | None = Field(default=None, max_length=32)
    suffix: str | None = Field(default=None, max_length=32)

    @field_validator("value_column")
    @classmethod
    def normalize_value_column(cls, value: str) -> str:
        clean_value = value.strip()

        if not clean_value:
            raise ValueError("Metric value_column cannot be empty.")

        return clean_value

    @field_validator("label", "prefix", "suffix")
    @classmethod
    def normalize_optional_text(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        return value.strip() or None


class DashboardTableConfig(BaseModel):
    columns: list[str] | None = Field(
        default=None,
        max_length=MAX_TABLE_COLUMNS,
    )

    @field_validator("columns")
    @classmethod
    def normalize_columns(
        cls,
        value: list[str] | None,
    ) -> list[str] | None:
        if value is None:
            return None

        clean_columns: list[str] = []

        for column in value:
            clean_column = column.strip()

            if not clean_column:
                raise ValueError("Table column names cannot be empty.")

            clean_columns.append(clean_column)

        if len(clean_columns) != len(set(clean_columns)):
            raise ValueError("Table columns must be unique.")

        return clean_columns


class DashboardMarkdownConfig(BaseModel):
    markdown: str = Field(default="", max_length=MAX_MARKDOWN_CHARS)


class DashboardWidget(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["chart", "table", "markdown", "metric"]
    title: str = Field(default="Untitled Widget", max_length=MAX_WIDGET_TITLE_CHARS)
    config: dict[str, Any] = Field(default_factory=dict)
    position: DashboardPosition = Field(default_factory=DashboardPosition)
    source: DashboardDataSource | None = None

    @field_validator("id")
    @classmethod
    def normalize_id(cls, value: str) -> str:
        clean_value = value.strip()

        if not clean_value:
            raise ValueError("Widget id cannot be empty.")

        return clean_value

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        clean_value = value.strip()
        return clean_value or "Untitled Widget"

    @model_validator(mode="after")
    def validate_widget(self) -> "DashboardWidget":
        config_models = {
            "chart": DashboardChartConfig,
            "table": DashboardTableConfig,
            "markdown": DashboardMarkdownConfig,
            "metric": DashboardMetricConfig,
        }

        config_model = config_models[self.type]

        try:
            parsed_config = config_model.model_validate(self.config)
        except ValidationError as exc:
            raise ValueError(
                f'Invalid configuration for {self.type} widget "{self.title}".'
            ) from exc

        self.config = parsed_config.model_dump(
            mode="json",
            exclude_none=True,
        )

        serialized_config = json.dumps(
            self.config,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        if len(serialized_config) > MAX_WIDGET_CONFIG_BYTES:
            raise ValueError(
                "Widget configuration exceeds the 64 KB V1 limit."
            )

        return self


class DashboardLayout(BaseModel):
    version: Literal[1] = 1
    widgets: list[DashboardWidget] = Field(
        default_factory=list,
        max_length=MAX_DASHBOARD_WIDGETS,
    )

    @model_validator(mode="after")
    def validate_layout(self) -> "DashboardLayout":
        widget_ids = [widget.id for widget in self.widgets]

        if len(widget_ids) != len(set(widget_ids)):
            raise ValueError("Dashboard widget ids must be unique.")

        serialized = json.dumps(
            self.model_dump(mode="json"),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        if len(serialized) > MAX_DASHBOARD_LAYOUT_BYTES:
            raise ValueError(
                "Dashboard layout exceeds the 512 KB V1 limit."
            )

        return self


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(
        default=None,
        max_length=MAX_DASHBOARD_DESCRIPTION_CHARS,
    )
    layout: DashboardLayout = Field(default_factory=DashboardLayout)
    is_public: bool = False

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        clean_value = value.strip()

        if not clean_value:
            raise ValueError("Dashboard name is required.")

        return clean_value

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return value.strip() or None

    @model_validator(mode="after")
    def reject_public_dashboard(self) -> "DashboardCreate":
        if self.is_public:
            raise ValueError(
                "Public dashboards are not enabled yet."
            )

        return self


class DashboardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(
        default=None,
        max_length=MAX_DASHBOARD_DESCRIPTION_CHARS,
    )
    layout: DashboardLayout | None = None
    is_public: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None

        clean_value = value.strip()

        if not clean_value:
            raise ValueError("Dashboard name is required.")

        return clean_value

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return value.strip() or None

    @model_validator(mode="after")
    def validate_update(self) -> "DashboardUpdate":
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Dashboard name cannot be null.")

        if "layout" in self.model_fields_set and self.layout is None:
            raise ValueError("Dashboard layout cannot be null.")

        if "is_public" in self.model_fields_set and self.is_public is None:
            raise ValueError("Dashboard is_public cannot be null.")

        if self.is_public is True:
            raise ValueError(
                "Public dashboards are not enabled yet."
            )

        return self


class DashboardReferenceIssue(BaseModel):
    widget_id: str
    reference_type: Literal["widget", "dataset", "notebook"]
    reference_id: int | None = None
    message: str


class DashboardRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    layout: DashboardLayout
    owner_id: int
    is_public: bool
    created_at: datetime
    updated_at: datetime | None = None
    reference_issues: list[DashboardReferenceIssue] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class DashboardWidgetPreviewRequest(BaseModel):
    widget: DashboardWidget


class DashboardWidgetVisualization(BaseModel):
    kind: Literal["table", "metric", "bar", "line", "pie", "donut"]
    x_column: str | None = None
    y_column: str | None = None
    series_column: str | None = None
    value_column: str | None = None
    metric_value: Any | None = None
    format: Literal["number", "currency", "percent", "text"] | None = None
    decimals: int | None = None
    prefix: str | None = None
    suffix: str | None = None
    display_columns: list[str] | None = None
    show_legend: bool | None = None


class DashboardWidgetDataResponse(BaseModel):
    dashboard_id: int | None = None
    widget_id: str
    widget_type: Literal["chart", "table", "metric"]
    dataset_id: int
    dataset_name: str
    columns: list[str] = Field(default_factory=list)
    data: list[dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    dtypes: dict[str, str] = Field(default_factory=dict)
    truncated: bool = False
    limit: int = 0
    execution_ms: float = 0
    visualization: DashboardWidgetVisualization
