/*
 * VRCW — images.js
 * 图片懒加载/视口取消/批量预取
 *
 * 注意：本项目为「经典脚本」(非 ES module)，全部按顺序加载、共享全局作用域。
 * 函数声明会提升为全局，跨文件调用没问题；请勿改为 type="module"。
 */
// ── Smart Image Loading with Viewport Cancellation ──
// Strategy (rev 2026-06-18, after user feedback "loads everything at once, some time out"):
// - Moderate preload: rootMargin 600px (≈ 0.6 viewports above + below) so only
//   near-viewport cards queue, not the whole grid.
// - Soft cancel on scroll-away: remove the image's PENDING queue entries (so
//   it won't start loading), but do NOT abort an already-in-flight fetch —
//   the bytes are arriving and IDB/CF cache will make the scroll-back cheap.
//   This frees concurrency slots for visible cards without wasting bandwidth.
// - 15s per-image timeout so a hung origin fetch can't starve the 12-wide queue.
// - Higher concurrency (12) so a wide grid fills in faster.
const imageQueue = [];
let runningLoads = 0;
const MAX_CONCURRENT_IMAGES = 12;
const loadedImageUrls = new Set();
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function imageCacheKey(src) {
  if (!src || !src.includes('/api/image')) return src || '';
  try {
    const u = new URL(src, location.href);
    return `${u.searchParams.get('bucket') || _apiAuthBucket()}::${u.searchParams.get('url') || src}`;
  } catch (_) {
    return src;
  }
}

function processImageQueue() {
  while (runningLoads < MAX_CONCURRENT_IMAGES && imageQueue.length > 0) {
    runningLoads++;
    const { img, src } = imageQueue.shift();

    // Skip if cancelled while waiting in queue
    if (img.dataset.cancelled) {
      delete img.dataset.loading;
      delete img.dataset.cancelled;
      runningLoads--;
      continue;
    }

    const wrapper = img.parentElement;
    const cacheKey = imageCacheKey(src);

    // Called on successful load or permanent failure
    const finishLoad = (success) => {
      img.onload = img.onerror = null;
      delete img._abortCtrl;
      img.classList.remove('loading');
      if (wrapper) wrapper.classList.remove('img-loading');
      runningLoads--;
      if (success) {
        img.removeAttribute('data-src');
        delete img.dataset.loading;
        avatarObserver.unobserve(img);
      }
      processImageQueue();
    };

    // Called when fetch is aborted (scrolled out) — restore state for retry
    const cancelLoad = () => {
      img.onload = img.onerror = null;
      delete img._abortCtrl;
      delete img.dataset.cancelled;
      delete img.dataset.loading; // Allow re-queuing on next intersection
      img.classList.remove('loading');
      if (wrapper) wrapper.classList.remove('img-loading');
      // Don't unobserve — observer will retrigger when image re-enters viewport
      runningLoads--;
      processImageQueue();
    };

    img.onload = () => { loadedImageUrls.add(cacheKey); finishLoad(true); };
    img.onerror = () => {
      const retryCount = parseInt(img.dataset.retry || '0');
      if (retryCount < 2 && !img.dataset.cancelled) {
        img.dataset.retry = retryCount + 1;
        imageQueue.push({ img, src });
        finishLoad(false);
      } else {
        img.classList.add('failed');
        if (wrapper) {
          wrapper.classList.add('img-failed');
          // Tap-to-retry: clicking a failed thumbnail re-queues it. The user
          // shouldn't have to scroll out + back in just to retry a transient
          // CDN hiccup. Listener is one-shot per failure.
          if (!wrapper.dataset.retryWired) {
            wrapper.dataset.retryWired = '1';
            wrapper.style.cursor = 'pointer';
            wrapper.title = '点击重试加载';
            const onRetryClick = (e) => {
              e.stopPropagation();
              wrapper.classList.remove('img-failed');
              wrapper.style.cursor = '';
              wrapper.title = '';
              delete wrapper.dataset.retryWired;
              wrapper.removeEventListener('click', onRetryClick);
              img.classList.remove('failed');
              img.dataset.retry = '0';
              const oldSrc = img.getAttribute('data-src');
              // If data-src was already cleared, recover from the current src
              const recoverSrc = oldSrc || img.src;
              if (recoverSrc) {
                img.setAttribute('data-src', recoverSrc);
                img.dataset.loading = '1';
                imageQueue.push({ img, src: recoverSrc });
                processImageQueue();
              }
            };
            wrapper.addEventListener('click', onRetryClick);
          }
        }
        img.removeAttribute('data-src');
        delete img.dataset.loading;
        avatarObserver.unobserve(img);
        finishLoad(false);
      }
    };

    img.classList.add('loading');
    if (wrapper) wrapper.classList.add('img-loading');

    // Check IDB cache first (instant, no network)
    idb.getImage(cacheKey).then(blob => {
      if (img.dataset.cancelled) { cancelLoad(); return; }

      if (blob) {
        img.src = URL.createObjectURL(blob);
        // onload fires → finishLoad(true)
      } else {
        // Yield to priority tasks (tab switches etc.)
        if (isPriorityTaskRunning) {
          imageQueue.unshift({ img, src });
          runningLoads--;
          setTimeout(processImageQueue, 500);
          return;
        }

        // Fetch with AbortController so we can cancel mid-flight, plus a 15s
        // timeout so a hung origin fetch can't hold a concurrency slot forever
        // (starving the rest of the grid — the "some images time out" symptom).
        const ctrl = new AbortController();
        img._abortCtrl = ctrl;
        const timeoutSignal = AbortSignal.timeout(15000);
        const combinedSignal = AbortSignal.any ? AbortSignal.any([ctrl.signal, timeoutSignal]) : ctrl.signal;

        fetch(src, { signal: combinedSignal })
          .then(r => r.blob())
          .then(blob => {
            delete img._abortCtrl;
            if (img.dataset.cancelled) { cancelLoad(); return; }
            if (blob && blob.type.startsWith('image/')) {
              idb.setImage(cacheKey, blob);
              img.src = URL.createObjectURL(blob);
              // onload fires → finishLoad(true)
            } else {
              img.src = src; // Fallback direct URL
            }
          })
          .catch(e => {
            delete img._abortCtrl;
            if (e.name === 'AbortError') {
              cancelLoad(); // Clean cancel — restore for retry
            } else {
              img.src = src; // Network error fallback
            }
          });
      }
    }).catch(() => { finishLoad(false); });
  }
}

const avatarObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const img = entry.target;
      if (entry.isIntersecting) {
        // Entering viewport (or preload zone): clear cancel flag, queue for load
        delete img.dataset.cancelled;
        const src = img.getAttribute('data-src');
        if (src && !img.dataset.loading) {
          img.dataset.loading = '1';
          imageQueue.push({ img, src });
          processImageQueue();
        } else if (src && img.dataset.loading === '1') {
          // Already queued but maybe far back behind 500 other items from a
          // scroll burst — bubble it to the front so currently-visible cards
          // win the next concurrency slot. We only re-order pending items
          // (those still in imageQueue); in-flight loads keep going.
          const idx = imageQueue.findIndex(it => it.img === img);
          if (idx > 0) {
            const item = imageQueue.splice(idx, 1)[0];
            imageQueue.unshift(item);
          }
        }
      } else {
        // Leaving viewport: soft cancel. Remove this image's PENDING queue
        // entries (not yet started) so they don't grab a concurrency slot the
        // now-visible cards need. We do NOT abort an already-in-flight fetch —
        // the bytes are arriving and the IDB/CF cache makes scroll-back cheap.
        // Setting cancelled also makes processImageQueue skip it if it was
        // about to start (line ~41 guard).
        img.dataset.cancelled = '1';
        for (let i = imageQueue.length - 1; i >= 0; i--) {
          if (imageQueue[i].img === img) imageQueue.splice(i, 1);
        }
      }
    });
  },
  // 600px ≈ 0.6 viewports above and below. Smaller than the old 1500px so the
  // queue isn't flooded with the whole grid the moment it renders, but still
  // enough headroom that normal scroll speed stays inside the preload zone.
  { rootMargin: '600px 0px' }
);

// ── Batch Image Prefetch ──
// Sends thumbnail URLs to the Worker's batch endpoint so it can
// download them from VRC's servers at edge speed and cache them.
function prefetchThumbnails(avatarList) {
  const rawUrls = avatarList
    .map(av => av.thumbnailImageUrl || av.imageUrl || "")
    .filter(u => u && (u.includes("api.vrchat.cloud") || u.includes("files.vrchat.cloud")));

  // Skip URLs already in the browser's memory cache
  const cacheKeys = rawUrls.map(u =>
    imageCacheKey(`${API_BASE}/api/image?url=${encodeURIComponent(u)}&auth=${encodeURIComponent(vrcAuth || "")}&bucket=${encodeURIComponent(_apiAuthBucket())}`)
  );
  const uncached = rawUrls.filter((_, i) => !loadedImageUrls.has(cacheKeys[i]));
  if (!uncached.length) return;

  // Chunk into batches of 40 (CF Worker subrequest limit; keep headroom for cache ops)
  const BATCH_SIZE = 40;
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    apiCall("/api/images/prefetch", {
      method: "POST",
      json: { urls: batch, bucket: _apiAuthBucket() },
    })
      .then(r => r.json())
      .then(d => {
        if (d.fetched > 0) logMsg(`⚡ Prefetched ${d.fetched} thumbnails at edge`, "info");
      })
      .catch(() => {}); // Silent fail
  }
}

VRCW.registerModule('images', { imageCacheKey, processImageQueue, prefetchThumbnails });
renderAppVersionInfo();
