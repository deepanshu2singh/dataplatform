# Phase 8G.4 — Worker, CSP, Output and Concurrency Hardening

**Status:** COMPLETE / FROZEN  
**Date:** 2026-10-09  
**Authoritative parent:** `checkpoints/phase8G3-complete.zip`  
**Parent SHA-256:** `0BEEFAA2C314F1C6EFEB7CD00A95872E23614AAF4281F774BFE4458AADDB9560`

## Objective

Harden the browser Python execution boundary without moving arbitrary notebook Python back to the backend.

Phase 8G.4 preserves the Phase 8G.3 architecture:

- notebook Python executes in a dedicated browser Web Worker;
- Pyodide 314.0.7 and the pandas dependency closure remain self-hosted;
- backend arbitrary Python execution remains removed from the source tree;
- browser-worker isolation remains defense in depth rather than a malicious-code security sandbox.

Browser memory-budget enforcement remains intentionally deferred to Phase 8G.5.

## Phase 8G.4A — Worker/runtime correctness and bounded output

Modified:

- `frontend/public/python-worker.mjs`
- `frontend/src/lib/pythonRuntime.ts`
- `frontend/src/lib/pythonRuntime.test.ts`

Hardening completed:

- the main-thread runtime claims its busy lock before awaiting cold initialization, closing the simultaneous cold-start execution race;
- worker initialization remains single-flight;
- stale initialization failure cannot terminate a newer replacement worker;
- `messageerror` now terminates the affected worker and rejects pending work cleanly;
- the worker independently enforces one active `run` request as protocol-level defense in depth;
- stdout, stderr, returned result text, and Python exception text are bounded to the V1 100,000-character transport limit;
- truncation uses an explicit suffix;
- `outputTruncated` now includes result and exception truncation rather than only stdout/stderr;
- worker recreation/recovery remains supported.

Accepted identities:

- `frontend/public/python-worker.mjs`  
  `BBA88B1021B893C4E0B86A689FF239934E674BA3C991396B96ACF891E8E19CFD`
- `frontend/src/lib/pythonRuntime.ts`  
  `A8252C514D841D8638E9393744A17ED0EEAFF0756E1B76AB022CC69BA8936289`
- `frontend/src/lib/pythonRuntime.test.ts`  
  `37D4571D0B1C66E357E3DA4C2D0EEB0BD64D4348F492401BF51D05E67BE69570`

Validation:

- targeted `pythonRuntime.test.ts`: **8/8 passed**;
- full TypeScript/Vite production build passed;
- built worker hash matched source;
- all 10 frozen Pyodide 314.0.7 assets remained unchanged;
- real Microsoft Edge + real Pyodide/pandas execution passed with external DNS blocked;
- stdout bound: 100,000 characters;
- stderr bound: 100,000 characters;
- returned result bound: 100,000 characters;
- exception text bound: 100,000 characters;
- raw concurrent worker run was rejected;
- worker termination and recreation recovered successfully.

Accepted browser marker:

`PHASE8G4A_BROWSER_PASS|PANDAS=3.0.2|ROWS=2|SUM=6|STDOUT=100000|STDERR=100000|RESULT=100000|ERROR=100000|CONCURRENCY_BLOCKED|RECOVERY_PASS`

## Phase 8G.4B — Content Security Policy hardening

Modified:

- `frontend/nginx.prod.conf`

Accepted SHA-256:

`34B23DF901D505146AB71F9A9FAF803CE4557500F2EE23881BA4BEF92DDB337C`

Production CSP:

`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:;`

The policy:

- keeps general JavaScript `unsafe-eval` disabled;
- permits WebAssembly compilation through `wasm-unsafe-eval`;
- restricts normal connections to same origin;
- restricts workers to the approved worker policy;
- keeps framing disabled;
- disables object embedding;
- constrains base URI and form submission;
- preserves required application/editor style, image, font, and worker compatibility allowances.

Validation:

