const platforms = [
  {
    id: "youtube",
    name: "YouTube Shorts",
    logo: "YT",
    hint: "短标题 + 强钩子",
    limit: 100,
    channels: ["Jayden Studio", "Brand Shorts", "Creator Lab"],
    color: "#d64545",
    suffix: "#Shorts #YouTubeShorts",
  },
  {
    id: "instagram",
    name: "Instagram Reels",
    logo: "IG",
    hint: "生活化表达 + 标签",
    limit: 2200,
    channels: ["Official IG", "Founder Daily", "Product Reels"],
    color: "#b6509e",
    suffix: "#reels #creator #behindthescenes",
  },
  {
    id: "tiktok",
    name: "TikTok",
    logo: "TT",
    hint: "更口语，更直接",
    limit: 2200,
    channels: ["TikTok Main", "Growth Clips", "CN Overseas"],
    color: "#111111",
    suffix: "#fyp #tiktok #learnontiktok",
  },
  {
    id: "twitter",
    name: "X / Twitter",
    logo: "X",
    hint: "短文案 + 观点句",
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
  const readableSize = asset.size ? formatBytes(asset.size) : "未知大小";
  return {
    id: asset.id,
    title: asset.title || asset.originalName || "本地上传视频",
    desc: `${asset.ratio || "待检测"} · ${asset.duration || "待检测"} · ${readableSize}`,
    duration: asset.duration || "待检测",
    status: asset.status || "ready",
    statusText: asset.statusText || "可发布",
    ratio: asset.ratio || "待检测",
    tags: asset.tags || ["本地上传"],
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
    console.warn("无法读取本地后端状态，继续使用原型数据。", error);
  }
}

function taskToScheduleItem(task) {
  const scheduleDate = task.scheduleAt ? new Date(task.scheduleAt) : null;
  return {
    source: "server",
    id: task.id,
    day: scheduleDate && !Number.isNaN(scheduleDate.getTime()) ? weekdayName(scheduleDate) : "待排期",
    time: scheduleDate && !Number.isNaN(scheduleDate.getTime()) ? timeName(scheduleDate) : task.mode === "scheduled" ? "待定" : "立即",
    title: task.title || task.asset?.title || "本地发布任务",
    platforms: (task.platforms || []).map((item) => item.logo || item.name || item.id),
    status: statusLabel(task.status),
  };
}

function weekdayName(date) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function timeName(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function statusLabel(status) {
  if (status === "published") return "已发布";
  if (status === "scheduled") return "已排期";
  if (status === "publishing") return "发布中";
  if (status === "failed") return "失败";
  return "已入队";
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
  const base = (sourceText || caption.value || masterCaption.value).trim();

  if (!base) {
    setAiHelper("请先输入统一文案，或在当前平台文案里写一点内容。");
    return;
  }

  button.disabled = true;
  button.textContent = "生成中";
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
    button.textContent = "AI 优化";
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
  const connectedChannels = new Map((state.db.channels || []).map((channel) => [channel.id, channel]));
  platforms.forEach((platform) => {
    const connectedChannel = connectedChannels.get(platform.id);
    const isConnected = Boolean(connectedChannel?.connected);
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.platform = platform.id;
    node.querySelector(".platform-logo").textContent = platform.logo;
    node.querySelector(".platform-logo").style.background = platform.color;
    node.querySelector("h3").textContent = platform.name;
    node.querySelector("p").textContent = isConnected ? platform.hint : "未连接，暂不参与真实发布";
    node.querySelector(".limit-pill").textContent = `${platform.limit} 字`;

    const toggle = node.querySelector('input[type="checkbox"]');
    const select = node.querySelector("select");
    const title = node.querySelector('input[type="text"]');
    const caption = node.querySelector("textarea");
    const count = node.querySelector(".char-count");
    const styleButton = node.querySelector(".tiny-button");

    toggle.checked = isConnected;
    node.classList.toggle("disabled", !isConnected);
    const channelOptions = connectedChannel?.displayName ? [connectedChannel.displayName] : ["待连接"];
    channelOptions.forEach((channel) => {
      const option = document.createElement("option");
      option.textContent = channel;
      select.appendChild(option);
    });

    title.placeholder = `${platform.name} 标题`;

    const refreshCount = () => {
      const length = caption.value.length;
      count.textContent = `${length} / ${platform.limit}`;
      count.classList.toggle("warning", length > platform.limit);
      updateSummary();
    };

    toggle.addEventListener("change", () => {
      node.classList.toggle("disabled", !toggle.checked);
      updateSummary();
    });
    caption.addEventListener("input", refreshCount);
    title.addEventListener("input", updateSummary);
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
    const title = card.querySelector('input[type="text"]').value.trim();
    const caption = card.querySelector("textarea").value.trim();
    return title && caption;
  });
  const ready = state.hasVideo && selected.length > 0 && readyCards.length === selected.length;

  document.querySelector("#summaryPlatforms").textContent = `${selected.length} / ${platforms.length}`;
  document.querySelector("#summaryReady").textContent = ready ? "可分发" : "待完善";
  document.querySelector("#summaryMode").textContent =
    state.mode === "now" ? "立即发布" : document.querySelector("#scheduleAt").value || "定时发布";
}

function handleFile(file) {
  if (!file) return;
  state.hasVideo = true;
  const url = URL.createObjectURL(file);
  videoPreview.src = url;
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

  document.querySelector("#summaryReady").textContent = "上传中";
  try {
    const data = await apiRequest("/api/uploads", { method: "POST", body: form });
    state.uploadedAsset = data.asset;
    assets = [normalizeServerAsset(data.asset), ...assets.filter((asset) => asset.id !== data.asset.id)];
    renderAssets();
    updateSummary();
    setAiHelper("视频已保存到本地素材库，可以继续 AI 优化文案或保存草稿。");
  } catch (error) {
    document.querySelector("#summaryReady").textContent = "上传失败";
    setAiHelper(`本地上传失败：${error.message}`);
  }
}

function applyMasterCaption() {
  getCards().forEach((card) => {
    const platform = platforms.find((item) => item.id === card.dataset.platform);
    const title = card.querySelector('input[type="text"]');
    const caption = card.querySelector("textarea");
    title.value = masterCaption.value.trim().slice(0, 48) || `${platform.name} 新视频`;
    caption.value = platformText(masterCaption.value, platform);
    caption.dispatchEvent(new Event("input"));
  });
}

function resetQueue() {
  window.clearInterval(state.queueTimer);
  queueList.innerHTML = '<p class="queue-empty">暂无任务。上传视频并点击模拟分发后，会看到平台队列。</p>';
}

async function publishAll() {
  const cards = selectedCards();
  resetQueue();
  queueList.innerHTML = "";
  if (!state.hasVideo || cards.length === 0) {
    queueList.innerHTML = '<p class="queue-empty">请先上传视频，并至少选择一个已连接的发布平台。</p>';
    return;
  }
  const incomplete = cards.some((card) => {
    return !card.querySelector('input[type="text"]').value.trim() || !card.querySelector("textarea").value.trim();
  });
  if (incomplete) {
    queueList.innerHTML = '<p class="queue-empty">请先补齐已选平台的标题和文案，或使用 AI 优化全部平台。</p>';
    return;
  }

  const rows = cards.map((card) => {
    const platform = platforms.find((item) => item.id === card.dataset.platform);
    const row = document.createElement("div");
    row.className = "queue-item";
    row.innerHTML = `
      <span class="queue-name">${platform.name}</span>
      <div class="progress"><span></span></div>
      <span class="queue-status">创建中</span>
    `;
    queueList.appendChild(row);
    return { row, platform };
  });

  try {
    const task = await savePublishTask(cards);
    rows.forEach(({ row, platform }) => {
      row.querySelector(".progress span").style.width = "100%";
      const status = row.querySelector(".queue-status");
      if (isPlatformConnected(platform.id)) {
        status.innerHTML = `<button class="tiny-button queue-publish" type="button">发布</button>`;
        status.querySelector("button").addEventListener("click", () => publishTaskToPlatform(task.id, platform.id));
      } else {
        status.textContent = "待接入";
      }
    });
    setAiHelper("发布任务已创建。已连接的平台可以直接点击发布。");
  } catch (error) {
    queueList.innerHTML = `<p class="queue-empty">任务创建失败：${escapeHtml(error.message)}</p>`;
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
    channel: card.querySelector("select").value,
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
    assetGrid.innerHTML = '<p class="queue-empty">没有找到匹配素材。</p>';
    return;
  }

  const template = document.querySelector("#assetTemplate");
  filtered.forEach((asset) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.asset = asset.id;
    node.classList.toggle("selected", state.selectedAssets.has(asset.id));
    node.querySelector(".asset-thumb").style.background = `linear-gradient(145deg, ${asset.color}, #171d1a)`;
    node.querySelector(".asset-duration").textContent = asset.duration;
    node.querySelector("h3").textContent = asset.title;
    node.querySelector("p").textContent = asset.desc;
    node.querySelector(".asset-status").textContent = asset.statusText;
    node.querySelector(".asset-status").dataset.status = asset.status;
    node.querySelector(".asset-tags").innerHTML = asset.tags.map((tag) => `<span>${tag}</span>`).join("");

    const toggleAsset = () => {
      if (state.selectedAssets.has(asset.id)) {
        state.selectedAssets.delete(asset.id);
      } else {
        state.selectedAssets.add(asset.id);
      }
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
  state.uploadedAsset = asset.serverAsset || null;
  state.hasVideo = true;
  if (asset.url) {
    videoPreview.src = asset.url;
    previewWrap.classList.remove("empty");
    emptyPreview.style.display = "none";
  }
  switchView("publish");
  updateSummary();
}

async function deleteAsset(asset) {
  if (!asset.serverAsset) return;
  try {
    await apiRequest(`/api/assets/${asset.id}`, { method: "DELETE" });
    state.selectedAssets.delete(asset.id);
    await loadServerState();
    setAiHelper("素材已从本地库删除。");
  } catch (error) {
    setAiHelper(`素材删除失败：${error.message}`);
  }
}

function renderSchedule() {
  if (!calendarGrid) return;
  const days = ["待排期", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  calendarGrid.innerHTML = "";
  days.forEach((day) => {
    const column = document.createElement("article");
    column.className = "day-column";
    const dayItems = scheduleItems.filter((item) => item.day === day);
    column.innerHTML = `<h3>${day}</h3><div class="day-stack"></div>`;
    const stack = column.querySelector(".day-stack");
    if (!dayItems.length) {
      stack.innerHTML = '<p class="empty-day">暂无发布</p>';
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
  document.querySelector("#scheduleCount").textContent = `${scheduleItems.length} 个任务`;
  const reminders = scheduleItems.filter((item) => item.status !== "已发布");
  reminderList.innerHTML = reminders.length
    ? reminders.map((item) => `<div class="reminder-item"><strong>${escapeHtml(item.title)}</strong><span>${item.day} ${item.time} · ${item.status}</span></div>`).join("")
    : '<p class="queue-empty">暂无待处理任务。</p>';
}

function renderHistoryLists() {
  renderDraftList();
  renderTaskList();
}

function renderDraftList() {
  const drafts = state.db.drafts || [];
  document.querySelector("#draftCount").textContent = `${drafts.length} 条`;
  if (!drafts.length) {
    draftList.innerHTML = '<p class="queue-empty">暂无草稿。保存一次发布任务后会出现在这里。</p>';
    return;
  }
  draftList.innerHTML = "";
  drafts.forEach((draft) => {
    const item = document.createElement("article");
    item.className = "history-item";
    item.innerHTML = `
      <div class="history-main">
        <div>
          <strong>${escapeHtml(draft.title || "未命名草稿")}</strong>
          <p>${formatDate(draft.updatedAt)} · ${(draft.platforms || []).filter((platform) => platform.selected).length} 个平台</p>
        </div>
        <span class="asset-status" data-status="draft">草稿</span>
      </div>
      <div class="history-actions">
        <button class="tiny-button load-draft" type="button">继续编辑</button>
        <button class="tiny-button danger-button delete-draft" type="button">删除</button>
      </div>
    `;
    item.querySelector(".load-draft").addEventListener("click", () => loadDraft(draft));
    item.querySelector(".delete-draft").addEventListener("click", () => deleteDraft(draft.id));
    draftList.appendChild(item);
  });
}

function renderTaskList() {
  const tasks = state.db.tasks || [];
  document.querySelector("#taskCount").textContent = `${tasks.length} 条`;
  if (!tasks.length) {
    taskList.innerHTML = '<p class="queue-empty">暂无发布任务。点击模拟分发后会写入这里。</p>';
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
    item.innerHTML = `
      <div class="history-main">
        <div>
          <strong>${escapeHtml(task.title || "本地发布任务")}</strong>
          <p>${formatDate(task.createdAt || task.updatedAt)} · ${(task.platforms || []).map((platform) => platform.logo || platform.name).join(" · ")}</p>
          ${platformProgress}
          ${platformLinks}
          ${platformErrors}
        </div>
        <span class="asset-status" data-status="${task.status === "published" ? "ready" : task.status === "failed" ? "review" : "draft"}">${statusText}</span>
      </div>
      <div class="history-actions">
        <button class="tiny-button load-task" type="button">复用任务</button>
        ${platformButtons}
        <button class="tiny-button mark-task" type="button">标记已发布</button>
        <button class="tiny-button danger-button delete-task" type="button">删除</button>
      </div>
    `;
    item.querySelector(".load-task").addEventListener("click", () => loadDraft(task));
    item.querySelectorAll(".platform-task").forEach((button) => {
      button.addEventListener("click", () => publishTaskToPlatform(task.id, button.dataset.platform));
    });
    item.querySelector(".mark-task").addEventListener("click", () => updateTaskStatus(task.id, "published"));
    item.querySelector(".delete-task").addEventListener("click", () => deleteTask(task.id));
    taskList.appendChild(item);
  });
}

function platformProgressHtml(task, platform) {
  const result = task.publishResults?.[platform.id];
  if (result?.status !== "publishing") return "";
  const progress = Number(result.progress || 0);
  return `<p class="upload-progress-text">${escapeHtml(platform.name)} 上传中：${progress}% · ${formatBytes(result.uploadedBytes || 0)} / ${formatBytes(result.totalBytes || task.asset?.size || 0)}</p>
    <div class="progress upload-progress" aria-label="${escapeHtml(platform.name)} upload progress"><span style="width:${Math.max(2, Math.min(progress, 100))}%"></span></div>`;
}

function platformResultLink(task, platform) {
  const result = task.publishResults?.[platform.id];
  if (!result?.url) return "";
  return `<p><a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">打开 ${escapeHtml(platform.name)} 内容</a></p>`;
}

function platformErrorHtml(task, platform) {
  const result = task.publishResults?.[platform.id];
  if (!result?.error) return "";
  return `<p class="error-text">${escapeHtml(platform.name)}：${escapeHtml(result.error)}</p>`;
}

function platformPublishButtonHtml(task, platform) {
  if (!isPlatformConnected(platform.id)) return "";
  const result = task.publishResults?.[platform.id];
  const disabled = !task.asset?.filename || result?.status === "publishing";
  const label = result?.status === "publishing" ? "发布中" : result?.status === "published" ? `重发 ${platform.logo}` : `发布 ${platform.logo}`;
  return `<button class="tiny-button platform-task" type="button" data-platform="${platform.id}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function formatDate(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function loadDraft(draft) {
  masterCaption.value = draft.masterCaption || "";
  state.mode = draft.mode || "now";
  state.uploadedAsset = draft.asset || null;
  state.hasVideo = Boolean(draft.asset || draft.title);
  document.querySelector("#summaryVideo").textContent = draft.title || draft.asset?.title || "草稿素材";
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
    card.querySelector("select").value = saved.channel || card.querySelector("select").value;
    card.querySelector('input[type="text"]').value = saved.title || "";
    const caption = card.querySelector("textarea");
    caption.value = saved.caption || "";
    caption.dispatchEvent(new Event("input"));
  });
  switchView("publish");
  updateSummary();
  setAiHelper("草稿已载入，可以继续编辑或分发。");
}

async function deleteDraft(id) {
  try {
    await apiRequest(`/api/drafts/${id}`, { method: "DELETE" });
    await loadServerState();
  } catch (error) {
    setAiHelper(`草稿删除失败：${error.message}`);
  }
}

async function updateTaskStatus(id, status) {
  try {
    await apiRequest(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadServerState();
  } catch (error) {
    setAiHelper(`任务状态更新失败：${error.message}`);
  }
}

async function deleteTask(id) {
  try {
    await apiRequest(`/api/tasks/${id}`, { method: "DELETE" });
    await loadServerState();
  } catch (error) {
    setAiHelper(`任务删除失败：${error.message}`);
  }
}

async function publishTaskToYouTube(id) {
  return publishTaskToPlatform(id, "youtube");
}

async function publishTaskToPlatform(id, platformId) {
  const platform = platforms.find((item) => item.id === platformId);
  try {
    setAiHelper(`${platform?.name || platformId} 上传已在后台开始。任务列表里会显示进度。`, true);
    await apiRequest(`/api/publish/${platformId}/${id}`, { method: "POST" });
    await loadServerState();
    pollPlatformTask(id, platformId);
  } catch (error) {
    setAiHelper(`${platform?.name || platformId} 发布失败：${error.message}`);
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
        setAiHelper(`${platform?.name || platformId} 发布完成：${result.url || result.videoId || result.publishId || result.postId || "已提交"}`);
        return;
      }
      if (result?.status === "failed") {
        setAiHelper(`${platform?.name || platformId} 发布失败：${result.error}`);
        return;
      }
      if (attempt >= 240) {
        setAiHelper(`${platform?.name || platformId} 上传仍在进行。你可以继续看任务历史里的最新进度。`);
        return;
      }
      const progress = Number(result?.progress || 0);
      const detail = progress ? ` · ${progress}%` : "";
      setAiHelper(`${platform?.name || platformId} 上传中${detail} · 已运行约 ${Math.round(((attempt + 1) * 3) / 60)} 分钟`, true);
      pollPlatformTask(id, platformId, attempt + 1);
    } catch (error) {
      setAiHelper(`刷新发布状态失败：${error.message}`);
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
    node.querySelector("p").textContent = connected ? `已连接：${serverChannel.displayName || platform.name}` : channelConnectionText(platform.id);
    node.querySelector(".channel-state").textContent = connected ? "已连接" : "待连接";
    node.querySelector(".channel-state").classList.toggle("pending", !connected);
    node.querySelector(".channel-note").textContent = connected ? `授权时间：${formatDate(serverChannel.connectedAt)}` : channelSetupText(platform.id);
    const actionButton = node.querySelector(".tiny-button");
    actionButton.textContent = connected ? "断开连接" : channelActionText(platform.id);
    const select = node.querySelector("select");
    const channelOptions = connected && serverChannel.displayName ? [serverChannel.displayName] : platform.channels;
    channelOptions.forEach((channel) => {
      const option = document.createElement("option");
      option.textContent = channel;
      select.appendChild(option);
    });
    const checkbox = node.querySelector('input[type="checkbox"]');
    checkbox.checked = connected;
    actionButton.disabled = platform.id === "twitter";
    actionButton.addEventListener("click", async () => {
      if (connected) {
        await disconnectChannel(platform.id, platform.name);
        return;
      }
      if (platform.id === "youtube") window.location.href = "/auth/youtube";
      if (platform.id === "instagram") window.location.href = "/auth/instagram";
      if (platform.id === "tiktok") window.location.href = "/auth/tiktok";
    });
    channelGrid.appendChild(node);
  });
  updateChannelSummary();
}

async function disconnectChannel(platformId, platformName) {
  try {
    await apiRequest(`/api/channels/${platformId}`, { method: "DELETE" });
    await loadServerState();
    setAiHelper(`${platformName} 已断开。现在可以重新连接并录制完整流程。`);
  } catch (error) {
    setAiHelper(`${platformName} 断开失败：${error.message}`);
  }
}

function channelConnectionText(platformId) {
  if (platformId === "youtube") return "可连接 Google OAuth";
  if (platformId === "instagram") return "可连接 Meta OAuth";
  if (platformId === "tiktok") return "可连接 TikTok OAuth";
  return "待接入 OAuth 配置";
}

function channelSetupText(platformId) {
  if (platformId === "youtube") return "需要 Google Client ID / Secret";
  if (platformId === "instagram") return "需要 Meta App ID / Secret，且账号为 Business/Creator";
  if (platformId === "tiktok") return "需要 TikTok Client Key / Secret 和 Content Posting API 权限";
  return "下一阶段接入";
}

function channelActionText(platformId) {
  if (platformId === "youtube") return "连接 YouTube";
  if (platformId === "instagram") return "连接 Instagram";
  if (platformId === "tiktok") return "连接 TikTok";
  return "待接入";
}

function updateChannelSummary() {
  const connected = [...document.querySelectorAll(".channel-card")].filter((card) => card.dataset.connected === "true").length;
  document.querySelector("#connectedCount").textContent = `${connected} / ${platforms.length}`;
  document.querySelector("#channelNeeds").textContent = `${platforms.length - connected} 项`;
  document.querySelector("#defaultPublishCount").textContent = `${connected} 个频道`;
  document.querySelector("#sidebarConnected").textContent = `${connected} 个频道在线`;
  document.querySelector("#sidebarMode").textContent = connected ? "可发布到已连接频道" : "本地工作台";
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

document.querySelector("#applyCaption").addEventListener("click", applyMasterCaption);
document.querySelector("#aiOptimizeAll").addEventListener("click", optimizeAllCards);
document.querySelector("#clearCaptions").addEventListener("click", () => {
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
  document.querySelector("#summaryReady").textContent = "保存中";
  apiRequest("/api/draft", { method: "POST", body: JSON.stringify(buildDraftPayload()) })
    .then(() => {
      document.querySelector("#summaryReady").textContent = "草稿已保存";
      loadServerState();
      window.setTimeout(updateSummary, 1400);
    })
    .catch((error) => {
      document.querySelector("#summaryReady").textContent = "保存失败";
      setAiHelper(`草稿保存失败：${error.message}`);
    });
});
document.querySelector("#scheduleAt").addEventListener("input", updateSummary);

document.querySelectorAll(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.mode = button.dataset.mode;
    scheduleRow.classList.toggle("visible", state.mode === "schedule");
    updateSummary();
  });
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

["#assetSearch", "#assetStatus", "#assetRatio"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", renderAssets);
});

document.querySelector("#librarySelectAll").addEventListener("click", () => {
  assets.forEach((asset) => state.selectedAssets.add(asset.id));
  renderAssets();
});

document.querySelector("#libraryUseSelected").addEventListener("click", () => {
  const asset = assets.find((item) => state.selectedAssets.has(item.id)) || assets[0];
  if (!asset) return;
  useAsset(asset);
  if (state.selectedAssets.size > 1) document.querySelector("#summaryVideo").textContent = `${state.selectedAssets.size} 个素材已选择`;
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
