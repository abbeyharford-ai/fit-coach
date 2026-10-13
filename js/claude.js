// Everything that talks to Claude: coach chat (with tools), Evolt scan reading,
// meal plans. Uses the official Anthropic TypeScript SDK straight from the
// browser with your own API key (stored only in this browser).

import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm";
import * as store from "./store.js";
import * as fit from "./fitness.js";

// Server-side fallback: if a safety classifier ever declines a request, the API
// retries it on a recommended fallback model instead of failing.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

function client() {
  const { anthropicKey } = store.getSettings();
  if (!anthropicKey) throw new Error("Add your Anthropic API key in Settings first.");
  return new Anthropic({ apiKey: anthropicKey, dangerouslyAllowBrowser: true });
}

const model = () => store.getSettings().model || "claude-sonnet-5-5";

function textOf(msg) {
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

function checkStop(msg) {
  if (msg.stop_reason === "refusal") throw new Error("Claude declined this request. Try rephrasing.");
  if (msg.stop_reason === "max_tokens") throw new Error("The response was cut off (hit max_tokens). Try asking for less at once.");
}

// ---------------------------------------------------------------- context

export const TRAINER_PERSONA = `You are the user's personal trainer and nutrition coach, living inside their fitness app. You hold the knowledge of an experienced certified strength coach and sports dietitian, and you coach like a great in-person trainer: specific, encouraging, honest, and focused on what to do next.

Their goal: a body recomposition (lose fat while keeping or building muscle) in time for summer.

How you work:
- Ground advice in their actual data (Garmin recovery and activity, logged lifts and PRs, Evolt body scans, water, nutrition targets). Quote the numbers you are using.
- Programming: favor progressive overload on compound lifts, 10-20 hard sets per muscle per week, 1-3 reps in reserve on most sets. Adjust intensity to recovery (sleep, HRV, body battery, resting HR trends).
- Nutrition for recomp: modest deficit, high protein spread over 3-5 meals, mostly whole foods, no crash dieting.
- When they tell you about a workout they did, log it with the log_workout tool (ask only if something essential is missing, like weight or reps). When they say they drank water, log it with log_water. Celebrate PRs the tool reports.
- Keep replies tight: short paragraphs or brief lists, no filler. Use markdown.
- You are not a doctor. For pain beyond normal soreness, dizziness, disordered-eating signs, or medical conditions and medications, say so plainly and suggest a professional.`;

function compactWorkouts(workouts, since) {
  return workouts
    .filter((w) => w.date >= since)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => `${w.date} ${w.title || "Workout"} [${w.unit}]: ` + (w.exercises || []).map((e) => `${e.name} ${(e.sets || []).map((s) => `${s.reps}x${s.weight}`).join(",")}`).join("; "))
    .join("\n") || "(none)";
}

/** A data snapshot for the coach. Built once per conversation so the prompt stays cacheable. */
export function buildSnapshot() {
  const profile = store.data("profile");
  const scans = store.data("scans");
  const garmin = store.data("garmin");
  const workouts = store.data("workouts");
  const unit = profile.units || "lb";
  const d = fit.today(profile.timezone);
  const prs = [...fit.computePRs(workouts).values()]
    .filter((p) => p.bestE1rm)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 15)
    .map((p) => `${p.name}: e1RM ${fit.fromKg(p.bestE1rm.kg, unit).toFixed(0)} ${unit} (${p.bestE1rm.date}), heaviest ${fit.fromKg(p.heaviest.kg, unit).toFixed(0)}x${p.heaviest.reps}, ${p.sessions} sessions`);
  const sortedScans = [...scans].sort((a, b) => a.date.localeCompare(b.date)).slice(-4).map(({ analysis_md, id, ...rest }) => rest);
  const targets = fit.nutritionTargets(profile, scans, garmin, d);
  const plan = store.data("meal_plans")[0];
  const checkin = store.data("checkins").slice(-1)[0];
  const since14 = fit.addDays(d, -14);

  return `<athlete_data as_of="${d}">
<profile>${JSON.stringify(profile)}</profile>
<days_until_summer_target>${fit.daysUntil(profile.summer_target_date, d) ?? "unknown"}</days_until_summer_target>
<evolt_scans oldest_to_newest="true">${JSON.stringify(sortedScans)}</evolt_scans>
<nutrition_targets>${JSON.stringify(targets)}</nutrition_targets>
<garmin_daily_last_14_days>${JSON.stringify((garmin.daily || []).filter((x) => x.date >= since14))}</garmin_daily_last_14_days>
<garmin_activities_last_14_days>${JSON.stringify((garmin.activities || []).filter((a) => a.date >= since14).map(({ sets, ...a }) => a))}</garmin_activities_last_14_days>
<lifting_log_last_28_days>
${compactWorkouts(workouts, fit.addDays(d, -28))}
</lifting_log_last_28_days>
<personal_records>
${prs.join("\n") || "(none yet)"}
</personal_records>
<current_meal_plan created="${plan?.created_at || ""}">${plan ? plan.plan_md.slice(0, 2500) : "(none)"}</current_meal_plan>
<latest_morning_checkin>${checkin ? `${checkin.date}: ${checkin.message}` : "(none)"}</latest_morning_checkin>
</athlete_data>`;
}

