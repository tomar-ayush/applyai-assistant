// content/bridge.js - Communication Bridge between Web App and Chrome Extension

Logger.debug('[DEBUG] ApplyAI Extension Bridge initialized on domain:', window.location.origin);

// Announce extension presence to Web App window
window.postMessage({ type: 'APPLYAI_EXTENSION_INSTALLED', version: '1.0.0' }, window.location.origin);

// 1. Listen for window.postMessage events from Frontend React app -> forward to background worker
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;

  if (!data || typeof data !== 'object') return;

  const validTypes = ['APPLYAI_LINKEDIN_TASK', 'LINKEDIN_TASK', 'APPLYAI_SYNC_AUTH', 'APPLYAI_PING'];
  if (validTypes.includes(data.type)) {
    Logger.debug(`[DEBUG] Bridge received window.postMessage (type: ${data.type}):`, data);

    try {
      chrome.runtime.sendMessage(data, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          Logger.error('[DEBUG] Bridge error sending message to extension background worker:', lastErr.message);
          window.postMessage({
            type: 'APPLYAI_TASK_RESPONSE',
            success: false,
            error: lastErr.message,
            originalType: data.type,
          }, window.location.origin);
          return;
        }

        Logger.debug(`[DEBUG] Bridge received response from background worker for ${data.type}:`, response);
        window.postMessage({
          type: 'APPLYAI_TASK_RESPONSE',
          success: true,
          response,
          originalType: data.type,
        }, window.location.origin);
      });
    } catch (err) {
      Logger.error('[DEBUG] Bridge exception during message forwarding:', err);
    }
  }
});

// 2. Listen for messages from background worker -> relay to Web App window
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'APPLYAI_TASK_COMPLETE') {
    Logger.debug('[DEBUG] Bridge received task completion broadcast from background worker:', message);
    window.postMessage({
      type: 'APPLYAI_TASK_RESPONSE',
      success: message.payload?.success ?? false,
      state: message.payload?.state,
      task_id: message.payload?.task_id,
      referral_id: message.payload?.referral_id,
      error: message.payload?.error || null,
      originalType: 'APPLYAI_LINKEDIN_TASK',
    }, '*');
  }
});
