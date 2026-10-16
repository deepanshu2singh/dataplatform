import httpx


def empty_layout() -> dict:
    return {"version": 1, "widgets": []}


def table_widget(dataset_id: int, query: str | None = None) -> dict:
    return {
        "id": "revenue-table",
        "type": "table",
        "title": "Revenue by Product",
        "config": {},
        "position": {"x": 0, "y": 0, "w": 600, "h": 300},
        "source": {
            "dataset_id": dataset_id,
            "query": query
            or (
                "SELECT product, SUM(revenue) AS total_revenue "
                "FROM dataset GROUP BY product ORDER BY total_revenue DESC"
            ),
            "limit": 100,
        },
    }


def test_dashboard_crud(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("dashboard-crud")

    create = api_client.post(
        "dashboards",
        headers=user["headers"],
        json={
            "name": "Operations Dashboard",
            "description": "Initial description",
            "layout": empty_layout(),
        },
    )
    assert create.status_code == 201, create.text
    dashboard = create.json()

    read = api_client.get(
        f"dashboards/{dashboard['id']}",
        headers=user["headers"],
    )
    assert read.status_code == 200, read.text
    assert read.json()["name"] == "Operations Dashboard"

    update = api_client.put(
        f"dashboards/{dashboard['id']}",
        headers=user["headers"],
        json={"name": "Updated Operations Dashboard"},
    )
    assert update.status_code == 200, update.text
    assert update.json()["name"] == "Updated Operations Dashboard"

    listing = api_client.get(
        "dashboards",
        headers=user["headers"],
    )
    assert listing.status_code == 200
    assert any(item["id"] == dashboard["id"] for item in listing.json())

    delete = api_client.delete(
        f"dashboards/{dashboard['id']}",
        headers=user["headers"],
    )
    assert delete.status_code == 204

    missing = api_client.get(
        f"dashboards/{dashboard['id']}",
        headers=user["headers"],
    )
    assert missing.status_code == 404


def test_cross_user_dashboard_access_is_hidden(
    api_client: httpx.Client,
    user_factory,
) -> None:
    owner = user_factory("dashboard-owner")
    other = user_factory("dashboard-other")

    create = api_client.post(
        "dashboards",
        headers=owner["headers"],
        json={"name": "Private Dashboard", "layout": empty_layout()},
    )
    assert create.status_code == 201, create.text
    dashboard_id = create.json()["id"]

    assert api_client.get(
        f"dashboards/{dashboard_id}",
        headers=other["headers"],
    ).status_code == 404

    assert api_client.put(
        f"dashboards/{dashboard_id}",
        headers=other["headers"],
        json={"name": "Should Fail"},
    ).status_code == 404

    assert api_client.delete(
        f"dashboards/{dashboard_id}",
        headers=other["headers"],
    ).status_code == 404


def test_saved_dashboard_widget_executes_valid_query(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    user = user_factory("dashboard-execute")
    dataset = sales_dataset_factory(user["headers"])

    create = api_client.post(
        "dashboards",
        headers=user["headers"],
        json={
            "name": "Sales Dashboard",
            "layout": {
                "version": 1,
                "widgets": [table_widget(dataset["id"])],
            },
        },
    )
    assert create.status_code == 201, create.text
    dashboard_id = create.json()["id"]

    execute = api_client.post(
        f"dashboards/{dashboard_id}/widgets/revenue-table/execute",
        headers=user["headers"],
    )
    assert execute.status_code == 200, execute.text
    payload = execute.json()
    assert payload["dashboard_id"] == dashboard_id
    assert payload["widget_id"] == "revenue-table"
    assert payload["row_count"] == 4
    assert payload["visualization"]["kind"] == "table"
    assert payload["data"][0]["product"] == "Laptop"
    assert round(payload["data"][0]["total_revenue"], 2) == 3600.49


def test_dashboard_preview_rejects_unsafe_sql(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    user = user_factory("dashboard-unsafe")
    dataset = sales_dataset_factory(user["headers"])
    widget = table_widget(dataset["id"], "SELECT * FROM users")

    response = api_client.post(
        "dashboards/widgets/preview",
        headers=user["headers"],
        json={"widget": widget},
    )

    assert response.status_code == 400


def test_saved_widget_runtime_sql_error_is_controlled(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    user = user_factory("dashboard-runtime")
    dataset = sales_dataset_factory(user["headers"])
    widget = table_widget(
        dataset["id"],
        "SELECT missing_column FROM dataset",
    )

    create = api_client.post(
        "dashboards",
        headers=user["headers"],
        json={
            "name": "Runtime Error Dashboard",
            "layout": {"version": 1, "widgets": [widget]},
        },
    )
    assert create.status_code == 201, create.text
    dashboard_id = create.json()["id"]

    execute = api_client.post(
        f"dashboards/{dashboard_id}/widgets/revenue-table/execute",
        headers=user["headers"],
    )

    assert execute.status_code == 400
    assert "missing_column" in execute.json()["detail"]


def test_dashboard_rejects_foreign_dataset_reference(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    owner = user_factory("dashboard-data-owner")
    other = user_factory("dashboard-data-other")
    dataset = sales_dataset_factory(owner["headers"])

    response = api_client.post(
        "dashboards",
        headers=other["headers"],
        json={
            "name": "Foreign Dataset Dashboard",
            "layout": {
                "version": 1,
                "widgets": [table_widget(dataset["id"])],
            },
        },
    )

    assert response.status_code == 400
    assert "not available" in response.json()["detail"]


def test_public_dashboard_is_rejected(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("public-dashboard")

    response = api_client.post(
        "dashboards",
        headers=user["headers"],
        json={
            "name": "Public Dashboard",
            "layout": empty_layout(),
            "is_public": True,
        },
    )

    assert response.status_code == 422


def test_deleted_dataset_becomes_stale_dashboard_reference(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    user = user_factory("stale-dashboard")
    dataset = sales_dataset_factory(user["headers"])

    create = api_client.post(
        "dashboards",
        headers=user["headers"],
        json={
            "name": "Stale Reference Dashboard",
            "layout": {
                "version": 1,
                "widgets": [table_widget(dataset["id"])],
            },
        },
    )
    assert create.status_code == 201, create.text
    dashboard_id = create.json()["id"]

    delete_dataset = api_client.delete(
        f"datasets/{dataset['id']}",
        headers=user["headers"],
    )
    assert delete_dataset.status_code == 204

    read_dashboard = api_client.get(
        f"dashboards/{dashboard_id}",
        headers=user["headers"],
    )
    assert read_dashboard.status_code == 200, read_dashboard.text
    issues = read_dashboard.json()["reference_issues"]
    assert len(issues) == 1
    assert issues[0]["widget_id"] == "revenue-table"
    assert issues[0]["reference_type"] == "dataset"
    assert issues[0]["reference_id"] == dataset["id"]

    execute = api_client.post(
        f"dashboards/{dashboard_id}/widgets/revenue-table/execute",
        headers=user["headers"],
    )
    assert execute.status_code == 409


def test_deleted_notebook_becomes_stale_dashboard_reference(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    user = user_factory("stale-dashboard-notebook")
    dataset = sales_dataset_factory(user["headers"])

    notebook_create = api_client.post(
        "notebooks",
        headers=user["headers"],
        json={
            "name": "Dashboard Source Notebook",
            "content": {
                "dataset_id": dataset["id"],
                "cells": [
                    {
                        "id": "sql-1",
                        "type": "sql",
                        "content": "SELECT * FROM dataset",
                    }
                ],
            },
        },
    )
    assert notebook_create.status_code == 201, notebook_create.text
    notebook_id = notebook_create.json()["id"]

    widget = table_widget(dataset["id"])
    widget["source"]["notebook_id"] = notebook_id

    dashboard_create = api_client.post(
        "dashboards",
        headers=user["headers"],
        json={
            "name": "Notebook Reference Dashboard",
            "layout": {"version": 1, "widgets": [widget]},
        },
    )
    assert dashboard_create.status_code == 201, dashboard_create.text
    dashboard_id = dashboard_create.json()["id"]

    delete_notebook = api_client.delete(
        f"notebooks/{notebook_id}",
        headers=user["headers"],
    )
    assert delete_notebook.status_code == 204

    read_dashboard = api_client.get(
        f"dashboards/{dashboard_id}",
        headers=user["headers"],
    )
    assert read_dashboard.status_code == 200, read_dashboard.text
    notebook_issues = [
        issue
        for issue in read_dashboard.json()["reference_issues"]
        if issue["reference_type"] == "notebook"
    ]
    assert len(notebook_issues) == 1
    assert notebook_issues[0]["reference_id"] == notebook_id


def test_canvas_roundtrip_and_stale_client_rejection(api_client, user_factory):
    user = user_factory("canvas-roundtrip")
    layout = {"version": 2, "locked": True, "widgets": [{
        "id": "note", "type": "markdown", "title": "Analysis",
        "config": {"markdown": "Keep this note"},
        "position": {"x": 4, "y": 17, "w": 8, "h": 16},
    }]}
    created = api_client.post("dashboards", headers=user["headers"], json={"name": "Canvas", "layout": layout})
    assert created.status_code == 201, created.text
    dashboard = created.json()
    url = f"dashboards/{dashboard['id']}"
    read = api_client.get(url, headers=user["headers"])
    assert read.status_code == 200, read.text
    assert read.json()["layout"]["widgets"][0]["position"] == layout["widgets"][0]["position"]
    assert read.json()["layout"]["locked"] is True
    saved = api_client.put(url, headers=user["headers"], json={"expected_version": dashboard["version"], "name": "Updated canvas", "layout": layout})
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] > dashboard["version"]
    stale = api_client.put(url, headers=user["headers"], json={"expected_version": dashboard["version"], "name": "Stale draft", "layout": layout})
    assert stale.status_code == 409, stale.text
    old = api_client.put(url, headers=user["headers"], json={"layout": empty_layout()})
    assert old.status_code == 409, old.text
    unchanged = api_client.get(url, headers=user["headers"]).json()
    assert unchanged["name"] == "Updated canvas" and unchanged["layout"]["version"] == 2


def assert_requested_settings_preserved(actual: dict, requested: dict) -> None:
    # Saved configs include server defaults. Every requested setting must survive,
    # including nested column options, without requiring those defaults in input.
    assert isinstance(actual, dict)
    for key, value in requested.items():
        assert key in actual, f"Saved setting is missing: {key}"
        if isinstance(value, dict):
            assert_requested_settings_preserved(actual[key], value)
        else:
            assert actual[key] == value, f"Saved setting changed: {key}"


def test_presentation_roundtrip_execution_and_owner_boundary(api_client, user_factory, sales_dataset_factory):
    owner = user_factory("presentation-owner")
    other = user_factory("presentation-other")
    dataset = sales_dataset_factory(owner["headers"])
    query = "SELECT product, region, SUM(revenue) AS value, SUM(quantity) AS x FROM dataset GROUP BY product, region ORDER BY product, region"
    chart_types = ["bar", "horizontal_bar", "line", "area", "stacked_bar", "stacked_area", "pie", "donut", "scatter", "combo"]
    widgets = []
    for index, kind in enumerate(chart_types):
        config = {"chart_type": kind, "x_column": "x" if kind == "scatter" else "product", "y_column": "value", "palette": "warm", "format": "currency", "currency": "GBP", "decimals": 1, "show_labels": True}
        if kind.startswith("stacked"):
            config["series_column"] = "region"
        if kind == "combo":
            config["y2_column"] = "x"
        widgets.append({"id": kind, "type": "chart", "title": kind, "position": {"x": index % 2 * 6, "y": index // 2 * 10, "w": 6, "h": 10}, "source": {"dataset_id": dataset["id"], "query": query, "limit": 500}, "config": config})
    table = table_widget(dataset["id"], query)
    table.update(id="formatted-table", position={"x": 0, "y": 50, "w": 6, "h": 10}, config={"columns": ["product", "value"], "page_size": 10, "sort_column": "value", "sort_direction": "desc", "density": "compact", "show_row_numbers": True, "column_options": {"value": {"width": 180, "format": "currency", "currency": "GBP", "decimals": 1, "align": "right"}}})
    widgets.append(table)
    widgets.append({"id": "margin", "type": "metric", "title": "Margin", "position": {"x": 6, "y": 50, "w": 6, "h": 10}, "source": {"dataset_id": dataset["id"], "query": "SELECT SUM(revenue) / SUM(revenue) * 0.25 AS margin FROM dataset", "limit": 2}, "config": {"value_column": "margin", "label": "Gross margin", "format": "percent", "percent_scale": "fraction", "decimals": 1}})
    created = api_client.post("dashboards", headers=owner["headers"], json={"name": "Presentation", "layout": {"version": 3, "locked": True, "widgets": widgets}})
    assert created.status_code == 201, created.text
    dashboard = created.json()
    url = f"dashboards/{dashboard['id']}"
    loaded = api_client.get(url, headers=owner["headers"])
    assert loaded.status_code == 200, loaded.text
    layout = loaded.json()["layout"]
    assert layout["version"] == 3 and layout["locked"] is True
    for original, saved in zip(widgets, layout["widgets"]):
        assert saved["position"] == original["position"]
        assert_requested_settings_preserved(saved["config"], original["config"])
        result = api_client.post(f"{url}/widgets/{saved['id']}/execute", headers=owner["headers"])
        assert result.status_code == 200, result.text
        assert result.json()["visualization"]["kind"] == saved["config"].get("chart_type", saved["type"])
        assert result.json()["visualization"]["options"] == saved["config"]
    assert api_client.post(f"{url}/widgets/combo/execute", headers=other["headers"]).status_code == 404
    old_layout = {**layout, "version": 2}
    rejected = api_client.put(url, headers=owner["headers"], json={"expected_version": dashboard["version"], "layout": old_layout})
    assert rejected.status_code == 409, rejected.text
    assert api_client.get(url, headers=owner["headers"]).json()["layout"] == layout
