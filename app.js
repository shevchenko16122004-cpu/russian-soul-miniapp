import { setupCatalogMedia } from "./media-loader.js?v=31";

const API_ORIGIN = location.hostname.endsWith("github.io") ? "https://russian-soul-muz-chat.onrender.com" : "";
const apiUrl = path => `${API_ORIGIN}${path}`;
const staticUrl = path => new URL(String(path).replace(/^\/+/, ""), document.baseURI).href;

const WebApp = window.WebApp;
WebApp?.ready?.();
WebApp?.expand?.();

const views = {
  main: document.querySelector("#mainView"),
  music: document.querySelector("#musicView"),
  sparks: document.querySelector("#sparksView"),
  order: document.querySelector("#orderView")
};
const backButton = document.querySelector("#backButton");
const catalog = document.querySelector("#catalog");
const toast = document.querySelector("#toast");

/*
  Картинки обложек кладите в public/assets/covers/
  Имена ниже уже прописаны. Если файла пока нет, вместо него покажется значок ноты.
*/
const tracks = {
  songs: [],
  clips: [],
  playlists: []
};
try { Object.assign(tracks, JSON.parse(localStorage.getItem("muzCatalogCacheV17") || "{}")); } catch (_) {}
let catalogLoading = false;
let catalogPromise;
const cleanTitle = title => String(title || "Без названия").replace(/\.(mp3|mp4|m4a|wav|ogg|webm|zip)$/i, "");
const cleanTrackTitle = title => cleanTitle(title).replace(/^\s*\d+\s*[._)\]-]+\s*/, "").trim() || "Без названия";
const clipPosterKey = id => `muzClipPosterV1:${id}`;
const getClipPoster = id => {
  try { return localStorage.getItem(clipPosterKey(id)) || ""; } catch (_) { return ""; }
};
const clipPosterAttribute = item => {
  const poster = item.cover || getClipPoster(item.id);
  return poster ? `poster="${poster}"` : "";
};

function saveClipPoster(video, id) {
  if (!id || !video.videoWidth || !video.videoHeight || getClipPoster(id)) return "";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = Math.max(180, Math.round(360 * video.videoHeight / video.videoWidth));
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const poster = canvas.toDataURL("image/jpeg", 0.7);
    localStorage.setItem(clipPosterKey(id), poster);
    document.querySelectorAll("video[data-poster-id]").forEach(item => {
      if (item.dataset.posterId === String(id)) { item.poster = poster; item.classList.add("frame-ready"); }
    });
    return poster;
  } catch (_) { return ""; }
}

let favorites = new Set(JSON.parse(localStorage.getItem("muzFavorites") || "[]"));
let repeatingTracks = new Set(JSON.parse(localStorage.getItem("muzRepeatingTracks") || "[]"));
const catalogSort = document.querySelector("#catalogSort");
const catalogSearch = document.querySelector("#catalogSearch");
const shuffleCatalog = document.querySelector("#shuffleCatalog");
const shuffledCatalogs = new Map();
const mediaDurations = (() => {
  try { return JSON.parse(localStorage.getItem("muzMediaDurationsV1") || "{}"); }
  catch { return {}; }
})();
let durationSaveTimer;
const formatDuration = seconds => Number.isFinite(Number(seconds)) && Number(seconds) > 0
  ? `${Math.floor(Number(seconds) / 60)}:${String(Math.floor(Number(seconds) % 60)).padStart(2, "0")}`
  : "…";
function saveDurations() {
  clearTimeout(durationSaveTimer);
  durationSaveTimer = setTimeout(() => localStorage.setItem("muzMediaDurationsV1", JSON.stringify(mediaDurations)), 300);
}
catalogSort.value = ["default", "az", "za"].includes(localStorage.getItem("muzCatalogSort")) ? localStorage.getItem("muzCatalogSort") : "default";
catalogSort.addEventListener("change", () => {
  shuffledCatalogs.delete(document.querySelector(".tab.active")?.dataset.tab || "songs");
  localStorage.setItem("muzCatalogSort", catalogSort.value);
  renderCatalog(document.querySelector(".tab.active")?.dataset.tab || "songs");
});
catalogSort.addEventListener("pointerdown", () => {
  const type = document.querySelector(".tab.active")?.dataset.tab || "songs";
  if (shuffledCatalogs.delete(type)) renderCatalog(type);
});
catalogSearch.addEventListener("input", () => renderCatalog(document.querySelector(".tab.active")?.dataset.tab || "songs"));
shuffleCatalog.addEventListener("click", () => {
  const type = document.querySelector(".tab.active")?.dataset.tab || "songs";
  const source = type === "favorites" ? Object.values(tracks).flat().filter(item => favorites.has(item.id)) : tracks[type] || [];
  const order = [...source.map(item => item.id)];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  shuffledCatalogs.set(type, order);
  renderCatalog(type);
  showToast(order.length > 1 ? "Порядок перемешан" : "Для перемешивания нужно хотя бы две записи");
});

document.querySelectorAll("[data-open]").forEach(button => button.addEventListener("click", () => openSection(button.dataset.open)));
backButton.addEventListener("click", () => openSection("main"));

function openSection(name) {
  if (name === "about") return document.querySelector("#aboutModal").classList.remove("hidden");
  Object.entries(views).forEach(([key, view]) => view.classList.toggle("active", key === name));
  backButton.classList.toggle("hidden", name === "main");
  if (name === "order") showOrderTypes();
  if (name === "sparks") loadSparkStatus();
  if (name === "music") {
    catalogLoading = true;
    document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === "songs"));
    renderCatalog("songs");
    catalogPromise ||= loadPublishedCatalog();
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

