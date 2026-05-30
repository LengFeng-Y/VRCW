/*
 * VRCW — avatars.js
 * 模型分类/列表渲染/收藏取消/清理/编辑删除/下载/文件拖拽
 *
 * 注意：本项目为「经典脚本」(非 ES module)，全部按顺序加载、共享全局作用域。
 * 函数声明会提升为全局，跨文件调用没问题；请勿改为 type="module"。
 */
let currentCategory = "mine";

function switchCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll(".cat-btn").forEach((btn) => {
    btn.classList.remove("active", "btn-primary");
    btn.classList.add("btn-secondary");
  });
  const activeBtn = document.getElementById("cat-" + cat);
  if (activeBtn) {
    activeBtn.classList.remove("btn-secondary");
    activeBtn.classList.add("btn-primary", "active");
  }

  // Immediately update context-dependent sidebar buttons
  const isFavoriteView = cat !== "mine";
  document.getElementById("btnCleanFavs")?.classList.toggle("hidden", !isFavoriteView);
  document.getElementById("btnUnfavoriteSelected")?.classList.toggle("hidden", !isFavoriteView);
  document.getElementById("btnSelectAll")?.classList.remove("hidden"); // Always visible
  document.getElementById("saveDirGroup")?.classList.toggle("hidden", isFavoriteView);
  document.querySelector('button[onclick="downloadSelected()"]')?.classList.toggle("hidden", isFavoriteView);

  // Close sidebar on mobile after selection
  document.getElementById("appSidebar")?.classList.remove("open");
  document.getElementById("sidebarOverlay")?.classList.remove("active");

  runPriorityTask(() => fetchAvatars());
}

// ── Selected Count Helper ──
function updateSelectedCount() {
  const el = document.getElementById("statSelected");
  if (el) el.textContent = selectedIds.size;
}

// ── Avatars ──
let fetchSeq = 0; // Track latest fetch to avoid stale renders
async function fetchAvatars(forceRefresh = false) {
  const seq = ++currentGlobalFetchSeq;
  fetchSeq = seq; 
  const grid = document.getElementById("avatarGrid");

  // ── Step 1: Load basics from cache immediately ──────────────────────────
  try {
    const cachedBasics = await idb.get('avatar_basics_' + currentCategory) || [];
    if (cachedBasics.length > 0 && !forceRefresh) {
      avatars = cachedBasics;
      applyFilters();
      logMsg(`Loaded ${avatars.length} cached avatars...`, "info");
    } else {
      if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:rgba(255,255,255,0.4);">加载中...</div>`;
    }
  } catch(e) {}

  // ── Step 2: Full Refresh ──────────────────────────────────────────────
  try {
    let allFetched = [];

    if (currentCategory === "mine") {
      const resp = await apiCall("/api/avatars");
      if (!resp.ok) throw new Error("Failed to fetch avatars");
      allFetched = await resp.json();
    } else if (currentCategory === "local") {
      allFetched = localAvatarFavs;
    } else {
      // VRC+ favorites max is around 256. Fetch sequentially to avoid rate-limiting (429 errors)
      let offset = 0;
      while (true) {
        if (seq !== currentGlobalFetchSeq) return;
        const resp = await apiCall(`/api/vrc/avatars/favorites?n=100&offset=${offset}&tag=${currentCategory}`);
        if (!resp.ok) break;
        const batch = await resp.json();
        if (!batch || batch.length === 0 || seq !== currentGlobalFetchSeq) break;
        allFetched = allFetched.concat(batch);
        if (batch.length < 100) break;
        offset += 100;
        if (offset >= 400) break; // Maximum safety ceiling for favorites
      }

      // Deduplicate by ID just in case
      const seen = new Set();
      allFetched = allFetched.filter(av => {
        if (seen.has(av.id)) return false;
        seen.add(av.id);
        return true;
      });
    }

    // If views changed while we waited, abandon stale render
    if (seq !== fetchSeq) return;
    avatars = allFetched;
    applyFilters();
    
    // Save basics only
    const basics = allFetched.map(a => ({
      id: a.id,
      name: a.name,
      thumbnailImageUrl: a.thumbnailImageUrl,
      imageUrl: a.imageUrl,
      releaseStatus: a.releaseStatus,
      authorId: a.authorId,  // needed for private-non-own cleanup filter
      tags: a.tags
    }));
    idb.set("avatar_basics_" + currentCategory, basics).catch(()=>{});
    logMsg(`✅ Sync complete: ${avatars.length} avatars`, "success");

    // Optimized: Disable background prefetch to save Cloudflare Worker requests
    // prefetchThumbnails(allFetched);

    try {
      await idb.set("avatars_" + currentCategory, allFetched);
    } catch (e) {}

    // If viewing a favorites category, also fetch the Favorite objects
    // so we have the favoriteId needed to unfavorite each avatar.
    if (currentCategory !== "mine") {
      try {
        const favPromises = [0, 100, 200, 300].map(offset =>
          apiCall(`/api/vrc/favorites?type=avatar&tag=${currentCategory}&n=100&offset=${offset}`)
            .then(r => (r.ok ? r.json() : []))
            .catch(() => [])
        );
        const favResults = await Promise.all(favPromises);
        favResults.forEach(favList => {
          if (favList && favList.length > 0 && !favList.error) {
            favList.forEach(fav => favoriteIdMap.set(fav.favoriteId, fav.id));
          }
        });
      } catch (e) {
        console.warn("Could not fetch favoriteIds", e);
      }
      // Update only the unfavorite buttons on existing cards (no full re-render)
      document.querySelectorAll('.avatar-card').forEach(card => {
        const id = card.id.replace('card-', '');
        const updateFavBtn = card.querySelector('.btn-action.unfavorite');
        if (updateFavBtn && !favoriteIdMap.has(id)) {
          // favoriteId still not found, mark as unresolvable
          updateFavBtn.title = 'Cannot unfavorite (ID not found)';
          updateFavBtn.style.opacity = '0.4';
        }
      });
    }

    // Stage 3: Streaming Refresh (metadata check)
    if (currentCategory !== 'mine' && currentCategory !== 'local') {
      const avIds = allFetched.map(a => a.id);
      const CONCURRENCY = 30;
      for (let i = 0; i < avIds.length; i += CONCURRENCY) {
        if (seq !== fetchSeq || currentCategory === 'mine') return;
        const chunk = avIds.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(chunk.map(id => fetchOfficialAvatarData(id)));
        if (seq !== fetchSeq) return;
        
        const freshBatch = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
        freshBatch.forEach(a => {
           const idx = avatars.findIndex(ex => ex.id === a.id);
           if (idx !== -1) avatars[idx] = Object.assign(avatars[idx], a);
        });
        applyFilters();
        // Save basics with fresh data
        const freshBasics = avatars.map(a => ({
          id: a.id, name: a.name, thumbnailImageUrl: a.thumbnailImageUrl, imageUrl: a.imageUrl,
          releaseStatus: a.releaseStatus, authorId: a.authorId, tags: a.tags
        }));
        idb.set("avatar_basics_" + currentCategory, freshBasics).catch(()=>{});
      }
    }

    // Also populate upload avatar select
    const selOptions = document.getElementById("avatarSelectOptions");
    if (selOptions) {
      selOptions.innerHTML = '<div class="glass-option" onclick="selectGlassOption(event, this, \'\')">-- Select --</div>';
      avatars.forEach((a) => {
        const opt = document.createElement("div");
        opt.className = "glass-option";
        opt.textContent = a.name;
        opt.onclick = (e) => selectGlassOption(e, opt, a.id);
        selOptions.appendChild(opt);
      });
    }
  } catch (e) {
    logMsg("Error: " + e.message, "error");
  }
}

