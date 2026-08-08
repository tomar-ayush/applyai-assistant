// content/dom-utils.js - DOM Utilities (Shadow DOM, Querying, Observers)
// Provides helpers for finding elements across LinkedIn's Shadow DOM boundaries.
//
// Depends on: selectors.js (window.__applyai.SELECTORS)

window.__applyai = window.__applyai || {};

const SEL = window.__applyai.SELECTORS;

// ---------------------------------------------------------------------------
// Shadow DOM Access
// ---------------------------------------------------------------------------

/** Get LinkedIn's interop shadow root where modals are rendered. */
function getInteropShadowRoot() {
  const host = document.querySelector(SEL.shadowHost) ||
               document.querySelector(SEL.shadowHostFallback);
  return host?.shadowRoot || null;
}

// ---------------------------------------------------------------------------
// Cross-boundary Querying
// ---------------------------------------------------------------------------

/** querySelector that searches both document and the interop shadow root. */
function querySelectorInShadow(selector) {
  const result = document.querySelector(selector);
  if (result) return result;
  const sr = getInteropShadowRoot();
  return sr ? sr.querySelector(selector) : null;
}

/** querySelectorAll across document + shadow root, returns Array. */
function querySelectorAllInShadow(selector) {
  const results = Array.from(document.querySelectorAll(selector));
  const sr = getInteropShadowRoot();
  if (sr) results.push(...Array.from(sr.querySelectorAll(selector)));
  return results;
}

/** Check if an element is inside sidebar / recommendations that should be ignored. */
function isInsideSidebar(el) {
  if (!el) return false;
  for (const selector of SEL.sidebarContainers) {
    if (el.closest(selector)) return true;
  }
  return false;
}

