/*
 * VRCW — search.js
 * avtrDB 公开搜索/搜索结果详情/穿戴/Fallback/Impostor
 *
 * 注意：本项目为「经典脚本」(非 ES module)，全部按顺序加载、共享全局作用域。
 * 函数声明会提升为全局，跨文件调用没问题；请勿改为 type="module"。
 */
let avtrdbPage = 0;
// Persistent dedup state — reset on new search, survives Load More and auto-fill pages
let _avtrdbDedupMap = new Map(); // id -> avatar data
let _avtrdbRenderMap = new Map(); // id -> card DOM element
const SEARCH_TARGET = 500; // target unique cards per search session
let _avtrdbHasMore = false; // module-level so auto-fill recursion can read it

let avtrdbCurrentQuery = "";
let avtrdbCurrentPlatform = "";
let avtrdbDebounceTimer = null;
let avtrdbTotalLoaded = 0;
// The avatar object currently shown in the detail modal. Set by displayAvatarDetail()
// so the "save to local" fav-menu button has something to pass to saveToLocalFavorite().
// (Fixes a ReferenceError: the inline onclick referenced an undefined `currentAvatarDetail`.)
let _currentDetailAvatar = null;
// Global wrapper so the inline onclick can reach the (lexically-scoped) module var.
// NOTE: a top-level `let` is NOT a window property, so inline handlers can't read
// `_currentDetailAvatar` directly — but a function *declaration* IS global. Route
// the fav-menu button through this.
function saveCurrentDetailToLocal() {
  if (_currentDetailAvatar) saveToLocalFavorite(_currentDetailAvatar);
}

// Builds the favorite group list HTML with checkmarks for groups where the avatar
// is already favorited. Clicking a checked group unfavorites; unchecked adds.
function _buildFavGroupListHtml(favList, id) {
  const favedGroups = avatarFavTagMap.get(id) || new Set();
  const isLocalFaved = localAvatarIdMap.has(id);

  let html = '';
  // Local favorites row
  if (isLocalFaved) {
    html += `<button class="avtrdb-fav-group-btn avtrdb-fav-group-active" onclick="removeFromLocalFavorite('${escJsAttr(id)}'); _refreshDetailAfterFavChange('${escJsAttr(id)}');">✓ 📦 本地收藏</button>`;
  } else {
    html += `<button class="avtrdb-fav-group-btn" style="color:var(--secondary);border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:4px;" onclick="saveCurrentDetailToLocal(); _refreshDetailAfterFavChange('${escJsAttr(id)}');">+ 📦 保存到本地 (200槽位)</button>`;
  }

  // Cloud groups
  if (favoriteGroups.length === 0) {
    html += `<div style="padding:8px 12px;font-size:0.8em;color:var(--text-muted);">请先加载收藏夹</div>`;
  } else {
    html += favoriteGroups.map(g => {
      const count = avatarFavGroupCounts.get(g.name) || 0;
      const cap = 50;
      const full = count >= cap;
      const isFavedInGroup = favedGroups.has(g.name);
      const lbl = `<span style="margin-left:4px;font-size:0.8em;opacity:0.7;color:${full && !isFavedInGroup ?'#f87171':'inherit'}">(${count}/${cap})</span>`;
      const displayName = escHtml(g.displayName || g.name);

      if (isFavedInGroup) {
        // Already in this group — click to unfavorite
        return `<button class="avtrdb-fav-group-btn avtrdb-fav-group-active" onclick="unfavoriteFromGroup('${escJsAttr(id)}','${escJsAttr(g.name)}',this)">✓ ${displayName} ${lbl}</button>`;
      } else {
        // Not in this group — click to add
        return `<button class="avtrdb-fav-group-btn" ${full?'disabled title="收藏夹已满"':''} onclick="addToFavorite('${escJsAttr(id)}','${escJsAttr(g.name)}',this)">${displayName} ${lbl}</button>`;
      }
    }).join("");
  }
  favList.innerHTML = html;
}


function onSearchCategoryChange() {
  const cat = document.getElementById("searchCategory")?.value;
  const platWrap = document.querySelector(".search-platform-select");
  const searchInput = document.getElementById("avtrdbSearch");

  // Show platform filter for avatars and worlds; hide for users/groups
  const showPlatform = cat === "avatars" || cat === "worlds";
  if (platWrap) platWrap.style.visibility = showPlatform ? "visible" : "hidden";

  // Update placeholder text based on category
  const placeholders = {
    avatars: "搜索模型 / Search avatars...",
    users:   "搜索玩家 / Search users...",
    worlds:  "搜索世界 / Search worlds...",
    groups:  "搜索群组 / Search groups...",
  };
  if (searchInput) searchInput.placeholder = placeholders[cat] || "搜索 / Search...";

  // Only trigger search if there's a query
  if (searchInput?.value.trim()) doAvtrdbSearch();
}

function onAvtrdbInput() {
  clearTimeout(avtrdbDebounceTimer);
  avtrdbDebounceTimer = setTimeout(doAvtrdbSearch, 600);
}


async function doAvtrdbSearch() {
  const query = document.getElementById("avtrdbSearch")?.value.trim() || "";
  const cat = document.getElementById("searchCategory")?.value || "avatars";
  const platform = document.getElementById("avtrdbPlatform")?.value || "";
  
  if (!query) return;
  avtrdbCurrentQuery = query;
  avtrdbCurrentPlatform = platform;
  window.searchCurrentCat = cat;
  
  avtrdbPage = 0;
  avtrdbTotalLoaded = 0;
  _avtrdbHasMore = false;
  _avtrdbDedupMap = new Map();
  _avtrdbRenderMap = new Map();

  const grid = document.getElementById("avtrdbGrid");
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,255,255,0.4);">搜索中...</div>`;
  document.getElementById("avtrdbStats").textContent = "";
  document.getElementById("avtrdbLoadMore").style.display = "none";
  
  if (cat === 'avatars') {
    await avtrdbFetch(false);
  } else {
    await vrcdbFetch(cat, query);
  }
}

