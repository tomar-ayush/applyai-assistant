importScripts('logger.js');

// background.js - ApplyAI LinkedIn Extension Service Worker

// Task tracking: each tab gets its own task object
const tasksByTabId = new Map();   // tabId → task (bound once tab is known)
const pendingTasks = [];          // tasks awaiting tab assignment (race-condition buffer)
let automationWindowId = null;

// -----------------------------------------------------------------------------
// Window Management for Background Automation
// -----------------------------------------------------------------------------
function getOrCreateAutomationWindow(url, callback) {
  if (automationWindowId !== null) {
    chrome.windows.get(automationWindowId, { populate: true }, (win) => {
      if (chrome.runtime.lastError || !win) {
        automationWindowId = null;
        createAutomationWindow(url, callback);
      } else {
        chrome.tabs.create({ windowId: win.id, url: url, active: true }, (tab) => {
          callback(tab, win.id);
        });
      }
    });
  } else {
    createAutomationWindow(url, callback);
  }
}

function createAutomationWindow(url, callback) {
  chrome.windows.create({ url: url, focused: false, type: 'normal' }, (win) => {
    automationWindowId = win.id;
    const tab = win.tabs && win.tabs.length > 0 ? win.tabs[0] : null;
    if (tab) {
      callback(tab, win.id);
    } else {
      chrome.tabs.query({ windowId: win.id }, (tabs) => {
        callback(tabs?.[0] || null, win.id);
      });
    }
  });
}

chrome.windows.onRemoved.addListener((winId) => {
  if (winId === automationWindowId) {
    Logger.debug('[DEBUG] Automation window closed:', winId);
    automationWindowId = null;
  }
});

// -----------------------------------------------------------------------------
// Task Lookup - handles the race between tab creation and content script load
// -----------------------------------------------------------------------------

/** Normalize a LinkedIn URL for comparison (strip protocol, query, trailing slash). */
function normalizeLinkedInUrl(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
}

/** Bind a task to a tab (move from pending → active map). */
function bindTaskToTab(task, tabId) {
  task.tabId = tabId;
  tasksByTabId.set(tabId, task);
  const idx = pendingTasks.indexOf(task);
  if (idx >= 0) pendingTasks.splice(idx, 1);
}

/** Find the task for a given tab. Checks the map first, then pending list by URL. */
function findTaskForTab(tabId, tabUrl) {
  // 1. Direct map lookup (happy path — tab callback already ran)
  if (tasksByTabId.has(tabId)) return tasksByTabId.get(tabId);

  // 2. Race-condition path: content script loaded before tab callback
  //    Match by LinkedIn profile URL from the pending list
  const normalizedTabUrl = normalizeLinkedInUrl(tabUrl);
  for (const task of pendingTasks) {
    const normalizedTaskUrl = normalizeLinkedInUrl(task.linkedin_url);
    if (normalizedTaskUrl && normalizedTabUrl.includes(normalizedTaskUrl.replace(/^(www\.)?/, ''))) {
      bindTaskToTab(task, tabId);
      Logger.debug('[DEBUG] Bound pending task to tab via URL match:', task.task_id, tabId);
      return task;
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Frontend Relay
// -----------------------------------------------------------------------------
function notifyFrontendTaskComplete(taskData) {
  Logger.debug('[DEBUG] Relaying task completion to Frontend Web App:', taskData);
  chrome.tabs.query({ url: ['http://localhost/*/*', 'http://127.0.0.1/*/*', 'https://applyai-agent.vercel.app/*'] }, (tabs) => {
    for (const tab of tabs || []) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'APPLYAI_TASK_COMPLETE',
        payload: taskData,
      }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
      });
    }
  });
}

// -----------------------------------------------------------------------------
// Incoming Message Helpers
// -----------------------------------------------------------------------------
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
// External Message Listener
// -----------------------------------------------------------------------------
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  Logger.debug('[DEBUG] External message received:', request, 'from:', sender?.origin);

  if (request.type === 'PING' || request.type === 'APPLYAI_PING') {
    sendResponse({ status: 'ok', installed: true, version: '1.0.0' });
    return true;
  }

  if (request.type === 'SYNC_USER_AUTH' || request.type === 'APPLYAI_SYNC_AUTH') {
    handleAuthSync(request, sendResponse);
    return true;
  }

  if (request.type === 'LINKEDIN_TASK' || request.type === 'EXECUTE_LINKEDIN_TASK' || request.type === 'APPLYAI_LINKEDIN_TASK') {
    handleIncomingTask(request.payload || request, sendResponse);
    return true;
  }

  sendResponse({ success: false, error: `Unknown message type: ${request.type}` });
  return true;
});

