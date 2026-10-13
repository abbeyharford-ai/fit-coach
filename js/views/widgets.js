// Today-screen widgets: monthly training dots and the Garmin step tracker.
import * as store from "../store.js";
import * as fit from "../fitness.js";
import { $, $$, esc, fmt, fmtDate, barChart } from "../ui.js";

let monthOffset = 0; // 0 = this month, -1 = last month…

export function renderMonthDots(el) {
  const profile = store.data("profile");
  const today = fit.today(profile.timezone);
  const days = fit.trainingDays(store.data("workouts"), store.data("ergs"), store.data("garmin"));

  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first grid
  const iso = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const monthName = first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  let trained = 0;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<span class="dot-cell" aria-hidden="true"></span>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = iso(d);
    const what = days.get(date);
    const future = date > today;
    if (what && !future) trained++;
    const cls = ["dot", what && !future ? "on" : "", date === today ? "today" : "", future ? "future" : ""].join(" ");
    const tip = `${fmtDate(date, { weekday: "short", month: "short", day: "numeric" })}: ${what ? what.join(", ") : future ? "upcoming" : "rest day"}`;
    cells.push(`<span class="dot-cell" title="${esc(tip)}"><span class="${cls}" role="img" aria-label="${esc(tip)}"></span><span class="dot-num">${d}</span></span>`);
  }
  const streak = fit.streak(new Set(days.keys()), today, (d) => days.has(d));
  const pastDays = monthOffset === 0 ? Number(today.slice(8)) : daysInMonth;

  el.innerHTML = `
    <div class="spread">
      <span class="label">Training days</span>
      <div class="row" style="gap:4px">
        <button class="ghost small" data-month="-1" aria-label="Previous month">‹</button>
        <span class="month-name">${esc(monthName)}</span>
        <button class="ghost small" data-month="1" aria-label="Next month" ${monthOffset >= 0 ? "disabled" : ""}>›</button>
      </div>
    </div>
    <div class="dots-grid" style="margin-top:14px">
      ${["M", "T", "W", "T", "F", "S", "S"].map((w) => `<span class="dot-head">${w}</span>`).join("")}
      ${cells.join("")}
    </div>
    <div class="row" style="margin-top:16px;gap:18px">
      <span><b class="big-num">${trained}</b> <span class="muted small">of ${pastDays} days trained</span></span>
      ${monthOffset === 0 ? `<span><b class="big-num">${streak}</b> <span class="muted small">day streak</span></span>` : ""}
      <span class="legend-dots small muted"><span class="dot on"></span> trained <span class="dot"></span> rest</span>
    </div>`;

  $$("[data-month]", el).forEach((b) => b.addEventListener("click", () => {
    monthOffset = Math.min(0, monthOffset + Number(b.dataset.month));
    renderMonthDots(el);
  }));
}

export function renderSteps(el) {
  const profile = store.data("profile");
  const garmin = store.data("garmin");
  const today = fit.today(profile.timezone);
  const daily = garmin.daily || [];
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const goal = fit.stepGoal(profile, garmin, today);
  const now = byDate.get(today)?.steps ?? null;
  const pct = now ? Math.min(100, Math.round((now / goal.steps) * 100)) : 0;
  const left = now != null ? Math.max(0, goal.steps - now) : null;
  const hit = (d) => (byDate.get(d)?.steps || 0) >= fit.stepGoal(profile, garmin, d).steps;
  const streak = fit.streak(new Set(byDate.keys()), today, hit);
  const last14 = Array.from({ length: 14 }, (_, i) => fit.addDays(today, i - 13)).map((d) => ({ x: d, y: byDate.get(d)?.steps ?? 0 }));
  const has = daily.some((d) => d.steps);
  const synced = garmin.updated_at ? new Date(garmin.updated_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;

  el.innerHTML = `
    <div class="spread"><span class="label">Steps</span><span class="label">${esc(goal.source)}: ${fmt(goal.steps)}</span></div>
    ${has ? `
    <div class="meter steps" role="progressbar" aria-valuenow="${now ?? 0}" aria-valuemax="${goal.steps}" aria-label="Steps today">
      <div style="width:${pct}%"></div><span>${now != null ? fmt(now) : "—"}<small>/ ${fmt(goal.steps)}</small></span>
    </div>
    <p class="small" style="margin:-6px 0 12px">${now == null ? "No steps synced for today yet." : left === 0 ? "Goal smashed today 🎉" : `<b>${fmt(left)}</b> to go, about a ${Math.max(5, Math.round(left / 110 / 5) * 5)}-minute walk.`}
      ${streak ? ` · <b>${streak}</b>-day streak` : ""}</p>
    <div class="chart-box" style="height:150px"><canvas aria-label="Steps per day, last 14 days"></canvas></div>
    <p class="small muted" style="margin-top:8px">${synced ? `From Garmin, last synced ${esc(synced)}. Syncs every few hours.` : ""} Set your own goal in <a href="#profile">Profile</a>.</p>
    ` : `<p class="muted" style="margin-top:12px">No step data yet. Steps arrive from Garmin with the next sync.</p>`}`;

  if (has) barChart($("canvas", el), last14, { label: "Steps", goal: goal.steps });
}
