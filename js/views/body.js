import * as store from "../store.js";
import * as fit from "../fitness.js";
import { readEvoltScan } from "../claude.js";
import { $, $$, esc, fmt, fmtDate, toast, busy, md, lineChart } from "../ui.js";

// [key, label, kind] — kind "mass" displays in the user's unit; lower-is-better metrics are flagged for delta colour.
const METRICS = [
  ["weight_kg", "Weight", "mass"],
  ["body_fat_pct", "Body fat", "%", true],
  ["fat_mass_kg", "Fat mass", "mass", true],
  ["lean_mass_kg", "Lean mass", "mass"],
  ["skeletal_muscle_kg", "Skeletal muscle", "mass"],
  ["visceral_fat_level", "Visceral fat", "level", true],
  ["bmr_kcal", "BMR", "kcal"],
  ["total_body_water_l", "Body water", "L"],
  ["protein_kg", "Protein", "mass"],
  ["mineral_kg", "Minerals", "mass"],
  ["biological_age", "Bio age", "yrs", true],
];

let pending = null; // extracted scan awaiting review

function show(v, kind, unit) {
  if (v == null) return "—";
  if (kind === "mass") return `${fmt(fit.fromKg(v, unit), 1)} <small>${unit}</small>`;
  if (kind === "%") return `${fmt(v, 1)}<small>%</small>`;
  if (kind === "kcal") return `${fmt(v)} <small>kcal</small>`;
  if (kind === "L") return `${fmt(v, 1)} <small>L</small>`;
  return fmt(v, kind === "level" ? 0 : 1);
}

// Arrow + change vs previous scan. Scale weight is neutral for a recomp (fat vs muscle is what matters).
function delta(key, cur, prev, kind, lowerBetter, unit) {
  if (cur == null || prev == null) return "";
  const dv = kind === "mass" ? fit.fromKg(cur, unit) - fit.fromKg(prev, unit) : cur - prev;
  if (Math.abs(dv) < 0.05) return `<span class="muted">±0</span>`;
  const good = lowerBetter ? dv < 0 : dv > 0;
  const cls = key === "weight_kg" ? "muted" : good ? "delta-good" : "delta-bad";
  return `<span class="${cls}">${dv > 0 ? "▲" : "▼"} ${fmt(Math.abs(dv), 1)}</span>`;
}

