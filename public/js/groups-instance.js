/*
 * VRCW — groups-instance.js
 * 群组详情/群组成员/实例占用与详情/共同群组好友
 *
 * 注意：本项目为「经典脚本」(非 ES module)，全部按顺序加载、共享全局作用域。
 * 函数声明会提升为全局，跨文件调用没问题；请勿改为 type="module"。
 */


async function loadMyGroups() {
  const el = document.getElementById('friendList');
  if (el) el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">加载群组中...</div>';
  try {
    const meResp = await apiCall('/api/vrc/auth/user');
    const me = await meResp.json();
    const r = await apiCall('/api/vrc/users/' + me.id + '/groups');
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + await r.text());
    const groups = await r.json();
    myGroupsCache = groups || [];
    if (!groups || !groups.length) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">暂无群组</div>';
      return;
    }
    // Sort: own groups first, then rest
    const owned = groups.filter(g => g.ownerId === me.id || g.userId === me.id);
    const other = groups.filter(g => g.ownerId !== me.id && g.userId !== me.id);
    let html = '';
    if (owned.length) {
      html += '<div style="padding:8px 0 4px;font-size:0.75em;font-weight:700;color:var(--text-muted);letter-spacing:0.05em;text-transform:uppercase;">我创建的群组</div>';
      html += owned.map(g => groupCardHtml(g, me.id)).join('');
      html += '<div style="margin:8px 0;border-top:1px solid var(--border);"></div>';
    }
    html += other.map(g => groupCardHtml(g, me.id)).join('');
    el.innerHTML = html;
    document.getElementById('friendStats').textContent = '共 ' + groups.length + ' 个群组';
  } catch(e) {
    if (isAbortError(e)) return;
    if (el) el.innerHTML = '<div style="color:var(--error);padding:20px;">加载失败: ' + e.message + '</div>';
  }
}

function groupCardHtml(g, myId) {
  const isOwner = g.ownerId === myId;
  return '<div class="friend-card" onclick="openGroupDetail(' + JSON.stringify(g.groupId||g.id) + ')" style="cursor:pointer;">' +
    '<div class="friend-avatar-wrap" style="border-radius:10px;">' +
      '<img src="' + escHtml(proxyImg(g.iconUrl||'')) + '" style="border-radius:10px;object-fit:cover;" onerror="this.style.display=\'none\'">' +
    '</div>' +
    '<div class="friend-info">' +
      '<div class="friend-name">' + escHtml(g.name||'') + (isOwner ? ' <span style="font-size:0.65em;background:rgba(255,255,255,0.13);color:#d4d4d8;border:1px solid rgba(255,255,255,0.27);padding:2px 6px;border-radius:99px;">创建者</span>' : '') + '</div>' +
      '<div class="friend-location" style="font-size:0.78em;color:var(--text-muted);">.' + escHtml(g.shortCode||'') + ' · 👥 ' + (g.memberCount||0) + '</div>' +
    '</div>' +
  '</div>';
}

