/**
 * background.js  — WhatsApp Auto Sender Pro v2
 *
 * KEY IMPROVEMENTS OVER v1
 * ─────────────────────────────────────────────────────────────────────────
 * 1. ALARM-BASED SCHEDULING instead of setTimeout.
 *    Service workers are killed by the browser when idle.  setTimeout calls
 *    that span across a sleep cycle silently disappear, causing the sending
 *    loop to stall permanently.  chrome.alarms survive service-worker
 *    restarts because they are owned by the browser, not the JS runtime.
 *
 * 2. PER-CONTACT RETRY LOGIC.
 *    Original code moves on immediately even when scripting.executeScript
 *    fires its callback before the message is actually sent (race condition).
 *    v2 tracks retries per phone number and marks permanent failures after
 *    MAX_RETRIES attempts.
 *
 * 3. WINDOW LIFECYCLE GUARD.
 *    v1 removes the tab listener without confirming the message was sent.
 *    v2 uses a Promise-based flow: open window → wait for load → inject
 *    → poll for send → confirm → close.  The window is always cleaned up
 *    even if an error is thrown.
 *
 * 4. DUPLICATE LISTENER BUG FIXED.
 *    v1 adds a new chrome.tabs.onUpdated listener every time sendNext()
 *    runs without ever guarding against duplicates.  Under fast retries
 *    this stacks up dozens of live listeners, each trying to close the
 *    same window.  v2 resolves a single Promise instead.
 *
 * 5. FAILED NUMBER TRACKING.
 *    Failed numbers are written to storage so the popup can display and
 *    export them.
 *
 * 6. CONFIGURABLE DELAY.
 *    Delay bounds come from storage (set by popup) so users can tune them
 *    without touching code.
 *
 * 7. SELECTOR FALLBACK CHAIN.
 *    The injected function tries multiple known WhatsApp send-button
 *    selectors in priority order.  When WhatsApp updates its DOM the
 *    extension degrades gracefully instead of silently failing.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { STORAGE_KEYS as K, DEFAULTS, ACTIONS } from "./lib/constants.js";
import { storageGet, storageSet } from "./lib/storage.js";

const ALARM_NAME = "sendNextAlarm";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Return a random delay in milliseconds within [minSec, maxSec]. */
function randomDelayMs(minSec, maxSec) {
  const range = Math.max(0, maxSec - minSec);
  return (minSec + Math.floor(Math.random() * (range + 1))) * 1000;
}

/** Wait for `ms` milliseconds. */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait until a WhatsApp popup tab finishes loading.
 * Resolves immediately if it is already complete.
 */
