/**
 * popup.js — WhatsApp Auto Sender Pro v2
 *
 * Architecture:
 *  - Pure functions for validation and number parsing
 *  - Single refreshUI() function that re-renders from storage state
 *  - Tab system with zero DOM leakage between panels
 *  - Button state driven by storage, not ad-hoc toggles
 *  - No inline event handlers; all wired via addEventListener
 *  - setInterval for live countdown; cleared on popup close via
 *    window.addEventListener("unload") to avoid ghost intervals
 *
 * KEY IMPROVEMENTS OVER v1
 * ────────────────────────────────────────────────────────────────────
 * 1. NUMBER VALIDATION: v1 sent any non-empty line as a phone number.
 *    v2 strips non-digits and checks length (7–15 digits per E.164).
 *    Invalid numbers are shown in red before the user hits Start.
 *
 * 2. BUTTON STATE MACHINE: v1 enabled all buttons unconditionally.
 *    v2 derives enabled/disabled state from storage so buttons are
 *    always consistent even if the popup is closed and reopened mid-run.
 *
 * 3. FAILED NUMBER DISPLAY: v1 had no failed-number UI at all.
 *    v2 shows, copies, and re-queues failed numbers.
 *
 * 4. DELAY CONFIGURATION: v1 hardcoded 30-50s in background.js.
 *    v2 reads from UI inputs and sends to background on Start.
 *
 * 5. CHAR COUNTER + live number count prevent silent user errors.
 *
 * 6. TAB SYSTEM keeps the popup clean; progress is always visible
 *    even when the compose fields are not shown.
 * ────────────────────────────────────────────────────────────────────
 */

// ── Constants (mirror lib/constants.js — popup can't import ES modules) ──
const K = {
  NUMBERS:       "numbers",
  MESSAGE:       "message",
  INDEX:         "index",
  TOTAL:         "total",
  SENT:          "sent",
  FAILED:        "failed",
  FAILED_LIST:   "failedList",
  SENT_LIST:     "sentList",
  REMAINING:     "remaining",
  RUNNING:       "running",
  PAUSED:        "paused",
  NEXT_SEND_TIME:"nextSendTime",
  DELAY_MIN:     "delayMin",
  DELAY_MAX:     "delayMax",
};

// ── DOM helpers ────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

// ── Number validation ──────────────────────────────────────────────────────

/**
 * Parse the textarea: strip whitespace, remove non-digits from each line,
 * return { valid: string[], invalid: string[] }.
 */
function parseNumbers(raw) {
  const lines  = raw.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const valid   = [];
  const invalid = [];
  for (const line of lines) {
    const digits = line.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) {
      valid.push(digits);
    } else if (line.length > 0) {
      invalid.push(line);
    }
  }
  // Deduplicate while preserving order
  const unique = [...new Set(valid)];
  return { valid: unique, invalid };
}

// ── Tab system ────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $(`panel-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── File Import ───────────────────────────────────────────────────────────

on("btn-import", "click", () => $("file-import").click());

on("file-import", "change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target.result;
    const current = $("numbers").value.trim();
    $("numbers").value = current ? current + "\n" + content : content;
    $("numbers").dispatchEvent(new Event("input"));
    $("file-import").value = "";
  };
  reader.readAsText(file);
});

// ── Live input feedback ───────────────────────────────────────────────────

$("numbers").addEventListener("input", () => {
  const { valid, invalid } = parseNumbers($("numbers").value);
  $("num-count").textContent = `${valid.length} number${valid.length !== 1 ? "s" : ""}`;
  const invEl = $("num-invalid");
  if (invalid.length) {
    invEl.textContent  = `${invalid.length} invalid`;
    invEl.style.display = "inline";
  } else {
    invEl.style.display = "none";
  }
});

$("message").addEventListener("input", () => {
  $("char-count").textContent = `${$("message").value.length} characters`;
});

// ── Error display ─────────────────────────────────────────────────────────