- isolated production image built successfully;
- `nginx -t` passed;
- CSP was verified semantically on application, worker, Pyodide module, WASM, and harness resources;
- worker module MIME remained `application/javascript`;
- Pyodide module MIME remained `application/javascript`;
- WASM MIME remained `application/wasm`;
- real Edge executed a same-origin external script under the enforced CSP;
- general JavaScript `eval()` was blocked;
- same-origin `/healthz` fetch succeeded;
- same-origin module Worker creation succeeded;
- self-hosted Pyodide/WASM initialized;
- pandas 3.0.2 executed against the test DataFrame;
- a deliberate external fetch generated a `securitypolicyviolation` for `connect-src`.

Accepted browser marker:

`PHASE8G4B_BROWSER_PASS|CSP_ENFORCED|EXTERNAL_SCRIPT_SELF_PASS|UNSAFE_EVAL_BLOCKED|SAME_ORIGIN_CONNECT_PASS|WORKER_SELF_PASS|WASM_PASS|PYODIDE=314.0.7|PANDAS=3.0.2|SUM=6|EXTERNAL_CONNECT_BLOCKED|DIRECTIVE=connect-src`

## Production deployment

Only the production frontend was recreated.

Pre-deployment frontend:

- container: `9dc129e710cc85c397df9027799c047e342ec9cf2f5af0c65810866ff637995a`
- image: `sha256:68ee5b1cc745a9c17a92bbf568feab14b736b6ad840431b11632e50a0b21f0d3`

Post-deployment frontend:

- container: `f4d86bbd342c692b22addbecc764028c7cfb37488313814d2eb1d48e0d2ba264`
- image: `sha256:bfa9d49607a9f12e7090d7f73cae5a005b60fb1ce6cf76274e403684b70fb2ae`

Untouched dependencies:

- backend container: `92ae58abc3bdf5d64fa5f4c8fbfd172b43f17cd454df81f33fa7f6280842a2fe`
- Postgres container: `fa288f7f87be7bda763b97bf001a5d9573abc93d3f6aad74df0a22be1ad0ff0c`

Database fingerprint before and after:

`1|1|1|1|20261006_0004`

Frontend production controls remained:

- CPU: 0.5
- memory: 256 MiB
- PIDs: 64
- user: `nginx`
- read-only root filesystem
- `no-new-privileges`
- capability drop `ALL`
- writable `/tmp` tmpfs

Production artifact verification passed for:

- hardened worker;
- Pyodide 314.0.7 module;
- Pyodide WASM;
- frontend health;
- backend readiness through the production network;
- CSP;
- JavaScript/WASM MIME handling.

Caddy was not changed.

## Rollback

The exact pre-8G.4 production frontend is preserved as:

`dataplatform-frontend-prod:pre-8g4`

Rollback image:

`sha256:68ee5b1cc745a9c17a92bbf568feab14b736b6ad840431b11632e50a0b21f0d3`

Rollback remains frontend-only: retag the preserved image as the production frontend image and force-recreate only the `frontend` service with the canonical production Compose file and `production.env`.

## Important deployment boundary

Phase 8G.2 removed the legacy backend Jupyter/Python executor from the source tree, but the production backend container was deliberately **not** rebuilt or recreated during Phases 8G.3 or 8G.4.

Therefore at the Phase 8G.4 freeze:

- frontend 8G.4 runtime/CSP hardening is deployed;
- browser Python is self-hosted and hardened;
- backend/Postgres are unchanged from their pre-8G.2 production containers;
- Phase 8G.2 backend source retirement is **not yet active in the production backend runtime**.

That distinction must remain explicit until the backend is intentionally rebuilt and deployed in a later controlled phase.

## Phase 8G.4 exact source delta from Phase 8G.3

Modified:

1. `frontend/public/python-worker.mjs`
2. `frontend/src/lib/pythonRuntime.ts`
3. `frontend/src/lib/pythonRuntime.test.ts`
4. `frontend/nginx.prod.conf`

Added:

5. `docs/phases/phase8G4/PHASE8G4_COMPLETION.md`

No backend, Compose, database, Caddy, Pyodide asset, package dependency, NotebookPage, or dataset-bridge source was changed by Phase 8G.4.