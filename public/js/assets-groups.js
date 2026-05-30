/*
 * VRCW — assets-groups.js
 * 全局导航/资产(钱包/商店/库存/道具/相册/表情)/群组列表
 *
 * 注意：本项目为「经典脚本」(非 ES module)，全部按顺序加载、共享全局作用域。
 * 函数声明会提升为全局，跨文件调用没问题；请勿改为 type="module"。
 */

// ── Global Nav Sidebar Toggle ──
function toggleGlobalNav() {
  const nav     = document.getElementById("globalNav");
  const navCol  = document.getElementById("globalNavCollapsed");
  if (!nav || !navCol) return;
  const isOpen = !nav.classList.contains("hidden");
  nav.classList.toggle("hidden", isOpen);
  navCol.classList.toggle("hidden", !isOpen);
  try { localStorage.setItem("navCollapsed", isOpen ? "1" : "0"); } catch(_) {}
}
document.addEventListener("DOMContentLoaded", () => {
  try {
    if (localStorage.getItem("navCollapsed") === "1") {
      document.getElementById("globalNav")?.classList.add("hidden");
      document.getElementById("globalNavCollapsed")?.classList.remove("hidden");
    }
  } catch(_) {}
});

// ══════════════════════════════════════════════
// 💰 Assets & Economy Panel 
// ══════════════════════════════════════════════

// ════════════════ VRC Upload Functions ════════════════

// Helper: extract best image URL from a VRChat File object's versions array
function extractFileVersionUrl(f) {
  if (!f || !f.versions || !f.versions.length) return '';
  // Find the latest version with status=complete and a file URL
  for (let i = f.versions.length - 1; i >= 0; i--) {
    const v = f.versions[i];
    if (v.status === 'complete' && v.file && v.file.url) return v.file.url;
  }
  // Fallback: any version with a file URL
  for (let i = f.versions.length - 1; i >= 0; i--) {
    const v = f.versions[i];
    if (v.file && v.file.url) return v.file.url;
  }
  return '';
}

async function uploadToVRC(tag, fileInput, onDone) {
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    alert('请选择一个图片文件');
    return;
  }
  const file = fileInput.files[0];
  if (!file.type.startsWith('image/')) {
    alert('仅支持图片文件 (PNG/JPEG/WebP)');
    return;
  }
  // Size limits: icon/gallery < 10MB, emoji/sticker < 10MB and must be < 1024×1024
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    alert('文件过大！VRChat 限制图片最大 10MB。');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('tag', tag);

  const statusEl = document.getElementById('uploadStatus_' + tag);
  if (statusEl) { statusEl.textContent = '上传中...'; statusEl.style.color = 'var(--text-muted)'; }

  try {
    // Route through apiCall so the freshest in-memory vrcAuth is used (not a
    // possibly-stale localStorage copy) and response auth gets updated. FormData
    // body intentionally has no Content-Type set — the browser adds the multipart boundary.
    const r = await apiCall('/api/vrc/file/image', {
      method: 'POST',
      body: formData,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error('HTTP ' + r.status + ': ' + errText.substring(0, 200));
    }
    if (statusEl) { statusEl.textContent = '✅ 上传成功！'; statusEl.style.color = 'var(--success)'; }
    fileInput.value = '';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
    if (onDone) onDone();
  } catch(e) {
    if (statusEl) { statusEl.textContent = '❌ ' + e.message; statusEl.style.color = 'var(--error)'; }
    console.error('Upload failed:', e);
  }
}


// ════════════════ Groups Tab ════════════════

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
      // Created by me: check ownerId
      filtered = filtered.filter(g => g.ownerId === me.id || g.userId === me.id);
      title = "👑 我创建的群组 (" + filtered.length + ")";
    } else {
      // Joined: not created by me
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
  } catch(e) {
    if (isAbortError(e)) return;
    area.innerHTML = '<div style="color:var(--error);padding:20px;">加载失败: ' + e.message + '</div>';
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
  } catch(e) {
    results.innerHTML = '<div style="color:var(--error);">搜索失败: ' + e.message + '</div>';
  }
}