function applyFilters() {
  const q = document.getElementById("searchInput")?.value.toLowerCase().trim() || "";
  const state = document.getElementById("filterStatus")?.value || "all";
  const plat = document.getElementById("filterPlatform")?.value || "all";

  // When searching in any favorites category, search across ALL favorites groups
  const isFavoritesSearch = q && currentCategory !== "mine";
  if (isFavoritesSearch) {
    applyFiltersAcrossAllFavorites(q, state, plat);
    return;
  }

  _applyFiltersToList(avatars, q, state, plat);
}

// Search across all cached favorites groups combined
async function applyFiltersAcrossAllFavorites(q, state, plat) {
  const groups = favoriteGroups.map(g => g.name);
  if (groups.length === 0) {
    // Fallback: just filter current avatars
    _applyFiltersToList(avatars, q, state, plat);
    return;
  }

  // Load all favorites from IDB cache and combine
  let combined = [...avatars]; // Start with already-loaded current group
  const currentGroupSet = new Set(avatars.map(a => a.id));

  for (const g of groups) {
    if (g === currentCategory) continue; // Already included
    try {
      const cached = await idb.get("avatars_" + g);
      if (cached && cached.length > 0) {
        // Deduplicate by id
        cached.forEach(av => { if (!currentGroupSet.has(av.id)) { combined.push(av); currentGroupSet.add(av.id); } });
      }
    } catch (_) {}
  }

  _applyFiltersToList(combined, q, state, plat);
}

function _platformCheck(av) {
  // 根据性能评级来更精准地判断平台兼容性（如果某个平台没有评级或是 None，则认为不支持）
  const pkgs = av.unityPackages || [];
  const hasPC = pkgs.some(p => p.platform === "standalonewindows" && p.performanceRating && p.performanceRating !== "None");
  const hasQuest = pkgs.some(p => p.platform === "android" && p.performanceRating && p.performanceRating !== "None");
  const hasApple = pkgs.some(p => p.platform === "ios" && p.performanceRating && p.performanceRating !== "None");
  return { hasPC, hasQuest, hasApple };
}

