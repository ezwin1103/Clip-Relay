const platforms = [
  {
    id: "youtube",
    name: "YouTube Shorts",
    logo: "YT",
    hint: "Short title plus a strong hook",
    limit: 100,
    channels: ["Jayden Studio", "Brand Shorts", "Creator Lab"],
    color: "#d64545",
    suffix: "#Shorts #YouTubeShorts",
  },
  {
    id: "instagram",
    name: "Instagram Reels",
    logo: "IG",
    hint: "Lifestyle tone plus light hashtag use",
    limit: 2200,
    channels: ["Official IG", "Founder Daily", "Product Reels"],
    color: "#b6509e",
    suffix: "#reels #creator #behindthescenes",
  },
  {
    id: "tiktok",
    name: "TikTok",
    logo: "TT",
    hint: "More conversational and direct",
    limit: 2200,
    channels: ["TikTok Main", "Growth Clips", "CN Overseas"],
    color: "#111111",
    suffix: "#fyp #tiktok #learnontiktok",
  },
  {
    id: "twitter",
    name: "X / Twitter",
    logo: "X",
    hint: "Short copy with a clear point of view",
    limit: 280,
    channels: ["Personal X", "Company X", "Launch Updates"],
    color: "#356eb7",
    suffix: "#buildinpublic",
  },
];

const state = {
  mode: "now",
  hasVideo: false,
  queueTimer: null,
  selectedAssets: new Set(),
  uploadedAsset: null,
  activeDraftId: null,
  draftDirty: false,
  db: { drafts: [], tasks: [], assets: [] },
};

let assets = [];
let scheduleItems = [];

const platformList = document.querySelector("#platformList");
const queueList = document.querySelector("#queueList");
const template = document.querySelector("#platformTemplate");
const videoInput = document.querySelector("#videoInput");
const dropzone = document.querySelector("#dropzone");
const previewWrap = document.querySelector("#previewWrap");
const videoPreview = document.querySelector("#videoPreview");
const emptyPreview = document.querySelector("#emptyPreview");
const masterCaption = document.querySelector("#masterCaption");
const scheduleRow = document.querySelector("#scheduleRow");
const assetGrid = document.querySelector("#assetGrid");
const calendarGrid = document.querySelector("#calendarGrid");
const reminderList = document.querySelector("#reminderList");
const channelGrid = document.querySelector("#channelGrid");
const draftList = document.querySelector("#draftList");
const taskList = document.querySelector("#taskList");
const toastStack = document.querySelector("#toastStack");

function formatBytes(bytes) {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? undefined : { "content-type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function normalizeServerAsset(asset) {
  const readableSize = asset.size ? formatBytes(asset.size) : "Unknown size";
  return {
    id: asset.id,
    title: asset.title || asset.originalName || "Uploaded local video",
    desc: `${asset.ratio || "Pending scan"} · ${asset.duration || "Pending scan"} · ${readableSize}`,
    duration: asset.duration || "Pending scan",
    status: asset.status || "ready",
    statusText: asset.statusText || "Ready to publish",
    ratio: asset.ratio || "Pending scan",
    tags: asset.tags || ["Local upload"],
    color: "#1f7a5c",
    url: asset.url,
    serverAsset: asset,
  };
}

async function loadServerState() {
  try {
    const db = await apiRequest("/api/state");
    state.db = db;
    assets = (db.assets || []).map(normalizeServerAsset);
    scheduleItems = (db.tasks || []).map(taskToScheduleItem);
    renderPlatforms();
    renderAssets();
    renderSchedule();
    renderHistoryLists();
    renderChannels();
  } catch (error) {
    console.warn("Could not load the local backend state. Falling back to prototype data.", error);
  }
}

function taskToScheduleItem(task) {
  const scheduleDate = task.scheduleAt ? new Date(task.scheduleAt) : null;
  return {
    source: "server",
    id: task.id,
    day: scheduleDate && !Number.isNaN(scheduleDate.getTime()) ? weekdayName(scheduleDate) : "Unscheduled",
    time: scheduleDate && !Number.isNaN(scheduleDate.getTime()) ? timeName(scheduleDate) : task.mode === "scheduled" ? "TBD" : "Now",
    title: task.title || task.asset?.title || "Local publish task",
    platforms: (task.platforms || []).map((item) => item.logo || item.name || item.id),
    status: statusLabel(task.status),
  };
}

function weekdayName(date) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
}