function initAssetsTab() {
  document.querySelectorAll('#assetsPanel .cat-btn').forEach(b => b.classList.remove('active', 'btn-primary'));
  const btn = document.getElementById('cat-assets-balance');
  if (btn) {
    btn.classList.add('active', 'btn-primary');
    switchAssetsPage('balance');
  }
}

let _assetsGen = 0;  // incremented each time a sub-tab is clicked

function switchAssetsPage(page) {
  document.querySelectorAll('#assetsPanel .cat-btn').forEach(b => b.classList.remove('active', 'btn-primary'));
  const btn = document.getElementById('cat-assets-' + page);
  if (btn) btn.classList.add('active', 'btn-primary');

  const content = document.getElementById('assetsContentArea');
  content.innerHTML = '<div style="color:var(--text-muted);margin:20px;">加载中... (Loading...)</div>';

  const gen = ++_assetsGen;  // capture current generation
  if (page === 'balance') fetchBalance(content, gen);
  else if (page === 'store') fetchStore(content, gen);
  else if (page === 'tx') fetchTransactions(content, gen);
  else if (page === 'sub') fetchSubscriptions(content, gen);
  else if (page === 'gallery') fetchGalleryOnly(content, gen);
  else if (page === 'prints') fetchPrints(content, gen);
  else if (page === 'emoji') fetchEmoji(content, gen);
  else if (page === 'inventory') fetchInventory(content, gen);
  else if (page === 'props') fetchProps(content, gen);
}

async function fetchBalance(container, gen) {
  try {
    const me = await (await apiCall('/api/vrc/auth/user')).json();
    if (_assetsGen !== gen) return;
    if (!me || !me.id) throw new Error("Not logged in");
    const bal = await (await apiCall(`/api/vrc/user/${me.id}/balance`)).json();
    if (_assetsGen !== gen) return;
    container.innerHTML = `
      <h2 style="margin-bottom:16px;">👛 钱包余额</h2>
      <div class="my-profile-card" style="display:flex;align-items:center;gap:20px;max-width:400px;">
        <div style="width:60px;height:60px;background:var(--bg-glass);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--warning);">🪙</div>
        <div>
          <div style="font-size:0.8rem;color:var(--text-muted);">当前 VRChat 点数 / Credits</div>
          <div style="font-size:1.8rem;font-weight:700;color:var(--text-primary);">${bal.balance||0} <span style="font-size:0.5em;color:var(--text-muted);">VRC</span></div>
        </div>
      </div>
      <p style="margin-top:12px;color:var(--text-muted);font-size:0.85rem;">可在 VRChat 内购买创作者经济商品或订阅。</p>
    `;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--error);">Failed to load balance: ${e.message}</div>`;
  }
}

