import * as store from "../store.js";
import * as fit from "../fitness.js";
import { generateMealPlan } from "../claude.js";
import { $, $$, esc, fmt, fmtDate, toast, busy, md } from "../ui.js";

const PREFS_KEY = "fitcoach.mealprefs";
let streaming = null; // { text } while a plan is being written

function loadPrefs() {
  try {
    return { days: 5, meals: 4, style: "", avoid: "", cooking: "simple, 30 min max", budget: "moderate", notes: "", ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return { days: 5, meals: 4 };
  }
}

export function renderMeals(root) {
  const profile = store.data("profile");
  const t = fit.nutritionTargets(profile, store.data("scans"), store.data("garmin"), fit.today(profile.timezone));
  const prefs = loadPrefs();
  const plans = store.data("meal_plans");

  root.innerHTML = `
  <div class="stack">
    <h1>Meals</h1>
    <div class="card">
      <h2>Daily targets (${esc(t.goal)})</h2>
      <div class="stats">
        <div class="stat"><div class="label">Calories</div><div class="value">${fmt(t.kcal)}</div><div class="sub">maintenance ≈ ${fmt(t.tdee)}</div></div>
        <div class="stat"><div class="label">Protein</div><div class="value">${t.protein_g}<small>g</small></div><div class="sub">${fmt(t.protein_g * 4)} kcal</div></div>
        <div class="stat"><div class="label">Carbs</div><div class="value">${t.carbs_g}<small>g</small></div><div class="sub">${fmt(t.carbs_g * 4)} kcal</div></div>
        <div class="stat"><div class="label">Fat</div><div class="value">${t.fat_g}<small>g</small></div><div class="sub">${fmt(t.fat_g * 9)} kcal</div></div>
      </div>
      <p class="small muted" style="margin-top:8px">Maintenance from ${esc(t.tdeeSource)}. BMR ${fmt(t.bmr.kcal)} kcal (${esc(t.bmr.source)}). Recomp = about 10% under maintenance with high protein. Targets update as Garmin and Evolt data come in.</p>
    </div>

    <form class="card" id="prefs">
      <h2>Generate a meal plan</h2>
      <div class="fields">
        <div class="field"><label>Days</label><select name="days">${[3, 5, 7].map((n) => `<option ${prefs.days == n ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="field"><label>Meals + snacks / day</label><select name="meals">${[3, 4, 5].map((n) => `<option ${prefs.meals == n ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="field"><label>Diet style</label><input name="style" placeholder="e.g. pescatarian, high-carb, Mediterranean" value="${esc(prefs.style)}"></div>
        <div class="field"><label>Avoid / allergies</label><input name="avoid" placeholder="e.g. mushrooms, peanuts" value="${esc(prefs.avoid)}"></div>
        <div class="field"><label>Cooking</label><input name="cooking" value="${esc(prefs.cooking)}"></div>
        <div class="field"><label>Budget</label><input name="budget" value="${esc(prefs.budget)}"></div>
      </div>
      <div class="field"><label>Anything else</label><input name="notes" placeholder="e.g. I meal prep on Sundays, lunch at the office" value="${esc(prefs.notes)}"></div>
      <button class="primary" type="submit" ${streaming ? "disabled" : ""}>Generate plan</button>
    </form>

    <div id="plan-out">${streaming ? `<div class="card md">${md(streaming.text)}</div>` : ""}</div>

    ${plans.length ? `<div class="card"><h2>Saved plans</h2>
      ${plans.map((p, i) => `<details ${i === 0 && !streaming ? "open" : ""} style="padding:8px 0;border-bottom:1px solid var(--border)">
        <summary>${fmtDate(p.created_at, { month: "short", day: "numeric", year: "numeric" })} · ${fmt(p.targets.kcal)} kcal, ${p.targets.protein_g} g protein ${i === 0 ? '<span class="pill">current</span>' : ""}</summary>
        <div class="md">${md(p.plan_md)}</div>
        <button class="small ghost danger" data-del="${esc(p.id)}">Delete</button>
      </details>`).join("")}</div>` : ""}
  </div>`;

  $("#prefs", root).addEventListener("submit", (e) => {
    e.preventDefault();
    const next = Object.fromEntries(new FormData(e.target).entries());
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    streaming = { text: "" };
    const out = $("#plan-out", root);
    out.innerHTML = `<div class="card md"><span class="spinner"></span> Planning your meals…</div>`;
    let pendingFrame = false;
    busy(e.submitter, async () => {
      try {
        const text = await generateMealPlan(next, t, (delta) => {
          streaming.text += delta;
          if (!pendingFrame) {
            pendingFrame = true;
            requestAnimationFrame(() => { pendingFrame = false; if (out.isConnected) out.innerHTML = `<div class="card md">${md(streaming.text)}</div>`; });
          }
        });
        const plan = { id: store.uid(), created_at: new Date().toISOString(), targets: { kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g }, prefs: next, plan_md: text };
        await store.update("meal_plans", (ps) => [plan, ...ps].slice(0, 10), "New meal plan");
        toast("Meal plan saved ✓");
      } finally {
        streaming = null;
      }
      if (root.isConnected) renderMeals(root);
    });
  });

  $$("[data-del]", root).forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Delete this plan?")) return;
      busy(b, async () => {
        await store.update("meal_plans", (ps) => ps.filter((p) => p.id !== b.dataset.del), "Delete meal plan");
        renderMeals(root);
      });
    }),
  );
}
