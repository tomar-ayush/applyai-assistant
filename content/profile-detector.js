// content/profile-detector.js - Profile State Detection & Connect Actions
// Detects whether a profile is connectable, pending, already connected, etc.
// Handles the "More menu → Connect" flow.
//
// Depends on: selectors.js, dom-utils.js, human-behavior.js

window.__applyai = window.__applyai || {};

const _SEL = window.__applyai.SELECTORS;
const _dom = window.__applyai.dom;
const _human = window.__applyai.human;

// ---------------------------------------------------------------------------
// Profile State Detection
// ---------------------------------------------------------------------------

/**
 * Detect the current profile's connection state.
 * @returns {{ state: string, connectBtn?: Element, followBtn?: Element, pendingBtn?: Element, moreBtn?: Element }}
 */
function detectProfileState() {
  Logger.debug('[DEBUG] Detecting profile state...');
  const topCard = _dom.getTopProfileCard();

  // Check for "Pending" state
  const pendingBtn = _dom.findMatchingButton(topCard, _SEL.pendingTextPattern);
  if (pendingBtn) {
    Logger.debug('[DEBUG] Detected state: pending');
    return { state: 'pending', pendingBtn };
  }

  // Check for direct Connect button on top card
  const connectBtn = _dom.findDirectConnectElement(topCard);
  if (connectBtn) {
    Logger.debug('[DEBUG] Detected state: connectable_direct', connectBtn);
    return { state: 'connectable_direct', connectBtn };
  }

  // Check for Follow button or More button (Connect hidden inside More menu)
  let followBtn = null;
  for (const sel of _SEL.followCSS) {
    const el = topCard.querySelector(sel);
    if (el && _dom.isElementVisible(el) && !_dom.isInsideSidebar(el)) {
      followBtn = el;
      break;
    }
  }
  if (!followBtn) {
    followBtn = _dom.findMatchingButton(topCard, _SEL.followTextPattern);
  }

  let moreBtn = null;
  for (const sel of _SEL.moreButtonCSS) {
    const el = topCard.querySelector(sel);
    if (el && _dom.isElementVisible(el) && !_dom.isInsideSidebar(el)) {
      moreBtn = el;
      break;
    }
  }
  if (!moreBtn) {
    moreBtn = _dom.findMatchingButton(topCard, _SEL.moreTextPattern);
  }

  if (followBtn || moreBtn) {
    let isFollowing = false;
    if (followBtn) {
      const text = `${followBtn.innerText} ${followBtn.getAttribute('aria-label')}`.toLowerCase();
      isFollowing = text.includes('following') || text.includes('stop following');
    }
    Logger.debug('[DEBUG] Detected state:', isFollowing ? 'already_following' : 'connectable_via_more', { followBtn, moreBtn });
    return {
      state: isFollowing ? 'already_following' : 'connectable_via_more',
      followBtn,
      moreBtn,
    };
  }

  // Check for Message button (already connected)
  const messageBtn = topCard.querySelector(_SEL.messageCSS) ||
                     _dom.findMatchingButton(topCard, _SEL.messageTextPattern);
  if (messageBtn && _dom.isElementVisible(messageBtn) && !_dom.isInsideSidebar(messageBtn)) {
    Logger.debug('[DEBUG] Detected state: already_connected');
    return { state: 'already_connected' };
  }

  Logger.debug('[DEBUG] Profile state currently unknown.');
  return { state: 'unknown' };
}

/**
 * Poll until profile state is known or timeout.
 * @param {number} timeoutMs
 * @returns {Promise<{ state: string, ... }>}
 */
async function waitForProfileState(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = detectProfileState();
    if (result.state !== 'unknown') return result;
    await _human.sleep(500);
  }
  return { state: 'unknown' };
}

// ---------------------------------------------------------------------------
// More Menu → Connect Flow
// ---------------------------------------------------------------------------

/**
 * Open the Connect modal via the More dropdown menu.
 * Used when the direct Connect button is not visible on the profile card.
 */