async function fetchStore(container, gen) {
  try {
    container.innerHTML = '<div style="color:var(--text-muted);margin:20px;">加载商店中...</div>';
    const [balResp, listResp] = await Promise.all([
      apiCall('/api/vrc/economy/balance'),
      apiCall('/api/vrc/economy/listings?n=20&offset=0')
    ]);
    if (_assetsGen !== gen) return;

    let balHtml = '';
    if (balResp.ok) {
      const bal = await balResp.json();
      const credits = bal.balance ?? bal.credits ?? bal.amount ?? '—';
      balHtml = `<div style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:linear-gradient(135deg,rgba(255, 255, 255, 0.15),rgba(255, 255, 255, 0.1));border:1px solid rgba(255, 255, 255, 0.3);border-radius:12px;margin-bottom:20px;">
        <span style="font-size:1.6em;">💎</span>
        <div>
          <div style="font-size:0.75em;color:var(--text-muted);font-weight:600;letter-spacing:.05em;text-transform:uppercase;">VRChat Credits</div>
          <div style="font-size:1.4em;font-weight:700;color:#d4d4d8;">${escHtml(String(credits))}</div>
        </div>
        <a href="https://vrchat.com/home/marketplace/storefront" target="_blank" class="btn btn-secondary" style="margin-left:auto;font-size:0.8em;">🛒 打开商店</a>
      </div>`;
    }

    let listingsHtml = '';
    if (listResp.ok) {
      const data = await listResp.json();
      const items = Array.isArray(data) ? data : (data.listings || data.results || []);
      if (items.length) {
        listingsHtml = '<h3 style="font-size:0.9rem;margin-bottom:12px;">🏷️ 商店商品</h3>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">' +
          items.map(item => {
            const img = proxyImg(item.thumbnailImageUrl || item.imageUrl || '');
            const name = escHtml(item.displayName || item.name || item.id || '商品');
            const price = item.priceTokens != null ? `💎 ${item.priceTokens}` : (item.price ? `$${(item.price/100).toFixed(2)}` : '');
            const type = escHtml(item.productType || item.type || '');
            return `<div style="background:var(--bg-glass);border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;" onclick="window.open('https://vrchat.com/home/marketplace','_blank')">
              ${img ? `<img src="${img}" style="width:100%;aspect-ratio:4/3;object-fit:cover;" loading="lazy" onerror="this.style.display='none'">` : '<div style="width:100%;aspect-ratio:4/3;background:var(--bg-secondary);"></div>'}
              <div style="padding:8px 10px;">
                <div style="font-size:0.85em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
                <div style="font-size:0.72em;color:var(--text-muted);">${type}</div>
                ${price ? `<div style="font-size:0.8em;color:#d4d4d8;font-weight:600;margin-top:4px;">${price}</div>` : ''}
              </div>
            </div>`;
          }).join('') + '</div>';
      } else {
        listingsHtml = '<div style="color:var(--text-muted);font-size:0.85em;">暂无上架商品，或此功能需要 VRC+ Creator 权限。</div>';
      }
    } else {
      // Listings may require special perms - just link to website
      listingsHtml = `<div style="padding:20px;text-align:center;background:var(--bg-glass);border:1px solid var(--border);border-radius:10px;">
        <div style="font-size:2em;margin-bottom:8px;">🏪</div>
        <div style="font-size:0.85em;color:var(--text-muted);margin-bottom:12px;">商品列表需要在 VRChat 网站查看</div>
        <a href="https://vrchat.com/home/marketplace/storefront" target="_blank" class="btn btn-primary" style="font-size:0.85em;">🔗 打开 VRChat 商店</a>
      </div>`;
    }

    container.innerHTML = '<h2 style="margin-bottom:16px;">🏪 商店浏览</h2>' + balHtml + listingsHtml;
  } catch(e) {
    container.innerHTML = '<div style="color:var(--error);">加载失败: ' + e.message + '</div>';
  }
}