async function loadPublishedCatalog() {
  catalogLoading = true;
  try {
    const [response, durationResponse] = await Promise.all([fetch(apiUrl("/api/catalog"), { cache: "no-store" }), fetch(staticUrl("durations.json"))]);
    if (!response.ok) throw new Error("catalog unavailable");
    const remote = await response.json();
    const catalogDurations = durationResponse.ok ? await durationResponse.json() : {};
    const next = { songs: [], clips: [], playlists: [] };
    for (const item of remote.items || []) {
      const type = item.kind === "song" ? "songs" : item.kind === "video" ? "clips" : "playlists";
      let media = null;
      try { media = JSON.parse(item.media_url || "null"); } catch (_) {}
      const source = Array.isArray(media) ? media[0] : (media?.zip ? media.zip[0] : media);
      const sourceUrl = source?.url || source?.payload?.url || source?.payload?.download_url || "";
      const proxyUrl = sourceUrl && item.kind !== "playlist" ? apiUrl(`/api/media/${item.id}`) : "";
      const mediaUrl = sourceUrl;
      const fallbackUrl = proxyUrl;
      const playlistTracks = item.kind === "playlist" && media && !Array.isArray(media) ? (media.tracks || []).filter(track => !track.deleted).map(track => {
        const attachment = track.replacement?.[0] || {};
        const directUrl = attachment.url || attachment.download_url || attachment.payload?.url || attachment.payload?.download_url || "";
        return { ...track, mediaUrl: directUrl, fallbackUrl: apiUrl(`/api/playlists/${item.id}/tracks/${track.index}`) };
      }) : [];
      const duration = Number(source?.duration || media?.duration || catalogDurations[item.id] || 0);
      next[type].push({ id: `remote-${item.id}`, remoteId: item.id, kind: item.kind, title: cleanTitle(item.title), meta: item.description || "Русская душа", cover: item.cover_url || "", mediaUrl, fallbackUrl, previewUrl: proxyUrl, duration, playlistTracks });
    }
    Object.assign(tracks, next);
    localStorage.setItem("muzCatalogCacheV17", JSON.stringify(tracks));
    renderCatalog(document.querySelector(".tab.active")?.dataset.tab || "songs");
  } catch (_) {
    try { Object.assign(tracks, JSON.parse(localStorage.getItem("muzCatalogCacheV17") || "{}")); } catch (_) {}
    renderCatalog(document.querySelector(".tab.active")?.dataset.tab || "songs");
  } finally { catalogLoading = false; }
}

document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest(".modal").classList.add("hidden")));
document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === tab));
  renderCatalog(tab.dataset.tab);
}));

function renderCatalog(type) {
  let items = type === "favorites"
    ? Object.values(tracks).flat().filter(item => favorites.has(item.id))
    : tracks[type] || [];
  const query = catalogSearch.value.trim().toLocaleLowerCase("ru");
  if (query) items = items.filter(item => cleanTitle(item.title).toLocaleLowerCase("ru").includes(query));
  const sortedItems = [...items];
  if (catalogSort.value !== "default") sortedItems.sort((a, b) => cleanTitle(a.title).localeCompare(cleanTitle(b.title), "ru", { sensitivity: "base", numeric: true }) * (catalogSort.value === "za" ? -1 : 1));
  else if (shuffledCatalogs.has(type)) {
    const positions = new Map(shuffledCatalogs.get(type).map((id, index) => [id, index]));
    sortedItems.sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }

  catalog.innerHTML = sortedItems.length
    ? sortedItems.map((item, index) => `
      <article class="track ${item.kind === "video" ? "clip-track" : item.kind === "playlist" ? "playlist-track" : ""}">
        ${item.kind === "video" ? "" : `<div class="cover">${item.cover ? `<img data-image-src="${item.cover}" alt="" onerror="this.parentElement.textContent='♫';">` : "♫"}</div>`}
        <div class="track-main"><strong>${cleanTitle(item.title)}</strong><small>${item.kind === "playlist" ? `${item.playlistTracks.length} песен` : item.meta}</small>${item.mediaUrl && item.kind === "song" ? `<audio class="media-engine" preload="none" data-media-src="${item.mediaUrl}" data-fallback="${item.fallbackUrl || ""}" data-duration-key="${item.id}"></audio><div class="custom-player"><button class="audio-toggle" type="button" aria-label="Воспроизвести">▶</button><span class="audio-current">0:00</span><span class="audio-separator">/</span><span class="audio-duration">${formatDuration(item.duration || mediaDurations[item.id])}</span></div>` : item.mediaUrl && item.kind === "video" ? `<video class="compact-player ${getClipPoster(item.id) || item.cover ? "frame-ready" : ""}" playsinline preload="none" data-media-src="${item.previewUrl || item.fallbackUrl || item.mediaUrl}" data-play-src="${item.mediaUrl}" data-fallback="${item.fallbackUrl || ""}" data-poster-id="${item.id}" ${clipPosterAttribute(item)}></video><button class="open-clip" type="button">▶ Смотреть клип</button>` : item.kind === "playlist" ? `<button class="open-playlist" type="button" data-playlist="${item.remoteId}">Открыть плейлист</button><div class="playlist-songs hidden"></div>` : ""}</div>
        <div class="track-actions">
          ${item.kind === "song" ? `<button class="repeat-track ${repeatingTracks.has(item.id) ? "on" : ""}" data-repeat="${item.id}" type="button" aria-label="Повторять песню" aria-pressed="${repeatingTracks.has(item.id)}">↻</button>` : ""}
          <button class="favorite ${favorites.has(item.id) ? "on" : ""}" data-favorite="${item.id}" aria-label="В любимое">♥</button>
        </div>
      </article>`).join("")
    : `<div class="empty">${catalogLoading ? "Загружаем материалы…" : query ? "По вашему запросу ничего не найдено." : "Здесь пока пусто. Новинки появятся совсем скоро."}</div>`;

  catalog.querySelectorAll("[data-favorite]").forEach(button => button.addEventListener("click", () => toggleFavorite(button.dataset.favorite, type)));
  catalog.querySelectorAll("[data-repeat]").forEach(button => button.addEventListener("click", () => toggleRepeat(button)));
  catalog.querySelectorAll("video").forEach(media => {
    media.addEventListener("pointerdown", () => { media.dataset.userRequested = String(Date.now()); });
    media.addEventListener("play", () => {
      document.querySelectorAll("audio, video").forEach(other => { if (other !== media) { other.dispatchEvent(new Event("stop-playback")); other.pause(); } });
    });
  });
  setupAudioPlayers(catalog);
  catalog.querySelectorAll("video").forEach(media => {
    const revealFirstFrame = () => {
      media.classList.add("frame-ready");
      if (media.duration > 0.08 && media.currentTime === 0) {
        try { media.currentTime = Math.min(0.08, media.duration / 2); } catch (_) {}
      } else saveClipPoster(media, media.dataset.posterId);
    };
    media.addEventListener("loadeddata", revealFirstFrame, { once: true });
    media.addEventListener("seeked", () => { media.classList.add("frame-ready"); saveClipPoster(media, media.dataset.posterId); }, { once: true });
  });
  catalog.querySelectorAll(".open-clip").forEach(button => button.addEventListener("click", () => openClip(button.previousElementSibling, button)));
  catalog.querySelectorAll("video.compact-player").forEach(video => video.addEventListener("click", () => openClip(video, video.nextElementSibling)));
  catalog.querySelectorAll(".open-playlist").forEach(button => button.addEventListener("click", () => togglePlaylist(button, sortedItems.find(item => String(item.remoteId) === button.dataset.playlist))));
  primeVisibleMedia();
}

