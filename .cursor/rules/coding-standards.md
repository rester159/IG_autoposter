# Coding Standards

## General Principles
- Prefer small, explicit changes over broad rewrites.
- Keep behavior backwards-compatible unless a breaking change is explicitly approved.
- Favor clear names and simple control flow; avoid hidden side effects.
- Never hardcode secrets or environment-specific credentials in source.

## Frontend Standards
- React app lives in `app/web`; use functional components and hooks.
- Use the shared design token system in `App.css`; avoid one-off inline style sprawl.
- Mobile-first by default; must not introduce horizontal overflow.
- Keep API access centralized through `src/api.js`.
- Preserve UX resilience: loading, empty, and error states are mandatory for data views.

## Backend Standards
- Express routes live in `app/src/server.js`; keep route handlers concise and delegate logic to modules/models.
- Validate request inputs and return consistent JSON errors.
- Preserve post lifecycle integrity (`queued -> ready -> posting -> posted/failed`).
- For non-critical integration failures (e.g., optional comment posting), log and continue when safe.
- Avoid destructive file/DB operations without explicit guard checks.

## Testing Standards
- Required before merge:
  - `npm run web:build` succeeds.
  - No new lint errors in edited files.
- For backend-impacting changes:
  - Smoke test `/api/status`, key modified endpoints, and scheduler/config toggles.
- For UI-impacting changes:
  - Verify mobile viewport behavior and key navigation flows.

## Git and Review Standards
- Commit messages should be concise, imperative, and outcome-focused.
- Include only relevant files in each commit; avoid unrelated churn.
- Never force-push to `main`.
- Before deploy:
  - Push `main`, pull on Unraid repo, rebuild image, recreate container, verify endpoint health.
