/*
 * VRCW - logging.js
 * Resident log console helper shared by feature modules.
 */

function logMsg(msg, type = "info") {
  const el = document.getElementById("logConsole");
  if (!el) {
    console[type === 'error' ? 'error' : 'log'](msg);
    return;
  }
  const span = document.createElement("div");
  span.className = `log-${type}`;
  span.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 500) el.removeChild(el.firstChild);
}

VRCW.registerService('logging', { log: logMsg });
VRCW.registerModule('logging', { logMsg });
renderAppVersionInfo();
