# Swara Journal

A Vedic Swara Journal & Observational Analytics PWA for logging activities
(lottery, travel, negotiation, etc.) together with their astrological context
and outcome — and tracking the "divergence" between calculated blueprint and
user-reported result over time.

The app pairs each entry with a calculation engine (`swarodaya` or
`chintamani`), a location snapshot, a user-input payload, a calculated
blueprint, a divergence report, and an outcome label. The aim is to build a
personal dataset of which astrological conditions align with which real-world
results.

## Stack

- **Backend:** Node.js / Express (port `3001`) backed by SQLite (`journal.db`)
- **Frontend:** Static PWA served from `public/` (service worker, manifest,
  flatpickr, dark theme)
- **Auth:** Identity comes from the `cf-access-authenticated-user-email`
  Cloudflare Access header. For local dev, set `DEV_USER_EMAIL`. Admin emails
  are controlled via the `ADMIN_EMAILS` env var (comma-separated).
- **Process manager:** PM2 (process name `swara-journal`)

## Project layout

```
swara-journal/
├── server.js              # Express app (API + static)
├── package.json           # Manifest
├── journal.db             # SQLite database — NOT in git, backed up via restic
├── node_modules/          # NOT in git
└── public/                # Static PWA assets (icons, css, js, sw.js, index.html)
```

## API

All endpoints scope data to the authenticated user email unless the caller is
listed in `ADMIN_EMAILS` and passes `?scope=all`.

| Method | Path                              | Purpose                                       |
|-------:|-----------------------------------|-----------------------------------------------|
| GET    | `/api/user-info`                  | Returns `{ email, isAdmin }`                  |
| GET    | `/api/categories`                 | List custom categories (defaults if none)     |
| POST   | `/api/categories`                 | Add a custom category                         |
| DELETE | `/api/categories/:name`           | Remove a custom category                      |
| POST   | `/api/entries`                    | Insert or replace entries (array or single)   |
| PATCH  | `/api/entries/:id`                | Update the `outcome` field of one entry       |
| DELETE | `/api/entries/:id`                | Delete one entry                              |
| GET    | `/api/entries`                    | List entries for caller (`?scope=all` admin)  |

### Entry shape

```json
{
  "id": "uuid-or-string",
  "activity_time": 1735862400000,
  "recorded_at": 1735862412345,
  "category": "Lottery",
  "engine": "swarodaya",
  "location": { "lat": 33.4, "lon": -112.1, "label": "Phoenix, AZ" },
  "user_input": { "...": "free-form" },
  "calculated_blueprint": { "...": "engine output" },
  "divergence": { "...": "diff between blueprint and reality" },
  "outcome": "win|loss|pending|...",
  "notes": "free-form"
}
```

## Run locally

```bash
npm install
npm start                    # listens on $PORT or 3001
```

Useful environment variables:

- `PORT` — listen port (default `3001`)
- `ADMIN_EMAILS` — comma-separated admin allowlist (used by `/api/entries?scope=all`)
- `DEV_USER_EMAIL` — fallback email when no `cf-access-authenticated-user-email`
  header is present (e.g. local dev behind no Cloudflare Access)

PM2 process:

```bash
pm2 start server.js --name swara-journal
```

## Deployment / DR notes

- Run on Ubuntu with Node 22.x. The app uses `sqlite3` native bindings; on a
  fresh host run `npm install` (or `npm rebuild sqlite3`) before starting.
- `journal.db` lives on local disk and is **not** in git. It is captured daily
  by the restic backup on this server.
- Front the service with Cloudflare Access so the
  `cf-access-authenticated-user-email` header is populated; otherwise admin
  features will be locked to `DEV_USER_EMAIL`.