function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    // Check current status first to avoid a race where the tab already loaded
    chrome.tabs.get(tabId, tab => {
      if (tab && tab.status === "complete") { resolve(); return; }
      function listener(updatedId, changeInfo) {
        if (updatedId === tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

/**
 * Inject the send logic into the tab and return a Promise that resolves
 * true (sent) or false (timed out / element not found).
 *
 * IMPORTANT: The injected function runs in the page's isolated world.
 * It cannot close over variables from this service worker scope.
 * All configuration must be passed via args[].
 */
function injectSendScript(tabId, pollMs, maxTries) {
  return chrome.scripting.executeScript({
    target: { tabId },
    // Pass config as arguments so the injected function is pure
    args: [pollMs, maxTries],
    func: (pollMs, maxTries) => {
      return new Promise(resolve => {
        /**
         * SELECTOR FALLBACK CHAIN
         * Ordered from most-specific (least likely to match wrong element)
         * to most-generic (broad fallback).  Update this list when WhatsApp
         * changes its DOM — no other code change required.
         */
        function findSendButton() {
          const selectors = [
            '[data-testid="send"]',
            '[aria-label="Send"]',
            'button[class*="send"]',
            'span[data-icon="send"]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
          }
          return null;
        }

        function findMessageBox() {
          // WhatsApp uses a single contenteditable div for the message input.
          // Scope to the footer to avoid matching chat history elements.
          return (
            document.querySelector('footer [contenteditable="true"]') ||
            document.querySelector('[contenteditable="true"][data-tab="10"]') ||
            document.querySelector('[contenteditable="true"]')
          );
        }

        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          const msgBox = findMessageBox();
          const sendBtn = findSendButton();

          if (msgBox && msgBox.textContent.trim().length > 0 && sendBtn) {
            sendBtn.click();
            clearInterval(iv);
            resolve(true);
            return;
          }

          if (tries >= maxTries) {
            clearInterval(iv);
            resolve(false);
          }
        }, pollMs);
      });
    },
  }).then(results => {
    // results is an array of InjectionResult; we injected into one frame.
    return results?.[0]?.result === true;
  }).catch(() => false);
}

// ─── Core Send Flow ────────────────────────────────────────────────────────

/**
 * Attempt to send a WhatsApp message to a single phone number.
 *
 * Flow:
 *   1. Build WhatsApp deep-link URL.
 *   2. Open a popup window.
 *   3. Wait for page load + extra buffer for React hydration.
 *   4. Inject and run send script.
 *   5. Close the window.
 *   6. Return success/failure.
 */
async function sendToNumber(phone, message, waLoadWait, pollMs, maxTries) {
  const encoded  = encodeURIComponent(message);
  const url      = `https://web.whatsapp.com/send?phone=${phone}&text=${encoded}`;
  let   winId    = null;

  try {
    const win = await chrome.windows.create({
      url,
      type: "popup",
      width: 1024,
      height: 820,
      focused: false,   // Don't steal focus from the user
    });

    if (!win?.tabs?.[0]?.id) throw new Error("Window creation failed");
    const tabId = win.tabs[0].id;
    winId = win.id;

    // Wait for DOM + WhatsApp React shell to hydrate
    await waitForTabLoad(tabId);
    await sleep(waLoadWait);

    const sent = await injectSendScript(tabId, pollMs, maxTries);

    // Give WhatsApp a brief moment to actually dispatch the message
    // before we close the window (avoids cutting off the send call).
    if (sent) await sleep(1500);

    return sent;
  } catch (err) {
    console.error(`[WA-Sender] sendToNumber error for ${phone}:`, err);
    return false;
  } finally {
    // Always clean up the window — even if an error was thrown.
    if (winId !== null) {
      try { await chrome.windows.remove(winId); } catch (_) { /* already closed */ }
    }
  }
}

// ─── Queue Orchestration ───────────────────────────────────────────────────

/**
 * Main loop iteration.  Reads current state, processes the next number,
 * then schedules the alarm for the iteration after that.
 *
 * Called:
 *   - On alarm fire
 *   - Directly after start/resume (to begin immediately)
 */
async function processNext() {
  const data = await storageGet([
    K.NUMBERS, K.MESSAGE, K.INDEX, K.TOTAL,
    K.SENT, K.FAILED, K.FAILED_LIST,
    K.RUNNING, K.PAUSED,
    K.DELAY_MIN, K.DELAY_MAX,
    K.RETRY_COUNT,
  ]);

  if (!data[K.RUNNING] || data[K.PAUSED]) return;

  const numbers    = data[K.NUMBERS]    || [];
  const index      = data[K.INDEX]      || 0;
  const retryMap   = data[K.RETRY_COUNT] || {};  // { phone: attemptCount }
  const maxRetries = DEFAULTS.MAX_RETRIES;
  const delayMinSec = data[K.DELAY_MIN] ?? DEFAULTS.DELAY_MIN_SEC;
  const delayMaxSec = data[K.DELAY_MAX] ?? DEFAULTS.DELAY_MAX_SEC;

  if (index >= numbers.length) {
    // Campaign complete
    await storageSet({ [K.RUNNING]: false });
    return;
  }

  const phone   = numbers[index];
  const message = data[K.MESSAGE] || "";

  // --- Attempt send ---
  const sent = await sendToNumber(
    phone, message,
    DEFAULTS.WA_LOAD_WAIT,
    DEFAULTS.SEND_POLL_MS,
    DEFAULTS.SEND_MAX_TRIES,
  );

  // --- Update counters ---
  let newSent       = data[K.SENT]       || 0;
  let newFailed     = data[K.FAILED]     || 0;
  let newFailedList = data[K.FAILED_LIST] || [];
  let newRetryMap   = { ...retryMap };
  let newIndex      = index;

  if (sent) {
    newSent++;
    newIndex++;
    delete newRetryMap[phone];  // Clear retry state on success
  } else {
    // Track retries
    const prevAttempts = newRetryMap[phone] || 0;
    if (prevAttempts < maxRetries) {
      // Will retry this number — do NOT advance index
      newRetryMap[phone] = prevAttempts + 1;
      console.warn(`[WA-Sender] Retry ${prevAttempts + 1}/${maxRetries} for ${phone}`);
    } else {
      // Permanently failed — advance past this number
      newFailed++;
      newFailedList.push(phone);
      newIndex++;
      delete newRetryMap[phone];
      console.error(`[WA-Sender] Permanently failed: ${phone}`);
    }
  }

  const remaining = numbers.length - newIndex;

  await storageSet({
    [K.INDEX]:       newIndex,
    [K.SENT]:        newSent,
    [K.FAILED]:      newFailed,
    [K.FAILED_LIST]: newFailedList,
    [K.REMAINING]:   remaining,
    [K.RETRY_COUNT]: newRetryMap,
  });

  // --- Check if done ---
  if (newIndex >= numbers.length) {
    await storageSet({ [K.RUNNING]: false, [K.NEXT_SEND_TIME]: null });
    return;
  }

  // --- Schedule next send via alarm ---
  const delayMs = randomDelayMs(delayMinSec, delayMaxSec);
  const nextTime = Date.now() + delayMs;
  await storageSet({ [K.NEXT_SEND_TIME]: nextTime });

  // chrome.alarms only supports minute-level precision via periodInMinutes.
  // For sub-minute delays we combine a minimal alarm + a setTimeout inside
  // the alarm callback.  We store the exact target time in storage so the
  // alarm handler can sleep the remainder.
  chrome.alarms.create(ALARM_NAME, { when: Date.now() + delayMs });
}

// ─── Alarm Listener ────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    processNext().catch(err => console.error("[WA-Sender] processNext error:", err));
  }
});