function timeName(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function statusLabel(status) {
  if (status === "published") return "Published";
  if (status === "scheduled") return "Scheduled";
  if (status === "publishing") return "Publishing";
  if (status === "failed") return "Failed";
  return "Queued";
}

function platformText(base, platform) {
  const clean = base.trim();
  if (!clean) return "";
  return aiRewrite(clean, platform).caption;
}

function compactText(text, maxLength) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}…`;
}

function stripHashtags(text) {
  return text.replace(/#[\p{L}\p{N}_-]+/gu, "").replace(/\s+/g, " ").trim();
}

function aiRewrite(base, platform) {
  const clean = stripHashtags(base);
  const idea = /[\u4e00-\u9fff]/.test(clean)
    ? "a tool that helps creators upload once, adapt the copy for each platform, and publish faster"
    : clean;
  const shortIdea = compactText(idea, 92);

  if (platform.id === "youtube") {
    return {
      title: "Upload once. Tailor every post.",
      caption: `This is the faster way to turn one video into platform-ready posts.\n\n${shortIdea}\n\nBuilt for creators who would rather spend time making the next clip than rewriting the same caption four times.\n\n${platform.suffix}`,
    };
  }

  if (platform.id === "instagram") {
    return {
      title: "One video, four platform-ready captions",
      caption: `If you post the same video everywhere, the caption should not be copy-paste.\n\n${shortIdea}\n\nSmall workflow upgrade, big time saver.\n\n${platform.suffix}`,
    };
  }

  if (platform.id === "tiktok") {
    return {
      title: "Stop rewriting the same caption",
      caption: `Posting should not mean rewriting the same idea four different ways by hand.\n\n${shortIdea}\n\nUpload once, tweak for each platform, move on to the next video.\n\n${platform.suffix}`,
    };
  }

  return {
    title: "A faster way to repurpose short-form video",
    caption: `One video should not create four separate posting chores.\n\n${shortIdea}\n\nUpload once, adapt the copy for each platform, and keep the workflow moving.\n\n${platform.suffix}`,
  };
}

function setAiHelper(text, isWorking = false) {
  const helper = document.querySelector("#aiHelper");
  helper.textContent = text;
  helper.classList.toggle("working", isWorking);
}

function optimizeCard(card, sourceText) {
  const platform = platforms.find((item) => item.id === card.dataset.platform);
  const title = card.querySelector('input[type="text"]');
  const caption = card.querySelector("textarea");
  const button = card.querySelector(".ai-button");
  const overLimit = platformNeedsTitle(platform.id) ? title.value.length > platform.limit : caption.value.length > platform.limit;
  const base = (sourceText || (overLimit && platformNeedsTitle(platform.id) ? title.value : "") || caption.value || masterCaption.value).trim();

  if (!base) {
    setAiHelper("Write a master caption first, or add a bit of copy inside the current platform card.");
    return;
  }

  button.disabled = true;
  button.textContent = "Working...";
  setAiHelper(`AI is localizing this for ${platform.name} in a US/EU English style...`, true);

  window.setTimeout(async () => {
    let rewritten;
    let provider = "local";
    try {
      const data = await apiRequest("/api/ai/optimize", {
        method: "POST",
        body: JSON.stringify({ base, platform }),
      });
      rewritten = data.result;
      provider = data.provider;
      if (data.needsApiKey) {
        setAiHelper("Using local fallback copy. DeepSeek will provide stronger US/EU localized copy when available.");
      }
    } catch (error) {
      rewritten = aiRewrite(base, platform);
      setAiHelper(`DeepSeek failed, so local US/EU fallback copy was used: ${error.message}`);
    }
    title.value = rewritten.title;
    caption.value = rewritten.caption;
    caption.dispatchEvent(new Event("input"));
    button.disabled = false;
    button.textContent = "AI optimize";
    if (provider === "deepseek") setAiHelper(`DeepSeek localized the copy for ${platform.name}. You can still edit before publishing.`);
  }, 520);
}

function optimizeAllCards() {
  const base = masterCaption.value.trim();
  if (!base) {
    setAiHelper("Write one base caption first, then AI will localize it for each platform.");
    return;
  }

  const cards = getCards();
  setAiHelper("AI is generating US/EU-localized English copy for each platform...", true);
  cards.forEach((card, index) => {
    window.setTimeout(() => optimizeCard(card, base), index * 220);
  });
}

function generatePlatformCopy() {
  if (!masterCaption.value.trim()) {
    setAiHelper("Write the master caption first, then generate platform copy from it.");
    return;
  }
  applyMasterCaption();
  optimizeAllCards();
}

function switchView(view) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  if (view === "channels") loadServerState();
}

function renderPlatforms() {
  platformList.innerHTML = "";
  document.querySelector("#destinationIntro").hidden = state.hasVideo;
  const connectedChannels = new Map((state.db.channels || []).map((channel) => [channel.id, channel]));
  platforms.forEach((platform) => {
    const connectedChannel = connectedChannels.get(platform.id);
    const isConnected = Boolean(connectedChannel?.connected);
    const canPublishNow = isConnected;
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.platform = platform.id;
    node.querySelector(".platform-logo").textContent = platform.logo;
    node.querySelector(".platform-logo").style.background = platform.color;
    node.querySelector("h3").textContent = platform.name;
    node.querySelector("p").textContent = isConnected ? platform.hint : "Not connected, so real publishing is disabled for now";
    node.querySelector(".limit-pill").textContent = `${platform.limit} chars`;

    const toggle = node.querySelector('input[type="checkbox"]');
    const accountLabel = node.querySelector(".channel-inline-label");
    const channelValue = node.querySelector(".channel-value");
    const titleField = node.querySelector(".title-field");
    const titleLabel = node.querySelector(".title-label");
    const title = node.querySelector('input[type="text"]');
    const caption = node.querySelector("textarea");
    const count = node.querySelector(".char-count");
    const styleButton = node.querySelector(".ai-button");
    const connectButton = node.querySelector(".connect-platform");
    const previewHandle = node.querySelector(".preview-handle");
    const previewTitle = node.querySelector(".preview-title");
    const previewCopy = node.querySelector(".preview-copy");

    toggle.checked = canPublishNow;
    node.classList.toggle("disabled", !canPublishNow);
    node.classList.toggle("awaiting-asset", !state.hasVideo);
    accountLabel.textContent = isConnected ? "Connected" : "Connection required";
    channelValue.textContent = connectedChannel?.displayName || "Not connected";

    const needsTitle = platform.id === "youtube";
    titleField.style.display = needsTitle ? "" : "none";
    titleLabel.textContent = platform.id === "youtube" ? "Title" : "Post text";
    title.placeholder = platform.id === "youtube" ? "Write a short YouTube title" : "";
    caption.placeholder =
      platform.id === "youtube"
        ? "Write the YouTube description"
        : platform.id === "twitter"
          ? "Write the X post text"
          : "Write the caption";
    connectButton.textContent = isConnected ? "Connected" : channelActionText(platform.id);
    connectButton.hidden = isConnected;
    connectButton.disabled = isConnected;
    connectButton.addEventListener("click", () => connectPlatform(platform.id));
    previewHandle.textContent = connectedChannel?.displayName || platform.name;

    const refreshCount = () => {
      const length = platformNeedsTitle(platform.id) ? title.value.length : caption.value.length;
      count.textContent = `${length} / ${platform.limit}`;
      count.classList.toggle("warning", length > platform.limit);
      styleButton.textContent = length > platform.limit ? `Shorten for ${platform.logo}` : `Rewrite for ${platform.logo}`;
      previewTitle.textContent = title.value.trim();
      previewCopy.textContent = caption.value.trim();
      updateSummary();
    };

    toggle.addEventListener("change", () => {
      node.classList.toggle("disabled", !toggle.checked);
      markDraftDirty();
      updateSummary();
    });
    caption.addEventListener("input", () => {
      markDraftDirty();
      refreshCount();
    });
    title.addEventListener("input", () => {
      markDraftDirty();
      updateSummary();
    });
    styleButton.addEventListener("click", () => optimizeCard(node));

    refreshCount();
    platformList.appendChild(node);
  });
}

function getCards() {
  return [...document.querySelectorAll(".platform-card")];
}

function selectedCards() {
  return getCards().filter((card) => card.querySelector('input[type="checkbox"]').checked);
}

function updateSummary() {
  const selected = selectedCards();
  const readyCards = selected.filter((card) => {
    return isCardReady(card);
  });
  const scheduleValue = document.querySelector("#scheduleAt").value;
  const scheduleValid = state.mode === "now" || isScheduleValid(scheduleValue);
  const ready = state.hasVideo && selected.length > 0 && readyCards.length === selected.length && scheduleValid;
  const publishLabel = state.mode === "now"
    ? `Publish ${selected.length || 0} ${selected.length === 1 ? "post" : "posts"}`
    : `Schedule ${selected.length || 0} ${selected.length === 1 ? "post" : "posts"}`;

  document.querySelector("#summaryPlatforms").textContent = `${selected.length} / ${platforms.length}`;
  document.querySelector("#summaryReady").textContent = ready ? "Ready to publish" : "Needs review";
  document.querySelector("#summaryMode").textContent =
    state.mode === "now" ? "Publish now" : document.querySelector("#scheduleAt").value || "Scheduled";
  document.querySelector("#publishAll").textContent = publishLabel;
  document.querySelector("#draftState").textContent = state.activeDraftId ? (state.draftDirty ? "Unsaved changes" : "Saved draft") : "Not saved";
  document.querySelector("#publishAll").disabled = !ready;
  syncChecklist({
    hasVideo: state.hasVideo,
    hasPlatforms: selected.length > 0,
    hasCopy: selected.length > 0 && readyCards.length === selected.length,
    hasSchedule: scheduleValid,
  });
}

function markDraftDirty() {
  state.draftDirty = true;
  updateSummary();
}

function isScheduleValid(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function syncChecklist(status) {
  document.querySelector("#checkVideo").classList.toggle("complete", status.hasVideo);
  document.querySelector("#checkPlatforms").classList.toggle("complete", status.hasPlatforms);
  document.querySelector("#checkCopy").classList.toggle("complete", status.hasCopy);
  document.querySelector("#checkSchedule").classList.toggle("complete", status.hasSchedule);
}

function platformNeedsTitle(platformId) {
  return platformId === "youtube";
}

function isCardReady(card) {
  const platformId = card.dataset.platform;
  const title = card.querySelector('input[type="text"]').value.trim();
  const caption = card.querySelector("textarea").value.trim();
  const platform = platforms.find((item) => item.id === platformId);
  if (!platform) return false;
  const overLimit = platformNeedsTitle(platformId) ? title.length > platform.limit : caption.length > platform.limit;
  if (overLimit) return false;
  if (platformNeedsTitle(platformId)) return Boolean(title && caption);
  return Boolean(caption);
}

function showToast({ title, body, actions = [] }) {
  const toast = document.createElement("article");
  toast.className = "toast";
  toast.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(body)}</p>
    <div class="toast-actions"></div>
  `;
  const actionsWrap = toast.querySelector(".toast-actions");
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.primary ? "primary-button" : "ghost-button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.onClick?.();
      toast.remove();
    });
    actionsWrap.appendChild(button);
  });
  toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 6000);
}

