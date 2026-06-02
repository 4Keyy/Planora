# Playwright E2E

Two test projects share this folder:

| Project | Match pattern | What it drives | Requires |
|---------|---------------|----------------|----------|
| `api` | `*.api.spec.ts` | HTTP requests against the API gateway via `APIRequestContext` (no browser). | docker-compose stack running, gateway on `E2E_API_URL` (default `http://127.0.0.1:5132`). |
| `ui` | `e2e/ui/*.ui.spec.ts` | A real Chromium browser driving Next.js. | docker-compose stack **and** the Next.js frontend on `E2E_FRONTEND_URL` (default `http://127.0.0.1:3000`). |

Run everything: `npm run e2e`.
Run only the API project: `npm run e2e -- --project=api`.
Run only the UI project: `npm run e2e -- --project=ui`.

### Local UI runs

```bash
# Terminal 1 — backend
docker compose --env-file .env up -d --build

# Terminal 2 — frontend (production build, not dev — dev mode breaks Playwright)
cd frontend
npm ci
NEXT_PUBLIC_API_URL=http://127.0.0.1:5132 npm run build
NEXT_PUBLIC_API_URL=http://127.0.0.1:5132 npm run start

# Terminal 3 — tests
cd frontend
npx playwright install --with-deps chromium  # one-time
E2E_API_URL=http://127.0.0.1:5132 \
E2E_FRONTEND_URL=http://127.0.0.1:3000 \
  npm run e2e -- --project=ui
```

### Skip-friendly design

Every UI spec calls `requireFrontendReachable()` in `beforeAll`. If the
frontend URL does not respond inside 5 s, the whole file is skipped with a
clear reason — the API project keeps running, so contributors who only have
the docker stack up are not punished.

### Auth setup shortcut

UI specs reuse the API path for registration + email verification through
`registerVerifiedUser(label)` (in `_helpers.ts`). That keeps each UI spec
focused on the flow it actually validates (login UI, tasks page UX, etc.)
instead of re-driving the registration form every time. Email tokens are
scraped from the Auth-API container logs, identical to the existing API
spec.
