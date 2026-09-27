# Render and portable PostgreSQL deployment

The same Node 24 Docker image runs on Render, Koyeb or another container host. PostgreSQL is selected by `DATABASE_URL`; without it the server uses `DATABASE_PATH` and SQLite for local development or a persistent host. A failed PostgreSQL connection never falls back to SQLite. Rooms and pairing state remain in memory: run **exactly one signaling instance** even with PostgreSQL.

## Current Render service

Production URL: **https://ghostpair.onrender.com**. The existing [GhostPair service](https://dashboard.render.com/web/srv-damu2lp42hec73cgnlg0) builds `ThomasSerna/GhostPair`, branch `main`, using `./Dockerfile` and repository-root build context. PostgreSQL runtime variables are configured; `/health` and `/ready` were confirmed healthy on September 27, 2026. The health-check path is `/ready`.

Set **Auto-Deploy → After CI Checks Pass**. Every branch push and pull request runs the CI workflow; only `main` deploys this service. The workflow's **CI required** job rejects failed, cancelled or skipped verification. Render waits for GitHub checks, including release publication when applicable, before deploying. No deploy hook or Render API token is needed in GitHub. Keep this setting instead of On Commit. See [Render CI integration](https://render.com/docs/deploys#integrating-with-ci).

Render Free still discards local files on redeploy, restart or idle spin-down; identity persistence depends on PostgreSQL, not the container filesystem. Keep the configured database and public URL stable. The local SQLite file is not a production backup. Backup restoration and real cross-network browser sessions remain separate operational checks. See [Render Free storage limits](https://render.com/docs/free#local-files-lost-on-redeploy).

### Configure a new environment or replace the provider

1. Keep auto-deploy Off during initial setup. Select a persistent PostgreSQL provider and obtain a dedicated GhostPair database and connection URL. Keep it independent of the web service lifecycle, close to the Render region, with a backup/restore procedure. The database user needs permission to create and use the `devices` table. Replacing an existing database requires preserving its identities as described below.
2. Use `deploy/render.env.example` for the runtime variables. In Render's Environment settings, configure the real `DATABASE_URL` and `DATABASE_SSL_MODE=verify-full`; keep the URL secret and out of Git, `VITE_*`, image layers and build arguments. The example's empty URL intentionally prevents startup until replaced. Missing `DATABASE_URL` selects SQLite, so **do not activate this service without it**. Preserve `HOST=0.0.0.0`, `PORT=8787`, `NODE_ENV=production` and `TRUST_PROXY=true`. Trust forwarded IP headers only behind Render's controlled proxy.
3. Remove all `ssl*` and `uselibpqcompat` query parameters from the URL: TLS is configured by the explicit variables. URL overrides for `query_timeout`, `statement_timeout`, `connectionTimeoutMillis` and `options` are rejected to preserve the five-second bounds. For a private CA, mount its PEM through a Render secret file and set `DATABASE_SSL_CA_FILE` to its absolute path. Use a provider endpoint whose hostname matches its certificate. `disable` is only for trusted local tests. The pool uses at most four connections. See [node-postgres TLS configuration](https://node-postgres.com/features/ssl).
4. When activation is requested, save the completed runtime configuration and deploy a verified commit from `main`. If saving variables already triggers that deployment, do not start another. Confirm the deployed SHA in Render. A service restart alone does not publish new code. After activation succeeds, set auto-deploy to **After CI Checks Pass**. See [Render deployments](https://render.com/docs/deploys).
5. Startup creates `devices` if needed. Storage initialization or TLS failure prevents the server from listening, with no SQLite fallback. No manual schema migration is needed for a fresh database. Existing PostgreSQL rows are preserved. Run one signaling instance, allow cold-start time, and verify `GET /health` and `GET /ready` both return 200. Use `/ready` as the health-check path; it also checks database availability. See [health checks](https://render.com/docs/health-checks).
6. Verify registration and WebSocket pairing from two different Chrome/Edge IDs, rejected web origins, and a real session. Restart/redeploy and confirm the same installation credentials still authenticate against PostgreSQL. Preserve existing PostgreSQL data during routine updates; clearing extension storage is not part of deployment.
7. If activation fails, keep the database and credentials intact. Diagnose readiness/TLS first. A code rollback after PostgreSQL registration must use a PostgreSQL-capable revision, not the old SQLite-only production artifact; never reset the database to recover a deployment. Complete real-browser/network, publisher and privacy checks before store submission.

Any valid `chrome-extension://` origin with a 32-character Chrome/Edge ID is accepted without registration of that ID. HTTP web origins, missing origins and malformed IDs remain rejected; localhost HTTP origins require the explicit development flag. Legacy `ALLOWED_ORIGINS` values are ignored and may remain during the transition. Authentication, session passwords and rate limits still apply.

The committed `.env.production` contains only public extension defaults for `https://ghostpair.onrender.com` and external STUN. No database configuration enters the extension. Existing manually saved endpoints require **Use build defaults**. There is still no TURN relay, and cross-network P2P remains a separate browser check.

### Other hosts

`deploy/koyeb.env.example` remains a portable alternative; Koyeb is not the current production host. Use the same Docker image and PostgreSQL/TLS requirements there. A persistent self-managed host can instead use the SQLite/Caddy/STUN Compose configuration. Neither approach requires enumerating extension IDs.

## SQLite to PostgreSQL

Build the server first. Stop the old signaling service and registration traffic during cutover. Back up SQLite consistently (stop the writer or use SQLite's backup API); do not copy a live database without its WAL state.

Set the destination `DATABASE_URL` and TLS variables in the shell or root environment file. From the repository root:

```powershell
npm.cmd run build
npm.cmd run migrate:identities -- --source C:/backups/ghostpair.sqlite --dry-run
npm.cmd run migrate:identities -- --source C:/backups/ghostpair.sqlite
```

Dry run validates the read-only SQLite snapshot and prints a row count; it does not connect to or change PostgreSQL. The import preserves IDs, credential hashes and timestamps in one locked transaction. Identical rows are skipped on rerun. A conflicting row aborts all imported rows. The source is retained; output contains totals, never credentials. Retain both the source backup and a PostgreSQL backup until cutover has been verified. Confirm an existing extension installation can authenticate without clearing its settings.

## Move to another host

Preserve the public HTTPS URL and the identity database. Extension credentials are keyed by signaling URL: switching from a `*.koyeb.app` URL to a different URL creates new installation identities even if the database was copied. A custom domain lets DNS change without changing saved settings.

Stop new pairing, take a PostgreSQL backup with the provider's tools or `pg_dump`, restore into the destination with `pg_restore`, configure the same environment variables, and verify `/ready` before switching DNS. Keep only one active signaling instance behind the public URL. Roll back to the previous image and database endpoint if needed; account for identities registered after cutover before restoring an older backup. Define retention, access and deletion policies for backups and infrastructure logs before publication.

Existing `compose.yaml` retains the SQLite/Caddy/STUN option for a host with persistent storage. When using PostgreSQL with Compose, use `compose.postgres.yaml` as an override and inject database secrets from the environment. Monitor readiness, connection errors, active connections, authentication failures, memory, disk/database capacity and backup restore checks. Logs must not include signaling payloads, passwords or connection strings.