async function openGroupDetail(groupId) {
  // Stale-DOM guard: detect old structure missing the new gdIconBox container
  // (added when icon was upgraded to 80px + fallback letter). If old DOM exists,
  // force a rebuild so users don't see the broken old icon.
  const existing = document.getElementById('groupDetailModal');
  if (existing && !existing.querySelector('#gdIconBox')) {
    existing.remove();
  }

  // Ensure group modal exists
  if (!document.getElementById('groupDetailModal')) {
    const html = `<div id="groupDetailModal" class="modal hidden" onclick="if(event.target===this)closeGroupDetail()">
      <div class="modal-content" style="max-width:560px;padding:0;overflow:hidden;">
        <div id="gdBanner" style="height:120px;background:var(--bg-secondary);background-size:cover;background-position:center;position:relative;flex-shrink:0;">
          <div style="position:absolute;inset:0;background:linear-gradient(to top,var(--bg-primary) 0%,var(--bg-primary) 20%,rgba(0,0,0,0.5) 60%,rgba(0,0,0,0.15) 100%);pointer-events:none;"></div>
          <button onclick="closeGroupDetail()" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.55);border:none;color:#fff;border-radius:99px;width:30px;height:30px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;z-index:3;">\u00d7</button>
        </div>
        <!-- Icon row: MUST be a sibling of gdBanner (not nested inside the scroll
             container) so its z-index:3 actually stacks above the banner's
             position:relative layer. margin-top:-40px pulls it up into the banner. -->
        <div style="display:flex;gap:16px;align-items:flex-end;margin-top:-40px;margin-bottom:0;padding:0 24px;position:relative;z-index:3;">
          <div id="gdIconBox" style="position:relative;width:80px;height:80px;border-radius:16px;overflow:hidden;border:3px solid var(--bg-primary);background:linear-gradient(135deg,#3f3f46,#27272a);flex-shrink:0;box-shadow:0 6px 16px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;color:#fff;font-size:2em;font-weight:700;">
            <span id="gdIconFallback" style="user-select:none;text-shadow:0 2px 4px rgba(0,0,0,0.5);"></span>
            <img id="gdIcon" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;" onload="this.style.display='block'" onerror="this.style.display='none'">
          </div>
          <div style="flex:1;padding-bottom:4px;min-width:0;">
            <div id="gdName" style="font-size:1.15rem;font-weight:700;color:var(--text-primary);text-shadow:0 2px 6px rgba(0,0,0,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
            <div id="gdShortCode" style="font-size:0.75em;color:var(--text-muted);"></div>
          </div>
        </div>
        <div style="padding:12px 24px 24px; overflow-y:auto; max-height:calc(100vh - 220px);">
          <div id="gdStats" style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.8em;color:var(--text-secondary);margin-bottom:10px;"></div>
          <div id="gdActions" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;"></div>
          <div id="gdDesc" style="font-size:0.85em;color:var(--text-secondary);line-height:1.6;max-height:180px;overflow-y:auto;white-space:pre-line;margin-bottom:16px;"></div>
          
          <div class="tab-nav" style="background:transparent;border-bottom:1px solid var(--border);margin-bottom:12px;">
            <button class="tab-btn active" onclick="switchGroupDetailTab(this, 'instances')">当前实例</button>
            <button class="tab-btn" onclick="switchGroupDetailTab(this, 'members')">成员列表</button>
          </div>
          
          <div id="gdInstances" class="group-instance-list"></div>
          <div id="gdMembers" class="group-member-list" style="display:none;"></div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }
  const modal = document.getElementById('groupDetailModal');
  modal.style.zIndex = modalZTop();
  modal.classList.remove('hidden');
  // Lock background scroll (guard against double-lock if reopened/refreshed).
  if (!modal.dataset.scrollLocked) {
    lockBodyScroll();
    modal.dataset.scrollLocked = '1';
  }
  document.getElementById('gdName').textContent = '加载中...';
  document.getElementById('gdDesc').textContent = '';
  document.getElementById('gdStats').innerHTML = '';
  document.getElementById('gdBanner').style.backgroundImage = '';
  // Reset icon: hide img, clear fallback letter; populated once group data arrives.
  const _gdIconImg = document.getElementById('gdIcon');
  const _gdIconFallback = document.getElementById('gdIconFallback');
  _gdIconImg.style.display = 'none';
  _gdIconImg.removeAttribute('src');
  _gdIconFallback.textContent = '';
  document.getElementById('gdShortCode').textContent = '';
  try {
    const r = await apiCall('/api/vrc/groups/' + groupId);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const g = await r.json();
    document.getElementById('gdBanner').style.backgroundImage = g.bannerUrl ? 'url(' + proxyImg(g.bannerUrl) + ')' : '';
    // Group icons are nullable in VRChat API. Try iconUrl, then bannerUrl, then fall
    // back to a letter avatar (first character of group name). The <img> only shows
    // on successful load; the fallback letter sits underneath it.
    const _iconSrc = g.iconUrl || g.bannerUrl || '';
    if (_iconSrc) {
      _gdIconImg.src = proxyImg(_iconSrc);
    }
    _gdIconFallback.textContent = (g.name || '?').trim().charAt(0).toUpperCase();
    document.getElementById('gdName').textContent = g.name || '';
    document.getElementById('gdShortCode').textContent = '.' + (g.shortCode || '');
    document.getElementById('gdDesc').textContent = g.description || '暂无简介';
    document.getElementById('gdStats').innerHTML =
      '<span>👥 ' + (g.memberCount || 0) + ' 成员</span>' +
      '<span style="opacity:0.3;margin:0 4px;">|</span>' +
      '<span>' + (g.joinState === 'closed' ? '🔒 闭门' : g.joinState === 'invite' ? '✉️ 邀请' : g.joinState === 'request' ? '✋ 申请' : '🔓 公开') + '</span>' +
      (g.languages && g.languages.length ? '<span style="opacity:0.3;margin:0 4px;">|</span><span>🌐 ' + g.languages.join(', ') + '</span>' : '');

    // Render Actions
    let actionHtml = '';
    if (g.myMember) {
      const myId = g.myMember.userId;
      const vis = g.myMember.visibility; // 'visible', 'hidden', 'friends'
      const oppVis = vis === 'visible' ? 'hidden' : 'visible';
      const visText = vis === 'visible' ? '👁️ 个人资料可见' : (vis === 'friends' ? '👥 仅好友可见' : '👻 资料页隐藏');
      actionHtml += `<button onclick="vrcGroupAction('${groupId}','visibility','${myId}','${oppVis}')" style="background:var(--bg-glass);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:0.75em;color:var(--text-primary);cursor:pointer;" title="点击切换">${visText}</button>`;
      actionHtml += `<button onclick="vrcGroupAction('${groupId}','leave')" style="background:#ef444422;border:1px solid #ef444444;border-radius:6px;padding:4px 10px;font-size:0.75em;color:#ef4444;cursor:pointer;">🚪 退出群组</button>`;
    } else {
      if (g.joinState !== 'closed') {
        actionHtml += `<button onclick="vrcGroupAction('${groupId}','join')" style="background:var(--accent);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:0.75em;color:#fff;cursor:pointer;font-weight:600;">➕ 申请加入</button>`;
      }
    }
    document.getElementById('gdActions').innerHTML = actionHtml;
    
    // Fetch extra data
    fetchGroupExtraData(groupId);

  } catch(e) {
    document.getElementById('gdName').textContent = '加载失败: ' + e.message;
  }
}

// Close the group detail modal and release the body scroll lock. Using a single
// helper (instead of inline classList.add('hidden')) keeps lock/unlock balanced.
function closeGroupDetail() {
  const modal = document.getElementById('groupDetailModal');
  if (!modal) return;
  modal.classList.add('hidden');
  if (modal.dataset.scrollLocked) {
    unlockBodyScroll();
    delete modal.dataset.scrollLocked;
  }
}

async function vrcGroupAction(groupId, action, myId, nextVis) {
  try {
    // NOTE: must go through apiCall() so the X-VRC-Auth header is attached.
    // A raw fetch('/api/vrc/...') sends no auth → worker treats it as logged-out
    // and join/leave/visibility silently fail. (Fixed: was `await fetch(...)`.)
    let url, opts = { method: 'POST' };
    if (action === 'leave') {
      if(!confirm('确定要退出该群组吗？')) return;
      url = '/api/vrc/groups/' + groupId + '/leave';
    } else if (action === 'join') {
      url = '/api/vrc/groups/' + groupId + '/join';
    } else if (action === 'visibility') {
      url = '/api/vrc/groups/' + groupId + '/members/' + myId;
      opts = { method: 'PUT', json: { visibility: nextVis } };
    } else {
      return;
    }

    const r = await apiCall(url, opts);
    if (!r.ok) throw new Error(await r.text());

    // Invalidate the cached groups list — leave/join would otherwise let the
    // sidebar keep showing the user as still in the group (or missing) for
    // up to a full reload, since loadGroupsPage early-returns when myGroupsCache
    // is populated. Setting it to null forces the next page open to re-fetch.
    myGroupsCache = null;

    // Refresh modal
    openGroupDetail(groupId);
  } catch(e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

function switchGroupDetailTab(btn, tab) {
  const container = btn.closest('.modal-content');
  container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.getElementById('gdInstances').style.display = tab === 'instances' ? '' : 'none';
  document.getElementById('gdMembers').style.display = tab === 'members' ? '' : 'none';
}

async function fetchGroupExtraData(groupId) {
  fetchGroupInstances(groupId);
  fetchGroupMembers(groupId);
}

async function fetchGroupInstances(groupId) {
  const el = document.getElementById('gdInstances');
  if(!el) return;
  el.innerHTML = '<div style="padding:10px;color:var(--text-muted);text-align:center;font-size:0.8em;">加载实例中...</div>';
  try {
    const r = await apiCall('/api/vrc/groups/' + groupId + '/instances');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const insts = await r.json();
    if (!insts || !insts.length) {
      el.innerHTML = '<div style="padding:10px;color:var(--text-muted);text-align:center;font-size:0.8rem;">暂无活动实例</div>';
      return;
    }
    el.innerHTML = insts.map(i => {
      const region = { us: '🇺🇸', use: '🇺🇸', eu: '🇪🇺', jp: '🇯🇵' }[i.region] || '🌐';
      const wName = (i.world && i.world.name) || i.worldName || '未知世界';
      const wCap  = (i.world && i.world.capacity) || i.capacity || 0;
      return `<div class="group-instance-card">
        <div class="inst-info">
          <div class="inst-name">${escHtml(wName)}</div>
          <div class="inst-meta">${region} ${escHtml(i.instanceId)} · ${escHtml(i.accessType)}</div>
        </div>
        <div class="inst-occupants">${i.n_users||0} / ${wCap}</div>
        <button class="btn btn-xs btn-primary" style="padding:4px 8px;font-size:0.7em;" onclick="inviteSelf('${escJsAttr(i.worldId + ':' + i.instanceId)}')">加入</button>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="padding:10px;color:var(--error);font-size:0.8rem;">无法加载实例: ' + escHtml(e.message) + '</div>';
  }
}