function handleFile(file) {
  if (!file) return;
  const firstAssetForSession = !state.hasVideo;
  state.hasVideo = true;
  markDraftDirty();
  if (firstAssetForSession) renderPlatforms();
  const url = URL.createObjectURL(file);
  videoPreview.src = url;
  previewWrap.classList.remove("hidden");
  previewWrap.classList.remove("empty");
  emptyPreview.style.display = "none";
  document.querySelector("#fileName").textContent = file.name;
  document.querySelector("#fileSize").textContent = formatBytes(file.size);
  document.querySelector("#summaryVideo").textContent = file.name;

  videoPreview.onloadedmetadata = () => {
    document.querySelector("#fileDuration").textContent = formatDuration(videoPreview.duration);
    const width = videoPreview.videoWidth;
    const height = videoPreview.videoHeight;
    document.querySelector("#fileRatio").textContent = width && height ? `${width} × ${height}` : "-";
  };
  uploadVideo(file);
  updateSummary();
}

async function uploadVideo(file) {
  const form = new FormData();
  form.append("video", file);
  form.append("title", file.name);

  document.querySelector("#summaryReady").textContent = "Uploading";
  try {
    const data = await apiRequest("/api/uploads", { method: "POST", body: form });
    state.uploadedAsset = data.asset;
    assets = [normalizeServerAsset(data.asset), ...assets.filter((asset) => asset.id !== data.asset.id)];
    renderAssets();
    updateSummary();
    setAiHelper("The video has been saved to the local asset library. You can optimize the copy or save a draft next.");
  } catch (error) {
    document.querySelector("#summaryReady").textContent = "Upload failed";
    setAiHelper(`Local upload failed: ${error.message}`);
  }
}

