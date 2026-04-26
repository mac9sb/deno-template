import {
  createI18n,
  createLogger,
  createStaticHandler,
  detectLocale,
  mountAuthRoutes,
  Router,
  validateSession,
} from "@mac9sb/deno-foundation";

const kv = await Deno.openKv();
const log = createLogger("app");

const BASE_URL = Deno.env.get("BASE_URL") ?? "http://localhost:8000";
const RP_ID = new URL(BASE_URL).hostname;
const RP_NAME = Deno.env.get("RP_NAME") ?? "My App";

const LOCALES = ["en", "fr"];
const serve = createStaticHandler({ locales: LOCALES });
const i18n = await createI18n({ locales: LOCALES });

// ── Routes ────────────────────────────────────────────────────────────────────

const router = new Router();

mountAuthRoutes(router, kv, { baseUrl: BASE_URL, rpId: RP_ID, rpName: RP_NAME });

// Stripe: import { mountStripeRoutes } from "@mac9sb/deno-foundation"
// and call mountStripeRoutes(router, kv, { baseUrl: BASE_URL }) to add billing routes.

router.route("/", {
  get: () => Response.redirect(`${BASE_URL}/get-started`, 302),
});

router.route("/get-started", {
  get: async (req) => {
    const session = await validateSession(kv, req);
    if (session) return Response.redirect(`${BASE_URL}/auth/success`, 302);
    return serve.html(req, "/get-started.html");
  },
});

router.route("/about", {
  get: (req) => serve.html(req, "/about.html"),
});

router.route("/auth/success", {
  get: async (req) => {
    const session = await validateSession(kv, req);
    if (!session) return Response.redirect(`${BASE_URL}/get-started`, 302);
    return serve.html(req, "/auth-success.html");
  },
});

router.route("/link-expired", {
  get: (req) => serve.html(req, "/link-expired.html"),
});

// Example: server-side translated response
// router.route("/api/hello", {
//   get: (req) => {
//     const locale = detectLocale(req, LOCALES);
//     const t = i18n.t(locale);
//     return new Response(t("get_started.title"));
//   },
// });

// ── Server ────────────────────────────────────────────────────────────────────

log.info("server starting", { baseUrl: BASE_URL });
Deno.serve({ port: 8000 }, (req) => {
  const { pathname } = new URL(req.url);
  if (serve.isStatic(pathname)) return serve.file(pathname);
  return router.handle(req);
});