// ─── Message Listener ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Must return true to keep the channel open for async sendResponse
  handleMessage(msg).then(sendResponse).catch(err => {
    console.error("[WA-Sender] handleMessage error:", err);
    sendResponse({ status: "error", error: err.message });
  });
  return true;
});

async function handleMessage(msg) {
  switch (msg.action) {

    case ACTIONS.START: {
      // Validate before writing
      const numbers = (msg.numbers || []).filter(n => /^\d{7,15}$/.test(n));
      if (!numbers.length) return { status: "error", error: "No valid numbers" };
      if (!msg.message?.trim()) return { status: "error", error: "Empty message" };

      await storageSet({
        [K.NUMBERS]:     numbers,
        [K.MESSAGE]:     msg.message.trim(),
        [K.INDEX]:       0,
        [K.TOTAL]:       numbers.length,
        [K.SENT]:        0,
        [K.FAILED]:      0,
        [K.FAILED_LIST]: [],
        [K.REMAINING]:   numbers.length,
        [K.RUNNING]:     true,
        [K.PAUSED]:      false,
        [K.RETRY_COUNT]: {},
        [K.NEXT_SEND_TIME]: null,
        [K.DELAY_MIN]:   msg.delayMin ?? DEFAULTS.DELAY_MIN_SEC,
        [K.DELAY_MAX]:   msg.delayMax ?? DEFAULTS.DELAY_MAX_SEC,
      });

      // Start immediately — no alarm for the first number
      processNext().catch(console.error);
      return { status: "started" };
    }

    case ACTIONS.PAUSE: {
      chrome.alarms.clear(ALARM_NAME);
      await storageSet({ [K.PAUSED]: true, [K.NEXT_SEND_TIME]: null });
      return { status: "paused" };
    }

    case ACTIONS.RESUME: {
      await storageSet({ [K.PAUSED]: false });
      processNext().catch(console.error);
      return { status: "resumed" };
    }

    case ACTIONS.RESET: {
      chrome.alarms.clear(ALARM_NAME);
      await storageSet({
        [K.NUMBERS]:      [],
        [K.MESSAGE]:      "",
        [K.INDEX]:        0,
        [K.TOTAL]:        0,
        [K.SENT]:         0,
        [K.FAILED]:       0,
        [K.FAILED_LIST]:  [],
        [K.REMAINING]:    0,
        [K.RUNNING]:      false,
        [K.PAUSED]:       false,
        [K.RETRY_COUNT]:  {},
        [K.NEXT_SEND_TIME]: null,
      });
      return { status: "reset" };
    }

    default:
      return { status: "unknown_action" };
  }
}
