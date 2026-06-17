/*
 * VRCW - sidebar-profile.js
 * Resident sidebar mini-profile renderer used by friends/profile startup flows.
 */

function renderSidebarMiniProfile(u) {
  const el = document.getElementById('sidebarMyMiniProfile');
  if (!el || !u) return;
  const statusColor = { active: '#3b82f6', 'join me': '#52525b', 'ask me': '#f59e0b', busy: '#ef4444', offline: '#475569' }[u.status] || '#22c55e';
  const vrcP = isVRCPlus && isVRCPlus(u.tags || []);
  const thumb = proxyImg(u.profilePicOverrideThumbnail || u.userIcon || u.currentAvatarThumbnailImageUrl || '');
  el.innerHTML = `
    <div class="mini-dot" style="background:${statusColor};"></div>
    <img class="mini-avatar" src="${escHtml(thumb)}" onerror="this.style.display='none'">
    <div style="flex:1;min-width:0;">
      <div class="mini-name">${escHtml(u.displayName || '')}${vrcP ? ' <span style="font-size:0.65em;background:rgba(255, 255, 255, 0.2);color:#d4d4d8;border:1px solid rgba(255, 255, 255, 0.4);padding:1px 5px;border-radius:99px;">VRC+</span>' : ''}</div>
      <div class="mini-status">${escHtml(u.username || '')} - click to view profile</div>
    </div>
  `;
  el.onclick = () => fetchMyProfile();
}

VRCW.registerModule('sidebarProfile', {
  renderSidebarMiniProfile,
});
renderAppVersionInfo();
