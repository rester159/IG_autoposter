# Project Overview

## Purpose
- `ig-autoposter` is a self-hosted social content pipeline for gaming creators.
- It automates media intake, AI-assisted caption/script generation, scheduling, posting, and performance tracking with a UI optimized for mobile operation.

## Core Features
- Unified queue for photo and video posts with status lifecycle (`queued`, `ready`, `posting`, `posted`, `failed`).
- AI-assisted workflows: caption generation, hashtag generation, game metadata extraction, video script generation, and post scoring.
- Team/influencer profiles with persona fields to condition generated content style.
- Instagram publishing (photo + reels), optional first comment posting, and insights sync.
- Analytics views for game/genre/console/influencer/platform/format performance.

## Architecture Summary
- Frontend:
  - React app in `app/web` (Vite) is the default UI at `/`.
  - Legacy single-file dashboard remains at `/legacy`.
- Backend:
  - Node + Express app in `app/src/server.js`.
  - Feature modules under `app/src/*` (scheduler, video-scheduler, caption, instagram, analytics, team, queue, etc.).
- Storage:
  - SQLite (`better-sqlite3`) at `/data/autoposter.db` with models in `app/src/models`.
  - Media and assets on mounted paths under `/data` (incoming, posted, game images, team photos).

## Deployment Targets
- Local dev:
  - Backend: `npm run dev` in `app`.
  - Frontend: `npm run web:dev` in `app`.
- Containerized runtime:
  - Docker image built from `app/Dockerfile` (includes React build step).
  - Typical Unraid deployment uses host port `3420` -> container `3000`.
- Persistent storage:
  - Volume mount `/mnt/user/appdata/ig-autoposter/data:/data`.

## Current Priorities
- Keep React UI as primary experience and migrate remaining legacy-only workflows.
- Maintain mobile-first UX quality with no horizontal overflow regressions.
- Improve posting reliability/observability (health, logs, robust API error handling).
- Preserve backwards compatibility with existing DB/data layout while iterating features.
