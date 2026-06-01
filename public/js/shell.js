/*
 * VRCW — shell.js
 * 收藏同步/收藏分组/前台加载编排/标签与设置/加入偏好/缓存统计
 *
 * 注意：本项目为「经典脚本」(非 ES module)，全部按顺序加载、共享全局作用域。
 * 函数声明会提升为全局，跨文件调用没问题；请勿改为 type="module"。
 */
// ── Sync All Favorites Globally ──
async function syncAllFavoriteIds() {
  try {
    // Clear maps to prevent accumulation on sync/refresh
    favoriteIdMap.clear();
    worldFavoriteIdMap.clear();
    avatarFavGroupCounts.clear();
    worldFavGroupCounts.clear();
    friendFavoriteIdMap.clear();



    // 1. Avatars
    let offset = 0;
    while (true) {
      const resp = await apiCall(`/api/vrc/favorites?type=avatar&n=100&offset=${offset}`);
      if (!resp.ok) break;
      const favs = await resp.json();
      if (!favs || favs.length === 0 || favs.error) break;
       favs.forEach((f) => {
        favoriteIdMap.set(f.favoriteId, f.id);
        const tag = f.tags?.[0];
        if (tag) avatarFavGroupCounts.set(tag, (avatarFavGroupCounts.get(tag) || 0) + 1);
      });
      if (favs.length < 100) break;
      offset += 100;
      if (offset >= 500) break;
    }
    // 2. Worlds
    offset = 0;
    while (true) {
      const resp = await apiCall(`/api/vrc/favorites?type=world&n=100&offset=${offset}`);
      if (!resp.ok) break;
      const favs = await resp.json();
      if (!favs || favs.length === 0 || favs.error) break;
       favs.forEach((f) => {
        worldFavoriteIdMap.set(f.favoriteId, f.id);
        const tag = f.tags?.[0];
        if (tag) worldFavGroupCounts.set(tag, (worldFavGroupCounts.get(tag) || 0) + 1);
      });

      if (favs.length < 100) break;
      offset += 100;
    }
    // 3. Friends — store as { favoriteId, tags } to match the per-category refresh
    // shape (friends.js:443). Previously this site stored a bare string and the
    // refresh path stored an object, breaking toggleFriendFavorite (which read
    // it as a string) after any tab refresh.
    offset = 0;
    while (true) {
      const resp = await apiCall(`/api/vrc/favorites?type=friend&n=100&offset=${offset}`);
      if (!resp.ok) break;
      const favs = await resp.json();
      if (!favs || favs.length === 0 || favs.error) break;
      favs.forEach((f) => {
        const tag = f.tags?.[0] || 'group_0';
        const existing = friendFavoriteIdMap.get(f.favoriteId);
        if (existing && existing.tags) {
          if (!existing.tags.includes(tag)) existing.tags.push(tag);
        } else {
          friendFavoriteIdMap.set(f.favoriteId, { favoriteId: f.id, tags: [tag] });
        }
      });
      if (favs.length < 100) break;
      offset += 100;
    }
    logMsg(`✅ 已同步收藏状态 (模型:${favoriteIdMap.size} 世界:${worldFavoriteIdMap.size} 好友:${friendFavoriteIdMap.size})`, "info");
  } catch (e) {
    console.warn("Failed to sync favorite IDs", e);
  }
}

// ── Favorite Groups (dynamic sidebar) ──
async function fetchFavoriteGroups() {
  try {
    // 1. Avatars
    const rAv = await apiCall("/api/vrc/favorite/groups?type=avatar&n=50");
    if (rAv.ok) {
      const g = await rAv.json();
      favoriteGroups = (g || []).filter(x => x.name && x.name.startsWith('avatars')).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
      renderFavoriteGroupButtons();
      preloadAllFavorites(favoriteGroups.map(x => x.name));
    }
    // 2. Worlds
    const rW = await apiCall("/api/vrc/favorite/groups?type=world&n=50");
    if (rW.ok) {
      const g = await rW.json();
      worldFavGroups = (g || []).filter(x => x.name && x.name.startsWith('worlds')).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
    }
    // 3. Friends
    const rF = await apiCall("/api/vrc/favorite/groups?type=friend&n=50");
    if (rF.ok) {
      const g = await rF.json();
      friendFavGroups = (g || []).filter(x => x.name && (x.name.startsWith('group_') || x.name==='friends')).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
      renderFriendFavGroupButtons();
    }
  } catch (e) {
    console.warn("Could not fetch favorite groups", e);
  }
}