function primeVisibleMedia() {
  setupCatalogMedia(catalog);
}

function togglePlaylist(button, item) {
  const list = button.nextElementSibling;
  if (!list.classList.contains("hidden")) {
    list.classList.add("hidden");
    button.closest(".playlist-track")?.classList.remove("expanded");
    button.textContent = "Открыть плейлист";
    return;
  }
  list.classList.remove("hidden");
  button.closest(".playlist-track")?.classList.add("expanded");
  button.textContent = "Свернуть плейлист";
  if (list.childElementCount) return;
  list.innerHTML = item?.playlistTracks?.length ? item.playlistTracks.map((track, index) => {
    const source = track.mediaUrl || apiUrl(`/api/playlists/${item.remoteId}/tracks/${track.index ?? index}`);
    const fallback = track.fallbackUrl || apiUrl(`/api/playlists/${item.remoteId}/tracks/${track.index ?? index}`);
    const key = `playlist-${item.remoteId}-${track.index ?? index}`;
    return `<article class="playlist-song track"><div class="cover">♫</div><div class="track-main"><strong>${cleanTrackTitle(track.title || track.name)}</strong><small>Русская душа</small><audio class="media-engine" preload="none" data-media-src="${source}" data-fallback="${fallback}" data-duration-key="${key}"></audio><div class="custom-player"><button class="audio-toggle" type="button" aria-label="Воспроизвести">▶</button><span class="audio-current">0:00</span><span class="audio-separator">/</span><span class="audio-duration">${formatDuration(mediaDurations[key])}</span></div></div><div class="track-actions"><button class="repeat-track ${repeatingTracks.has(key) ? "on" : ""}" data-repeat="${key}" type="button" aria-label="Повторять песню" aria-pressed="${repeatingTracks.has(key)}">↻</button></div></article>`;
  }).join("") : '<p class="playlist-empty">В плейлисте пока нет песен.</p>';
  list.querySelectorAll("[data-repeat]").forEach(button => button.addEventListener("click", () => toggleRepeat(button)));
  setupAudioPlayers(list);
  setupCatalogMedia(list);
}

function setupAudioPlayers(scope) {
  scope.querySelectorAll("audio.media-engine").forEach(media => {
    if (media.dataset.playerReady === "1") return;
    media.dataset.playerReady = "1";
    const player = media.nextElementSibling;
    const toggle = player.querySelector(".audio-toggle");
    const current = player.querySelector(".audio-current");
    const trackKey = media.dataset.durationKey || "";
    media.loop = repeatingTracks.has(trackKey);
    media.volume = 1;
    let wantsPlayback = false;
    let fallbackUsed = false;
    let playbackTimer;
    const startPlayback = async () => {
      wantsPlayback = true;
      toggle.classList.add("loading");
      if (!media.getAttribute("src")) {
        media.src = media.dataset.mediaSrc;
        media.preload = "auto";
        media.load();
      }
      try { await media.play(); } catch (_) {}
      clearTimeout(playbackTimer);
      playbackTimer = setTimeout(() => {
        if (wantsPlayback && media.paused && !fallbackUsed) useFallback();
        else if (wantsPlayback && media.currentTime < 0.1 && !fallbackUsed) useFallback();
      }, 6500);
    };
    const useFallback = () => {
      if (fallbackUsed || !media.dataset.fallback) return false;
      fallbackUsed = true;
      const resumeAt = Number.isFinite(media.currentTime) ? media.currentTime : 0;
      media.src = media.dataset.fallback;
      media.preload = "auto";
      media.load();
      if (resumeAt > 0) media.addEventListener("loadedmetadata", () => { try { media.currentTime = resumeAt; } catch (_) {} }, { once: true });
      if (wantsPlayback) media.play().catch(() => {});
      return true;
    };
    toggle.addEventListener("click", async () => {
      if (!media.paused) { wantsPlayback = false; return media.pause(); }
      document.querySelectorAll("audio, video").forEach(other => { if (other !== media) { other.dispatchEvent(new Event("stop-playback")); other.pause(); } });
      await startPlayback();
    });
    media.addEventListener("loadedmetadata", () => {
      const seconds = media.duration;
      if (!Number.isFinite(seconds)) return;
      player.querySelector(".audio-duration")?.replaceChildren(formatDuration(seconds));
      if (media.dataset.durationKey) {
        mediaDurations[media.dataset.durationKey] = Math.round(seconds);
        saveDurations();
      }
    });
    media.addEventListener("play", () => {
      document.querySelectorAll("audio, video").forEach(other => { if (other !== media) { other.dispatchEvent(new Event("stop-playback")); other.pause(); } });
      toggle.textContent = "❚❚";
      toggle.classList.remove("loading");
      toggle.classList.add("playing");
    });
    media.addEventListener("stop-playback", () => { wantsPlayback = false; clearTimeout(playbackTimer); toggle.classList.remove("loading"); });
    media.addEventListener("error", () => {
      if (!useFallback()) {
        wantsPlayback = false;
        toggle.classList.remove("loading");
        showToast("Не удалось загрузить песню. Попробуйте ещё раз.");
      }
    });
    media.addEventListener("canplay", () => { if (wantsPlayback && media.paused) media.play().catch(() => {}); });
    media.addEventListener("pause", () => { toggle.textContent = "▶"; toggle.classList.remove("playing"); if (!wantsPlayback) toggle.classList.remove("loading"); });
    media.addEventListener("ended", () => {
      if (media.loop) return;
      wantsPlayback = false;
      toggle.textContent = "▶";
      toggle.classList.remove("playing");
      const playable = [...document.querySelectorAll("audio.media-engine")].filter(item => item.closest(".track")?.offsetParent !== null);
      const next = playable[playable.indexOf(media) + 1];
      next?.nextElementSibling?.querySelector(".audio-toggle")?.click();
    });
    media.addEventListener("timeupdate", () => {
      current.textContent = formatDuration(media.currentTime).replace("…", "0:00");
      if (media.currentTime > 0.1) clearTimeout(playbackTimer);
    });
  });
}

