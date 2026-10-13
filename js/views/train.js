import * as store from "../store.js";
import * as fit from "../fitness.js";
import { $, $$, esc, fmt, fmtLoad, fmtDate, toast, busy, lineChart } from "../ui.js";

const COMMON = ["Back Squat", "Front Squat", "Bench Press", "Incline Dumbbell Press", "Overhead Press", "Deadlift", "Romanian Deadlift", "Hip Thrust", "Barbell Row", "Pull-up", "Lat Pulldown", "Seated Cable Row", "Leg Press", "Bulgarian Split Squat", "Walking Lunge", "Leg Curl", "Leg Extension", "Dumbbell Shoulder Press", "Lateral Raise", "Bicep Curl", "Tricep Pushdown", "Calf Raise"];

function exerciseNames() {
  const seen = new Map();
  for (const w of store.data("workouts")) for (const e of w.exercises || []) seen.set(fit.normName(e.name), e.name);
  for (const n of COMMON) if (!seen.has(fit.normName(n))) seen.set(fit.normName(n), n);
  return [...seen.values()];
}

// ---------------------------------------------------------------- logger

let draft = null; // survives tab switches within the session

function blankDraft(unit, date) {
  return { date, title: "", unit, notes: "", exercises: [{ name: "", sets: [{ reps: "", weight: "" }] }] };
}

function setRow(set, i) {
  return `<div class="set-row" data-set="${i}">
    <span class="idx">${i + 1}</span>
    <input type="number" inputmode="numeric" placeholder="reps" data-k="reps" value="${esc(set.reps)}" aria-label="reps">
    <input type="number" inputmode="decimal" step="0.5" placeholder="weight" data-k="weight" value="${esc(set.weight)}" aria-label="weight">
    <button type="button" class="ghost small" data-del-set aria-label="Remove set">✕</button>
  </div>`;
}

function exerciseBlock(ex, i) {
  return `<div class="exercise" data-ex="${i}">
    <div class="row">
      <input list="ex-names" placeholder="Exercise (e.g. Back Squat)" data-k="name" value="${esc(ex.name)}" style="flex:1">
      <button type="button" class="ghost small danger" data-del-ex>Remove</button>
    </div>
    <div class="set-row small muted" style="margin-top:8px"><span></span><span>Reps</span><span>Weight</span><span></span></div>
    ${ex.sets.map(setRow).join("")}
    <div class="row" style="margin-top:8px">
      <button type="button" class="small" data-add-set>+ Set</button>
      <button type="button" class="small ghost" data-dup-set>Repeat last set</button>
    </div>
  </div>`;
}

