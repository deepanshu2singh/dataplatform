from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.account_data import ExportCatalog, ExportDatasetFile, ExportRecord
from app.schemas.account_security import SecurityReauthentication
from app.services import account_data as service


class PrivateExportRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def handler(request: Request):
            try:
                response = await original(request)
                response.headers["Cache-Control"] = "no-store"
                return response
            except HTTPException as exc:
                exc.headers = {**(exc.headers or {}), "Cache-Control": "no-store"}
                raise
        return handler


router = APIRouter(route_class=PrivateExportRoute)


@router.post("/authorize")
async def authorize(payload: SecurityReauthentication, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_active_user)):
    return await service.authorize(db, user.id, user.session_version, payload.current_password)


@router.post("/catalog")
async def catalog(payload: ExportCatalog, db: AsyncSession = Depends(get_db),
                  user: User = Depends(get_current_active_user)):
    service.check_proof(payload.proof, user)
    return await service.catalog(db, user, payload.category, payload.after)


@router.post("/record")
async def record(payload: ExportRecord, db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_active_user)):
    service.check_proof(payload.proof, user)
    return await service.record_fragment(db, user, payload.category, payload.record_id, payload.revision, payload.offset)


@router.post("/dataset-file")
async def dataset_file(payload: ExportDatasetFile, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_active_user)):
    service.check_proof(payload.proof, user)
    return await service.dataset_file_download(db, user, payload.dataset_id)