/** Small, fresh facts attached to each user turn (the snapshot above is frozen per conversation). */
export function liveUpdate() {
  const profile = store.data("profile");
  const d = fit.today(profile.timezone);
  const water = fit.waterToday(store.data("water"), d);
  const target = fit.waterTarget(profile, store.data("scans"), store.data("garmin"), store.data("workouts"), d);
  const time = new Date().toLocaleString("en-US", { timeZone: profile.timezone || undefined, weekday: "long", hour: "numeric", minute: "2-digit" });
  const todays = store.data("workouts").filter((w) => w.date === d).map((w) => w.title || "workout");
  return `<live_update>Now: ${time} (${d}). Water so far today: ${water} of ${target} ml. Workouts logged today: ${todays.join(", ") || "none"}.</live_update>`;
}

// ---------------------------------------------------------------- chat tools

const TOOLS = [
  {
    name: "log_workout",
    description: "Save a strength workout the user describes to their training log. Returns any new personal records. Use the user's units unless they state otherwise.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; today unless the user says otherwise" },
        title: { type: "string", description: "Short session name, e.g. 'Upper A' or 'Legs'" },
        unit: { type: "string", enum: ["lb", "kg"] },
        exercises: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Standard exercise name, e.g. 'Bench Press', 'Back Squat', 'Romanian Deadlift'" },
              sets: {
                type: "array",
                items: {
                  type: "object",
                  properties: { reps: { type: "integer" }, weight: { type: "number", description: "Load per set; 0 for bodyweight" } },
                  required: ["reps", "weight"],
                },
              },
            },
            required: ["name", "sets"],
          },
        },
        notes: { type: "string" },
      },
      required: ["date", "unit", "exercises"],
    },
  },
  {
    name: "log_water",
    description: "Add water the user drank today. Returns the new total and today's target.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { ml: { type: "integer", description: "Millilitres (1 cup ≈ 240 ml, 1 fl oz ≈ 30 ml)" } },
      required: ["ml"],
    },
  },
];

function validWorkout(i) {
  return (
    i && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && ["lb", "kg"].includes(i.unit) && Array.isArray(i.exercises) && i.exercises.length &&
    i.exercises.every((e) => typeof e.name === "string" && Array.isArray(e.sets) && e.sets.every((s) => Number.isFinite(s.reps) && Number.isFinite(s.weight)))
  );
}

async function runTool(name, input) {
  if (name === "log_workout") {
    if (!validWorkout(input)) return { error: "Invalid workout input: need date (YYYY-MM-DD), unit (lb|kg), and exercises with numeric reps and weight." };
    const workout = { id: store.uid(), date: input.date, title: input.title || "Workout", unit: input.unit, exercises: input.exercises, notes: input.notes || "", source: "coach" };
    const all = await store.update("workouts", (ws) => [...ws, workout], `Log workout ${workout.date} (coach)`);
    return { saved: true, workout_id: workout.id, new_records: fit.newPRsFor(workout, all).map((p) => p.text) };
  }
  if (name === "log_water") {
    const ml = Number(input?.ml);
    if (!Number.isFinite(ml) || ml <= 0 || ml > 3000) return { error: "ml must be between 1 and 3000" };
    const profile = store.data("profile");
    const d = fit.today(profile.timezone);
    const time = new Date().toLocaleTimeString("en-GB", { timeZone: profile.timezone || undefined, hour: "2-digit", minute: "2-digit" });
    const water = await store.update("water", (w) => ({ ...w, [d]: [...(w[d] || []), { t: time, ml }] }), `Water +${ml} ml`);
    return { total_ml: fit.waterToday(water, d), target_ml: fit.waterTarget(profile, store.data("scans"), store.data("garmin"), store.data("workouts"), d) };
  }
  return { error: `Unknown tool ${name}` };
}

/**
 * Run one coach turn. `convo` = { system, messages } (persisted by the caller).
 * Appends to convo.messages in place, append-only. Calls onText(delta) while
 * streaming and onTool(name, result) after each tool runs.
 */
export async function chatTurn(convo, userText, { onText, onTool } = {}) {
  const c = client();
  convo.messages.push({ role: "user", content: [{ type: "text", text: liveUpdate() }, { type: "text", text: userText }] });
  for (let step = 0; step < 6; step++) {
    const stream = c.beta.messages.stream({
      model: model(),
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: [
        { type: "text", text: TRAINER_PERSONA },
        { type: "text", text: convo.system },
      ],
      tools: TOOLS,
      messages: convo.messages,
    });
    stream.on("text", (t) => onText?.(t));
    const msg = await stream.finalMessage();
    convo.messages.push({ role: "assistant", content: msg.content });
    checkStop(msg);
    if (msg.stop_reason === "pause_turn") continue;
    if (msg.stop_reason !== "tool_use") return;

    const results = [];
    for (const block of msg.content.filter((b) => b.type === "tool_use")) {
      let result;
      try {
        result = await runTool(block.name, block.input);
      } catch (e) {
        result = { error: e.message };
      }
      onTool?.(block.name, result);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result), ...(result.error ? { is_error: true } : {}) });
    }
    convo.messages.push({ role: "user", content: results });
    onText?.("\n\n");
  }
}

