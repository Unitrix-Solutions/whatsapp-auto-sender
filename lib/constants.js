/**
 * lib/constants.js
 * Shared constants across background and popup.
 * Single source of truth — change here, reflected everywhere.
 */

export const STORAGE_KEYS = {
  NUMBERS:       "numbers",
  MESSAGE:       "message",
  INDEX:         "index",
  TOTAL:         "total",
  SENT:          "sent",
  FAILED:        "failed",
  FAILED_LIST:   "failedList",
  REMAINING:     "remaining",
  RUNNING:       "running",
  PAUSED:        "paused",
  NEXT_SEND_TIME:"nextSendTime",
  DELAY_MIN:     "delayMin",
  DELAY_MAX:     "delayMax",
  RETRY_COUNT:   "retryCount",
};

export const DEFAULTS = {
  DELAY_MIN_SEC:  30,
  DELAY_MAX_SEC:  50,
  MAX_RETRIES:    2,
  // How long to wait for WhatsApp UI after page load (ms)
  WA_LOAD_WAIT:   6000,
  // Interval between trySend() attempts inside injected script (ms)
  SEND_POLL_MS:   600,
  // Max poll attempts before giving up on a tab
  SEND_MAX_TRIES: 25,
};

export const ACTIONS = {
  START:  "start",
  PAUSE:  "pause",
  RESUME: "resume",
  RESET:  "reset",
};

export const STATUS = {
  IDLE:    "Idle",
  RUNNING: "Running",
  PAUSED:  "Paused",
  DONE:    "Done",
};
