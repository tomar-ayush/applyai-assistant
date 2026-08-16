// popup.js - Extension Popup Logic

document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const authDetails = document.getElementById('authDetails');
  const extIdEl = document.getElementById('extId');
  const copyIdBtn = document.getElementById('copyIdBtn');
  const taskCountBadge = document.getElementById('taskCountBadge');
  const tasksList = document.getElementById('tasksList');
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

  // Quick Add Job logic
  const jobUrlInput = document.getElementById('jobUrlInput');
  const aiParseCheck = document.getElementById('aiParseCheck');
  const addJobBtn = document.getElementById('addJobBtn');
  const addJobStatus = document.getElementById('addJobStatus');

  // Query active tab's URL to auto-populate the input
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs?.[0];
      if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
        if (jobUrlInput) {
          jobUrlInput.value = activeTab.url;
        }
      }
    });
  }

  addJobBtn.addEventListener('click', async () => {
    const jobUrl = jobUrlInput.value.trim();
    if (!jobUrl) {
      showStatus('Please enter or paste a job URL.', 'error');
      return;
    }

    if (!jobUrl.startsWith('http://') && !jobUrl.startsWith('https://')) {
      showStatus('Please enter a valid HTTP/HTTPS URL.', 'error');
      return;
    }

    addJobBtn.disabled = true;
    addJobBtn.textContent = 'Adding...';
    hideStatus();

    chrome.storage.local.get(['authToken', 'apiUrl'], async (data) => {
      const token = data.authToken;
      const baseUrl = (data.apiUrl || 'http://localhost:8000').replace(/\/$/, '');
      const aiParse = aiParseCheck.checked;

      if (!token) {
        showStatus('Extension not paired. Please login to the Web App first.', 'error');
        addJobBtn.disabled = false;
        addJobBtn.textContent = 'Add Job';
        return;
      }

      try {
        const response = await fetch(`${baseUrl}/jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            workday_url: jobUrl,
            ai: aiParse
          })
        });

        if (response.status === 201 || response.ok) {
          const resData = await response.json();
          showStatus('Job successfully added to ApplyAI!', 'success');
          jobUrlInput.value = '';
        } else {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.detail || `Server returned ${response.status}`;
          showStatus(`Failed to add job: ${errMsg}`, 'error');
        }
      } catch (err) {
        showStatus('Network error. Is the ApplyAI backend running?', 'error');
      } finally {
        addJobBtn.disabled = false;
        addJobBtn.textContent = 'Add Job';
      }
    });
  });

  function showStatus(message, type) {
    if (!addJobStatus) return;
    addJobStatus.textContent = message;
    addJobStatus.className = `status-msg ${type}`;
  }

  function hideStatus() {
    if (!addJobStatus) return;
    addJobStatus.className = 'status-msg hidden';
    addJobStatus.textContent = '';
  }

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

      // 2. Render Active Tasks
      const tasks = response.activeTasks || [];
      taskCountBadge.textContent = tasks.length;
      taskCountBadge.className = `task-count-badge ${tasks.length > 0 ? 'active' : ''}`;

      if (tasks.length === 0) {
        tasksList.innerHTML = `<p class="placeholder-text">No automation tasks running right now.</p>`;
      } else {
        tasksList.innerHTML = tasks.map((task) => `
          <div class="task-item">
            <div class="task-item-header">
              <span class="task-name">${escapeHtml(task.referral_name || 'Task')}</span>
              <span class="task-badge ${getBadgeClass(task.state)}">${escapeHtml(task.state || 'init')}</span>
            </div>
            <span class="task-url">${escapeHtml(task.linkedin_url || '')}</span>
          </div>
        `).join('');
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
