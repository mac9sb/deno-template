import {
  beginAuthentication,
  beginRegistration,
  clearSessionCookie,
  createLogger,
  createSession,
  errorResponse,
  finishAuthentication,
  finishRegistration,
  jsonResponse,
  revokeSession,
  Router,
  sendMagicLink,
  validateSession,
  verifyMagicToken,
} from "@mac9sb/deno-foundation";

const kv = await Deno.openKv();
const log = createLogger("app");

const BASE_URL = Deno.env.get("BASE_URL") ?? "http://localhost:8000";
const RP_ID = new URL(BASE_URL).hostname;
const RP_NAME = Deno.env.get("RP_NAME") ?? "My App";
const APP_NAME = Deno.env.get("APP_NAME") ?? "My App";

// ── HTML helpers ──────────────────────────────────────────────────────────────

function layout(title: string, body: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — ${APP_NAME}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }

    :root {
      --color-bg: #fafafa;
      --color-surface: #ffffff;
      --color-text: #111;
      --color-muted: #666;
      --color-accent: #0070f3;
      --color-accent-hover: #0057c2;
      --color-border: #e5e5e5;
      --color-error: #c00;
      --radius: 8px;
      --font: system-ui, sans-serif;
    }

    body {
      font-family: var(--font);
      background: var(--color-bg);
      color: var(--color-text);
      min-block-size: 100dvb;
      display: grid;
      place-items: center;
      padding: 1.5rem;
    }

    main {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 2rem;
      inline-size: min(100%, 400px);

      & h1 { font-size: 1.5rem; margin-block-end: 0.25rem }
      & p.subtitle { color: var(--color-muted); margin-block-end: 1.5rem; font-size: 0.9rem }
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-block-end: 1rem;

      & label { font-size: 0.875rem; font-weight: 500 }

      & input[type="email"] {
        padding: 0.6rem 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        font-size: 1rem;
        inline-size: 100%;

        &:focus { outline: 2px solid var(--color-accent); outline-offset: 2px }
      }
    }

    button, .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.6rem 1.25rem;
      border: none;
      border-radius: var(--radius);
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
      inline-size: 100%;

      &.primary {
        background: var(--color-accent);
        color: #fff;
        &:hover { background: var(--color-accent-hover) }
      }

      &.secondary {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-text);
        margin-block-start: 0.5rem;
        &:hover { background: var(--color-bg) }
      }
    }

    .divider {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-block: 1rem;
      color: var(--color-muted);
      font-size: 0.8rem;

      &::before, &::after {
        content: "";
        flex: 1;
        block-size: 1px;
        background: var(--color-border);
      }
    }

    .notice {
      padding: 0.75rem;
      border-radius: var(--radius);
      font-size: 0.875rem;
      margin-block-end: 1rem;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1d4ed8;

      &.error { background: #fef2f2; border-color: #fecaca; color: var(--color-error) }
    }

    .hidden { display: none }
  </style>
</head>
<body>
  <main>${body}</main>
  <script type="module">
    // Base64URL helpers for WebAuthn binary data
    const b64url = {
      encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""),
      decode: (str) => {
        str = str.replace(/-/g, "+").replace(/_/g, "/");
        while (str.length % 4) str += "=";
        return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)).buffer;
      },
    };

    // Recursively convert Base64URL strings → ArrayBuffers for WebAuthn options
    function decodeOptions(obj) {
      if (typeof obj === "string") return b64url.decode(obj);
      if (Array.isArray(obj)) return obj.map(decodeOptions);
      if (obj && typeof obj === "object") {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, decodeOptions(v)]));
      }
      return obj;
    }

    // Encode a WebAuthn credential response for JSON transport
    function encodeCredential(cred) {
      const obj = { id: cred.id, rawId: b64url.encode(cred.rawId), type: cred.type };
      const res = cred.response;
      if (res.clientDataJSON !== undefined) obj.response = {
        clientDataJSON: b64url.encode(res.clientDataJSON),
        ...(res.attestationObject !== undefined
          ? { attestationObject: b64url.encode(res.attestationObject) }
          : {
              authenticatorData: b64url.encode(res.authenticatorData),
              signature: b64url.encode(res.signature),
              userHandle: res.userHandle ? b64url.encode(res.userHandle) : null,
            }),
      };
      if (cred.authenticatorAttachment) obj.authenticatorAttachment = cred.authenticatorAttachment;
      if (cred.getTransports) obj.response.transports = cred.getTransports();
      return obj;
    }

    // Magic link form — show confirmation without full page reload
    const magicForm = document.getElementById("magic-form");
    const magicNotice = document.getElementById("magic-notice");
    if (magicForm) {
      magicForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = new FormData(magicForm).get("email");
        const btn = magicForm.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.textContent = "Sending…";
        try {
          const res = await fetch("/auth/magic-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          if (res.ok) {
            magicForm.classList.add("hidden");
            magicNotice.textContent = "Check your email — a sign-in link is on its way.";
            magicNotice.classList.remove("hidden");
          } else {
            const { error } = await res.json();
            magicNotice.textContent = error ?? "Something went wrong.";
            magicNotice.className = "notice error";
            magicNotice.classList.remove("hidden");
            btn.disabled = false;
            btn.textContent = "Send sign-in link";
          }
        } catch {
          btn.disabled = false;
          btn.textContent = "Send sign-in link";
        }
      });
    }

    // Passkey sign-in
    const passkeyBtn = document.getElementById("passkey-login");
    if (passkeyBtn && window.PublicKeyCredential) {
      passkeyBtn.classList.remove("hidden");
      passkeyBtn.addEventListener("click", async () => {
        try {
          passkeyBtn.disabled = true;
          const { options, challengeId } = await fetch("/auth/passkey/login/begin", {
            method: "POST",
          }).then((r) => r.json());

          const decoded = decodeOptions(options);
          const cred = await navigator.credentials.get({ publicKey: decoded });
          const res = await fetch("/auth/passkey/login/finish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId, response: encodeCredential(cred) }),
          });
          if (res.ok) location.href = "/auth/success";
          else {
            const { error } = await res.json();
            alert(error ?? "Passkey sign-in failed.");
          }
        } catch (err) {
          if (err.name !== "NotAllowedError") console.error(err);
        } finally {
          passkeyBtn.disabled = false;
        }
      });
    }

    // Passkey registration (on /auth/success)
    const registerBtn = document.getElementById("passkey-register");
    if (registerBtn && window.PublicKeyCredential) {
      registerBtn.classList.remove("hidden");
      registerBtn.addEventListener("click", async () => {
        try {
          registerBtn.disabled = true;
          const { options, challengeId } = await fetch("/auth/passkey/register/begin", {
            method: "POST",
          }).then((r) => r.json());

          const decoded = decodeOptions(options);
          const cred = await navigator.credentials.create({ publicKey: decoded });
          const res = await fetch("/auth/passkey/register/finish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId, response: encodeCredential(cred) }),
          });
          if (res.ok) {
            registerBtn.textContent = "Passkey added ✓";
            registerBtn.disabled = true;
          } else {
            const { error } = await res.json();
            alert(error ?? "Registration failed.");
          }
        } catch (err) {
          if (err.name !== "NotAllowedError") console.error(err);
          registerBtn.disabled = false;
        }
      });
    }
  </script>
