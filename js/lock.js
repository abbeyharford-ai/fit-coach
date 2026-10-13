// Passcode vault for the secrets (GitHub token, Anthropic key).
//
// At rest they live in localStorage only as AES-256-GCM ciphertext, keyed by
// PBKDF2-SHA256 (600k iterations) from your passcode. Once unlocked, the
// plaintext is kept in sessionStorage (this tab only) and wiped after 30 min
// of inactivity, on Lock, or when the tab closes. The coach chat lives in
// sessionStorage too, so it goes with it.

const VAULT_KEY = "fitcoach.vault";
const SESSION_KEY = "fitcoach.session";
const LEGACY_KEY = "fitcoach.settings";
const ITERATIONS = 600_000;
const IDLE_MS = 30 * 60 * 1000;
export const SECRET_FIELDS = ["ghToken", "anthropicKey"];
export const MIN_PASSCODE = 8;

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function readJSON(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || "null");
  } catch {
    return null;
  }
}

async function deriveKey(passcode, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passcode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export const hasVault = () => Boolean(readJSON(localStorage, VAULT_KEY));

export function isUnlocked() {
  const s = readJSON(sessionStorage, SESSION_KEY);
  if (!s) return false;
  if (Date.now() - s.lastActive > IDLE_MS) {
    sessionStorage.clear(); // also drops the coach chat
    return false;
  }
  return true;
}

export function sessionSecrets() {
  return isUnlocked() ? readJSON(sessionStorage, SESSION_KEY).secrets : {};
}

function startSession(secrets) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ secrets, lastActive: Date.now() }));
  persistStorage();
}

/** Ask the browser not to evict our storage (the encrypted vault) under pressure or inactivity. */
export async function persistStorage() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return Boolean(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}

export const isInstalledApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** Encrypt `secrets` under `passcode` (replaces any existing vault) and unlock. */
export async function createVault(passcode, secrets) {
  if (String(passcode).length < MIN_PASSCODE) throw new Error(`Use at least ${MIN_PASSCODE} characters for your passcode.`);
  const clean = Object.fromEntries(SECRET_FIELDS.map((k) => [k, secrets[k] || ""]));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passcode, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(clean)));
  localStorage.setItem(VAULT_KEY, JSON.stringify({ v: 1, iterations: ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) }));
  clearLegacy();
  startSession(clean);
}

// Simple in-tab throttle against someone guessing at the keyboard.
let failures = 0;
let lockedUntil = 0;

/** Decrypt the vault. Throws "Wrong passcode" on failure. */
export async function unlock(passcode) {
  if (Date.now() < lockedUntil) throw new Error(`Too many tries. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)} s.`);
  const v = readJSON(localStorage, VAULT_KEY);
  if (!v) throw new Error("No saved login on this device.");
  try {
    const key = await deriveKey(passcode, fromB64(v.salt), v.iterations);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(v.iv) }, key, fromB64(v.ct));
    failures = 0;
    const secrets = JSON.parse(dec.decode(pt));
    startSession(secrets);
    return secrets;
  } catch {
    failures++;
    if (failures >= 5) lockedUntil = Date.now() + 30_000 * 2 ** (failures - 5);
    throw new Error("Wrong passcode.");
  }
}

/** Check a passcode without changing state (used before re-encrypting new secrets). */
export async function verify(passcode) {
  const v = readJSON(localStorage, VAULT_KEY);
  const key = await deriveKey(passcode, fromB64(v.salt), v.iterations);
  await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(v.iv) }, key, fromB64(v.ct)).catch(() => {
    throw new Error("Current passcode is wrong.");
  });
}

export function lock() {
  sessionStorage.clear(); // session secrets + coach chat
}

/** Forgot passcode: the only way back in is entering fresh tokens. */
export function wipe() {
  localStorage.removeItem(VAULT_KEY);
  sessionStorage.clear();
  clearLegacy();
}

// Before the vault existed, secrets were stored in plain text in settings.
export function legacySecrets() {
  const s = readJSON(localStorage, LEGACY_KEY) || {};
  const found = Object.fromEntries(SECRET_FIELDS.filter((k) => s[k]).map((k) => [k, s[k]]));
  return Object.keys(found).length ? found : null;
}

function clearLegacy() {
  const s = readJSON(localStorage, LEGACY_KEY);
  if (!s) return;
  for (const k of SECRET_FIELDS) delete s[k];
  localStorage.setItem(LEGACY_KEY, JSON.stringify(s));
}

/** Bump the idle timer on activity; call onLock when the session times out. */
export function watchIdle(onLock) {
  let last = 0;
  const touch = () => {
    if (Date.now() - last < 15_000) return; // don't write on every keystroke
    last = Date.now();
    const s = readJSON(sessionStorage, SESSION_KEY);
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, lastActive: last }));
  };
  for (const ev of ["pointerdown", "keydown", "scroll"]) addEventListener(ev, touch, { passive: true });
  setInterval(() => {
    if (hasVault() && readJSON(sessionStorage, SESSION_KEY) && !isUnlocked()) onLock();
  }, 30_000);
}