function reviewForm(scan) {
  return `<form class="card" id="review">
    <h2>Check the numbers</h2>
    <p class="small muted">Claude read these from your scan. Fix anything that's off, then save. Masses are in kg.</p>
    <div class="fields">
      <div class="field"><label>Scan date</label><input type="date" name="date" value="${esc(scan.date || fit.today(store.data("profile").timezone))}" required></div>
      ${METRICS.map(([k, label, kind]) => `<div class="field"><label>${label}${kind === "mass" ? " (kg)" : kind === "%" ? " (%)" : ""}</label><input type="number" step="any" name="${k}" value="${esc(scan[k])}"></div>`).join("")}
    </div>
    ${scan.analysis_md ? `<details open><summary>Trainer's read</summary><div class="md">${md(scan.analysis_md)}</div></details>` : ""}
    <div class="row" style="margin-top:12px"><button class="primary" type="submit">Save scan</button><button type="button" class="ghost" id="discard">Discard</button></div>
  </form>`;
}

export function renderBody(root) {
  const unit = store.data("profile").units || "lb";
  const scans = [...store.data("scans")].sort((a, b) => b.date.localeCompare(a.date));
  const [latest, prev] = scans;

  root.innerHTML = `
  <div class="stack">
    <h1>Body composition</h1>

    ${pending ? reviewForm(pending) : `
    <div class="card">
      <h2>Add an Evolt scan</h2>
      <p class="small muted">Upload the PDF report, or screenshots of every page in the Evolt app. Your coach reads it, compares it with past scans and saves the numbers.</p>
      <div class="row">
        <input type="file" id="scan-files" accept="application/pdf,image/*" multiple style="flex:1">
        <button class="primary" id="read-scan">Read scan</button>
        <button class="ghost" id="manual">Enter manually</button>
      </div>
    </div>`}

    ${latest ? `
    <div class="card">
      <div class="spread"><h2>Latest scan</h2><span class="muted small">${fmtDate(latest.date, { month: "long", day: "numeric", year: "numeric" })}${prev ? ` · vs ${fmtDate(prev.date)}` : ""}</span></div>
      <div class="stats">${METRICS.filter(([k]) => latest[k] != null).map(([k, label, kind, lowerBetter]) => `
        <div class="stat"><div class="label">${label}</div><div class="value">${show(latest[k], kind, unit)}</div><div class="sub">${prev ? delta(k, latest[k], prev[k], kind, lowerBetter, unit) : ""}</div></div>`).join("")}
      </div>
      ${latest.segmental?.length ? `<details style="margin-top:12px"><summary>Segmental breakdown</summary><div class="table-wrap"><table><thead><tr><th>Segment</th><th>Lean</th><th>Fat</th></tr></thead><tbody>${latest.segmental.map((s) => `<tr><td>${esc(s.segment)}</td><td class="num">${show(s.lean_kg, "mass", unit)}</td><td class="num">${show(s.fat_kg, "mass", unit)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
      ${latest.analysis_md ? `<details open style="margin-top:12px"><summary>Trainer's read</summary><div class="md">${md(latest.analysis_md)}</div></details>` : ""}
    </div>` : `<div class="card empty">No scans yet. Your first Evolt scan becomes the baseline for your summer recomp.</div>`}

    ${scans.length >= 2 ? `
    <div class="grid">
      <div class="card"><h2>Body fat %</h2><div class="chart-box"><canvas id="bf-chart" aria-label="Body fat percent over time"></canvas></div></div>
      <div class="card"><h2>Muscle vs fat (${unit})</h2><div class="chart-box"><canvas id="mass-chart" aria-label="Skeletal muscle and fat mass over time"></canvas></div></div>
    </div>` : ""}

    ${scans.length ? `
    <div class="card">
      <h2>All scans</h2>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Weight</th><th>Body fat</th><th>Muscle</th><th>Visceral</th><th></th></tr></thead><tbody>
      ${scans.map((s) => `<tr><td class="num">${fmtDate(s.date, { month: "short", day: "numeric", year: "2-digit" })}</td><td class="num">${show(s.weight_kg, "mass", unit)}</td><td class="num">${show(s.body_fat_pct, "%")}</td><td class="num">${show(s.skeletal_muscle_kg, "mass", unit)}</td><td class="num">${show(s.visceral_fat_level, "level")}</td><td><button class="small ghost danger" data-del="${esc(s.id)}">Delete</button></td></tr>`).join("")}
      </tbody></table></div>
    </div>` : ""}
  </div>`;

  if (scans.length >= 2) {
    const asc = [...scans].reverse();
    lineChart($("#bf-chart", root), [{ label: "Body fat", data: asc.filter((s) => s.body_fat_pct != null).map((s) => ({ x: s.date, y: s.body_fat_pct })) }], { unit: "%", digits: 1 });
    lineChart(
      $("#mass-chart", root),
      [
        { label: "Skeletal muscle", data: asc.filter((s) => s.skeletal_muscle_kg != null).map((s) => ({ x: s.date, y: +fit.fromKg(s.skeletal_muscle_kg, unit).toFixed(1) })) },
        { label: "Fat mass", data: asc.filter((s) => s.fat_mass_kg != null).map((s) => ({ x: s.date, y: +fit.fromKg(s.fat_mass_kg, unit).toFixed(1) })) },
      ],
      { unit, digits: 1 },
    );
  }

  $("#read-scan", root)?.addEventListener("click", (e) => {
    const files = $("#scan-files", root).files;
    if (!files.length) return toast("Choose your Evolt PDF or screenshots first.", "error");
    busy(e.currentTarget, async () => {
      pending = await readEvoltScan(files);
      renderBody(root);
    });
  });
  $("#manual", root)?.addEventListener("click", () => { pending = { segmental: [] }; renderBody(root); });
  $("#discard", root)?.addEventListener("click", () => { pending = null; renderBody(root); });

  $("#review", root)?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const scan = { id: store.uid(), date: f.get("date"), segmental: pending.segmental || [], analysis_md: pending.analysis_md || "" };
    for (const [k] of METRICS) scan[k] = f.get(k) === "" ? null : Number(f.get(k));
    busy(e.submitter, async () => {
      await store.update("scans", (s) => [...s.filter((x) => x.date !== scan.date), scan], `Evolt scan ${scan.date}`);
      pending = null;
      toast("Scan saved ✓ Your nutrition targets now use it.");
      renderBody(root);
    });
  });

  $$("[data-del]", root).forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Delete this scan?")) return;
      busy(b, async () => {
        await store.update("scans", (s) => s.filter((x) => x.id !== b.dataset.del), "Delete scan");
        renderBody(root);
      });
    }),
  );
}