async function openConnectModalViaMore(followBtn, { alreadyFollowing = false, moreBtn: existingMoreBtn = null } = {}) {
  const topCard = _dom.getTopProfileCard();

  // Find More button on top card if not passed
  let moreBtn = existingMoreBtn;
  if (!moreBtn) {
    for (const sel of _SEL.moreButtonCSS) {
      const el = topCard.querySelector(sel);
      if (el && _dom.isElementVisible(el) && !_dom.isInsideSidebar(el)) {
        moreBtn = el;
        break;
      }
    }
  }
  if (!moreBtn) {
    moreBtn = _dom.findMatchingButton(topCard, _SEL.moreTextPattern);
  }

  if (!moreBtn) {
    throw new Error('More actions button not found on LinkedIn profile top card.');
  }

  Logger.debug('[DEBUG] Clicking More button:', moreBtn);
  await _human.humanClick(moreBtn);
  await _human.humanPause(800, 1500);

  // Search for "Connect" inside the opened dropdown menu
  let connectMenuItem = null;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline && !connectMenuItem) {
    // 1. Try menu containers (div[role="menu"], artdeco-dropdown__content, body)
    const menuContainer = document.querySelector(_SEL.menuContainerCSS) || document.body;

    // Try XPath inside container
    connectMenuItem = _dom.findElementByXPath(_SEL.connectMenuXPath, menuContainer);

    // Try CSS inside container
    if (!connectMenuItem) {
      for (const sel of _SEL.connectMenuCSS) {
        const el = menuContainer.querySelector(sel);
        if (el && _dom.isElementVisible(el)) {
          connectMenuItem = el;
          break;
        }
      }
    }

    // Try text matching inside container
    if (!connectMenuItem) {
      connectMenuItem = _dom.findMatchingButton(menuContainer, _SEL.connectTextPattern);
    }

    if (!connectMenuItem) await _human.sleep(400);
  }

  // Fallback scan of all dropdown items across document
  if (!connectMenuItem) {
    const menuItems = Array.from(document.querySelectorAll(_SEL.menuItemsCSS));
    for (const item of menuItems) {
      if (!_dom.isElementVisible(item)) continue;
      const txt = `${item.innerText} ${item.getAttribute('aria-label')}`.toLowerCase();
      if (txt.includes('connect')) {
        connectMenuItem = item;
        break;
      }
    }
  }

  if (!connectMenuItem) {
    throw new Error('Connect item not found inside More dropdown menu.');
  }

  Logger.debug('[DEBUG] Clicking Connect menu item inside dropdown:', connectMenuItem);

  // For <a> dropdown items, check if we need main-world click to prevent navigation
  const href = connectMenuItem.getAttribute('href') || connectMenuItem.href || '';
  if (href.includes('/preload/custom-invite/')) {
    Logger.debug('[DEBUG] Menu item has custom-invite href, using MAIN world click');
    const selector = `a[href*="/preload/custom-invite/"]`;
    const clicked = await _human.clickViaMainWorld(selector);
    if (!clicked) {
      await _human.humanClick(connectMenuItem);
    }
  } else {
    await _human.humanClick(connectMenuItem);
  }
}

// ---------------------------------------------------------------------------
// Send Confirmation Waiter
// ---------------------------------------------------------------------------

/**
 * Wait for the user to click Send or for the modal to close with success.
 * @param {number} timeoutMs
 * @returns {Promise<{ confirmed: boolean, reason: string }>}
 */
async function waitForSendOrClose(timeoutMs = 1200000) {
  const deadline = Date.now() + timeoutMs;
  Logger.debug('[DEBUG] Waiting for Send or modal close...');

  // Track whether the modal was open at some point so we can detect it closing
  let modalWasOpen = true;

  while (Date.now() < deadline) {
    // ----- Strategy 1: Detect "Invitation sent" toast anywhere on page -----
    // LinkedIn renders toasts as divs/spans, not buttons, so we scan all text
    const sr = _dom.getInteropShadowRoot();
    if (checkForInvitationToast(document) || (sr && checkForInvitationToast(sr))) {
      Logger.debug('[DEBUG] "Invitation sent" toast detected!');
      return { confirmed: true, reason: 'toast' };
    }

    // ----- Strategy 2: Modal closed → poll profile state with patience -----
    let modalOpen = false;
    for (const sel of _SEL.modalCSS) {
      if (_dom.querySelectorInShadow(sel)) { modalOpen = true; break; }
    }

    if (modalWasOpen && !modalOpen) {
      // Modal just closed — give LinkedIn 3 seconds to update the DOM
      Logger.debug('[DEBUG] Modal closed. Waiting for LinkedIn DOM to update...');
      for (let retry = 0; retry < 6; retry++) {
        await _human.sleep(500);

        // Re-check toast after each wait
        if (checkForInvitationToast(document) || (sr && checkForInvitationToast(sr))) {
          Logger.debug('[DEBUG] Toast found after modal close!');
          return { confirmed: true, reason: 'toast_after_close' };
        }

        const state = detectProfileState();
        if (['pending', 'already_connected'].includes(state.state)) {
          Logger.debug('[DEBUG] Profile updated to:', state.state);
          return { confirmed: true, reason: 'profile_state_' + state.state };
        }
      }

      // If we still can't confirm, assume success if the modal closed
      // (LinkedIn sometimes doesn't update the button fast enough)
      Logger.debug('[DEBUG] Modal closed but profile state unclear. Assuming success.');
      return { confirmed: true, reason: 'modal_closed_assumed_success' };
    }

    if (modalOpen) {
      modalWasOpen = true;
    }

    await _human.sleep(800);
  }

  return { confirmed: false, reason: 'timed_out' };
}

/**
 * Scan a root node for any element containing "invitation sent" or "request sent" text.
 * LinkedIn renders toasts as divs/spans, not buttons.
 */
function checkForInvitationToast(root) {
  if (!root) return false;

  // 1. Check artdeco toast containers directly
  const toastContainers = root.querySelectorAll
    ? Array.from(root.querySelectorAll('.artdeco-toast-item, [data-test-artdeco-toast], .artdeco-toast-message'))
    : [];
  for (const el of toastContainers) {
    if (_SEL.toastTextPattern.test(el.textContent || '')) return true;
  }

  // 2. Broad text search — check all visible elements for the toast text
  const allElements = root.querySelectorAll
    ? Array.from(root.querySelectorAll('div, span, p, li'))
    : [];
  for (const el of allElements) {
    const text = (el.textContent || '').trim();
    if (text.length > 0 && text.length < 100 && _SEL.toastTextPattern.test(text)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Export to namespace
// ---------------------------------------------------------------------------
window.__applyai.profile = {
  detectProfileState,
  waitForProfileState,
  openConnectModalViaMore,
  waitForSendOrClose,
};