export function renderTrain(root) {
  const profile = store.data("profile");
  const d = fit.today(profile.timezone);
  draft ??= blankDraft(profile.units || "lb", d);
  const workouts = [...store.data("workouts")].sort((a, b) => b.date.localeCompare(a.date));
  const titles = [...new Set(workouts.map((w) => w.title).filter(Boolean))].slice(0, 6);
  const acts = (store.data("garmin").activities || []).slice(0, 12);

  root.innerHTML = `
  <div class="stack">
    <h1>Train</h1>
    <form class="card" id="log">
      <h2>Log a workout</h2>
      <div class="fields">
        <div class="field"><label>Date</label><input type="date" name="date" value="${esc(draft.date)}"></div>
        <div class="field"><label>Session</label><input name="title" placeholder="Upper A, Legs…" value="${esc(draft.title)}" list="titles"></div>
        <div class="field"><label>Units</label><select name="unit"><option ${draft.unit === "lb" ? "selected" : ""}>lb</option><option ${draft.unit === "kg" ? "selected" : ""}>kg</option></select></div>
      </div>
      ${titles.length ? `<p class="small muted">Repeat a past session: ${titles.map((t) => `<button type="button" class="small ghost" data-copy="${esc(t)}">${esc(t)}</button>`).join(" ")}</p>` : ""}
      <div id="exercises">${draft.exercises.map(exerciseBlock).join("")}</div>
      <button type="button" id="add-ex">+ Add exercise</button>
      <div class="field" style="margin-top:12px"><label>Notes</label><textarea name="notes" placeholder="How did it feel? RPE, pain, energy…">${esc(draft.notes)}</textarea></div>
      <div class="row"><button class="primary" type="submit">Save workout</button><button type="button" class="ghost" id="clear">Clear</button></div>
      <datalist id="ex-names">${exerciseNames().map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <datalist id="titles">${titles.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
    </form>

    <div class="card">
      <h2>Recent lifting</h2>
      ${workouts.length ? workouts.slice(0, 15).map((w) => `
        <details style="padding:8px 0;border-bottom:1px solid var(--border)">
          <summary><span class="num">${fmtDate(w.date, { weekday: "short", month: "short", day: "numeric" })}</span> · ${esc(w.title || "Workout")} <span class="muted small">${(w.exercises || []).length} exercises</span></summary>
          <div class="table-wrap"><table><tbody>${(w.exercises || []).map((e) => `<tr><td>${esc(e.name)}</td><td class="num">${(e.sets || []).map((s) => `${esc(s.reps)}×${esc(s.weight)}`).join(", ")} ${esc(w.unit)}</td></tr>`).join("")}</tbody></table></div>
          ${w.notes ? `<p class="small muted">${esc(w.notes)}</p>` : ""}
          <button class="small ghost danger" data-del-workout="${esc(w.id)}">Delete</button>
        </details>`).join("") : `<div class="empty">No workouts yet. Log your first one above, or just tell the Coach what you did.</div>`}
    </div>

    <div class="card">
      <h2>Garmin activities</h2>
      ${acts.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Activity</th><th>Time</th><th>kcal</th><th>Avg HR</th></tr></thead><tbody>
        ${acts.map((a) => `<tr><td class="num">${fmtDate(a.date)}</td><td>${esc(a.name || a.type)}</td><td class="num">${fmt(a.duration_min)} min</td><td class="num">${fmt(a.kcal)}</td><td class="num">${fmt(a.avg_hr)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Nothing synced from Garmin yet.</p>`}
    </div>
  </div>`;

  const form = $("#log", root);
  const readForm = () => {
    const f = new FormData(form);
    draft.date = f.get("date");
    draft.title = f.get("title");
    draft.unit = f.get("unit");
    draft.notes = f.get("notes");
    draft.exercises = $$(".exercise", form).map((exEl) => ({
      name: $("[data-k=name]", exEl).value,
      sets: $$(".set-row[data-set]", exEl).map((r) => ({ reps: $("[data-k=reps]", r).value, weight: $("[data-k=weight]", r).value })),
    }));
  };
  const rerender = () => { readForm(); renderTrain(root); };
  form.addEventListener("input", readForm);

  form.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const exEl = t.closest(".exercise");
    const i = exEl ? Number(exEl.dataset.ex) : -1;
    if (t.id === "add-ex") { readForm(); draft.exercises.push({ name: "", sets: [{ reps: "", weight: "" }] }); renderTrain(root); }
    else if (t.hasAttribute("data-add-set")) { readForm(); draft.exercises[i].sets.push({ reps: "", weight: "" }); renderTrain(root); }
    else if (t.hasAttribute("data-dup-set")) { readForm(); const s = draft.exercises[i].sets.at(-1); draft.exercises[i].sets.push({ ...s }); renderTrain(root); }
    else if (t.hasAttribute("data-del-set")) { readForm(); draft.exercises[i].sets.splice(Number(t.closest(".set-row").dataset.set), 1); renderTrain(root); }
    else if (t.hasAttribute("data-del-ex")) { readForm(); draft.exercises.splice(i, 1); if (!draft.exercises.length) draft.exercises.push({ name: "", sets: [{ reps: "", weight: "" }] }); renderTrain(root); }
    else if (t.id === "clear") { draft = blankDraft(profile.units || "lb", d); renderTrain(root); }
    else if (t.dataset.copy) {
      const prev = workouts.find((w) => w.title === t.dataset.copy);
      readForm();
      draft = { ...draft, title: prev.title, unit: prev.unit, exercises: prev.exercises.map((e) => ({ name: e.name, sets: e.sets.map((s) => ({ ...s })) })) };
      renderTrain(root);
      toast("Copied last session. Update the numbers and beat them 💪");
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    readForm();
    const exercises = draft.exercises
      .map((ex) => ({ name: ex.name.trim(), sets: ex.sets.filter((s) => s.reps !== "").map((s) => ({ reps: Number(s.reps), weight: Number(s.weight) || 0 })) }))
      .filter((ex) => ex.name && ex.sets.length);
    if (!exercises.length) return toast("Add at least one exercise with reps.", "error");
    const workout = { id: store.uid(), date: draft.date || d, title: draft.title.trim() || "Workout", unit: draft.unit, exercises, notes: draft.notes.trim(), source: "manual" };
    busy(e.submitter, async () => {
      const all = await store.update("workouts", (ws) => [...ws, workout], `Log workout ${workout.date}`);
      const prs = fit.newPRsFor(workout, all).filter((p) => p.kind !== "first");
      toast("Workout saved ✓");
      prs.forEach((p) => toast(`🏆 ${p.text} ${workout.unit}`, "pr"));
      draft = null;
      renderTrain(root);
    });
  });

  $$("[data-del-workout]", root).forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Delete this workout?")) return;
      busy(b, async () => {
        await store.update("workouts", (ws) => ws.filter((w) => w.id !== b.dataset.delWorkout), "Delete workout");
        renderTrain(root);
      });
    }),
  );
}