async function vrcdbFetch(cat, query) {
  const grid = document.getElementById("avtrdbGrid");
  const stats = document.getElementById("avtrdbStats");
  
  try {
    let url = '';
    if (cat === 'users') url = `/api/vrc/users?search=${encodeURIComponent(query)}&n=50`;
    else if (cat === 'worlds') url = `/api/vrc/worlds?search=${encodeURIComponent(query)}&n=50`;
    else if (cat === 'groups') url = `/api/vrc/groups?query=${encodeURIComponent(query)}&n=50`;
    
    const resp = await apiCall(url);
    const data = await resp.json();
    
    if (!data || data.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.4);padding:40px;">未找到结果 (No results)</div>';
      return;
    }
    stats.textContent = `找到 ${data.length} 个结果`;
    
    // Filter by platform if applicable
    const plat = document.getElementById("avtrdbPlatform")?.value || "";
    let filteredData = data;
    if (plat && cat === 'worlds') {
      const required = plat.split('+');
      filteredData = data.filter(w => {
        const wPlats = w.platforms || (w.unityPackages ? w.unityPackages.map(p => p.platform) : []);
        return required.every(p => wPlats.includes(p));
      });
      stats.textContent = `找到 ${data.length} 个结果 (过滤后 ${filteredData.length})`;
    }

    if (cat === 'users') {
      grid.innerHTML = filteredData.map(u => {
        const fJson = escAttrJson(u);
        return `<div class="friend-card" onclick="openFriendProfile(this);" data-friend="${fJson}">
          <div class="friend-avatar-wrap">
            <img src="${escHtml(proxyImg(u.userIcon||u.profilePicOverride||u.currentAvatarThumbnailImageUrl||''))}" onerror="this.style.display=\'none\'">
          </div>
          <div class="friend-info">
            <div class="friend-name">${escHtml(u.displayName)}</div>
            <div class="friend-location" style="font-size:0.75em;color:var(--text-muted);">${escHtml(u.statusDescription||'')}</div>
          </div>
        </div>`;
      }).join('');
    } else if (cat === 'worlds') {
      grid.innerHTML = '';
      filteredData.forEach(w => {
        const thumb = proxyImg(w.thumbnailImageUrl || w.imageUrl || '');
        const isFaved = worldFavoriteIdMap.has(w.id);
        const isCached = loadedImageUrls.has(thumb);
        const card = document.createElement('div');
        card.className = 'avatar-card';
        card.style.cursor = 'pointer';
        card.onclick = () => openWorldDetail(w.id, w);
        card.innerHTML = `<div class="avatar-thumb-wrapper ${isCached?'':'img-loading'}">
          ${isCached
            ? `<img class="avatar-thumb" src="${escHtml(thumb)}" alt="">`
            : `<img class="avatar-thumb loading" src="${BLANK}" data-src="${escHtml(thumb)}" alt="">`}
          <div class="avatar-name-overlay">${escHtml(w.name||'未知世界')}</div>
          <div style="position:absolute;bottom:6px;left:6px;z-index:10;">
            <div data-fav-btn="${escHtml(w.id)}" onclick="quickWorldFav('${escHtml(w.id)}',event)"
              style="width:26px;height:26px;border-radius:6px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:0.85em;" title="${isFaved?'取消收藏':'添加到收藏夹'}">${isFaved?'\u2b50':'\u2606'}</div>
          </div>
          <div style="position:absolute;bottom:8px;right:8px;display:flex;gap:4px;z-index:5;">
            ${(w.occupants||0)>0 ? `<div class="world-player-badge" style="position:static;margin:0;">\u{1f465} ${w.occupants}</div>` : ''}
            ${(w.favorites||0)>0 ? `<div style="background:rgba(0,0,0,0.55);color:#fbbf24;font-size:0.7em;padding:2px 6px;border-radius:4px;">\u2b50 ${w.favorites}</div>` : ''}
          </div>
        </div>`;
        grid.appendChild(card);
        if (!isCached && thumb) {
          const img = card.querySelector('.avatar-thumb[data-src]');
          if (img) avatarObserver.observe(img);
        }
      });

    } else if (cat === 'groups') {
      grid.innerHTML = filteredData.map(g => {
        return `<div class="friend-card" style="box-shadow: 0 4px 12px rgba(0,0,0,0.5);border:1px solid var(--border);">
          <div class="friend-avatar-wrap" style="border-radius:12px;">
            <img src="${escHtml(proxyImg(g.iconUrl||''))}" style="border-radius:12px;" onerror="this.style.display=\'none\'">
          </div>
          <div class="friend-info">
            <div class="friend-name">${escHtml(g.name)} <span style="font-size:0.7em;opacity:0.6;">${escHtml(g.shortCode)}</span></div>
            <div class="friend-location" style="font-size:0.8em;">👥 ${g.memberCount||0} Members</div>
          </div>
        </div>`;
      }).join('');
    }
  } catch(e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--error);padding:40px;">搜索失败: ${e.message}</div>`;
  }
}

async function avtrdbLoadMore() {
  const grid = document.getElementById("avtrdbGrid");
  const currentCount = grid.querySelectorAll('.avatar-card').length;
  window._avtrdbLoadMoreTarget = currentCount + SEARCH_TARGET;
  // avtrdbFetch manages page advancement internally (startPage + PAGES_PER_BATCH)
  // Just call it with append flag; it will use avtrdbPage which was left at batch end
  avtrdbPage++; // advance to next batch start
  await avtrdbFetch(true);
}

