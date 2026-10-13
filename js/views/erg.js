import * as store from "../store.js";
import * as fit from "../fitness.js";
import * as erg from "../erg.js";
import { $, $$, esc, fmt, fmtDate, toast, busy, lineChart } from "../ui.js";

let draft = null; // survives tab switches within the session

function blankDraft(date) {
  return { date, machine: "row", title: "", pieces: [{ distance: "", time: "", rate: "" }], avg_hr: "", drag: "", notes: "", garmin_id: null };
}

function splitText(machine, distance, time) {
  const sp = erg.split(machine, Number(distance), erg.parseTime(time));
  if (!Number.isFinite(sp)) return "";
  const w = erg.watts(machine, Number(distance), erg.parseTime(time));
  return `${erg.formatTime(sp)} /${erg.MACHINES[machine].splitM === 1000 ? "1k" : "500"} · ${Math.round(w)} W`;
}

function pieceRow(p, i, machine) {
  return `<div class="piece-row" data-piece="${i}">
    <span class="idx">${i + 1}</span>
    <input type="number" inputmode="numeric" placeholder="metres" data-k="distance" value="${esc(p.distance)}" aria-label="Distance in metres">
    <input inputmode="decimal" placeholder="m:ss.t" data-k="time" value="${esc(p.time)}" aria-label="Time">
    <input type="number" inputmode="numeric" placeholder="spm" data-k="rate" value="${esc(p.rate)}" aria-label="Stroke rate">
    <button type="button" class="ghost small" data-del-piece aria-label="Remove piece">✕</button>
    <span class="piece-split">${splitText(machine, p.distance, p.time)}</span>
  </div>`;
}

const GARMIN_ERG_TYPES = /row|ski|indoor_cycling|indoor_cardio/;