</body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function getStartedPage(): Response {
  return layout(
    "Get started",
    `<h1>${APP_NAME}</h1>
    <p class="subtitle">Sign in or create an account.</p>
    <p id="magic-notice" class="notice hidden" aria-live="polite"></p>
    <form id="magic-form" method="post" action="/auth/magic-link">
      <div class="form-group">
        <label for="email">Email address</label>
        <input type="email" id="email" name="email" autocomplete="email"
               placeholder="you@example.com" required>
      </div>
      <button type="submit" class="btn primary">Send sign-in link</button>
    </form>
    <div class="divider">or</div>
    <button id="passkey-login" class="btn secondary hidden" type="button">
      Sign in with a passkey
    </button>`,
  );
}

function authSuccessPage(hasPasskey: boolean): Response {
  return layout(
    "Signed in",
    `<h1>You're signed in</h1>
    <p class="subtitle">Welcome back.</p>
    ${
      !hasPasskey
        ? `<button id="passkey-register" class="btn secondary hidden" type="button">
        Add a passkey for faster sign-in
      </button>`
        : `<p class="notice">You have a passkey set up on this device.</p>`
    }
    <form method="post" action="/auth/logout" style="margin-block-start:1rem">
      <button type="submit" class="btn secondary">Sign out</button>
    </form>`,
  );
}

// ── User helpers ──────────────────────────────────────────────────────────────

interface AppUser {
  id: string;
  email: string;
  createdAt: number;
}

