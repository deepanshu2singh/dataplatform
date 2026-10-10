import asyncio

from app.core.config import settings
from app.main import health_check


def test_health_payload() -> None:
    payload = asyncio.run(health_check())

    assert payload == {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
    }