/** The erg half of the Train tab. `header` is the shared Lifting/Erg toggle HTML; `afterRender` re-binds it. */
export function renderErgLog(root, header, afterRender) {
  const profile = store.data("profile");
  const d = fit.today(profile.timezone);
  draft ??= blankDraft(d);
  const ergs = [...store.data("ergs")].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const prs = erg.computeErgPRs(ergs);
  const prIds = new Set([...prs.values()].map((p) => p.best.id));
  const logged = new Set(ergs.map((e) => String(e.garmin_id)));
  const garminActs = (store.data("garmin").activities || []).filter((a) => GARMIN_ERG_TYPES.test(a.type || "") && !logged.has(String(a.id))).slice(0, 10);
  const m = erg.MACHINES[draft.machine];

  root.innerHTML = `
  <div class="stack">
    ${header}
    <form class="card" id="erg-log">
      <div class="spread"><h2>Log an erg session</h2>
        <div class="seg" role="group" aria-label="Machine">${Object.entries(erg.MACHINES).map(([k, v]) => `<button type="button" data-machine="${k}" class="${draft.machine === k ? "on" : ""}">${v.label}</button>`).join("")}</div>
      </div>
      ${garminActs.length ? `<div class="field"><label>Fill from Garmin</label><select id="from-garmin"><option value="">Choose a recorded session…</option>${garminActs.map((a) => `<option value="${esc(a.id)}">${fmtDate(a.date)} · ${esc(a.name || a.type)} · ${fmt(a.duration_min)} min${a.distance_km ? ` · ${fmt(a.distance_km * 1000)} m` : ""}</option>`).join("")}</select></div>` : ""}
      <div class="fields">
        <div class="field"><label>Date</label><input type="date" name="date" value="${esc(draft.date)}"></div>
        <div class="field"><label>Session</label><input name="title" placeholder="2k test, 8×500m, steady 30'…" value="${esc(draft.title)}"></div>
      </div>
      <div class="piece-row piece-head"><span></span><span class="label">Distance (m)</span><span class="label">Time</span><span class="label">Rate</span><span></span></div>
      <div id="pieces">${draft.pieces.map((p, i) => pieceRow(p, i, draft.machine)).join("")}</div>
      <div class="row" style="margin-top:10px">
        <button type="button" class="small" id="add-piece">+ Piece</button>
        <button type="button" class="small ghost" id="dup-piece">Repeat last piece</button>
        <span class="small muted">One piece = a ranked test (2k, 5k, 30:00…). Several = intervals.</span>
      </div>
      <div class="fields" style="margin-top:14px">
        <div class="field"><label>Avg heart rate</label><input type="number" name="avg_hr" value="${esc(draft.avg_hr)}" placeholder="optional"></div>
        <div class="field"><label>Drag factor</label><input type="number" name="drag" value="${esc(draft.drag)}" placeholder="optional"></div>
      </div>
      <div class="field"><label>Notes</label><textarea name="notes" placeholder="Rest between pieces, how it felt, damper setting…">${esc(draft.notes)}</textarea></div>
      <div class="row"><button class="primary" type="submit">Save session</button><button type="button" class="ghost" id="erg-clear">Clear</button></div>
    </form>

    <div class="card">
      <h2>Recent erg sessions</h2>
      ${ergs.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Session</th><th>Distance</th><th>Time</th><th>Split</th><th>Watts</th><th></th></tr></thead>
        <tbody>${ergs.slice(0, 20).map((e) => {
          const t = erg.totals(e);
          return `<tr>
            <td class="num">${fmtDate(e.date)}</td>
            <td>${esc(erg.MACHINES[e.machine]?.label || e.machine)}${e.title ? ` · ${esc(e.title)}` : ""}${t.pieces > 1 ? ` <span class="muted small">${t.pieces} pieces</span>` : ""}${prIds.has(e.id) ? ' <span class="pill pr">PR</span>' : ""}</td>
            <td class="num">${fmt(t.distance)} m</td>
            <td class="num">${erg.formatTime(t.time)}</td>
            <td class="num">${erg.formatTime(t.split)}</td>
            <td class="num">${fmt(t.watts)}</td>
            <td><button class="small ghost danger" data-del-erg="${esc(e.id)}">Delete</button></td>
          </tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">No erg sessions yet. Log your first piece above, or tell the Coach “I rowed a 2k in 7:58”.</div>`}
    </div>
  </div>`;

  const form = $("#erg-log", root);
  const readForm = () => {
    const f = new FormData(form);
    for (const k of ["date", "title", "avg_hr", "drag", "notes"]) draft[k] = f.get(k);
    draft.pieces = $$(".piece-row[data-piece]", form).map((r) => ({ distance: $("[data-k=distance]", r).value, time: $("[data-k=time]", r).value, rate: $("[data-k=rate]", r).value }));
  };
  const again = () => renderErgLog(root, header, afterRender);
  afterRender?.();

  // Live split/watts per piece without re-rendering (keeps the cursor where it is).
  form.addEventListener("input", (e) => {
    readForm();
    const row = e.target.closest(".piece-row[data-piece]");
    if (row) {
      const p = draft.pieces[Number(row.dataset.piece)];
      $(".piece-split", row).textContent = splitText(draft.machine, p.distance, p.time);
    }
  });

  form.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.machine) { readForm(); draft.machine = b.dataset.machine; again(); }
    else if (b.id === "add-piece") { readForm(); draft.pieces.push({ distance: "", time: "", rate: "" }); again(); }
    else if (b.id === "dup-piece") { readForm(); draft.pieces.push({ ...draft.pieces.at(-1) }); again(); }
    else if (b.hasAttribute("data-del-piece")) { readForm(); draft.pieces.splice(Number(b.closest(".piece-row").dataset.piece), 1); if (!draft.pieces.length) draft.pieces.push({ distance: "", time: "", rate: "" }); again(); }
    else if (b.id === "erg-clear") { draft = blankDraft(d); again(); }
  });

  $("#from-garmin", root)?.addEventListener("change", (e) => {
    const a = garminActs.find((x) => String(x.id) === e.target.value);
    if (!a) return;
    readForm();
    draft.date = a.date;
    draft.machine = /ski/.test(a.type) ? "ski" : /cycl/.test(a.type) ? "bike" : "row";
    draft.title ||= a.name || "";
    draft.pieces = [{ distance: a.distance_km ? String(Math.round(a.distance_km * 1000)) : "", time: erg.formatTime(a.duration_min * 60), rate: "" }];
    draft.avg_hr = a.avg_hr || "";
    draft.garmin_id = a.id;
    again();
    toast("Filled from Garmin. Check the distance and time, then save.");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    readForm();
    const pieces = draft.pieces
      .map((p) => ({ distance_m: Number(p.distance), time_s: erg.parseTime(p.time), ...(Number(p.rate) ? { rate: Number(p.rate) } : {}) }))
      .filter((p) => p.distance_m > 0 && p.time_s > 0);
    const bad = draft.pieces.find((p) => p.time && !Number.isFinite(erg.parseTime(p.time)));
    if (bad) return toast(`Couldn't read the time “${bad.time}”. Use m:ss or m:ss.t, like 7:45.2.`, "error");
    if (!pieces.length) return toast("Add at least one piece with a distance and a time.", "error");
    const session = {
      id: store.uid(), date: draft.date || d, machine: draft.machine, title: draft.title.trim(), pieces,
      ...(Number(draft.avg_hr) ? { avg_hr: Number(draft.avg_hr) } : {}),
      ...(Number(draft.drag) ? { drag: Number(draft.drag) } : {}),
      notes: draft.notes.trim(), source: draft.garmin_id ? "garmin" : "manual", ...(draft.garmin_id ? { garmin_id: draft.garmin_id } : {}),
    };
    busy(e.submitter, async () => {
      const all = await store.update("ergs", (xs) => [...xs, session], `Log erg ${session.date}`);
      toast("Erg session saved ✓");
      erg.newErgPRs(session, all).filter((p) => p.kind === "pr").forEach((p) => toast(`🏆 ${p.text}`, "pr"));
      draft = null;
      again();
    });
  });

  $$("[data-del-erg]", root).forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Delete this erg session?")) return;
      busy(b, async () => {
        await store.update("ergs", (xs) => xs.filter((x) => x.id !== b.dataset.delErg), "Delete erg session");
        again();
      });
    }),
  );
}