async function findOrCreateUser(email: string): Promise<AppUser> {
  const existingId = (await kv.get<string>(["user", "email", email])).value;
  if (existingId) {
    const user = (await kv.get<AppUser>(["user", "id", existingId])).value;
    if (user) return user;
  }
  const user: AppUser = { id: crypto.randomUUID(), email, createdAt: Date.now() };
  await kv.set(["user", "id", user.id], user);
  await kv.set(["user", "email", email], user.id);
  log.info("user created", { userId: user.id });
  return user;
}

// ── Routes ────────────────────────────────────────────────────────────────────

const router = new Router();

router.route("/", {
  get: () => Response.redirect(`${BASE_URL}/get-started`, 302),
});

router.route("/get-started", {
  get: () => getStartedPage(),
});

router.route("/auth/success", {
  get: async (req) => {
    const session = await validateSession(kv, req);
    if (!session) return Response.redirect(`${BASE_URL}/get-started`, 302);
    const creds = (await kv.get([...["passkey", "users", session.userId]])).value;
    return authSuccessPage(Array.isArray(creds) && creds.length > 0);
  },
});

router.route("/auth/magic-link", {
  post: async (req) => {
    const body = await req.json().catch(() => ({})) as { email?: string };
    if (!body.email) return errorResponse("email is required", 400);

    const result = await sendMagicLink(kv, body.email, { baseUrl: BASE_URL });
    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please wait before trying again." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(result.retryAfter ?? 60),
          },
        },
      );
    }

    return jsonResponse({ ok: true });
  },
});

router.route("/auth/verify", {
  get: async (req) => {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return errorResponse("token is required", 400);

    const result = await verifyMagicToken(kv, token);
    if (!result) {
      return layout(
        "Link expired",
        `<h1>Link expired</h1>
        <p class="subtitle">This sign-in link has already been used or has expired.</p>
        <a href="/get-started" class="btn primary" style="text-decoration:none;display:block;text-align:center">
          Try again
        </a>`,
      );
    }

    const user = await findOrCreateUser(result.email);
    const { cookie } = await createSession(kv, user.id);
    log.info("session created via magic link", { userId: user.id });

    return new Response(null, {
      status: 302,
      headers: { Location: `${BASE_URL}/auth/success`, "Set-Cookie": cookie },
    });
  },
});

router.route("/auth/passkey/register/begin", {
  post: async (req) => {
    const session = await validateSession(kv, req);
    if (!session) return errorResponse("Unauthorized", 401);

    const user = (await kv.get<AppUser>(["user", "id", session.userId])).value;
    if (!user) return errorResponse("User not found", 404);

    const result = await beginRegistration(kv, {
      rpName: RP_NAME,
      rpId: RP_ID,
      userId: user.id,
      userEmail: user.email,
    });

    return jsonResponse(result);
  },
});

router.route("/auth/passkey/register/finish", {
  post: async (req) => {
    const session = await validateSession(kv, req);
    if (!session) return errorResponse("Unauthorized", 401);

    const body = await req.json().catch(() => ({})) as {
      challengeId?: string;
      response?: unknown;
    };
    if (!body.challengeId || !body.response) {
      return errorResponse("challengeId and response are required", 400);
    }

    await finishRegistration(
      kv,
      session.userId,
      body.challengeId,
      // deno-lint-ignore no-explicit-any
      body.response as any,
      RP_ID,
      BASE_URL,
    );

    return jsonResponse({ ok: true });
  },
});

router.route("/auth/passkey/login/begin", {
  post: async () => {
    const result = await beginAuthentication(kv, { rpId: RP_ID });
    return jsonResponse(result);
  },
});

router.route("/auth/passkey/login/finish", {
  post: async (req) => {
    const body = await req.json().catch(() => ({})) as {
      challengeId?: string;
      response?: unknown;
    };
    if (!body.challengeId || !body.response) {
      return errorResponse("challengeId and response are required", 400);
    }

    const { userId } = await finishAuthentication(
      kv,
      body.challengeId,
      // deno-lint-ignore no-explicit-any
      body.response as any,
      RP_ID,
      BASE_URL,
    );

    const { cookie } = await createSession(kv, userId);
    log.info("session created via passkey", { userId });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
    });
  },
});

router.route("/auth/logout", {
  post: async (req) => {
    const session = await validateSession(kv, req);
    if (session) await revokeSession(kv, session.id);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${BASE_URL}/get-started`,
        "Set-Cookie": clearSessionCookie(),
      },
    });
  },
});

// ── Server ────────────────────────────────────────────────────────────────────

log.info("server starting", { baseUrl: BASE_URL });
Deno.serve({ port: 8000 }, (req) => router.handle(req));
