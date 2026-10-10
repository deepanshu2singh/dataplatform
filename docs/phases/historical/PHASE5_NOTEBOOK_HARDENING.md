# Phase 5 — Notebook persistence and management hardening

This phase starts from the working Phase 4 project.

## What changed

### Backend

- Notebook content now has an explicit schema.
- Maximum 100 cells per notebook.
- Maximum 50,000 characters per cell.
- Maximum 512 KB serialized notebook content.
- Cell IDs must be unique.
- Notebook names are trimmed and cannot be blank.
- Descriptions are capped at 5,000 characters.
- Notebook create/update validates that the selected dataset belongs to the authenticated user.
- V1 notebooks only accept file datasets.
- Notebook listing is sorted by most recently updated/created.
- Read/update/delete continue to return 404 for notebooks not owned by the current user.

### Frontend

- Added `/notebooks` management page.
- Saved notebooks can be opened, renamed, and deleted.
- Notebook list shows dataset, cell count, and last update time.
- Stale/deleted dataset references are shown as unavailable rather than silently running against another dataset.
- Notebook editor now shows an unsaved-changes state.
- Browser refresh/close warns if there are unsaved changes.
- Leaving via the editor's "All Notebooks" button asks for confirmation when unsaved.
- Notebook description is now editable.
- Frontend save checks match the V1 backend cell/content limits.
- Home page copy now reflects actual V1 capabilities instead of claiming Python/multiple file formats are already available.

## Files changed

- `backend/app/api/routes/notebooks.py`
- `backend/app/schemas/notebook.py`
- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/pages/HomePage.tsx`
- `frontend/src/pages/NotebookPage.tsx`
- `frontend/src/pages/NotebooksPage.tsx` (new)

No database migration is required for this phase because the database columns are unchanged.

## Validation checklist

1. `python -m py_compile app/api/routes/notebooks.py app/schemas/notebook.py`
2. `npx tsc -b`
3. Existing notebook opens and runs SQL.
4. `/notebooks` lists only the logged-in user's notebooks.
5. Rename works and survives refresh.
6. Delete removes the notebook but not its dataset.
7. User B cannot GET, PUT, or DELETE User A's notebook ID (404 expected).
8. Saving a notebook with User B's dataset ID from User A is rejected.
9. Delete the dataset used by a notebook, reopen notebook, and verify it shows a stale-dataset warning with no dataset selected.
10. Unsaved notebook changes trigger a refresh/close warning.
