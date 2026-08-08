// content/selectors.js - Centralized Selectors & XPaths
// All CSS selectors and XPaths used by the LinkedIn automation are defined here.
// Update this file when LinkedIn changes their DOM structure.
//
// Loaded first via manifest.json. Other content scripts access via window.__applyai.SELECTORS.

window.__applyai = window.__applyai || {};

window.__applyai.SELECTORS = {
  // ---------------------------------------------------------------------------
  // Shadow DOM
  // ---------------------------------------------------------------------------
  shadowHost: '#interop-outlet[data-testid="interop-shadowdom"]',
  shadowHostFallback: '#interop-outlet',

  // ---------------------------------------------------------------------------
  // Profile Card & Action Bar Containers
  // ---------------------------------------------------------------------------
  profileCard: [
    '.pv-top-card-v2-ctas',
    '.pv-top-card-v2',
    'section.pv-top-card',
    'div.pv-top-card',
    'main section:first-of-type',
  ],

  // Selectors for elements in sidebar / recommendations that MUST be ignored
  sidebarContainers: [
    '.pv-browse-map',
    '.scaffold-layout__aside',
    'aside',
    '.sidebar',
    '.pv-profile-sidebar',
    '.artdeco-modal-outlet',
  ],

  // ---------------------------------------------------------------------------
  // Connect Button (Direct)
  // ---------------------------------------------------------------------------
  connectXPaths: [
    './/a[contains(@href, "/preload/custom-invite/")]',
    './/a[contains(@componentkey, "ConnectButton")]',
    './/button[contains(@componentkey, "ConnectButton")]',
    './/a[contains(@aria-label, "Invite") and contains(@aria-label, "connect")]',
    './/button[contains(@aria-label, "Invite") and contains(@aria-label, "connect")]',
  ],
  connectCSS: [
    'a[componentkey*="ConnectButton" i]',
    'button[componentkey*="ConnectButton" i]',
    'a[href*="/preload/custom-invite/"]',
  ],
  connectTextPattern: /\bconnect\b/i,
  connectInviteHrefFragment: '/preload/custom-invite/',

  // ---------------------------------------------------------------------------
  // Follow / More / Pending / Message Buttons
  // ---------------------------------------------------------------------------
  followCSS: [
    'button[componentkey*="FollowButton" i]',
    '[componentkey*="follow" i]',
  ],
  followTextPattern: /\bfollow(ing)?\b/i,
  pendingTextPattern: /\bpending\b/i,
  messageCSS: 'a[href*="/messaging/compose/"]',
  messageTextPattern: /\bmessage\b/i,
  moreButtonCSS: [
    'button[aria-label*="More actions" i]',
    'button[aria-label*="More" i]',
    'button[aria-label*="more" i]',
  ],
  moreTextPattern: /\bmore\b/i,

  // ---------------------------------------------------------------------------
  // Connect Menu Item (inside More dropdown)
  // ---------------------------------------------------------------------------
  connectMenuXPath: './/a[contains(@href, "/preload/custom-invite/")] | .//a[contains(@componentkey, "ConnectButton")] | .//*[contains(@role, "menuitem") and (contains(., "Connect") or .//span[text()="Connect"])]',
  connectMenuCSS: [
    'a[componentkey*="ConnectButton" i]',
    'button[componentkey*="ConnectButton" i]',
    'a[href*="/preload/custom-invite/"]',
    'div[role="menuitem"]',
    'div.artdeco-dropdown__item',
  ],
  menuContainerCSS: 'div[role="menu"], div[popover], div.artdeco-dropdown__content, .artdeco-dropdown__content, body',
  menuItemsCSS: 'div[role="menu"] [role="menuitem"], div[role="menu"] button, div[role="menu"] a, div[popover] a, div[popover] [role="menuitem"], .artdeco-dropdown__item',

  // ---------------------------------------------------------------------------
  // Connect Modal (inside Shadow DOM)
  // ---------------------------------------------------------------------------
  addNoteButtonCSS: [
    'button[aria-label="Add a note"]',
    '.send-invite button.artdeco-button--secondary',
    '.artdeco-modal__actionbar button:first-child',
  ],
  addNoteButtonXPaths: [
    './/button[@aria-label="Add a note"]',
    './/button[.//span[contains(text(), "Add a note")]]',
  ],

  // ---------------------------------------------------------------------------
  // Note Textarea (inside Shadow DOM)
  // ---------------------------------------------------------------------------
  noteTextareaCSS: [
    '.send-invite textarea',
    '.artdeco-modal textarea',
    'textarea#custom-message',
    'textarea[name="message"]',
    'div[role="dialog"] textarea',
  ],
  noteTextareaXPaths: [
    './/div[contains(@class, "artdeco-modal")]//textarea',
    './/div[contains(@class, "send-invite")]//textarea',
    './/textarea[@id="custom-message"]',
    './/textarea[@name="message"]',
  ],

  // ---------------------------------------------------------------------------
  // Modal Detection & Toast
  // ---------------------------------------------------------------------------
  modalCSS: ['div[role="dialog"]', '.artdeco-modal'],
  toastTextPattern: /invitation sent|request sent/i,
  clickableElementsCSS: 'button, a, [role="button"]',

  // ---------------------------------------------------------------------------
  // MAIN World Click Selectors
  // ---------------------------------------------------------------------------
  mainWorldConnectSelector: 'a[href*="/preload/custom-invite/"]',
};
