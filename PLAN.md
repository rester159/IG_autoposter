# Multi-Account Instagram Support — Implementation Plan

## Overview
Add support for multiple Instagram accounts across the entire app: settings, dashboard, posting, timeline, and analytics.

## Data Model Changes

### 1. New `accounts` table in `db.js`
```sql
CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,                -- Display name (e.g. "Main", "Gaming")
  ig_token   TEXT DEFAULT '',              -- Instagram access token
  ig_account_id TEXT DEFAULT '',           -- Instagram business account ID
  public_url TEXT DEFAULT '',              -- Public URL for this account's media
  photo_frequency TEXT DEFAULT '1d',
  video_frequency TEXT DEFAULT '1d',
  cron_schedule TEXT DEFAULT '0 */6 * * *',
  video_cron_schedule TEXT DEFAULT '0 12 * * *',
  enabled    INTEGER DEFAULT 0,            -- photo posting enabled
  video_enabled INTEGER DEFAULT 0,         -- video posting enabled
  color      TEXT DEFAULT '#a78bfa',       -- UI accent color for pills/tabs
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2. Add `account_id` column to `posts` table
- Migration: `ALTER TABLE posts ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL`
- Migration: `ALTER TABLE history ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL`

### 3. New `models/account.js`
- CRUD operations: `list()`, `get(id)`, `add(data)`, `update(id, data)`, `del(id)`
- Move per-account config (token, account ID, public URL, frequencies) out of global config into the accounts table
- Keep shared config (geminiApiKey, rawgApiKey, captionPrompt, etc.) in global config

### 4. Migrate existing single account
- On startup, if `accounts` table is empty but global config has `instagramToken`/`instagramAccountId`, auto-create a "Default" account from existing config values
- Update existing posts with `account_id = 1` for the migrated account

## Backend Changes

### 5. New API routes in `server.js`
- `GET /api/accounts` — list all accounts
- `POST /api/accounts` — create new account
- `PUT /api/accounts/:id` — update account settings
- `DELETE /api/accounts/:id` — delete account
- `POST /api/verify-ig/:accountId` — verify token for specific account

### 6. Update existing routes
- `POST /api/upload` — accept optional `account_id` body param, default to first account
- `GET /api/unified-queue` — accept `?account_id=` filter param
- `POST /api/unified-queue/:id/post-now` — use the post's account credentials
- `GET /api/analytics/*` — accept `?account_ids=1,2` query param for filtering/combining
- `GET /api/status` — return per-account status

### 7. Update `scheduler.js`
- Run separate cron jobs per account (each with its own schedule)
- `runOnce()` accepts an `accountId` parameter, uses that account's credentials
- `start()`/`stop()` manage jobs per account

### 8. Update `video-scheduler.js`
- Same pattern as photo scheduler — per-account cron jobs

### 9. Update `instagram.js` and `posting/instagram.js`
- `postToInstagram()` takes account credentials instead of reading from global config
- Caller passes the specific account's token/accountId/publicUrl

## Frontend Changes

### 10. Settings tab — account management
- Add "Accounts" section at top of settings with:
  - List of existing accounts (name, colored dot, edit/delete buttons)
  - "Add Account" button
  - Per-account settings panel (expandable/collapsible):
    - Account name
    - Instagram token
    - Instagram account ID
    - Public URL
    - Photo frequency default
    - Video frequency default
    - Color picker for UI identification

### 11. Dashboard — per-account frequency controls
- Show account name + colored dot next to each frequency row
- One set of photo/video frequency pills per account
- Toggle enable/disable per account

### 12. Timeline — account filter tabs
- Row of pills/tabs at the top of the timeline
- One pill per account (showing account name + color)
- Click to filter timeline to that account
- "All" tab to show combined timeline

### 13. Analytics — multi-select account pills
- Row of toggle pills at the top of analytics
- Each pill = one account (name + color)
- Multiple pills can be selected (toggle on/off)
- When multiple selected: show combined/aggregated analytics
- When single selected: show that account's analytics only

### 14. Posting — account selector
- When making a post (upload, post-now), show account selector dropdown
- Default to first account or last-used account
- Account selector appears in the upload zone area and in the "Post Now" dialog

## Implementation Order
1. DB schema + model + migration (steps 1-4)
2. API routes (steps 5-6)
3. Scheduler updates (steps 7-8)
4. Instagram posting updates (step 9)
5. Frontend: Settings account management (step 10)
6. Frontend: Dashboard per-account controls (step 11)
7. Frontend: Timeline account tabs (step 12)
8. Frontend: Analytics multi-select pills (step 13)
9. Frontend: Post account selector (step 14)