// Current sort mode for avatar search: 'relevance' | 'newest' | 'name'
// Persisted in localStorage so a chosen sort survives reloads — mirrors VRCX.
let avtrdbSortMode = (function () {
  try { return localStorage.getItem('vrcw_avtrdb_sort') || 'relevance'; }
  catch (_) { return 'relevance'; }
})();

// On script load, paint the saved sort onto the chip row. Without this the
// HTML's hardcoded `<button class="sort-chip active" data-sort="relevance">`
// would remain highlighted even when the user previously selected newest/name.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#avtrdbSortBtns .sort-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.sort === avtrdbSortMode));
});

function setAvtrdbSort(mode) {
  if (avtrdbSortMode === mode) return;
  avtrdbSortMode = mode;
  try { localStorage.setItem('vrcw_avtrdb_sort', mode); } catch (_) {}
  document.querySelectorAll('#avtrdbSortBtns .sort-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.sort === mode));
  _rerenderAvtrdbGrid(); // re-sort already-collected results, no refetch
}

// Build one normalized avatar card element from a collected record.
function _buildAvtrdbCard(av) {
  const id = av.vrc_id;
  const card = document.createElement("div");
  card.className = "avatar-card";
  card.style.cursor = "pointer";
  card.title = "点击查看详情";
  card.setAttribute('data-avid', id);
  card.addEventListener("click", () => openAvtrdbDetail(av));
  _avtrdbRenderMap.set(id, card);

  const ratings = getAvatarPlatforms(av);
  const platBadges = Array.from(ratings.keys()).map(p =>
    `<span class="avtrdb-badge">${{ pc: "PC", android: "Quest", ios: "Apple" }[p] || p}</span>`
  ).join("");

  card.innerHTML = `
    <div class="avatar-thumb-wrapper">
      <img class="avatar-thumb" src="${escHtml(av.image_url || "")}"
           alt="${escHtml(av.name || "")}"
           loading="lazy" decoding="async"
           onerror="this.style.opacity='0.3'">
      <div class="avatar-name-overlay">${escHtml(av.name || "未知模型")}</div>
    </div>
    <div style="padding:8px 6px 4px;font-size:0.7em;color:rgba(255,255,255,0.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
      by ${escHtml(av.author?.name || av.authorName || "Unknown")}
    </div>
    <div class="card-plat-badges" style="padding:0 6px 10px;display:flex;gap:4px;flex-wrap:wrap;">${platBadges}</div>
  `;

  // Lazy metadata enrichment when the card scrolls into view
  if (!(av.unityPackages && av.unityPackages.length > 0)) {
    const io = new IntersectionObserver((entries, obs) => {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      avatarMetadataQueue.add(id, (data) => {
        Object.assign(av, {
          unityPackages: data.unityPackages || av.unityPackages,
          performance: (data.performance && Object.keys(data.performance).length) ? data.performance : av.performance,
          created_at: av.created_at || data.created_at || data.createdAt,
          updated_at: av.updated_at || data.updated_at || data.updatedAt,
          description: av.description || data.description || ""
        });
        const badgeWrap = card.querySelector('.card-plat-badges');
        if (badgeWrap) {
          const liveRatings = getAvatarPlatforms(av);
          badgeWrap.innerHTML = Array.from(liveRatings.keys()).map(p =>
            `<span class="avtrdb-badge">${{ pc: "PC", android: "Quest", ios: "Apple" }[p] || p}</span>`
          ).join("");
        }
      });
    }, { rootMargin: '200px' });
    io.observe(card);
  }
  return card;
}

// Score + sort all collected records, then (re)render the grid in order.
// This is the core of the relevance ranking: results are ordered by how well
// they match the query, with quality/recency as tiebreakers.
function _rerenderAvtrdbGrid() {
  const grid = document.getElementById("avtrdbGrid");
  const stats = document.getElementById("avtrdbStats");
  if (!grid) return;

  const requiredPlats = avtrdbCurrentPlatform ? avtrdbCurrentPlatform.split("+") : [];
  const q = avtrdbCurrentQuery;

  // Collect candidates, applying the platform filter
  let items = Array.from(_avtrdbDedupMap.values()).filter(av => {
    if (!av.vrc_id) return false;
    if (requiredPlats.length > 0) {
      const r = getAvatarPlatforms(av);
      if (!requiredPlats.every(p => r.has(p))) return false;
    }
    return true;
  });

  // Sort
  if (avtrdbSortMode === 'name') {
    items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  } else if (avtrdbSortMode === 'newest') {
    items.sort((a, b) => new Date(b.updated_at || b.updatedAt || b.created_at || b.createdAt || 0)
                       - new Date(a.updated_at || a.updatedAt || a.created_at || a.createdAt || 0));
  } else { // relevance (default)
    items.forEach(av => {
      av._rel = relevanceScore(av, q);
      av._qual = qualityScore(av);
    });
    items.sort((a, b) => (b._rel - a._rel) || (b._qual - a._qual)
      || String(a.name || '').localeCompare(String(b.name || '')));
  }

  // Render in sorted order, reusing already-built card elements where possible
  const frag = document.createDocumentFragment();
  for (const av of items) {
    let card = _avtrdbRenderMap.get(av.vrc_id);
    if (!card) card = _buildAvtrdbCard(av);
    frag.appendChild(card); // appendChild moves existing nodes into new order
  }
  grid.innerHTML = '';
  grid.appendChild(frag);

  // Lazy-load thumbnails that use data-src (none here — search uses direct src), no-op safe
  const platLabelMap = { pc:"PC", android:"Quest", ios:"Apple", "pc+android":"PC + Quest", "pc+android+ios":"PC + Quest + Apple" };
  const platLabel = avtrdbCurrentPlatform ? (platLabelMap[avtrdbCurrentPlatform] || avtrdbCurrentPlatform) : "全平台";
  const sortLabel = { relevance: '相关度', newest: '最新', name: '名称' }[avtrdbSortMode] || '相关度';
  avtrdbTotalLoaded = items.length;
  if (stats) stats.textContent = `已显示 ${items.length} 个结果（${platLabel} · 按${sortLabel}排序）${_avtrdbHasMore ? " · 还有更多" : " · 全部加载完毕"}`;
}

async function avtrdbFetch(append, _signal) {
  // Use the signal from the caller or fall back to the global tab abort signal
  const signal = _signal || currentTabAbortController?.signal;
  const grid = document.getElementById("avtrdbGrid");
  const stats = document.getElementById("avtrdbStats");
  const loadMoreBtn = document.getElementById("avtrdbLoadMore");

  const requiredPlats = avtrdbCurrentPlatform ? avtrdbCurrentPlatform.split("+") : [];
  const dedupMap = _avtrdbDedupMap;   // persistent global across Load More

  // Collect-only aggregator: dedup + keep the RICHEST record per id.
  // Rendering is deferred until all sources settle, so we can sort by relevance.
  const collect = (av) => {
    const id = av.vrc_id;
    if (!id) return;
    if (dedupMap.has(id)) {
      const existing = dedupMap.get(id);
      const richness = o => ((o.unityPackages && o.unityPackages.length) ? 2 : 0)
        + ((o.performance && Object.keys(o.performance).length > 2) ? 1 : 0)
        + (o.image_url || o.imageUrl ? 1 : 0)
        + (o.name && o.name !== '未知模型' ? 1 : 0);
      if (richness(av) > richness(existing)) {
        // Adopt richer record but keep any fields the old one had
        dedupMap.set(id, Object.assign({}, existing, av));
      } else {
        if (av.description && !existing.description) existing.description = av.description;
        if (Array.isArray(av.tags)) existing.tags = [...new Set([...(existing.tags || []), ...av.tags])];
        if (!existing.image_url && (av.image_url || av.imageUrl)) existing.image_url = av.image_url || av.imageUrl;
      }
      return;
    }
    dedupMap.set(id, av);
  };

  // Loading spinner on fresh search
  if (!append) {
    grid.innerHTML = `<div id="avtrdb-loading-spinner" style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:16px;color:rgba(255,255,255,0.5);">
      <div style="width:48px;height:48px;border:3px solid rgba(255,255,255,0.15);border-top-color:rgba(255,255,255,0.7);border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      <div style="font-size:0.85em;">正在从 5 个数据库搜索并按相关度排序...</div>
    </div>`;
  }

  try {
    // One AvtrDB page → collect (no render)
    const startPage = avtrdbPage;
    const fetchAvtrdbPage = (pageNum) => {
      let url = `https://api.avtrdb.com/v2/avatar/search?query=${encodeURIComponent(avtrdbCurrentQuery)}&page_size=100&page=${pageNum}`;
      if (requiredPlats.length > 0) url += `&compatibility=${requiredPlats[0]}`;
      return fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { signal })
        .then(r => r.json())
        .then(data => {
          if (pageNum === startPage) {
            _avtrdbHasMore = data.has_more || false;
          }
          (data.avatars || []).forEach(av => collect({
            ...av, vrc_id: av.vrc_id, image_url: av.image_url,
            compatibility: av.compatibility || [], performance: av.performance || {}
          }));
        })
        .catch(() => {});
    };

    const PAGES_PER_BATCH = 5;
    const avtrdbPromises = Array.from({ length: PAGES_PER_BATCH }, (_, i) => fetchAvtrdbPage(startPage + i));
    avtrdbPage = startPage + PAGES_PER_BATCH - 1;

    // Community DBs — first search only
    const communityPromises = [];
    if (startPage === 0) {
      const dbSources = [
        { name: 'vrcdb', url: `/api/proxy?url=${encodeURIComponent(`https://vrcx.vrcdb.com/avatars/Avatar/VRCX?search=${encodeURIComponent(avtrdbCurrentQuery)}`)}` },
        { name: 'avatarrecovery', url: `/api/proxy?url=${encodeURIComponent(`https://api.avatarrecovery.com/Avatar/vrcx?search=${encodeURIComponent(avtrdbCurrentQuery)}`)}` },
        { name: 'cute.bet', url: `/api/proxy?url=${encodeURIComponent(`https://avtr.cute.bet/search?search=${encodeURIComponent(avtrdbCurrentQuery)}`)}` },
        { name: 'nekosunevr', url: `/api/proxy?url=${encodeURIComponent(`https://avtr.nekosunevr.co.uk/vrcx_search?search=${encodeURIComponent(avtrdbCurrentQuery)}`)}` }
      ];
      dbSources.forEach(db => {
        communityPromises.push(fetch(db.url, { signal })
          .then(r => r.json())
          .then(data => {
            const list = (Array.isArray(data) ? data : data?.avatars || []).slice(0, 100);
            list.forEach(av => {
              if (db.name === 'cute.bet') {
                collect({ ...av, vrc_id: av.id, image_url: av.imageUrl || av.thumbnailImageUrl || "",
                  author: { name: av.authorName || "Unknown", id: av.authorId }, unityPackages: av.unityPackages || [] });
              } else {
                collect({ vrc_id: av.id, name: av.name || av.avatarName || "未知模型",
                  author: { name: av.authorName || "Unknown", id: av.authorId },
                  image_url: av.imageUrl || av.thumbnailImageUrl || "",
                  performance: av.performance || {},
                  compatibility: av.compatibility || (av.imageUrl ? ["pc"] : []),
                  description: av.description || "" });
              }
            });
          })
          .catch(() => {}));
      });
    }

    await Promise.allSettled([...avtrdbPromises, ...communityPromises]);
    if (signal?.aborted) return;

    document.getElementById('avtrdb-loading-spinner')?.remove();

    if (dedupMap.size === 0) {
      stats.textContent = "未找到符合条件的模型 / No matching avatars found";
      grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:rgba(255,255,255,0.4);gap:12px;">
        <div style="font-size:3em;">🔍</div>
        <div>未找到相关模型 / No avatars found</div>
      </div>`;
      loadMoreBtn.style.display = "none";
      return;
    }

    // Score, sort, render
    _rerenderAvtrdbGrid();
    window._avtrdbLoadMoreTarget = null;
    loadMoreBtn.style.display = _avtrdbHasMore ? "inline-block" : "none";

  } catch (e) {
    if (!append) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#ef4444;">搜索失败: ${escHtml(e.message)}</div>`;
  }
}





function displayAvatarDetail(av) {
  const modal = document.getElementById("avtrdbDetailModal");
  if (!modal) return;
  _currentDetailAvatar = av; // remember for the fav-menu "save to local" action
  // 1. Normalize fields (handle both VRChat API and AvtrDB/VRCX formats)
  const id = av.vrc_id || av.id || "";
  let name = av.name || av.avatarName || "";
  
  // Recovery: Check global favorites map
  if ((!name || name === 'Unknown' || name.startsWith('Model ')) && window._localNameMap?.has(id)) {
    name = window._localNameMap.get(id);
    av.name = name; // Update memory
  }
  if (!name || name === 'Unknown') name = `Model ${id.substring(5, 13)}`;
  const author = av.author?.name || av.authorName || "Unknown";
  const desc = av.description || "";
  let thumb = av.image_url || av.thumbnailImageUrl || av.imageUrl || "";
  
  // Proxy VRChat images
  if (thumb && (thumb.includes("api.vrchat.cloud") || thumb.includes("files.vrchat.cloud"))) {
    thumb = `${API_BASE}/api/image?url=${encodeURIComponent(thumb)}&auth=${encodeURIComponent(vrcAuth || "")}`;
  }

  const createdAt = av.created_at || av.createdAt;
  const updatedAt = av.updated_at || av.updatedAt;

  // 2. Populate UI
  document.getElementById("avtrdbDetailImg").src = thumb;
  document.getElementById("avtrdbDetailName").textContent = name;
  document.getElementById("avtrdbDetailAuthor").textContent = author;
  document.getElementById("avtrdbDetailId").textContent = id;

  const fmt = d => d ? new Date(d).toLocaleString("zh-CN", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }) : "-";
  document.getElementById("avtrdbDetailCreated").textContent = fmt(createdAt);
  document.getElementById("avtrdbDetailUpdated").textContent = fmt(updatedAt);

  // 3. Platform & Performance Logic (Strict Alignment)
  const platMap = { pc: "PC", android: "Quest", ios: "Apple" };
  const ratingColor = r => ({ VeryPoor:"#ef4444", Poor:"#f59e0b", Medium:"#eab308", Good:"#22c55e", Excellent:"#a3e635" }[r] || "#64748b");
  const ratingHtml = (label, r) => r && r !== "None" ? `<span style="display:inline-block;font-size:0.75em;color:${ratingColor(r)};background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:4px;border:1px solid ${ratingColor(r)}40;margin-right:8px;margin-bottom:4px;">${label}: ${r}</span>` : "";

  const ratingsMap = getAvatarPlatforms(av);
  const plats = Array.from(ratingsMap.keys());

  // Render Platform Badges at top
  const platBadges = plats.map(p =>
    `<span class="avtrdb-badge" style="font-size:0.85em;padding:3px 10px;">${platMap[p] || p}</span>`
  ).join("") || "<span style='color:rgba(255,255,255,0.4)'>-</span>";
  document.getElementById("avtrdbDetailPlats").innerHTML = platBadges;

  // Render Performance section (only show platforms that have actual ratings)
  const perfumes = plats.map(p => ratingHtml(platMap[p] || p, ratingsMap.get(p))).filter(Boolean);
  const perfHtml = perfumes.join("") || "<span style='color:rgba(255,255,255,0.4)'>-</span>";
  document.getElementById("avtrdbDetailPerf").innerHTML = perfHtml;

  const descRow = document.getElementById("avtrdbDetailDescRow");
  document.getElementById("avtrdbDetailDesc").textContent = desc;
  descRow.style.display = desc ? "" : "none";

  // 3b. Release status (Public/Private). VRChat owned-avatar objects carry
  // `releaseStatus`; AvtrDB/community search records sometimes don't, so only
  // show the badge when we actually know. Shown on EVERY detail open
  // regardless of which view (mine / favorites / search) launched it.
  const relRow = document.getElementById("avtrdbDetailReleaseRow");
  const relEl = document.getElementById("avtrdbDetailRelease");
  if (relRow && relEl) {
    const rs = av.releaseStatus || av.release_status || "";
    if (rs === 'public') {
      relEl.textContent = '🌐 Public';
      relEl.style.background = 'var(--success)';
      relEl.style.color = '#052e16';
      relRow.style.display = '';
    } else if (rs === 'private') {
      relEl.textContent = '🔒 Private';
      relEl.style.background = 'rgba(0,0,0,0.55)';
      relEl.style.color = '#fff';
      relRow.style.display = '';
    } else {
      // Unknown — hide rather than show a misleading default.
      relRow.style.display = 'none';
    }
  }

  // 4. Favorites Status — unified group selector
  // The button always opens the fav-group menu. Groups where this avatar is
  // already favorited show a ✓ checkmark; clicking them triggers unfavorite.
  // Groups without a checkmark add the avatar on click.
  document.getElementById("avtrdbFavStatus").textContent = "";
  document.getElementById("avtrdbFavMenu")?.classList.add("hidden");

  const favBtn = document.getElementById("avtrdbDetailFavBtn");
  const isLocalFaved = localAvatarIdMap.has(id);
  const isCloudFaved = favoriteIdMap.has(id);

  if (isCloudFaved || isLocalFaved) {
     favBtn.innerHTML = "⭐ 已收藏";
     favBtn.className = "btn btn-success-full";
  } else {
     favBtn.innerHTML = "⭐ 收藏";
     favBtn.className = "btn btn-secondary";
  }
  // Always open the group selector — for adding or removing
  favBtn.onclick = toggleAvtrdbFavMenu;

  // Pre-build the group list so it's ready when the menu opens
  const favList = document.getElementById("avtrdbFavGroupList");
  if (favList) {
     _buildFavGroupListHtml(favList, id);
  }

  // 5. Actions
  const switchBtn = document.getElementById("avtrdbDetailSwitchBtn");
  if (switchBtn) switchBtn.onclick = () => switchAvatar(id);

  // 6. Owner-only actions: edit + delete inside the detail modal.
  // Per-card edit/delete were removed; the detail modal is now the single
  // place these live, matching how worlds work (worldDetailDeleteBtn).
  const ownerRow = document.getElementById("avtrdbDetailOwnerActions");
  if (ownerRow) {
    const isOwner = currentUserId && av.authorId && av.authorId === currentUserId;
    // Use the .hidden class (display:none !important) instead of inline style
    // so we don't fight with our flex layout on show.
    ownerRow.classList.toggle('hidden', !isOwner);
    if (isOwner) {
      const editBtn = document.getElementById("avtrdbDetailEditBtn");
      const delBtn = document.getElementById("avtrdbDetailDeleteBtn");
      if (editBtn) editBtn.onclick = () => {
        // Close detail first so the edit modal owns the foreground.
        closeAvtrdbDetail();
        if (typeof editAvatar === 'function') editAvatar(id);
      };
      if (delBtn) delBtn.onclick = () => {
        if (typeof deleteAvatar === 'function') deleteAvatar(id, name);
      };
    }
  }

  modal.classList.remove("hidden");
  if (modal.dataset.scrollLocked !== '1') { lockBodyScroll(); modal.dataset.scrollLocked = '1'; }
  modal.style.zIndex = modalZTop();
}

async function openAvtrdbDetail(av) {
  displayAvatarDetail(av); // Show immediately with available data

  const id = av.vrc_id || av.id;
  if (!id) return;

  // If dates are missing, fetch from sources that reliably carry them
  if (!av.created_at && !av.createdAt) {
    // Try cute.bet first (returns updated_at reliably, sometimes created_at)
    const cuteUrl = `/api/proxy?url=${encodeURIComponent(`https://avtr.cute.bet/search?search=${id}`)}`;
    // Also try AvtrDB v2 single-id search (carries created_at)
    const avtrUrl = `/api/proxy?url=${encodeURIComponent(`https://api.avtrdb.com/v2/avatar/search?query=${id}&page_size=1`)}`;

    const tryPatch = (data) => {
      if (!data) return;
      const created = data.created_at || data.createdAt;
      const updated = data.updated_at || data.updatedAt;
      if (created || updated) {
        if (created && !av.created_at) av.created_at = created;
        if (updated && !av.updated_at) av.updated_at = updated;
        // Re-render dates in the open modal
        const fmt = d => d ? new Date(d).toLocaleString("zh-CN", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }) : "-";
        const elC = document.getElementById("avtrdbDetailCreated");
        const elU = document.getElementById("avtrdbDetailUpdated");
        if (elC) elC.textContent = fmt(av.created_at || av.createdAt);
        if (elU) elU.textContent = fmt(av.updated_at || av.updatedAt);
      }
    };

    // Fire both in parallel, patch as soon as either returns
    fetch(cuteUrl).then(r => r.json()).then(data => {
      const list = Array.isArray(data) ? data : (data?.avatars || []);
      const match = list.find(x => x.id === id) || (list.length === 1 ? list[0] : null) || (list.length > 0 ? list[0] : null);
      tryPatch(match);
    }).catch(() => {});

    fetch(avtrUrl).then(r => r.json()).then(data => {
      const list = data?.avatars || [];
      const match = list.find(x => x.vrc_id === id);
      tryPatch(match);
    }).catch(() => {});
  }
}

function openLocalDetail(id) { 
  const av = visibleAvatars.find(a => a.id === id);
  if (av) displayAvatarDetail(av); 
}


function closeAvtrdbDetail() {
  const modal = document.getElementById("avtrdbDetailModal");
  if (modal) {
    modal.classList.add("hidden");
    if (modal.dataset.scrollLocked === '1') { unlockBodyScroll(); modal.dataset.scrollLocked = ''; }
  }
  document.getElementById("avtrdbFavMenu")?.classList.add("hidden");
}

function toggleAvatarFavGridMenu(event, id, name, btn) {
  const menu = document.getElementById("avtrdbFavMenu");
  if (!menu) return;
  toggleFavMenuGeneric(event, menu, btn, () => {
    let html = `<button class="avtrdb-fav-group-btn" style="color:var(--secondary);border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:4px;" onclick="saveToLocalFavorite(visibleAvatars.find(a=>a.id==='${id}'))">📦 保存到本地 (200槽位)</button>`;
    if (favoriteGroups.length === 0) html += `<div style="padding:8px 12px;font-size:0.8em;color:var(--text-muted);">请先加载收藏夹</div>`;
    else html += favoriteGroups.map(g => {
      const count = avatarFavGroupCounts.get(g.name) || 0; const cap = 50; const full = count >= cap;
      const lbl = `<span style="margin-left:4px;font-size:0.8em;opacity:0.7;color:${full?'#f87171':'inherit'}">(${count}/${cap})</span>`;
      return `<button class="avtrdb-fav-group-btn" ${full?'disabled title="收藏夹已满"':''} onclick="addToFavorite('${escHtml(id)}','${escHtml(g.name)}',this)">${escHtml(g.displayName || g.name)} ${lbl}</button>`;
    }).join("");
    return html;
  });
}

function toggleAvtrdbFavMenu(event) {
  const menu = document.getElementById("avtrdbFavMenu");
  const btn = document.getElementById("avtrdbDetailFavBtn");
  if (!menu || !btn) return;
  toggleFavMenuGeneric(event, menu, btn, () => {
    const idRow = document.getElementById("avtrdbDetailId");
    const id = idRow ? idRow.textContent : "";
    // Use a temp container to build the HTML via _buildFavGroupListHtml
    const tmp = document.createElement('div');
    _buildFavGroupListHtml(tmp, id);
    return tmp.innerHTML;
  });
}

function toggleFavMenuGeneric(event, menu, btn, contentFn) {
  event.stopPropagation();
  if (!menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
    return;
  }
  const list = menu.querySelector('div:last-child');
  if (list) list.innerHTML = contentFn();

  menu.classList.remove("hidden");
  // Float above whatever modal is currently open. The hardcoded z-index:2000 in
  // the markup gets overridden here because friend/world detail modals use
  // modalZTop() which starts at 2001+ — the menu would otherwise paint BEHIND
  // the modal that opened it ("friend favorite button doesn't respond").
  if (typeof modalZPeek === 'function') {
    menu.style.zIndex = String(modalZPeek() + 5);
  }
  
  let left, top;
  if (btn) {
    const rect = btn.getBoundingClientRect();
    const menuH = menu.offsetHeight || 160;
    left = Math.min(rect.left, window.innerWidth - 200);
    top = rect.top - menuH - 6;
    if (top < 10) top = rect.bottom + 6;
  } else {
    left = Math.min(event.clientX, window.innerWidth - 200);
    top = Math.min(event.clientY, window.innerHeight - 200);
  }
  
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  
  const close = (e) => {
    if (!menu.contains(e.target)) {
      menu.classList.add("hidden");
      document.removeEventListener("click", close);
    }
  };
  setTimeout(() => document.addEventListener("click", close), 0);
}

async function addToFavorite(avtrId, groupName, btn) {
  document.getElementById("avtrdbFavMenu")?.classList.add("hidden");
  const statusEl = document.getElementById("avtrdbFavStatus");
  statusEl.style.color = "var(--text-muted)";
  statusEl.textContent = `正在收藏到 ${groupName}...`;
  if (btn) { btn.disabled = true; btn.style.opacity = "0.6"; }

  try {
    const resp = await apiCall("/api/vrc/favorites", {
      method: "POST",
      json: { type: "avatar", favoriteId: avtrId, tags: [groupName] },
    });
    if (resp.ok) {
      statusEl.style.color = "var(--success)";
      statusEl.textContent = `✓ 已收藏到 ${groupName}`;
      // Track the new favoriteId so the user can immediately unfavorite without
      // first refetching the whole favorites list. Same shape as syncAllFavoriteIds.
      const data = await resp.json().catch(() => null);
      if (data && data.id) favoriteIdMap.set(avtrId, data.id);
      // Track which group this avatar is now in
      const existing = avatarFavTagMap.get(avtrId);
      if (existing) existing.add(groupName);
      else avatarFavTagMap.set(avtrId, new Set([groupName]));
      // Bump the per-group counter so the sidebar "x/50" hint and the
      // disabled-when-full state are accurate without a roundtrip.
      avatarFavGroupCounts.set(groupName, (avatarFavGroupCounts.get(groupName) || 0) + 1);
      // Invalidate IDB cache for that group so next load fetches fresh
      try { await idb.set("avatars_" + groupName, null); } catch (_) {}
      // INSTANT UI: flip the unified card-fav-quick toggle from ☆ → ⭐
      const card = document.getElementById("card-" + avtrId);
      if (card) {
        const fq = card.querySelector('.card-fav-quick');
        if (fq) {
          fq.textContent = '⭐';
          fq.title = '已收藏';
        }
      }
      // Refresh the detail modal button to show "已收藏" state
      _refreshDetailAfterFavChange(avtrId);
    } else {
      const err = await resp.json().catch(() => ({}));
      statusEl.style.color = "var(--error)";
      statusEl.textContent = `✗ 收藏失败：${err.error?.message || resp.status}`;
    }
  } catch (e) {
    statusEl.style.color = "var(--error)";
    statusEl.textContent = `✗ 网络错误：${e.message}`;
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ""; }
  }
}

// Unfavorite from a specific group via the group selector in the detail modal.
// Unlike the old unfavorite() which removes the avatar from the current view list,
// this only removes the favorite link. The detail modal stays open.
async function unfavoriteFromGroup(avtrId, groupName, btn) {
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = '移除中...'; }
  const statusEl = document.getElementById("avtrdbFavStatus");
  try {
    // Resolve the favoriteId for this avatar
    const favId = favoriteIdMap.get(avtrId);
    if (!favId) {
      // Try live lookup
      const r = await apiCall(`/api/vrc/favorites?type=avatar&tag=${groupName}&n=100`);
      if (r.ok) {
        const list = await r.json();
        const hit = (list || []).find(f => f.favoriteId === avtrId);
        if (hit) favoriteIdMap.set(avtrId, hit.id);
      }
    }
    const resolvedFavId = favoriteIdMap.get(avtrId);
    if (!resolvedFavId) {
      if (statusEl) { statusEl.style.color = 'var(--error)'; statusEl.textContent = '✗ 找不到收藏记录'; }
      return;
    }
    const resp = await apiCall(`/api/vrc/favorites/${resolvedFavId}`, { method: 'DELETE' });
    if (!resp.ok && resp.status !== 404) {
      throw new Error('HTTP ' + resp.status);
    }
    // Update state
    favoriteIdMap.delete(avtrId);
    const tags = avatarFavTagMap.get(avtrId);
    if (tags) { tags.delete(groupName); if (tags.size === 0) avatarFavTagMap.delete(avtrId); }
    const cur = avatarFavGroupCounts.get(groupName) || 0;
    avatarFavGroupCounts.set(groupName, Math.max(0, cur - 1));
    try { await idb.set('avatars_' + groupName, null); } catch (_) {}
    if (statusEl) { statusEl.style.color = 'var(--success)'; statusEl.textContent = `✓ 已从 ${groupName} 移除`; }
    // Flip the card star back
    const card = document.getElementById('card-' + avtrId);
    if (card) {
      const fq = card.querySelector('.card-fav-quick');
      if (fq && !favoriteIdMap.has(avtrId) && !localAvatarIdMap.has(avtrId)) {
        fq.textContent = '☆'; fq.title = '添加到收藏';
      }
    }
    // Refresh detail modal
    _refreshDetailAfterFavChange(avtrId);
  } catch (e) {
    if (statusEl) { statusEl.style.color = 'var(--error)'; statusEl.textContent = `✗ 取消收藏失败: ${e.message}`; }
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

// Refresh the detail modal's favorite button and group list after a fav change.
// Called after addToFavorite / unfavoriteFromGroup / saveToLocal / removeFromLocal.
function _refreshDetailAfterFavChange(avtrId) {
  const modal = document.getElementById('avtrdbDetailModal');
  if (!modal || modal.classList.contains('hidden')) return;
  const displayedId = document.getElementById('avtrdbDetailId')?.textContent;
  if (displayedId !== avtrId) return;

  const favBtn = document.getElementById('avtrdbDetailFavBtn');
  const isCloudFaved = favoriteIdMap.has(avtrId);
  const isLocalFaved = localAvatarIdMap.has(avtrId);
  if (isCloudFaved || isLocalFaved) {
    favBtn.innerHTML = '⭐ 已收藏';
    favBtn.className = 'btn btn-success-full';
  } else {
    favBtn.innerHTML = '⭐ 收藏';
    favBtn.className = 'btn btn-secondary';
  }
  // Rebuild group list to reflect new checkmarks
  const favList = document.getElementById('avtrdbFavGroupList');
  if (favList) _buildFavGroupListHtml(favList, avtrId);
}

function openInVRCX(avtrId) {
  window.open(`vrcx://avatar/${avtrId}`, "_self");
}

async function switchAvatar(avtrId) {
  const btn = document.getElementById("avtrdbDetailSwitchBtn");
  const originalText = btn ? btn.innerHTML : "⚡ 切换模型";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "⚡ 正在切换...";
  }

  try {
    const resp = await apiCall(`/api/vrc/avatars/${avtrId}/select`, {
      method: "PUT"
    });
    const result = await resp.json().catch(() => ({}));
    if (resp.ok && !result.error) {
      logMsg("✅ 模型切换成功 (Avatar switched successfully)！", "success");
      if (btn) btn.innerHTML = "✅ 已切换";
    } else {
      throw new Error(result.error?.message || "未知错误");
    }
  } catch (e) {
    logMsg(`❌ 模型切换失败 (Failed to switch): ${e.message}`, "error");
    if (btn) btn.innerHTML = "❌ 切换失败";
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }, 2000);
  }
}