function toggleRepeat(button) {
  const key = button.dataset.repeat;
  if (!key) return;
  if (repeatingTracks.has(key)) repeatingTracks.delete(key);
  else repeatingTracks.add(key);
  localStorage.setItem("muzRepeatingTracks", JSON.stringify([...repeatingTracks]));
  const enabled = repeatingTracks.has(key);
  button.classList.toggle("on", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  const media = button.closest(".track")?.querySelector("audio.media-engine");
  if (media) media.loop = enabled;
  showToast(enabled ? "Повтор песни включён" : "Повтор песни выключен");
}

function openClip(inlineVideo, sourceButton) {
  const overlay = document.createElement("div");
  overlay.className = "clip-overlay";
  const close = document.createElement("button");
  close.className = "clip-close";
  close.textContent = "✕ Закрыть";
  const rotate = document.createElement("button");
  rotate.className = "clip-rotate";
  rotate.textContent = "⤢ Повернуть";
  const player = document.createElement("video");
  const primarySource = inlineVideo.dataset.mediaSrc || inlineVideo.dataset.fallback || inlineVideo.currentSrc || inlineVideo.src;
  const fallbackSource = inlineVideo.dataset.playSrc || inlineVideo.dataset.fallback;
  player.controls = true;
  player.playsInline = true;
  player.preload = "auto";
  player.poster = inlineVideo.poster || "";
  sourceButton?.classList.add("loading");
  let wantsPlayback = true;
  let playbackTimer;
  const play = () => { if (wantsPlayback && player.paused) player.play().catch(() => {}); };
  player.addEventListener("error", () => {
    if (!fallbackSource || player.dataset.fallbackUsed) {
      sourceButton?.classList.remove("loading");
      return showToast("Не удалось загрузить клип. Попробуйте ещё раз.");
    }
    player.dataset.fallbackUsed = "1";
    player.src = fallbackSource;
    player.load();
    play();
  });
  player.addEventListener("canplay", () => { sourceButton?.classList.remove("loading"); play(); });
  player.addEventListener("playing", () => { clearTimeout(playbackTimer); sourceButton?.classList.remove("loading"); });
  inlineVideo.pause();
  close.addEventListener("click", () => {
    wantsPlayback = false;
    clearTimeout(playbackTimer);
    player.pause();
    player.removeAttribute("src");
    player.load();
    const savedPoster = getClipPoster(inlineVideo.dataset.posterId);
    if (savedPoster) inlineVideo.poster = savedPoster;
    sourceButton?.classList.remove("loading");
    overlay.remove();
  });
  rotate.addEventListener("click", () => {
    overlay.classList.toggle("rotated");
    rotate.textContent = overlay.classList.contains("rotated") ? "⤡ Обычный вид" : "⤢ Повернуть";
  });
  const actions = document.createElement("div");
  actions.className = "clip-actions";
  actions.append(rotate, close);
  overlay.append(actions, player);
  document.body.append(overlay);
  player.src = primarySource;
  player.load();
  play();
  playbackTimer = setTimeout(() => {
    if (!wantsPlayback || player.dataset.fallbackUsed || !fallbackSource || player.currentTime > 0.1) return;
    player.dataset.fallbackUsed = "1";
    player.src = fallbackSource;
    player.load();
    play();
  }, 7000);
}

function toggleFavorite(id, currentType) {
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  localStorage.setItem("muzFavorites", JSON.stringify([...favorites]));
  renderCatalog(currentType);
}

const assistant = {
  layer: document.querySelector("#assistantLayer"),
  spotlight: document.querySelector("#assistantSpotlight"),
  image: document.querySelector("#assistantImage"),
  text: document.querySelector("#assistantText"),
  next: document.querySelector("#assistantNext"),
  index: 0,
  steps: [
  {
    "view": "main",
    "target": "[data-open=\"music\"]",
    "image": "1000022719.webp",
    "text": "Раздел «Музыка» открывает весь каталог: песни, клипы, плейлисты и сохранённое вами любимое."
  },
  {
    "view": "music",
    "target": "[data-tab=\"songs\"]",
    "image": "1000022715.webp",
    "text": "В «Песнях» уже собраны наши треки. Нажмите кнопку воспроизведения — при запуске другой песни предыдущая остановится.",
    "tab": "songs"
  },
  {
    "view": "music",
    "target": ".track .favorite",
    "image": "1000022714.webp",
    "text": "Нажмите сердечко рядом с песней, чтобы сохранить её в любимое.",
    "tab": "songs"
  },
  {
    "view": "music",
    "target": "[data-tab=\"clips\"]",
    "image": "1000022719.webp",
    "text": "В «Клипах» находятся музыкальные видео. Нажмите на обложку или кнопку просмотра, чтобы запустить клип. Для горизонтального видео используйте кнопку поворота — так его удобнее смотреть на весь экран.",
    "tab": "clips"
  },
  {
    "view": "music",
    "target": "[data-tab=\"playlists\"]",
    "image": "1000022720.webp",
    "text": "В «Плейлистах» песни объединены в подборки. Раскройте нужный плейлист и слушайте композиции по отдельности.",
    "tab": "playlists"
  },
  {
    "view": "music",
    "target": "[data-tab=\"favorites\"]",
    "image": "1000022712.webp",
    "text": "В «Любимом» находятся треки, которые вы сохранили сердечком.",
    "tab": "favorites"
  },
  {
    "view": "main",
    "target": "[data-open=\"order\"]",
    "image": "1000022719.webp",
    "text": "Ячейка «Заказать» позволяет выбрать песню, клип или комплекс «песня + клип»."
  },
  {
    "view": "order",
    "target": "#orderTypes",
    "image": "1000022720.webp",
    "text": "Сначала выберите, что хотите заказать. Анкеты заполняются сверху вниз; обязательные поля нельзя пропускать.",
    "orderChooser": true
  },
  {
    "view": "order", "target": "[data-order-type=\"song\"]", "image": "1000022715.webp",
    "text": "«Песня» — заявка на создание песни. Нажмите эту карточку, чтобы открыть её анкету.", "orderChooser": true
  },
  {
    "view": "order", "target": "[data-order-form=\"song\"] .order-form-title", "image": "1000022715.webp",
    "text": "В анкете на песню укажите согласие, ФИО и наличие готового текста. Затем выберите исполнителя, стиль, настроение и возможность публикации.", "orderForm": "song"
  },
  {
    "view": "order", "target": "[data-order-form=\"song\"] .lyrics-choice", "image": "1000022714.webp",
    "text": "Если текста ещё нет, выберите «Нет»: появятся вопросы о посвящении, поводе и важных моментах вашей истории. После заполнения нажмите «Отправить заявку».", "orderForm": "song"
  },
  {
    "view": "order", "target": "[data-order-type=\"clip\"]", "image": "1000022719.webp",
    "text": "«Клип» — отдельная заявка на музыкальное видео. Откроем её следующей.", "orderChooser": true
  },
  {
    "view": "order", "target": "[data-order-form=\"clip\"] .order-form-title", "image": "1000022719.webp",
    "text": "В анкете на клип последовательно выберите формат и длительность видео, его цель, водяной знак, наличие ваших материалов, текст и спецэффекты.", "orderForm": "clip"
  },
  {
    "view": "order", "target": "[data-order-form=\"clip\"] .order-checks", "image": "1000022714.webp",
    "text": "В блоках с квадратными флажками отметьте хотя бы один подходящий вариант. В остальных полях выберите один ответ, затем отправьте заявку.", "orderForm": "clip"
  },
  {
    "view": "order", "target": "[data-order-type=\"complex\"]", "image": "1000022720.webp",
    "text": "«Комплекс» объединяет создание песни и клипа в одном заказе.", "orderChooser": true
  },
  {
    "view": "order", "target": "[data-order-form=\"complex\"] .order-form-title", "image": "1000022720.webp",
    "text": "Анкета комплекса заполняется по порядку: сначала всё о песне, затем параметры клипа. Данные отправятся одной общей заявкой.", "orderForm": "complex"
  },
  {
    "view": "order", "target": "[data-order-form=\"complex\"] .order-subheading", "image": "1000022714.webp",
    "text": "После вопросов о песне начинается блок клипа. Заполните его до конца и нажмите «Отправить заявку». Номер заказа появится сразу после отправки.", "orderForm": "complex"
  },
  {
    "view": "main",
    "target": "#sparksButton",
    "image": "1000022719.webp",
    "text": "Отдельная механика приложения — «Искорки». Кнопка с искоркой в верхней панели открывает ежедневную награду и накопление на творческие призы."
  },
  {
    "view": "sparks",
    "target": ".spark-balance-card",
    "image": "1000022720.webp",
    "text": "Нажмите «Получить 25 Искорок» один раз в день. Когда накопится нужная сумма, возле песни, клипа или комплекса станет доступна кнопка «Получить приз»."
  },
  {
    "view": "main",
    "target": ".fresh-strip",
    "image": "1000022719.webp",
    "text": "Здесь будут появляться свежие релизы и истории исполнителей."
  },
  {
    "view": "main",
    "target": "[data-open=\"about\"]",
    "image": "1000022720.webp",
    "text": "В «О нас» можно узнать о проекте и его идее.",
    "placement": "top"
  },
  {
    "view": "main",
    "target": "#helpButton",
    "image": "1000022718.webp",
    "text": "Знак вопроса в верхней части экрана запускает это обучение заново."
  },
  {
    "view": "main",
    "target": "#chibiHelp",
    "image": "1000022718.webp",
    "text": "Круглая кнопка с Помощницей внизу открывает чат: там можно обратиться в поддержку или поговорить с Помощницей.",
    "placement": "top",
    "showChibi": true
  }
]
};

function positionSpotlight(selector) {
  const target = selector ? document.querySelector(selector) : null;
  if (!target) {
    assistant.spotlight.classList.add("full-dim");
    assistant.spotlight.removeAttribute("style");
    return;
  }

  assistant.spotlight.classList.remove("full-dim");
  const rect = target.getBoundingClientRect();
  const pad = selector === "#chibiHelp" ? 7 : 8;
  assistant.spotlight.style.left = `${Math.max(8, rect.left - pad)}px`;
  assistant.spotlight.style.top = `${Math.max(8, rect.top - pad)}px`;
  assistant.spotlight.style.width = `${Math.min(window.innerWidth - 16, rect.width + pad * 2)}px`;
  assistant.spotlight.style.height = `${Math.min(window.innerHeight - 16, rect.height + pad * 2)}px`;
  assistant.spotlight.style.borderRadius = selector === "#chibiHelp" ? "50%" : "28px";
}

let activeStep = null;
let onboardingStarted = false;
// Trim transparent margins in layout only; source artwork is unchanged.
const portraitBounds = new Map();
function sizePortrait(img = assistant.image) {
  if (!img.complete || !img.naturalWidth) return;
  let bounds = portraitBounds.get(img.src);
  if (!bounds) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left=canvas.width, top=canvas.height, right=0, bottom=0;
    for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
      if(pixels[(y*canvas.width+x)*4+3]>0) {
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      }
    }
    bounds={left,top,width:right-left+1,height:bottom-top+1};
    portraitBounds.set(img.src,bounds);
  }
  const frame = img.parentElement;
  const scale = frame.clientHeight/bounds.height;
  img.style.width = img.naturalWidth*scale+'px';
  img.style.height = img.naturalHeight*scale+'px';
  img.style.left = ((frame.clientWidth-bounds.width*scale)/2-bounds.left*scale)+'px';
  img.style.top = (frame.clientHeight-bounds.height*scale-bounds.top*scale)+'px';
}
const portraitAssets = new Map();
let portraitRevision = 0;
function preparePortrait(filename) {
  if (!portraitAssets.has(filename)) {
    const img = new Image();
    img.src = staticUrl('assets/mascot/' + filename);
    portraitAssets.set(filename, img.decode().then(() => img).catch(() => null));
  }
  return portraitAssets.get(filename);
}
new ResizeObserver(() => {
  document.querySelectorAll('.assistant-portrait img').forEach(img => sizePortrait(img));
}).observe(document.querySelector('.assistant-portrait'));
assistant.steps.forEach(step => preparePortrait(step.image));
preparePortrait('1000022714.webp');

