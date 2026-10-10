# Phase 8G.5 — Browser Python Resource-Exhaustion Containment

**Status:** COMPLETE / FROZEN  
**Date:** 2026-10-09  
**Authoritative parent:** `checkpoints/phase8G4-complete.zip`  
**Parent SHA-256:** `1BC9D391C6262FEA7502EC67A1DF175518A6368AB7227328DC960F5DA0274BE6`

## Objective

Phase 8G.5 strengthens V1 browser Python against resource-exhaustion conditions without claiming a browser/process memory boundary that the application cannot genuinely enforce.

The Phase 8G.4 architecture remains unchanged:

- notebook Python executes in a dedicated browser Web Worker;
- Pyodide 314.0.7 and pandas remain self-hosted;
- arbitrary notebook Python is not intentionally executed by the frontend Nginx container or application backend source;
- Worker isolation remains responsiveness and containment defense in depth, not a hostile-code operating-system sandbox.

## Design decision

A hard total-browser memory ceiling is **not claimed**.

Phase 8G.5 deliberately does not use:

- `performance.memory`;
- `measureUserAgentSpecificMemory()`;
- private Pyodide/Emscripten `HEAP*` implementation fields;
- a custom Pyodide rebuild;
- arbitrary automatic Worker recycling after a fixed number of healthy notebook cells.

Those mechanisms would either be measurement rather than enforcement, depend on unstable/private implementation details, require a separate Pyodide supply-chain/build phase, or break expected notebook state retention.

Instead, Phase 8G.5 implements deterministic resource-exhaustion containment around the existing Worker execution boundary.

## Enforced V1 input budgets

Both the main-thread `PythonRuntime` and the Worker independently enforce:

- Python cell code: maximum **50,000 characters**;
- loaded dataset rows: maximum **10,000 rows**;
- dataset CSV transfer: maximum **10 MiB UTF-8**, exactly **10,485,760 bytes**.

The UTF-8 limit is measured as encoded byte size rather than JavaScript string-character count.

Main-thread validation prevents oversized messages from being posted to the Worker.

Worker-side validation independently protects the Worker protocol boundary and occurs before Pyodide initialization or dataset loading for a `run` request.

## Existing execution time controls preserved

Phase 8G.5 preserves the established Phase 8G.4 time controls unchanged:

- Pyodide initialization timeout: **90 seconds**;
- dataset preparation timeout: **30 seconds**;
- user Python execution timeout: **10 seconds**.

Timeout recovery continues to terminate the Worker and require a fresh runtime.

## Fatal resource-exhaustion handling

The Worker classifies fatal resource conditions including:

- Python `MemoryError`;
- WebAssembly out-of-memory conditions;
- failed Wasm memory growth/allocation signals.

Fatal resource errors are returned with a `resetRequired` protocol signal.

When `PythonRuntime` receives that signal it terminates the affected Worker, clears runtime readiness, and allows a later operation to initialize a fresh Worker/Pyodide runtime.

Ordinary Python exceptions and ordinary input-validation failures do not request a Worker reset.

Healthy Workers are not recycled automatically because Python notebook state is intentionally retained across cells.

## Phase 8G.5A — Read-only architecture/resource audit

The authoritative Phase 8G.4 checkpoint was verified before design work:

- checkpoint files: 193;
- manifest: 192/192 verified;
- source changed: false;
- production changed: false;
- backend changed: false;
- database changed: false;
- Caddy changed: false.

The audit confirmed that Phase 8G.4 already provided:

- a dedicated browser Worker;
- 90s / 30s / 10s timeout lifecycle;
- bounded stdout/stderr/result/error transport;
- single active-run protection;
- worker termination/recovery;
- 10,000-row backend export boundary;
- self-hosted Pyodide.

The remaining Phase 8G.5 concern was browser-side resource-exhaustion containment rather than general execution correctness.

## Phase 8G.5B — Local engineering implementation

Modified:

1. `frontend/public/python-worker.mjs`
2. `frontend/src/lib/pythonRuntime.ts`
3. `frontend/src/lib/pythonRuntime.test.ts`

Accepted SHA-256 identities:

- `frontend/public/python-worker.mjs`  
  `72FE0482833F8206EBB1422565CEF49F7317A4973F65C09F070B70B6D78C3E8B`

- `frontend/src/lib/pythonRuntime.ts`  
  `CEF558BF5800FC208A04B0E4232BA413132B45F73764DC672545238DD6449B14`

- `frontend/src/lib/pythonRuntime.test.ts`  
  `1CED7073C3EF4736252FF0168341C324A9186814395D6D7DA10B4361902E6CE6`

Local acceptance:

