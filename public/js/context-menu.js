/*
 * VRCW — context-menu.js
 * 右键菜单引擎/好友与自身菜单/群组邀请/举报/备注/Boop/屏蔽静音/管理
 *
 * 注意：本项目为「经典脚本」(非 ES module)，全部按顺序加载、共享全局作用域。
 * 函数声明会提升为全局，跨文件调用没问题；请勿改为 type="module"。
 */
// SIDEBAR MINI PROFILE
// ═══════════════════════════════════════════════════════════
function renderSidebarMiniProfile(u) {
  const el = document.getElementById('sidebarMyMiniProfile');
  if (!el) return;
  const statusColor = {active:'#3b82f6','join me':'#52525b','ask me':'#f59e0b',busy:'#ef4444',offline:'#475569'}[u.status] || '#22c55e';
  const vrcP = isVRCPlus && isVRCPlus(u.tags||[]);
  const thumb = proxyImg(u.profilePicOverrideThumbnail||u.userIcon||u.currentAvatarThumbnailImageUrl||'');
  el.innerHTML = `
    <div class="mini-dot" style="background:${statusColor};"></div>
    <img class="mini-avatar" src="${escHtml(thumb)}" onerror="this.style.display='none'">
    <div style="flex:1;min-width:0;">
      <div class="mini-name">${escHtml(u.displayName||'')}${vrcP?' <span style="font-size:0.65em;background:rgba(255, 255, 255, 0.2);color:#d4d4d8;border:1px solid rgba(255, 255, 255, 0.4);padding:1px 5px;border-radius:99px;">VRC+</span>':''}</div>
      <div class="mini-status">${escHtml(u.username||'')} · 点击查看资料</div>
    </div>
  `;
  el.onclick = () => fetchMyProfile();
}

// ═══════════════════════════════════════════════════════════
// CONTEXT MENU ENGINE
// ═══════════════════════════════════════════════════════════
let _ctxMenuEl = null;
function closeCtxMenu() {
  if (_ctxMenuEl) { _ctxMenuEl.remove(); _ctxMenuEl = null; }
}
document.addEventListener('click', closeCtxMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtxMenu(); });

// ── Owned-avatar "more" menu (wear / fallback / impostor) ──
function showOwnedAvatarMenu(e, avtrId, name) {
  e.stopPropagation();
  buildCtxMenu([
    { label: name || '我的模型', items: [
      { icon:'⚡', label:'切换为当前模型', action: () => switchAvatar(avtrId) },
      { icon:'🧍', label:'设为后备模型 (Fallback)', action: () => setFallbackAvatar(avtrId, name) },
    ]},
    { label:'Impostor (移动端替身)', items: [
      { icon:'🪄', label:'生成 Impostor', action: () => enqueueImpostor(avtrId, name) },
      { icon:'🗑️', label:'删除 Impostor', action: () => deleteImpostor(avtrId, name) },
    ]},
    { items: [
      { icon:'🔗', label:'打开 VRChat 主页', action: () => window.open(`https://vrchat.com/home/avatar/${avtrId}`, '_blank') },
      { icon:'📋', label:'复制模型 ID', action: () => copyToClipboard(avtrId, '模型 ID') },
    ]},
  ]);
  positionCtxMenu(e, _ctxMenuEl);
}

function buildCtxMenu(sections) {
  closeCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  sections.forEach(section => {
    const sec = document.createElement('div');
    sec.className = 'ctx-menu-section';
    if (section.label) {
      const hdr = document.createElement('div');
      hdr.className = 'ctx-menu-header';
      hdr.textContent = section.label;
      sec.appendChild(hdr);
    }
    section.items.forEach(item => {
      if (!item) return;
      const btn = document.createElement('button');
      btn.className = 'ctx-menu-item' + (item.danger ? ' danger' : '');
      btn.innerHTML = `<span class="ctx-icon">${item.icon||''}</span><span>${item.label}</span>`;
      btn.onclick = (e) => { e.stopPropagation(); closeCtxMenu(); item.action && item.action(); };
      sec.appendChild(btn);
    });
    menu.appendChild(sec);
  });
  document.body.appendChild(menu);
  // Float above whatever modal is currently open (ctx menus are spawned from
  // inside modals, so a fixed CSS z-index could sit behind a later modal).
  menu.style.zIndex = String(modalZPeek() + 5);
  _ctxMenuEl = menu;
  return menu;
}

function positionCtxMenu(e, menu) {
  e.stopPropagation();
  let rect;
  if (e.currentTarget && e.currentTarget.getBoundingClientRect) {
    rect = e.currentTarget.getBoundingClientRect();
  } else if (e.target && e.target.getBoundingClientRect) {
    const btn = e.target.closest('.btn') || e.target;
    rect = btn.getBoundingClientRect();
  } else {
    rect = { bottom: e.clientY, left: e.clientX, top: e.clientY };
  }
  let top = rect.bottom + 6, left = rect.left;
  const mh = menu.offsetHeight || 300, mw = menu.offsetWidth || 240;
  if (top + mh > window.innerHeight) top = (rect.top || e.clientY) - mh - 6;
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - 8;
  menu.style.top = Math.max(8, top) + 'px';
  menu.style.left = Math.max(8, left) + 'px';
}

