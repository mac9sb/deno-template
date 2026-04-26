# deno-template

Starter template for Deno apps built on [`@mac9sb/deno-foundation`](https://jsr.io/@mac9sb/deno-foundation).

Includes passwordless auth (magic links + passkeys + Sign in with Apple), Deno KV persistence, a URL-pattern router, i18n, static file serving, and structured logging — ready to deploy on Deno Deploy.

## What's included

- `/get-started` — sign-in page: magic link, passkey, Sign in with Apple
- `/auth/verify` — verifies magic-link token and creates a session
- `/auth/apple` — accepts an Apple identity token and creates a session
- `/auth/passkey/*` — WebAuthn registration and authentication endpoints
- `/auth/success` — post-auth landing page with passkey registration prompt
- `/auth/logout` — POST to revoke session and sign out
- `/api/session` — returns current session user or 401

## Development setup

```bash
cp .env.example .env
# fill in your values — see Environment variables below
deno task dev
```

Open [http://localhost:8000](http://localhost:8000).

**Magic links**: set `BASE_URL=http://localhost:8000` and a real `RESEND_API_KEY`. To skip email
delivery locally, you can temporarily `console.log` the token in `magic_link.ts` — it's printed
in the server terminal and you can paste it directly into `/auth/verify?token=...`.

**Passkeys**: work on `localhost` without HTTPS — no extra configuration needed.

**Sign in with Apple**: Apple's JS SDK only activates on domains registered in your Apple Developer
account. For local testing, use an [ngrok](https://ngrok.com) tunnel (`ngrok http 8000`) and
register that domain in your Services ID configuration, or test on a registered staging URL.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BASE_URL` | Yes | Full origin URL, e.g. `https://myapp.deno.dev` |
| `RP_NAME` | No | Passkey relying-party display name shown in the system prompt (default: `My App`) |
| `RESEND_API_KEY` | Yes | [Resend](https://resend.com) API key for sending magic-link emails |
| `APPLE_CLIENT_ID` | No | Apple Services ID (web) or bundle ID (native). Required to enable Sign in with Apple. |
| `STRIPE_SECRET_KEY` | No | Stripe secret key — uncomment the Stripe block in `index.ts` to activate billing routes |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |

## Production checklist

- [ ] Set all required env vars in the [Deno Deploy dashboard](https://dash.deno.com)
- [ ] Point your custom domain and update `BASE_URL` to match exactly (passkeys bind to the origin)
- [ ] Verify your sending domain in [Resend](https://resend.com) and update the `from` address in
      `magic_link.ts`
- [ ] **Passkeys + native client**: add an
      [`apple-app-site-association`](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
      file at `/.well-known/apple-app-site-association` and add the Associated Domains entitlement
      in Xcode — this lets iOS save passkeys under your domain rather than just the app
- [ ] **Sign in with Apple (web)**: create a Services ID in the
      [Apple Developer portal](https://developer.apple.com), register your domain and redirect URI
      (`<BASE_URL>/auth/apple`), then set `APPLE_CLIENT_ID` to the Services ID and update the
      `<meta name="apple-client-id">` tag in `public/get-started.html` to match
- [ ] **Sign in with Apple (native)**: add the Sign in with Apple capability in Xcode and set
      `APPLE_CLIENT_ID` to the app's bundle ID on the server — Apple uses the bundle ID as the
      `aud` claim in the identity token for native flows
- [ ] **Stripe**: register `<BASE_URL>/billing/webhook` in the Stripe dashboard, copy the signing
      secret to `STRIPE_WEBHOOK_SECRET`, then uncomment the Stripe block in `index.ts`

## Deploy

```bash
deployctl deploy --project=<your-project-name> index.ts
```

Or connect the repo in the Deno Deploy dashboard for automatic deployments on push.