function applyMasterCaption() {
  getCards().forEach((card) => {
    const platform = platforms.find((item) => item.id === card.dataset.platform);
    const title = card.querySelector('input[type="text"]');
    const caption = card.querySelector("textarea");
    title.value = platformNeedsTitle(platform.id) ? (masterCaption.value.trim().slice(0, 48) || `${platform.name} new post`) : "";
    caption.value = platformText(masterCaption.value, platform);
    caption.dispatchEvent(new Event("input"));
  });
  markDraftDirty();
}

function resetQueue() {
  queueList.innerHTML = '<p class="queue-empty">No active publish run. Start one from this workspace and the live status will appear here.</p>';
}

async function publishAll() {
  const cards = selectedCards();
  resetQueue();
  queueList.innerHTML = "";
  if (!state.hasVideo || cards.length === 0) {
    queueList.innerHTML = '<p class="queue-empty">Upload a source video and turn on at least one connected destination before publishing.</p>';
    return;
  }
  if (state.mode === "schedule" && !isScheduleValid(document.querySelector("#scheduleAt").value)) {
    queueList.innerHTML = '<p class="queue-empty">Choose a future publish time before scheduling this release.</p>';
    return;
  }
  const incomplete = cards.some((card) => {
    return !isCardReady(card);
  });
  if (incomplete) {
    queueList.innerHTML = '<p class="queue-empty">Finish the required copy for every selected destination, or let AI localize the remaining cards first.</p>';
    return;
  }

  const rows = cards.map((card) => {
    const platform = platforms.find((item) => item.id === card.dataset.platform);
    const row = document.createElement("div");
    row.className = "queue-item";
    row.innerHTML = `
      <span class="queue-name">${platform.name}</span>
      <div class="progress"><span></span></div>
      <span class="queue-status">Creating</span>
    `;
    queueList.appendChild(row);
    return { row, platform };
  });

  try {
    const task = await savePublishTask(cards);
    const publishPromises = [];
    rows.forEach(({ row, platform }) => {
      row.querySelector(".progress span").style.width = "100%";
      const status = row.querySelector(".queue-status");
      if (isPlatformConnected(platform.id)) {
        if (state.mode === "now") {
          status.textContent = "Starting";
          publishPromises.push(
            publishTaskToPlatform(task.id, platform.id, { silent: true })
              .then(() => {
                status.textContent = "Running";
              })
              .catch((error) => {
                status.textContent = "Failed";
                row.querySelector(".progress span").style.width = "0%";
                const detail = document.createElement("p");
                detail.className = "queue-error";
                detail.textContent = error.message;
                row.appendChild(detail);
              }),
          );
        } else {
          status.textContent = "Scheduled";
        }
      } else {
        status.textContent = "Not connected";
      }
    });
    if (state.mode === "now") {
      await Promise.allSettled(publishPromises);
      setAiHelper("Publishing has started on every selected connected channel. You can track live progress here and in task history.");
    } else {
      setAiHelper("The task has been saved to the schedule. It will stay in task history until you publish it.");
    }
  } catch (error) {
    queueList.innerHTML = `<p class="queue-empty">Could not create the task: ${escapeHtml(error.message)}</p>`;
  }
}

function isPlatformConnected(platformId) {
  return Boolean((state.db.channels || []).find((channel) => channel.id === platformId && channel.connected));
}

