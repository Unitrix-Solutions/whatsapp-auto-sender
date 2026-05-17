/**
 * lib/storage.js
 * Promisified, typed wrappers around chrome.storage.local.
 *
 * WHY: Raw chrome.storage callbacks are error-prone, verbose, and make
 * async control flow painful.  Centralizing here also means we can add
 * caching or swap backends in one place.
 */

/**
 * Get one or more keys from local storage.
 * @param {string|string[]} keys
 * @returns {Promise<Object>}
 */
export function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Set key/value pairs in local storage.
 * @param {Object} items
 * @returns {Promise<void>}
 */
export function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Clear all extension storage (used on reset).
 * @returns {Promise<void>}
 */
export function storageClear() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}
