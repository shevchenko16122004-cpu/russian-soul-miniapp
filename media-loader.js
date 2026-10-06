const controllers = new WeakMap();

export function setupCatalogMedia(root) {
  controllers.get(root)?.destroy();
  const queue = [];
  let active = 0;
  let stopped = false;
  const visibleObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const item = entry.target;
        if (item.dataset.loadState === "queued") {
          const position = queue.indexOf(item);
          if (position >= 0) queue.splice(position, 1);
          item.dataset.loadState = "";
        }
        enqueue(item, true);
        visibleObserver.unobserve(item);
      }), { rootMargin: "500px 0px" })
    : null;

  function finish() {
    active = Math.max(0, active - 1);
    pump();
  }

  function start(media) {
    if (stopped || media.dataset.loadState === "loading" || media.dataset.loadState === "ready") return;
    active += 1;
    media.dataset.loadState = "loading";
    let settled = false;
    media.preload = "metadata";
    media.src = media.dataset.mediaSrc;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      media.dataset.loadState = "ready";
      finish();
    };
    const failed = () => {
      if (!media.dataset.fallbackUsed && media.dataset.fallback) {
        media.dataset.fallbackUsed = "1";
        media.src = media.dataset.fallback;
        try { media.load(); } catch {}
        if (media.dataset.playRequested === "1") media.play().catch(() => {});
        return;
      }
      done();
    };
    media.addEventListener("loadeddata", done, { once: true });
    media.addEventListener("error", failed, { once: true });
    const timer = setTimeout(done, 20000);
    try { media.load(); } catch { failed(); }
  }

  function pump() {
    while (!stopped && active < 2 && queue.length) start(queue.shift());
  }

  function enqueue(media, urgent) {
    if (!media?.dataset.mediaSrc || ["queued", "loading", "ready"].includes(media.dataset.loadState)) return;
    media.dataset.loadState = "queued";
    if (urgent) queue.unshift(media); else queue.push(media);
    pump();
  }

  const media = [...root.querySelectorAll("video[data-media-src]")];
  media.forEach((item, index) => {
    item.dataset.top = index < 4 ? "1" : "0";
    item.preload = "none";
    item.addEventListener("pointerdown", () => {
      if (item.dataset.loadState === "queued") {
        const position = queue.indexOf(item);
        if (position >= 0) queue.splice(position, 1);
        item.dataset.loadState = "";
      }
      if (!item.dataset.loadState) start(item);
    });
    item.addEventListener("media-priority", () => {
      if (item.dataset.loadState === "queued") {
        const position = queue.indexOf(item);
        if (position >= 0) queue.splice(position, 1);
        item.dataset.loadState = "";
      }
      if (!item.dataset.loadState) start(item);
    });
    item.addEventListener("canplay", () => {
      if (item.dataset.playRequested === "1" && item.paused) item.play().catch(() => {});
    });
    if (index < 2) enqueue(item, true);
    else visibleObserver?.observe(item);
  });

  const images = [...root.querySelectorAll("img[data-image-src]")];
  images.forEach((image, index) => {
    image.loading = index < 3 ? "eager" : "lazy";
    image.decoding = "async";
    image.fetchPriority = index < 3 ? "high" : "low";
    image.src = image.dataset.imageSrc;
  });

  controllers.set(root, {
    destroy() { stopped = true; visibleObserver?.disconnect(); queue.length = 0; }
  });
}