async function savePublishTask(cards) {
  const payload = buildDraftPayload();
  payload.status = state.mode === "now" ? "queued" : "scheduled";
  payload.platforms = cards.map((card) => platformPayload(card));
  const data = await apiRequest("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
  await loadServerState();
  return data.task;
}

function platformPayload(card) {
  const platform = platforms.find((item) => item.id === card.dataset.platform);
  return {
    id: platform.id,
    name: platform.name,
    logo: platform.logo,
    channel: card.querySelector(".channel-value").textContent.trim(),
    title: card.querySelector('input[type="text"]').value.trim(),
    caption: card.querySelector("textarea").value.trim(),
  };
}

function buildDraftPayload() {
  return {
    title: document.querySelector("#summaryVideo").textContent,
    masterCaption: masterCaption.value,
    mode: state.mode,
    scheduleAt: document.querySelector("#scheduleAt").value,
    asset: state.uploadedAsset,
    platforms: getCards().map((card) => ({
      selected: card.querySelector('input[type="checkbox"]').checked,
      ...platformPayload(card),
    })),
  };
}

function renderAssets() {
  if (!assetGrid) return;
  const query = document.querySelector("#assetSearch").value.trim().toLowerCase();
  const status = document.querySelector("#assetStatus").value;
  const ratio = document.querySelector("#assetRatio").value;
  const filtered = assets.filter((asset) => {
    const haystack = [asset.title, asset.desc, asset.statusText, ...asset.tags].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (status === "all" || asset.status === status) && (ratio === "all" || asset.ratio === ratio);
  });

  assetGrid.innerHTML = "";
  if (!filtered.length) {
    assetGrid.innerHTML = '<p class="queue-empty">No matching assets found.</p>';
    return;
  }

  const template = document.querySelector("#assetTemplate");
  filtered.forEach((asset) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.asset = asset.id;
    node.classList.toggle("selected", state.selectedAssets.has(asset.id));
    const thumb = node.querySelector(".asset-thumb");
    const preview = node.querySelector(".asset-preview");
    const fallback = node.querySelector(".asset-preview-fallback");
    thumb.style.background = `linear-gradient(145deg, ${asset.color}, #171d1a)`;
    if (asset.url) {
      preview.src = asset.url;
      preview.style.display = "";
      fallback.style.display = "none";
      preview.addEventListener(
        "loadeddata",
        () => {
          preview.style.opacity = "1";
        },
        { once: true },
      );
      preview.addEventListener(
        "error",
        () => {
          preview.style.display = "none";
          fallback.style.display = "";
        },
        { once: true },
      );
    } else {
      preview.style.display = "none";
      fallback.style.display = "";
    }
    node.querySelector(".asset-duration").textContent = asset.duration;
    node.querySelector("h3").textContent = asset.title;
    node.querySelector("p").textContent = asset.desc;
    node.querySelector(".asset-status").textContent = asset.statusText;
    node.querySelector(".asset-status").dataset.status = asset.status;
    node.querySelector(".asset-tags").innerHTML = asset.tags.map((tag) => `<span>${tag}</span>`).join("");

    const toggleAsset = () => {
      state.selectedAssets = new Set(state.selectedAssets.has(asset.id) ? [] : [asset.id]);
      renderAssets();
    };
    node.querySelector(".asset-check").addEventListener("click", toggleAsset);
    node.querySelector(".use-asset").addEventListener("click", () => useAsset(asset));
    const deleteButton = node.querySelector(".delete-asset");
    deleteButton.style.display = asset.serverAsset ? "" : "none";
    deleteButton.addEventListener("click", () => deleteAsset(asset));
    assetGrid.appendChild(node);
  });
}

function useAsset(asset) {
  document.querySelector("#summaryVideo").textContent = asset.title;
  document.querySelector("#fileName").textContent = asset.title;
  document.querySelector("#fileSize").textContent = asset.desc.split("·").at(-1).trim();
  document.querySelector("#fileDuration").textContent = asset.duration;
  document.querySelector("#fileRatio").textContent = asset.ratio;
  const firstAssetForSession = !state.hasVideo;
  state.uploadedAsset = asset.serverAsset || null;
  state.hasVideo = true;
  if (firstAssetForSession) renderPlatforms();
  if (asset.url) {
    videoPreview.src = asset.url;
    previewWrap.classList.remove("hidden");
    previewWrap.classList.remove("empty");
    emptyPreview.style.display = "none";
  }
  switchView("publish");
  markDraftDirty();
  updateSummary();
}

async function deleteAsset(asset) {
  if (!asset.serverAsset) return;
  try {
    await apiRequest(`/api/assets/${asset.id}`, { method: "DELETE" });
    state.selectedAssets.delete(asset.id);
    await loadServerState();
    setAiHelper("The asset has been removed from the local library.");
  } catch (error) {
    setAiHelper(`Could not delete the asset: ${error.message}`);
  }
}

