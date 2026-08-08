importScripts('logger.js');

// background.js - ApplyAI LinkedIn Extension Service Worker

let activeTask = null;
let activeTabId = null;

// Log helper to save execution logs in storage and print debug console output
async function appendLog(step, details = {}) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, step, ...details };
  Logger.debug(`[DEBUG] Background Worker [${step}]:`, details);

  try {
    const data = await chrome.storage.local.get({ logs: [] });
    const logs = data.logs || [];
    logs.unshift(entry);
    if (logs.length > 50) logs.pop();
    await chrome.storage.local.set({ logs });
  } catch (err) {
    Logger.error('[DEBUG] Failed to save log entry to storage:', err);
  }
}

// Relay completion helper - notifies Frontend Web App tabs via bridge
function notifyFrontendTaskComplete(taskData) {
  Logger.debug('[DEBUG] Relaying task completion to Frontend Web App:', taskData);
  chrome.tabs.query({ url: ['http://localhost/*/*', 'http://127.0.0.1/*/*', 'https://applyai-agent.vercel.app/*'] }, (tabs) => {
    for (const tab of tabs || []) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'APPLYAI_TASK_COMPLETE',
        payload: taskData,
      }, () => {
        // Ignore error if tab is closed or bridge not loaded
        if (chrome.runtime.lastError) { /* ignore */ }
      });
    }
  });
}

// Helper to handle incoming task dispatch
function handleIncomingTask(payload, sendResponse) {
  Logger.debug('[DEBUG] Processing incoming task payload:', payload);

  if (!payload || !payload.linkedin_url) {
    Logger.error('[DEBUG] Rejecting task - linkedin_url missing');
    sendResponse({ success: false, error: 'linkedin_url is required' });
    return;
  }

  startLinkedInTask(payload);
  sendResponse({
    success: true,
    status: 'task_queued',
    task_id: payload.task_id || `task_${Date.now()}`,
  });
}

// Helper to handle auth sync
function handleAuthSync(request, sendResponse) {
  const { token, userId, userEmail, callbackUrl } = request;
  Logger.debug('[DEBUG] Syncing auth credentials:', { userId, userEmail });

  chrome.storage.local.set({
    authToken: token || null,
    userId: userId || null,
    userEmail: userEmail || null,
    defaultCallbackUrl: callbackUrl || null,
    lastSyncedAt: new Date().toISOString(),
  }, () => {
    appendLog('user_auth_synced', { userId, userEmail });
    sendResponse({ success: true, message: 'Extension successfully paired with ApplyAI' });
  });
}

// -----------------------------------------------------------------------------
// External Message Listener (from externally_connectable web pages)
// -----------------------------------------------------------------------------
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  Logger.debug('[DEBUG] External message received via externally_connectable:', request, 'from:', sender?.origin);

  if (request.type === 'PING' || request.type === 'APPLYAI_PING') {
    sendResponse({
      status: 'ok',
      installed: true,
      version: '1.0.0',
      activeTask: activeTask ? { id: activeTask.task_id, state: activeTask.state } : null,
    });
    return true;
  }

  if (request.type === 'SYNC_USER_AUTH' || request.type === 'APPLYAI_SYNC_AUTH') {
    handleAuthSync(request, sendResponse);
    return true;
  }

  if (request.type === 'LINKEDIN_TASK' || request.type === 'EXECUTE_LINKEDIN_TASK' || request.type === 'APPLYAI_LINKEDIN_TASK') {
    const payload = request.payload || request;
    handleIncomingTask(payload, sendResponse);
    return true;
  }

  sendResponse({ success: false, error: `Unknown message type: ${request.type}` });
  return true;
});

