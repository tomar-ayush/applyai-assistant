// content/human-behavior.js - Human Behavior Simulation
// Simulates human-like interactions: pausing, scrolling, clicking, typing.
//
// No dependencies on other content scripts.

window.__applyai = window.__applyai || {};

// ---------------------------------------------------------------------------
// Timing Utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function humanPause(min = 700, max = 1800) {
  const base = randInt(min, max);
  const dwell = Math.random() < 0.12 ? base * randInt(2, 4) : base;
  await sleep(dwell);
}

// ---------------------------------------------------------------------------
// Page Interaction
// ---------------------------------------------------------------------------

/** Simulate a human reading/scrolling the page. */
async function humanReadPage() {
  Logger.debug('[DEBUG] Simulating human page read...');
  await humanPause(1200, 2500);
  const down = randInt(200, 450);
  window.scrollBy({ top: down, behavior: 'smooth' });
  await humanPause(800, 1600);
  if (Math.random() < 0.6) {
    window.scrollBy({ top: -Math.floor(down * 0.5), behavior: 'smooth' });
    await humanPause(500, 1000);
  }
}

/**
 * Click an element with human-like hover → mousedown → mouseup → click.
 * Uses ONLY element.click() for the actual click (trusted, isTrusted: true).
 */
async function humanClick(element) {
  if (!element) return;
  Logger.debug('[DEBUG] Clicking:', element.tagName,
    element.getAttribute('aria-label') || element.innerText?.slice(0, 30));

  try { element.focus(); } catch (e) {}

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await humanPause(300, 700);

  const rect = element.getBoundingClientRect();
  const opts = {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0, buttons: 1,
  };

  element.dispatchEvent(new MouseEvent('mouseenter', opts));
  element.dispatchEvent(new MouseEvent('mouseover', opts));
  element.dispatchEvent(new MouseEvent('mousedown', opts));
  await sleep(randInt(40, 110));
  element.dispatchEvent(new MouseEvent('mouseup', opts));

  // Trusted click — only method that works with Ember's event delegation
  element.click();

  await sleep(randInt(30, 80));
  element.dispatchEvent(new MouseEvent('mouseleave', opts));
}

/**
 * Ask the background worker to click an element in the MAIN world.
 * Required for <a> Connect links where isolated-world clicks trigger navigation.
 */
async function clickViaMainWorld(cssSelector) {
  Logger.debug('[DEBUG] Requesting MAIN world click:', cssSelector);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'MAIN_WORLD_CLICK', selector: cssSelector },
      (response) => {
        if (chrome.runtime.lastError) {
          Logger.warn('[DEBUG] MAIN_WORLD_CLICK error:', chrome.runtime.lastError.message);
          resolve(false);
        } else {
          Logger.debug('[DEBUG] MAIN_WORLD_CLICK result:', response);
          resolve(response?.success || false);
        }
      }
    );
  });
}

/**
 * Type text into an input/textarea with human-like speed and occasional typos.
 */
async function humanType(element, text) {
  if (!element) return;
  Logger.debug(`[DEBUG] Typing ${text.length} chars into:`, element.tagName);
  element.focus();
  element.click();
  await humanPause(300, 600);

  element.value = '';
  const typos = 'abcdefghijklmnopqrstuvwxyz';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Occasional typo + correction
    if (Math.random() < 0.02 && char !== ' ') {
      const wrong = typos[randInt(0, typos.length - 1)];
      element.value += wrong;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(randInt(150, 350));
      element.value = element.value.slice(0, -1);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(randInt(100, 250));
    }

    element.value += char;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    await sleep(randInt(45, 140));
    if (Math.random() < 0.05) await sleep(randInt(200, 600));
    if (char === ' ' && Math.random() < 0.15) await sleep(randInt(150, 450));
  }
}

// ---------------------------------------------------------------------------
// Export to namespace
// ---------------------------------------------------------------------------
window.__applyai.human = {
  sleep,
  randInt,
  humanPause,
  humanReadPage,
  humanClick,
  clickViaMainWorld,
  humanType,
};
