# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Build (production):**
```bash
make build          # builds frontend (npm install + vite build) then Go binary with embedded UI assets
```

**Build Go binary only (embed build tag):**
```bash
CGO_ENABLED=0 go build -tags embed -o bin/app ./cmd/willing
```

**Development:**
```bash
make dev            # runs the Go server directly (without embed, serves webui/dist from disk)
```

For frontend-only dev with HMR proxy:
```bash
cd web && npm run dev   # Vite dev server proxying /api to :8081
```
Then start the Go server separately on port 8081.

**Testing & Linting:**
```bash
make test           # go test ./...
make vet            # go vet ./...
make web-lint       # eslint across the web/ dir
```

**Frontend (standalone):**
```bash
cd web
npm install         # install deps
npm run build       # TypeScript compile + Vite build → webui/dist/
npm run lint        # ESLint
```

## Architecture

This is a Go backend + React frontend admin dashboard template. The Go binary serves both the API and the frontend SPA as a single process.

### Go backend

- **`cmd/willing/main.go`** — entry point. Loads config from env vars, opens DB, creates the admin HTTP handler via `admin.New(...)`, and starts a single `http.Server`.
- **`internal/config/`** — configuration from environment variables (`ADMIN_ADDR`, `DB_DRIVER`, `DB_DSN`, `DATABASE_URL`). Defaults to SQLite at `var/db/app.sqlite`.
- **`internal/db/`** — GORM-based data layer. Supports `sqlite` (via `glebarez/sqlite`) and `postgres`/`pgx`. Auto-migrates `User` and `SystemConfig` models on open. Provides CRUD for users, system config, and a `/api/health` ping.
- **`internal/admin/`** — the HTTP handler (Gin-based). Contains all API routes and authentication middleware. Routes are under `/api/`; the root path and unrecognized paths serve the frontend SPA. Auth uses `gorilla/sessions` cookie store (secret hardcoded — replace in production).
- **`internal/models/`** — GORM models: `User` (ID, Nickname, Password hidden from JSON) and `SystemConfig` (singleton with ID=1, holds `WarnText` for display).

### Frontend (React SPA)

- **`web/`** — React 19 + TypeScript + Vite project. Uses React Router v7 for client-side routing, Tailwind CSS with CSS variables for theming, Radix UI primitives, and Lucide icons.
- **`web/src/App.tsx`** — top-level routing: `/login` is public, everything else is wrapped in `PrivateRoute`. The app layout has a sidebar with nav links (Dashboard, Users, Settings) and a logout button.
- **`web/src/pages/`** — page components: `Login`, `GlobalProbability` (the dashboard), `SystemConfig`, `UserManagement`.
- **`web/src/hooks/useAuth.ts`** — calls `/api/me` to check session validity; `PrivateRoute` redirects to `/login` if unauthenticated.
- **`web/src/components/ui/`** — shadcn/ui-style components (button, card, input, table, toast, alert-dialog) built with Radix + Tailwind.
- **`web/vite.config.ts`** — builds output to `../webui/dist/` and proxies `/api` to `localhost:8081` in dev mode.

### WebUI embedding (dual build mode)

The `webui/` package has two build-tag-gated files:
- **`webui_embed.go`** (build tag `embed`) — embeds `webui/dist/` into the Go binary via `//go:embed`. Used for production builds (`make build`).
- **`webui_disk.go`** (build tag `!embed`) — reads `webui/dist/` from the filesystem at runtime. Used in development (`make dev`).

### Database

Default: SQLite at `var/db/app.sqlite` (gitignored). On first run, auto-creates an `admin`/`admin` default user and the system config singleton. Set `DB_DRIVER=pgx` and `DB_DSN=...` (or `DATABASE_URL`) for PostgreSQL.

### Key design points

- The entire app is a single `http.Server` — there is no separate frontend server in production. The Go server handles API routes and falls back to serving `index.html` for SPA client-side routing.
- Auth is session-based (cookie). The middleware skips auth for `/api/login`, `/login`, `/assets/*`, and OPTIONS requests.
- The `web/go.mod` exists only to satisfy Go tooling when the `web/` directory sits inside the parent module — the frontend is Node, not Go.
- Vite proxies `/api` to `:8081` in dev, but the Go server defaults to `:8080`. Run Go on `:8081` when using the Vite dev server, e.g. `ADMIN_ADDR=:8081 make dev`.