// ---------------------------------------------------------------- erg PRs

let selected = null;

export function renderErgPRs(container) {
  const prs = erg.computeErgPRs(store.data("ergs"));
  if (!prs.size) {
    container.innerHTML = `<div class="card"><h2>Erg records</h2><p class="muted">Log a single continuous piece (500m, 2k, 5k, 30:00…) and your erg records appear here.</p></div>`;
    return;
  }
  const keys = [...prs.keys()];
  if (!selected || !prs.has(selected)) selected = prs.has("row|dist|2000") ? "row|dist|2000" : keys[0];
  const byMachine = Object.keys(erg.MACHINES).filter((mk) => keys.some((k) => k.startsWith(mk + "|")));
  const row = (k, p) => {
    const sp = erg.split(p.machine, p.best.distance_m, p.best.time_s);
    return `<tr class="clickable" data-erg-ev="${k}" ${k === selected ? 'style="background:var(--ballet-soft)"' : ""}>
      <td>${erg.eventLabel(p.event, p.kind)}</td>
      <td class="num"><b>${p.kind === "dist" ? erg.formatTime(p.best.time_s) : `${fmt(p.best.distance_m)} m`}</b></td>
      <td class="num">${erg.formatTime(sp)}</td>
      <td class="num">${fmt(erg.watts(p.machine, p.best.distance_m, p.best.time_s))}</td>
      <td class="num">${fmtDate(p.best.date)}</td>
      <td class="num">${p.history.length}</td></tr>`;
  };
  const sel = prs.get(selected);
  container.innerHTML = `
  <div class="stack">
    ${byMachine.map((mk) => `
    <div class="card">
      <h2>${erg.MACHINES[mk].label} records</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Event</th><th>Best</th><th>Split</th><th>Watts</th><th>Date</th><th>Attempts</th></tr></thead>
        <tbody>${keys.filter((k) => k.startsWith(mk + "|")).sort((a, b) => {
          const pa = prs.get(a), pb = prs.get(b);
          return pa.kind === pb.kind ? pa.event - pb.event : pa.kind === "dist" ? -1 : 1;
        }).map((k) => row(k, prs.get(k))).join("")}</tbody>
      </table></div>
    </div>`).join("")}
    <div class="card">
      <h2>${erg.MACHINES[sel.machine].label} ${erg.eventLabel(sel.event, sel.kind)}: every attempt</h2>
      <p class="small muted">${sel.kind === "dist" ? "Lower is faster." : "Higher is further."}</p>
      <div class="chart-box"><canvas id="erg-chart" aria-label="Erg event results over time"></canvas></div>
    </div>
  </div>`;

  const isDist = sel.kind === "dist";
  lineChart(
    $("#erg-chart", container),
    [{ label: isDist ? "Time" : "Distance", data: sel.history.map((h) => ({ x: h.date, y: isDist ? h.time_s : h.distance_m })) }],
    isDist ? { format: (v) => erg.formatTime(v) } : { unit: "m" },
  );
  $$("tr[data-erg-ev]", container).forEach((tr) => tr.addEventListener("click", () => { selected = tr.dataset.ergEv; renderErgPRs(container); }));
}