function renderSchedule() {
  if (!calendarGrid) return;
  const days = ["Unscheduled", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  calendarGrid.innerHTML = "";
  days.forEach((day) => {
    const column = document.createElement("article");
    column.className = "day-column";
    const dayItems = scheduleItems.filter((item) => item.day === day);
    column.innerHTML = `<h3>${day}</h3><div class="day-stack"></div>`;
    const stack = column.querySelector(".day-stack");
    if (!dayItems.length) {
      stack.innerHTML = '<p class="empty-day">No posts scheduled</p>';
    } else {
      dayItems.forEach((item) => {
        const task = document.createElement("div");
        task.className = "schedule-task";
        task.innerHTML = `
          <span>${item.time}</span>
          <strong>${item.title}</strong>
          <small>${item.platforms.join(" · ")} · ${item.status}</small>
        `;
        stack.appendChild(task);
      });
    }
    calendarGrid.appendChild(column);
  });
  document.querySelector("#scheduleCount").textContent = `${scheduleItems.length} tasks`;
  const reminders = scheduleItems.filter((item) => item.status !== "Published");
  reminderList.innerHTML = reminders.length
    ? reminders.map((item) => `<div class="reminder-item"><strong>${escapeHtml(item.title)}</strong><span>${item.day} ${item.time} · ${item.status}</span></div>`).join("")
    : '<p class="queue-empty">No pending tasks.</p>';
}

function renderHistoryLists() {
  renderDraftList();
  renderTaskList();
}

function renderDraftList() {
  const drafts = state.db.drafts || [];
  document.querySelector("#draftCount").textContent = `${drafts.length} items`;
  if (!drafts.length) {
    draftList.innerHTML = '<p class="queue-empty">No drafts yet. Saved work will appear here.</p>';
    return;
  }
  draftList.innerHTML = "";
  drafts.forEach((draft) => {
    const item = document.createElement("article");
    item.className = "history-item";
    item.innerHTML = `
      <div class="history-main">
        <div>
          <strong>${escapeHtml(draft.title || "Untitled draft")}</strong>
          <p>${formatDate(draft.updatedAt)} · ${(draft.platforms || []).filter((platform) => platform.selected).length} platforms</p>
        </div>
        <span class="asset-status" data-status="draft">Draft</span>
      </div>
      <div class="history-actions">
        <button class="tiny-button load-draft" type="button">Edit draft</button>
        <button class="tiny-button danger-button delete-draft" type="button">Delete</button>
      </div>
    `;
    item.querySelector(".load-draft").addEventListener("click", () => loadDraft(draft));
    item.querySelector(".delete-draft").addEventListener("click", () => deleteDraft(draft.id));
    draftList.appendChild(item);
  });
}

function renderTaskList() {
  const tasks = state.db.tasks || [];
  document.querySelector("#taskCount").textContent = `${tasks.length} items`;
  if (!tasks.length) {
    taskList.innerHTML = '<p class="queue-empty">No publish tasks yet. New tasks will appear here.</p>';
    return;
  }
  taskList.innerHTML = "";
  tasks.forEach((task) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const statusText = statusLabel(task.status);
    const platformProgress = (task.platforms || []).map((platform) => platformProgressHtml(task, platform)).join("");
    const platformLinks = (task.platforms || []).map((platform) => platformResultLink(task, platform)).join("");
    const platformErrors = (task.platforms || []).map((platform) => platformErrorHtml(task, platform)).join("");
    const platformButtons = (task.platforms || [])
      .map((platform) => platformPublishButtonHtml(task, platform))
      .join("");
    const detailRows = (task.platforms || [])
      .map((platform) => taskDetailRowHtml(task, platform))
      .join("");
    item.innerHTML = `
      <div class="history-main">
        <div>
          <strong>${escapeHtml(task.title || "Local publish task")}</strong>
          <p>${formatDate(task.createdAt || task.updatedAt)} · ${(task.platforms || []).map((platform) => platform.logo || platform.name).join(" · ")}</p>
          ${platformProgress}
          ${platformLinks}
          ${platformErrors}
        </div>
        <span class="asset-status" data-status="${task.status === "published" ? "ready" : task.status === "failed" ? "review" : "draft"}">${statusText}</span>
      </div>
      <div class="history-actions">
        <button class="tiny-button load-task" type="button">Reuse task</button>
        <button class="tiny-button detail-task" type="button">View details</button>
        ${platformButtons}
        <button class="tiny-button danger-button delete-task" type="button">Delete</button>
      </div>
      <div class="task-detail" hidden>${detailRows}</div>
    `;
    item.querySelector(".load-task").addEventListener("click", () => loadDraft(task));
    item.querySelector(".detail-task").addEventListener("click", () => {
      const detail = item.querySelector(".task-detail");
      const expanded = !detail.hidden;
      detail.hidden = expanded;
      item.querySelector(".detail-task").textContent = expanded ? "View details" : "Hide details";
    });
    item.querySelectorAll(".platform-task").forEach((button) => {
      button.addEventListener("click", () => publishTaskToPlatform(task.id, button.dataset.platform));
    });
    item.querySelector(".delete-task").addEventListener("click", () => deleteTask(task.id));
    taskList.appendChild(item);
  });
}

function taskDetailRowHtml(task, platform) {
  const result = task.publishResults?.[platform.id] || {};
  return `
    <article class="task-detail-row">
      <div class="task-detail-head">
        <strong>${escapeHtml(platform.name)}</strong>
        <span>${escapeHtml(statusLabel(result.status || task.status || "queued"))}</span>
      </div>
      ${platform.title ? `<p><strong>Title:</strong> ${escapeHtml(platform.title)}</p>` : ""}
      ${platform.caption ? `<p><strong>Copy:</strong> ${escapeHtml(platform.caption)}</p>` : ""}
      ${result.error ? `<p class="error-text">${escapeHtml(result.error)}</p><p class="next-step"><strong>Next step:</strong> ${escapeHtml(suggestNextStep(result.error))}</p>` : ""}
      ${result.url ? `<p><a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">Open live post</a></p>` : ""}
    </article>
  `;
}

function platformProgressHtml(task, platform) {
  const result = task.publishResults?.[platform.id];
  if (result?.status !== "publishing") return "";
  const progress = Number(result.progress || 0);
  return `<p class="upload-progress-text">${escapeHtml(platform.name)} uploading: ${progress}% · ${formatBytes(result.uploadedBytes || 0)} / ${formatBytes(result.totalBytes || task.asset?.size || 0)}</p>
    <div class="progress upload-progress" aria-label="${escapeHtml(platform.name)} upload progress"><span style="width:${Math.max(2, Math.min(progress, 100))}%"></span></div>`;
}

function platformResultLink(task, platform) {
  const result = task.publishResults?.[platform.id];
  if (!result?.url) return "";
  return `<p><a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">Open ${escapeHtml(platform.name)} post</a></p>`;
}

function platformErrorHtml(task, platform) {
  const result = task.publishResults?.[platform.id];
  if (!result?.error) return "";
  return `<p class="error-text">${escapeHtml(platform.name)}: ${escapeHtml(result.error)}</p><p class="next-step">${escapeHtml(suggestNextStep(result.error))}</p>`;
}

