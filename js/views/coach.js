import * as store from "../store.js";
import { chatTurn, buildSnapshot } from "../claude.js";
import { $, $$, esc, md, toast } from "../ui.js";

// The conversation is kept exactly as the API returned it (append-only) so
// prompt caching works and thinking blocks stay valid between turns.
const CONVO_KEY = "fitcoach.convo";
const MAX_MESSAGES = 80;

const STARTERS = [
  "What should I train today?",
  "Review my last week. What's working and what isn't?",
  "Build me a 4-day upper/lower split for my recomp",
  "How's my recovery looking?",
  "I just did bench 3x8 at 95 and rows 3x10 at 70",
  "I'm craving sweets at night. Help",
];

function loadConvo() {
  try {
    const c = JSON.parse(localStorage.getItem(CONVO_KEY));
    if (c?.system && Array.isArray(c.messages)) return c;
  } catch {}
  return null;
}

function saveConvo(c) {
  try {
    localStorage.setItem(CONVO_KEY, JSON.stringify(c));
  } catch (e) {
    toast("Chat is too long to save. Start a new chat.", "error");
  }
}

function newConvo() {
  const c = { system: buildSnapshot(), started: new Date().toISOString(), messages: [] };
  saveConvo(c);
  return c;
}

/** Turn API messages into chat bubbles: user text (minus the live_update block), assistant text, tool notes. */
function bubbles(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "user") {
      const texts = m.content.filter((b) => b.type === "text" && !b.text.startsWith("<live_update>"));
      if (texts.length) out.push({ role: "user", text: texts.map((b) => b.text).join("\n") });
      for (const r of m.content.filter((b) => b.type === "tool_result")) {
        try {
          const res = JSON.parse(r.content);
          if (res.saved) out.push({ role: "tool", text: `✓ Workout logged${res.new_records?.length ? " · 🏆 " + res.new_records.join(" · ") : ""}` });
          else if (res.total_ml != null) out.push({ role: "tool", text: `💧 Water: ${res.total_ml} / ${res.target_ml} ml` });
          else if (res.error) out.push({ role: "tool", text: `⚠️ ${res.error}` });
        } catch {}
      }
    } else {
      const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (text.trim()) out.push({ role: "assistant", text });
    }
  }
  return out;
}

function bubbleHtml(b) {
  if (b.role === "assistant") return `<div class="msg assistant"><div class="md">${md(b.text)}</div></div>`;
  return `<div class="msg ${b.role}">${esc(b.text)}</div>`;
}

export function renderCoach(root) {
  let convo = loadConvo() || newConvo();
  const items = bubbles(convo.messages);
  const tooLong = convo.messages.length >= MAX_MESSAGES;

  root.innerHTML = `
  <div class="stack">
    <div class="spread">
      <h1>Coach</h1>
      <button class="small ghost" id="new-chat">New chat</button>
    </div>
    <p class="small muted" style="margin-top:-8px">Your coach sees your Garmin data, lifts, PRs, scans, water and meal plan as of when this chat started. Start a new chat to refresh that.</p>
    <div class="chat" id="chat">
      ${items.length ? items.map(bubbleHtml).join("") : `<div class="msg assistant"><div class="md"><p>Hey! I'm your coach. Tell me what you trained, ask what to do today, or ask me to look at your recovery, scans or nutrition.</p></div></div>`}
    </div>
    ${items.length ? "" : `<div class="chips">${STARTERS.map((s) => `<button class="small" data-starter="${esc(s)}">${esc(s)}</button>`).join("")}</div>`}
    ${tooLong ? `<div class="card accent">This chat is getting long. Start a new chat to keep your coach fast and up to date.</div>` : ""}
    <form class="chat-input" id="chat-form">
      <textarea name="q" placeholder="Message your coach…" rows="1" ${tooLong ? "disabled" : ""}></textarea>
      <button class="primary" type="submit" ${tooLong ? "disabled" : ""}>Send</button>
    </form>
  </div>`;

  const chat = $("#chat", root);
  const form = $("#chat-form", root);
  const ta = form.q;
  window.scrollTo(0, document.body.scrollHeight);

  $("#new-chat", root).addEventListener("click", () => { newConvo(); renderCoach(root); });
  $$("[data-starter]", root).forEach((b) => b.addEventListener("click", () => { ta.value = b.dataset.starter; form.requestSubmit(); }));
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = ta.value.trim();
    if (!q) return;
    ta.value = "";
    const btn = form.querySelector("button");
    btn.disabled = ta.disabled = true;
    $(".chips", root)?.remove();
    chat.insertAdjacentHTML("beforeend", bubbleHtml({ role: "user", text: q }));
    let live = document.createElement("div");
    live.className = "msg assistant";
    live.innerHTML = `<span class="spinner"></span>`;
    chat.append(live);
    let text = "";
    let frame = false;
    const paint = () => {
      frame = false;
      live.innerHTML = `<div class="md">${md(text)}</div>`;
      window.scrollTo(0, document.body.scrollHeight);
    };
    const before = structuredClone(convo.messages);
    try {
      await chatTurn(convo, q, {
        onText: (t) => { text += t; if (!frame) { frame = true; requestAnimationFrame(paint); } },
        onTool: (name, res) => {
          const note = document.createElement("div");
          note.className = "msg tool";
          note.textContent = name === "log_workout"
            ? (res.saved ? `✓ Workout logged${res.new_records?.length ? " · 🏆 " + res.new_records.join(" · ") : ""}` : `⚠️ ${res.error}`)
            : res.total_ml != null ? `💧 Water: ${res.total_ml} / ${res.target_ml} ml` : `⚠️ ${res.error}`;
          chat.insertBefore(note, live);
        },
      });
      saveConvo(convo);
    } catch (err) {
      console.error(err);
      // Roll back this turn so the saved history never contains a half-finished exchange.
      convo.messages = before;
      saveConvo(convo);
      toast(err.message || String(err), "error");
    }
    renderCoach(root);
  });
}
