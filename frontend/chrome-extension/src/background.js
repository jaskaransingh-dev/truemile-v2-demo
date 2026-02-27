chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SET_BADGE') {
    chrome.action.setBadgeText({ text: message.text || '' });
    chrome.action.setBadgeBackgroundColor({ color: message.color || '#2563eb' });
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