function renderFriendFavGroupButtons() {
  const container = document.getElementById('friendFavGroupList');
  if (!container) return;
  if (!friendFavGroups.length) {
    container.innerHTML = '<div style="font-size:0.75em;color:var(--text-muted);padding:4px 0;">无收藏分组</div>';
    return;
  }
  container.innerHTML = friendFavGroups.map(g =>
    makeCatBtn(`⭐ ${escHtml(g.displayName || g.name)}`, `switchFriendCategory('fav_${g.name}')`, `friendCatFav_${g.name}`)
  ).join('');
}

async function preloadAllFavorites(groups) {
  // Delay to not compete with the initial fetchAvatars on login
  await new Promise((r) => setTimeout(r, 3000));
  for (const g of groups) {
    // Skip currently active category - already fetched by fetchAvatars
    if (g === currentCategory) continue;
    // Skip if we already have cache for this group (avoid overwriting user changes)
    try {
      const existing = await idb.get("avatars_" + g);
      if (existing && existing.length > 0) continue;
    } catch (_) {}
    try {
      let offset = 0;
      let allFetched = [];
      while (true) {
        const resp = await apiCall(
          `/api/vrc/avatars/favorites?n=100&offset=${offset}&tag=${g}`,
        );
        if (!resp.ok) break;
        const batch = await resp.json();
        if (!batch || batch.length === 0) break;
        allFetched = allFetched.concat(batch);
        if (batch.length < 100) break;
        offset += 100;
      }
      if (allFetched.length > 0) {
        await idb.set("avatars_" + g, allFetched);
        // Incremental update to global map
        allFetched.forEach(av => {
          if (av.id && av.name && av.name !== 'Unknown') {
            window._localNameMap.set(av.id, av.name);
          }
        });
        logMsg(`✓ Preloaded ${allFetched.length} for ${g}`, "info");
      }
      // Small delay between groups to prevent rate limiting
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      console.warn("preload failed for", g, e);
    }
  }
}

function renderFavoriteGroupButtons() {
  const container = document.getElementById("favGroupBtns");
  if (!container) return;
  
  container.innerHTML = "";
  
  // 1. Render all dynamic groups
  favoriteGroups.forEach((g) => {
    const btn = document.createElement("button");
    btn.className = "btn btn-secondary btn-block cat-btn";
    btn.id = "cat-" + g.name;
    btn.textContent = g.displayName || g.name.replace("avatars", "Favorites ");
    btn.onclick = () => switchCategory(g.name);
    container.appendChild(btn);
  });
    
  // 2. Append Local Favorites to the absolute bottom
  const btnLocal = document.createElement("button");
  btnLocal.className = "btn btn-secondary btn-block cat-btn";
  btnLocal.id = "cat-local";
  btnLocal.textContent = "⭐ 本地收藏";
  btnLocal.onclick = () => switchCategory("local");
  container.appendChild(btnLocal);
}

// ── Foveated Loading Orchestrator ──
async function runPriorityTask(taskFn) {
  currentGlobalFetchSeq++; 
  isPriorityTaskRunning = true;
  // NOTE: Don't clear imageQueue here. Previously this was done to "favor current
  // JSON" but it caused thumbnails on the destination tab to need re-queueing,
  // making revisits feel slower. IntersectionObserver naturally pauses off-screen
  // image loads (cancelLoad()), so leaving the queue alone is fine.
  
  try {
    await taskFn();
  } finally {
    isPriorityTaskRunning = false;
    processBackgroundQueue();
  }
}

function queueBackgroundTask(taskFn) {
  backgroundLoadQueue.push(taskFn);
  if (!isPriorityTaskRunning) processBackgroundQueue();
}

async function processBackgroundQueue() {
  if (isPriorityTaskRunning || !backgroundLoadQueue.length) return;
  const task = backgroundLoadQueue.shift();
  if (task) {
    try { await task(); } catch(e){}
    setTimeout(processBackgroundQueue, 500);
  }
}

