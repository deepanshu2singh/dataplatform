"""Explicit maintenance: python -m scripts.cleanup_cloud_uploads [--limit 100]."""
import argparse
import asyncio
from app.db.session import async_session_maker, engine
from app.services.dataset_uploads import cleanup_expired_uploads


async def main(limit: int):
    try:
        async with async_session_maker() as db:
            count = await cleanup_expired_uploads(db, limit=limit)
        print(f"Reclaimed {count} expired, unreferenced upload intents.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=100, choices=range(1, 1001), metavar="1..1000")
    args = parser.parse_args()
    asyncio.run(main(args.limit))
