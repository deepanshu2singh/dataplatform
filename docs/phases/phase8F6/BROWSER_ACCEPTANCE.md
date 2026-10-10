# Phase 8F.6 manual browser acceptance gate

Run this only after `verify-phase8F6-runtime-hardening.ps1` reports PASS.

Use the already-trusted production origin:

`https://app.example.test`

## One compact authenticated regression

1. **Login**
   - Sign in with the production smoke-test account.
   - Confirm the authenticated home page loads.

2. **Existing dataset**
   - Open `Production Sales Smoke Test` (or the existing Phase 8F.5 smoke dataset).
   - Confirm the stored schema/preview still loads.

3. **Saved notebook SQL**
   - Open the saved notebook from Phase 8F.5.
   - Execute the existing revenue aggregation query.
   - Expected rows remain:
     - Laptop — 3600.49
     - Monitor — 899.97
     - Keyboard — 374.95
     - Mouse — 239.92

4. **Saved dashboard**
   - Open the saved production dashboard.
   - Click `Refresh Data`.
   - Confirm the widget execution request returns 200 and the same four rows render.

5. **Logout**
   - Sign out.
   - Confirm logout returns 204, the session cookie disappears, and a protected dashboard URL redirects to `/login`.

## Completion rule

If all five steps pass, Phase 8F.6 is complete and a new **full checkpoint ZIP** should be created from the final source state.

If any step fails, stop at that failure and inspect the responsible component. Do not begin the next phase and do not broaden testing arbitrarily.