function swapPortrait(img) {
  const frame = document.querySelector('.assistant-portrait');
  const previous = assistant.image;
  img.className = 'assistant-image';
  img.alt = 'Помощница';
  img.id = 'assistantImage';
  frame.replaceChild(img, previous);
  assistant.image = img;
  sizePortrait(img);
}

function layoutAssistant() {
  if (assistant.layer.classList.contains('hidden')) return;
  const target = activeStep?.target ? document.querySelector(activeStep.target) : null;
  let targetRect = target?.getBoundingClientRect();
  // Put the guide on the opposite side of the screen from the highlighted
  // control. Form fields often move as their form opens, so this is derived
  // from the live rectangle rather than maintained step by step.
  const placeAtTop = activeStep?.placement === 'top' || Boolean(targetRect && targetRect.top + targetRect.height / 2 > window.innerHeight * .62);
  assistant.layer.classList.toggle('stage-top', placeAtTop);
  // Keep the guide portrait anchored in one place between tour steps.
  assistant.layer.classList.remove('portrait-right');
  targetRect = target?.getBoundingClientRect();
  const portrait = document.querySelector('.assistant-portrait').getBoundingClientRect();
  if (target) {
    const rect = targetRect;
    const stage = document.querySelector('.assistant-stage').getBoundingClientRect();
    const freeStart = placeAtTop ? Math.max(stage.bottom, portrait.bottom) + 18 : 16;
    const freeEnd = placeAtTop ? window.innerHeight - 16 : Math.min(stage.top, portrait.top) - 18;
    const desiredTop = Math.max(freeStart, Math.min(freeEnd - rect.height, freeStart + (freeEnd - freeStart - rect.height) / 2));
    window.scrollBy({top: rect.top - desiredTop, behavior: 'instant'});
  }
  positionSpotlight(activeStep?.target);
}