function _applyFiltersToList(list, q, state, plat) {
  let filtered = list
    .map((av) => {
      let score = 0;

      // Match status
      if (state !== "all" && av.releaseStatus !== state) return null;

      // Match platform — inclusive: "PC Only" means has PC, "PC+Quest" means has both, etc.
      if (plat !== "all") {
        const { hasPC, hasQuest, hasApple } = _platformCheck(av);
        if (plat === "pc" && !hasPC) return null;
        if (plat === "pc-quest" && (!hasPC || !hasQuest)) return null;
        if (plat === "pc-quest-apple" && (!hasPC || !hasQuest || !hasApple)) return null;
      }

      // Match Query (Fuzzy Search & Relevance Scoring)
      if (q) {
        const name = (av.name || "").toLowerCase();
        const desc = (av.description || "").toLowerCase();
        const tags = (av.tags || []).join(" ").toLowerCase();

        if (name === q) score += 100;
        else if (name.includes(q)) score += 50;

        if (tags.includes(q)) score += 30;
        if (desc.includes(q)) score += 10;

        // Allow loose typos in name using simple check (e.g., if query letters appear in order)
        if (score === 0) {
          let qIdx = 0;
          for (let i = 0; i < name.length; i++) {
            if (name[i] === q[qIdx]) qIdx++;
            if (qIdx === q.length) break;
          }
          if (qIdx === q.length) score += 5; // Fuzzy match
        }

        if (score === 0) return null;
      } else {
        score = 1; // Base score
      }

      return { avatar: av, score };
    })
    .filter((x) => x !== null);

  // Sort by relevance (score descending), then by updated_at (newest first)
  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      new Date(b.avatar.updatedAt || b.avatar.updated_at || 0) -
      new Date(a.avatar.updatedAt || a.avatar.updated_at || 0)
    );
  });

  visibleAvatars = filtered.map((x) => x.avatar);
  renderGrid(visibleAvatars);
}

