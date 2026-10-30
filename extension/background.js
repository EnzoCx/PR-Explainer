// Relays requests from the content script to the native helper, which drives the local AI CLI.
const HOST = 'com.pr_explainer.host';

chrome.runtime.onConnect.addListener((tabPort) => {
  if (tabPort.name !== 'pr-explainer') return;

  tabPort.onMessage.addListener((request) => {
    // One native port per request: the helper handles a single request, then exits.
    let native;
    try {
      native = chrome.runtime.connectNative(HOST);
    } catch (e) {
      tabPort.postMessage({ reqId: request.reqId, type: 'error', message: String(e) });
      return;
    }
    native.onMessage.addListener((msg) => {
      try { tabPort.postMessage({ reqId: request.reqId, ...msg }); } catch (_) { /* tab closed */ }
    });
    native.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (!err) return;
      try {
        tabPort.postMessage({
          reqId: request.reqId,
          type: 'error',
          message: `${err.message} — Install.cmd`,
        });
      } catch (_) { /* tab closed */ }
    });
    // Closing the tab stops the AI run instead of leaving it in the background.
    tabPort.onDisconnect.addListener(() => native.disconnect());
    native.postMessage(request);
  });
});