async function showAssistant(index = 0, message = null) {
  onboardingStarted = true;
  assistant.next.disabled = true;
  clearTimeout(assistant.unlockTimer);
  const revision = ++portraitRevision;
  const step = message || assistant.steps[index];
  assistant.index = index;
  activeStep = step;
  document.querySelector('#chibiHelp').classList.toggle('hidden', !step.showChibi);
  assistant.layer.classList.toggle('tour-circle-step', step.target === '#chibiHelp');
  if (step.view) openSection(step.view);
  if (step.orderChooser) showOrderTypes();
  if (step.orderForm) {
    orderTypes.classList.add('hidden');
    orderForms.forEach(form => form.classList.toggle('hidden', form.dataset.orderForm !== step.orderForm));
  }
  if (step.tab) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === step.tab));
    renderCatalog(step.tab);
    document.querySelector('[data-tab="' + step.tab + '"]').scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'});
  }
  const target = step.target ? document.querySelector(step.target) : null;
  const targetRect = target?.getBoundingClientRect();
  const guideAtTop = step.placement === 'top' || Boolean(targetRect && targetRect.top + targetRect.height / 2 > window.innerHeight * .62);
  // These two portraits have clear pointing gestures. Select the direction
  // from the live target position so the gesture always leads to the control.
  const portraitFile = message ? step.image : (guideAtTop ? '1000022722.webp' : '1000022719.webp');
  const prepared = await preparePortrait(portraitFile);
  if (revision !== portraitRevision) return;
  const nextImage = prepared ? prepared.cloneNode() : null;
  if (nextImage) await nextImage.decode();
  if (revision !== portraitRevision) return;
  assistant.unlockTimer = setTimeout(() => { assistant.next.disabled = false; }, 350);
  assistant.text.textContent = step.text;

  assistant.next.textContent = message || index === assistant.steps.length - 1 ? 'Понятно' : 'Далее';
  assistant.layer.classList.remove('hidden');
  document.body.classList.add('onboarding-active');
  if (nextImage) swapPortrait(nextImage);
  requestAnimationFrame(layoutAssistant);
}

assistant.next.addEventListener("click", () => {
  if (activeStep === assistant.steps[assistant.index] && assistant.index < assistant.steps.length - 1) showAssistant(assistant.index + 1);
  else closeAssistant(true);
});
document.querySelector("#assistantClose").addEventListener("click", () => closeAssistant(true));

function closeAssistant(remember) {
  ++portraitRevision;
  assistant.layer.classList.add("hidden");
  document.body.classList.remove("onboarding-active");
  if (remember) localStorage.setItem("muzOnboardingSeen", "1");
  document.querySelector("#chibiHelp").classList.toggle("hidden", !localStorage.getItem("muzOnboardingSeen"));
}

function restartOnboarding() {
  localStorage.removeItem("muzOnboardingSeen");
  closeChat();
  document.querySelector("#aboutModal").classList.add("hidden");
  openSection("main");
  window.scrollTo({ top: 0, behavior: "auto" });
  showAssistant(0);
}

window.addEventListener("resize", () => {
  if (!assistant.layer.classList.contains("hidden")) {
    layoutAssistant();
  }
});

const chatPanel = document.querySelector("#chatPanel");
const chatBody = document.querySelector("#chatBody");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatRoute = document.querySelector('#chatRoute');
let chatMode = 'support';
let talkHistory = [];
const maxProfile = WebApp?.initDataUnsafe?.user || {};
const maxDisplayName = maxProfile.username || maxProfile.first_name || '';

const sparkBalance = document.querySelector('#sparkBalance');
const claimSparks = document.querySelector('#claimSparks');
const sparkClaimHint = document.querySelector('#sparkClaimHint');
const sparkOrderNotice = document.querySelector('#sparkOrderNotice');
let currentSparkBalance = 0;
let selectedSparkPrize = null;
let sparkStatusLoading = null;
const sparkBalanceCacheKey = 'muzSparkBalanceV1';

function currentMaxWebApp() {
  return window.WebApp || WebApp;
}

async function maxInitData() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = currentMaxWebApp()?.initData;
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return '';
}

function renderSparks(data = {}) {
  currentSparkBalance = Number(data.balance || 0);
  localStorage.setItem(sparkBalanceCacheKey, String(currentSparkBalance));
  sparkBalance.textContent = String(currentSparkBalance);
  claimSparks.disabled = Boolean(data.claimedToday);
  claimSparks.textContent = data.claimedToday ? 'Награда получена' : 'Получить 25 Искорок';
  sparkClaimHint.textContent = data.claimedToday ? 'Следующие 25 Искорок можно получить завтра.' : 'Ежедневная награда доступна один раз в сутки.';
  document.querySelectorAll('[data-spark-prize]').forEach(card => {
    const cost = Number(card.dataset.cost);
    const ready = currentSparkBalance >= cost;
    card.querySelector('progress').value = Math.min(currentSparkBalance, cost);
    card.querySelector('.spark-progress-text').textContent = ready ? 'Приз доступен!' : `Осталось ${cost - currentSparkBalance}`;
    card.querySelector('button').disabled = !ready;
  });
}