// ═══════════════════════════════════════════════════════════
// FRIEND CONTEXT MENU (VRCX-style)
// ═══════════════════════════════════════════════════════════
function showFriendContextMenu(e) {
  e.stopPropagation();
  const f = currentFriendProfile;
  if (!f) return;
  const id = f.id || '';
  const name = f.displayName || '';
  const hasLocation = f.location && f.location.startsWith('wrld_');
  const isOnline = f.state === 'online' || (f.location && f.location !== 'offline');
  const isJoinable = hasLocation && !f.location.includes('~private');

  const isBlocked = myModerations.some(m => m.moderated === id && m.type === 'block');
  const isMuted   = myModerations.some(m => m.moderated === id && m.type === 'mute');
  const isShown   = myModerations.some(m => m.moderated === id && m.type === 'showAvatar');
  const isHidden  = myModerations.some(m => m.moderated === id && m.type === 'hideAvatar');
  const isInteractOff = myModerations.some(m => m.moderated === id && m.type === 'interactOff');
  const isFriendFaved = friendFavoriteIdMap.has(id);

  const menu = buildCtxMenu([
    { items: [
      { icon:'🔄', label:'刷新资料', action: async () => {
        // Re-fetch from API for up-to-date data
        try {
          const r = await apiCall(`/api/vrc/users/${id}`);
          if (r.ok) {
            const fresh = await r.json();
            currentFriendProfile = fresh;
            _renderFriendProfileUI(fresh, document.getElementById('friendProfileModal'));
            logMsg('✅ 资料已刷新', 'success');
          } else {
            // Fall back to re-open using the proper profile-by-id route
            openFriendProfileById(id);
          }
        } catch { openFriendProfileById(id); }
      }},
      { icon:'📋', label:'复制 ID', action: () => navigator.clipboard.writeText(id).then(() => logMsg('ID 已复制', 'info')) },
      { icon:'🔗', label:'分享 VRChat 主页', action: () => window.open(`https://vrchat.com/home/user/${id}`, '_blank') },
    ]},
    { label:'位置互动', items: [
      isJoinable ? { icon:'🚀', label:'申请加入实例', action: () => friendRequestJoin(id, name) } : null,
      isOnline ? { icon:'📩', label:'请求邀请', action: () => requestInvite(id, name) } : null,
      isOnline ? { icon:'📨', label:'发送邀请', action: () => sendInvite(id, name) } : null,
      { icon:'👋', label:'发送戳一戳...', action: () => {
          setTimeout(() => showBoopMenu(e, id, name), 10);
      }},
    ].filter(Boolean)},
    { label:'模型控制', items: [
      { icon:'👁️', label: isShown ? '取消强制显示模型' : '显示该玩家模型', action: () => isShown ? resetAvatarModeration(id, name, 'showAvatar') : showAvatarUser(id, name) },
      { icon:'🙈', label: isHidden ? '取消隐藏模型' : '隐藏该玩家模型', action: () => isHidden ? resetAvatarModeration(id, name, 'hideAvatar') : hideAvatarUser(id, name) },
      { icon:'🤝', label: isInteractOff ? '打开模型互动 (PhysBones)' : '关闭模型互动', action: () => isInteractOff ? resetAvatarModeration(id, name, 'interactOff') : disableAvatarInteraction(id, name) },
      { icon:'🧑', label:'查看模型信息 (官网)', action: () => {
        const avId = f.currentAvatarId; if (avId) window.open(`https://vrchat.com/home/avatar/${avId}`, '_blank');
        else alert('该好友模型 ID 不可访问');
      }},
    ]},
    { label:'群组', items: [
      { icon:'🏠', label:'邀请加入群组', action: (ev) => showGroupInviteMenu(ev, id, name) },
    ]},
    { label:'管理', items: [
      { icon:'⭐', label: isFriendFaved ? '针对该好友移除收藏' : '收藏到分组', action: (ev) => isFriendFaved ? toggleFriendFavorite(id, name) : toggleFriendFavMenu(ev, id) },
      { icon:'📝', label:'编辑备注', action: () => showUserNoteDialog(id, name) },
      { icon:'🔇', label: isBlocked ? '解除屏蔽' : '屏蔽', action: () => isBlocked ? unblockUser(id, name) : blockUser(id, name) },
      { icon:'🔕', label: isMuted ? '解除静音' : '静音', action: () => isMuted ? unmuteUser(id, name) : muteUser(id, name) },
      { icon:'🚩', label:'举报该用户', action: () => showReportUserDialog(id, name) },
    ]},
    { items: [
      { icon:'🗑️', label:'删除好友', danger: true, action: () => deleteFriend(id, name) },
    ]},
  ]);
  positionCtxMenu(e, menu);
}