async function fetchGroupMembers(groupId) {
  const el = document.getElementById('gdMembers');
  if(!el) return;
  el.innerHTML = '<div style="padding:10px;color:var(--text-muted);text-align:center;font-size:0.8em;">加载成员中...</div>';
  try {
    // Note: VRChat API limit is 100 per page. We'll just fetch the first page for now.
    const r = await apiCall('/api/vrc/groups/' + groupId + '/members?n=50');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const members = await r.json();
    if (!members || !members.length) {
      el.innerHTML = '<div style="padding:10px;color:var(--text-muted);text-align:center;font-size:0.8rem;">暂无可见成员</div>';
      return;
    }
    el.innerHTML = members.map(m => {
      const u = m.user || {};
      const fJson = escAttrJson(u);
      return `
        <div class="group-member-card" onclick="openFriendProfile(this)" data-friend="${fJson}" style="cursor:pointer;">
          <img src="${escHtml(proxyImg(u.userIcon || u.profilePicOverrideThumbnail || u.currentAvatarThumbnailImageUrl || ''))}" class="member-avatar" onerror="this.onerror=null; this.src='data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='">
          <div class="member-info">
            <div class="member-name" title="${escHtml(u.displayName || '')}">${escHtml(u.displayName || 'Unknown')}</div>
            <div class="member-role">${escHtml(m.roleNames?.[0] || 'Member')}</div>
          </div>
        </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="padding:10px;color:var(--error);font-size:0.8rem;">无法加载成员: ' + escHtml(e.message) + '</div>';
  }
}


// ── Live instance occupancy (counts only; stranger roster not exposed by API) ──
async function fetchInstanceOccupancy(loc) {
  const el = document.getElementById('insOccupancy');
  if (!el) return;
  if (loc.indexOf(':') < 0) return;
  // loc is already "worldId:instanceId(+params)" — the instance endpoint accepts it as-is
  const instancePath = loc;
  el.innerHTML = '<span style="font-size:0.72em;color:var(--text-muted);">读取在线人数...</span>';
  try {
    const r = await apiCall('/api/vrc/instances/' + instancePath);
    if (!r.ok) { el.innerHTML = ''; return; }
    const ins = await r.json();
    const pill = (icon, label, val) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.72em;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text-secondary);">${icon} <b style="color:var(--text-primary);">${val}</b> ${label}</span>`;
    const parts = [];
    const userCount = (ins.userCount != null ? ins.userCount : ins.n_users);
    if (userCount != null) {
      const cap = ins.capacity != null ? ('/' + ins.capacity) : '';
      parts.push(pill('👥', '在线', userCount + cap));
    }
    if (ins.queueSize) parts.push(pill('⏳', '排队', ins.queueSize));
    if (ins.platforms) {
      if (ins.platforms.standalonewindows) parts.push(pill('🖥️', 'PC', ins.platforms.standalonewindows));
      if (ins.platforms.android) parts.push(pill('📱', 'Quest', ins.platforms.android));
      if (ins.platforms.ios) parts.push(pill('🍎', 'iOS', ins.platforms.ios));
    }
    if (ins.full) parts.push('<span style="font-size:0.72em;padding:3px 9px;border-radius:999px;background:rgba(239,68,68,0.18);color:#fca5a5;">已满</span>');
    el.innerHTML = parts.join('') ||
      '<span style="font-size:0.72em;color:var(--text-muted);">实例为空或信息不可用</span>';
  } catch (e) {
    el.innerHTML = '';
  }
}

async function openInstanceDetail(loc) {
  // private / offline / ~private instances cannot be joined
  const isPrivateLoc = !loc || loc === 'private' || loc === 'offline' || loc.includes('~private');
  if (isPrivateLoc) return;
  const worldId = loc.split(':')[0];
  
  // Ensure modal exists
  if (!document.getElementById('instanceDetailModal')) {
    const html = `<div id="instanceDetailModal" class="modal hidden" onclick="if(event.target===this)closeInstanceDetail()">
      <div class="modal-content" style="max-width:560px;padding:0;overflow:hidden;">
        <div id="insBanner" style="height:160px;background-size:cover;background-position:center;position:relative;">
          <div style="position:absolute;inset:0;background:linear-gradient(to top, var(--bg-card), transparent);"></div>
          <button onclick="closeInstanceDetail()" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.5);border:none;color:#fff;border-radius:50%;width:30px;height:30px;cursor:pointer;z-index:10;">×</button>
        </div>
        <div style="padding:20px;position:relative;margin-top:-40px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;">
            <div style="flex:1;">
              <h2 id="insWorldName" style="margin:0;font-size:1.4em;color:var(--text-primary);">加载中...</h2>
              <div id="insAuthorLine" style="font-size:0.85em;color:var(--text-secondary);margin-top:2px;"></div>
            </div>
            <div id="insStats" style="text-align:right;"></div>
          </div>

          <div id="insDesc" style="font-size:0.82em;color:var(--text-muted);line-height:1.5;max-height:80px;overflow-y:auto;margin-bottom:15px;white-space:pre-line;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;"></div>
          
          <div id="insTags" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:15px;"></div>

          <div id="insLoc" style="font-size:0.75em;color:var(--accent-light);margin-bottom:15px;font-family:monospace;word-break:break-all;background:rgba(255, 255, 255, 0.1);padding:6px 10px;border-radius:6px;border-left:3px solid var(--accent);"></div>

          <div id="insOccupancy" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:15px;"></div>
          
          <div style="display:flex;gap:10px;margin-bottom:20px;">
             <button id="insBtnWorld" class="btn btn-primary" style="flex:1;">🌍 世界详情</button>
             <button id="insBtnInvite" class="btn btn-success" style="flex:1;">📩 邀请自己</button>
          </div>

          <div style="font-size:0.85em;font-weight:700;margin-bottom:10px;color:var(--text-primary);display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border);padding-bottom:8px;">
            <span style="font-size:1.2em;">👥</span> 在此实例的好友
          </div>
          <div id="insFriendList" style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;padding-right:4px;"></div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  const modal = document.getElementById('instanceDetailModal');
  modal.style.zIndex = modalZTop();
  modal.classList.remove('hidden');
  if (!modal.dataset.scrollLocked) {
    lockBodyScroll();
    modal.dataset.scrollLocked = '1';
  }
  // Always update the action buttons for the CURRENT loc/worldId (fixes stale-closure bug)
  document.getElementById('insBtnWorld').onclick = () => openWorldDetail(worldId);
  // Show 'Invite Self' only for joinable instances (not ~private)
  const inviteBtn = document.getElementById('insBtnInvite');
  const isJoinableLoc = loc && !loc.includes('~private') && loc.startsWith('wrld_');
  if (isJoinableLoc) {
    inviteBtn.style.display = '';
    inviteBtn.onclick = () => inviteSelf(loc);
  } else {
    inviteBtn.style.display = 'none';
  }
  document.getElementById('insWorldName').textContent = '加载中...';
  document.getElementById('insAuthorLine').innerHTML = '';
  document.getElementById('insDesc').textContent = '';
  document.getElementById('insStats').innerHTML = '';
  document.getElementById('insTags').innerHTML = '';
  document.getElementById('insLoc').textContent = loc;
  const _occEl = document.getElementById('insOccupancy');
  if (_occEl) _occEl.innerHTML = '';
  document.getElementById('insFriendList').innerHTML = '<div style="text-align:center;padding:20px;opacity:0.5;">同步中...</div>';

  try {
    const wResp = await apiCall('/api/vrc/worlds/' + worldId);
    if (wResp.ok) {
      const w = await wResp.json();
      document.getElementById('insWorldName').textContent = w.name;
      document.getElementById('insBanner').style.backgroundImage = `url(${proxyImg(w.imageUrl)})`;
      document.getElementById('insAuthorLine').innerHTML = `by <a href="#" onclick="openFriendProfileById('${escJsAttr(w.authorId)}'); event.preventDefault();" style="color:var(--accent-light);text-decoration:none;">${escHtml(w.authorName)}</a>`;
      document.getElementById('insDesc').textContent = w.description || '暂无世界简介';
      
      const region = loc.includes('~region(') ? loc.match(/~region\((.*?)\)/)[1].toUpperCase() : 'US';
      const regionIcon = {US:'🇺🇸',EU:'🇪🇺',JP:'🇯🇵'}[region] || '🌐';
      
      document.getElementById('insStats').innerHTML = `
        <div style="font-size:0.9em;font-weight:700;">${regionIcon} ${region}</div>
        <div style="font-size:0.75em;color:var(--text-muted);">${w.releaseStatus === 'labs' ? '🧪 Labs' : '✅ Public'}</div>
      `;

      // Tags
      const interestingTags = (w.tags || []).filter(t => !t.startsWith('author_tag_') && !t.startsWith('system_')).slice(0, 5);
      document.getElementById('insTags').innerHTML = interestingTags.map(t => `<span style="font-size:0.7em;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:var(--text-muted);">${escHtml(t)}</span>`).join('');
    }

    // Live instance occupancy (people count / capacity / queue / platform split).
    // The full member roster of strangers is NOT exposed by the API; only counts.
    fetchInstanceOccupancy(loc);

    // Find all friends in this instance
    const friendsInIns = allFriends.filter(f => f.location === loc);

    // Check if the local user is also in this instance
    if (myProfileData && myProfileData.location === loc) {
      const selfProfile = { ...myProfileData };
      selfProfile.isSelf = true;
      friendsInIns.unshift(selfProfile);
    }

    const listEl = document.getElementById('insFriendList');
    if (!friendsInIns.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.5;font-size:0.85em;">当前没有其他在线好友在此实例</div>';
    } else {
      listEl.innerHTML = friendsInIns.map(f => {
        const trust = getTrustInfo(f.tags||[]);
        const safeJson = escAttrJson(f);
        return `<div class="friend-card" style="padding:10px;margin:0;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;transition:all 0.2s;cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'" onclick="openFriendProfile(this)" data-friend="${safeJson}">
          <div style="position:relative;">
            <img src="${proxyImg(f.currentAvatarThumbnailImageUrl||f.userIcon||'')}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid ${trust.color}44;">
          </div>
          <div style="flex:1;">
            <div style="font-size:0.95em;font-weight:600;color:${trust.color};display:flex;align-items:center;gap:6px;">
              ${escHtml(f.displayName)}
              ${f.isSelf ? '<span style="font-size:0.7em;background:rgba(255, 255, 255, 0.3);color:#d4d4d8;padding:2px 6px;border-radius:4px;">📍 我自己</span>' : ''}
            </div>
            <div style="font-size:0.75em;opacity:0.7;color:var(--text-muted);">${getStatusLabel(f)}</div>
          </div>
          <div style="font-size:0.7em;color:var(--text-muted);">${getPlatformEmoji(f.last_platform)}</div>
        </div>`;
      }).join('');
    }
  } catch(e) {
    console.error('Instance detail error', e);
    document.getElementById('insWorldName').textContent = '加载失败';
    // Don't leave the friend list spinning forever ("同步中...") when the
    // initial fetch throws — replace with an error indicator so the user
    // knows to retry instead of staring at it.
    const _flEl = document.getElementById('insFriendList');
    if (_flEl) _flEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--error);font-size:0.85em;">加载失败: ${escHtml(e.message || '网络错误')}</div>`;
  }
}

// Close the instance detail modal and release the body scroll lock.
function closeInstanceDetail() {
  const modal = document.getElementById('instanceDetailModal');
  if (!modal) return;
  modal.classList.add('hidden');
  if (modal.dataset.scrollLocked) {
    unlockBodyScroll();
    delete modal.dataset.scrollLocked;
  }
}


async function fetchMutualGroups(userId, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<span style="color:var(--text-muted);font-size:0.8em;">加载中...</span>';
  try {
    if (!myGroupsCache) {
      const meResp = await apiCall('/api/vrc/auth/user');
      const me = await meResp.json();
      const r = await apiCall('/api/vrc/users/' + me.id + '/groups');
      myGroupsCache = await r.json();
    }
    const r2 = await apiCall('/api/vrc/users/' + userId + '/groups');
    const theirGroups = await r2.json();
    const myIds = new Set((myGroupsCache||[]).map(g => g.groupId||g.id));
    const mutual = (theirGroups||[]).filter(g => myIds.has(g.groupId||g.id));
    if (!mutual.length) { el.innerHTML = '<span style="color:var(--text-muted);font-size:0.8em;">暂无共同群组</span>'; return; }
    el.innerHTML = '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + mutual.map(g => 
      '<div onclick="openGroupDetail(' + JSON.stringify(g.groupId||g.id) + ')" style="background:var(--bg-glass);border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.75em;display:flex;align-items:center;gap:6px;">' +
        '<img src="' + escHtml(proxyImg(g.iconUrl||'')) + '" style="width:18px;height:18px;border-radius:3px;" onerror="this.style.display=\'none\'">' +
        escHtml(g.name) +
      '</div>'
    ).join('') + '</div>';
  } catch(e) {
    el.innerHTML = '<span style="color:var(--text-muted);font-size:0.8em;">加载失败</span>';
  }
}

async function fetchMutualFriends(userId, containerId, seq) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<span style="color:var(--text-muted);font-size:0.8em;">加载中...</span>';
  try {
    // Correct VRChat API endpoint for mutual friends (same as VRCX uses)
    const r = await apiCall('/api/vrc/users/' + userId + '/mutuals/friends');
    if (seq != null && window._fpCurrentSeq !== seq) return; // user opened another friend
    if (r.status === 403) {
      // VRChat is still rolling out mutual friends - fall back to co-located friends
      await fetchMutualFriendsFallback(userId, el);
      return;
    }
    if (!r.ok) { await fetchMutualFriendsFallback(userId, el); return; }
    const json = await r.json();
    if (seq != null && window._fpCurrentSeq !== seq) return;
    const list = Array.isArray(json) ? json : (json.mutualFriends || json.users || []);
    if (!list.length) {
      el.innerHTML = '<span style="color:var(--text-muted);font-size:0.8em;">暂无共同好友</span>';
      return;
    }
    const renderUser = u => {
      const safeJson = escAttrJson(u);
      const t = getTrustInfo(u.tags || []);
      const thumb = proxyImg(u.profilePicOverrideThumbnail || u.userIcon || u.currentAvatarThumbnailImageUrl || '');
      return `
        <div class="group-member-card" onclick="openFriendProfile(this);" data-friend="${safeJson}" style="cursor:pointer;width:100%;max-width:none;">
          <img src="${escHtml(thumb)}" class="member-avatar" onerror="this.onerror=null; this.src='data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='">
          <div class="member-info">
            <div class="member-name" style="color:${t.color};" title="${escHtml(u.displayName || '')}">${escHtml(u.displayName || 'Unknown')}</div>
            <div class="member-role">${t.text || 'User'}</div>
          </div>
        </div>`;
    };
    el.innerHTML = `
      <div style="font-size:0.72em;font-weight:700;color:var(--text-muted);margin:0 0 10px 4px;text-transform:uppercase;letter-spacing:0.05em;">共同好友 (${list.length})</div>
      <div class="group-member-list">
        ${list.map(renderUser).join('')}
      </div>`;
  } catch(e) {
    el.innerHTML = '<span style="color:var(--text-muted);font-size:0.8em;">加载失败: ' + escHtml(e.message) + '</span>';
  }
}

