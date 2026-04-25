# deno-template

Starter template for Deno apps built on [`@mac9sb/deno-foundation`](https://jsr.io/@mac9sb/deno-foundation).

Includes passwordless auth (magic links + passkeys), Deno KV persistence, a switch-style HTTP router, and structured logging — ready to deploy on Deno Deploy.

## What's included

- `/get-started` — joint sign-in / sign-up page (email → magic link, or passkey)
- `/auth/verify` — verifies magic-link token, creates session
- `/auth/success` — post-auth landing page with passkey registration prompt
- `/auth/logout` — POST to sign out
- `/auth/passkey/*` — WebAuthn registration and authentication endpoints

## Setup

```bash
cp .env.example .env
# fill in your values
deno task dev
```

Open [http://localhost:8000](http://localhost:8000).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Yes | [Resend](https://resend.com) API key for sending magic links |
| `BASE_URL` | Yes | Full origin URL (e.g. `https://myapp.deno.dev`) |
| `RP_NAME` | No | Passkey relying-party display name (default: `My App`) |
| `APP_NAME` | No | App name shown in the UI (default: `My App`) |

## Deploy

```bash
deno deploy --project=<your-project-name> index.ts
```

Set the environment variables in the Deno Deploy dashboard.
