/*
 * VRCW — auth.js
 * 移动侧栏/登录/账号/2FA/进入主界面
 *
 * 注意：本项目为「经典脚本」(非 ES module)，全部按顺序加载、共享全局作用域。
 * 函数声明会提升为全局，跨文件调用没问题；请勿改为 type="module"。
 */
// ── Mobile Sidebar Toggle ──
window.toggleSidebar = function (forceState) {
  const activePanel = document.querySelector(".download-panel.active") || document.querySelector(".upload-panel.active");
  if (!activePanel) return;
  const sidebar = activePanel.querySelector(".sidebar");
  if (!sidebar) return;

  const overlay = document.getElementById("sidebarOverlay");
  const btn     = document.getElementById("mobileSidebarBtn");
  
  const isOpening = forceState !== undefined ? forceState : !sidebar.classList.contains("open");

  if (isOpening) {
    sidebar.classList.add("open");
    overlay?.classList.add("active");
  } else {
    document.querySelectorAll(".sidebar.open").forEach(s => s.classList.remove("open"));
    overlay?.classList.remove("active");
  }

  btn?.classList.toggle("active", isOpening);
  if (btn) btn.textContent = isOpening ? "✕" : "☰";
};

// ── Login & Account Management ──
let lastAttemptUser = "";

function renderSavedAccounts() {
  const container = document.getElementById("savedAccountsContainer");
  if (!container) return;
  const accs = JSON.parse(localStorage.getItem("vrc_accounts") || "[]");
  if (accs.length === 0) {
    container.innerHTML = "";
    return;
  }

  // Each saved-account row is now a flex row: clicking the username logs in,
  // clicking the small × removes that account. The previous version had no
  // way to delete a saved account, so a typoed username sat in the list
  // forever cluttering the login screen.
  let html = `<div style="margin-top: 20px; margin-bottom: 8px; font-size: 0.9em; color: rgba(255,255,255,0.6);">Saved Accounts</div>`;
  html += '<div style="display: flex; flex-direction:column; gap: 6px;">';
  accs.forEach((acc, i) => {
    const u = escHtml(acc.username);
    const ua = escJsAttr(acc.username);
    html += `<div style="display:flex;gap:6px;align-items:stretch;">
      <button class="btn btn-secondary" style="flex:1;padding:8px 12px;text-align:left;" onclick="loginSaved(${i})" title="登录 ${u}">${u}</button>
      <button class="btn btn-secondary" style="padding:0 10px;" onclick="removeSavedAccount(${i}, '${ua}')" title="移除该已保存账号" aria-label="移除">×</button>
    </div>`;
  });
  html += "</div>";
  container.innerHTML = html;
}

// Remove a saved account from the local list. Doesn't sign out an active
// session — that's `doLogout()`. We just stop showing this entry on login.
function removeSavedAccount(idx, username) {
  if (!confirm(`从已保存账号中移除「${username}」？\n\n（不会注销当前会话，只清除登录页的快捷入口）`)) return;
  let accs = JSON.parse(localStorage.getItem("vrc_accounts") || "[]");
  if (idx < 0 || idx >= accs.length) return;
  accs.splice(idx, 1);
  localStorage.setItem("vrc_accounts", JSON.stringify(accs));
  renderSavedAccounts();
  showToast(`已移除 ${username}`, 'info');
}

window.loginSaved = async function (idx) {
  const accs = JSON.parse(localStorage.getItem("vrc_accounts") || "[]");
  if (accs[idx]) {
    vrcAuth = accs[idx].auth;
    localStorage.setItem("vrc_auth", vrcAuth);
    // Verify the saved token is still valid
    try {
      const r = await apiCall("/api/vrc/auth/user");
      if (r.ok) {
        showMainApp();
      } else {
        // Token expired — remove from saved and show error
        accs.splice(idx, 1);
        localStorage.setItem("vrc_accounts", JSON.stringify(accs));
        renderSavedAccounts();
        vrcAuth = "";
        localStorage.removeItem("vrc_auth");
        const errEl = document.getElementById("login-error");
        errEl.textContent = "Session expired, please login again";
        errEl.style.display = "block";
      }
    } catch (e) {
      const errEl = document.getElementById("login-error");
      errEl.textContent = "Network error: " + e.message;
      errEl.style.display = "block";
    }
  }
};

function saveAccountInfo(username) {
  if (!username || !vrcAuth) return;
  let accs = JSON.parse(localStorage.getItem("vrc_accounts") || "[]");
  accs = accs.filter((a) => a.username !== username);
  accs.unshift({ username, auth: vrcAuth });
  localStorage.setItem("vrc_accounts", JSON.stringify(accs));
  renderSavedAccounts();
}

