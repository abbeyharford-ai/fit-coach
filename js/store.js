// Data layer: JSON files in your PRIVATE GitHub repo, read/written via the
// GitHub Contents API with a fine-grained token (decrypted from lock.js).

import * as lock from "./lock.js";

const SETTINGS_KEY = "fitcoach.settings";

export const DEFAULTS = {
  profile: {},
  workouts: [],
  ergs: [],
  scans: [],
  garmin: { updated_at: null, daily: [], activities: [] },
  water: {},
  meal_plans: [],
  checkins: [],
};

// Non-secret settings (owner, repo, model) live in localStorage. The GitHub
// token and Anthropic key come only from the unlocked passcode vault (lock.js).
export function getSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {}
  for (const k of lock.SECRET_FIELDS) delete saved[k];
  return { model: "claude-sonnet-5-5", branch: "main", ...saved, ...lock.sessionSecrets() };
}

export function saveSettings(s) {
  const rest = { ...s };
  for (const k of lock.SECRET_FIELDS) delete rest[k];
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
}

export function isConfigured() {
  const s = getSettings();
  return Boolean(s.demo || (s.ghOwner && s.ghRepo && s.ghToken));
}

export const isDemo = () => Boolean(getSettings().demo);

// Demo mode: sample data from ./demo, edits stay in memory. Dates in the files
// are relative to DEMO_ANCHOR and get shifted so the demo always looks current.
const DEMO_ANCHOR = "2026-10-13";
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function shiftDates(v, days) {
  const shift = (str) => {
    const d = new Date(str.slice(0, 10) + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10) + str.slice(10);
  };
  if (typeof v === "string") return DATE_RE.test(v) ? shift(v) : v;
  if (Array.isArray(v)) return v.map((x) => shiftDates(x, days));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [DATE_RE.test(k) ? shift(k) : k, shiftDates(x, days)]));
  return v;
}

async function fetchDemo(name) {
  const res = await fetch(`demo/${name}.json`, { cache: "no-store" });
  const raw = res.ok ? await res.json() : structuredClone(DEFAULTS[name]);
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const days = Math.round((new Date(today + "T12:00:00Z") - new Date(DEMO_ANCHOR + "T12:00:00Z")) / 86400000);
  // The profile's summer target is a fixed date, not relative.
  cache[name] = { data: name === "profile" ? raw : shiftDates(raw, days), sha: null };
  return cache[name].data;
}

// name -> { data, sha }
const cache = {};

export function data(name) {
  return cache[name]?.data ?? structuredClone(DEFAULTS[name]);
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function gh(path, opts = {}) {
  const s = getSettings();
  const res = await fetch(`https://api.github.com/repos/${s.ghOwner}/${s.ghRepo}/contents/${path}`, {
    cache: "no-store",
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${s.ghToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
  return res;
}

export async function fetchFile(name) {
  const s = getSettings();
  if (s.demo) return fetchDemo(name);
  const res = await gh(`data/${name}.json?ref=${encodeURIComponent(s.branch)}`);
  // profile.json always exists in the data repo, so a 404 there means no file access.
  if (res.status === 404 && name === "profile") throw new Error(TOKEN_PERMISSION_HELP);
  if (res.status === 404) {
    cache[name] = { data: structuredClone(DEFAULTS[name]), sha: null };
  } else if (!res.ok) {
    throw new Error(`GitHub ${res.status} reading ${name}.json: ${(await res.json().catch(() => ({}))).message || ""}`);
  } else {
    const body = await res.json();
    cache[name] = { data: JSON.parse(b64decode(body.content)), sha: body.sha };
  }
  return cache[name].data;
}

export async function loadAll() {
  await Promise.all(Object.keys(DEFAULTS).map(fetchFile));
}

async function put(name, value, message) {
  const s = getSettings();
  const res = await gh(`data/${name}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      branch: s.branch,
      content: b64encode(JSON.stringify(value, null, 2) + "\n"),
      ...(cache[name]?.sha ? { sha: cache[name].sha } : {}),
    }),
  });
  return res;
}

// Apply `mutate` to the latest copy and commit. If the hourly Action (or
// another device) committed in between, GitHub returns 409/422 and we
// refetch and re-apply, so nobody's change is lost.
export async function update(name, mutate, message = `Update ${name}`) {
  if (isDemo()) {
    const next = mutate(structuredClone(data(name))) ?? data(name);
    cache[name] = { data: next, sha: null };
    return next;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await fetchFile(name);
    const next = mutate(structuredClone(data(name))) ?? data(name);
    const res = await put(name, next, message);
    if (res.ok) {
      const body = await res.json();
      cache[name] = { data: next, sha: body.content.sha };
      return next;
    }
    if (res.status === 404 || res.status === 403) throw new Error(TOKEN_PERMISSION_HELP);
    if (res.status !== 409 && res.status !== 422) {
      throw new Error(`GitHub ${res.status} saving ${name}.json: ${(await res.json().catch(() => ({}))).message || ""}`);
    }
  }
  throw new Error(`Couldn't save ${name}.json after 3 tries (conflicting edits).`);
}

export async function testConnection() {
  const s = getSettings();
  const res = await fetch(`https://api.github.com/repos/${s.ghOwner}/${s.ghRepo}`, {
    headers: { Authorization: `Bearer ${s.ghToken}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.json().catch(() => ({}))).message || "check owner/repo/token"}`);
  const repo = await res.json();
  if (!repo.private) throw new Error(`${repo.full_name} is PUBLIC. Your health data repo must be private.`);
  // Seeing the repo only needs metadata access; reading files needs Contents.
  const files = await gh(`data/profile.json?ref=${encodeURIComponent(s.branch)}`);
  if (files.status === 404 || files.status === 403) throw new Error(TOKEN_PERMISSION_HELP);
  return repo;
}

const TOKEN_PERMISSION_HELP =
  "Your GitHub token can see the repo but isn't allowed to read or save its files. On github.com go to Settings → Developer settings → Fine-grained tokens → your token → Edit → Repository permissions → Contents → Read and write → Update. Then reload.";

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