function showError(msg) {
  const el = $("compose-error");
  el.textContent    = msg;
  el.style.display  = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

// ── Button actions ────────────────────────────────────────────────────────

on("btn-start", "click", async () => {
  const { valid, invalid } = parseNumbers($("numbers").value);
  const message  = $("message").value.trim();
  const delayMin = parseInt($("delay-min").value, 10) || 30;
  const delayMax = parseInt($("delay-max").value, 10) || 50;

  if (!valid.length) {
    return showError(invalid.length
      ? "No valid phone numbers found. Numbers must be 7–15 digits with country code."
      : "Please enter at least one phone number.");
  }
  if (!message) return showError("Please enter a message.");
  if (delayMin < 5)  return showError("Minimum delay must be at least 5 seconds.");
  if (delayMax < delayMin) return showError("Max delay must be ≥ min delay.");

  const data = await storageGet([K.RUNNING]);
  if (data[K.RUNNING]) {
    if (!confirm("A campaign is already running. Reset and start new?")) return;
    await sendAction("reset");
    await new Promise(r => setTimeout(r, 300));
  }

  const resp = await sendAction("start", { numbers: valid, message, delayMin, delayMax });
  if (resp?.status === "error") return showError(resp.error || "Failed to start.");

  // Switch to progress tab automatically
  document.querySelector('[data-tab="progress"]').click();
});

on("btn-pause",   "click", () => sendAction("pause"));
on("btn-resume",  "click", () => sendAction("resume"));
on("btn-reset",   "click", () => sendAction("reset"));
on("btn-pause2",  "click", () => sendAction("pause"));
on("btn-resume2", "click", () => sendAction("resume"));
on("btn-reset2",  "click", () => sendAction("reset"));

on("btn-copy-failed", "click", async () => {
  const data = await storageGet([K.FAILED_LIST]);
  const list = data[K.FAILED_LIST] || [];
  if (!list.length) return;
  await navigator.clipboard.writeText(list.join("\n"));
  $("btn-copy-failed").textContent = "✓ Copied!";
  setTimeout(() => { $("btn-copy-failed").textContent = "📋 Copy"; }, 2000);
});

on("btn-retry-failed", "click", async () => {
  const data = await storageGet([K.FAILED_LIST, K.MESSAGE, K.DELAY_MIN, K.DELAY_MAX, K.RUNNING]);
  const list = data[K.FAILED_LIST] || [];
  if (!list.length) return;
  if (data[K.RUNNING] && !confirm("A campaign is running. Reset and retry failed?")) return;

  await sendAction("start", {
    numbers:  list,
    message:  data[K.MESSAGE] || "",
    delayMin: data[K.DELAY_MIN] || 30,
    delayMax: data[K.DELAY_MAX] || 50,
  });
  document.querySelector('[data-tab="progress"]').click();
});

on("btn-download-report", "click", async () => {
  const data = await storageGet([K.NUMBERS, K.SENT_LIST, K.FAILED_LIST]);
  const numbers = data[K.NUMBERS] || [];
  const sentList = new Set(data[K.SENT_LIST] || []);
  const failedList = new Set(data[K.FAILED_LIST] || []);

  if (!numbers.length) return;

  let csvContent = "Phone Number,Status\n";
  for (const num of numbers) {
    let status = "Pending";
    if (sentList.has(num)) status = "Sent";
    else if (failedList.has(num)) status = "Failed";
    csvContent += `${num},${status}\n`;
  }

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `whatsapp-report-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ── Messaging helpers ─────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function sendAction(action, extra = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action, ...extra }, resp => {
      resolve(resp);
    });
  });
}

// ── UI refresh (polling) ───────────────────────────────────────────────────

async function refreshUI() {
  const data = await storageGet([
    K.SENT, K.FAILED, K.FAILED_LIST, K.REMAINING,
    K.TOTAL, K.RUNNING, K.PAUSED, K.NEXT_SEND_TIME,
    K.DELAY_MIN, K.DELAY_MAX,
  ]);

  const sent      = data[K.SENT]      || 0;
  const failed    = data[K.FAILED]    || 0;
  const remaining = data[K.REMAINING] || 0;
  const total     = data[K.TOTAL]     || 0;
  const running   = !!data[K.RUNNING];
  const paused    = !!data[K.PAUSED];
  const done      = total > 0 && remaining === 0 && !running;

  // Stats
  $("stat-sent").textContent      = sent;
  $("stat-failed").textContent    = failed;
  $("stat-remaining").textContent = remaining;

  // Progress bar
  const pct = total > 0 ? Math.round(((sent + failed) / total) * 100) : 0;
  $("progress-bar").style.width = pct + "%";

  // Status badge
  const badge = $("status-badge");
  if (done)         { badge.textContent = "Done";    badge.className = "done"; }
  else if (paused)  { badge.textContent = "Paused";  badge.className = "paused"; }
  else if (running) { badge.textContent = "Running"; badge.className = "running"; }
  else              { badge.textContent = "Idle";    badge.className = "idle"; }

  // Countdown
  const countEl = $("countdown");
  if (running && !paused && data[K.NEXT_SEND_TIME]) {
    const secs = Math.max(0, Math.floor((data[K.NEXT_SEND_TIME] - Date.now()) / 1000));
    countEl.textContent = secs > 0 ? `Next in ${secs}s` : "Sending…";
  } else {
    countEl.textContent = "";
  }

  // ETA
  const etaEl = $("eta");
  if (running && !paused && remaining > 0) {
    const delayMin = data[K.DELAY_MIN] ?? 30;
    const delayMax = data[K.DELAY_MAX] ?? 50;
    const avgDelay = (delayMin + delayMax) / 2;
    const estSec   = Math.floor(remaining * avgDelay);
    const m        = Math.floor(estSec / 60);
    const s        = estSec % 60;
    etaEl.textContent = `ETA ~${m}m ${s}s`;
  } else {
    etaEl.textContent = "";
  }

  // Button states — derived from running/paused
  const startBtn  = $("btn-start");
  const pauseBtn  = $("btn-pause");
  const resumeBtn = $("btn-resume");
  const pauseBtn2  = $("btn-pause2");
  const resumeBtn2 = $("btn-resume2");

  startBtn.disabled  =  running;
  pauseBtn.disabled  = !running || paused;
  resumeBtn.disabled = !running || !paused;
  pauseBtn2.disabled  = !running || paused;
  resumeBtn2.disabled = !running || !paused;

  // Download Report button state
  const downloadBtn = $("btn-download-report");
  if (total > 0) {
    downloadBtn.disabled = false;
    downloadBtn.style.color = "#fff";
    downloadBtn.style.background = "var(--blue)";
  } else {
    downloadBtn.disabled = true;
    downloadBtn.style.color = "var(--text-dim)";
    downloadBtn.style.background = "#2a2a3a";
  }

  // Failed list
  const failedList = data[K.FAILED_LIST] || [];
  const fl = $("failed-list");
  fl.textContent = failedList.join("\n");
}

// Poll every second
const pollInterval = setInterval(refreshUI, 1000);
refreshUI();

// Clean up on popup close to avoid ghost intervals (minor hygiene)
window.addEventListener("unload", () => clearInterval(pollInterval));
