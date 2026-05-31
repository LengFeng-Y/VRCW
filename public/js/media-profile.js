/*
 * VRCW — media-profile.js
 * GIF转精灵图/上传卡片/相册/拍立得/邀请自己/管理记录/编辑资料
 *
 * 注意：本项目为「经典脚本」(非 ES module)，全部按顺序加载、共享全局作用域。
 * 函数声明会提升为全局，跨文件调用没问题；请勿改为 type="module"。
 */
// GIF → PNG Spritesheet Converter (for emojianimated)
// ═══════════════════════════════════════════════════════════
async function gifToSpritesheet(file, fpsOverride) {
  // Parse GIF using gifuct-js
  const buf = await file.arrayBuffer();
  let frames;
  try {
    const gif = window.parseGIF(buf);
    frames = window.decompressFrames(gif, true);
  } catch(e) {
    throw new Error('无法解析 GIF: ' + e.message);
  }
  if (!frames || frames.length < 2) throw new Error('GIF 至少需要 2 帧！');

  // Auto-detect FPS from GIF frame delays (delay is in centiseconds)
  // gifuct-js exposes frame.delay in centiseconds (1/100 s)
  const avgDelayCentisec = frames.reduce((s, f) => s + (f.delay || 10), 0) / frames.length;
  const detectedFps = Math.round(100 / avgDelayCentisec);  // centisec → fps
  const fps = fpsOverride !== undefined ? Math.min(Math.max(fpsOverride, 1), 64) : Math.min(Math.max(detectedFps, 1), 64);

  // Clamp frames to VRChat limit (max 64)
  const SHEET_SIZE = 1024;
  const totalFrames = Math.min(frames.length, 64);
  // Pick best grid: 2x2 (4), 4x4 (16), 8x8 (64)
  let cols;
  if (totalFrames <= 4)  { cols = 2; }
  else if (totalFrames <= 16) { cols = 4; }
  else { cols = 8; }
  const rows = cols;
  const frameSize = SHEET_SIZE / cols;  // 512, 256, or 128

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SHEET_SIZE;
  const ctx = canvas.getContext('2d');

  // Patch all frames onto the canvas grid
  for (let i = 0; i < cols * rows && i < totalFrames; i++) {
    const f = frames[i];
    // Draw gifuct frame to a temp canvas
    const tmp = document.createElement('canvas');
    tmp.width = f.dims.width; tmp.height = f.dims.height;
    const tmpCtx = tmp.getContext('2d');
    const id = tmpCtx.createImageData(f.dims.width, f.dims.height);
    id.data.set(f.patch);
    tmpCtx.putImageData(id, 0, 0);
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.drawImage(tmp, col * frameSize, row * frameSize, frameSize, frameSize);
  }

  // Export as PNG Blob
  const pngBlob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  return { blob: pngBlob, frames: totalFrames, framesOverTime: fps, detectedFps };
}

function makeUploadCard(opts) {
  // opts: { id, title, hint, tag, accept, refreshPage, showFps }
  const uniqueId = 'upl_' + opts.tag + '_' + Date.now();
  const isAnimated = opts.tag === 'emojianimated';
  return `<div class="vrc-upload-card">
    <h4>${opts.title}</h4>
    <div class="vrc-upload-zone" id="zone_${uniqueId}"
      ondragover="event.preventDefault();this.classList.add('dragover')"
      ondragleave="this.classList.remove('dragover')"
      ondrop="event.preventDefault();this.classList.remove('dragover');document.getElementById('${uniqueId}').files=event.dataTransfer.files;onUploadFileSelected('${uniqueId}','${opts.tag}')">
      <span class="upload-icon">${isAnimated ? '🎞️' : '📤'}</span>
      <span class="upload-label">点击或拖拽文件</span>
      <span class="upload-hint">${opts.hint}</span>
      <span class="upload-selected" id="sel_${uniqueId}">未选择文件</span>
      <span class="upload-dim" id="dim_${uniqueId}" style="font-size:0.72em;color:var(--text-muted);"></span>
      <input type="file" id="${uniqueId}" accept="${opts.accept}"
        onchange="onUploadFileSelected('${uniqueId}','${opts.tag}')">
    </div>
    ${isAnimated ? `<label style="font-size:0.78em;color:var(--text-muted);display:flex;align-items:center;gap:8px;margin-top:6px;">动画 FPS：<input type="range" id="fps_${uniqueId}" min="1" max="64" value="12" style="flex:1;"><span id="fpsval_${uniqueId}">12</span></label>` : ''}
    <button class="vrc-upload-btn" id="btn_${uniqueId}" disabled
      onclick="uploadToVRCStyled('${uniqueId}','${opts.tag}','${opts.refreshPage}')">上传</button>
    <div class="vrc-upload-status" id="status_${uniqueId}"></div>
  </div>`;
}

