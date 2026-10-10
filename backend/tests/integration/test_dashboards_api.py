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