// -----------------------------------------------------------------------------
// Internal Message Listener (from content/bridge.js, content/linkedin.js & popup)
// -----------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  Logger.debug('[DEBUG] Internal runtime message received:', request, 'from tab:', sender?.tab?.id);

  if (request.type === 'APPLYAI_LINKEDIN_TASK' || request.type === 'LINKEDIN_TASK' || request.type === 'EXECUTE_LINKEDIN_TASK') {
    const payload = request.payload || request;
    handleIncomingTask(payload, sendResponse);
    return true;
  }

  if (request.type === 'APPLYAI_SYNC_AUTH' || request.type === 'SYNC_USER_AUTH') {
    handleAuthSync(request, sendResponse);
    return true;
  }

  if (request.type === 'APPLYAI_PING' || request.type === 'PING') {
    sendResponse({ status: 'ok', installed: true, version: '1.0.0' });
    return true;
  }

  // MAIN_WORLD_CLICK: Execute a click in LinkedIn's own JS context (MAIN world)
  // so that Ember's SPA router intercepts it properly. Content scripts run in an
  // isolated world where element.click() on <a> tags triggers browser-default
  // navigation BEFORE Ember can call preventDefault(). In the MAIN world, Ember's
  // internal component handlers catch the click and open the modal.
  if (request.type === 'MAIN_WORLD_CLICK') {
    const { selector } = request;
    const tabId = sender?.tab?.id;
    Logger.debug(`[DEBUG] MAIN_WORLD_CLICK requested for selector: "${selector}" on tab: ${tabId}`);

    if (!tabId || !selector) {
      sendResponse({ success: false, error: 'Missing tabId or selector' });
      return true;
    }

    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel) => {
        // Check regular DOM first, then the interop shadow root
        let el = document.querySelector(sel);
        if (!el) {
          const host = document.querySelector('#interop-outlet');
          if (host?.shadowRoot) {
            el = host.shadowRoot.querySelector(sel);
          }
        }
        if (el) {
          el.click();
          return { clicked: true, tag: el.tagName, text: el.innerText?.slice(0, 50) };
        }
        return { clicked: false, error: 'Element not found for selector: ' + sel };
      },
      args: [selector],
    }).then((results) => {
      const result = results?.[0]?.result;
      Logger.debug('[DEBUG] MAIN_WORLD_CLICK result:', result);
      sendResponse({ success: result?.clicked || false, result });
    }).catch((err) => {
      Logger.error('[DEBUG] MAIN_WORLD_CLICK failed:', err);
      sendResponse({ success: false, error: err.message });
    });

    return true; // async response
  }

  if (request.type === 'CONTENT_SCRIPT_READY') {
    Logger.debug('[DEBUG] Content script queried for active task on tab:', sender?.tab?.id, 'url:', sender?.tab?.url);
    const isLinkedInProfileTab = sender?.tab?.url && (sender.tab.url.includes('/in/') || sender.tab.url.includes('linkedin.com'));
    if (activeTask && (sender?.tab?.id === activeTabId || isLinkedInProfileTab)) {
      activeTabId = sender?.tab?.id;
      Logger.debug('[DEBUG] Delivering active task to content script:', activeTask);
      sendResponse({ task: activeTask });
    } else {
      Logger.debug('[DEBUG] No active automation task for tab:', sender?.tab?.id);
      sendResponse({ task: null });
    }
    return true;
  }

  if (request.type === 'TASK_PROGRESS') {
    const { state, error, details } = request;
    Logger.debug(`[DEBUG] Task Progress Update [${state}]:`, { error, details });

    if (activeTask) {
      activeTask.state = state;
      activeTask.lastUpdated = new Date().toISOString();
      if (error) activeTask.error = error;
    }

    const terminalStates = [
      'completed',
      'already_connected',
      'already_pending',
      'timed_out_waiting_for_user_action',
      'closed_without_send',
      'failed',
    ];

    if (terminalStates.includes(state)) {
      handleTaskCompletion(state, error);
    }

    sendResponse({ ack: true });
    return true;
  }

  if (request.type === 'POPUP_GET_STATUS') {
    chrome.storage.local.get(['authToken', 'userId', 'userEmail', 'logs'], (data) => {
      sendResponse({
        isPaired: Boolean(data.authToken),
        userId: data.userId || null,
        userEmail: data.userEmail || null,
        activeTask,
        logs: data.logs || [],
      });
    });
    return true;
  }

  if (request.type === 'POPUP_CLEAR_LOGS') {
    chrome.storage.local.set({ logs: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// -----------------------------------------------------------------------------
// Task Execution Orchestrator
// -----------------------------------------------------------------------------
async function startLinkedInTask(payload) {
  const taskId = payload.task_id || `task_${Date.now()}`;
  activeTask = {
    task_id: taskId,
    linkedin_url: payload.linkedin_url,
    message: payload.message || '',
    referral_name: payload.referral_name || '',
    referral_id: payload.referral_id || null,
    callback_url: payload.callback_url || null,
    callback_token: payload.callback_token || null,
    state: 'init',
    startedAt: new Date().toISOString(),
  };

  Logger.debug('[DEBUG] Starting LinkedIn automation task:', activeTask);
  appendLog('task_started', { taskId, url: payload.linkedin_url });

  chrome.tabs.create({ url: payload.linkedin_url, active: true }, (tab) => {
    activeTabId = tab.id;
    Logger.debug(`[DEBUG] Created target LinkedIn tab ID ${tab.id} for URL: ${payload.linkedin_url}`);
    appendLog('automation_tab_created', { tabId: tab.id, url: payload.linkedin_url });
  });
}

async function handleTaskCompletion(finalState, error = null) {
  if (!activeTask) return;

  const current = activeTask;
  Logger.debug(`[DEBUG] Task completed with state "${finalState}":`, { taskId: current.task_id, error });
  appendLog('task_finished', { taskId: current.task_id, state: finalState, error });

  const isSuccess = ['completed', 'already_connected', 'already_pending'].includes(finalState);

  // 1. Direct Backend Callback (Highly Resilient to tab closures)
  if (current.callback_url) {
    try {
      const data = await chrome.storage.local.get(['authToken']);
      if (data.authToken) {
        Logger.debug(`[DEBUG] Firing direct webhook to backend: ${current.callback_url}`);
        fetch(current.callback_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.authToken}`
          },
          body: JSON.stringify({
            state: finalState,
            task_id: current.task_id,
            error: error || null
          })
        }).catch(err => Logger.error('[DEBUG] Webhook fetch failed:', err));
      }
    } catch (err) {
      Logger.error('[DEBUG] Webhook error:', err);
    }
  }

  // 2. Relay to Frontend (for real-time UI updates)
  if (current.referral_id) {
    notifyFrontendTaskComplete({
      task_id: current.task_id,
      referral_id: current.referral_id,
      state: finalState,
      success: isSuccess,
      ...(error ? { error } : {}),
    });
  }

  setTimeout(() => {
    if (activeTask && activeTask.task_id === current.task_id) {
      activeTask = null;
      activeTabId = null;
    }
  }, 3000);
}

// Tab listener to handle manual tab close during task
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabId && tabId === activeTabId && activeTask) {
    if (!['completed', 'already_connected', 'already_pending', 'failed'].includes(activeTask.state)) {
      Logger.warn('[DEBUG] Target automation tab closed manually before completion:', tabId);
      appendLog('task_tab_closed_manually', { taskId: activeTask.task_id });
      handleTaskCompletion('closed_without_send', 'Target tab was closed before completing task');
    }
  }
});