function renderGrid(list) {
  const grid = document.getElementById("avatarGrid");
  if (!grid) return;

  // Unobserve all stale images before clearing the grid
  grid
    .querySelectorAll(".avatar-thumb[data-src]")
    .forEach((img) => avatarObserver.unobserve(img));
    
  // Clear the image queue to prevent fetching a backlog of ghost images
  imageQueue.length = 0; 

  grid.innerHTML = "";

  // Show empty state when no avatars
  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;color:rgba(255,255,255,0.4);gap:12px;">
      <div style="font-size:3em;">🎭</div>
      <div style="font-size:1.1em;">暂无模型 / No avatars found</div>
      <div style="font-size:0.85em;">点击「刷新」按钮重新加载 / Click Refresh to reload</div>
    </div>`;
    document.getElementById("statTotal").textContent = 0;
    return;
  }
  const isFavoriteView = currentCategory !== "mine";

  // Toggle Action Buttons based on context
  document.getElementById("btnCleanFavs")?.classList.toggle("hidden", !isFavoriteView);
  document.getElementById("btnUnfavoriteSelected")?.classList.toggle("hidden", !isFavoriteView);
  document.getElementById("btnSelectAll")?.classList.remove("hidden"); // Always visible
  document.getElementById("saveDirGroup")?.classList.toggle("hidden", isFavoriteView);
  document.querySelector('button[onclick="downloadSelected()"]')?.classList.toggle("hidden", isFavoriteView);

  list.forEach((av) => {
    let thumb = av.thumbnailImageUrl || av.imageUrl || "";
    thumb = proxyImg(thumb);

    const safeId = escHtml(av.id);
    const isOwner = currentUserId && av.authorId === currentUserId;
    const card = document.createElement("div");

    // Both mine and favorites support selection now
    card.className = "avatar-card" + (selectedIds.has(av.id) ? " selected" : "");

    const isLocalFaved = localAvatarIdMap.has(av.id);
    const isCloudFaved = favoriteIdMap.has(av.id);
    const isFaved = isLocalFaved || isCloudFaved;

    // Build action buttons: edit/delete only for owner; unfavorite only in favorites view
    let actionBtns = "";
    if (isOwner) {
      actionBtns += `<button class="btn-action edit" title="Edit" onclick="event.stopPropagation(); editAvatar('${safeId}')">✏️</button>`;
      actionBtns += `<button class="btn-action delete" title="Delete" onclick="event.stopPropagation(); deleteAvatar('${safeId}', '${escJsAttr(av.name)}')">🗑️</button>`;
      actionBtns += `<button class="btn-action" title="更多操作" onclick="event.stopPropagation(); showOwnedAvatarMenu(event, '${safeId}', '${escJsAttr(av.name)}')">⋯</button>`;
    }
    if (isFavoriteView) {
      if (currentCategory === 'local') {
        actionBtns += `<button class="btn-action unfavorite" title="移出本地收藏" onclick="event.stopPropagation(); removeFromLocalFavorite('${safeId}')">&times;</button>`;
      } else {
        actionBtns += `<button class="btn-action unfavorite" title="移出收藏" onclick="event.stopPropagation(); unfavorite('${safeId}', '${escJsAttr(av.name)}')">&times;</button>`;
      }
    } else if (!isFaved) {
      // In non-favorite view (e.g. mine), show Favorite button if not already favorited
      actionBtns += `<button class="btn-action favorite" title="收藏" onclick="event.stopPropagation(); toggleAvatarFavGridMenu(event, '${safeId}', '${escJsAttr(av.name)}', this)">⭐</button>`;
    }

    // Apply memory cache for instant render if already loaded previously
    const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const isCached = loadedImageUrls.has(thumb);
    const imgHtml = isCached 
        ? `<img class="avatar-thumb clickable-thumb" src="${escHtml(thumb)}" alt="${escHtml(av.name)}" onclick="event.stopPropagation(); openLocalDetail('${safeId}')" title="点击查看详情">`
        : `<img class="avatar-thumb loading clickable-thumb" src="${BLANK}" data-src="${escHtml(thumb)}" alt="" onclick="event.stopPropagation(); openLocalDetail('${safeId}')" title="点击查看详情">`;

    const releaseBadge = av.releaseStatus === 'public' 
      ? '<div style="position:absolute;top:32px;left:8px;background:var(--success);color:white;font-size:0.65em;padding:2px 6px;border-radius:4px;z-index:10;font-weight:700;box-shadow:0 2px 4px rgba(0,0,0,0.3);">Public</div>'
      : '<div style="position:absolute;top:32px;left:8px;background:rgba(0,0,0,0.5);color:white;font-size:0.65em;padding:2px 6px;border-radius:4px;z-index:10;font-weight:700;box-shadow:0 2px 4px rgba(0,0,0,0.3);">Private</div>';

    card.innerHTML = `
            ${actionBtns ? `<div class="avatar-actions">${actionBtns}</div>` : ""}
            ${isFaved ? `<div class="fav-badge" title="已收藏">⭐</div>` : ""}
            <div class="avatar-checkbox" onclick="event.stopPropagation(); toggleSelect('${safeId}')" title="选中/取消选中">✓</div>
            <div class="avatar-thumb-wrapper ${isCached ? '' : 'img-loading'}">
                ${releaseBadge}
                ${imgHtml}
                <div class="avatar-name-overlay">${escHtml(av.name || "失效模型 (Invalid / Deleted)")}</div>
            </div>
        `;
    card.id = "card-" + av.id;
    grid.appendChild(card);
  });

  // Lazy loaded async image queue
  const imgs = grid.querySelectorAll(".avatar-thumb[data-src]");
  imgs.forEach((img) => avatarObserver.observe(img));

  document.getElementById("statTotal").textContent = list.length;
}

// ── Unfavorite ──
async function unfavorite(avatarId, avatarName) {
  const favoriteId = favoriteIdMap.get(avatarId);
  if (!favoriteId) {
    logMsg(`⚠ Cannot unfavorite ${avatarName}: favoriteId not found`, "error");
    return;
  }
  if (!confirm(`⚠️ 即将移出收藏夹\n\n「${avatarName}」\n\n此操作不可撤销，确定继续吗？`)) return;
  try {
    logMsg(`Removing ${avatarName} from favorites...`, "info");
    const resp = await apiCall(`/api/vrc/favorites/${favoriteId}`, {
      method: "DELETE",
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(err);
    }
    logMsg(`✓ Removed ${avatarName} from favorites`, "success");
    // Remove from local data
    favoriteIdMap.delete(avatarId);
    avatars = avatars.filter((a) => a.id !== avatarId);
    visibleAvatars = visibleAvatars.filter((a) => a.id !== avatarId);
    selectedIds.delete(avatarId);
    // Update IDB cache to reflect removal
    try { await idb.set("avatars_" + currentCategory, avatars); } catch (_) {}
    
    // Update Modal UI if it's currently showing this avatar
    const modal = document.getElementById("avtrdbDetailModal");
    const favBtn = document.getElementById("avtrdbDetailFavBtn");
    if (modal && !modal.classList.contains("hidden")) {
       const displayedId = document.getElementById("avtrdbDetailId").textContent;
       if (displayedId === avatarId) {
           favBtn.innerHTML = "⭐ 收藏";
           favBtn.className = "btn btn-secondary";
           favBtn.onclick = toggleAvtrdbFavMenu;
           const favList = document.getElementById("avtrdbFavGroupList");
           if (favList && favoriteGroups.length > 0) {
             favList.innerHTML = favoriteGroups.map(g =>
               `<button class="avtrdb-fav-group-btn" onclick="addToFavorite('${escHtml(avatarId)}','${escHtml(g.name)}',this)">${escHtml(g.displayName || g.name)}</button>`
             ).join("");
           }
       }
    }

    // Animate card removal
    const card = document.getElementById("card-" + avatarId);
    if (card) {
      card.style.transform = "scale(0.9)";
      card.style.opacity = "0";
      card.style.transition = "all 0.2s ease";
      setTimeout(() => card.remove(), 200);
    }
    document.getElementById("statTotal").textContent = visibleAvatars.length;
    document.getElementById("statSelected").textContent = selectedIds.size;
  } catch (e) {
    logMsg(`✗ Failed to unfavorite ${avatarName}: ${e.message}`, "error");
  }
}

// ── Batch Unfavorite Selected ──
async function unfavoriteSelected() {
  if (selectedIds.size === 0) {
    logMsg("未选择任何模型 (No avatars selected)", "error");
    return;
  }
  const count = selectedIds.size;
  if (!confirm(`确定要将选中的 ${count} 个模型移出收藏夹吗？\nRemove ${count} selected avatar(s) from favorites?`)) return;

  const ids = [...selectedIds];
  logMsg(`开始批量移除 ${count} 个收藏...`, "info");
  let successCount = 0, failCount = 0;

  for (const avatarId of ids) {
    const fid = favoriteIdMap.get(avatarId);
    if (!fid) { failCount++; continue; }
    try {
      const resp = await apiCall(`/api/vrc/favorites/${fid}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(await resp.text());
      favoriteIdMap.delete(avatarId);
      avatars = avatars.filter((a) => a.id !== avatarId);
      visibleAvatars = visibleAvatars.filter((a) => a.id !== avatarId);
      selectedIds.delete(avatarId);
      const card = document.getElementById("card-" + avatarId);
      if (card) {
        card.style.transform = "scale(0.9)";
        card.style.opacity = "0";
        card.style.transition = "all 0.15s ease";
        setTimeout(() => card.remove(), 150);
      }
      successCount++;
    } catch (e) {
      logMsg(`✗ 移除失败: ${e.message}`, "error");
      failCount++;
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  // Update IDB cache
  try { await idb.set("avatars_" + currentCategory, avatars); } catch (_) {}
  document.getElementById("statTotal").textContent = visibleAvatars.length;
  document.getElementById("statSelected").textContent = 0;
  logMsg(`✓ 批量移除完成: 成功 ${successCount}, 失败 ${failCount}`, successCount > 0 ? "success" : "error");
}

