// Base64URL ↔ ArrayBuffer helpers (WebAuthn uses binary; JSON transport uses strings)
const b64 = {
  encode: (buf) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, ""),

  decode: (str) => {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)).buffer;
  },
};

// Recursively convert Base64URL strings → ArrayBuffers in WebAuthn options
function decodeOptions(val) {
  if (typeof val === "string") return b64.decode(val);
  if (Array.isArray(val)) return val.map(decodeOptions);
  if (val && typeof val === "object") {
    return Object.fromEntries(
      Object.entries(val).map(([k, v]) => [k, decodeOptions(v)]),
    );
  }
  return val;
}

// Encode a WebAuthn PublicKeyCredential for JSON transport
function encodeCredential(cred) {
  const r = cred.response;
  const encoded = {
    id: cred.id,
    rawId: b64.encode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64.encode(r.clientDataJSON),
      ...(r.attestationObject != null
        ? { attestationObject: b64.encode(r.attestationObject) }
        : {
            authenticatorData: b64.encode(r.authenticatorData),
            signature: b64.encode(r.signature),
            userHandle: r.userHandle ? b64.encode(r.userHandle) : null,
          }),
    },
  };
  if (cred.authenticatorAttachment) {
    encoded.authenticatorAttachment = cred.authenticatorAttachment;
  }
  if (typeof cred.getTransports === "function") {
    encoded.response.transports = cred.getTransports();
  }
  return encoded;
}

// ── Nav: update sign-in/out link based on session ─────────────────────────────

async function updateNav() {
  const navAuth = document.getElementById("nav-auth");
  if (!navAuth) return;
  try {
    const res = await fetch("/api/session");
    if (!res.ok) return;

    const form = document.createElement("form");
    form.method = "post";
    form.action = "/auth/logout";
    form.style.display = "contents";

    const btn = document.createElement("button");
    btn.type = "submit";
    btn.className = "btn-nav";
    btn.style.cssText = "border:none;cursor:pointer;font:inherit";
    btn.textContent = "Sign out";

    form.appendChild(btn);
    navAuth.replaceChildren(form);
  } catch {
    // Network error — leave default nav
  }
}

// ── Magic link form ────────────────────────────────────────────────────────────

function initMagicForm() {
  const form = document.getElementById("magic-form");
  const notice = document.getElementById("magic-notice");
  if (!form || !notice) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = new FormData(form).get("email");
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Sending…";
    notice.className = "notice hidden";

    try {
      const res = await fetch("/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        form.classList.add("hidden");
        notice.textContent =
          "Check your inbox — a sign-in link is on its way.";
        notice.className = "notice info";
      } else {
        const data = await res.json();
        notice.textContent = data.error ?? "Something went wrong.";
        notice.className = "notice error";
        btn.disabled = false;
        btn.textContent = "Send sign-in link";
      }
    } catch {
      notice.textContent = "Network error. Please try again.";
      notice.className = "notice error";
      btn.disabled = false;
      btn.textContent = "Send sign-in link";
    }
  });
}

// ── Passkey sign-in ────────────────────────────────────────────────────────────

function initPasskeyLogin() {
  const btn = document.getElementById("passkey-login");
  if (!btn || !window.PublicKeyCredential) return;

  btn.classList.remove("hidden");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const notice = document.getElementById("magic-notice");

    try {
      const { options, challengeId } = await fetch(
        "/auth/passkey/login/begin",
        { method: "POST" },
      ).then((r) => r.json());

      const cred = await navigator.credentials.get({
        publicKey: decodeOptions(options),
      });

      const res = await fetch("/auth/passkey/login/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, response: encodeCredential(cred) }),
      });

      if (res.ok) {
        location.href = "/auth/success";
      } else {
        const data = await res.json();
        if (notice) {
          notice.textContent = data.error ?? "Passkey sign-in failed.";
          notice.className = "notice error";
        }
      }
    } catch (err) {
      if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
        console.error("Passkey login error:", err);
      }
    } finally {
      btn.disabled = false;
    }
  });
}

// ── Passkey registration ───────────────────────────────────────────────────────

function initPasskeyRegister() {
  const btn = document.getElementById("passkey-register");
  if (!btn || !window.PublicKeyCredential) return;

  btn.classList.remove("hidden");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Opening authenticator…";

    try {
      const { options, challengeId } = await fetch(
        "/auth/passkey/register/begin",
        { method: "POST" },
      ).then((r) => r.json());

      const cred = await navigator.credentials.create({
        publicKey: decodeOptions(options),
      });

      const res = await fetch("/auth/passkey/register/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, response: encodeCredential(cred) }),
      });

      if (res.ok) {
        btn.textContent = "Passkey added";
      } else {
        const data = await res.json();
        alert(data.error ?? "Registration failed.");
        btn.disabled = false;
        btn.textContent = "Add a passkey";
      }
    } catch (err) {
      if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
        console.error("Passkey registration error:", err);
      }
      btn.disabled = false;
      btn.textContent = "Add a passkey";
    }
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────

updateNav();
initMagicForm();
initPasskeyLogin();
initPasskeyRegister();
