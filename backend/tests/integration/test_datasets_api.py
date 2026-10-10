from uuid import uuid4

import httpx


def test_csv_upload_list_schema_and_python_export(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    user = user_factory("dataset-flow")
    dataset = sales_dataset_factory(user["headers"], "Sales Dataset")

    assert dataset["name"] == "Sales Dataset"
    assert dataset["type"] == "file"
    assert "config" not in dataset
    assert dataset["schema_info"]["row_count"] == 5

    listing = api_client.get(
        "datasets",
        headers=user["headers"],
    )
    assert listing.status_code == 200, listing.text
    assert any(item["id"] == dataset["id"] for item in listing.json())

    schema = api_client.get(
        f"datasets/{dataset['id']}/schema",
        headers=user["headers"],
    )
    assert schema.status_code == 200, schema.text
    schema_payload = schema.json()
    assert schema_payload["row_count"] == 5
    assert [column["name"] for column in schema_payload["columns"]] == [
        "order_id",
        "product",
        "region",
        "quantity",
        "revenue",
    ]

    export = api_client.get(
        f"datasets/{dataset['id']}/python-export",
        headers=user["headers"],
    )
    assert export.status_code == 200, export.text
    export_payload = export.json()
    assert export_payload["dataset_id"] == dataset["id"]
    assert export_payload["loaded_row_count"] == 5
    assert export_payload["truncated"] is False
    assert "Laptop" in export_payload["csv_text"]
    assert "/tmp/" not in export_payload["csv_text"]


def test_non_csv_upload_is_rejected(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("bad-upload")

    response = api_client.post(
        "datasets/upload",
        headers=user["headers"],
        data={"name": "Not CSV"},
        files={
            "file": (
                "notes.txt",
                b"not,csv\n1,2\n",
                "text/plain",
            )
        },
    )

    assert response.status_code == 400
    assert "CSV" in response.json()["detail"]


def test_cross_user_dataset_is_hidden(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    owner = user_factory("dataset-owner")
    other = user_factory("dataset-other")
    dataset = sales_dataset_factory(owner["headers"])

    get_response = api_client.get(
        f"datasets/{dataset['id']}",
        headers=other["headers"],
    )
    schema_response = api_client.get(
        f"datasets/{dataset['id']}/schema",
        headers=other["headers"],
    )

    assert get_response.status_code == 404
    assert schema_response.status_code == 404


def test_dataset_update_and_delete(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    user = user_factory("dataset-crud")
    dataset = sales_dataset_factory(user["headers"])

    update = api_client.put(
        f"datasets/{dataset['id']}",
        headers=user["headers"],
        json={
            "name": "Renamed Sales",
            "description": "Updated description",
        },
    )
    assert update.status_code == 200, update.text
    assert update.json()["name"] == "Renamed Sales"
    assert update.json()["description"] == "Updated description"

    delete = api_client.delete(
        f"datasets/{dataset['id']}",
        headers=user["headers"],
    )
    assert delete.status_code == 204, delete.text

    missing = api_client.get(
        f"datasets/{dataset['id']}",
        headers=user["headers"],
    )
    assert missing.status_code == 404


def test_sql_query_is_valid_for_owner_and_hidden_from_other_user(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    owner = user_factory("sql-owner")
    other = user_factory("sql-other")
    dataset = sales_dataset_factory(owner["headers"])
    request_body = {
        "dataset_id": dataset["id"],
        "query": (
            "SELECT product, SUM(revenue) AS total_revenue "
            "FROM dataset GROUP BY product ORDER BY total_revenue DESC"
        ),
        "limit": 100,
    }

    owner_response = api_client.post(
        "sql/query",
        headers=owner["headers"],
        json=request_body,
    )
    assert owner_response.status_code == 200, owner_response.text
    assert owner_response.json()["row_count"] == 4
    assert owner_response.json()["data"][0]["product"] == "Laptop"

    other_response = api_client.post(
        "sql/query",
        headers=other["headers"],
        json=request_body,
    )
    assert other_response.status_code == 404
