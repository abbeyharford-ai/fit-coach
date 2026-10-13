import { marked } from "https://cdn.jsdelivr.net/npm/marked@14.1.4/+esm";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify@3.1.7/+esm";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function md(text) {
  return DOMPurify.sanitize(marked.parse(text || ""));
}

export function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), kind === "error" ? 7000 : 4000);
}

/** Run an async action with a button showing a spinner; errors become toasts. */
export async function busy(button, fn) {
  const label = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> ${label}`;
  }
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = label;
    }
  }
}

export function fmtDate(iso, opts = { month: "short", day: "numeric" }) {
  if (!iso) return "";
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, opts);
}

/** Load display: 92.5 stays 92.5, 135 stays 135. */
export const fmtLoad = (n) => (n == null || Number.isNaN(n) ? "—" : Number(Number(n).toFixed(1)).toLocaleString());

export const fmt = (n, digits = 0) => (n == null || Number.isNaN(n) ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));

// ---------------------------------------------------------------- charts

const charts = new WeakMap();
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Single-measure line chart (one y-axis, always). series: [{label, data:[{x,y}], color?}]
 */
export function lineChart(canvas, series, { unit = "", digits = 0, format = null } = {}) {
  const show = format || ((v) => `${fmt(v, digits)} ${unit}`.trim());
  charts.get(canvas)?.destroy();
  const grid = css("--border");
  const ink = css("--text-2");
  const palette = [css("--series-1"), css("--series-2"), css("--series-3")];
  Chart.defaults.font.family = css("--sans");
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color || palette[i],
        backgroundColor: s.color || palette[i],
        borderWidth: 2,
        pointRadius: s.data.length > 40 ? 0 : 3,
        pointHoverRadius: 5,
        tension: 0.25,
        spanGaps: true,
      })),
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { type: "category", labels: [...new Set(series.flatMap((s) => s.data.map((p) => p.x)))].sort(), grid: { display: false }, ticks: { color: ink, maxTicksLimit: 7, callback(v) { return fmtDate(this.getLabelForValue(v)); } } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: ink, maxTicksLimit: 5, ...(format ? { callback: (v) => format(v) } : {}) } },
      },
      plugins: {
        legend: { display: series.length > 1, labels: { color: ink, boxWidth: 7, boxHeight: 7, usePointStyle: true, padding: 16 } },
        tooltip: { callbacks: { title: (items) => fmtDate(items[0].label, { weekday: "short", month: "short", day: "numeric" }), label: (c) => `${c.dataset.label}: ${show(c.parsed.y)}` } },
      },
    },
  });
  charts.set(canvas, chart);
  return chart;
}

/** Daily bars with an optional dashed goal line (one measure, one axis). data: [{x: date, y}] */
export function barChart(canvas, data, { label = "", goal = null, unit = "" } = {}) {
  charts.get(canvas)?.destroy();
  const ink = css("--text-2");
  Chart.defaults.font.family = css("--sans");
  const datasets = [{ type: "bar", label, data: data.map((p) => p.y), backgroundColor: css("--series-1"), borderRadius: 4, borderSkipped: "start", maxBarThickness: 18, categoryPercentage: 0.8 }];
  if (goal) datasets.push({ type: "line", label: "Goal", data: data.map(() => goal), borderColor: css("--text-2"), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0 });
  const chart = new Chart(canvas, {
    data: { labels: data.map((p) => p.x), datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink, maxTicksLimit: 7, callback(v) { return fmtDate(this.getLabelForValue(v), { weekday: "narrow" }); } } },
        y: { beginAtZero: true, grid: { color: css("--line") }, border: { display: false }, ticks: { color: ink, maxTicksLimit: 4 } },
      },
      plugins: {
        legend: { display: Boolean(goal), labels: { color: ink, boxWidth: 7, boxHeight: 7, usePointStyle: true, padding: 16 } },
        tooltip: { callbacks: { title: (items) => fmtDate(items[0].label, { weekday: "short", month: "short", day: "numeric" }), label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} ${unit}`.trim() } },
      },
    },
  });
  charts.set(canvas, chart);
  return chart;
}
