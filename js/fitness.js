// Pure training/nutrition math. No network, no DOM.

export const LB_PER_KG = 2.20462;

export function today(tz) {
  // YYYY-MM-DD in the profile's timezone (falls back to the browser's).
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined }).format(new Date());
}

export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const toKg = (w, unit) => (unit === "kg" ? w : w / LB_PER_KG);
export const fromKg = (kg, unit) => (unit === "kg" ? kg : kg * LB_PER_KG);

export function normName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Estimated 1-rep max (Epley). Sets above 12 reps are too noisy to count.
export function e1rm(weight, reps) {
  if (!weight || !reps || reps > 12) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/**
 * Personal records per exercise, in kg internally.
 * Returns Map<normName, {name, bestE1rm:{kg,date,reps,weightKg}, heaviest:{kg,reps,date},
 *                        repMax:{[reps]:{kg,date}}, history:[{date,e1rmKg}], sessions}>
 */
export function computePRs(workouts) {
  const prs = new Map();
  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date));
  for (const w of sorted) {
    for (const ex of w.exercises || []) {
      const key = normName(ex.name);
      if (!key) continue;
      let p = prs.get(key);
      if (!p) {
        p = { name: ex.name.trim(), bestE1rm: null, heaviest: null, repMax: {}, history: [], sessions: 0 };
        prs.set(key, p);
      }
      p.sessions++;
      let sessionBest = 0;
      for (const s of ex.sets || []) {
        const kg = toKg(Number(s.weight) || 0, w.unit);
        const reps = Number(s.reps) || 0;
        if (!kg || !reps) continue;
        const est = e1rm(kg, reps);
        sessionBest = Math.max(sessionBest, est);
        if (est && (!p.bestE1rm || est > p.bestE1rm.kg + 1e-6)) p.bestE1rm = { kg: est, date: w.date, reps, weightKg: kg };
        if (!p.heaviest || kg > p.heaviest.kg + 1e-6) p.heaviest = { kg, reps, date: w.date };
        if (!p.repMax[reps] || kg > p.repMax[reps].kg + 1e-6) p.repMax[reps] = { kg, date: w.date };
      }
      const lastH = p.history.at(-1);
      if (sessionBest && lastH?.date === w.date) lastH.e1rmKg = Math.max(lastH.e1rmKg, sessionBest);
      else if (sessionBest) p.history.push({ date: w.date, e1rmKg: sessionBest });
    }
  }
  return prs;
}

/** PRs that `workout` set, compared with every workout before it. */
export function newPRsFor(workout, allWorkouts) {
  const before = computePRs(allWorkouts.filter((w) => w.id !== workout.id && w.date <= workout.date));
  const out = [];
  for (const ex of workout.exercises || []) {
    const prev = before.get(normName(ex.name));
    let bestSet = null;
    for (const s of ex.sets || []) {
      const kg = toKg(Number(s.weight) || 0, workout.unit);
      const reps = Number(s.reps) || 0;
      const est = e1rm(kg, reps);
      if (!bestSet || est > bestSet.est) bestSet = { est, kg, reps, weight: s.weight };
    }
    if (!bestSet || !bestSet.kg) continue;
    if (!prev) {
      out.push({ exercise: ex.name, kind: "first", text: `First logged ${ex.name}: ${bestSet.weight} × ${bestSet.reps}` });
    } else if (prev.bestE1rm && bestSet.est > prev.bestE1rm.kg + 0.01) {
      out.push({ exercise: ex.name, kind: "e1rm", text: `${ex.name} PR: ${bestSet.weight} × ${bestSet.reps}` });
    } else if (prev.heaviest && bestSet.kg > prev.heaviest.kg + 0.01) {
      out.push({ exercise: ex.name, kind: "heaviest", text: `${ex.name} heaviest ever: ${bestSet.weight}` });
    }
  }
  return out;
}

export function latestScan(scans) {
  return [...scans].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

export function bodyWeightKg(profile, scans) {
  const s = [...scans].filter((x) => x.weight_kg).sort((a, b) => b.date.localeCompare(a.date))[0];
  return s?.weight_kg || Number(profile.weight_kg) || 70;
}

/** Daily water goal (ml). Keep in sync with water_target_ml() in the data repo's scripts/common.py. */
export function waterTarget(profile, scans, garmin, workouts, date) {
  let ml = 35 * bodyWeightKg(profile, scans);
  const activeMin = (garmin.activities || []).filter((a) => a.date === date).reduce((t, a) => t + (a.duration_min || 0), 0);
  ml += 12 * activeMin;
  if (workouts.some((w) => w.date === date) && activeMin === 0) ml += 500;
  return Math.round(ml / 250) * 250;
}

export function waterToday(water, date) {
  return (water[date] || []).reduce((t, e) => t + (e.ml || 0), 0);
}

function age(profile) {
  return profile.birth_year ? new Date().getFullYear() - Number(profile.birth_year) : 30;
}

/** BMR: Evolt's measured value > Katch-McArdle (if lean mass known) > Mifflin-St Jeor. */
export function bmr(profile, scans) {
  const s = latestScan(scans);
  if (s?.bmr_kcal) return { kcal: s.bmr_kcal, source: `Evolt scan (${s.date})` };
  if (s?.lean_mass_kg) return { kcal: Math.round(370 + 21.6 * s.lean_mass_kg), source: "Katch-McArdle from your lean mass" };
  const w = bodyWeightKg(profile, scans);
  const h = Number(profile.height_cm) || 170;
  const k = 10 * w + 6.25 * h - 5 * age(profile) + (profile.sex === "male" ? 5 : -161);
  return { kcal: Math.round(k), source: "Mifflin-St Jeor estimate" };
}

/** Recomp targets: ~10% under maintenance, high protein, moderate fat, carbs fill the rest. */
export function nutritionTargets(profile, scans, garmin, dateToday) {
  const since = addDays(dateToday, -14);
  const days = (garmin.daily || []).filter((d) => d.date >= since && d.date < dateToday && d.total_kcal > 800);
  const b = bmr(profile, scans);
  let tdee, tdeeSource;
  if (days.length >= 5) {
    tdee = days.reduce((t, d) => t + d.total_kcal, 0) / days.length;
    tdeeSource = `Garmin average burn over ${days.length} days`;
  } else {
    const factor = 1.3 + 0.05 * Math.min(6, Number(profile.training_days_per_week) || 3);
    tdee = b.kcal * factor;
    tdeeSource = `BMR (${b.source}) × ${factor.toFixed(2)} activity factor`;
  }
  const goal = profile.goal || "recomp";
  const adj = goal === "cut" ? 0.8 : goal === "bulk" ? 1.08 : 0.9;
  const kcal = Math.round((tdee * adj) / 10) * 10;

  const w = bodyWeightKg(profile, scans);
  const s = latestScan(scans);
  // Protein: 2 g/kg, but base it on lean mass when body fat is high so it isn't inflated.
  let protein = 2.0 * w;
  if (s?.lean_mass_kg && s?.body_fat_pct > 30) protein = 2.6 * s.lean_mass_kg;
  protein = Math.round(protein / 5) * 5;
  const fat = Math.round((0.8 * w) / 5) * 5;
  const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4 / 5) * 5);
  return { kcal, protein_g: protein, fat_g: fat, carbs_g: carbs, tdee: Math.round(tdee), tdeeSource, bmr: b, goal };
}

/** Days until the summer target date. */
export function daysUntil(dateIso, fromIso) {
  if (!dateIso) return null;
  return Math.round((new Date(dateIso + "T12:00:00Z") - new Date(fromIso + "T12:00:00Z")) / 86400000);
}
