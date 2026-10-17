"""Exercise profile persistence and compare-and-update against disposable PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import httpx


def test_profile_save_survives_read_and_new_login_without_affecting_other_account(api_client, user_factory):
    owner = user_factory("profile-owner")
    other = user_factory("profile-other")
    payload = {"full_name": "  Updated दीपांशु  ", "expected_full_name": owner["full_name"]}
    response = api_client.patch("auth/me", headers=owner["headers"], json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["full_name"] == "Updated दीपांशु"
    assert response.json()["email"] == owner["email"]
    assert response.json()["email_verified"] is True
    assert response.headers["cache-control"] == "no-store"
    assert api_client.get("auth/me", headers=owner["headers"]).json()["full_name"] == "Updated दीपांशु"
    assert api_client.get("auth/me", headers=other["headers"]).json()["full_name"] == other["full_name"]
    login = api_client.post("auth/login", headers={"Origin": owner["headers"]["Origin"]}, data={"username": owner["email"], "password": owner["password"]})
    assert login.status_code == 204
    assert api_client.get("auth/me").json()["full_name"] == "Updated दीपांशु"


def test_profile_conflict_preserves_winner_and_retry_is_idempotent(api_client, user_factory):
    owner = user_factory("profile-conflict")
    first = {"full_name": "First saved", "expected_full_name": owner["full_name"]}
    assert api_client.patch("auth/me", headers=owner["headers"], json=first).status_code == 200
    assert api_client.patch("auth/me", headers=owner["headers"], json=first).status_code == 200
    second = api_client.patch("auth/me", headers=owner["headers"], json={"full_name": "Stale draft", "expected_full_name": owner["full_name"]})
    assert second.status_code == 409
    assert api_client.get("auth/me", headers=owner["headers"]).json()["full_name"] == "First saved"
    cleared = api_client.patch("auth/me", headers=owner["headers"], json={"full_name": "   ", "expected_full_name": "First saved"})
    assert cleared.status_code == 200 and cleared.json()["full_name"] is None


def test_concurrent_profile_edits_have_one_winner(api_client, user_factory):
    owner = user_factory("profile-race")
    barrier = Barrier(2)
    def save(name):
        with httpx.Client(base_url=api_client.base_url, timeout=30) as client:
            barrier.wait(timeout=10)
            result = client.patch("auth/me", headers=owner["headers"], json={"full_name": name, "expected_full_name": owner["full_name"]})
            return result.status_code, name
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, ["Tab one", "Tab two"]))
    assert sorted(status for status, _ in results) == [200, 409]
    winner = next(name for status, name in results if status == 200)
    assert api_client.get("auth/me", headers=owner["headers"]).json()["full_name"] == winner
