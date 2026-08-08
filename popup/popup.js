// popup.js - Extension Popup Logic

document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const authDetails = document.getElementById('authDetails');
  const extIdEl = document.getElementById('extId');
  const copyIdBtn = document.getElementById('copyIdBtn');
  const taskStateBadge = document.getElementById('taskStateBadge');
  const taskBody = document.getElementById('taskBody');
  const logsList = document.getElementById('logsList');
  const clearLogsBtn = document.getElementById('clearLogsBtn');

  // Display Extension ID
  const extensionId = chrome.runtime.id;
  extIdEl.textContent = extensionId;

  // Copy Extension ID button
  copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(extensionId);
    const originalText = copyIdBtn.textContent;
    copyIdBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyIdBtn.textContent = originalText;
    }, 1500);
  });

  // Clear logs button
  clearLogsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'POPUP_CLEAR_LOGS' }, () => {
      renderLogs([]);
    });
  });

  // Query background for current status & state
  function fetchStatus() {
    chrome.runtime.sendMessage({ type: 'POPUP_GET_STATUS' }, (response) => {
      if (!response) {
        setDisconnectedState('Background worker unavailable');
        return;
      }

      // 1. Render Auth / Pairing Status
      if (response.isPaired) {
        statusIndicator.className = 'status-indicator connected';
        statusText.textContent = 'Paired & Active';
        authDetails.innerHTML = `
          <div class="auth-user">
            <span class="email">${response.userEmail || 'Paired User'}</span>
            <span class="id">ID: ${response.userId ? response.userId.slice(0, 16) + '...' : 'Active'}</span>
          </div>
        `;
      } else {
        statusIndicator.className = 'status-indicator disconnected';
        statusText.textContent = 'Not Paired';
        authDetails.innerHTML = `<p class="placeholder-text">Open ApplyAI web dashboard to pair.</p>`;
      }

      // 2. Render Active Task
      if (response.activeTask) {
        const task = response.activeTask;
        taskStateBadge.textContent = task.state || 'Running';
        taskStateBadge.className = `task-badge ${getBadgeClass(task.state)}`;

        taskBody.innerHTML = `
          <div class="task-info">
            <span><strong>Task ID:</strong> ${task.task_id}</span>
            <span class="url">${task.linkedin_url}</span>
            <span><strong>Phase:</strong> ${task.state}</span>
          </div>
        `;
      } else {
        taskStateBadge.textContent = 'Idle';
        taskStateBadge.className = 'task-badge';
        taskBody.innerHTML = `<p class="placeholder-text">No automation running right now.</p>`;
      }

      // 3. Render Logs
      renderLogs(response.logs || []);
    });
  }

  function renderLogs(logs) {
    if (!logs || logs.length === 0) {
      logsList.innerHTML = `<div class="empty-logs">No activity recorded yet.</div>`;
      return;
    }

    logsList.innerHTML = logs.slice(0, 15).map(log => {
      const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      return `
        <div class="log-item">
          <span class="step">${escapeHtml(log.step)}</span>
          <span class="time">${time}</span>
        </div>
      `;
    }).join('');
  }

  function getBadgeClass(state) {
    if (!state) return '';
    if (['completed', 'already_connected', 'already_pending'].includes(state)) return 'completed';
    if (['failed', 'timed_out_waiting_for_user_action'].includes(state)) return 'failed';
    return 'running';
  }

  function setDisconnectedState(msg) {
    statusIndicator.className = 'status-indicator disconnected';
    statusText.textContent = 'Offline';
    authDetails.innerHTML = `<p class="placeholder-text">${msg}</p>`;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[m]);
  }

  // Initial fetch and periodic polling while popup is open
  fetchStatus();
  setInterval(fetchStatus, 2000);
});