// ---------------------------------------------------------------- Evolt scans

const num = { type: ["number", "null"] };
const SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    date: { type: ["string", "null"], description: "Scan date YYYY-MM-DD if printed on the report" },
    weight_kg: num,
    body_fat_pct: num,
    fat_mass_kg: num,
    lean_mass_kg: num,
    skeletal_muscle_kg: num,
    visceral_fat_level: num,
    bmr_kcal: num,
    total_body_water_l: num,
    protein_kg: num,
    mineral_kg: num,
    biological_age: num,
    segmental: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { segment: { type: "string" }, lean_kg: num, fat_kg: num },
        required: ["segment", "lean_kg", "fat_kg"],
      },
    },
    analysis_md: { type: "string" },
  },
  required: ["date", "weight_kg", "body_fat_pct", "fat_mass_kg", "lean_mass_kg", "skeletal_muscle_kg", "visceral_fat_level", "bmr_kcal", "total_body_water_l", "protein_kg", "mineral_kg", "biological_age", "segmental", "analysis_md"],
};

async function fileToBlock(file) {
  const b64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  if (file.type === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } };
  const media = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) ? file.type : "image/jpeg";
  return { type: "image", source: { type: "base64", media_type: media, data: b64 } };
}

/** Read an Evolt 360 report (PDF and/or screenshots). Returns the parsed SCAN_SCHEMA object. */
export async function readEvoltScan(files) {
  const profile = store.data("profile");
  const previous = [...store.data("scans")].sort((a, b) => a.date.localeCompare(b.date)).slice(-3).map(({ analysis_md, id, ...rest }) => rest);
  const blocks = await Promise.all([...files].map(fileToBlock));
  const msg = await client().beta.messages.create({
    model: model(),
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "high", format: { type: "json_schema", schema: SCAN_SCHEMA } },
    system: TRAINER_PERSONA,
    messages: [
      {
        role: "user",
        content: [
          ...blocks,
          {
            type: "text",
            text: `These are pages/screenshots of my Evolt 360 body composition scan.

1. Extract the measurements exactly as printed. Convert lb to kg (÷ 2.20462) if the report uses pounds. Use null for anything not shown; never guess. "Lean mass" means fat-free mass / lean body mass; "skeletal muscle" means skeletal muscle mass. Include segmental lean/fat per limb and trunk if present.
2. In analysis_md, read the scan like my personal trainer would, in markdown: the 3-5 numbers that matter most for my recomp goal and what they mean in plain English; what changed vs my previous scans (below) and whether that's fat or muscle; any imbalances (e.g. left vs right); healthy reference ranges where relevant (visceral fat, body fat for my sex and age); and 3 concrete priorities for the next 4-6 weeks of training and eating. Be honest and encouraging. Keep it under 400 words.

My profile: ${JSON.stringify({ sex: profile.sex, birth_year: profile.birth_year, height_cm: profile.height_cm, goal: profile.goal })}
Previous scans (oldest to newest): ${JSON.stringify(previous)}`,
          },
        ],
      },
    ],
  });
  checkStop(msg);
  return JSON.parse(textOf(msg));
}

// ---------------------------------------------------------------- meal plans

export async function generateMealPlan(prefs, targets, onText) {
  const profile = store.data("profile");
  const stream = client().beta.messages.stream({
    model: model(),
    max_tokens: 32000,
    ...FALLBACK,
    output_config: { effort: "medium" },
    system: TRAINER_PERSONA,
    messages: [
      {
        role: "user",
        content: `Build me a ${prefs.days}-day meal plan for my recomp.

Daily targets: ${targets.kcal} kcal, ${targets.protein_g} g protein, ${targets.carbs_g} g carbs, ${targets.fat_g} g fat (within ~5% is fine).
Meals per day: ${prefs.meals}. Diet style: ${prefs.style || "no restrictions"}. Avoid / allergies: ${prefs.avoid || "none"}.
Cooking: ${prefs.cooking || "simple"}. Budget: ${prefs.budget || "moderate"}. Training days: put more carbs around training.
Other notes: ${[prefs.notes, profile.diet_notes].filter(Boolean).join(". ") || "none"}

Format in markdown:
- One "## Day N" section per day with a table per day: Meal | Food & portions (grams or household measures) | kcal | P | C | F, then a daily total row.
- Reuse ingredients and allow leftovers so shopping and prep stay realistic.
- After the days: "## Grocery list" grouped by store section with total quantities, then "## Prep tips" (3-5 bullets for batch cooking).
Do not add an intro paragraph.`,
      },
    ],
  });
  stream.on("text", (t) => onText?.(t));
  const msg = await stream.finalMessage();
  checkStop(msg);
  return textOf(msg);
}
