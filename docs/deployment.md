# Portable deployment and Koyeb

The same Node 24 Docker image runs on Koyeb or another container host. PostgreSQL is selected by `DATABASE_URL`; without it the server uses `DATABASE_PATH` and SQLite. A failed PostgreSQL connection never falls back to SQLite. Rooms and pairing state remain in memory: run **exactly one signaling instance** even with PostgreSQL.

## Prepare Koyeb

1. Provision a PostgreSQL database independently of the web service lifecycle. Obtain its connection URL and a backup/restore procedure. Keep credentials in Koyeb secrets, never in `VITE_*`, Git, image layers or build arguments. `deploy/koyeb.env.example` lists the required configuration without real credentials.
2. Create a web service from this repository's root Dockerfile. Expose HTTP port `8787`, route `/`, and set `HOST=0.0.0.0`, `PORT=8787`, `TRUST_PROXY=true`. Koyeb terminates HTTPS/WSS; this deployment does not need Caddy. Use exact Chrome/Edge extension origins in `ALLOWED_ORIGINS`; omit development-origin allowances.
3. Inject `DATABASE_URL` and `DATABASE_SSL_MODE=verify-full`. Remove `sslmode`, `sslcert`, `sslkey`, `sslrootcert` and `ssl` query parameters from the URL: TLS is configured by the explicit variables. For a private CA mount a PEM file and set `DATABASE_SSL_CA_FILE` to its absolute container path. `disable` is only for explicitly trusted local test networks; it does not verify or encrypt database traffic.
4. Keep minimum and maximum instances at one, disable scale-to-zero, and provision at least 768 MiB memory for the existing bounded scrypt settings. Place the database close to the service. Configure the HTTP health check as `GET /ready`, allowing startup time for the database connection. `/health` reports process liveness; `/ready` returns 503 when storage is unavailable or the process is stopping. The Docker health check follows `PORT`.
5. Attach a stable custom domain, verify its HTTPS certificate, and use that domain in `VITE_SIGNALING_URL` when building the extension. Choose a reachable external STUN service for `VITE_STUN_URLS`; Koyeb's HTTP service is not the coturn UDP service from Compose. There is still no TURN relay.
6. Complete the operator fields in the privacy document. The Node image serves it directly at `/privacy`, including on Koyeb. Do not present the current publisher draft as a completed policy.
7. Verify registration, allowed/denied origins, WebSocket pairing, health/readiness, identity persistence across redeployment, and a session between separate computers/networks. Keep the previous image available for rollback. Deployments can interrupt waiting/pairing sessions; established P2P connections are independent of signaling availability.

Koyeb's local disk is ephemeral. Its [volumes](https://www.koyeb.com/docs/reference/volumes) are currently described as public preview suitable for testing, so this production path uses PostgreSQL. Consult [Docker deployment](https://www.koyeb.com/docs/build-and-deploy/pre-built-docker-images), [health checks](https://www.koyeb.com/docs/run-and-scale/health-checks) and [edge headers](https://www.koyeb.com/docs/reference/edge-network). Trust forwarded IP headers only behind a controlled proxy that supplies the final client IP.

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
