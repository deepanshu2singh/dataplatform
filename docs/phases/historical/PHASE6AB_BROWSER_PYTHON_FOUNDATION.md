# Phase 6A + 6B — Browser Python foundation

This phase intentionally does **not** enable the notebook Python button yet.
It builds and verifies the two foundations first:

- a dedicated module Web Worker running pinned Pyodide 314.0.7
- pandas preloaded in that worker
- 10-second hard execution timeout by terminating the worker
- stdout/stderr capture capped at 100,000 characters
- stdin disabled
- per-runtime state, with no FastAPI/Jupyter Python execution
- an authenticated dataset export endpoint
- ownership checks before dataset export
- first 10,000 dataset rows at most
- 10 MB serialized CSV bridge limit
- no backend filesystem path exposed to the browser

The worker receives only the bounded CSV snapshot and metadata. The user's auth
JWT is not sent to the worker.

Phase 6C will connect this foundation to the notebook's Python-cell controls.
