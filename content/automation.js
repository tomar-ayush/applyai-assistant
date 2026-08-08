// content/automation.js - Main Orchestration & Entry Point
// Coordinates the LinkedIn connect-and-note automation flow.
// This is the last content script loaded, so all dependencies are available.
//
// Depends on: selectors.js, dom-utils.js, human-behavior.js, profile-detector.js

(function () {
  'use strict';

  Logger.debug('[DEBUG] ApplyAI automation script loaded:', window.location.href);

  const SEL = window.__applyai.SELECTORS;
  const dom = window.__applyai.dom;
  const human = window.__applyai.human;
  const profile = window.__applyai.profile;

  // ---------------------------------------------------------------------------
  // Communication with Background Service Worker
  // ---------------------------------------------------------------------------

  /** Report automation progress to the background worker. */
  async function reportProgress(state, error = null, details = {}) {
    Logger.debug(`[DEBUG] Progress [${state}]:`, { error, details });
    try {
      await chrome.runtime.sendMessage({
        type: 'TASK_PROGRESS',
        state,
        error,
        details,
      });
    } catch (err) {
      Logger.warn('[DEBUG] Failed to report progress:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Connect Click Strategy
  // ---------------------------------------------------------------------------

  /**
   * Build a CSS selector for the MAIN world click from the Connect element.
   * Returns null if no suitable selector can be built.
   */
  function buildMainWorldSelector(connectBtn) {
    const href = connectBtn.getAttribute('href') || connectBtn.href || '';
    if (href.includes(SEL.connectInviteHrefFragment)) {
      return SEL.mainWorldConnectSelector;
    }
    const ariaLabel = connectBtn.getAttribute('aria-label');
    if (ariaLabel) {
      return `[aria-label="${ariaLabel}"]`;
    }
    return null;
  }

  /**
   * Click the Connect element using MAIN world execution first, then fallback.
   * Returns the "Add a note" button if the modal opens, or null.
   */
  async function clickConnectAndWaitForModal(connectBtn) {
    // Hover first (visual realism)
    connectBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await human.humanPause(300, 700);
    connectBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, composed: true }));
    connectBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
    await human.sleep(human.randInt(80, 200));

    // Strategy 1: MAIN world click (avoids <a> tag navigation)
    const selector = buildMainWorldSelector(connectBtn);
    if (selector) {
      Logger.debug('[DEBUG] Strategy 1: MAIN world click with selector:', selector);
      const clicked = await human.clickViaMainWorld(selector);
      if (clicked) {
        const btn = await dom.waitForElementViaObserver(
          dom.findAddNoteButton, '"Add a note" button', 8000
        );
        if (btn) return btn;
      }
    }

    // Strategy 2: Isolated world click (fallback)
    Logger.debug('[DEBUG] Strategy 2: Isolated world click fallback');
    await human.humanClick(connectBtn);
    return await dom.waitForElementViaObserver(
      dom.findAddNoteButton, '"Add a note" button', 5000
    );
  }

  // ---------------------------------------------------------------------------
  // Note Flow (shared between direct and More menu paths)
  // ---------------------------------------------------------------------------

  /**
   * Click "Add a note", type the message, wait for user to send.
   */
  async function executeNoteFlow(addNoteBtn, noteText) {
    Logger.debug('[DEBUG] Clicking "Add a note" button');
    await human.humanClick(addNoteBtn);
    await reportProgress('add_note_clicked');
    await human.humanPause(1000, 2000);

    // Find textarea
    Logger.debug('[DEBUG] Waiting for note textarea...');
    const textarea = await dom.waitForElementViaObserver(
      dom.findNoteTextarea, 'Note textarea', 12000
    );
    if (!textarea) {
      throw new Error('Note textarea not found after clicking Add a Note.');
    }

    await reportProgress('note_modal_opened');
    Logger.debug('[DEBUG] Typing note...');
    await human.humanType(textarea, noteText);
    await reportProgress('note_typed');

    // Wait for user action (Send button click)
    await reportProgress('waiting_for_user_action');
    const result = await profile.waitForSendOrClose(45000);
    if (result.confirmed) {
      Logger.debug('[DEBUG] Task completed successfully!');
      await reportProgress('completed');
    } else {
      await reportProgress('timed_out_waiting_for_user_action',
        'User did not click send within 45s');
    }
  }

  // ---------------------------------------------------------------------------
  // Main Automation Pipeline
  // ---------------------------------------------------------------------------

  async function executeLinkedInAutomation(task) {
    const { message, referral_name } = task;
    const noteText = message || `Hi ${referral_name || 'there'} — I'd love to connect.`;

    Logger.debug('[DEBUG] Starting automation for task:', task.task_id);
    await reportProgress('started');

    try {
      // Handle /preload/custom-invite/ redirect (from previous Connect click)
      if (window.location.pathname.includes(SEL.connectInviteHrefFragment)) {
        Logger.debug('[DEBUG] On custom-invite page, skipping to Add a note...');
        await human.humanPause(1000, 2000);
        await reportProgress('navigated');
        await reportProgress('connect_clicked');

        const addNoteBtn = await dom.waitForElementViaObserver(
          dom.findAddNoteButton, '"Add a note" button', 12000
        );
        if (!addNoteBtn) {
          throw new Error('Could not find "Add a note" button on custom-invite page.');
        }
        await executeNoteFlow(addNoteBtn, noteText);
        return;
      }

      // Normal profile page flow
      await human.humanReadPage();
      await reportProgress('navigated');

      // 1. Detect profile state
      const profileState = await profile.waitForProfileState(10000);
      Logger.debug('[DEBUG] Profile state:', profileState.state);

      if (profileState.state === 'already_connected') {
        await reportProgress('already_connected');
        return;
      }
      if (profileState.state === 'pending') {
        await reportProgress('already_pending');
        return;
      }

      // 2. Click Connect
      let addNoteBtn = null;

      if (profileState.state === 'connectable_direct' && profileState.connectBtn) {
        addNoteBtn = await clickConnectAndWaitForModal(profileState.connectBtn);
        await reportProgress('connect_clicked');

        if (!addNoteBtn) {
          throw new Error('Could not find "Add a note" button after clicking Connect.');
        }

      } else if (profileState.state === 'connectable_via_more' ||
                 profileState.state === 'already_following') {
        await profile.openConnectModalViaMore(profileState.followBtn, {
          alreadyFollowing: profileState.state === 'already_following',
        });
        await reportProgress('connect_clicked');

        addNoteBtn = await dom.waitForElementViaObserver(
          dom.findAddNoteButton, '"Add a note" button', 12000
        );
        if (!addNoteBtn) {
          throw new Error('Could not find "Add a note" button in Connect modal.');
        }
      } else {
        throw new Error(`Cannot connect: profile state is "${profileState.state}".`);
      }

      // 3. Execute note flow
      await executeNoteFlow(addNoteBtn, noteText);

    } catch (err) {
      Logger.error('[DEBUG] Automation failed:', err);
      await reportProgress('failed', err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Entry Point: Query background for active task
  // ---------------------------------------------------------------------------
  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' }, (response) => {
    if (response && response.task) {
      Logger.debug('[DEBUG] Active task received:', response.task.task_id);
      executeLinkedInAutomation(response.task);
    } else {
      Logger.debug('[DEBUG] No active task for this tab.');
    }
  });
})();
