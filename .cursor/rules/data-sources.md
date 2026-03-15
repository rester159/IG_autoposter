# Data Sources

## Internal Data
- Primary DB: SQLite at `/data/autoposter.db`.
- Core tables: `config`, `influencers`, `genres`, `games`, `posts`, `history`, `video_scripts`.
- Filesystem data roots (via config defaults):
  - `/data/incoming`, `/data/posted`
  - `/data/incoming_video`, `/data/posted_video`
  - `/data/game_images`
  - `/data/team`
- Ownership model:
  - DB schema and data access live in `app/src/db.js` and `app/src/models/*`.
  - Route contracts live in `app/src/server.js`.

## External APIs
- Instagram Graph API:
  - Used for media container creation, publish, comments, and insights.
  - Auth: long-lived IG access token in config (`instagramToken`).
- Google Gemini API:
  - Used for captions, scripts, game metadata extraction, image comparison, and scoring.
  - Auth: API key in config (`geminiApiKey`).
- RAWG API:
  - Used for game enrichment (title match, score, box art URL).
  - Auth: API key in config (`rawgApiKey`).

## Data Contracts
- Post entity (minimum): `id`, `type`, `status`, `platform`, `scheduled_at`.
- Queue API contract:
  - `/api/unified-queue` returns ordered posts with optional thumbnail enrichment.
  - `/api/unified-queue/:id/caption` supports partial updates and must preserve existing fields when omitted.
- Config API contract:
  - `/api/config` masks secrets in responses.
  - PUT payload must not overwrite masked secrets unless new secret values are provided.

## Refresh and Sync Strategy
- Scheduler cron:
  - Photo posting schedule from `config.cronSchedule`.
  - Video posting schedule from `config.videoCronSchedule`.
- Precompute cron:
  - Caption prep runs every 15 minutes for upcoming posts.
- Insights cron:
  - Insights sync runs every 6 hours.
- Frontend polling:
  - Dashboard periodically refreshes status/queue.

## Failure and Fallback Handling
- API calls should fail gracefully with structured `{ ok: false, error }` where possible.
- Posting/comment failures should be logged and recorded in `history`.
- Non-critical failures (e.g., first comment failure) must not block successful publish.
- Missing optional integrations should degrade cleanly:
  - No RAWG key => skip enrichment.
  - No Gemini key => skip generation paths that require it.
