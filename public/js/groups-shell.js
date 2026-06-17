/*
 * VRCW - groups-shell.js
 * Small always-loaded helpers for global nav and groups. Heavy assets/economy
 * code stays in assets-groups.js and is loaded only when the assets tab opens.
 */

function toggleGlobalNav() {
  const nav = document.getElementById("globalNav");
  const navCol = document.getElementById("globalNavCollapsed");
  if (!nav || !navCol) return;
  const isOpen = !nav.classList.contains("hidden");
  nav.classList.toggle("hidden", isOpen);
  navCol.classList.toggle("hidden", !isOpen);
  try { localStorage.setItem("navCollapsed", isOpen ? "1" : "0"); } catch (_) {}
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    if (localStorage.getItem("navCollapsed") === "1") {
      document.getElementById("globalNav")?.classList.add("hidden");
      document.getElementById("globalNavCollapsed")?.classList.remove("hidden");
    }
  } catch (_) {}
});

function _loadAssetsModule() {
  if (VRCW.modules.assets) return Promise.resolve(VRCW.modules.assets);
  return loadScriptOnce('js/media-profile.js?v=' + APP_CACHE_VERSION)
    .then(() => loadScriptOnce('js/assets-groups.js?v=' + APP_CACHE_VERSION))
    .then(() => {
      if (!VRCW.modules.assets) throw new Error('Assets module did not register');
      return VRCW.modules.assets;
    });
}

function switchAssetsPage(page) {
  return _loadAssetsModule().then(module => module.switchAssetsPage(page)).catch(err => {
    console.error(err);
    showToast('资产模块加载失败: ' + err.message, 'error');
  });
}

function extractFileVersionUrl(f) {
  if (!f || !f.versions || !f.versions.length) return '';
  for (let i = f.versions.length - 1; i >= 0; i--) {
    const v = f.versions[i];
    if (v.status === 'complete' && v.file && v.file.url) return v.file.url;
  }
  for (let i = f.versions.length - 1; i >= 0; i--) {
    const v = f.versions[i];
    if (v.file && v.file.url) return v.file.url;
  }
  return '';
}

function switchGroupsCategory(cat) {
  document.querySelectorAll('#groupsPanel .cat-btn').forEach(b => {
    b.classList.remove('active', 'btn-primary');
    b.classList.add('btn-secondary');
  });
  const btn = document.getElementById('gpCat' + cat.charAt(0).toUpperCase() + cat.slice(1));
  if (btn) { btn.classList.remove('btn-secondary'); btn.classList.add('active', 'btn-primary'); }
  loadGroupsPage(cat);
}

async function loadGroupsPage(cat) {
  const area = document.getElementById('groupsContentArea');
  if (!area) return;
  area.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">加载中...</div>';
  try {
    if (cat === 'search') {
      area.innerHTML = '<h2 style="font-size:1.2rem;margin-bottom:12px;">🔍 搜索群组</h2>' +
        '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
          '<input type="text" id="groupSearchInput" class="input-field" placeholder="输入群组名称或 shortCode..." style="flex:1;">' +
          '<button class="btn btn-primary" onclick="searchGroups()">搜索</button>' +
        '</div>' +
        '<div id="groupSearchResults"></div>';
      return;
    }
    const me = await (await apiCall('/api/vrc/auth/user')).json();
    const r = await apiCall('/api/vrc/users/' + me.id + '/groups');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const groups = await r.json();

    let filtered = groups || [];
    let title = '';
    if (cat === 'mine') {
      filtered = filtered.filter(g => g.ownerId === me.id || g.userId === me.id);
      title = '👑 我创建的群组 (' + filtered.length + ')';
    } else {
      filtered = filtered.filter(g => g.ownerId !== me.id && g.userId !== me.id);
      title = '📋 已加入的群组 (' + filtered.length + ')';
    }

    if (!filtered.length) {
      area.innerHTML = '<h2 style="font-size:1.2rem;margin-bottom:12px;">' + title + '</h2><div style="color:var(--text-muted);">暂无群组</div>';
      return;
    }

    area.innerHTML = '<h2 style="font-size:1.2rem;margin-bottom:16px;">' + title + '</h2>';
    area.innerHTML += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">' +
      filtered.map(g => {
        const icon = proxyImg(g.iconUrl || g.bannerUrl || '');
        return '<div onclick="openGroupDetail(\'' + escJsAttr(g.groupId || g.id) + '\')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-glass);border:1px solid var(--border);border-radius:10px;cursor:pointer;">' +
          '<img src="' + escHtml(icon) + '" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:600;font-size:0.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(g.name || '') + '</div>' +
            '<div style="font-size:0.75em;color:var(--text-muted);">.' + escHtml(g.shortCode || '') + ' · 👥 ' + (g.memberCount || 0) + '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  } catch (e) {
    if (isAbortError(e)) return;
    area.innerHTML = '<div style="color:var(--error);padding:20px;">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

async function searchGroups() {
  const input = document.getElementById('groupSearchInput');
  const results = document.getElementById('groupSearchResults');
  if (!input || !results) return;
  const q = input.value.trim();
  if (!q) return;
  results.innerHTML = '<div style="color:var(--text-muted);">搜索中...</div>';
  try {
    const r = await apiCall('/api/vrc/groups?query=' + encodeURIComponent(q) + '&n=20');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const groups = await r.json();
    if (!groups || !groups.length) {
      results.innerHTML = '<div style="color:var(--text-muted);">未找到结果</div>';
      return;
    }
    results.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">' +
      groups.map(g => {
        const icon = proxyImg(g.iconUrl || g.bannerUrl || '');
        return '<div onclick="openGroupDetail(\'' + escJsAttr(g.id || '') + '\')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-glass);border:1px solid var(--border);border-radius:10px;cursor:pointer;">' +
          '<img src="' + escHtml(icon) + '" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:600;font-size:0.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(g.name || '') + '</div>' +
            '<div style="font-size:0.75em;color:var(--text-muted);">.' + escHtml(g.shortCode || '') + ' · 👥 ' + (g.memberCount || 0) + '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  } catch (e) {
    results.innerHTML = '<div style="color:var(--error);">搜索失败: ' + escHtml(e.message) + '</div>';
  }
}

VRCW.registerModule('groupsShell', {
  toggleGlobalNav,
  switchAssetsPage,
  extractFileVersionUrl,
  switchGroupsCategory,
  loadGroupsPage,
  searchGroups,
});
renderAppVersionInfo();
