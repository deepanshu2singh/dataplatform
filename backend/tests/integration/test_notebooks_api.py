import httpx


def notebook_body(dataset_id: int) -> dict:
    return {
        "name": "Sales Analysis",
        "description": "Integration notebook",
        "content": {
            "dataset_id": dataset_id,
            "cells": [
                {
                    "id": "sql-1",
                    "type": "sql",
                    "content": "SELECT * FROM dataset LIMIT 5",
                },
                {
                    "id": "python-1",
                    "type": "python",
                    "content": "print(df.head())",
                },
            ],
        },
    }


def test_notebook_crud_and_persistence(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    user = user_factory("notebook-crud")
    dataset = sales_dataset_factory(user["headers"])

    create = api_client.post(
        "notebooks",
        headers=user["headers"],
        json=notebook_body(dataset["id"]),
    )
    assert create.status_code == 201, create.text
    notebook = create.json()

    read = api_client.get(
        f"notebooks/{notebook['id']}",
        headers=user["headers"],
    )
    assert read.status_code == 200, read.text
    assert read.json()["content"]["dataset_id"] == dataset["id"]
    assert len(read.json()["content"]["cells"]) == 2

    update = api_client.put(
        f"notebooks/{notebook['id']}",
        headers=user["headers"],
        json={"name": "Updated Sales Analysis"},
    )
    assert update.status_code == 200, update.text
    assert update.json()["name"] == "Updated Sales Analysis"

    listing = api_client.get(
        "notebooks",
        headers=user["headers"],
    )
    assert listing.status_code == 200
    assert any(item["id"] == notebook["id"] for item in listing.json())

    delete = api_client.delete(
        f"notebooks/{notebook['id']}",
        headers=user["headers"],
    )
    assert delete.status_code == 204

    missing = api_client.get(
        f"notebooks/{notebook['id']}",
        headers=user["headers"],
    )
    assert missing.status_code == 404


def test_cross_user_notebook_access_is_hidden(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    owner = user_factory("notebook-owner")
    other = user_factory("notebook-other")
    dataset = sales_dataset_factory(owner["headers"])

    create = api_client.post(
        "notebooks",
        headers=owner["headers"],
        json=notebook_body(dataset["id"]),
    )
    assert create.status_code == 201, create.text
    notebook_id = create.json()["id"]

    assert api_client.get(
        f"notebooks/{notebook_id}",
        headers=other["headers"],
    ).status_code == 404

    assert api_client.put(
        f"notebooks/{notebook_id}",
        headers=other["headers"],
        json={"name": "Should Fail"},
    ).status_code == 404

    assert api_client.delete(
        f"notebooks/{notebook_id}",
        headers=other["headers"],
    ).status_code == 404


def test_notebook_rejects_foreign_dataset_reference(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    owner = user_factory("foreign-dataset-owner")
    other = user_factory("foreign-dataset-other")
    dataset = sales_dataset_factory(owner["headers"])

    response = api_client.post(
        "notebooks",
        headers=other["headers"],
        json=notebook_body(dataset["id"]),
    )

    assert response.status_code == 400
    assert "not available" in response.json()["detail"]


def test_notebook_rejects_duplicate_cell_ids(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("duplicate-cells")

    response = api_client.post(
        "notebooks",
        headers=user["headers"],
        json={
            "name": "Duplicate Cells",
            "content": {
                "dataset_id": None,
                "cells": [
                    {"id": "same", "type": "sql", "content": "SELECT 1"},
                    {"id": "same", "type": "markdown", "content": "Text"},
                ],
            },
        },
    )

    assert response.status_code == 422


def test_deleted_dataset_remains_explicit_stale_notebook_reference(
    api_client: httpx.Client,
    user_factory,
    sales_dataset_factory,
) -> None:
    user = user_factory("stale-notebook-dataset")
    dataset = sales_dataset_factory(user["headers"])

    create = api_client.post(
        "notebooks",
        headers=user["headers"],
        json=notebook_body(dataset["id"]),
    )
    assert create.status_code == 201, create.text
    notebook_id = create.json()["id"]

    delete_dataset = api_client.delete(
        f"datasets/{dataset['id']}",
        headers=user["headers"],
    )
    assert delete_dataset.status_code == 204

    read_notebook = api_client.get(
        f"notebooks/{notebook_id}",
        headers=user["headers"],
    )
    assert read_notebook.status_code == 200, read_notebook.text
    assert read_notebook.json()["content"]["dataset_id"] == dataset["id"]
