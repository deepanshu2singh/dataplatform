from fastapi import APIRouter

from app.api.routes import account_data, auth, dashboards, datasets, notebooks, sql

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(account_data.router, prefix="/account-data", tags=["account-data"])
api_router.include_router(datasets.router, prefix="/datasets", tags=["datasets"])
api_router.include_router(sql.router, prefix="/sql", tags=["sql"])
api_router.include_router(notebooks.router, prefix="/notebooks", tags=["notebooks"])
api_router.include_router(dashboards.router, prefix="/dashboards", tags=["dashboards"])