// ---------------------------------------------------------------- PRs

let selected = null;

export function renderPRs(root) {
  const unit = store.data("profile").units || "lb";
  const prs = [...fit.computePRs(store.data("workouts")).entries()].filter(([, p]) => p.heaviest).sort((a, b) => b[1].sessions - a[1].sessions);
  if (!prs.length) {
    root.innerHTML = `<h1>Personal records</h1><div class="card empty">Log some workouts and your PRs show up here automatically.</div>`;
    return;
  }
  selected = prs.some(([k]) => k === selected) ? selected : prs[0][0];
  const show = (kg) => fmtLoad(fit.fromKg(kg, unit));
  const p = new Map(prs).get(selected);
  const repMax = Object.entries(p.repMax).sort((a, b) => a[0] - b[0]).filter(([r]) => r <= 12);

  root.innerHTML = `
  <div class="stack">
    <h1>Personal records</h1>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Exercise</th><th>Est. 1RM</th><th>Heaviest set</th><th>Sessions</th></tr></thead>
        <tbody>${prs.map(([k, x]) => `<tr class="clickable" data-ex="${esc(k)}" ${k === selected ? 'style="background:var(--accent-soft)"' : ""}>
          <td>${esc(x.name)}</td>
          <td class="num">${x.bestE1rm ? `<b>${show(x.bestE1rm.kg)}</b> ${unit} <span class="muted small">${fmtDate(x.bestE1rm.date)}</span>` : "—"}</td>
          <td class="num">${show(x.heaviest.kg)} × ${x.heaviest.reps} <span class="muted small">${fmtDate(x.heaviest.date)}</span></td>
          <td class="num">${x.sessions}</td></tr>`).join("")}
        </tbody></table></div>
      <p class="small muted">Est. 1RM uses the Epley formula on sets of 12 reps or fewer.</p>
    </div>

    <div class="card">
      <h2>${esc(p.name)}: estimated 1RM per session</h2>
      <div class="chart-box"><canvas id="pr-chart" aria-label="${esc(p.name)} estimated one rep max over time"></canvas></div>
      ${repMax.length ? `<h3 style="margin-top:14px">Rep maxes</h3><div class="row">${repMax.map(([r, v]) => `<span class="pill">${r}RM: <b>${show(v.kg)}</b> ${unit}</span>`).join("")}</div>` : ""}
    </div>
  </div>`;

  lineChart($("#pr-chart", root), [{ label: "Est. 1RM", data: p.history.map((h) => ({ x: h.date, y: Number(fit.fromKg(h.e1rmKg, unit).toFixed(1)) })) }], { unit });
  $$("tr[data-ex]", root).forEach((tr) => tr.addEventListener("click", () => { selected = tr.dataset.ex; renderPRs(root); }));
}
