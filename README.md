# ApplyAI LinkedIn Connect Chrome Extension (MV3)

A Chrome Extension (Manifest V3) for direct LinkedIn note & connection automation without running a local Node.js server, Playwright, or Cloudflare Tunnels.

---

## 📁 Directory Structure

```
linkedin_note_extension/
├── manifest.json         # Manifest V3 setup with externally_connectable permission
├── background.js        # Service worker handling auth pairing & tab task dispatching
├── content/
│   └── linkedin.js      # DOM automation script injected into LinkedIn profile pages
├── popup/
│   ├── popup.html       # Status UI and live execution log monitor
│   ├── popup.css        # Dark mode glassmorphism styling
│   └── popup.js         # Popup state rendering logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🚀 How to Install in Chrome

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the directory:
   `/Users/ayush/code/auto_apply/linkedin_note_extension`
5. Note the **Extension ID** displayed on the extension card (e.g., `klmnoabcdefghijklmnopqrstuvwxyz`).

---

## 🔗 How to Connect Your Web App (`applyai-agent.vercel.app` / `localhost:3000`)

### 1. Step 1: Pair User Authentication

When the user opens your Web App, pair their user credentials with the extension:

```javascript
// Web App Code (React / Next.js / Vanilla JS)
const EXTENSION_ID = "YOUR_EXTENSION_ID_HERE"; // Copy from chrome://extensions

export async function pairExtensionWithUser(userToken, userId, userEmail) {
  if (typeof window !== 'undefined' && window.chrome && chrome.runtime) {
    chrome.runtime.sendMessage(EXTENSION_ID, {
      type: "SYNC_USER_AUTH",
      token: userToken,
      userId: userId,
      userEmail: userEmail
    }, (response) => {
      console.log("Extension paired response:", response);
    });
  }
}
```

---

### 2. Step 2: Dispatch LinkedIn Connect Task Directly

To trigger a connection task from your Web App directly to the user's browser extension:

```javascript
export async function sendLinkedInTaskToExtension(taskData) {
  const EXTENSION_ID = "YOUR_EXTENSION_ID_HERE";

  const payload = {
    type: "LINKEDIN_TASK",
    payload: {
      task_id: taskData.id || `task_${Date.now()}`,
      linkedin_url: taskData.linkedin_url, // e.g. "https://www.linkedin.com/in/jane-doe"
      message: taskData.note,              // Custom note text (up to 300 chars)
      referral_name: taskData.name,       // e.g. "Jane"
      referral_id: taskData.referral_id,
      callback_url: "https://your-api.vercel.app/api/callbacks/linkedin", // Webhook URL when task finishes
      callback_token: taskData.token
    }
  };

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(EXTENSION_ID, payload, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error("Extension not installed or ID mismatch"));
      }
      resolve(response);
    });
  });
}
```

---

## ⚙️ How the LinkedIn Automation Works

1. **Tab Creation**: When `LINKEDIN_TASK` is received, `background.js` opens the target profile URL in Chrome.
2. **Content Script Injection**: `content/linkedin.js` initializes on the page.
3. **Human-like Page Scroll**: Simulates reading the profile before taking action.
4. **State Detection**: Automatically detects profile status (`connectable_direct`, `connectable_via_more`, `already_following`, `already_connected`, `pending`).
5. **Connect & Note Typing**: Opens the Connect modal, clicks "Add a note", types the personalized note with human-like delays/typo simulations.
6. **Confirmation & Callback**: Listens for the "Invitation sent" toast or pending status update and POSTs the result back to your backend `callback_url`.
