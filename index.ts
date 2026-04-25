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

// ── Static file serving ───────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
};

async function servePublic(pathname: string): Promise<Response> {
  const ext = pathname.split(".").pop() ?? "html";
  try {
    const file = await Deno.readFile(`./public${pathname}`);
    return new Response(file, {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
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
  const user: AppUser = {
    id: crypto.randomUUID(),
    email,
    createdAt: Date.now(),
  };
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
  get: async (req) => {
    const session = await validateSession(kv, req);
    if (session) return Response.redirect(`${BASE_URL}/auth/success`, 302);
    return servePublic("/get-started.html");
  },
});

router.route("/about", {
  get: () => servePublic("/about.html"),
});

router.route("/auth/success", {
  get: async (req) => {
    const session = await validateSession(kv, req);
    if (!session) return Response.redirect(`${BASE_URL}/get-started`, 302);
    return servePublic("/auth-success.html");
  },
});

// Session info for client-side nav/state
router.route("/api/session", {
  get: async (req) => {
    const session = await validateSession(kv, req);
    if (!session) return errorResponse("Unauthorized", 401);
    const user = (await kv.get<AppUser>(["user", "id", session.userId])).value;
    if (!user) return errorResponse("User not found", 404);
    return jsonResponse({ userId: user.id, email: user.email });
  },
});

router.route("/auth/magic-link", {
  post: async (req) => {
    const body = await req.json().catch(() => ({})) as { email?: string };
    if (!body.email) return errorResponse("email is required", 400);

    const result = await sendMagicLink(kv, body.email, { baseUrl: BASE_URL });
    if (!result.ok) {
      return new Response(
        JSON.stringify({
          error: "Too many requests. Please wait before trying again.",
        }),
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
    if (!result) return servePublic("/link-expired.html");

    const user = await findOrCreateUser(result.email);
    const { cookie } = await createSession(kv, user.id);
    log.info("magic link login", { userId: user.id });

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${BASE_URL}/auth/success`,
        "Set-Cookie": cookie,
      },
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

    // deno-lint-ignore no-explicit-any
    await finishRegistration(kv, session.userId, body.challengeId, body.response as any, RP_ID, BASE_URL);
    return jsonResponse({ ok: true });
  },
});

router.route("/auth/passkey/login/begin", {
  post: async () => jsonResponse(await beginAuthentication(kv, { rpId: RP_ID })),
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

    // deno-lint-ignore no-explicit-any
    const { userId } = await finishAuthentication(kv, body.challengeId, body.response as any, RP_ID, BASE_URL);
    const { cookie } = await createSession(kv, userId);
    log.info("passkey login", { userId });

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

const STATIC = new Set(["/styles.css", "/client.js"]);

log.info("server starting", { baseUrl: BASE_URL });
Deno.serve({ port: 8000 }, (req) => {
  const { pathname } = new URL(req.url);
  if (STATIC.has(pathname)) return servePublic(pathname);
  return router.handle(req);
});