// ── Shared Cleanup Modal ─────────────────────────────────────────────────────
// Used by both avatar and world cleanup functions.
// opts: { title, invalidItems[], privateNonOwnItems[], invalidLabel(item), onConfirm(items[]) }
function _showCleanupModal(opts) {
  document.getElementById('cleanupModal')?.remove();

  const { title, invalidItems, privateNonOwnItems, invalidLabel, onConfirm } = opts;
  const hasPrivate = privateNonOwnItems.length > 0;

  const modal = document.createElement('div');
  modal.id = 'cleanupModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';
  modal.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:500px;width:100%;max-height:82vh;overflow-y:auto;display:flex;flex-direction:column;gap:16px;box-shadow:0 24px 64px rgba(0,0,0,0.6);">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="margin:0;font-size:1.2em;">${title}</h2>
        <button id="cuClose" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.5em;line-height:1;">\u00d7</button>
      </div>

      ${invalidItems.length > 0 ? `
        <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:10px;padding:14px;">
          <div style="font-weight:700;color:#f87171;margin-bottom:8px;">\ud83d\udeab \u5931\u6548/\u9690\u85cf\u5185\u5bb9 <span style="font-weight:400;font-size:0.85em;opacity:0.8;">(\u5c06\u59cb\u7ec8\u79fb\u9664)</span></div>
          <div style="font-size:0.82em;color:var(--text-secondary);max-height:100px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
            ${invalidItems.slice(0,20).map(item=>`<span>\u2022 ${escHtml(invalidLabel(item))}</span>`).join('')}
            ${invalidItems.length>20?`<span style="opacity:0.6;">\u2026 \u8fd8\u6709 ${invalidItems.length-20} \u4e2a</span>`:''}
          </div>
        </div>
      ` : ''}

      ${hasPrivate ? `
        <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.28);border-radius:10px;padding:14px;">
          <label style="display:flex;align-items:flex-start;gap:12px;cursor:pointer;">
            <input type="checkbox" id="cuIncPrivate" style="width:18px;height:18px;margin-top:2px;accent-color:var(--accent);flex-shrink:0;">
            <div>
              <div style="font-weight:700;color:#fbbf24;">\ud83d\udd12 \u4ed6\u4eba\u4e0a\u4f20\u7684\u79c1\u4eba\u5185\u5bb9
                <span style="font-size:0.8em;background:rgba(245,158,11,0.2);padding:1px 7px;border-radius:4px;margin-left:4px;">${privateNonOwnItems.length} \u4e2a</span>
              </div>
              <div style="font-size:0.8em;color:var(--text-muted);margin-top:4px;">\u8fd9\u4e9b\u5185\u5bb9\u72b6\u6001\u4e3a Private \u4e14\u4e0a\u4f20\u8005\u4e0d\u662f\u4f60\u7684\u8d26\u53f7\u3002\u52fe\u9009\u540e\u5c06\u4e00\u5e76\u4ece\u6536\u85cf\u5939\u79fb\u9664\u3002</div>
              <div style="font-size:0.78em;color:var(--text-secondary);max-height:80px;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:3px;">
                ${privateNonOwnItems.slice(0,15).map(item=>`<span>\u2022 ${escHtml(invalidLabel(item))}</span>`).join('')}
                ${privateNonOwnItems.length>15?`<span style="opacity:0.6;">\u2026 \u8fd8\u6709 ${privateNonOwnItems.length-15} \u4e2a</span>`:''}
              </div>
            </div>
          </label>
        </div>
      ` : ''}

      <div style="font-size:0.8em;color:var(--text-muted);padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid var(--border);">
        \u26a0\ufe0f \u6b64\u64cd\u4f5c\u5c06\u8c03\u7528 API \u5f7b\u5e95\u53d6\u6d88\u6536\u85cf\uff0c\u65e0\u6cd5\u64a4\u9500\u3002
      </div>

      <div id="cuProgress" style="display:none;font-size:0.85em;color:var(--accent-light);text-align:center;padding:10px;background:rgba(255, 255, 255, 0.08);border-radius:8px;border:1px solid rgba(255, 255, 255, 0.2);">\u5904\u7406\u4e2d...</div>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px;">
        <button id="cuCancel" class="btn btn-secondary" style="padding:8px 22px;">\u53d6\u6d88</button>
        <button id="cuConfirm" class="btn btn-primary" style="padding:8px 22px;background:linear-gradient(135deg,#ef4444,#dc2626);border-color:transparent;">\ud83d\uddd1\ufe0f \u786e\u8ba4\u6e05\u7406</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.getElementById('cuClose').onclick = closeModal;
  document.getElementById('cuCancel').onclick = closeModal;
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  document.getElementById('cuConfirm').onclick = async () => {
    const includePrivate = hasPrivate && document.getElementById('cuIncPrivate')?.checked;
    const toDelete = [...invalidItems, ...(includePrivate ? privateNonOwnItems : [])];
    if (!toDelete.length) { closeModal(); return; }

    document.getElementById('cuConfirm').disabled = true;
    document.getElementById('cuCancel').disabled = true;
    const prog = document.getElementById('cuProgress');
    prog.style.display = '';
    prog.textContent = `\u5904\u7406\u4e2d 0 / ${toDelete.length}...`;

    await onConfirm(toDelete);
    closeModal();
  };
}