async function onUploadFileSelected(inputId, tag) {
  const input  = document.getElementById(inputId);
  const sel    = document.getElementById('sel_' + inputId);
  const dim    = document.getElementById('dim_' + inputId);
  const btn    = document.getElementById('btn_' + inputId);
  const fpsEl  = document.getElementById('fpsval_' + inputId);
  const fpsSl  = document.getElementById('fps_' + inputId);
  if (!input || !input.files || !input.files[0]) return;
  const f = input.files[0];
  const tooBig = f.size > 10 * 1024 * 1024;
  sel.textContent = f.name + ' (' + (f.size/1024/1024).toFixed(2) + ' MB)';
  sel.style.color = tooBig ? '#f87171' : 'var(--accent-light)';
  // Sync FPS slider label
  if (fpsEl && fpsSl) {
    fpsSl.oninput = () => fpsEl.textContent = fpsSl.value;
  }
  // For static emoji/sticker—show dimension warning if needed
  if (tag === 'emoji' || tag === 'sticker') {
    const img = new Image();
    img.onload = () => {
      const ok = img.width <= 1024 && img.height <= 1024;
      if (dim) dim.textContent = img.width + '×' + img.height + (ok ? '' : ' ⚠️ 超出 1024×1024！');
      if (dim) dim.style.color = ok ? 'var(--text-muted)' : '#f87171';
      btn.disabled = tooBig || !ok;
    };
    img.onerror = () => { btn.disabled = tooBig; };
    img.src = URL.createObjectURL(f);
  } else if (tag === 'emojianimated') {
    // For GIFs, auto-detect FPS from frame delays
    if (f.type === 'image/gif') {
      if (dim) { dim.textContent = '⏳ 正在读取 GIF 帧速...'; dim.style.color = 'var(--text-muted)'; }
      const buf = await f.arrayBuffer();
      try {
        const gif = window.parseGIF(buf);
        const gifFrames = window.decompressFrames(gif, false);
        const avgDelay = gifFrames.reduce((s, fr) => s + (fr.delay || 10), 0) / gifFrames.length;
        const detectedFps = Math.min(Math.max(Math.round(100 / avgDelay), 1), 64);
        if (fpsSl) { fpsSl.value = detectedFps; }
        if (fpsEl) { fpsEl.textContent = detectedFps; }
        if (dim) {
          dim.textContent = `✅ ${gifFrames.length} 帧，自动检测 ${detectedFps} fps`;
          dim.style.color = 'var(--accent-light)';
        }
      } catch(e) {
        if (dim) { dim.textContent = '⚠️ 无法解析 GIF，手动设置 FPS'; dim.style.color = '#f87171'; }
      }
    } else {
      if (dim) dim.textContent = '⚠️ 动态表情请上传 GIF';
      if (dim) dim.style.color = '#f87171';
    }
    btn.disabled = tooBig;
  } else {
    btn.disabled = tooBig;
  }
}