// ── Set Fallback Avatar (PUT /avatars/{id}/selectFallback) ──
// Fallback avatars must be public & PC-performance "Good" or better; the API
// rejects ineligible avatars, so we surface that error to the user.
async function setFallbackAvatar(avtrId, name) {
  if (!confirm(`将「${name || avtrId}」设为后备模型？\n\n（后备模型需为公开且 PC 性能良好以上）`)) return;
  try {
    const r = await apiCall(`/api/vrc/avatars/${avtrId}/selectFallback`, { method: 'PUT' });
    const res = await r.json().catch(() => ({}));
    if (r.ok && !res.error) {
      showToast('已设为后备模型', 'success');
      logMsg(`✅ 已将「${name || avtrId}」设为后备模型`, 'success');
    } else {
      throw new Error(res.error?.message || ('HTTP ' + r.status));
    }
  } catch(e) {
    showToast('设置后备模型失败: ' + e.message, 'error');
  }
}

// ── Impostor generation (Quest/mobile optimized clones) ──
async function enqueueImpostor(avtrId, name) {
  if (!confirm(`为「${name || avtrId}」生成 Impostor？\n\nImpostor 是 VRChat 自动生成的低性能替身，方便移动端显示。生成需要排队，可能耗时数分钟。`)) return;
  try {
    const r = await apiCall(`/api/vrc/avatars/${avtrId}/impostor/enqueue`, { method: 'POST' });
    const res = await r.json().catch(() => ({}));
    if (r.ok && !res.error) {
      showToast('已加入 Impostor 生成队列', 'success');
      logMsg(`✅ 已为「${name || avtrId}」排队生成 Impostor`, 'success');
    } else {
      throw new Error(res.error?.message || ('HTTP ' + r.status));
    }
  } catch(e) {
    showToast('生成 Impostor 失败: ' + e.message, 'error');
  }
}

async function deleteImpostor(avtrId, name) {
  if (!confirm(`删除「${name || avtrId}」的 Impostor？`)) return;
  try {
    const r = await apiCall(`/api/vrc/avatars/${avtrId}/impostor`, { method: 'DELETE' });
    if (r.ok) {
      showToast('已删除 Impostor', 'success');
      logMsg(`✅ 已删除「${name || avtrId}」的 Impostor`, 'info');
    } else {
      showToast('删除 Impostor 失败: HTTP ' + r.status, 'error');
    }
  } catch(e) {
    showToast('错误: ' + e.message, 'error');
  }
}