async function cleanInvalidFavorites() {
  if (currentCategory === 'mine') return;

  // Categorize avatars
  const invalid = avatars.filter(av =>
    !av.name || av.releaseStatus === 'hidden' || av.releaseStatus === 'unavailable'
  );
  const privateNonOwn = avatars.filter(av =>
    av.releaseStatus === 'private' && av.authorId && currentUserId && av.authorId !== currentUserId
  );

  if (!invalid.length && !privateNonOwn.length) {
    logMsg('✅ 当前收藏夹没有需要清理的内容', 'success');
    return;
  }

  // Show rich cleanup modal
  _showCleanupModal({
    title: '🧹 清理收藏模型',
    invalidItems: invalid,
    privateNonOwnItems: privateNonOwn,
    invalidLabel: item => item.name || '失效/无名模型',
    onConfirm: async (toDelete) => {
      let success = 0, fail = 0;
      for (const av of toDelete) {
        const fid = favoriteIdMap.get(av.id);
        if (!fid) { fail++; continue; }
        try {
          await apiCall(`/api/vrc/favorites/${fid}`, { method: 'DELETE' });
          success++;
        } catch(e) { fail++; }
        await new Promise(r => setTimeout(r, 200));
      }
      logMsg(`✅ 清理完毕：成功移除 ${success} 个，失败 ${fail} 个`, success > 0 ? 'success' : 'error');
      try { await idb.set('avatar_basics_' + currentCategory, []); } catch(_) {}
      fetchAvatars(true);
    }
  });
}

// ── Open Local Avatar Detail Modal ──
function openLocalDetail(id) { 
  const av = visibleAvatars.find(a => a.id === id);
  if (av) displayAvatarDetail(av); 
}

function renderAvatars() {
  applyFilters();
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  const card = document.getElementById("card-" + id);
  if (card) card.classList.toggle("selected", selectedIds.has(id));
  document.getElementById("statSelected").textContent = selectedIds.size;
}

function selectAll() {
  const allSelected = selectedIds.size > 0 && selectedIds.size === visibleAvatars.length;
  selectedIds.clear();
  if (!allSelected) visibleAvatars.forEach((a) => selectedIds.add(a.id));
  // Toggle CSS class on existing cards — DO NOT call renderAvatars() which rebuilds the DOM
  visibleAvatars.forEach((a) => {
    const card = document.getElementById("card-" + a.id);
    if (card) card.classList.toggle("selected", selectedIds.has(a.id));
  });
  document.getElementById("statSelected").textContent = selectedIds.size;
}

// ── Edit & Delete Avatar ──
let currentEditId = null;

function editAvatar(id) {
  const av = avatars.find((a) => a.id === id);
  if (!av) return;
  currentEditId = id;
  document.getElementById("editName").value = av.name || "";
  document.getElementById("editDesc").value = av.description || "";
  document.getElementById("editStatus").value = av.releaseStatus || "private";
  document.getElementById("editTags").value = (av.tags || [])
    .filter((t) => !t.startsWith("author_tag"))
    .join(", ");

  // Show current thumbnail preview
  const thumb = av.thumbnailImageUrl || av.imageUrl || "";
  const preview = document.getElementById("editThumbPreview");
  const note = document.getElementById("editThumbNote");
  const input = document.getElementById("editThumbInput");
  if (preview) {
    preview.src = thumb
      ? `${API_BASE}/api/image?url=${encodeURIComponent(thumb)}&auth=${encodeURIComponent(vrcAuth || "")}`
      : "";
  }
  if (note) note.textContent = "";
  if (input) input.value = ""; // Reset file picker

  document.getElementById("editModal").classList.remove("hidden");
}

// Handle thumbnail file selection — show local preview
function onEditThumbSelected(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById("editThumbPreview");
  const note = document.getElementById("editThumbNote");
  if (preview) preview.src = URL.createObjectURL(file);
  if (note) note.textContent = `✓ ${file.name} (${(file.size / 1024).toFixed(0)} KB) — 保存时上传 / will upload on save`;
}

function closeEditModal() {
  document.getElementById("editModal").classList.add("hidden");
  currentEditId = null;
}