async function uploadToVRCStyled(inputId, tag, refreshPage) {
  const input    = document.getElementById(inputId);
  const btn      = document.getElementById('btn_' + inputId);
  const statusEl = document.getElementById('status_' + inputId);
  const fpsSl    = document.getElementById('fps_' + inputId);
  if (!input || !input.files || !input.files[0]) { statusEl.textContent = '请先选择文件'; return; }
  let file = input.files[0];
  if (file.size > 10*1024*1024) { statusEl.textContent = '❌ 文件超过 10MB'; statusEl.style.color='#f87171'; return; }

  btn.disabled = true;
  statusEl.style.color = 'var(--text-muted)';

  const fd = new FormData();

  try {
    if (tag === 'emojianimated') {
      // GIF → Spritesheet conversion
      statusEl.textContent = '⏳ 正在转换 GIF → 精灵图（可能需要几秒）...';
      if (file.type !== 'image/gif') throw new Error('动态表情必须上传 GIF 文件！');
      const fps = fpsSl ? parseInt(fpsSl.value) || 12 : 12;
      const { blob, frames, framesOverTime } = await gifToSpritesheet(file, fps);
      fd.append('filestring', blob, 'spritesheet.png');
      fd.append('tagstring', 'emojianimated');
      fd.append('frames', String(frames));
      fd.append('framesOverTime', String(framesOverTime));
      statusEl.textContent = `⏳ 上传精灵图（${frames} 帧，${framesOverTime}fps）...`;
    } else if (tag === 'emoji' || tag === 'sticker') {
      // Static emoji/sticker — validate 1024×1024
      statusEl.textContent = '⏳ 检查尺寸...';
      await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => {
          if (img.width > 1024 || img.height > 1024) rej(new Error(`图片尺寸 ${img.width}×${img.height} 超出上限 1024×1024`));
          else res();
        };
        img.onerror = res; // if can't load dimensions, proceed anyway
        img.src = URL.createObjectURL(file);
      });
      fd.append('filestring', file, file.name);
      fd.append('tagstring', tag);
      statusEl.textContent = '⏳ 上传中...';
    } else {
      // gallery, icon, prints preview
      fd.append('filestring', file, file.name);
      fd.append('tagstring', tag);
      statusEl.textContent = '⏳ 上传中...';
    }

    // Route through apiCall (fresh in-memory vrcAuth + multipart boundary auto-set).
    const r = await apiCall('/api/vrc/file/image', {
      method: 'POST',
      body: fd
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('HTTP ' + r.status + ': ' + txt.substring(0, 200));
    }
    statusEl.textContent = '✅ 上传成功！';
    statusEl.style.color = '#86efac';
    input.value = '';
    const selEl = document.getElementById('sel_' + inputId);
    if (selEl) selEl.textContent = '未选择文件';
    const dimEl = document.getElementById('dim_' + inputId);
    if (dimEl) dimEl.textContent = '';
    setTimeout(() => { if (refreshPage) switchAssetsPage(refreshPage); }, 1800);
  } catch(e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.style.color = '#f87171';
    btn.disabled = false;
  }
}