// ── Tabs ──
function switchTab(tab) {
  // No-op when already on this tab. Re-clicking the active nav item used to
  // re-trigger a full refresh, abort the in-flight requests for the current
  // tab, and visibly wipe the grid — making cached content disappear and reload.
  const isSameTab = currentTab === tab;
  currentTab = tab;
  if (window.innerWidth <= 768) toggleSidebar(false);

  // UI Updates run regardless (so re-clicking a nav still gives visual feedback)
  document.querySelectorAll(".nav-item, .nav-item-icon, .tab-btn").forEach(b => b.classList.remove("active"));
  // Use data-tab="X" (added in index.html) instead of the brittle
  // [onclick*="'X'"] selector — the old version mis-matched any onclick that
  // contained the tab name string anywhere (e.g. switchAssetsPage('search')
  // accidentally activating the search tab nav item). data-tab is a precise
  // declarative anchor.
  document.querySelectorAll('[data-tab="' + tab + '"]').forEach(b => b.classList.add("active"));

  const panels = { download:'downloadPanel', upload:'uploadPanel', search:'searchPanel', friends:'friendsPanel', worlds:'worldsPanel', groups:'groupsPanel', assets:'assetsPanel', settings:'settingsPanel' };
  Object.entries(panels).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', tab === key);
  });
  const sp = document.getElementById('settingsPanel');
  if (sp) sp.classList.toggle('hidden', tab !== 'settings');

  // If already on this tab, skip the abort+reload dance entirely
  if (isSameTab) return;

  runPriorityTask(async () => {
    if (currentTabAbortController) currentTabAbortController.abort();
    currentTabAbortController = new AbortController();

    // forceRefresh=false: render cache immediately, then silently re-fetch in
    // background. The dedicated 🔄 refresh buttons inside each tab pass true.
    if (tab === "friends") {
      if (!friendsLoaded) initFriendsTab();
      else fetchCurrentFriendCategory(false);
    }
    if (tab === "worlds") {
      if (!worldsLoaded) initWorldsTab();
      else fetchWorlds(currentWorldCategory, false);
    }
    if (tab === "groups") loadGroupsPage('mine');
    if (tab === "download") fetchAvatars(false);
    if (tab === 'assets') initAssetsTab?.();
    if (tab === 'settings') loadCacheStats();
  });
}

function switchSettingsPage(page) {
  ['cache', 'join', 'about'].forEach(p => {
    const el = document.getElementById('setPage' + p.charAt(0).toUpperCase() + p.slice(1));
    if (el) el.style.display = p === page ? '' : 'none';
    const btn = document.getElementById('setCat' + p.charAt(0).toUpperCase() + p.slice(1));
    if (btn) btn.classList.toggle('active', p === page);
  });
  if (page === 'cache') loadCacheStats();
  if (page === 'join') loadJoinPrefs();
}

// ── Join Preferences (localStorage) ──
const PREF_TYPE   = 'vrcw_default_instance_type';
const PREF_REGION = 'vrcw_default_region';

const INSTANCE_TYPE_LABELS = {
  hidden:     'Friends+ (好友加)',
  public:     '公开 (Public)',
  friends:    '仅好友 (Friends Only)',
  invite:     '邀请 (Invite Only)',
  inviteplus: '邀请加 (Invite+)',
};
const REGION_LABELS = {
  use: '🇺🇸 美国东 (US East)',
  usw: '🇺🇸 美国西 (US West)',
  eu:  '🇪🇺 欧洲 (Europe)',
  jp:  '🇯🇵 日本 (Japan)',
};

function loadJoinPrefs() {
  const type   = localStorage.getItem(PREF_TYPE)   || 'hidden';
  const region = localStorage.getItem(PREF_REGION) || 'use';

  // Set hidden inputs
  const typeInput   = document.getElementById('settingInstanceType');
  const regionInput = document.getElementById('settingRegion');
  if (typeInput)   typeInput.value   = type;
  if (regionInput) regionInput.value = region;

  // Update displayed labels
  const typeSelect   = document.getElementById('instanceTypeSelect');
  const regionSelect = document.getElementById('instanceRegionSelect');
  if (typeSelect)   typeSelect.querySelector('.selected-label').textContent   = INSTANCE_TYPE_LABELS[type]   || type;
  if (regionSelect) regionSelect.querySelector('.selected-label').textContent = REGION_LABELS[region]        || region;

  // Mark selected option
  typeSelect?.querySelectorAll('.glass-option').forEach(o =>
    o.classList.toggle('selected', o.dataset.val === type));
  regionSelect?.querySelectorAll('.glass-option').forEach(o =>
    o.classList.toggle('selected', o.dataset.val === region));
}

function saveJoinPrefs() {
  const type   = document.getElementById('settingInstanceType')?.value   || 'hidden';
  const region = document.getElementById('settingRegion')?.value         || 'use';
  localStorage.setItem(PREF_TYPE, type);
  localStorage.setItem(PREF_REGION, region);

  const status = document.getElementById('joinPrefsSaveStatus');
  if (status) {
    status.style.display = 'inline';
    setTimeout(() => { status.style.display = 'none'; }, 2500);
  }
}

