\# Phase 8G.3 Completion Record



\## Status



COMPLETE



\## Phase



Phase 8G.3 — Browser Python Runtime Reproducibility



\## Authoritative Parent Baseline



`phase8F8-complete.zip`



SHA-256:



`E0BDF5614A2C1BEF4AF938A5B9D698C6ED3D245DFA8F93FE5784881C2FAB4DB8`



Phase 8G.2 completion record:



`docs/phases/phase8G2/PHASE8G2\_COMPLETION.md`



SHA-256:



`760E929997880344C2A885513C95C33EE6FE42DEFBF04924FA402C6D7C5A2C8F`



\## Objective



Remove the runtime dependency on the public JsDelivr Pyodide CDN and make the supported V1 browser Python runtime locally controlled, version-pinned, reproducible, and deployable from the application itself.



The supported Python architecture remains:



Browser notebook

→ dedicated Web Worker

→ locally hosted Pyodide 314.0.7

→ locally hosted pandas dependency closure.



\## Final Architecture



Pyodide version:



`314.0.7`



Pandas version:



`3.0.2`



Runtime origin:



Same application origin.



External JsDelivr dependency:



Removed from the notebook Python worker.



Python execution remains browser-side.



No server-side arbitrary Python execution was reintroduced.



\## Source Changes



\### Modified



| File | Accepted SHA-256 |

|---|---|

| `frontend/public/python-worker.mjs` | `258782291141B0B17BBA10FD506E80CCF403C768DEB7C56CB101EF63C3592608` |

| `frontend/nginx.prod.conf` | `B75634230317A9B8F117FCACD82025871B93EAA11CE88BACEB3297A57218099F` |



The worker now imports Pyodide from:



`./pyodide/314.0.7/pyodide.mjs`



The Pyodide `indexURL` is resolved from the same application origin.



Nginx now serves the versioned Pyodide runtime directly.



`.mjs` files are explicitly served as:



`application/javascript`



WebAssembly continues to be served as:



`application/wasm`



Versioned Pyodide assets receive long-lived caching.



The Python worker itself does not receive the one-year asset cache policy.



\## Vendored Pyodide Runtime



Directory:



`frontend/public/pyodide/314.0.7`



Exact file count:



`10`



Exact total size:



`21,420,955 bytes`



\### Core Runtime Assets



| File | SHA-256 |

|---|---|

| `pyodide.mjs` | `6F1D60F7BF529BEB300F0F47983C921D3982363640BA20AF0E38EFDDDBC66109` |

| `pyodide.asm.mjs` | `F7CDC8ECE80678CEB712F8E65EBE6D3A83203A180C399865F49612A051693635` |

| `pyodide.asm.wasm` | `CC36E3CAB04FDFC9A63FF13EB52EAE2B911BF46C025CC7B281F394BD3DE1D5E6` |

| `python\_stdlib.zip` | `FA1957E5777068FC4F7437F96D860AE2FBE9C19732BA06C84E004EC16DD7DD7A` |

| `pyodide-lock.json` | `5DC2FC119108BC148C7457DC86E7675B5C87E1CAFD420B9C34C1EAEF7B36C010` |



\### Pandas Dependency Closure



The dependency closure was derived recursively from the verified Pyodide 314.0.7 `pyodide-lock.json`.



| Package | Version | Asset SHA-256 |

|---|---|---|

| numpy | 2.4.6 | `A292C1F5D7D8A2208CD5E94FC467604C131CABCD2FC14FED6EEFDE121E7FABDF` |

| pandas | 3.0.2 | `45FF57772CC2F366A8582C7D3097CC4E6676342ECD5A3C08184A43462D5A02AE` |

| python-dateutil | 2.9.0.post0 | `9B13365EDF9C188F570BAF9C540BBB3029ADA2A2DACB9694B3659941693EE9E5` |

| pytz | 2026.1.post1 | `B8249D6450146E0B61E6D710DC02EBB35A904796C4C2F97FE87D4AC5872DB36A` |

| six | 1.17.0 | `228C50F73AA7ADDF2C2CCF2979C256802A59AB69CAD8152B31B9443CC8140F42` |



Dependency graph:



`pandas → numpy`



`pandas → python-dateutil → six`



`pandas → pytz`



\## Supply-Chain Verification



The official Pyodide 314.0.7 full release archive was downloaded outside the project and verified before extraction.



Archive:



`pyodide-314.0.7.tar.bz2`



Exact size:



`337,536,678 bytes`



SHA-256:



`192B5864E6E6D30AB074861AF800CB8B4ACB0998EF0F9342C3367448AEB86645`



Only the required browser runtime and pandas dependency closure were copied into the application.



The complete 337 MB release distribution was not vendored into the project.



\## Protected Files



The following application files remained unchanged during Phase 8G.3:



| File | SHA-256 |

|---|---|

| `frontend/src/lib/pythonRuntime.ts` | `9969D97EA00FC96B160709116FC553E0E458E6F4BD28A70223252AFFDAB2E2CA` |

| `frontend/src/lib/pythonDatasetBridge.ts` | `76D7BD1229A0B70C6985ACCD22E1CE4AAAC950390C785EF14C8EEA1F02DCECD4` |

| `frontend/src/pages/NotebookPage.tsx` | `8AFBEF39349880D03E57EED6F14DE89CC93255E5FD25862DCDDCBD1B790C40D2` |

