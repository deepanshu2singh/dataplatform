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


ChartType = Literal["bar", "line", "pie", "donut", "area", "horizontal_bar", "stacked_bar", "stacked_area", "scatter", "combo"]
Currency = Literal["GBP", "USD", "EUR", "INR", "CAD", "AUD", "JPY"]


class DashboardNumberFormat(BaseModel):
    format: Literal["number", "currency", "percent", "text"] = "number"
    decimals: int = Field(default=2, ge=0, le=6)
    currency: Currency | None = None
    percent_scale: Literal["whole", "fraction"] = "whole"
    compact: bool = False
    prefix: str | None = Field(default=None, max_length=32)
    suffix: str | None = Field(default=None, max_length=32)

    @field_validator("prefix", "suffix")
    @classmethod
    def clean_affix(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class DashboardChartConfig(DashboardNumberFormat):
    chart_type: ChartType
    x_column: str = Field(min_length=1, max_length=255)
    y_column: str = Field(min_length=1, max_length=255)
    y2_column: str | None = Field(default=None, max_length=255)
    series_column: str | None = Field(default=None, max_length=255)
    show_legend: bool = True
    show_grid: bool = True
    show_labels: bool = False
    palette: Literal["teal", "ocean", "warm", "mono"] = "teal"
    curve: Literal["linear", "monotone", "step"] = "monotone"
    x_axis_title: str | None = Field(default=None, max_length=100)
    y_axis_title: str | None = Field(default=None, max_length=100)
    right_axis_title: str | None = Field(default=None, max_length=100)
    secondary_axis: bool = True
    sort_by: Literal["none", "label", "value"] = "none"
    sort_direction: Literal["asc", "desc"] = "asc"

    @field_validator("x_column", "y_column", "y2_column", "series_column", "x_axis_title", "y_axis_title", "right_axis_title")
    @classmethod
    def normalize_column(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        if not clean:
            raise ValueError("Chart field names and axis titles cannot be blank; use null for optional fields.")
        return clean

    @model_validator(mode="after")
    def validate_chart_contract(self) -> "DashboardChartConfig":
        if self.chart_type in {"stacked_bar", "stacked_area"} and self.series_column is None:
            raise ValueError("Stacked charts require a series column.")
        if self.chart_type == "combo":
            if self.y2_column is None or self.y2_column == self.y_column:
                raise ValueError("Combo charts require a different second numeric column.")
            if self.series_column is not None:
                raise ValueError("Combo charts use two numeric columns, not a series column.")
        if self.format == "text":
            raise ValueError("Charts require a numeric display format.")
        return self


class DashboardMetricConfig(DashboardNumberFormat):
    value_column: str = Field(min_length=1, max_length=255)
    label: str | None = Field(default=None, max_length=255)

    @field_validator("value_column")
    @classmethod
    def normalize_value_column(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("Metric value_column cannot be empty.")
        return clean

    @field_validator("label")
    @classmethod
    def normalize_label(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class DashboardColumnOptions(DashboardNumberFormat):
    format: Literal["number", "currency", "percent", "text"] = "text"
    width: int | None = Field(default=None, ge=80, le=600)
    align: Literal["auto", "left", "center", "right"] = "auto"


class DashboardTableConfig(BaseModel):
    columns: list[str] | None = Field(default=None, max_length=MAX_TABLE_COLUMNS)
    page_size: Literal[10, 25, 50, 100] = 25
    sort_column: str | None = Field(default=None, min_length=1, max_length=255)
    sort_direction: Literal["asc", "desc"] = "asc"
    density: Literal["comfortable", "compact"] = "comfortable"
    show_row_numbers: bool = False
    column_options: dict[str, DashboardColumnOptions] = Field(default_factory=dict, max_length=MAX_TABLE_COLUMNS)

    @field_validator("columns")
    @classmethod
    def normalize_columns(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        clean = [column.strip() for column in value]
        if any(not column for column in clean):
            raise ValueError("Table column names cannot be empty.")
        if len(set(clean)) != len(clean):
            raise ValueError("Table columns must be unique.")
        return clean

    @field_validator("column_options")
    @classmethod
    def validate_option_keys(cls, value: dict[str, DashboardColumnOptions]) -> dict[str, DashboardColumnOptions]:
        if any(not key.strip() or len(key) > 255 for key in value):
            raise ValueError("Column option keys must be nonblank result column names up to 255 characters.")
        return value


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
    version: Literal[1, 2, 3] = 1
    locked: bool = False
    widgets: list[DashboardWidget] = Field(
        default_factory=list,
        max_length=MAX_DASHBOARD_WIDGETS,
    )

    @model_validator(mode="after")
    def validate_layout(self) -> "DashboardLayout":
        widget_ids = [widget.id for widget in self.widgets]

        if len(widget_ids) != len(set(widget_ids)):
            raise ValueError("Dashboard widget ids must be unique.")

        if self.version >= 2:
            for widget in self.widgets:
                p = widget.position
                if not (3 <= p.w <= 12 and 5 <= p.h <= 40 and p.x + p.w <= 12 and p.y + p.h <= 1000):
                    raise ValueError("Canvas widget must fit the 12-column / 1000-row grid (width 3-12, height 5-40).")
            for index, widget in enumerate(self.widgets):
                a = widget.position
                for other in self.widgets[index + 1:]:
                    b = other.position
                    if a.x < b.x + b.w and a.x + a.w > b.x and a.y < b.y + b.h and a.y + a.h > b.y:
                        raise ValueError("Canvas widgets cannot overlap.")

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
    expected_version: int | None = Field(default=None, gt=0)
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
    version: int = Field(default=1, gt=0)
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
    kind: Literal["table", "metric", "bar", "line", "pie", "donut", "area", "horizontal_bar", "stacked_bar", "stacked_area", "scatter", "combo"]
    options: dict[str, Any] = Field(default_factory=dict)
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