async function getDeviceFingerprint() {
  let fp = localStorage.getItem("vrc_device_fingerprint");
  if (!fp) {
    const randHex = (len) => Array.from(crypto.getRandomValues(new Uint8Array(len)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const randMac = () => [randHex(1), randHex(1), randHex(1), randHex(1), randHex(1), randHex(1)].join(':');
    const randVer = `1.${(Math.floor(Math.random() * 3) + 24)}.${Math.floor(Math.random() * 9)}`;
    fp = JSON.stringify({
      mac: randMac(),
      hwid: randHex(16),
      version: randVer
    });
    localStorage.setItem("vrc_device_fingerprint", fp);
  }
  return JSON.parse(fp);
}

async function doLogin() {
  const user = document.getElementById("username").value.trim();
  const pass = document.getElementById("password").value;
  if (!user || !pass) return;

  lastAttemptUser = user;
  const btn = document.getElementById("btnLogin");
  // Visible "登录中..." state — previously the button just disabled silently,
  // making slow networks look like the click did nothing.
  const _origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "登录中...";
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";
  const lpEl = document.getElementById('loginplace-section');
  if (lpEl) lpEl.style.display = 'none';

  try {
    const fp = await getDeviceFingerprint();
    const resp = await apiCall("/api/login", {
      method: "POST",
      json: { 
        username: user, 
        password: pass,
        fingerprint: fp
      },
    });
    const data = await resp.json();

    // Rate-limit detection
    if (data.rateLimited) {
      let secs = data.retryAfterSeconds || 60;
      errEl.textContent = `VRChat 登录请求过于频繁，请等待 ${secs} 秒后重试。`;
      errEl.style.display = "block";
      btn.disabled = true;
      const countdown = setInterval(() => {
        secs--;
        errEl.textContent = `VRChat 登录请求过于频繁，请等待 ${secs} 秒后重试。`;
        if (secs <= 0) {
          clearInterval(countdown);
          btn.disabled = false;
          errEl.style.display = "none";
        }
      }, 1000);
      return;
    }

    const vrcData = data.vrcResponse;
    const vrcStatus = data.vrcStatus;
    
    if (vrcStatus === 200) {
      const tfa = vrcData.requiresTwoFactorAuth || [];
      if (tfa.length > 0) {
        // Remember which 2FA method VRChat expects so doVerify2FA hits the right
        // endpoint. emailOtp accounts otherwise always fail against the totp route.
        window._tfaMethods = tfa;
        document.getElementById("tfa-section").classList.add("active");
      } else {
        saveAccountInfo(user);
        showMainApp();
      }
    } else if (vrcStatus === 401) {
      const tfa = vrcData.requiresTwoFactorAuth || [];
      const msg = (vrcData.error?.message || "").toLowerCase();
      if (tfa.includes("loginplace") || msg.includes("somewhere new") || msg.includes("verify your email")) {
        document.getElementById('loginplace-section').style.display = 'block';
      } else {
        errEl.textContent = vrcData.error?.message || "Invalid Username/Email or Password";
        errEl.style.display = "block";
      }
    } else {
      errEl.textContent = vrcData.error?.message || "Error " + vrcStatus;
      errEl.style.display = "block";
    }
  } catch (e) {
    errEl.textContent = "Network error: " + e.message;
    errEl.style.display = "block";
  }
  btn.disabled = false;
  btn.textContent = _origLabel;
}

async function doVerify2FA() {
  const code = document.getElementById("tfaCode").value.trim();
  if (!code) return;
  const btn = document.querySelector("#tfa-section button");
  // Visible "验证中..." state for slow links.
  let _vfOrig = '';
  if (btn) { _vfOrig = btn.textContent; btn.disabled = true; btn.textContent = "验证中..."; }
  // Map VRChat's requiresTwoFactorAuth methods to the verify endpoint type.
  // VRChat reports "emailOtp", "totp", and/or "otp" (recovery codes).
  const methods = (window._tfaMethods || []).map(m => String(m).toLowerCase());
  const type = methods.includes("emailotp") && !methods.includes("totp")
    ? "emailotp"
    : "totp";
  try {
    const resp = await apiCall("/api/2fa", { method: "POST", json: { code, type } });
    const data = await resp.json();
    if (data.ok) {
      if (lastAttemptUser) saveAccountInfo(lastAttemptUser);
      showMainApp();
    } else {
      alert(data.message || "Invalid code");
    }
  } catch (e) {
    alert("Network error: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _vfOrig || btn.textContent; }
  }
}

function doLogout() {
  vrcAuth = "";
  localStorage.removeItem("vrc_auth");
  renderSavedAccounts();
  resetBodyScroll(); // safety: clear any lingering modal scroll-lock
  document.getElementById("loginPage").classList.remove("hidden");
  document.getElementById("mainApp").classList.add("hidden");
}

function showMainApp() {
  document.getElementById("loginPage").classList.add("hidden");
  document.getElementById("mainApp").classList.remove("hidden");

  // 1. Initial User Fetch (sets currentUserId — used by isOwner checks etc.)
  apiCall("/api/vrc/auth/user").then(async (r) => {
    if (r.ok) {
      const user = await r.json();
      currentUserId = user.id || "";
    }
  }).catch(() => {});

  // 2. Background syncs (don't block UI; switchTab handles the current tab below)
  syncAllFavoriteIds();
  queueBackgroundTask(async () => {
    if (worldsLoaded) await fetchWorlds(currentWorldCategory, false);
    // initWorldsTab is implicitly triggered when user opens the worlds tab
  });
  queueBackgroundTask(async () => {
    await fetchFavoriteGroups(); // populates the favorite-group sidebar buttons
  });
  queueBackgroundTask(async () => {
    // Keep the friends mini-profile fresh in the sidebar even if user starts on
    // the avatars tab. Use forceRefresh=false so existing cache renders first.
    await fetchMyProfile(false);
  });

  // 3. Trigger initial tab load. The same-tab guard in switchTab would fire if
  //    currentTab already equals the target; bypass it by clearing first so the
  //    first switchTab() actually populates the active panel. Without this, on
  //    cold load the main grid stays empty until the user clicks a different tab.
  const initialTab = currentTab || "download";
  currentTab = "";
  switchTab(initialTab);
}