| `frontend/Dockerfile.prod` | `311EFB532535464F88DB6744D9FBA8293E34B565788024617B6EA891BC8C5BAD` |

| `frontend/package.json` | `2A8811C9ABC63CC386CE84DFC1C91AD5FE665790A7EA1E62B28681C2B71D3D81` |

| `frontend/package-lock.json` | `3D063FF35E5228D1008C8A366E6676E05F2A4693EE9883B7C3CDF4E125024E3D` |

| `frontend/vite.config.ts` | `E1EEFD0ED1639C88D1213884EF760516884DB9E168190E223FEE6B063AD3E088` |



No npm Pyodide dependency was introduced.



No additional Vite plugin was introduced.



\## Acceptance Evidence



\### Baseline Gate



PASS



The Phase 8G.2 state and protected frontend files matched their accepted hashes before modification.



No pre-existing vendored Pyodide directory existed.



\### Asset Acquisition



PASS



`ARCHIVE\_SIZE\_BYTES=337536678`



`ARCHIVE\_SHA256=192B5864E6E6D30AB074861AF800CB8B4ACB0998EF0F9342C3367448AEB86645`



\### Dependency Closure Audit



PASS



`PANDAS\_CLOSURE\_COUNT=5`



`ASSET\_FILE\_COUNT=10`



`ASSET\_TOTAL\_BYTES=21420955`



\### Vendored Asset Installation



PASS



All ten installed files matched their independently recorded SHA-256 hashes.



\### Local Runtime Source Gate



PASS



No external Pyodide runtime URL remained in `python-worker.mjs`.



The worker pointed to the same-origin versioned runtime.



\### Frontend Production Build



PASS



`tsc -b`



and



`vite build`



completed successfully.



The built worker matched the accepted source worker byte-for-byte.



All ten Pyodide assets survived into `frontend/dist` byte-for-byte.



\### Production Frontend Image



PASS



The production Docker image built successfully.



All required runtime assets returned HTTP 200.



\### MIME Validation



PASS



`python-worker.mjs`:



`application/javascript`



`pyodide.mjs`:



`application/javascript`



`pyodide.asm.mjs`:



`application/javascript`



`pyodide.asm.wasm`:



`application/wasm`



`pyodide-lock.json`:



`application/json`



\### Security Header Inheritance



PASS



The Pyodide asset routes continued to inherit the existing production security headers.



\### Offline Browser Runtime Acceptance



PASS



The browser was launched with external hostname resolution blocked while localhost remained available.



The runtime successfully performed:



same-origin worker initialization

→ local Pyodide initialization

→ local pandas initialization

→ CSV dataset loading

→ DataFrame creation

→ pandas execution.



Observed success marker:



`PHASE8G3\_PASS|CDN\_BLOCKED|PANDAS=3.0.2|ROWS=2|SUM=4`



A PowerShell acceptance-harness post-check initially produced a false negative because Microsoft Edge DevTools enumeration included unrelated extension/service-worker target text in the collected title string.



The required application success marker had already been emitted.



This was a test-harness issue, not an application/runtime failure.



No source change was made in response.



\## Production Deployment



Phase 8G.3 was deployed using a frontend-only production recreation.



The tested candidate frontend image was promoted to the production frontend image tag.



Production Compose frontend service:



`dataplatform-frontend-prod:8f4`



Accepted tested candidate image ID:



`sha256:68ee5b1cc745a9c17a92bbf568feab14b736b6ad840431b11632e50a0b21f0d3`



Pre-8G.3 production frontend image ID:



`sha256:9b5b428d5f7ecfe4fc4b193a38b7d2a45e851fe892c3298eb2a3091f66a0e0f7`



Rollback image tag:



`dataplatform-frontend-prod:pre-8g3`



Production deployment acceptance:



PASS



The frontend became healthy after recreation.



The approved Phase 8G.3 worker was served by production.



Production runtime assets returned HTTP 200.



The production backend container remained unchanged.



The production Postgres container remained unchanged.



The persistent Postgres volume remained untouched.



Caddy remained untouched.



\## Phase 8G.2 Deployment Distinction



Phase 8G.2 removed the dormant server-side Python executor from the source tree.



The production backend container was deliberately not rebuilt or recreated during Phase 8G.3.



Therefore, Phase 8G.2 source retirement is accepted in source but is not yet claimed as deployed in the production backend runtime.



This distinction remains intentional and must be preserved until a later integrated backend deployment.



\## Database Impact



No database schema changes.



No database migration.



No database data changes.



No Postgres restart.



No production Postgres volume changes.



\## Backend Impact



No backend deployment occurred during Phase 8G.3.



No backend container recreation occurred during the Phase 8G.3 frontend deployment.



\## Final Static Freeze Gate



PASS



`PHASE 8G.3 FINAL STATIC FREEZE GATE: PASS`



The accepted source/config hashes, exact Pyodide asset hashes, asset count, total byte size, external-runtime removal, and protected frontend files were verified after production deployment.



\## Security and Reproducibility Result



After Phase 8G.3, notebook Python initialization no longer requires the public JsDelivr Pyodide CDN.



The supported V1 notebook Python environment is now version-pinned and served from the application itself.



The browser execution model remains unchanged.



Phase 8G.3 does not claim that the browser worker is a complete malicious-code sandbox.



Worker/CSP/output/concurrency hardening remains Phase 8G.4 scope.



\## Final Result



\*\*PHASE 8G.3 — COMPLETE\*\*