async function fetchMutualFriendsFallback(userId, el) {
  let myFriends = window._allFriendsCache || window.allFriends || [];
  if (!myFriends.length) {
    const pages = [];
    let offset = 0;
    while (offset < 2000) {
      const r = await apiCall('/api/vrc/auth/user/friends?n=100&offset=' + offset + '&offline=true');
      if (!r.ok) break;
      const batch = await r.json();
      if (!batch || !batch.length) break;
      pages.push(...batch);
      if (batch.length < 100) break;
      offset += 100;
    }
    myFriends = pages;
    window._allFriendsCache = myFriends;
  }
  const detailR = await apiCall('/api/vrc/users/' + userId);
  const targetUser = detailR.ok ? await detailR.json() : {};
  const targetLoc = targetUser.location || '';
  const colocated = targetLoc && targetLoc.startsWith('wrld_') ? myFriends.filter(f => f.location === targetLoc) : [];
  
  const renderUser = u => {
    const safeJson = escAttrJson(u);
    const t = getTrustInfo(u.tags || []);
    const thumb = proxyImg(u.profilePicOverrideThumbnail || u.userIcon || u.currentAvatarThumbnailImageUrl || '');
    return `
      <div class="group-member-card" onclick="openFriendProfile(this);" data-friend="${safeJson}" style="cursor:pointer;width:100%;max-width:none;">
        <img src="${escHtml(thumb)}" class="member-avatar" onerror="this.onerror=null; this.src='data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='">
        <div class="member-info">
          <div class="member-name" style="color:${t.color};" title="${escHtml(u.displayName || '')}">${escHtml(u.displayName || 'Unknown')}</div>
          <div class="member-role">${t.text || 'User'}</div>
        </div>
      </div>`;
  };

  if (colocated.length) {
    el.innerHTML = `
      <div style="font-size:0.72em;font-weight:700;color:var(--text-muted);margin:0 0 10px 4px;text-transform:uppercase;letter-spacing:0.05em;">同在此实例的好友 (${colocated.length})</div>
      <div class="group-member-list">
        ${colocated.map(renderUser).join('')}
      </div>`;
  } else {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:0.8em;line-height:1.6;padding:8px 0;">ℹ️ VRChat 正在逐步向所有用户开放共同好友功能（/users/{id}/mutuals 端点），你的账号可能暂未激活此功能<br>' +
      (targetLoc && targetLoc.startsWith('wrld_') ? '此用户当前不在你任何好友所在的实例。' : '此用户不在线或位置不可见。') + '</div>';
  }
}


// ═══════════════════════════════════════════════════════════