// -----------------------------------------------------------------------------
// Internal Message Listener
// -----------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  Logger.debug('[DEBUG] Internal message received:', request, 'from tab:', sender?.tab?.id);

  if (request.type === 'APPLYAI_LINKEDIN_TASK' || request.type === 'LINKEDIN_TASK' || request.type === 'EXECUTE_LINKEDIN_TASK') {
    handleIncomingTask(request.payload || request, sendResponse);
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

  // MAIN_WORLD_CLICK
  if (request.type === 'MAIN_WORLD_CLICK') {
    const { selector } = request;
    const tabId = sender?.tab?.id;
    Logger.debug(`[DEBUG] MAIN_WORLD_CLICK for selector: "${selector}" on tab: ${tabId}`);

    if (!tabId || !selector) {
      sendResponse({ success: false, error: 'Missing tabId or selector' });
      return true;
    }

    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel) => {
        let el = document.querySelector(sel);
        if (!el) {
          const host = document.querySelector('#interop-outlet');
          if (host?.shadowRoot) el = host.shadowRoot.querySelector(sel);
        }
        if (el) {
          el.click();
          return { clicked: true, tag: el.tagName, text: el.innerText?.slice(0, 50) };
        }
        return { clicked: false, error: 'Element not found: ' + sel };
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

    return true;
  }

  // CONTENT_SCRIPT_READY — the content script asks "do you have a task for me?"
  if (request.type === 'CONTENT_SCRIPT_READY') {
    const tabId = sender?.tab?.id;
    const tabUrl = sender?.tab?.url || '';
    Logger.debug('[DEBUG] CONTENT_SCRIPT_READY from tab:', tabId, 'url:', tabUrl);

    const task = findTaskForTab(tabId, tabUrl);
    if (task) {
      Logger.debug('[DEBUG] Delivering task to tab:', tabId, 'task:', task.task_id);
      sendResponse({ task });
    } else {
      Logger.debug('[DEBUG] No task for tab:', tabId);
      sendResponse({ task: null });
    }
    return true;
  }

  // TASK_PROGRESS — content script reports automation state changes
  if (request.type === 'TASK_PROGRESS') {
    const { state, error, details } = request;
    const tabId = sender?.tab?.id;
    Logger.debug(`[DEBUG] TASK_PROGRESS [${state}] from tab ${tabId}:`, { error, details });

    const task = tabId ? tasksByTabId.get(tabId) : null;
    if (task) {
      task.state = state;
      task.lastUpdated = new Date().toISOString();
      if (error) task.error = error;
    }

    const terminalStates = [
      'completed', 'already_connected', 'already_pending',
      'timed_out_waiting_for_user_action', 'closed_without_send', 'failed',
    ];

    if (terminalStates.includes(state)) {
      handleTaskCompletion(tabId, state, error);
    }

    sendResponse({ ack: true });
    return true;
  }

  // POPUP_GET_STATUS
  if (request.type === 'POPUP_GET_STATUS') {
    chrome.storage.local.get(['authToken', 'userId', 'userEmail', 'logs'], (data) => {
      const activeTasks = [];
      for (const [tid, t] of tasksByTabId) {
        activeTasks.push({
          task_id: t.task_id,
          state: t.state,
          referral_name: t.referral_name || null,
          linkedin_url: t.linkedin_url || null,
          tabId: tid,
        });
      }
      sendResponse({
        isPaired: Boolean(data.authToken),
        userId: data.userId || null,
        userEmail: data.userEmail || null,
        activeTask: activeTasks.length > 0 ? activeTasks[activeTasks.length - 1] : null,
        activeTasks,
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
// Task Execution
// -----------------------------------------------------------------------------
async function startLinkedInTask(payload) {
  const taskId = payload.task_id || `task_${Date.now()}`;
  const task = {
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

  // Push to pending list immediately (synchronous) so content script can find it
  // even if it loads before the chrome.tabs.create callback fires
  pendingTasks.push(task);

  Logger.debug('[DEBUG] Starting LinkedIn automation task:', task);
  appendLog('task_started', { taskId, url: payload.linkedin_url });

  getOrCreateAutomationWindow(payload.linkedin_url, (tab, winId) => {
    if (tab) {
      bindTaskToTab(task, tab.id);
      Logger.debug(`[DEBUG] Tab ${tab.id} in window ${winId} for: ${payload.linkedin_url}`);
      appendLog('automation_tab_created', { tabId: tab.id, windowId: winId, url: payload.linkedin_url });
    } else {
      Logger.error('[DEBUG] Failed to obtain tab for automation window');
    }
  });
}

// -----------------------------------------------------------------------------
// Task Completion
// -----------------------------------------------------------------------------
async function handleTaskCompletion(tabId, finalState, error = null) {
  const task = tabId ? tasksByTabId.get(tabId) : null;
  if (!task) return;

  Logger.debug(`[DEBUG] Task ${task.task_id} (tab ${tabId}) completed: "${finalState}"`, { error });
  appendLog('task_finished', { taskId: task.task_id, tabId, state: finalState, error });

  const isSuccess = ['completed', 'already_connected', 'already_pending'].includes(finalState);

  // 1. Direct Backend Webhook
  if (task.callback_url) {
    try {
      const data = await chrome.storage.local.get(['authToken']);
      if (data.authToken) {
        Logger.debug(`[DEBUG] Webhook → ${task.callback_url}`);
        fetch(task.callback_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.authToken}`
          },
          body: JSON.stringify({
            state: finalState,
            task_id: task.task_id,
            error: error || null
          })
        }).catch(err => Logger.error('[DEBUG] Webhook fetch failed:', err));
      }
    } catch (err) {
      Logger.error('[DEBUG] Webhook error:', err);
    }
  }

  // 2. Relay to Frontend for real-time UI update
  if (task.referral_id) {
    notifyFrontendTaskComplete({
      task_id: task.task_id,
      referral_id: task.referral_id,
      state: finalState,
      success: isSuccess,
      ...(error ? { error } : {}),
    });
  }

  // Clean up after a short delay
  setTimeout(() => {
    if (tabId) tasksByTabId.delete(tabId);
  }, 3000);
}

// Tab close listener
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tasksByTabId.has(tabId)) {
    const task = tasksByTabId.get(tabId);
    if (!['completed', 'already_connected', 'already_pending', 'failed'].includes(task.state)) {
      Logger.warn('[DEBUG] Automation tab closed before completion:', tabId);
      appendLog('task_tab_closed_manually', { taskId: task.task_id, tabId });
      handleTaskCompletion(tabId, 'closed_without_send', 'Tab was closed before completing task');
    }
  }
});