async function showGroupInviteMenu(ev, userId, userName) {
  // Fetch the current user's owned/member groups and show a picker
  let groups = [];
  try {
    // VRChat API: GET /users/{userId}/groups to list groups for a user
    // Use currentUserId (actual user ID, not 'me')
    const uid = currentUserId || (myProfileData && myProfileData.id);
    if (!uid) { alert('无法获取用户 ID，请先登录'); return; }
    const r = await apiCall(`/api/vrc/users/${uid}/groups?n=50`);
    if (r.ok) groups = await r.json();
    // VRChat returns array of LimitedGroup objects with id, name, memberCount, etc.
    // Filter to groups where the user has invite permissions
    groups = groups.filter(g => g.myMember?.permissions?.includes('group-invites-manage') ||
                               g.myMember?.roleIds?.length > 0);
  } catch {}

  if (!groups.length) {
    alert('未找到您管理的群组，请先在游戏内创建或加入群组');
    return;
  }

  // Build a simple modal picker
  const old = document.getElementById('_groupInvitePickerModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = '_groupInvitePickerModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;min-width:min(320px,92vw);max-width:480px;max-height:70vh;display:flex;flex-direction:column;gap:12px;">
      <div style="font-weight:600;font-size:1em;">选择要邀请 ${escHtml(userName)} 加入的群组</div>
      <div id="_groupPickerList" style="overflow-y:auto;display:flex;flex-direction:column;gap:8px;max-height:50vh;">
        ${groups.map(g => `
          <button onclick="doGroupInvite('${escJsAttr(g.id)}','${escJsAttr(g.name)}','${escJsAttr(userId)}','${escJsAttr(userName)}')"
            style="text-align:left;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 14px;cursor:pointer;color:#fff;">
            <div style="font-weight:500;">${escHtml(g.name)}</div>
            <div style="font-size:0.75em;color:rgba(255,255,255,0.4);">👥 ${g.memberCount || 0} 成员</div>
          </button>`).join('')}
      </div>
      <button onclick="document.getElementById('_groupInvitePickerModal')?.remove()" style="background:rgba(255,255,255,0.08);border:none;border-radius:8px;padding:8px;cursor:pointer;color:#fff;">取消</button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function doGroupInvite(groupId, groupName, userId, userName) {
  document.getElementById('_groupInvitePickerModal')?.remove();
  try {
    const r = await apiCall(`/api/vrc/groups/${groupId}/invites`, {
      method: 'POST',
      json: { userId }
    });
    if (r.ok) logMsg(`✅ 已邀请 ${userName} 加入群组「${groupName}」`, 'success');
    else {
      const err = await r.json().catch(() => ({}));
      alert(`❌ 邀请失败: ${err.error?.message || r.status}`);
    }
  } catch(e) { alert('失败: ' + e.message); }
}

function showReportUserDialog(userId, userName) {
  const old = document.getElementById('_reportUserModal');
  if (old) old.remove();

  const reasons = [
    'tos_violation', 'threatening_language', 'harassment', 'spam',
    'inappropriate_avatar', 'inappropriate_content', 'other'
  ];
  const reasonLabels = {
    tos_violation: '违反服务条款',
    threatening_language: '威胁性语言',
    harassment: '骚扰行为',
    spam: '垃圾信息',
    inappropriate_avatar: '不当模型',
    inappropriate_content: '不当内容',
    other: '其他'
  };

  const modal = document.createElement('div');
  modal.id = '_reportUserModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;min-width:min(340px,92vw);max-width:480px;display:flex;flex-direction:column;gap:12px;">
      <div style="font-weight:600;">🚩 举报 ${escHtml(userName)}</div>
      <div style="font-size:0.85em;color:rgba(255,255,255,0.5);">选择举报原因：</div>
      <select id="_reportReason" style="background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px;color:#fff;">
        ${reasons.map(r => `<option value="${r}">${reasonLabels[r]}</option>`).join('')}
      </select>
      <textarea id="_reportDesc" placeholder="描述（可选）" maxlength="512"
        style="background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px;color:#fff;resize:none;height:80px;"></textarea>
      <div style="display:flex;gap:8px;">
        <button id="_reportSubmitBtn" onclick="submitUserReport('${escJsAttr(userId)}','${escJsAttr(userName)}')"
          style="flex:1;background:#ef4444;border:none;border-radius:8px;padding:10px;cursor:pointer;color:#fff;font-weight:600;">提交举报</button>
        <button onclick="document.getElementById('_reportUserModal')?.remove()"
          style="flex:1;background:rgba(255,255,255,0.08);border:none;border-radius:8px;padding:10px;cursor:pointer;color:#fff;">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function submitUserReport(userId, userName) {
  const reason = document.getElementById('_reportReason')?.value || 'other';
  const description = document.getElementById('_reportDesc')?.value || '';
  const btn = document.getElementById('_reportSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
  try {
    // Real moderation report via VRChat API (same endpoint VRCX uses):
    // POST /feedback/{userId}/user  { contentType, reason, type }
    const r = await apiCall(`/api/vrc/feedback/${userId}/user`, {
      method: 'POST',
      json: {
        contentType: 'user',
        reason: reason,
        type: 'report',
        description: description || undefined
      }
    });
    if (r.ok) {
      document.getElementById('_reportUserModal')?.remove();
      showToast(`已举报 ${userName}`, 'success');
      logMsg(`🚩 已提交对 ${userName} 的举报 (原因: ${reason})`, 'success');
    } else {
      const err = await r.json().catch(() => ({}));
      // Fallback to official site if the API rejects (e.g. not permitted for this content)
      const msg = err.error?.message || ('HTTP ' + r.status);
      if (confirm(`API 举报失败：${msg}\n\n是否打开 VRChat 官网手动举报？`)) {
        window.open(`https://vrchat.com/home/user/${userId}`, '_blank');
      }
      if (btn) { btn.disabled = false; btn.textContent = '提交举报'; }
    }
  } catch(e) {
    alert('举报失败: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '提交举报'; }
  }
}


function toggleFriendFavMenu(event, userId) {
  const menu = document.getElementById("friendFavMenu");
  // We don't have a reliable button ID here as it's coming from ctx menu, 
  // so we use the event coordinate approach for FavMenuGeneric if btn is null
  if (!menu) return;
  
  toggleFavMenuGeneric(event, menu, null, () => {
    if (friendFavGroups.length === 0) return `<div style="padding:8px 12px;font-size:0.8em;color:var(--text-muted);">请先加载好友分组</div>`;
    return friendFavGroups.map(g =>
      `<button class="avtrdb-fav-group-btn" onclick="addFriendToFavorite('${escHtml(userId)}','${escHtml(g.name)}',this)">${escHtml(g.displayName || g.name)}</button>`
    ).join("");
  });
}

async function addFriendToFavorite(userId, groupName, btn) {
  const menu = document.getElementById('friendFavMenu');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.disabled = true;
  try {
    const r = await apiCall('/api/vrc/favorites', {
      method: "POST",
      json: { type: "friend", favoriteId: userId, tags: [groupName] },
    });
    if (r.ok) {
      const res = await r.json();
      friendFavoriteIdMap.set(userId, res.id);
      logMsg(`✅ 已将好友添加到分组: ${groupName}`, "success");
    } else {
      const err = await r.json().catch(() => ({}));
      alert(`❌ 收藏失败: ${err.error?.message || r.status}`);
    }
  } catch(e) { alert('错误: ' + e.message); }
  finally { if (btn) btn.disabled = false; }
}

async function toggleFriendFavorite(userId, name) {
  if (friendFavoriteIdMap.has(userId)) {
    const favId = friendFavoriteIdMap.get(userId);
    if (!confirm(`确定要为 ${name} 移除好友收藏吗？`)) return;
    try {
      const r = await apiCall(`/api/vrc/favorites/${favId}`, {method:'DELETE'});
      if (r.ok) {
        friendFavoriteIdMap.delete(userId);
        logMsg(`✅ 已移除好友 ${name} 的收藏`, "info");
      } else {
        alert(`❌ 移除失败: ${r.status}`);
      }
    } catch(e) { alert('错误: ' + e.message); }
  }
}

// ═══════════════════════════════════════════════════════════
// USER NOTES (个人备注)  — GET/POST /userNotes
// ═══════════════════════════════════════════════════════════
async function showUserNoteDialog(userId, userName) {
  document.getElementById('_userNoteModal')?.remove();

  // The user object often already carries the existing note; otherwise fetch it.
  let existing = '';
  const cached = (currentFriendProfile && currentFriendProfile.id === userId)
    ? currentFriendProfile
    : (allFriends.find(f => f.id === userId) || null);
  if (cached && typeof cached.note === 'string') existing = cached.note;

  const modal = document.createElement('div');
  modal.id = '_userNoteModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;min-width:min(320px,92vw);max-width:460px;display:flex;flex-direction:column;gap:12px;">
      <div style="font-weight:600;">📝 备注 ${escHtml(userName)}</div>
      <div style="font-size:0.8em;color:rgba(255,255,255,0.5);">仅你自己可见，会显示在 VRChat 客户端的该用户资料里。</div>
      <textarea id="_userNoteText" maxlength="256" placeholder="输入备注..."
        style="background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px;color:#fff;resize:none;height:90px;font-family:inherit;">${escHtml(existing)}</textarea>
      <div style="display:flex;gap:8px;">
        <button id="_userNoteSaveBtn" onclick="saveUserNote('${escJsAttr(userId)}','${escJsAttr(userName)}')"
          style="flex:1;background:var(--accent,#52525b);border:none;border-radius:8px;padding:10px;cursor:pointer;color:#fff;font-weight:600;">保存</button>
        <button onclick="document.getElementById('_userNoteModal')?.remove()"
          style="flex:1;background:rgba(255,255,255,0.08);border:none;border-radius:8px;padding:10px;cursor:pointer;color:#fff;">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  setTimeout(() => document.getElementById('_userNoteText')?.focus(), 50);
}

async function saveUserNote(userId, userName) {
  const note = document.getElementById('_userNoteText')?.value || '';
  const btn = document.getElementById('_userNoteSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
  try {
    const r = await apiCall('/api/vrc/userNotes', {
      method: 'POST',
      json: { targetUserId: userId, note }
    });
    if (r.ok) {
      // Keep local copies in sync so the dialog reflects the change next open
      if (currentFriendProfile && currentFriendProfile.id === userId) currentFriendProfile.note = note;
      const af = allFriends.find(f => f.id === userId);
      if (af) af.note = note;
      document.getElementById('_userNoteModal')?.remove();
      showToast(`已保存对 ${userName} 的备注`, 'success');
      logMsg(`📝 已更新 ${userName} 的备注`, 'success');
    } else {
      const err = await r.json().catch(() => ({}));
      alert(`保存失败: ${err.error?.message || r.status}`);
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    }
  } catch(e) {
    alert('保存失败: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

// ═══════════════════════════════════════════════════════════
// FRIEND STATUS / CANCEL OUTGOING REQUEST
// ═══════════════════════════════════════════════════════════
async function cancelFriendRequest(userId, name) {
  if (!confirm(`确定取消向 ${name} 发送的好友请求吗？`)) return;
  try {
    const r = await apiCall(`/api/vrc/user/${userId}/friendRequest`, { method: 'DELETE' });
    if (r.ok) {
      showToast('已取消好友请求', 'success');
      logMsg(`已取消向 ${name} 的好友请求`, 'info');
    } else {
      alert('取消失败: ' + r.status);
    }
  } catch(e) { alert('错误: ' + e.message); }
}

async function friendRequestJoin(userId, name) {
  // Invite yourself to the user's current instance via POST /invite/myself/to/{instanceId}
  const f = currentFriendProfile;
  if (!f || !f.location || !f.location.startsWith('wrld_')) {
    alert('该好友当前不在公开实例中');
    return;
  }
  try {
    const r = await apiCall(`/api/vrc/invite/myself/to/${encodeURIComponent(f.location)}`, { method: 'POST' });
    if (r.ok) logMsg(`✅ 已申请加入 ${name} 的实例`, 'success');
    else {
      const err = await r.json().catch(() => ({}));
      alert(`❌ 失败: ${err.error?.message || r.status}`);
    }
  } catch(e) { alert('失败: ' + e.message); }
}

function friendRequestJoinMsg(userId, name) {
  // Invite yourself to user's instance with a custom message isn't directly supported;
  // We just do the standard self-invite
  if (!confirm(`向 ${name} 区请加入其当前实例?`)) return;
  friendRequestJoin(userId, name);
}



// Boop a user — VRChat lets you "boop" with a default emoji OR (if you're VRC+)
// one of your own uploaded emoji. Mirrors VRCX's SendBoopDialog.
async function sendBoop(userId, name) {
  document.getElementById('boopModal')?.remove();
  const z = modalZTop();

  // Default emoji grid (65 photon emojis, same set VRCX offers)
  const defaultGrid = PHOTON_EMOJIS.map(emo =>
    `<button class="boop-emoji" title="${escHtml(emo)}" data-emoji="${escJsAttr(photonEmojiId(emo))}"
       style="font-size:1.4em;padding:0;border-radius:10px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:var(--bg-glass);border:1px solid var(--border);cursor:pointer;transition:all 0.12s;">${PHOTON_EMOJI_ICONS[emo] || '💬'}</button>`
  ).join('');

  const modalHtml = `
  <div id="boopModal" class="modal" style="z-index:${z};" onclick="if(event.target===this)this.remove()">
    <div class="modal-content" style="max-width:420px;width:100%;display:flex;flex-direction:column;gap:12px;">
      <h3 style="margin:0;">👋 戳一下 ${escHtml(name)}</h3>
      <input id="boopSearch" type="text" class="input-field" placeholder="搜索表情 / Search emoji..."
        oninput="_filterBoopEmojis(this.value)" style="width:100%;">
      <div style="font-size:0.72em;color:var(--text-muted);">默认表情</div>
      <div id="boopDefaultGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:8px;max-height:220px;overflow-y:auto;padding:2px;">
        ${defaultGrid}
      </div>
      <div id="boopCustomWrap" style="display:none;">
        <div style="font-size:0.72em;color:var(--text-muted);margin-bottom:6px;">我的自定义表情 (VRC+)</div>
        <div id="boopCustomGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;max-height:160px;overflow-y:auto;padding:2px;"></div>
      </div>
      <button class="btn btn-secondary" style="width:100%;" onclick="document.getElementById('boopModal').remove()">取消</button>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Wire default emoji clicks
  const modal = document.getElementById('boopModal');
  modal.querySelectorAll('.boop-emoji').forEach(btn => {
    btn.addEventListener('mouseover', () => { btn.style.background = 'rgba(255,255,255,0.12)'; btn.style.borderColor = 'var(--border-hover)'; });
    btn.addEventListener('mouseout', () => { btn.style.background = 'var(--bg-glass)'; btn.style.borderColor = 'var(--border)'; });
    btn.addEventListener('click', () => { submitBoop(userId, btn.dataset.emoji); modal.remove(); });
  });

  // Load VRC+ custom emoji (only present for supporters; harmless 403 otherwise)
  try {
    const r = await apiCall('/api/vrc/files?tag=emoji&n=100');
    if (r.ok) {
      const files = await r.json();
      if (Array.isArray(files) && files.length && document.getElementById('boopModal') === modal) {
        const grid = document.getElementById('boopCustomGrid');
        grid.innerHTML = files.map(f => {
          const url = proxyImg(extractFileVersionUrl(f));
          return `<div class="boop-custom" data-emoji="${escJsAttr(f.id)}" title="${escHtml(f.name || '')}"
            style="cursor:pointer;border:1px solid var(--border);border-radius:8px;padding:4px;background:var(--bg-glass);display:flex;align-items:center;justify-content:center;">
            <img src="${escHtml(url)}" style="width:48px;height:48px;object-fit:contain;" loading="lazy" onerror="this.style.opacity='0.3'"></div>`;
        }).join('');
        document.getElementById('boopCustomWrap').style.display = '';
        grid.querySelectorAll('.boop-custom').forEach(el => {
          el.addEventListener('click', () => { submitBoop(userId, el.dataset.emoji); modal.remove(); });
        });
      }
    }
  } catch(_) {}
}

// Filter the default boop emoji grid by name (matches VRCX search behavior)
function _filterBoopEmojis(q) {
  q = (q || '').trim().toLowerCase();
  document.querySelectorAll('#boopDefaultGrid .boop-emoji').forEach(btn => {
    const name = (btn.getAttribute('title') || '').toLowerCase();
    btn.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

async function submitBoop(userId, emojiId) {
  try {
    // emojiId optional: omitting it sends a plain boop. default_* or file_* both valid.
    const json = emojiId ? { emojiId } : {};
    const r = await apiCall(`/api/vrc/users/${userId}/boop`, { method: 'POST', json });
    if (r.ok) {
      logMsg(`✅ 已戳一下对方`, 'success');
      showToast('已发送戳一下 👋', 'success');
    } else {
      const err = await r.json().catch(() => ({}));
      const msg = err.error?.message || ('HTTP ' + r.status);
      // 403/400 usually means the other side has booping disabled
      alert(`❌ 失败: ${msg}`);
    }
  } catch(e) { alert('失败: ' + e.message); }
}

async function sendPoke(userId, name, emojiId = 'default_heart') {
  // Use VRChat's actual Boop endpoint
  try {
    const r = await apiCall(`/api/vrc/users/${userId}/boop`, {
      method: 'POST',
      json: { 
        emojiId: emojiId 
      }
    });
    if (r.ok) logMsg(`✅ 已向 ${name} 发送戳一戳`, 'success');
    else {
      const err = await r.json().catch(() => ({}));
      alert(`❌ 失败: ${err.error?.message || r.status}`);
    }
  } catch(e) { alert('失败: ' + e.message); }
}

function showBoopMenu(e, userId, name) {
  // Reuse the shared photon emoji set (defined in core.js)
  const menuItems = PHOTON_EMOJIS.map(emo => ({
    icon: PHOTON_EMOJI_ICONS[emo] || '💬',
    label: emo,
    action: () => sendPoke(userId, name, photonEmojiId(emo))
  }));

  const fakeEvent = {
    clientX: e.clientX,
    clientY: e.clientY,
    stopPropagation: () => {}
  };

  const menu = buildCtxMenu([
    { label: `戳一戳: ${name}`, items: menuItems }
  ]);
  positionCtxMenu(fakeEvent, menu);
}

async function requestInvite(userId, name) {
  // POST /api/1/requestInvite/{userId} — ask user to invite YOU to their world
  try {
    const r = await apiCall(`/api/vrc/requestInvite/${userId}`, {
      method: 'POST',
      json: { platform: 'standalonewindows', rsvp: false }
    });
    if (r.ok) logMsg(`✅ 已向 ${name} 发送请求邀请`, 'success');
    else {
      const err = await r.json().catch(() => ({}));
      alert(`❌ 失败: ${err.error?.message || r.status}`);
    }
  } catch(e) { alert('失败: ' + e.message); }
}

async function sendInvite(userId, name) {
  // POST /api/1/invite/{userId} — invite user to YOUR current instance
  try {
    const meResp = await apiCall('/api/vrc/auth/user');
    if (!meResp.ok) throw new Error('无法获取当前状态');
    const me = await meResp.json();
    if (!me.location || me.location === 'offline' || me.location === 'private') {
      alert('你目前不在公共实例或处于离线状态，无法发送邀请。');
      return;
    }
    const r = await apiCall(`/api/vrc/invite/${userId}`, {
      method: 'POST',
      json: { instanceId: me.location, messageSlot: 0 }
    });
    if (r.ok) logMsg(`✅ 已向 ${name} 发送邀请`, 'success');
    else {
      const err = await r.json().catch(() => ({}));
      alert(`❌ 失败: ${err.error?.message || r.status}`);
    }
  } catch(e) { alert('失败: ' + e.message); }
}

async function blockUser(userId, name) {
  if (!confirm(`确认屏蔽 ${name}?`)) return;
  try {
    const r = await apiCall(`/api/vrc/auth/user/playermoderations`, {method:'POST', json:{moderated:userId, type:'block'}});
    if (r.ok) {
      // Optimistic update — immediately reflect in menu on next open
      myModerations = myModerations.filter(m => !(m.moderated === userId && m.type === 'block'));
      myModerations.push({ moderated: userId, type: 'block' });
      logMsg(`✅ 已屏蔽 ${name}`, 'success');
      logModerationAction(userId, name, 'block', 'block');
      fetchMyModerations(); // background sync
    } else logMsg(`❌ 屏蔽失败: ${r.status}`, 'error');
  } catch(e) { alert('发生错误: ' + e.message); }
}

async function unblockUser(userId, name) {
  try {
    const r = await apiCall(`/api/vrc/auth/user/unplayermoderate`, {method:'PUT', json:{moderated:userId, type:'block'}});
    if (r.ok) {
      myModerations = myModerations.filter(m => !(m.moderated === userId && m.type === 'block'));
      logMsg(`✅ 已解除屏蔽 ${name}`, 'success');
      logModerationAction(userId, name, 'block', 'unblock');
      fetchMyModerations();
    } else logMsg(`❌ 解除失败: ${r.status}`, 'error');
  } catch(e) { alert('发生错误: ' + e.message); }
}

async function muteUser(userId, name) {
  if (!confirm(`确认静音 ${name}?`)) return;
  try {
    const r = await apiCall(`/api/vrc/auth/user/playermoderations`, {method:'POST', json:{moderated:userId, type:'mute'}});
    if (r.ok) {
      myModerations = myModerations.filter(m => !(m.moderated === userId && m.type === 'mute'));
      myModerations.push({ moderated: userId, type: 'mute' });
      logMsg(`✅ 已静音 ${name}`, 'success');
      logModerationAction(userId, name, 'mute', 'mute');
      fetchMyModerations();
    } else logMsg(`❌ 静音失败: ${r.status}`, 'error');
  } catch(e) { alert('发生错误: ' + e.message); }
}

async function unmuteUser(userId, name) {
  try {
    const r = await apiCall(`/api/vrc/auth/user/unplayermoderate`, {method:'PUT', json:{moderated:userId, type:'mute'}});
    if (r.ok) {
      myModerations = myModerations.filter(m => !(m.moderated === userId && m.type === 'mute'));
      logMsg(`✅ 已解除静音 ${name}`, 'success');
      logModerationAction(userId, name, 'mute', 'unmute');
      fetchMyModerations();
    } else logMsg(`❌ 解除失败: ${r.status}`, 'error');
  } catch(e) { alert('发生错误: ' + e.message); }
}

async function showAvatarUser(userId, name) {
  try {
    const r = await apiCall(`/api/vrc/auth/user/playermoderations`, {method:'POST', json:{moderated:userId, type:'showAvatar'}});
    if (r.ok) {
      // Remove conflicting hideAvatar, add showAvatar
      myModerations = myModerations.filter(m => !(m.moderated === userId && (m.type === 'showAvatar' || m.type === 'hideAvatar')));
      myModerations.push({ moderated: userId, type: 'showAvatar' });
      logMsg(`✅ 已强制显示 ${name} 的模型`, 'success');
      logModerationAction(userId, name, 'avatar', 'show');
      fetchMyModerations();
    } else logMsg(`❌ 操作失败: ${r.status}`, 'error');
  } catch(e) { alert('发生错误: ' + e.message); }
}

async function hideAvatarUser(userId, name) {
  try {
    const r = await apiCall(`/api/vrc/auth/user/playermoderations`, {method:'POST', json:{moderated:userId, type:'hideAvatar'}});
    if (r.ok) {
      // Remove conflicting showAvatar, add hideAvatar
      myModerations = myModerations.filter(m => !(m.moderated === userId && (m.type === 'showAvatar' || m.type === 'hideAvatar')));
      myModerations.push({ moderated: userId, type: 'hideAvatar' });
      logMsg(`✅ 已隐藏 ${name} 的模型`, 'success');
      logModerationAction(userId, name, 'avatar', 'hide');
      fetchMyModerations();
    } else logMsg(`❌ 操作失败: ${r.status}`, 'error');
  } catch(e) { alert('发生错误: ' + e.message); }
}

async function disableAvatarInteraction(userId, name) {
  try {
    const r = await apiCall(`/api/vrc/auth/user/playermoderations`, {method:'POST', json:{moderated:userId, type:'interactOff'}});
    if (r.ok) {
      myModerations = myModerations.filter(m => !(m.moderated === userId && m.type === 'interactOff'));
      myModerations.push({ moderated: userId, type: 'interactOff' });
      logMsg(`✅ 已关闭 ${name} 的模型互动`, 'success');
      logModerationAction(userId, name, 'avatar', 'disableInteraction');
      fetchMyModerations();
    } else logMsg(`❌ 操作失败: ${r.status}`, 'error');
  } catch(e) { alert('发生错误: ' + e.message); }
}

async function resetAvatarModeration(userId, name, type) {
  try {
    const r = await apiCall(`/api/vrc/auth/user/unplayermoderate`, {method:'PUT', json:{moderated:userId, type}});
    if (r.ok) {
      // Remove the specific moderation entry
      myModerations = myModerations.filter(m => !(m.moderated === userId && m.type === type));
      const typeText = { showAvatar:'强制显示', hideAvatar:'隐藏', interactOff:'关闭互动' }[type] || type;
      logMsg(`✅ 已重置 ${name} 的${typeText}设置`, 'success');
      logModerationAction(userId, name, 'avatar', 'reset_' + type);
      fetchMyModerations();
    } else logMsg(`❌ 重置失败: ${r.status}`, 'error');
  } catch(e) { alert('发生错误: ' + e.message); }
}

async function fetchSharedInstances(userId) {
  try {
    const r = await apiCall(`/api/vrc/user/${userId}/instances`);
    const data = r.ok ? await r.json() : null;
    if (!data || !data.length) { alert('暂无共同进入过的房间记录'); return; }
    alert('共同进入过的房间:\n' + data.slice(0,10).map(i=>i.worldName||i.world||i).join('\n'));
  } catch(e) { alert('加载失败: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════
// SELF CONTEXT MENU
// ═══════════════════════════════════════════════════════════
function showSelfContextMenu(e) {
  e.stopPropagation();
  const u = myProfileData;
  if (!u) return;
  const id = u.id || '';
  const curStatus = u.status || 'active';
  const statusDots = { active: '🟢', 'join me': '🔵', 'ask me': '🟡', busy: '🔴' };

  const menu = buildCtxMenu([
    { items: [
      { icon:'🔄', label:'刷新我的资料', action: () => {
        myProfileData = null;
        fetchMyProfile(true).then(() => logMsg('✅ 资料已刷新', 'success'));
      }},
      { icon:'🔗', label:'打开 VRChat 主页', action: () => window.open(`https://vrchat.com/home/user/${id}`, '_blank') },
      { icon:'📋', label:'复制我的 ID', action: () => navigator.clipboard.writeText(id).then(() => logMsg('✅ ID 已复制', 'info')) },
    ]},
    { label:'快速切换状态', items: [
      { icon: curStatus === 'active'  ? '✅' : statusDots['active'],  label:'Online (Active)',        action: () => quickSetStatus('active') },
      { icon: curStatus === 'join me' ? '✅' : statusDots['join me'], label:'Join Me',                action: () => quickSetStatus('join me') },
      { icon: curStatus === 'ask me'  ? '✅' : statusDots['ask me'],  label:'Ask Me',                 action: () => quickSetStatus('ask me') },
      { icon: curStatus === 'busy'    ? '✅' : statusDots['busy'],    label:'Busy (勿扰)',             action: () => quickSetStatus('busy') },
    ]},
    { label:'模型信息', items: [
      { icon:'🧑', label:'显示当前模型信息', action: () => {
        const avId = u.currentAvatarId || u.currentAvatar;
        if (!avId) { alert('模型 ID 不可用'); return; }
        openAvtrdbDetail({ vrc_id: avId, name: u.currentAvatarName || avId,
          image_url: u.currentAvatarThumbnailImageUrl || '' });
      }},
      { icon:'👤', label:'显示备用模型信息', action: () => showFallbackAvatarInfo() },
      { icon:'🖼️', label:'前往我的模型库', action: () => switchTab('download') },
    ]},
    { label:'个人账号', items: [
      { icon:'✏️', label:'编辑 Bio / 状态文字', action: () => openEditProfileModal() },
      { icon:'🔒', label:'切换模型克隆权限', action: () => toggleAvatarCopying() },
    ]},
  ]);
  positionCtxMenu(e, menu);
}

async function quickSetStatus(newStatus) {
  const u = myProfileData;
  if (!u || !u.id) return;
  const labels = { active: 'Online', 'join me': 'Join Me', 'ask me': 'Ask Me', busy: 'Busy' };
  try {
    const r = await apiCall(`/api/vrc/users/${u.id}`, { method: 'PUT', json: { status: newStatus } });
    if (r.ok) {
      myProfileData.status = newStatus;
      logMsg(`✅ 状态已切换为 ${labels[newStatus] || newStatus}`, 'success');
      fetchMyProfile(true);
    } else {
      const err = await r.json().catch(() => ({}));
      alert(`❌ 切换失败: ${err.error?.message || r.status}`);
    }
  } catch(ex) { alert('失败: ' + ex.message); }
}

async function showFallbackAvatarInfo() {
  const u = myProfileData;
  if (!u) return;
  const fallbackId = u.fallbackAvatar;
  if (!fallbackId) {
    alert('未设置备用模型\n\n需要在游戏内将一个 PC+Quest 双端、Good 评级以上的模型设置为 Fallback Avatar。');
    return;
  }
  try {
    const r = await apiCall(`/api/vrc/avatars/${fallbackId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const av = await r.json();
    openAvtrdbDetail({
      vrc_id: av.id,
      name: av.name || fallbackId,
      image_url: av.thumbnailImageUrl || av.imageUrl || '',
      author: { name: av.authorName || 'Unknown', id: av.authorId },
      description: av.description || '',
      unityPackages: av.unityPackages || [],
      performance: av.performance || {},
      created_at: av.created_at || av.createdAt,
      updated_at: av.updated_at || av.updatedAt,
    });
  } catch(ex) { alert('无法加载备用模型信息: ' + ex.message); }
}

async function toggleAvatarCopying() {
  const u = myProfileData;
  if (!u || !u.id) return;
  const newVal = !u.allowAvatarCopying;
  if (!confirm(`确认将「允许克隆模型」设置为 ${newVal ? '✅ 允许' : '🔒 不允许'}？`)) return;
  try {
    const r = await apiCall(`/api/vrc/users/${u.id}`, { method: 'PUT', json: { allowAvatarCopying: newVal } });
    if (r.ok) {
      myProfileData.allowAvatarCopying = newVal;
      logMsg(`✅ 模型克隆权限已设置为 ${newVal ? '允许' : '不允许'}`, 'success');
      fetchMyProfile(true);
    } else {
      const err = await r.json().catch(() => ({}));
      alert(`❌ 失败: ${err.error?.message || r.status}`);
    }
  } catch(ex) { alert('失败: ' + ex.message); }
}



// ═══════════════════════════════════════════════════════════
// GALLERY ONLY (VRC+ 相册, no prints)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
