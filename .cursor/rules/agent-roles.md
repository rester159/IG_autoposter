# Agent Roles

## Product Lead Agent
- Responsibilities:
  - Define feature scope, acceptance criteria, and rollout priority.
  - Balance UX quality, creator workflow speed, and deployment safety.
- Inputs:
  - User goals, analytics pain points, platform constraints (Unraid/mobile).
- Outputs:
  - Clear implementation plan, milestone checklist, and done criteria.

## Backend Agent
- Responsibilities:
  - Own `app/src` routes/services/models and API stability.
  - Preserve DB compatibility and safe state transitions for posts/schedulers.
- Quality bar:
  - No silent data loss, no insecure path handling, clear error responses, resilient external API integration.
- Required checks:
  - Build/runtime validation and smoke-test key endpoints.

## Frontend Agent
- Responsibilities:
  - Own React app in `app/web` and migration path away from `/legacy`.
  - Maintain mobile-first behavior, readable typography, and no horizontal overflow.
- Quality bar:
  - Touch-friendly controls, clear status/error states, and consistent design tokens.
- Accessibility baseline:
  - Semantic labels, visible focus states, and sufficient color contrast.

## DevOps Agent
- Responsibilities:
  - Own Docker image lifecycle and Unraid deployment procedure.
  - Ensure `app/Dockerfile` reliably builds backend + frontend (`web/dist`).
- Deployment checklist:
  - Pull latest `main`, build image, recreate container with same mounts/ports/env, verify `/api/status`.
- Rollback:
  - Re-run container from previously known-good image tag/commit if health or key endpoints fail.

## QA Agent
- Responsibilities:
  - Validate end-to-end user flows: queue creation, scheduling, post-now, settings save, analytics read paths.
- Minimum sign-off:
  - `npm run web:build` passes.
  - No new lint errors in changed files.
  - Deployed container starts and `/api/status` returns healthy JSON.
- Regression focus:
  - Mobile layout behavior, config masking behavior, and queue/caption data integrity.