async function loadSparkStatus(force = false) {
  if (sparkStatusLoading && !force) return sparkStatusLoading;
  sparkStatusLoading = (async () => {
    try {
      const cachedBalance = Number(localStorage.getItem(sparkBalanceCacheKey));
      if (Number.isFinite(cachedBalance) && cachedBalance > 0) sparkBalance.textContent = String(cachedBalance);
      sparkClaimHint.textContent = 'Проверяем баланс…';
      claimSparks.disabled = true;
      const initData = await maxInitData();
      if (!initData) throw new Error('Не удалось получить данные MAX. Закройте и снова откройте мини-приложение.');
      const response = await fetch(apiUrl('/api/sparks/status'), { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить Искорки.');
      renderSparks(result);
    } catch (error) {
      sparkClaimHint.textContent = error.message || 'Искорки пока недоступны.';
      claimSparks.disabled = true;
    } finally { sparkStatusLoading = null; }
  })();
  return sparkStatusLoading;
}

claimSparks.addEventListener('click', async () => {
  claimSparks.disabled = true;
  try {
    const initData = await maxInitData();
    if (!initData) throw new Error('Не удалось получить данные MAX. Закройте и снова откройте мини-приложение.');
    const response = await fetch(apiUrl('/api/sparks/claim'), { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось получить Искорки.');
    renderSparks(result);
    showAssistantMessage('1000022714.webp', result.awarded ? `Вам начислено ${result.awarded} Искорок! Текущий баланс: ${result.balance}.` : 'Сегодняшние Искорки уже получены. Возвращайтесь завтра!');
  } catch (error) {
    showToast(error.message || 'Не удалось получить Искорки.');
    claimSparks.disabled = false;
  }
});

document.querySelectorAll('[data-spark-prize] button').forEach(button => button.addEventListener('click', () => {
  const card = button.closest('[data-spark-prize]');
  selectedSparkPrize = { type: card.dataset.sparkPrize, cost: Number(card.dataset.cost) };
  openSection('order');
  orderTypes.classList.add('hidden');
  orderForms.forEach(form => form.classList.toggle('hidden', form.dataset.orderForm !== selectedSparkPrize.type));
  sparkOrderNotice.textContent = `Приз выбран: ${selectedSparkPrize.cost} Искорок. После отправки анкеты денежная оплата не потребуется.`;
  sparkOrderNotice.classList.remove('hidden');
  document.querySelector(`[data-order-form="${selectedSparkPrize.type}"]`)?.scrollIntoView({ block: 'start' });
}));
document.querySelector('#chatGreeting').textContent = maxDisplayName ? `${maxDisplayName}, вас приветствует Помощница` : 'Вас приветствует Помощница';
document.querySelector('#supportRoute').addEventListener('click', () => { chatMode = 'support'; chatRoute.classList.add('hidden'); chatInput.placeholder = 'Напишите вопрос или сообщение...'; chatInput.focus(); });
document.querySelector('#talkRoute').addEventListener('click', () => {
  chatMode = 'talk';
  chatRoute.classList.add('hidden');
  chatInput.placeholder = 'Напишите Помощнице...';
  addBubble('Я рядом. О чём хотите поговорить?', 'auto');
  chatInput.focus();
});
const supportStorageKey = 'rd-support-chat-v1';
let supportState;
try { supportState = JSON.parse(localStorage.getItem(supportStorageKey) || '{}'); } catch { supportState = {}; }
supportState = { tickets: Array.isArray(supportState.tickets) ? supportState.tickets : [], messages: Array.isArray(supportState.messages) ? supportState.messages : [], seen: Array.isArray(supportState.seen) ? supportState.seen : [], unread: Number(supportState.unread) || 0 };
const supportHelpButton = document.querySelector('#chibiHelp');
const supportBadge = document.createElement('span');
supportBadge.className = 'support-unread hidden';
supportBadge.setAttribute('aria-label', 'Новые ответы поддержки');
supportHelpButton.append(supportBadge);
const supportNotice = document.createElement('button');
supportNotice.type = 'button';
supportNotice.className = 'support-notice hidden';
supportNotice.textContent = 'Пришёл ответ поддержки. Открыть чат';
supportNotice.addEventListener('click', openChat);
document.body.append(supportNotice);
function showSupportNotification() {
  supportBadge.textContent = String(supportState.unread);
  supportBadge.classList.toggle('hidden', supportState.unread === 0);
  supportNotice.classList.toggle('hidden', supportState.unread === 0 || !chatPanel.classList.contains('hidden'));
}
function saveSupportState() {
  supportState.tickets = supportState.tickets.slice(-30);
  supportState.messages = supportState.messages.slice(-100);
  supportState.seen = supportState.seen.slice(-1000);
  try { localStorage.setItem(supportStorageKey, JSON.stringify(supportState)); } catch {}
}
function resetChat() {
  const unreadMessages = supportState.messages.filter(item => item.unread);
  chatBody.replaceChildren();
  talkHistory = [];
  supportState.messages = [];
  unreadMessages.forEach(item => addBubble(item.text, 'support'));
  supportState.unread = 0;
  saveSupportState();
  chatMode = 'support';
  chatRoute.classList.remove('hidden');
  chatInput.placeholder = 'Сначала выберите, что хотите сделать';
}
document.querySelector('#chatReset').addEventListener('click', resetChat);
showSupportNotification();
let supportPolling = false;
async function loadSupportReplies() {
  if (supportPolling || !supportState.tickets.length) return;
  supportPolling = true;
  try {
    for (const ticket of supportState.tickets) {
      const response = await fetch(apiUrl(`/api/support/replies?ticket=${encodeURIComponent(ticket)}`), { cache: 'no-store' });
      if (!response.ok) continue;
      const data = await response.json();
      for (const reply of data.replies || []) {
        const key = `${ticket}:${reply.id}`;
        if (supportState.seen.includes(key)) continue;
        supportState.seen.push(key);
        const text = `Ответ поддержки: ${reply.message}`;
        const pendingBubble = [...chatBody.querySelectorAll('.bubble.pending')].find(item => item.dataset.ticket === ticket);
        if (pendingBubble) {
          pendingBubble.textContent = text;
          pendingBubble.className = 'bubble support';
        } else addBubble(text, 'support');
        const wasHidden = chatPanel.classList.contains('hidden');
        supportState.messages.push({ text, role: 'support', unread: wasHidden });
        if (wasHidden) {
          supportState.unread++;
          WebApp?.HapticFeedback?.notificationOccurred?.('success');
        }
        saveSupportState();
        showSupportNotification();
      }
    }
  } catch (error) { console.error('Support replies:', error); }
  finally { supportPolling = false; }
}
setInterval(loadSupportReplies, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadSupportReplies(); });
document.querySelector("#chibiHelp").addEventListener("click", openChat);
document.querySelector("#helpButton").addEventListener("click", restartOnboarding);
document.querySelector('#chatClose').addEventListener('click', closeChat);
function closeChat() {
  chatPanel.classList.add('hidden');
  document.querySelector('#chibiHelp').focus({preventScroll: true});
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!chatPanel.classList.contains('hidden')) closeChat();
    else if (!assistant.layer.classList.contains('hidden')) closeAssistant(true);
  }
});

function openChat() {
  chatPanel.classList.remove("hidden");
  resetChat();
  supportState.unread = 0;
  saveSupportState();
  showSupportNotification();
  document.querySelector("#chatClose").focus();
  loadSupportReplies();
}
loadSupportReplies();

