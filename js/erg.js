// Concept2 erg math. No network, no DOM.

export const MACHINES = {
  row: { label: "RowErg", splitM: 500, k: 1 },
  ski: { label: "SkiErg", splitM: 500, k: 1 },
  bike: { label: "BikeErg", splitM: 1000, k: 2 }, // BikeErg pace is per 1000 m; same power as a RowErg /500 m
};

// Concept2 ranked events: fixed-distance pieces (lowest time wins) and fixed-time pieces (longest distance wins).
export const DIST_EVENTS = [500, 1000, 2000, 5000, 6000, 10000, 21097, 42195];
export const TIME_EVENTS = [60, 240, 1800, 3600];
const BIKE_DIST_EVENTS = [1000, 2000, 4000, 10000, 20000, 42195, 50000, 100000];

export function distEvents(machine) {
  return machine === "bike" ? BIKE_DIST_EVENTS : DIST_EVENTS;
}

/** "7:32.4", "1:02:15", "32:10", "95" → seconds. Returns NaN if unreadable. */
export function parseTime(str) {
  const s = String(str ?? "").trim();
  if (!s) return NaN;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return NaN;
  return s.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** seconds → "7:32.4" (tenths shown only if present) or "1:02:15". */
export function formatTime(sec, tenths = true) {
  if (!Number.isFinite(sec)) return "—";
  const t = Math.round(sec * 10) / 10;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = tenths && s % 1 ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const eventLabel = (e, kind) => (kind === "time" ? formatTime(e, false) : e >= 1000 && e % 1000 === 0 ? `${e / 1000}k` : e === 21097 ? "Half" : e === 42195 ? "Marathon" : `${e}m`);

/** Seconds per split unit (/500 m or /1000 m for the bike). */
export function split(machine, distanceM, timeS) {
  if (!distanceM || !timeS) return NaN;
  return (timeS / distanceM) * MACHINES[machine || "row"].splitM;
}

/** Concept2 power formula: watts = 2.80 / pace³ (pace in s/m, RowErg-equivalent). */
export function watts(machine, distanceM, timeS) {
  if (!distanceM || !timeS) return NaN;
  const pace = (timeS / distanceM) * MACHINES[machine || "row"].k;
  return 2.8 / pace ** 3;
}

export function totals(session) {
  const pieces = (session.pieces || []).filter((p) => p.distance_m > 0 && p.time_s > 0);
  const distance = pieces.reduce((t, p) => t + p.distance_m, 0);
  const time = pieces.reduce((t, p) => t + p.time_s, 0);
  const rates = pieces.filter((p) => p.rate > 0);
  const rate = rates.length ? rates.reduce((t, p) => t + p.rate * p.time_s, 0) / rates.reduce((t, p) => t + p.time_s, 0) : null;
  return { pieces: pieces.length, distance, time, split: split(session.machine, distance, time), watts: watts(session.machine, distance, time), rate };
}

/** Which ranked event a single continuous piece counts for, if any. */
export function eventFor(machine, piece) {
  if (distEvents(machine).includes(Math.round(piece.distance_m))) return { kind: "dist", event: Math.round(piece.distance_m) };
  const t = TIME_EVENTS.find((e) => Math.abs(piece.time_s - e) < 0.5);
  return t ? { kind: "time", event: t } : null;
}

const better = (kind, a, b) => (kind === "dist" ? a.time_s < b.time_s : a.distance_m > b.distance_m);

/**
 * Best result per machine/event from single-piece sessions.
 * Returns Map<"row|dist|2000", {machine, kind, event, best:{time_s, distance_m, date, id}, history:[...]}>
 */
export function computeErgPRs(ergs) {
  const prs = new Map();
  for (const s of [...ergs].sort((a, b) => a.date.localeCompare(b.date))) {
    if ((s.pieces || []).length !== 1) continue; // intervals don't count as ranked pieces
    const piece = s.pieces[0];
    const ev = eventFor(s.machine, piece);
    if (!ev) continue;
    const key = `${s.machine}|${ev.kind}|${ev.event}`;
    const entry = { time_s: piece.time_s, distance_m: piece.distance_m, date: s.date, id: s.id };
    const pr = prs.get(key) || { machine: s.machine, ...ev, best: null, history: [] };
    pr.history.push(entry);
    if (!pr.best || better(ev.kind, entry, pr.best)) pr.best = entry;
    prs.set(key, pr);
  }
  return prs;
}

/** Records `session` set versus every earlier erg session. */
export function newErgPRs(session, allErgs) {
  if ((session.pieces || []).length !== 1) return [];
  const ev = eventFor(session.machine, session.pieces[0]);
  if (!ev) return [];
  const before = computeErgPRs(allErgs.filter((e) => e.id !== session.id && e.date <= session.date));
  const prev = before.get(`${session.machine}|${ev.kind}|${ev.event}`);
  const p = session.pieces[0];
  const label = `${MACHINES[session.machine].label} ${eventLabel(ev.event, ev.kind)}`;
  const result = ev.kind === "dist" ? formatTime(p.time_s) : `${Math.round(p.distance_m)} m`;
  if (!prev) return [{ kind: "first", text: `First ${label}: ${result}` }];
  if (better(ev.kind, p, prev.best)) return [{ kind: "pr", text: `${label} PR: ${result}` }];
  return [];
}

/** Minutes on the erg on a date (used for the water target). */
export function ergMinutes(ergs, date) {
  return ergs.filter((e) => e.date === date).reduce((t, e) => t + totals(e).time / 60, 0);
}