async function loadCacheStats() {
  const container = document.getElementById('cacheStatsContainer');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85em;padding:12px;text-align:center;">正在读取...</div>';

  await idb.init();
  let allKeys = [];
  try { allKeys = await idb.keys(); } catch(_) {}

  const CATEGORIES = [
    { id: 'friend',  label: '好友数据',        emoji: '👥', desc: '好友列表缓存',          match: k => k === 'friend_basics' },
    { id: 'profile', label: '我的资料',        emoji: '🪪', desc: '个人资料缓存',           match: k => k === 'my_profile' },
    { id: 'avatar',  label: '模型缓存',        emoji: '🎭', desc: '模型列表与收藏夹数据',   match: k => k.startsWith('avatar') || k.startsWith('avatars_') },
    { id: 'world',   label: '世界缓存',        emoji: '🌍', desc: '世界列表与收藏夹数据',   match: k => k.startsWith('world') || k.startsWith('worlds_') },
    { id: 'names',   label: '名称映射',        emoji: '📋', desc: '模型 ID → 名称映射',    match: k => k === 'persistent_avatar_names' },
    { id: 'other',   label: '其他数据',        emoji: '📦', desc: '其他本地缓存',           match: k => true },
  ];

  const catKeys = {};
  CATEGORIES.forEach(c => catKeys[c.id] = []);
  for (const k of allKeys) {
    let matched = false;
    for (const cat of CATEGORIES.slice(0, -1)) {
      if (cat.match(k)) { catKeys[cat.id].push(k); matched = true; break; }
    }
    if (!matched) catKeys['other'].push(k);
  }

  // Image blob count
  let imageCount = 0;
  try {
    imageCount = await new Promise(res => {
      const tx = idb.db.transaction('images','readonly');
      const req = tx.objectStore('images').count();
      req.onsuccess = () => res(req.result);
      req.onerror  = () => res(0);
    });
  } catch(_) {}

  let html = '';

  // Render category rows
  for (const cat of CATEGORIES) {
    const keys = catKeys[cat.id];
    if (keys.length === 0) continue;
    html += `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:14px;">
        <span style="font-size:1.5em;">${cat.emoji}</span>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:0.9em;">${cat.label}</div>
          <div style="font-size:0.75em;color:var(--text-muted);margin-top:2px;">${cat.desc} · ${keys.length} 条记录</div>
        </div>
        <button onclick="clearCacheCategory(${JSON.stringify(keys.map(k=>k))})" class="btn btn-secondary" style="padding:6px 14px;font-size:0.82em;flex-shrink:0;">清除</button>
      </div>`;
  }

  // Image blob row
  if (imageCount > 0) {
    html += `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:14px;">
        <span style="font-size:1.5em;">🖼️</span>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:0.9em;">图片缓存 (Blob)</div>
          <div style="font-size:0.75em;color:var(--text-muted);margin-top:2px;">本地图片 Blob 缓存 · ${imageCount} 张</div>
        </div>
        <button onclick="clearImageCache()" class="btn btn-secondary" style="padding:6px 14px;font-size:0.82em;flex-shrink:0;">清除</button>
      </div>`;
  }

  if (!html) {
    html = '<div style="color:var(--text-muted);font-size:0.85em;padding:20px;text-align:center;background:var(--bg-card);border-radius:12px;">✅ 缓存为空，无需清除</div>';
  }

  container.innerHTML = html;
}

async function clearCacheCategory(keys) {
  if (!confirm(`确定清除这 ${keys.length} 条缓存记录？`)) return;
  await idb.init();
  await new Promise(r => {
    const tx = idb.db.transaction('cache','readwrite');
    const store = tx.objectStore('cache');
    let pending = keys.length;
    if (pending === 0) { r(); return; }
    keys.forEach(k => {
      const req = store.delete(k);
      req.onsuccess = req.onerror = () => { if (--pending === 0) r(); };
    });
  });
  loadCacheStats();
  showToast(`已清除 ${keys.length} 条缓存`, 'success');
}

async function clearImageCache() {
  if (!confirm('确定清除所有图片 Blob 缓存？')) return;
  await idb.init();
  await new Promise(r => {
    const tx = idb.db.transaction('images','readwrite');
    tx.objectStore('images').clear();
    tx.oncomplete = r; tx.onerror = r;
  });
  loadCacheStats();
  showToast('已清除图片缓存', 'success');
}

async function clearAllCacheNow() {
  if (!confirm('确定要清除所有本地缓存吗？（包括图片 Blob）')) return;
  await idb.init();
  await new Promise(r => { const tx = idb.db.transaction('cache','readwrite'); tx.objectStore('cache').clear(); tx.oncomplete=r; tx.onerror=r; });
  await new Promise(r => { const tx = idb.db.transaction('images','readwrite'); tx.objectStore('images').clear(); tx.oncomplete=r; tx.onerror=r; });
  loadCacheStats();
  showToast('已清除所有缓存', 'success');
}

// ── Categories ──