chatForm.addEventListener("submit", async event => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  const button = chatForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    if (chatMode === 'talk') {
      addBubble(message, 'user');
      chatInput.value = '';
      const waiting = addBubble('Помощница печатает…', 'auto');
      const response = await fetch(apiUrl('/api/asya'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history: talkHistory }) });
      const data = await response.json();
      if (!response.ok) { waiting.remove(); throw new Error(data.error || 'Помощница сейчас не может ответить.'); }
      waiting.textContent = data.reply;
      talkHistory.push({ role: 'user', text: message }, { role: 'model', text: data.reply });
      return;
    }
    const response = await fetch(apiUrl("/api/support"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, initData: WebApp?.initData || "" }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось отправить обращение.');
    addBubble(message, "user");
    supportState.messages.push({ text: message, role: 'user' });
    if (data.ticket) supportState.tickets.push(data.ticket);
    saveSupportState();
    chatInput.value = "";
    if (data.automatic) addBubble(data.reply, 'support');
    else {
      const pendingBubble = addBubble(data.reply || 'Сообщение передано сотруднику поддержки.', 'bot');
      pendingBubble.classList.add('pending');
      pendingBubble.dataset.ticket = data.ticket || '';
    }
    loadSupportReplies();
  } catch (error) { addBubble(error.message || "Не удалось отправить сообщение. Попробуйте ещё раз.", "bot"); }
  finally { button.disabled = false; }
});

function addBubble(text, role) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  if (role === 'user') bubble.dataset.sender = maxDisplayName || 'Вы';
  chatBody.append(bubble);
  chatBody.scrollTop = chatBody.scrollHeight;
  return bubble;
}

const orderTypes = document.querySelector('#orderTypes');
const orderForms = [...document.querySelectorAll('[data-order-form]')];
function showOrderTypes() {
  selectedSparkPrize = null;
  sparkOrderNotice.classList.add('hidden');
  orderTypes.classList.remove('hidden');
  orderForms.forEach(form => form.classList.add('hidden'));
}
document.querySelectorAll('[data-order-type]').forEach(button => button.addEventListener('click', () => {
  orderTypes.classList.add('hidden');
  orderForms.forEach(form => form.classList.toggle('hidden', form.dataset.orderForm !== button.dataset.orderType));
  document.querySelector(`[data-order-form="${button.dataset.orderType}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
document.querySelectorAll('.order-type-back').forEach(button => button.addEventListener('click', showOrderTypes));
function updateLyricsFields(form) {
  const choice = form.querySelector('.lyrics-choice')?.value || '';
  const newSong = form.querySelector('.lyrics-new');
  const options = form.querySelector('.song-options');
  newSong?.classList.toggle('hidden', choice !== 'no');
  options?.classList.toggle('hidden', !choice);
  newSong?.querySelectorAll('input, textarea, select').forEach(field => { field.required = choice === 'no'; });
  options?.querySelectorAll('input, textarea, select').forEach(field => { field.required = Boolean(choice); });
}
orderForms.forEach(form => {
  form.querySelector('.lyrics-choice')?.addEventListener('change', () => updateLyricsFields(form));
  updateLyricsFields(form);
});
function orderPayload(form) {
  const data = Object.fromEntries(new FormData(form));
  for (const name of ['clipPurpose', 'textElements']) {
    const values = new FormData(form).getAll(name).map(String);
    if (values.length) data[name] = values;
  }
  return {
    ...data,
    orderType: form.dataset.orderForm,
    paymentMethod: selectedSparkPrize?.type === form.dataset.orderForm ? 'sparks' : 'standard',
    initData: WebApp?.initData || ''
  };
}
function validateOrderChecks(form) {
  for (const group of form.querySelectorAll('[data-required-checks]')) {
    if (!group.querySelector('input:checked')) {
      showToast(`Выберите хотя бы один вариант: ${group.querySelector('legend')?.textContent || ''}`);
      group.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
  }
  return true;
}
orderForms.forEach(form => form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!validateOrderChecks(form)) return;
  const button = form.querySelector('button[type="submit"]');
  const data = orderPayload(form);
  button.disabled = true;
  try {
    const response = await fetch(apiUrl('/api/order'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось отправить анкету.');
    const usedSparks = Boolean(result.paidWithSparks);
    form.reset();
    showOrderTypes();
    if (usedSparks) loadSparkStatus(true);
    showAssistantMessage("1000022714.webp", result.notified
      ? (usedSparks ? `Приз оформлен! Заказ №${result.orderNumber} оплачен Искорками. Мы свяжемся с вами по указанному контакту.` : `Заказ №${result.orderNumber} принят. Мы свяжемся с вами по указанному контакту.`)
      : `Заказ №${result.orderNumber} сохранён. Мы увидим его в разделе «Анкеты».`);
  } catch (error) {
    showToast(error.message || 'Не удалось отправить анкету. Попробуйте ещё раз.');
  } finally { button.disabled = false; }
}));

function showAssistantMessage(image, text) {
  showAssistant(0, { image, text });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2400);
}

catalogPromise = loadPublishedCatalog();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(staticUrl("sw.js"));
      registration.update();
    } catch (_) {}
  });
}
const firstLaunchKey = "muzFirstLaunchCompletedV1";
let firstLaunchThisSession = false;
if (localStorage.getItem(firstLaunchKey) || localStorage.getItem('muzOnboardingSeen')) {
  localStorage.setItem(firstLaunchKey, "1");
  showWelcome(true);
} else {
  firstLaunchThisSession = true;
  document.querySelector('#chibiHelp').classList.add('hidden');
  if (!onboardingStarted) showWelcome();
}

function showWelcome(returning = false) {
  document.querySelector('#chibiHelp').classList.add('hidden');
  onboardingStarted = true;
  document.querySelector('#welcomeTitle').textContent = returning ? 'С возвращением!' : 'Давайте знакомиться!';
  document.querySelector('#welcomeText').textContent = returning
    ? 'Рады снова видеть вас в «Русской душе». Выбирайте музыку, смотрите клипы или продолжайте общение с Помощницей.'
    : 'Я виртуальная помощница «Русской души». Помогу найти музыку, рассказать вашу историю и освоиться в приложении.';
  document.querySelector('#welcomeNext').textContent = returning ? 'Продолжить' : 'Познакомиться с приложением';
  document.querySelector('#welcomeScene').classList.remove('hidden');
  document.querySelector('#welcomeNext').focus();
}
document.querySelector('#welcomeNext').addEventListener('click', () => {
  localStorage.setItem(firstLaunchKey, "1");
  document.querySelector('#welcomeScene').classList.add('hidden');
  openSection('main');
  if (firstLaunchThisSession) {
    firstLaunchThisSession = false;
    showAssistant(0);
  }
  else document.querySelector('#chibiHelp').classList.remove('hidden');
});


