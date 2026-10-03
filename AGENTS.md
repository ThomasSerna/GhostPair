# Repository workflow

- Work directly on `main` and create commits on `main` unless the user explicitly requests another branch.
- For every feature or change, create a corresponding commit with an English Conventional Commit message in the format `type(scope): description`, for example `feat(signaling): add connection retries`. Use the appropriate type, such as `feat`, `fix`, `docs`, `refactor`, or `chore`, and a scope identifying the affected area.
- Render uses PostgreSQL and Auto-Deploy **After CI Checks Pass** on `main`. Preserve that setting before pushing; never use On Commit. If database setup is incomplete for a new environment, keep auto-deploy Off until the provider is configured and activation is requested.
- Production signaling uses `https://ghostpair.onrender.com`. Keep credentials out of Git and public `VITE_*` variables.