/** Evaluate an XPath expression, returning the first matching node. */
function findElementByXPath(xpath, contextNode = document) {
  try {
    let relXPath = xpath;
    // Ensure XPath is relative if evaluated against a specific contextNode
    if (contextNode && contextNode !== document && xpath.startsWith('//')) {
      relXPath = '.' + xpath;
    }

    const result = document.evaluate(
      relXPath,
      contextNode || document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Visibility & Element Matching
// ---------------------------------------------------------------------------

/** Check if a DOM element is currently visible. */
function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return el.offsetWidth > 0 || el.offsetHeight > 0 ||
         (el.getClientRects && el.getClientRects().length > 0);
}

/** Find a visible button/link matching a text regex within a container (excluding sidebars). */
function findMatchingButton(container, textRegex) {
  const elements = Array.from(
    (container || document).querySelectorAll(SEL.clickableElementsCSS)
  );
  for (const el of elements) {
    if (!isElementVisible(el)) continue;
    if (isInsideSidebar(el)) continue;
    const text = (el.innerText || '').trim();
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (textRegex.test(`${text} ${aria}`.toLowerCase())) return el;
  }
  return null;
}

// ---------------------------------------------------------------------------
// LinkedIn-specific Element Finders
// ---------------------------------------------------------------------------

/** Get the top profile card section. */
function getTopProfileCard() {
  for (const sel of SEL.profileCard) {
    const el = document.querySelector(sel);
    if (el && isElementVisible(el)) return el;
  }
  return document.querySelector('main') || document.body;
}

/** Find the direct Connect <a> or <button> on the profile card. */
function findDirectConnectElement(container) {
  const scope = container || getTopProfileCard();

  // XPath strategies
  for (const xp of SEL.connectXPaths) {
    const el = findElementByXPath(xp, scope);
    if (el && isElementVisible(el) && !isInsideSidebar(el)) return el;
  }

  // CSS strategies
  for (const sel of SEL.connectCSS) {
    const elements = Array.from(scope.querySelectorAll(sel));
    for (const el of elements) {
      if (isElementVisible(el) && !isInsideSidebar(el)) return el;
    }
  }

  // Text fallback (strictly within scope, not in sidebar)
  return findMatchingButton(scope, SEL.connectTextPattern);
}

/** Find the "Add a note" button inside the Connect modal (Shadow DOM). */
function findAddNoteButton() {
  const sr = getInteropShadowRoot();
  const roots = [document, sr].filter(Boolean);

  for (const root of roots) {
    for (const sel of SEL.addNoteButtonCSS) {
      const btn = root.querySelector(sel);
      if (btn && isElementVisible(btn)) {
        Logger.debug('[DEBUG] findAddNoteButton found in',
          root === sr ? 'shadow root' : 'document',
          btn.outerHTML.slice(0, 100));
        return btn;
      }
    }
  }

  // XPath fallback (document only)
  for (const xp of SEL.addNoteButtonXPaths) {
    const btn = findElementByXPath(xp);
    if (btn && isElementVisible(btn)) return btn;
  }
  return null;
}

/** Find the note textarea inside the Connect modal (Shadow DOM). */
function findNoteTextarea() {
  const sr = getInteropShadowRoot();
  const roots = [document, sr].filter(Boolean);

  for (const root of roots) {
    for (const sel of SEL.noteTextareaCSS) {
      const el = root.querySelector(sel);
      if (el && isElementVisible(el)) return el;
    }
  }

  // XPath fallback (document only)
  for (const xp of SEL.noteTextareaXPaths) {
    const el = findElementByXPath(xp);
    if (el && isElementVisible(el)) return el;
  }
  return null;
}

// ---------------------------------------------------------------------------
// MutationObserver Helper
// ---------------------------------------------------------------------------

/**
 * Wait for an element to appear using MutationObserver.
 * Observes both document.body and the interop shadow root.
 */
function waitForElementViaObserver(finderFn, label, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const existing = finderFn();
    if (existing) {
      Logger.debug(`[DEBUG] ${label} found immediately.`);
      return resolve(existing);
    }

    let resolved = false;
    const observers = [];

    const cleanup = () => observers.forEach((obs) => obs.disconnect());

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        Logger.warn(`[DEBUG] ${label} NOT found within ${timeoutMs}ms timeout.`);
        resolve(null);
      }
    }, timeoutMs);

    const onMutation = () => {
      const el = finderFn();
      if (el && !resolved) {
        resolved = true;
        clearTimeout(timer);
        cleanup();
        Logger.debug(`[DEBUG] ${label} detected via MutationObserver.`);
        resolve(el);
      }
    };

    const config = { childList: true, subtree: true, attributes: true };

    // Observe document.body
    const bodyObs = new MutationObserver(onMutation);
    bodyObs.observe(document.body, config);
    observers.push(bodyObs);

    // Observe shadow root (or poll until it appears)
    const sr = getInteropShadowRoot();
    if (sr) {
      const shadowObs = new MutationObserver(onMutation);
      shadowObs.observe(sr, config);
      observers.push(shadowObs);
      Logger.debug('[DEBUG] MutationObserver watching shadow root for:', label);
    } else {
      const poll = setInterval(() => {
        if (resolved) { clearInterval(poll); return; }
        const s = getInteropShadowRoot();
        if (s) {
          clearInterval(poll);
          const shadowObs = new MutationObserver(onMutation);
          shadowObs.observe(s, config);
          observers.push(shadowObs);
          Logger.debug('[DEBUG] Shadow root appeared, observing for:', label);
          onMutation();
        }
      }, 300);
    }
  });
}

// ---------------------------------------------------------------------------
// Export to namespace
// ---------------------------------------------------------------------------
window.__applyai.dom = {
  getInteropShadowRoot,
  querySelectorInShadow,
  querySelectorAllInShadow,
  isInsideSidebar,
  findElementByXPath,
  isElementVisible,
  findMatchingButton,
  getTopProfileCard,
  findDirectConnectElement,
  findAddNoteButton,
  findNoteTextarea,
  waitForElementViaObserver,
};
