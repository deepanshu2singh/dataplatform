from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_db
from app.db.transactions import commit_with_optimistic_lock
from app.models.dataset import Dataset as DatasetModel
from app.models.dataset import DatasetType
from app.models.notebook import Notebook as NotebookModel
from app.models.user import User as UserModel
from app.schemas.notebook import (
    NotebookContent,
    NotebookCreate,
    NotebookRead,
    NotebookUpdate,
)

router = APIRouter()


@router.post(
    "",
    response_model=NotebookRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_notebook(
    notebook_in: NotebookCreate,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    await validate_dataset_reference(
        db,
        notebook_in.content,
        current_user.id,
    )

    notebook = NotebookModel(
        name=notebook_in.name,
        description=notebook_in.description,
        content=notebook_in.content.model_dump(mode="json"),
        owner_id=current_user.id,
    )

    db.add(notebook)
    await db.commit()
    await db.refresh(notebook)

    return notebook


@router.get("", response_model=List[NotebookRead])
async def list_notebooks(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    result = await db.execute(
        select(NotebookModel)
        .where(NotebookModel.owner_id == current_user.id)
        .order_by(
            func.coalesce(
                NotebookModel.updated_at,
                NotebookModel.created_at,
            ).desc(),
            NotebookModel.id.desc(),
        )
        .offset(skip)
        .limit(limit)
    )

    return result.scalars().all()


@router.get("/{notebook_id}", response_model=NotebookRead)
async def get_notebook(
    notebook_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    return await get_owned_notebook(
        db,
        notebook_id,
        current_user.id,
    )


@router.put("/{notebook_id}", response_model=NotebookRead)
async def update_notebook(
    notebook_id: int,
    notebook_in: NotebookUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    notebook = await get_owned_notebook(
        db,
        notebook_id,
        current_user.id,
    )

    update_data = notebook_in.model_dump(exclude_unset=True)

    if "content" in update_data and notebook_in.content is not None:
        await validate_dataset_reference(
            db,
            notebook_in.content,
            current_user.id,
        )

        update_data["content"] = notebook_in.content.model_dump(
            mode="json"
        )

    for field, value in update_data.items():
        setattr(notebook, field, value)

    await commit_with_optimistic_lock(
        db,
        resource_name="Notebook",
    )
    await db.refresh(notebook)

    return notebook


@router.delete(
    "/{notebook_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_notebook(
    notebook_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    notebook = await get_owned_notebook(
        db,
        notebook_id,
        current_user.id,
    )

    await db.delete(notebook)
    await commit_with_optimistic_lock(
        db,
        resource_name="Notebook",
    )


async def get_owned_notebook(
    db: AsyncSession,
    notebook_id: int,
    owner_id: int,
) -> NotebookModel:
    result = await db.execute(
        select(NotebookModel).where(
            NotebookModel.id == notebook_id,
            NotebookModel.owner_id == owner_id,
        )
    )

    notebook = result.scalar_one_or_none()

    if not notebook:
        raise HTTPException(
            status_code=404,
            detail="Notebook not found",
        )

    return notebook


async def validate_dataset_reference(
    db: AsyncSession,
    content: NotebookContent,
    owner_id: int,
) -> None:
    dataset_id = content.dataset_id

    if dataset_id is None:
        return

    result = await db.execute(
        select(DatasetModel).where(
            DatasetModel.id == dataset_id,
            DatasetModel.owner_id == owner_id,
        )
    )

    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(
            status_code=400,
            detail=(
                "The selected dataset does not exist or is not available "
                "to this account."
            ),
        )

    if dataset.type != DatasetType.FILE:
        raise HTTPException(
            status_code=400,
            detail="V1 notebooks currently support file datasets only.",
        )