async function saveEditAvatar() {
  if (!currentEditId) return;
  const name = document.getElementById("editName").value.trim();
  if (!name) return alert("Name is required");
  const desc = document.getElementById("editDesc").value.trim();
  const status = document.getElementById("editStatus").value;
  const tagsStr = document.getElementById("editTags").value;
  const tags = tagsStr
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t);

  const btn = document.getElementById("btnSaveEdit");
  const oldText = btn.textContent;
  btn.textContent = "...";
  btn.disabled = true;

  try {
    // Upload new thumbnail if selected
    let newImageUrl = null;
    const thumbInput = document.getElementById("editThumbInput");
    if (thumbInput && thumbInput.files.length > 0) {
      btn.textContent = "图片上传中...";
      logMsg(`🖼️ Uploading new thumbnail for ${name}...`, "info");
      newImageUrl = await uploadImageToVRChat(thumbInput.files[0], name);
    }

    btn.textContent = "保存中...";
    logMsg(`✏️ Updating ${name}...`, "info");
    const payload = {
      name,
      description: desc,
      releaseStatus: status,
      tags,
    };
    if (newImageUrl) payload.imageUrl = newImageUrl;

    const resp = await apiCall(`/api/vrc/avatars/${currentEditId}`, {
      method: "PUT",
      json: payload,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(err);
    }

    // Update local object
    const updatedAv = await resp.json();
    const idx = avatars.findIndex((a) => a.id === currentEditId);
    if (idx !== -1) avatars[idx] = updatedAv;

    // Update IDB cache
    try { await idb.set("avatars_" + currentCategory, avatars); } catch (_) {}

    // Update the card's name overlay + thumbnail in-place (no full re-render)
    const card = document.getElementById("card-" + currentEditId);
    if (card) {
      const nameOverlay = card.querySelector(".avatar-name-overlay");
      if (nameOverlay) nameOverlay.textContent = updatedAv.name || "";
      if (newImageUrl) {
        const img = card.querySelector(".avatar-thumb");
        if (img) {
          const proxyUrl = `${API_BASE}/api/image?url=${encodeURIComponent(newImageUrl)}&auth=${encodeURIComponent(vrcAuth || "")}`;
          img.classList.remove("failed");
          img.src = proxyUrl;
          loadedImageUrls.add(proxyUrl);
        }
      }
    }
    closeEditModal();
    logMsg(`✓ ${t("editSuccess")} ${name}`, "success");
  } catch (e) {
    logMsg(`✗ ${t("editFail")} ${name} - ${e.message}`, "error");
    alert(e.message);
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
}

async function deleteAvatar(id, name) {
  if (!confirm(t("confirmDelete") + name)) return;
  try {
    logMsg(`🗑️ Deleting ${name}...`, "info");
    const resp = await apiCall(`/api/vrc/avatars/${id}`, { method: "DELETE" });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(err);
    }
    logMsg(`✓ ${t("deleted")} ${name}`, "success");

    // Remove from all local arrays and selection
    avatars = avatars.filter((a) => a.id !== id);
    visibleAvatars = visibleAvatars.filter((a) => a.id !== id);
    selectedIds.delete(id);

    // Update IDB cache
    try { await idb.set("avatars_" + currentCategory, avatars); } catch (_) {}

    // Remove from DOM with animation
    const card = document.getElementById("card-" + id);
    if (card) {
      card.style.transform = "scale(0.9)";
      card.style.opacity = "0";
      setTimeout(() => card.remove(), 200);
    }

    // Update stats to reflect filtered count
    document.getElementById("statTotal").textContent = visibleAvatars.length;
    document.getElementById("statSelected").textContent = selectedIds.size;
  } catch (e) {
    logMsg(`✗ ${t("deleteFail")} ${name} - ${e.message}`, "error");
  }
}

// ── Save Location Picker ──
async function pickSaveDir() {
  if (!("showDirectoryPicker" in window)) {
    logMsg(t("dirNotSupported"), "error");
    return;
  }
  try {
    saveDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const dirLabel = document.getElementById("saveDirLabel");
    if (dirLabel) {
      dirLabel.textContent = t("dirSelected") + saveDirHandle.name;
      dirLabel.style.display = "block";
    }
    const clearBtn = document.getElementById("clearDirBtn");
    if (clearBtn) clearBtn.style.display = "block";
    logMsg(t("dirSelected") + saveDirHandle.name, "success");
  } catch (e) {
    if (e.name !== "AbortError") logMsg("Error: " + e.message, "error");
  }
}

function clearSaveDir() {
  saveDirHandle = null;
  const dirLabel = document.getElementById("saveDirLabel");
  if (dirLabel) {
    dirLabel.textContent = "";
    dirLabel.style.display = "none";
  }
  const clearBtn = document.getElementById("clearDirBtn");
  if (clearBtn) clearBtn.style.display = "none";
  logMsg(t("dirCleared"), "info");
}

// ── Download ──
async function downloadSelected() {
  if (selectedIds.size === 0) {
    logMsg("No avatars selected", "error");
    return;
  }
  // Use visibleAvatars so we download what's actually selected in the current filtered view
  const toDownload = visibleAvatars.filter((a) => selectedIds.has(a.id));

  // Verify directory permission is still valid
  if (saveDirHandle) {
    try {
      const perm = await saveDirHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        const req = await saveDirHandle.requestPermission({
          mode: "readwrite",
        });
        if (req !== "granted") {
          saveDirHandle = null;
          logMsg("Directory permission denied, using browser default", "info");
        }
      }
    } catch {
      saveDirHandle = null;
    }
  }

  // Start concurrent download queue
  const CONCURRENT_DOWNLOADS = 4;
  let queue = [...toDownload];
  let activeCount = 0;

  logMsg(
    `Started downloading ${toDownload.length} avatars (${CONCURRENT_DOWNLOADS} concurrent)...`,
    "info",
  );

  return new Promise((resolve) => {
    function next() {
      if (queue.length === 0 && activeCount === 0) {
        logMsg("All downloads finished.", "success");
        resolve();
        return;
      }
      while (activeCount < CONCURRENT_DOWNLOADS && queue.length > 0) {
        const av = queue.shift();
        activeCount++;
        downloadSingleAvatar(av).finally(() => {
          activeCount--;
          next();
        });
      }
    }
    next();
  });
}

