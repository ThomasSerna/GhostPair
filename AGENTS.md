# Repository workflow

- Work directly on `main` and create commits on `main` unless the user explicitly requests another branch.
- Before pushing `main`, verify that Render auto-deploy is Off while PostgreSQL setup is pending. Do not deploy production until the provider is configured and activation is requested.
- Production signaling uses `https://ghostpair.onrender.com`. Keep credentials out of Git and public `VITE_*` variables.
