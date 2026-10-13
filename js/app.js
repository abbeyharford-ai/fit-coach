import * as store from "./store.js";
import * as fit from "./fitness.js";
import { $, $$, esc, fmt, fmtDate, toast, busy } from "./ui.js";
import { renderTrain, renderPRs } from "./views/train.js";
import { renderBody } from "./views/body.js";
import { renderMeals } from "./views/meals.js";
import { renderCoach } from "./views/coach.js";

const VIEWS = { today: renderToday, train: renderTrain, prs: renderPRs, body: renderBody, meals: renderMeals, coach: renderCoach, settings: renderSettings };

let loaded = false;

async function route() {
  let tab = location.hash.replace("#", "") || "today";
  if (!VIEWS[tab]) tab = "today";
  if (!store.isConfigured()) tab = "settings";
  $$("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  const root = $("#view");
  if (store.isConfigured() && !loaded) {
    root.innerHTML = `<div class="empty"><span class="spinner"></span> Loading your data…</div>`;
    try {
      await store.loadAll();
      loaded = true;
      updateSyncStatus();
      await handleWaterParam();
    } catch (e) {
      root.innerHTML = `<div class="card"><h2>Couldn't load your data</h2><p>${esc(e.message)}</p><p><a href="#settings">Check Settings</a></p></div>`;
      if (tab !== "settings") return;
    }
  }
  root.innerHTML = "";
  await VIEWS[tab](root);
}

export async function reload() {
  await store.loadAll();
  updateSyncStatus();
  route();
}

function updateSyncStatus() {
  if (store.isDemo()) {
    $("#sync-status").innerHTML = `<span class="pill">Demo data · <a href="#settings">exit</a></span>`;
    return;
  }
  const g = store.data("garmin");
  $("#sync-status").textContent = g.updated_at ? `Garmin synced ${new Date(g.updated_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Garmin not synced yet";
}

// Notification buttons open the site with ?water=500 so one tap logs it.
async function handleWaterParam() {
  const params = new URLSearchParams(location.search);
  const ml = Number(params.get("water"));
  if (!ml) return;
  history.replaceState(null, "", location.pathname + location.hash);
  await addWater(ml);
}

export async function addWater(ml) {
  const profile = store.data("profile");
  const d = fit.today(profile.timezone);
  const t = new Date().toLocaleTimeString("en-GB", { timeZone: profile.timezone || undefined, hour: "2-digit", minute: "2-digit" });
  await store.update("water", (w) => ({ ...w, [d]: [...(w[d] || []), { t, ml }] }), `Water +${ml} ml`);
  toast(`+${ml} ml logged 💧`);
}

// ---------------------------------------------------------------- Today

function renderToday(root) {
  const profile = store.data("profile");
  const scans = store.data("scans");
  const garmin = store.data("garmin");
  const workouts = store.data("workouts");
  const d = fit.today(profile.timezone);
  const left = fit.daysUntil(profile.summer_target_date, d);
  const target = fit.waterTarget(profile, scans, garmin, workouts, d);
  const drunk = fit.waterToday(store.data("water"), d);
  const checkin = store.data("checkins").filter((c) => c.kind === "morning").slice(-1)[0];
  const daily = garmin.daily || [];
  const last = daily.filter((x) => x.sleep_hours || x.steps).slice(-1)[0] || {};
  const todayG = daily.find((x) => x.date === d) || {};
  const weekStart = fit.addDays(d, -6);
  const weekLifts = workouts.filter((w) => w.date >= weekStart);
  const weekActs = (garmin.activities || []).filter((a) => a.date >= weekStart);
  const targets = fit.nutritionTargets(profile, scans, garmin, d);
  const unit = profile.units || "lb";

  // Latest PR per exercise this week (so three bench PRs show as one pill).
  const prByEx = new Map();
  for (const w of [...weekLifts].sort((a, b) => a.date.localeCompare(b.date)))
    for (const p of fit.newPRsFor(w, workouts)) if (p.kind !== "first") prByEx.set(fit.normName(p.exercise), p.text);
  const weekPRs = [...prByEx.values()];

  const hour = new Date().toLocaleString("en-US", { timeZone: profile.timezone || undefined, hour: "numeric", hour12: false });
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  root.innerHTML = `
  <div class="stack">
    <div class="spread">
      <h1>${greet}${profile.name ? ", " + esc(profile.name) : ""}</h1>
      ${left != null ? `<span class="pill">${left} days to summer ☀️</span>` : ""}
    </div>

    ${checkin ? `<div class="card accent"><div class="small muted">Coach check-in · ${fmtDate(checkin.date, { weekday: "short", month: "short", day: "numeric" })}</div><p style="margin:.3rem 0 0">${esc(checkin.message)}</p></div>` : ""}

    <div class="grid">
      <div class="card">
        <div class="spread"><h2>Water</h2><span class="num"><b>${fmt(drunk / 1000, 2)}</b> / ${fmt(target / 1000, 2)} L</span></div>
        <div class="water-bar"><div style="width:${Math.min(100, (drunk / target) * 100)}%"></div></div>
        <div class="row">
          <button data-water="250">+250 ml</button>
          <button data-water="500">+500 ml</button>
          <button data-water="750">+750 ml</button>
          <button class="ghost small" id="water-undo">Undo</button>
        </div>
        <p class="small muted" style="margin-top:8px">Target = 35 ml/kg body weight + extra for today's training.</p>
      </div>

      <div class="card">
        <div class="spread"><h2>Recovery</h2><span class="small muted">${last.date ? fmtDate(last.date) : ""}</span></div>
        ${last.date ? `<div class="stats">
          <div class="stat"><div class="label">Sleep</div><div class="value">${fmt(last.sleep_hours, 1)}<small>h</small></div><div class="sub">${last.sleep_score ? "score " + last.sleep_score : ""}</div></div>
          <div class="stat"><div class="label">Body battery</div><div class="value">${fmt(todayG.body_battery_high ?? last.body_battery_high)}</div><div class="sub">peak today</div></div>
          <div class="stat"><div class="label">HRV</div><div class="value">${fmt(last.hrv_last_night)}<small>ms</small></div><div class="sub">${esc((last.hrv_status || "").toLowerCase())}</div></div>
          <div class="stat"><div class="label">Resting HR</div><div class="value">${fmt(last.resting_hr)}</div><div class="sub">bpm</div></div>
        </div>` : `<p class="muted">No Garmin data yet. See the setup guide in the README to connect Garmin.</p>`}
      </div>

      <div class="card">
        <h2>This week</h2>
        <div class="stats">
          <div class="stat"><div class="label">Lifts</div><div class="value">${weekLifts.length}<small>/${profile.training_days_per_week || 4}</small></div></div>
          <div class="stat"><div class="label">Cardio</div><div class="value">${weekActs.filter((a) => !/strength/.test(a.type || "")).length}</div><div class="sub">Garmin activities</div></div>
          <div class="stat"><div class="label">Steps today</div><div class="value">${fmt(todayG.steps)}</div></div>
        </div>
        ${weekPRs.length ? `<p style="margin-top:10px">${weekPRs.map((t) => `<span class="pill pr">🏆 ${esc(t)} ${unit}</span>`).join(" ")}</p>` : ""}
      </div>

      <div class="card">
        <div class="spread"><h2>Today's fuel</h2><a class="small" href="#meals">Meal plan →</a></div>
        <div class="stats">
          <div class="stat"><div class="label">Calories</div><div class="value">${fmt(targets.kcal)}</div></div>
          <div class="stat"><div class="label">Protein</div><div class="value">${targets.protein_g}<small>g</small></div></div>
          <div class="stat"><div class="label">Carbs</div><div class="value">${targets.carbs_g}<small>g</small></div></div>
          <div class="stat"><div class="label">Fat</div><div class="value">${targets.fat_g}<small>g</small></div></div>
        </div>
        <p class="small muted" style="margin-top:8px">${esc(targets.tdeeSource)}, then −10% for recomp.</p>
      </div>
    </div>

    <div class="row">
      <a class="btn" href="#train">Log a workout</a>
      <a class="btn" href="#coach">Ask your coach</a>
      <button class="ghost" id="refresh">Refresh data</button>
    </div>
  </div>`;

  $$("[data-water]", root).forEach((b) =>
    b.addEventListener("click", () => busy(b, async () => { await addWater(Number(b.dataset.water)); renderAgain(root); })),
  );
  $("#water-undo", root).addEventListener("click", (e) =>
    busy(e.currentTarget, async () => {
      await store.update("water", (w) => ({ ...w, [d]: (w[d] || []).slice(0, -1) }), "Water undo");
      renderAgain(root);
    }),
  );
  $("#refresh", root).addEventListener("click", (e) => busy(e.currentTarget, reload));
}

function renderAgain(root) {
  root.innerHTML = "";
  renderToday(root);
}

// ---------------------------------------------------------------- Settings

function renderSettings(root) {
  const s = store.getSettings();
  const p = store.data("profile");
  const configured = store.isConfigured();
  root.innerHTML = `
  <div class="stack">
    <h1>Settings</h1>
    ${configured ? "" : `<div class="card accent"><b>Welcome!</b> Connect your private data repo to get started (the README has a step-by-step guide), or look around with sample data first.<div class="row" style="margin-top:10px"><button class="primary" id="demo-on">Try with demo data</button></div></div>`}
    ${s.demo ? `<div class="card accent"><b>You're in demo mode.</b> Changes aren't saved anywhere. Add your Anthropic key below to try the coach, scans and meal plans.<div class="row" style="margin-top:10px"><button id="demo-off">Exit demo &amp; connect my data</button></div></div>` : ""}

    <form class="card" id="conn">
      <h2>Connections</h2>
      <p class="small muted">Stored only in this browser (localStorage). Never commit these anywhere.</p>
      <div class="fields">
        <div class="field"><label>GitHub username</label><input name="ghOwner" value="${esc(s.ghOwner)}" ${s.demo ? "" : "required"} autocomplete="off"></div>
        <div class="field"><label>Private data repo</label><input name="ghRepo" value="${esc(s.ghRepo || "fit-coach-data")}" ${s.demo ? "" : "required"} autocomplete="off"></div>
      </div>
      <div class="field"><label>GitHub fine-grained token (Contents: read & write on the data repo only)</label><input name="ghToken" type="password" value="${esc(s.ghToken)}" ${s.demo ? "" : "required"} autocomplete="off"></div>
      <div class="field"><label>Anthropic API key (for the coach, scans and meal plans)</label><input name="anthropicKey" type="password" value="${esc(s.anthropicKey)}" autocomplete="off"></div>
      <div class="field"><label>Claude model</label>
        <select name="model">
          ${[["claude-opus-5-5", "Claude Opus 5.5 (best)"], ["claude-sonnet-5-5", "Claude Sonnet 5.5 (cheaper)"], ["claude-haiku-5-5", "Claude Haiku 5.5 (cheapest)"]].map(([v, l]) => `<option value="${v}" ${s.model === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <button class="primary" type="submit">Save & connect</button>
    </form>

    ${configured ? `
    <form class="card" id="profile">
      <h2>Your profile</h2>
      <p class="small muted">Saved to your data repo; the hourly trainer job reads it too.</p>
      <div class="fields">
        <div class="field"><label>First name</label><input name="name" value="${esc(p.name)}"></div>
        <div class="field"><label>Sex (for BMR & ranges)</label><select name="sex"><option value="female" ${p.sex === "female" ? "selected" : ""}>Female</option><option value="male" ${p.sex === "male" ? "selected" : ""}>Male</option></select></div>
        <div class="field"><label>Birth year</label><input name="birth_year" type="number" value="${esc(p.birth_year)}"></div>
        <div class="field"><label>Height (cm)</label><input name="height_cm" type="number" step="0.5" value="${esc(p.height_cm)}"></div>
        <div class="field"><label>Weight (kg), until your first scan</label><input name="weight_kg" type="number" step="0.1" value="${esc(p.weight_kg)}"></div>
        <div class="field"><label>Lifting units</label><select name="units"><option value="lb" ${p.units !== "kg" ? "selected" : ""}>lb</option><option value="kg" ${p.units === "kg" ? "selected" : ""}>kg</option></select></div>
        <div class="field"><label>Goal</label><select name="goal">${["recomp", "cut", "bulk"].map((g) => `<option ${p.goal === g ? "selected" : ""}>${g}</option>`).join("")}</select></div>
        <div class="field"><label>Summer target date</label><input name="summer_target_date" type="date" value="${esc(p.summer_target_date)}"></div>
        <div class="field"><label>Lifting days / week</label><input name="training_days_per_week" type="number" min="1" max="7" value="${esc(p.training_days_per_week)}"></div>
        <div class="field"><label>Timezone</label><input name="timezone" value="${esc(p.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)}"></div>
        <div class="field"><label>Wake hour (0-23)</label><input name="wake_hour" type="number" min="0" max="23" value="${esc(p.wake_hour ?? 7)}"></div>
        <div class="field"><label>Bed hour (0-23)</label><input name="sleep_hour" type="number" min="0" max="23" value="${esc(p.sleep_hour ?? 22)}"></div>
      </div>
      <div class="field"><label>Food notes for the coach (allergies, likes, schedule)</label><textarea name="diet_notes">${esc(p.diet_notes)}</textarea></div>
      <div class="field"><label class="check"><input type="checkbox" name="water_reminders" ${p.water_reminders !== false ? "checked" : ""}> Water reminders on my phone (ntfy)</label></div>
      <div class="field"><label class="check"><input type="checkbox" name="morning_checkin" ${p.morning_checkin !== false ? "checked" : ""}> Morning coach check-in on my phone</label></div>
      <button class="primary" type="submit">Save profile</button>
    </form>` : ""}
  </div>`;

  $("#demo-on", root)?.addEventListener("click", () => {
    store.saveSettings({ ...s, demo: true });
    loaded = false;
    location.hash = "#today";
    route();
  });
  $("#demo-off", root)?.addEventListener("click", () => {
    store.saveSettings({ ...s, demo: false });
    loaded = false;
    route();
  });

  $("#conn", root).addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.submitter, async () => {
      const next = { ...s, ...Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim()])) };
      if (s.demo && !next.ghToken) {
        store.saveSettings(next);
        return toast("Saved. Still in demo mode.");
      }
      next.demo = false;
      store.saveSettings(next);
      const repo = await store.testConnection();
      loaded = false;
      toast(`Connected to ${repo.full_name} ✓`);
      location.hash = "#today";
      route();
    });
  });

  $("#profile", root)?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const numeric = ["birth_year", "height_cm", "weight_kg", "training_days_per_week", "wake_hour", "sleep_hour"];
    busy(e.submitter, async () => {
      await store.update("profile", (prof) => {
        for (const [k, v] of f.entries()) prof[k] = numeric.includes(k) ? Number(v) : String(v).trim();
        prof.water_reminders = f.has("water_reminders");
        prof.morning_checkin = f.has("morning_checkin");
        return prof;
      }, "Update profile");
      toast("Profile saved ✓");
    });
  });
}

window.addEventListener("hashchange", route);
route();