async function downloadSingleAvatar(av) {
  const card = document.getElementById("card-" + av.id);
  if (card) card.classList.add("downloading");

  // Collect all candidate URLs (prefer no-variant first, then security, skip impostor)
  const candidateUrls = [];
  for (const pkg of av.unityPackages || []) {
    if (
      (pkg.platform === "standalonewindows" || pkg.platform === "pc") &&
      pkg.assetUrl
    ) {
      if (pkg.variant && pkg.variant.includes("impostor")) continue;
      if (!pkg.variant || pkg.variant === "") {
        candidateUrls.unshift(pkg.assetUrl); // top priority
      } else {
        candidateUrls.push(pkg.assetUrl);
      }
    }
  }

  if (candidateUrls.length === 0) {
    logMsg(`⚠ ${av.name}: No PC asset URL found`, "skip");
    if (card) {
      card.classList.remove("downloading");
      card.classList.add("skipped");
    }
    return;
  }

  const safeName = av.name.replace(/[\\/*?:"<>|]/g, "_");
  const filename = `${safeName}_${av.id}.vrca`;

  try {
    logMsg(`⬇ ${t("downloading")} ${av.name}...`, "info");

    if (saveDirHandle) {
      // Check if file already exists → skip
      try {
        await saveDirHandle.getFileHandle(filename, { create: false });
        logMsg(`⏭ ${av.name}: Already exists, skipped`, "skip");
        if (card) {
          card.classList.remove("downloading");
          card.classList.add("success");
        }
        return;
      } catch {
        /* file doesn't exist, proceed with download */
      }

      // ── File System Access API: try each candidate URL ──
      let downloaded = false;
      for (let urlIdx = 0; urlIdx < candidateUrls.length; urlIdx++) {
        const proxyUrl = `${API_BASE}/api/download?url=${encodeURIComponent(candidateUrls[urlIdx])}&filename=${encodeURIComponent(filename)}&auth=${encodeURIComponent(vrcAuth)}`;
        try {
          const resp = await fetch(proxyUrl);
          if (!resp.ok) {
            const errText = await resp
              .text()
              .catch(() => `HTTP ${resp.status}`);
            if (urlIdx < candidateUrls.length - 1) {
              logMsg(
                `  ↳ URL ${urlIdx + 1}/${candidateUrls.length} failed (${resp.status}), trying next...`,
                "info",
              );
              continue;
            }
            throw new Error(
              `Server error ${resp.status}: ${errText.substring(0, 200)}`,
            );
          }
          const ct = resp.headers.get("Content-Type") || "";
          if (ct.includes("text/html") || ct.includes("application/json")) {
            const body = await resp.text();
            if (urlIdx < candidateUrls.length - 1) {
              logMsg(
                `  ↳ URL ${urlIdx + 1}/${candidateUrls.length} returned error page, trying next...`,
                "info",
              );
              continue;
            }
            throw new Error(
              "Got error page instead of file: " + body.substring(0, 200),
            );
          }
          const blob = await resp.blob();
          if (blob.size < 10240) {
            if (urlIdx < candidateUrls.length - 1) {
              logMsg(
                `  ↳ URL ${urlIdx + 1}/${candidateUrls.length} too small (${blob.size}B), trying next...`,
                "info",
              );
              continue;
            }
            throw new Error(
              `File too small (${blob.size} bytes), likely an error response`,
            );
          }
          const fileHandle = await saveDirHandle.getFileHandle(filename, {
            create: true,
          });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          logMsg(
            `✓ ${av.name}: Saved → ${saveDirHandle.name}/${filename} (${(blob.size / 1048576).toFixed(1)} MB)`,
            "success",
          );
          downloaded = true;
          if (card) {
            card.classList.remove("downloading");
            card.classList.add("success");
          }
          break;
        } catch (e) {
          if (urlIdx < candidateUrls.length - 1) {
            logMsg(
              `  ↳ URL ${urlIdx + 1}/${candidateUrls.length} failed: ${e.message}, trying next...`,
              "info",
            );
            continue;
          }
          throw e;
        }
      }
      if (!downloaded) throw new Error("All candidate URLs failed");
    } else {
      // ── Fallback: browser native <a> download (uses first URL) ──
      const proxyUrl = `${API_BASE}/api/download?url=${encodeURIComponent(candidateUrls[0])}&filename=${encodeURIComponent(filename)}&auth=${encodeURIComponent(vrcAuth)}`;
      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      logMsg(`✓ ${av.name}: Download started → ${filename}`, "success");
      if (card) {
        card.classList.remove("downloading");
        card.classList.add("success");
      }
    }
  } catch (e) {
    logMsg(`✗ ${av.name}: ${e.message}`, "error");
    if (card) {
      card.classList.remove("downloading");
      card.classList.add("skipped");
    }
  }
}

// ── Console ──
function logMsg(msg, type = "info") {
  const el = document.getElementById("logConsole");
  const span = document.createElement("div");
  span.className = `log-${type}`;
  span.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
  // Limit to 500 entries to prevent DOM bloat
  while (el.children.length > 500) el.removeChild(el.firstChild);
}

// ── Upload Mode Toggle ──
