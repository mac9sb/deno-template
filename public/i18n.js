/**
 * Localisation using native browser APIs.
 *
 * - Locale detection: localStorage → server locale cookie (Accept-Language) → navigator.languages → fallback
 * - Translations loaded via fetch() from /locales/<locale>.json
 * - DOM: data-i18n="key" sets textContent, data-i18n-placeholder="key" sets placeholder
 * - RTL: sets document.documentElement.dir automatically
 * - Intl helpers: fmt.date(), fmt.number(), fmt.relative(), fmt.list(), fmt.plural()
 *
 * Adding a language:
 *   1. Add the locale code to SUPPORTED
 *   2. Create public/locales/<code>.json matching the shape of en.json
 *   3. Add an <option> to the #locale-switcher in each HTML file
 */

export const SUPPORTED = ["en", "fr"];

const RTL = new Set(["ar", "he", "fa", "ur"]);

function detect() {
  const stored = localStorage.getItem("locale");
  if (stored && SUPPORTED.includes(stored)) return stored;

  // Server sets this cookie from Accept-Language on first load
  const cookieMatch = document.cookie.match(/\blocale=([^;]+)/);
  if (cookieMatch && SUPPORTED.includes(cookieMatch[1])) return cookieMatch[1];

  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.split("-")[0].toLowerCase();
    if (SUPPORTED.includes(base)) return base;
  }
  return SUPPORTED[0];
}

export const locale = detect();

// Load translation messages for the active locale
let messages = {};
try {
  const res = await fetch(`/locales/${locale}.json`);
  if (res.ok) messages = await res.json();
} catch {
  // Network error — keys will fall through as-is
}

/**
 * Translate a key with optional variable interpolation.
 * t("hello", { name: "World" }) where en.js has "hello": "Hello, {name}!"
 */
export function t(key, vars = {}) {
  const msg = messages[key] ?? key;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
    msg,
  );
}

/**
 * Apply translations to the document:
 * - [data-i18n="key"]             → el.textContent = t(key)
 * - [data-i18n-placeholder="key"] → el.placeholder = t(key)
 * - [data-i18n-label="key"]       → el.setAttribute("aria-label", t(key))
 * - Sets <html lang> and <html dir>
 */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const translated = t(el.dataset.i18n);
    if (translated !== el.dataset.i18n) el.textContent = translated;
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const translated = t(el.dataset.i18nPlaceholder);
    if (translated !== el.dataset.i18nPlaceholder) {
      el.placeholder = translated;
    }
  });

  root.querySelectorAll("[data-i18n-label]").forEach((el) => {
    const translated = t(el.dataset.i18nLabel);
    if (translated !== el.dataset.i18nLabel) {
      el.setAttribute("aria-label", translated);
    }
  });

  document.documentElement.lang = locale;
  document.documentElement.dir = RTL.has(locale) ? "rtl" : "ltr";
}

/**
 * Wire up the #locale-switcher <select> if present.
 * Persists choice to localStorage and reloads.
 */
export function initLocaleSwitcher() {
  const switcher = document.getElementById("locale-switcher");
  if (!switcher) return;

  switcher.value = locale;
  switcher.addEventListener("change", () => {
    localStorage.setItem("locale", switcher.value);
    location.reload();
  });
}

/** Native Intl formatting helpers, all bound to the active locale. */
export const fmt = {
  date: (date, opts = { dateStyle: "medium" }) =>
    new Intl.DateTimeFormat(locale, opts).format(date),

  time: (date, opts = { timeStyle: "short" }) =>
    new Intl.DateTimeFormat(locale, opts).format(date),

  datetime: (date, opts = { dateStyle: "medium", timeStyle: "short" }) =>
    new Intl.DateTimeFormat(locale, opts).format(date),

  number: (n, opts = {}) =>
    new Intl.NumberFormat(locale, opts).format(n),

  currency: (amount, currency = "USD") =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      amount,
    ),

  relative: (value, unit, opts = { numeric: "auto" }) =>
    new Intl.RelativeTimeFormat(locale, opts).format(value, unit),

  list: (items, opts = { type: "conjunction" }) =>
    new Intl.ListFormat(locale, opts).format(items),

  plural: (n, opts = {}) =>
    new Intl.PluralRules(locale, opts).select(n),
};