async function fetchGalleryOnly(container, gen) {
  try {
    container.innerHTML = '<div style="color:var(--text-muted);margin:20px;">加载中...</div>';
    const r = await apiCall('/api/vrc/files?tag=gallery&n=60');
    if (gen != null && _assetsGen !== gen) return;
    const files = r.ok ? await r.json() : [];
    container.innerHTML = '<h2 style="margin-bottom:16px;">🖼️ VRC+ 相册</h2>';
    container.innerHTML += '<div class="vrc-upload-row">' + makeUploadCard({
      title:'📤 上传到 VRC+ 相册', hint:'PNG/JPG/GIF · 最大 10MB',
      tag:'gallery', accept:'image/*', refreshPage:'gallery', id:'gallery'
    }) + '</div>';
    container.innerHTML += '<h3 style="font-size:0.92rem;margin-bottom:12px;">📸 我的相册 (' + files.length + ')</h3>';
    if (files.length) {
      container.innerHTML += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;">' +
        files.map(f => {
          const imgUrl = proxyImg(extractFileVersionUrl(f));
          return '<div style="border-radius:8px;overflow:hidden;background:var(--bg-glass);border:1px solid var(--border);cursor:pointer;" onclick="if(this.querySelector(\'img\').src)window.open(this.querySelector(\'img\').src,\'_blank\')">' +
            '<img src="' + escHtml(imgUrl) + '" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;" loading="lazy" onerror="this.style.display=\'none\'">' +
            '<div style="padding:4px 6px;font-size:0.68em;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(f.name||'') + '</div>' +
          '</div>';
        }).join('') + '</div>';
    } else {
      container.innerHTML += '<div style="color:var(--text-muted);font-size:0.85em;">暂无 VRC+ 相册图片（需要 VRC+，可在游戏内或此处上传）</div>';
    }
  } catch(e) {
    container.innerHTML = '<div style="color:var(--error);">加载失败: ' + e.message + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════
// PRINTS (拍立得照片) - separate page
// ═══════════════════════════════════════════════════════════
async function fetchPrints(container, gen) {
  try {
    container.innerHTML = '<div style="color:var(--text-muted);margin:20px;">加载中...</div>';
    const me = await (await apiCall('/api/vrc/auth/user')).json();
    if (gen != null && _assetsGen !== gen) return;
    const r = await apiCall('/api/vrc/prints/user/' + me.id + '?n=100&offset=0');
    if (gen != null && _assetsGen !== gen) return;
    const prints = r.ok ? await r.json() : [];
    const printUploadId = 'printUpl_' + Date.now();
    container.innerHTML = '<h2 style="margin-bottom:12px;">🎞️ 拍立得照片</h2>' +
      '<div class="vrc-upload-card" style="max-width:420px;margin-bottom:20px;">' +
        '<h4>📤 上传拍立得照片</h4>' +
        '<div class="vrc-upload-zone" id="zone_' + printUploadId + '"' +
          ' ondragover="event.preventDefault();this.classList.add(\'dragover\')"' +
          ' ondragleave="this.classList.remove(\'dragover\')"' +
          ' ondrop="event.preventDefault();this.classList.remove(\'dragover\');document.getElementById(\'' + printUploadId + '\').files=event.dataTransfer.files;onPrintFileSelected(\'' + printUploadId + '\')">' +
          '<span class="upload-icon">📷</span>' +
          '<span class="upload-label">点击或拖拽照片 (PNG/JPG)</span>' +
          '<span class="upload-hint">最大 10MB · 推荐 1920×1080 · 需要 VRC+</span>' +
          '<span class="upload-selected" id="sel_' + printUploadId + '">未选择文件</span>' +
          '<input type="file" id="' + printUploadId + '" accept="image/*" onchange="onPrintFileSelected(\'' + printUploadId + '\')">' +
        '</div>' +
        '<input type="text" id="note_' + printUploadId + '" class="input-field" placeholder="备注 / Caption（选填）" style="font-size:0.8em;padding:6px 10px;margin-top:4px;">' +
        '<button class="vrc-upload-btn" id="btn_' + printUploadId + '" disabled onclick="uploadPrint(\'' + printUploadId + '\')">上传</button>' +
        '<div class="vrc-upload-status" id="status_' + printUploadId + '"></div>' +
      '</div>';
    if (!prints.length) {
      container.innerHTML += '<div style="color:var(--text-muted);font-size:0.85em;padding:40px;text-align:center;">暂无拍立得照片</div>';
      return;
    }
    container.innerHTML += '<div style="font-size:0.78em;color:var(--text-muted);margin-bottom:16px;">共 ' + prints.length + ' 张</div>';
    container.innerHTML += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px;">' +
      prints.map(p => {
        const rawUrl = (p.files && p.files.image) ? p.files.image : (p.imageUrl || p.thumbnailImageUrl || '');
        const imgUrl = proxyImg(rawUrl);
        const world = p.worldName || p.worldId || '';
        const author = p.ownerDisplayName || '';
        const date = p.createdAt ? new Date(p.createdAt).toLocaleDateString('zh-CN') : '';
        return '<div style="position:relative;cursor:pointer;background:#fff;border-radius:4px;padding:10px 10px 20px;box-shadow:0 4px 18px rgba(0,0,0,0.45);transition:transform 0.15s;" onmouseover="this.style.transform=\'scale(1.03)\'" onmouseout="this.style.transform=\'\'">' +
          '<button title="删除" onclick="event.stopPropagation(); deletePrint(\'' + escJsAttr(p.id) + '\', this)" style="position:absolute;top:6px;right:6px;z-index:3;background:rgba(0,0,0,0.55);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:0.8em;line-height:1;">×</button>' +
          '<img onclick="window.open(\'' + escHtml(imgUrl) + '\',\'_blank\')" src="' + escHtml(imgUrl) + '" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;border-radius:2px;" loading="lazy" onerror="this.style.display=\'none\'">' +
          '<div style="margin-top:8px;">' +
            '<div style="font-size:0.7em;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:sans-serif;">' + escHtml(world) + '</div>' +
            '<div style="font-size:0.65em;color:#888;font-family:sans-serif;display:flex;justify-content:space-between;">' +
              '<span>' + escHtml(author) + '</span><span>' + date + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
  } catch(e) {
    container.innerHTML = '<div style="color:var(--error);">加载失败: ' + e.message + '</div>';
  }
}

// Delete a polaroid print (DELETE /prints/{printId})
async function deletePrint(printId, btn) {
  if (!confirm('确定删除这张拍立得照片吗？此操作不可撤销。')) return;
  if (btn) btn.disabled = true;
  try {
    const r = await apiCall(`/api/vrc/prints/${printId}`, { method: 'DELETE' });
    if (r.ok) {
      // Remove the card from the DOM
      const card = btn && btn.closest('div');
      if (card && card.parentElement) card.remove();
      showToast('已删除拍立得', 'success');
      logMsg('🗑️ 已删除拍立得照片', 'info');
    } else {
      if (btn) btn.disabled = false;
      alert('删除失败: ' + r.status);
    }
  } catch(e) {
    if (btn) btn.disabled = false;
    alert('错误: ' + e.message);
  }
}
function onPrintFileSelected(inputId) {
  const input = document.getElementById(inputId);
  const sel   = document.getElementById('sel_' + inputId);
  const btn   = document.getElementById('btn_' + inputId);
  if (!input || !input.files || !input.files[0]) return;
  const f = input.files[0];
  sel.textContent = f.name + ' (' + (f.size/1024/1024).toFixed(2) + ' MB)';
  sel.style.color  = f.size > 10*1024*1024 ? '#f87171' : 'var(--accent-light)';
  btn.disabled = f.size > 10*1024*1024;
}

async function uploadPrint(inputId) {
  const input    = document.getElementById(inputId);
  const btn      = document.getElementById('btn_' + inputId);
  const statusEl = document.getElementById('status_' + inputId);
  const noteEl   = document.getElementById('note_' + inputId);
  if (!input || !input.files || !input.files[0]) { statusEl.textContent = '请先选择文件'; return; }
  const file = input.files[0];
  if (file.size > 10*1024*1024) { statusEl.textContent = '❌ 文件超过 10MB'; statusEl.style.color='#f87171'; return; }
  btn.disabled = true;
  statusEl.textContent = '⏳ 上传中 (处理图片...)';
  statusEl.style.color = 'var(--text-muted)';
  try {
    // VRCX ALWAYS converts prints to PNG before uploading.
    // The VRChat POST /prints API strictly expects a PNG blob.
    const imgUrl = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('无法解析图片'));
      img.src = imgUrl;
    });
    
    // Draw to canvas and convert to PNG blob
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    URL.revokeObjectURL(imgUrl);

    statusEl.textContent = '⏳ 上传中 (发送到 VRChat...)';
    const fd = new FormData();
    fd.append('image', pngBlob, 'image.png');
    fd.append('timestamp', new Date().toISOString());
    if (noteEl && noteEl.value.trim()) fd.append('note', noteEl.value.trim());

    // Route through apiCall so X-VRC-Auth is attached (raw fetch would strip it
    // and VRChat returns 401 → silent print upload failure). Same trap as the
    // groups-instance.js vrcGroupAction fix.
    const r = await apiCall('/api/vrc/prints', { method: 'POST', body: fd });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error('HTTP ' + r.status + ': ' + txt);
    }
    statusEl.textContent = '✅ 上传成功！';
    statusEl.style.color = '#86efac';
    if (input) input.value = '';
    const sel = document.getElementById('sel_' + inputId);
    if (sel) sel.textContent = '未选择文件';
    setTimeout(() => switchAssetsPage('prints'), 2000);
  } catch(e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.style.color = '#f87171';
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// Friend Log & Change Detection Logic
// ═══════════════════════════════════════════════════════════════

async function inviteSelf(locationId) {
  if (!locationId || locationId === 'private' || locationId === 'offline') {
    friendLogMsg('❌ 无法发送邀请 (私有或离线)', 'error');
    return;
  }
  try {
    friendLogMsg(`📩 正在发送邀请到 ${locationId}...`, 'info');
    const r = await apiCall(`/api/vrc/invite/myself/to/${locationId}`, { method: 'POST' });
    if (r.ok) {
      friendLogMsg('✅ 邀请已发送，请在游戏内查收', 'success');
    } else {
      const err = await r.json();
      throw new Error(err.error?.message || '发送失败');
    }
  } catch(e) {
    friendLogMsg(`❌ 邀请失败: ${e.message}`, 'error');
  }
}

async function renderModerationLog() {
  const container = document.getElementById('modLogList');
  if (!container) return;
  try {
    const logs = await idb.getAllLogs('mod_logs');
    if (!logs || !logs.length) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.3);">暂无管理记录</div>';
      return;
    }
    // Sort by timestamp descending
    logs.sort((a,b) => b.timestamp - a.timestamp);
    container.innerHTML = logs.map(log => {
      const date = new Date(log.timestamp).toLocaleString();
      let icon = '🛡️', color = 'var(--text-secondary)';
      if (log.type === 'block') { icon = '🚫'; color = '#ef4444'; }
      if (log.type === 'mute')  { icon = '🔇'; color = '#f59e0b'; }
      if (log.type === 'avatar') { icon = log.action === 'show' ? '👁️' : '👓'; color = '#10b981'; }
      const actionText = {
        block: '屏蔽', unblock: '解除屏蔽',
        mute: '静音', unmute: '解除静音',
        show: '开启模型显示', hide: '关闭模型显示'
      }[log.action] || log.action;
      return `
        <div class="glass-card" style="padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px;border:1px solid var(--border);border-radius:12px;">
          <div style="font-size:1.5em;">${icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="color:var(--text-primary);font-size:0.95em;">${escHtml(log.displayName)}</strong>
              <span style="font-size:0.75em;color:rgba(255,255,255,0.3);">${date}</span>
            </div>
            <div style="font-size:0.85em;color:${color};margin-top:2px;">${actionText}</div>
            <div style="font-size:0.7em;color:rgba(255,255,255,0.2);margin-top:2px;">ID: ${log.userId}</div>
          </div>
        </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div style="color:var(--text-danger);text-align:center;padding:20px;">加载失败: ${e.message}</div>`;
  }
}

async function clearModerationLog() {
  if (!confirm('确定要清空所有管理记录吗？此操作不可撤销。')) return;
  await idb.clearLogs('mod_logs');
  renderModerationLog();
}

async function logModerationAction(userId, displayName, type, action) {
  try {
    const log = {
      userId,
      displayName,
      type, // 'block', 'mute', 'avatar'
      action, // 'block', 'unblock', 'mute', 'unmute', 'show', 'hide'
      timestamp: Date.now()
    };
    await idb.addLog('mod_logs', log);
  } catch(e) { console.error('logModerationAction error:', e); }
}

async function fetchMyModerations() {
  try {
    const r = await apiCall('/api/vrc/auth/user/playermoderations');
    if (r.ok) {
      myModerations = await r.json();
      // Don't re-render the friend modal here. The previous code rebuilt the
      // entire friend profile UI (including snapping back to the info tab),
      // breaking the user's flow if they were reading another sub-tab. The
      // moderations data is read on next user interaction.
    }
  } catch(e) { console.error('fetchMyModerations error:', e); }
}

async function openEditProfileModal() {
  const u = myProfileData;
  if (!u) {
    alert('正在加载个人资料，请稍后再试');
    return;
  }
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  // Use modalZTop() so this modal stacks above any already-open modal (was hard-
  // coded to 2000, which sits at the bottom of the modal range and got covered).
  modal.style.zIndex = modalZTop();
  modal.innerHTML = `
    <div class="modal-content glass" style="max-width:500px;padding:24px;width:90%;border:1px solid var(--border);border-radius:16px;">
      <h3 style="margin-bottom:20px;display:flex;align-items:center;gap:10px;font-size:1.1em;">
        <span>✏️</span> 编辑个人资料
      </h3>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="form-group" style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-size:0.85em;color:var(--text-secondary);">在线状态 (Status)</label>
          <select id="editProfileStatus" class="glass-input" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid var(--border);outline:none;">
            <option value="active" ${u.status === 'active' ? 'selected' : ''} style="background:var(--bg-card);color:var(--text-primary);">Online (🟢 Active)</option>
            <option value="join me" ${u.status === 'join me' ? 'selected' : ''} style="background:var(--bg-card);color:var(--text-primary);">Join Me (🔵 Join)</option>
            <option value="ask me" ${u.status === 'ask me' ? 'selected' : ''} style="background:var(--bg-card);color:var(--text-primary);">Ask Me (🟡 Ask)</option>
            <option value="busy" ${u.status === 'busy' ? 'selected' : ''} style="background:var(--bg-card);color:var(--text-primary);">Busy (🔴 Busy)</option>
          </select>
        </div>
        <div class="form-group" style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-size:0.85em;color:var(--text-secondary);">社交状态文字 (Status Description)</label>
          <input type="text" id="editStatusDesc" class="glass-input" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid var(--border);" value="${escHtml(u.statusDescription || '')}" placeholder="我在忙...">
        </div>
        <div class="form-group" style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-size:0.85em;color:var(--text-secondary);">人称代词 (Pronouns)</label>
          <input type="text" id="editPronouns" class="glass-input" style="width:100%;padding:10px;border-radius:8px;background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid var(--border);" value="${escHtml(u.pronouns || '')}" placeholder="He/Him, She/Her...">
        </div>
        <div class="form-group" style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-size:0.85em;color:var(--text-secondary);">个人简介 (Bio)</label>
          <textarea id="editBio" class="glass-input" style="width:100%;height:140px;resize:none;padding:10px;border-radius:8px;background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid var(--border);font-family:inherit;font-size:0.9em;line-height:1.5;">${escHtml(u.bio || '').replace(/\\n/g, '\n')}</textarea>
        </div>
        <div style="display:flex;gap:12px;margin-top:10px;">
          <button class="btn btn-primary" style="flex:1;padding:12px;" id="btnUpdateProfile">保存修改</button>
          <button class="btn btn-secondary" style="flex:1;padding:12px;" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>
      </div>
    </div>`;
  
  document.body.appendChild(modal);
  
  document.getElementById('btnUpdateProfile').onclick = async () => {
    const btn = document.getElementById('btnUpdateProfile');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      const payload = {
        status: document.getElementById('editProfileStatus').value,
        statusDescription: document.getElementById('editStatusDesc').value,
        pronouns: document.getElementById('editPronouns').value,
        bio: document.getElementById('editBio').value
      };
      // VRChat users PUT endpoint
      const r = await apiCall(`/api/vrc/users/${u.id}`, { method: 'PUT', json: payload });
      if (r.ok) {
        alert('✅ 资料已更新');
        modal.remove();
        fetchMyProfile(true);
      } else {
        const err = await r.json();
        alert('❌ 更新失败: ' + (err.error?.message || r.status));
        btn.disabled = false;
        btn.textContent = '保存修改';
      }
    } catch(e) {
      alert('❌ 发生错误: ' + e.message);
      btn.disabled = false;
      btn.textContent = '保存修改';
    }
  };
}