- worker JavaScript syntax passed;
- targeted `pythonRuntime.test.ts`: **13/13 passed**;
- full TypeScript/Vite production build passed;
- protected NotebookPage, dataset bridge, package, Dockerfile, Nginx and Compose files remained unchanged;
- all frozen Pyodide 314.0.7 assets remained unchanged;
- no unsupported/private memory-enforcement mechanism was introduced.

The 13 targeted tests include:

- empty code rejection;
- >50,000-character code rejection;
- >10,000-row dataset rejection;
- UTF-8 10 MiB budget enforcement;
- normal worker initialization/reuse;
- ordinary execution;
- concurrency lock;
- manual reset;
- cold-start race protection;
- `messageerror` recovery;
- stale initialization safety;
- fatal resource-result reset/recovery;
- fatal resource exhaustion during dataset preparation.

## Phase 8G.5C — Real browser acceptance

An isolated production frontend candidate was built and tested in real Microsoft Edge.

Accepted candidate image:

`sha256:da3c7565d40ecc99027be2dd5c2a1ae3a59a0951e10906a772f535f6096ddd5a`

The browser gate verified:

- 50,001-character Python code was rejected by the Worker boundary;
- >10,000 loaded rows were rejected;
- >10 MiB UTF-8 CSV input was rejected using multibyte data;
- normal self-hosted Pyodide initialized;
- pandas 3.0.2 executed successfully;
- normal dataset result remained correct;
- a real Python `MemoryError` received through Pyodide was classified as fatal;
- the Worker protocol requested runtime reset;
- a fresh Worker/Pyodide runtime was initialized;
- the replacement Worker successfully executed the dataset again.

Accepted browser state:

`PHASE8G5C_BROWSER_PASS|CODE_LIMIT_BLOCKED|ROW_LIMIT_BLOCKED|UTF8_10MIB_LIMIT_BLOCKED|PANDAS=3.0.2|SUM=6|MEMORYERROR_RESET_REQUIRED|FRESH_WORKER_RECOVERY|RECOVERY_SUM=6`

The acceptance test intentionally did **not** exhaust actual machine/browser memory.

## Production deployment

Only the frontend was recreated.

Pre-8G.5 frontend:

- container: `f4d86bbd342c692b22addbecc764028c7cfb37488313814d2eb1d48e0d2ba264`
- image: `sha256:bfa9d49607a9f12e7090d7f73cae5a005b60fb1ce6cf76274e403684b70fb2ae`

Post-8G.5 frontend:

- container: `98f4a7320476b7e0cc8f23addf25263d664d1da5048e4558e467f15654e57575`
- image: `sha256:da3c7565d40ecc99027be2dd5c2a1ae3a59a0951e10906a772f535f6096ddd5a`

Unchanged dependencies:

- backend container: `92ae58abc3bdf5d64fa5f4c8fbfd172b43f17cd454df81f33fa7f6280842a2fe`
- Postgres container: `fa288f7f87be7bda763b97bf001a5d9573abc93d3f6aad74df0a22be1ad0ff0c`

Database fingerprint before and after:

`1|1|1|1|20261006_0004`

Production verification passed for:

- exact browser-tested frontend image;
- exact hardened Worker;
- self-hosted Pyodide module;
- Pyodide WASM;
- frontend health;
- backend readiness through the production network;
- inherited Phase 8G.4 CSP;
- Worker JavaScript MIME;
- WASM MIME;
- frontend CPU/memory/PID container controls.

Caddy was not changed.

## Rollback

The exact pre-8G.5 frontend is preserved as:

`dataplatform-frontend-prod:pre-8g5`

Rollback image:

`sha256:bfa9d49607a9f12e7090d7f73cae5a005b60fb1ce6cf76274e403684b70fb2ae`

Rollback remains frontend-only.

## Important backend deployment boundary

Phase 8G.2 removed the legacy server-side Jupyter/Python executor from the source tree.

However, the production backend container was deliberately not rebuilt during Phases 8G.3, 8G.4 or 8G.5.

Therefore at the Phase 8G.5 freeze:

- frontend Phase 8G.5 resource-exhaustion containment is deployed;
- browser Python remains self-hosted;
- backend and Postgres remain unchanged;
- Phase 8G.2 backend retirement is still **not active in the running production backend container**.

This distinction must remain explicit until a later controlled backend deployment occurs.

## Exact source delta from Phase 8G.4

Modified:

1. `frontend/public/python-worker.mjs`
2. `frontend/src/lib/pythonRuntime.ts`
3. `frontend/src/lib/pythonRuntime.test.ts`

Added:

4. `docs/phases/phase8G5/PHASE8G5_COMPLETION.md`

No change was made by Phase 8G.5 to:

- `frontend/nginx.prod.conf`;
- `frontend/src/lib/pythonDatasetBridge.ts`;
- `frontend/src/pages/NotebookPage.tsx`;
- package dependencies;
- Pyodide assets;
- Dockerfiles;
- Compose files;
- backend source;
- database schema/data;
- Caddy.