function platformPublishButtonHtml(task, platform) {
  if (!isPlatformConnected(platform.id)) return "";
  const result = task.publishResults?.[platform.id];
  const disabled = !task.asset?.filename || result?.status === "publishing";
  const label = result?.status === "publishing" ? "Publishing" : result?.status === "published" ? `Republish ${platform.logo}` : `Publish ${platform.logo}`;
  return `<button class="tiny-button platform-task" type="button" data-platform="${platform.id}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function formatDate(value) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function loadDraft(draft) {
  state.activeDraftId = draft.id || null;
  state.draftDirty = false;
  masterCaption.value = draft.masterCaption || "";
  state.mode = draft.mode || "now";
  state.uploadedAsset = draft.asset || null;
  state.hasVideo = Boolean(draft.asset || draft.title);
  renderPlatforms();
  document.querySelector("#summaryVideo").textContent = draft.title || draft.asset?.title || "Draft asset";
  document.querySelector("#scheduleAt").value = draft.scheduleAt || "";

  if (draft.asset) {
    const asset = normalizeServerAsset(draft.asset);
    useAsset(asset);
  }

  const platformMap = new Map((draft.platforms || []).map((platform) => [platform.id, platform]));
  getCards().forEach((card) => {
    const saved = platformMap.get(card.dataset.platform);
    if (!saved) return;
    card.querySelector('input[type="checkbox"]').checked = saved.selected !== false;
    if (saved.channel) card.querySelector(".channel-value").textContent = saved.channel;
    card.querySelector('input[type="text"]').value = saved.title || "";
    const caption = card.querySelector("textarea");
    caption.value = saved.caption || "";
    caption.dispatchEvent(new Event("input"));
  });
  state.draftDirty = false;
  switchView("publish");
  updateSummary();
  setAiHelper("Draft loaded from Library. Keep editing in Publish, then save again or publish when ready.");
}

async function deleteDraft(id) {
  try {
    await apiRequest(`/api/drafts/${id}`, { method: "DELETE" });
    await loadServerState();
  } catch (error) {
    setAiHelper(`Could not delete the draft: ${error.message}`);
  }
}

async function updateTaskStatus(id, status) {
  try {
    await apiRequest(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadServerState();
  } catch (error) {
    setAiHelper(`Could not update the task status: ${error.message}`);
  }
}

async function deleteTask(id) {
  try {
    await apiRequest(`/api/tasks/${id}`, { method: "DELETE" });
    await loadServerState();
  } catch (error) {
    setAiHelper(`Could not delete the task: ${error.message}`);
  }
}

async function publishTaskToYouTube(id) {
  return publishTaskToPlatform(id, "youtube");
}

async function publishTaskToPlatform(id, platformId, options = {}) {
  const platform = platforms.find((item) => item.id === platformId);
  try {
    if (!options.silent) {
      setAiHelper(`${platform?.name || platformId} upload has started in the background. Progress will appear in task history.`, true);
    }
    await apiRequest(`/api/publish/${platformId}/${id}`, { method: "POST" });
    await loadServerState();
    pollPlatformTask(id, platformId);
  } catch (error) {
    if (!options.silent) {
      setAiHelper(`${platform?.name || platformId} publish failed: ${error.message}`);
    }
    throw error;
  }
}

function pollYouTubeTask(id, attempt = 0) {
  return pollPlatformTask(id, "youtube", attempt);
}

function pollPlatformTask(id, platformId, attempt = 0) {
  const platform = platforms.find((item) => item.id === platformId);
  window.setTimeout(async () => {
    try {
      await loadServerState();
      const task = (state.db.tasks || []).find((item) => item.id === id);
      const result = task?.publishResults?.[platformId];
      if (result?.status === "published") {
        setAiHelper(`${platform?.name || platformId} finished: ${result.url || result.videoId || result.publishId || result.postId || "submitted"}`);
        return;
      }
      if (result?.status === "failed") {
        setAiHelper(`${platform?.name || platformId} publish failed: ${result.error}`);
        return;
      }
      if (attempt >= 240) {
        setAiHelper(`${platform?.name || platformId} is still uploading. Check task history for the latest status.`);
        return;
      }
      const progress = Number(result?.progress || 0);
      const detail = progress ? ` · ${progress}%` : "";
      setAiHelper(`${platform?.name || platformId} uploading${detail} · running for about ${Math.round(((attempt + 1) * 3) / 60)} min`, true);
      pollPlatformTask(id, platformId, attempt + 1);
    } catch (error) {
      setAiHelper(`Could not refresh publish status: ${error.message}`);
    }
  }, 3000);
}

function renderChannels() {
  if (!channelGrid) return;
  channelGrid.innerHTML = "";
  const template = document.querySelector("#channelTemplate");
  const connectedChannels = new Map((state.db.channels || []).map((channel) => [channel.id, channel]));
  platforms.forEach((platform) => {
    const serverChannel = connectedChannels.get(platform.id);
    const connected = Boolean(serverChannel?.connected);
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.connected = connected ? "true" : "false";
    node.querySelector(".platform-logo").textContent = platform.logo;
    node.querySelector(".platform-logo").style.background = platform.color;
    node.querySelector("h3").textContent = platform.name;
    node.querySelector("p").textContent = connected ? `Connected: ${serverChannel.displayName || platform.name}` : channelConnectionText(platform.id);
    node.querySelector(".channel-state").textContent = connected ? "Connected" : "Not connected";
    node.querySelector(".channel-state").classList.toggle("pending", !connected);
    node.querySelector(".channel-note").textContent = connected ? `Authorized: ${formatDate(serverChannel.connectedAt)}` : channelSetupText(platform.id);
    const actionButton = node.querySelector(".tiny-button");
    actionButton.textContent = connected ? "Disconnect" : channelActionText(platform.id);
    node.querySelector(".channel-value").textContent = connected ? (serverChannel.displayName || "Authorized account") : "Not connected";
    actionButton.addEventListener("click", async () => {
      if (connected) {
        await disconnectChannel(platform.id, platform.name);
        return;
      }
      if (platform.id === "youtube") window.location.href = "/auth/youtube";
      if (platform.id === "instagram") window.location.href = "/auth/instagram";
      if (platform.id === "tiktok") window.location.href = "/auth/tiktok";
      if (platform.id === "twitter") window.location.href = "/auth/twitter";
    });
    channelGrid.appendChild(node);
  });
  updateChannelSummary();
}

async function disconnectChannel(platformId, platformName) {
  try {
    await apiRequest(`/api/channels/${platformId}`, { method: "DELETE" });
    await loadServerState();
    setAiHelper(`${platformName} has been disconnected. You can reconnect now and record the full flow.`);
  } catch (error) {
    setAiHelper(`${platformName} disconnect failed: ${error.message}`);
  }
}

function channelConnectionText(platformId) {
  if (platformId === "youtube") return "Google OAuth is available";
  if (platformId === "instagram") return "Meta OAuth is available";
  if (platformId === "tiktok") return "TikTok OAuth is available";
  return "X OAuth is available";
}

function channelSetupText(platformId) {
  if (platformId === "youtube") return "Requires Google Client ID and Client Secret";
  if (platformId === "instagram") return "Requires Meta App ID and Secret, plus a Business or Creator account";
  if (platformId === "tiktok") return "Requires TikTok Client Key, Client Secret, and Content Posting API access";
  return "Requires X Client ID, Client Secret, and Web App OAuth settings";
}

function channelActionText(platformId) {
  if (platformId === "youtube") return "Connect YouTube";
  if (platformId === "instagram") return "Connect Instagram";
  if (platformId === "tiktok") return "Connect TikTok";
  return "Connect X";
}

function connectPlatform(platformId) {
  if (platformId === "youtube") window.location.href = "/auth/youtube";
  if (platformId === "instagram") window.location.href = "/auth/instagram";
  if (platformId === "tiktok") window.location.href = "/auth/tiktok";
  if (platformId === "twitter") window.location.href = "/auth/twitter";
}

function suggestNextStep(message = "") {
  const text = String(message).toLowerCase();
  if (text.includes("not connected")) return "Connect the channel from this card or the Channels page, then try again.";
  if (text.includes("oauth")) return "Reconnect the affected channel so ClipRelay can refresh authorization.";
  if (text.includes("upload")) return "Retry the upload or choose a different source asset from Library.";
  if (text.includes("public https video url")) return "Expose the video through a public HTTPS asset URL before publishing to Instagram.";
  return "Open the task details, review the error, then retry the affected platform.";
}

function updateChannelSummary() {
  const connected = [...document.querySelectorAll(".channel-card")].filter((card) => card.dataset.connected === "true").length;
  document.querySelector("#connectedCount").textContent = `${connected} / ${platforms.length}`;
  document.querySelector("#channelNeeds").textContent = `${platforms.length - connected} items`;
  document.querySelector("#defaultPublishCount").textContent = `${connected} channels`;
  document.querySelector("#sidebarConnected").textContent = `${connected} channels online`;
  document.querySelector("#sidebarMode").textContent = connected ? "Ready for connected channels" : "Local workspace";
}

videoInput.addEventListener("change", (event) => handleFile(event.target.files[0]));

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (event) => handleFile(event.dataTransfer.files[0]));

document.querySelector("#generateCopy").addEventListener("click", generatePlatformCopy);
document.querySelector("#clearCaptions").addEventListener("click", () => {
  markDraftDirty();
  masterCaption.value = "";
  getCards().forEach((card) => {
    card.querySelector('input[type="text"]').value = "";
    const caption = card.querySelector("textarea");
    caption.value = "";
    caption.dispatchEvent(new Event("input"));
  });
});
document.querySelector("#publishAll").addEventListener("click", publishAll);
document.querySelector("#resetQueue").addEventListener("click", resetQueue);
document.querySelector("#saveDraft").addEventListener("click", () => {
  document.querySelector("#summaryReady").textContent = "Saving";
  apiRequest("/api/draft", { method: "POST", body: JSON.stringify(buildDraftPayload()) })
    .then((data) => {
      state.activeDraftId = data.draft?.id || state.activeDraftId;
      state.draftDirty = false;
      document.querySelector("#summaryReady").textContent = "Draft saved";
      loadServerState();
      setAiHelper("Draft saved to Library. Open Library > Drafts any time to edit it again.");
      showToast({
        title: "Draft saved",
        body: "Your release setup is now stored in Library > Drafts.",
        actions: [
          { label: "View drafts", onClick: () => switchView("library") },
        ],
      });
      window.setTimeout(updateSummary, 1400);
    })
    .catch((error) => {
      document.querySelector("#summaryReady").textContent = "Save failed";
      setAiHelper(`Could not save the draft: ${error.message}`);
    });
});
document.querySelector("#scheduleAt").addEventListener("input", updateSummary);
document.querySelector("#scheduleAt").addEventListener("input", markDraftDirty);
masterCaption.addEventListener("input", markDraftDirty);

document.querySelectorAll(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.mode = button.dataset.mode;
    scheduleRow.classList.toggle("visible", state.mode === "schedule");
    markDraftDirty();
    updateSummary();
  });
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

["#assetSearch", "#assetStatus", "#assetRatio"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", renderAssets);
});

document.querySelector("#libraryUseSelected").addEventListener("click", () => {
  const asset = assets.find((item) => state.selectedAssets.has(item.id)) || assets[0];
  if (!asset) return;
  useAsset(asset);
});

document.querySelector("#scheduleNewTask").addEventListener("click", () => switchView("publish"));
document.querySelector("#scheduleListMode").addEventListener("click", () => {
  reminderList.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#refreshChannels").addEventListener("click", loadServerState);
document.querySelector("#connectAll").addEventListener("click", () => {
  document.querySelectorAll(".channel-card .tiny-button").forEach((button) => button.click());
});

renderPlatforms();
renderAssets();
renderSchedule();
renderChannels();
resetQueue();
updateSummary();
loadServerState();