async function fetchTransactions(container) {
  try {
    const r = await apiCall('/api/vrc/Steam/transactions');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tx = await r.json();
    container.innerHTML = '<h2 style="margin-bottom:16px;">💸 交易记录</h2>';
    if (!tx || (Array.isArray(tx) && tx.length === 0)) {
      container.innerHTML += '<div style="color:var(--text-muted);">暂无交易记录</div>';
      return;
    }
    const items = Array.isArray(tx) ? tx : [tx];
    const statusColors = {succeeded:'#86efac',expired:'#fbbf24',failed:'#f87171'};
    const statusLabels = {succeeded:'✅ 成功',expired:'⏰ 已过期',failed:'❌ 失败'};
    container.innerHTML += items.map(t => {
      const sub = t.subscription || {};
      const amt = t.amount || sub.amount;
      const amtStr = amt ? (amt / 100).toFixed(2) : '—';
      const created = t.created_at ? new Date(t.created_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      const st = t.status || 'unknown';
      const stColor = statusColors[st] || 'var(--text-muted)';
      const stLabel = statusLabels[st] || st;
      const giftTo = t.isGift && t.targetDisplayName ? ' → 🎁 ' + escHtml(t.targetDisplayName) : '';
      const isCredits = t.active && t.orderId && t.orderId.startsWith('tx_');
      
      return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-glass);border:1px solid var(--border);border-radius:12px;margin-bottom:8px; transition: transform 0.2s;" onmouseover="this.style.transform='translateX(4px)'" onmouseout="this.style.transform='none'">
        <div style="width:36px;height:36px;border-radius:50%;background:${isCredits ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.1)'};display:flex;align-items:center;justify-content:center;font-size:1.1em;border:1px solid var(--border);">
          ${isCredits ? '💎' : '💳'}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:0.85em;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(sub.description || t.id || '交易')} ${giftTo}</div>
          <div style="font-size:0.68em;color:var(--text-muted);margin-top:2px;">${created} · ID: ${escHtml(t.id?.substring(0,8))}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:0.9em;font-weight:700;color:var(--text-primary);">$${amtStr} <span style="font-size:0.75em;opacity:0.6;font-weight:400;">USD</span></div>
          <div style="font-size:0.7em;font-weight:700;color:${stColor};margin-top:2px;">${stLabel}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = '<div style="color:var(--error);">加载失败: ' + e.message + '</div>';
  }
}

async function fetchSubscriptions(container) {
  try {
    const subs = await (await apiCall('/api/vrc/auth/user/subscription')).json();
    container.innerHTML = '<h2 style="margin-bottom:16px;">⭐ VRC+ 订阅</h2>';
    if (!subs || subs.length === 0) {
      container.innerHTML += '<div style="color:var(--text-muted);">当前无有效的 VRC+ 订阅 (No active subscriptions)</div>';
      return;
    }
    container.innerHTML += subs.map(s => `<div class="my-profile-card" style="margin-bottom:12px;">
      <h3 style="color:#d4d4d8;margin-bottom:4px;">${escHtml(s.description || s.tier || 'VRChat Plus')}</h3>
      <div style="font-size:0.8rem;color:var(--text-secondary);">
        状态: <span style="color:var(--success);">${s.status||'active'}</span><br>
        类型: ${s.store||'Unknown'}<br>
        过期时间: ${s.expires ? new Date(s.expires).toLocaleString() : '永久'}
      </div>
    </div>`).join('');
  } catch(e) {
    container.innerHTML = `<div style="color:var(--error);">Failed to load subscriptions: ${e.message}</div>`;
  }
}

async function fetchEmoji(container, gen) {
  try {
    container.innerHTML = '<div style="color:var(--text-muted);margin:20px;">加载中...</div>';
    const [rEmoji, rEmojiAnim, rSticker] = await Promise.all([
      apiCall('/api/vrc/files?tag=emoji&n=100'),
      apiCall('/api/vrc/files?tag=emojianimated&n=100'),
      apiCall('/api/vrc/files?tag=sticker&n=100'),
    ]);
    const emojis = rEmoji.ok ? await rEmoji.json() : [];
    const emojisAnim = rEmojiAnim.ok ? await rEmojiAnim.json() : [];
    const stickers = rSticker.ok ? await rSticker.json() : [];
    if (_assetsGen !== gen) return;
    const allEmojis = emojis.concat(emojisAnim);

    const renderFileGrid = (files, emptyText) => {
      if (!files || !files.length) return '<div style="color:var(--text-muted);font-size:0.85em;margin-bottom:20px;">' + emptyText + '</div>';
      return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:10px;margin-bottom:20px;">' +
        files.map(f => {
          const imgUrl = proxyImg(extractFileVersionUrl(f));
          const animMeta = getEmojiAnimMeta(f);
          const isAnimated = !!animMeta || (f.tags && f.tags.includes('emojianimated'));
          // For animated emoji with frame metadata, render an animated spritesheet tile.
          const TILE = 56;
          let media;
          if (animMeta) {
            const innerStyle = animatedEmojiStyle(imgUrl, animMeta.fps, animMeta.frames, animMeta.loopStyle, TILE);
            media = '<div style="width:' + TILE + 'px;height:' + TILE + 'px;overflow:hidden;position:relative;">' +
                      '<div style="' + innerStyle + '"></div>' +
                    '</div>';
          } else {
            media = '<img src="' + escHtml(imgUrl) + '" style="width:' + TILE + 'px;height:' + TILE + 'px;object-fit:contain;" loading="lazy" onerror="this.style.opacity=\'0.3\'">';
          }
          return '<div title="' + escHtml(f.name || f.id) + '" style="background:var(--bg-glass);border:1px solid var(--border);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;align-items:center;padding:6px;gap:4px;position:relative;">' +
            (isAnimated ? '<span style="position:absolute;top:4px;right:4px;font-size:0.55em;background:#52525b;color:#fff;padding:1px 4px;border-radius:3px;z-index:2;">动画</span>' : '') +
            media +
            '<div style="font-size:0.6em;color:var(--text-muted);text-align:center;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(f.name || '') + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    };

    container.innerHTML = '<h2 style="margin-bottom:16px;">😊 表情与贴纸</h2>' +
      '<div class="vrc-upload-row">' +
        makeUploadCard({title:'😊 上传静态表情', hint:'PNG · 最大 10MB · 最大 1024×1024', tag:'emoji', accept:'image/png,image/jpeg,image/webp', refreshPage:'emoji'}) +
        makeUploadCard({title:'🎞️ 上传动态表情 (GIF)', hint:'GIF → 自动转精灵图 · 最大 10MB', tag:'emojianimated', accept:'image/gif', refreshPage:'emoji'}) +
        makeUploadCard({title:'🏷️ 上传贴纸', hint:'PNG · 最大 10MB · 最大 1024×1024', tag:'sticker', accept:'image/png,image/jpeg,image/webp', refreshPage:'emoji'}) +
      '</div>' +
      '<h3 style="font-size:0.9rem;margin-bottom:10px;">自定义表情 (' + allEmojis.length + ')</h3>' +
      renderFileGrid(allEmojis, '暂无自定义表情（需要 VRC+，可在官网或此处上传）') +
      '<h3 style="font-size:0.9rem;margin-bottom:10px;">贴纸 (' + stickers.length + ')</h3>' +
      renderFileGrid(stickers, '暂无贴纸（需要 VRC+，可在官网或此处上传）');
  } catch(e) {
    container.innerHTML = '<div style="color:var(--error);">加载失败: ' + e.message + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════
// INVENTORY (库存物品: 无人机/传送门/加载屏/掉落物等)
// GET /inventory → { data: [...] } paginated, + GET /inventory/global
// ═══════════════════════════════════════════════════════════
const _equipSlotLabels = { drone: '无人机', portal: '传送门', warp: 'Warp', loadingscreen: '加载屏' };

async function fetchInventory(container, gen) {
  try {
    container.innerHTML = '<div style="color:var(--text-muted);margin:20px;">加载库存中...</div>';
    const items = [];
    // Paginate (cap at a few pages to stay within request budget)
    for (let i = 0; i < 5; i++) {
      const r = await apiCall(`/api/vrc/inventory?n=100&offset=${i * 100}&order=newest`);
      if (_assetsGen !== gen) return;
      if (!r.ok) break;
      const j = await r.json().catch(() => ({}));
      const batch = j.data || j.items || (Array.isArray(j) ? j : []);
      if (!batch.length) break;
      items.push(...batch);
      if (batch.length < 100) break;
    }
    if (_assetsGen !== gen) return;

    // Group by itemType for readability
    const groups = {};
    for (const it of items) {
      const t = it.itemType || it.type || 'other';
      (groups[t] = groups[t] || []).push(it);
    }
    const typeLabel = { prop: '🪄 道具', emoji: '😊 表情', sticker: '🏷️ 贴纸', gift: '🎁 礼物', drop: '📦 掉落物', other: '📦 其它' };

    const card = (it) => {
      const img = proxyImg(it.imageUrl || it.thumbnailImageUrl || (it.metadata && it.metadata.imageUrl) || '');
      const equipped = it.isEquipped || (it.flags && it.flags.includes('equipped'));
      const slot = it.equipSlot || (it.metadata && it.metadata.equipSlot);
      const canEquip = ['drone', 'portal', 'warp', 'loadingscreen'].includes(slot);
      return '<div style="background:var(--bg-glass);border:1px solid var(--border);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;">' +
        (img ? `<img src="${escHtml(img)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;" loading="lazy" onerror="this.style.display='none'">` : '<div style="width:100%;aspect-ratio:1/1;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:2em;">🎁</div>') +
        '<div style="padding:8px 10px;display:flex;flex-direction:column;gap:4px;">' +
          `<div style="font-size:0.8em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(it.name || it.id || '')}</div>` +
          (slot ? `<div style="font-size:0.65em;color:var(--text-muted);">槽位: ${escHtml(_equipSlotLabels[slot] || slot)}</div>` : '') +
          (canEquip ? `<button class="btn btn-secondary" style="font-size:0.7em;padding:4px;" onclick="equipInventoryItem('${escJsAttr(it.id)}','${escJsAttr(slot)}',${equipped ? 'true' : 'false'})">${equipped ? '卸下' : '装备'}</button>` : '') +
        '</div></div>';
    };

    let html = '<h2 style="margin-bottom:16px;">🎁 库存物品 (' + items.length + ')</h2>';
    if (!items.length) {
      html += '<div style="color:var(--text-muted);font-size:0.9em;">暂无库存物品。库存包含无人机、传送门、加载屏、掉落物等（部分需要 VRC+）。</div>';
    } else {
      for (const [t, list] of Object.entries(groups)) {
        html += `<h3 style="font-size:0.9rem;margin:14px 0 10px;">${typeLabel[t] || ('📦 ' + t)} (${list.length})</h3>`;
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;">' +
          list.map(card).join('') + '</div>';
      }
    }
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div style="color:var(--error);">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

async function equipInventoryItem(inventoryId, slot, currentlyEquipped) {
  try {
    let r;
    if (currentlyEquipped) {
      r = await apiCall(`/api/vrc/inventory/${inventoryId}/equip`, { method: 'DELETE' });
    } else {
      r = await apiCall(`/api/vrc/inventory/${inventoryId}/equip`, { method: 'PUT', json: { equipSlot: slot } });
    }
    if (r.ok) {
      showToast(currentlyEquipped ? '已卸下' : '已装备', 'success');
      switchAssetsPage('inventory');
    } else {
      const err = await r.json().catch(() => ({}));
      alert((currentlyEquipped ? '卸下' : '装备') + '失败: ' + (err.error?.message || r.status));
    }
  } catch(e) { alert('错误: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════
// PROPS (道具) — GET /props, GET /props/{id}
// ═══════════════════════════════════════════════════════════
async function fetchProps(container, gen) {
  try {
    container.innerHTML = '<div style="color:var(--text-muted);margin:20px;">加载道具中...</div>';
    const me = await (await apiCall('/api/vrc/auth/user')).json();
    if (_assetsGen !== gen) return;
    if (!me || !me.id) throw new Error('未登录');
    // /props lists the current user's props (owned)
    const r = await apiCall(`/api/vrc/props?userId=${me.id}&n=100`);
    if (_assetsGen !== gen) return;
    let props = [];
    if (r.ok) props = await r.json().catch(() => []);
    if (!Array.isArray(props)) props = props.data || [];

    let html = '<h2 style="margin-bottom:16px;">🪄 道具 Props (' + props.length + ')</h2>';
    if (!props.length) {
      html += '<div style="color:var(--text-muted);font-size:0.9em;">暂无道具。道具(Props)是可在世界中生成的物件，需在 Unity SDK 中创建上传。</div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">' +
        props.map(p => {
          const img = proxyImg(p.imageUrl || p.thumbnailImageUrl || '');
          const published = p.releaseStatus === 'public' || p.published;
          return '<div style="background:var(--bg-glass);border:1px solid var(--border);border-radius:10px;overflow:hidden;">' +
            (img ? `<img src="${escHtml(img)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;" loading="lazy" onerror="this.style.display='none'">` : '<div style="width:100%;aspect-ratio:1/1;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:2em;">🪄</div>') +
            '<div style="padding:8px 10px;">' +
              `<div style="font-size:0.82em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(p.name || p.id || '')}</div>` +
              `<div style="font-size:0.65em;color:${published ? '#4ade80' : 'var(--text-muted)'};margin-top:2px;">${published ? '✅ 已发布' : '🔒 未发布'}</div>` +
            '</div></div>';
        }).join('') + '</div>';
    }
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div style="color:var(--error);">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

