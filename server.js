import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { openSync, readSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join, normalize, relative } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dataDir = join(root, "data");
const uploadDir = join(root, "uploads");
const dbPath = join(dataDir, "db.json");
const env = await loadEnv();
const port = Number(env.PORT || 4173);
const host = env.HOST || "127.0.0.1";
const localUserId = env.LOCAL_USER_ID || "local-owner";
const appBaseUrl = env.APP_BASE_URL || `http://127.0.0.1:${port}`;
const youtubeRedirectUri = `${appBaseUrl}/auth/youtube/callback`;
const instagramRedirectUri = `${appBaseUrl}/auth/instagram/callback`;
const tiktokRedirectUri = `${appBaseUrl}/auth/tiktok/callback`;
const outboundProxy = env.OUTBOUND_PROXY_URL || env.GOOGLE_PROXY_URL || "";
const execFileAsync = promisify(execFile);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

await ensureStorage();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/health") return sendJson(res, { ok: true, userId: localUserId });
    if (url.pathname === "/api/state" && req.method === "GET") return sendJson(res, publicDb(await readDb()));
    if (url.pathname === "/api/channels" && req.method === "GET") return sendJson(res, publicChannels((await readDb()).channels));
    if (url.pathname === "/auth/youtube" && req.method === "GET") return startYouTubeAuth(res);
    if (url.pathname === "/auth/youtube/callback" && req.method === "GET") return finishYouTubeAuth(url, res);
    if (url.pathname === "/auth/instagram" && req.method === "GET") return startInstagramAuth(res);
    if (url.pathname === "/auth/instagram/callback" && req.method === "GET") return finishInstagramAuth(url, res);
    if (url.pathname === "/auth/tiktok" && req.method === "GET") return startTikTokAuth(res);
    if (url.pathname === "/auth/tiktok/callback" && req.method === "GET") return finishTikTokAuth(url, res);
    if (url.pathname === "/api/draft" && req.method === "POST") return saveDraft(req, res);
    if (url.pathname.startsWith("/api/drafts/") && req.method === "DELETE") return deleteDraft(url, res);
    if (url.pathname === "/api/uploads" && req.method === "POST") return uploadVideo(req, res);
    if (url.pathname.startsWith("/api/assets/") && req.method === "DELETE") return deleteAsset(url, res);
    if (url.pathname === "/api/ai/optimize" && req.method === "POST") return optimizeText(req, res);
    if (url.pathname === "/api/tasks" && req.method === "POST") return saveTask(req, res);
    if (url.pathname.startsWith("/api/tasks/") && req.method === "PATCH") return updateTask(url, req, res);
    if (url.pathname.startsWith("/api/tasks/") && req.method === "DELETE") return deleteTask(url, res);
    if (url.pathname.startsWith("/api/publish/") && req.method === "POST") return publishTaskToPlatform(url, res);
    if (url.pathname.startsWith("/api/youtube/upload/") && req.method === "POST") return uploadTaskToYouTube(url, res);

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message || "Server error" }, 500);
  }
}).listen(port, host, () => {
  console.log(`ClipRelay app running at http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/`);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

async function loadEnv() {
  const values = { ...process.env };
  try {
    const text = await readFile(join(root, ".env"), "utf8");
    text.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const index = trimmed.indexOf("=");
      if (index === -1) return;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      values[key] = value.replace(/^["']|["']$/g, "");
    });
  } catch {
    // .env is optional for local prototype mode.
  }
  return values;
}

async function ensureStorage() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(uploadDir, { recursive: true });
  try {
    await stat(dbPath);
  } catch {
    await writeFile(dbPath, JSON.stringify(defaultDb(), null, 2));
  }
}

function defaultDb() {
  return {
    user: { id: localUserId, name: "Local Owner" },
    assets: [],
    drafts: [],
    tasks: [],
    channels: [],
    oauthStates: {},
    updatedAt: new Date().toISOString(),
  };
}

async function readDb() {
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function writeDb(db) {
  db.updatedAt = new Date().toISOString();
  await writeFile(dbPath, JSON.stringify(db, null, 2));
  return db;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function publicDb(db) {
  return {
    ...db,
    channels: publicChannels(db.channels || []),
    oauthStates: undefined,
  };
}

function publicChannels(channels = []) {
  return channels.map(({ accessToken, refreshToken, ...channel }) => ({
    ...channel,
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
  }));
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const target = normalize(join(root, requested));
  if (!relative(root, target).startsWith("..")) {
    try {
      const file = await readFile(target);
      res.writeHead(200, { "content-type": mimeTypes[extname(target)] || "application/octet-stream" });
      res.end(file);
      return;
    } catch {
      // Fall through to 404.
    }
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function missingGoogleCredentials() {
  return !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET;
}

function missingInstagramCredentials() {
  return !env.META_APP_ID || !env.META_APP_SECRET;
}

function missingTikTokCredentials() {
  return !env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET;
}

async function startYouTubeAuth(res) {
  if (missingGoogleCredentials()) {
    return sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>需要配置 Google OAuth</h1>
        <p>请在 <code>.env</code> 中填入 <code>GOOGLE_CLIENT_ID</code> 和 <code>GOOGLE_CLIENT_SECRET</code>。</p>
        <p>Google Cloud Console 里的 Authorized redirect URI 请填写：</p>
        <pre style="background:#f2f4f3;padding:12px;border-radius:8px">${youtubeRedirectUri}</pre>
        <p><a href="/">返回 ClipRelay</a></p>
      </main>`,
      400,
    );
  }

  const db = await readDb();
  const state = crypto.randomUUID();
  db.oauthStates = { ...(db.oauthStates || {}), youtube: state };
  await writeDb(db);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", youtubeRedirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly");
  authUrl.searchParams.set("state", state);

  res.writeHead(302, { location: authUrl.toString() });
  res.end();
}

async function finishYouTubeAuth(url, res) {
  try {
    const googleError = url.searchParams.get("error");
    const googleErrorDescription = url.searchParams.get("error_description");
    if (googleError) {
      return sendAuthError(res, `Google 授权失败：${googleError}`, googleErrorDescription || "请确认测试用户、scope 和 OAuth 配置。");
    }

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code) return sendAuthError(res, "Google 没有返回授权 code。", "请重新从频道连接页发起授权。");

    const db = await readDb();
    if (!returnedState || returnedState !== db.oauthStates?.youtube) {
      return sendAuthError(res, "OAuth state 校验失败。", "请回到 ClipRelay 重新点击连接 YouTube。");
    }

    const tokenData = await exchangeGoogleCode(code);
    const channelProfile = await fetchYouTubeChannel(tokenData.access_token);
    const channel = {
      id: "youtube",
      provider: "youtube",
      connected: true,
      displayName: channelProfile.title || "YouTube Channel",
      externalId: channelProfile.id || "",
      thumbnail: channelProfile.thumbnail || "",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
      scopes: tokenData.scope || "",
      connectedAt: new Date().toISOString(),
    };
    upsertChannel(db, channel);
    db.oauthStates.youtube = undefined;
    await writeDb(db);

    sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>YouTube 已连接</h1>
        <p>已连接频道：<strong>${escapeHtml(channel.displayName)}</strong></p>
        <p><a href="/">返回 ClipRelay</a></p>
      </main>`,
    );
  } catch (error) {
    console.error("YouTube OAuth callback failed:", error);
    sendAuthError(res, "YouTube 连接失败", error.message || "未知错误");
  }
}

async function startInstagramAuth(res) {
  if (missingInstagramCredentials()) {
    return sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>需要配置 Meta OAuth</h1>
        <p>请在 <code>.env</code> 中填入 <code>META_APP_ID</code> 和 <code>META_APP_SECRET</code>。</p>
        <p>Meta App 的 Valid OAuth Redirect URI 请填写：</p>
        <pre style="background:#f2f4f3;padding:12px;border-radius:8px">${instagramRedirectUri}</pre>
        <p><a href="/">返回 ClipRelay</a></p>
      </main>`,
      400,
    );
  }

  const db = await readDb();
  const state = crypto.randomUUID();
  db.oauthStates = { ...(db.oauthStates || {}), instagram: state };
  await writeDb(db);

  const authUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  authUrl.searchParams.set("client_id", env.META_APP_ID);
  authUrl.searchParams.set("redirect_uri", instagramRedirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish,business_management");

  res.writeHead(302, { location: authUrl.toString() });
  res.end();
}

async function finishInstagramAuth(url, res) {
  try {
    const metaError = url.searchParams.get("error");
    const metaErrorDescription = url.searchParams.get("error_description");
    if (metaError) return sendAuthError(res, `Instagram 授权失败：${metaError}`, metaErrorDescription || "请确认 Meta App 权限和测试用户。");

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code) return sendAuthError(res, "Meta 没有返回授权 code。", "请重新从频道连接页发起授权。");

    const db = await readDb();
    if (!returnedState || returnedState !== db.oauthStates?.instagram) {
      return sendAuthError(res, "OAuth state 校验失败。", "请回到 ClipRelay 重新点击连接 Instagram。");
    }

    const tokenData = await exchangeInstagramCode(code);
    const profile = await fetchInstagramProfile(tokenData.access_token);
    const channel = {
      id: "instagram",
      provider: "instagram",
      connected: true,
      displayName: profile.displayName || "Instagram Account",
      externalId: profile.instagramBusinessAccountId || "",
      pageId: profile.pageId || "",
      pageName: profile.pageName || "",
      pageAccessToken: profile.pageAccessToken || "",
      accessToken: tokenData.access_token,
      expiresAt: tokenData.expires_in ? Date.now() + Number(tokenData.expires_in) * 1000 : undefined,
      scopes: tokenData.scope || "",
      connectedAt: new Date().toISOString(),
    };
    upsertChannel(db, channel);
    db.oauthStates.instagram = undefined;
    await writeDb(db);

    sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>Instagram 已连接</h1>
        <p>已连接账号：<strong>${escapeHtml(channel.displayName)}</strong></p>
        <p><a href="/">返回 ClipRelay</a></p>
      </main>`,
    );
  } catch (error) {
    console.error("Instagram OAuth callback failed:", error);
    sendAuthError(res, "Instagram 连接失败", error.message || "未知错误");
  }
}

async function startTikTokAuth(res) {
  if (missingTikTokCredentials()) {
    return sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>需要配置 TikTok OAuth</h1>
        <p>请在 <code>.env</code> 中填入 <code>TIKTOK_CLIENT_KEY</code> 和 <code>TIKTOK_CLIENT_SECRET</code>。</p>
        <p>TikTok App 的 Redirect URI 请填写：</p>
        <pre style="background:#f2f4f3;padding:12px;border-radius:8px">${tiktokRedirectUri}</pre>
        <p><a href="/">返回 ClipRelay</a></p>
      </main>`,
      400,
    );
  }

  const db = await readDb();
  const state = crypto.randomUUID();
  const verifier = createPkceVerifier();
  db.oauthStates = { ...(db.oauthStates || {}), tiktok: state, tiktokVerifier: verifier };
  await writeDb(db);

  const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authUrl.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY);
  authUrl.searchParams.set("redirect_uri", tiktokRedirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "user.info.basic,video.upload,video.publish");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", pkceChallenge(verifier));
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.writeHead(302, { location: authUrl.toString() });
  res.end();
}

async function finishTikTokAuth(url, res) {
  try {
    const tiktokError = url.searchParams.get("error");
    const tiktokErrorDescription = url.searchParams.get("error_description");
    if (tiktokError) return sendAuthError(res, `TikTok 授权失败：${tiktokError}`, tiktokErrorDescription || "请确认 TikTok App 权限和测试用户。");

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code) return sendAuthError(res, "TikTok 没有返回授权 code。", "请重新从频道连接页发起授权。");

    const db = await readDb();
    if (!returnedState || returnedState !== db.oauthStates?.tiktok) {
      return sendAuthError(res, "OAuth state 校验失败。", "请回到 ClipRelay 重新点击连接 TikTok。");
    }

    const tokenData = await exchangeTikTokCode(code, db.oauthStates.tiktokVerifier);
    const profile = await fetchTikTokProfile(tokenData.access_token);
    const channel = {
      id: "tiktok",
      provider: "tiktok",
      connected: true,
      displayName: profile.display_name || profile.username || "TikTok Account",
      externalId: profile.open_id || "",
      avatarUrl: profile.avatar_url || "",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + Number(tokenData.expires_in || 86400) * 1000,
      scopes: tokenData.scope || "",
      connectedAt: new Date().toISOString(),
    };
    upsertChannel(db, channel);
    db.oauthStates.tiktok = undefined;
    db.oauthStates.tiktokVerifier = undefined;
    await writeDb(db);

    sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>TikTok 已连接</h1>
        <p>已连接账号：<strong>${escapeHtml(channel.displayName)}</strong></p>
        <p><a href="/">返回 ClipRelay</a></p>
      </main>`,
    );
  } catch (error) {
    console.error("TikTok OAuth callback failed:", error);
    sendAuthError(res, "TikTok 连接失败", error.message || "未知错误");
  }
}

function sendAuthError(res, title, detail) {
  sendHtml(
    res,
    `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:820px">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
      <p>你可以回到 ClipRelay 后重新点击连接。</p>
      <p><a href="/">返回 ClipRelay</a></p>
    </main>`,
    400,
  );
}

async function exchangeGoogleCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: youtubeRedirectUri,
    grant_type: "authorization_code",
  });
  if (env.GOOGLE_PROXY_URL) {
    return curlJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: ["content-type: application/x-www-form-urlencoded"],
      body: body.toString(),
    });
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function exchangeInstagramCode(code) {
  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri: instagramRedirectUri,
    code,
  });
  return requestJson(`https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`);
}

async function fetchInstagramProfile(userAccessToken) {
  const accounts = await requestJson(
    `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(userAccessToken)}`,
  );
  const page = accounts.data?.find((item) => item.instagram_business_account) || accounts.data?.[0];
  if (!page?.instagram_business_account?.id) {
    throw new Error("没有找到已连接的 Instagram Business/Creator 账号。请确认 Facebook Page 已绑定 Instagram 专业账号。");
  }
  const ig = page.instagram_business_account;
  return {
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token,
    instagramBusinessAccountId: ig.id,
    displayName: ig.username || ig.name || page.name,
    thumbnail: ig.profile_picture_url || "",
  };
}

async function exchangeTikTokCode(code, verifier) {
  const body = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    client_secret: env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: tiktokRedirectUri,
    code_verifier: verifier || "",
  });
  return requestJson("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

async function fetchTikTokProfile(accessToken) {
  const data = await requestJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return data.data?.user || {};
}

function createPkceVerifier() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
}

function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function fetchYouTubeChannel(accessToken) {
  if (env.GOOGLE_PROXY_URL) {
    const data = await curlJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: [`authorization: Bearer ${accessToken}`],
    });
    const item = data.items?.[0];
    return {
      id: item?.id,
      title: item?.snippet?.title,
      thumbnail: item?.snippet?.thumbnails?.default?.url,
    };
  }

  const response = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return {};
  const data = await response.json();
  const item = data.items?.[0];
  return {
    id: item?.id,
    title: item?.snippet?.title,
    thumbnail: item?.snippet?.thumbnails?.default?.url,
  };
}

async function curlJson(url, { method = "GET", headers = [], body = "" } = {}) {
  const args = ["--silent", "--show-error", "--fail", "--max-time", "30"];
  if (outboundProxy) args.push("--proxy", outboundProxy);
  if (method !== "GET") args.push("--request", method);
  headers.forEach((header) => args.push("--header", header));
  if (body) args.push("--data", body);
  args.push(url);
  try {
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    const detail = error.stderr || error.stdout || error.message;
    throw new Error(`Google API proxy request failed: ${detail}`);
  }
}

async function curlJsonWithBinaryBody(url, { headers = [], body }) {
  const path = join(tmpdir(), `cliprelay-upload-${crypto.randomUUID()}.bin`);
  await writeFile(path, body);
  const args = ["--silent", "--show-error", "--fail", "--max-time", "900"];
  if (outboundProxy) args.push("--proxy", outboundProxy);
  args.push("--request", "POST");
  headers.forEach((header) => args.push("--header", header));
  args.push("--data-binary", `@${path}`, url);
  try {
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) {
    const detail = error.stderr || error.stdout || error.message;
    throw new Error(`Google upload proxy request failed: ${detail}`);
  } finally {
    try {
      await unlink(path);
    } catch {
      // Temporary file cleanup is best effort.
    }
  }
}

async function curlRaw(url, { method = "GET", headers = [], body = "", binaryPath = "", timeout = 300 } = {}) {
  const headerPath = join(tmpdir(), `cliprelay-curl-headers-${crypto.randomUUID()}.txt`);
  const bodyPath = join(tmpdir(), `cliprelay-curl-body-${crypto.randomUUID()}.txt`);
  const args = [
    "--silent",
    "--show-error",
    "--max-time",
    String(timeout),
    "--request",
    method,
    "--dump-header",
    headerPath,
    "--output",
    bodyPath,
    "--write-out",
    "%{http_code}",
  ];
  if (outboundProxy) args.splice(4, 0, "--proxy", outboundProxy);
  headers.forEach((header) => args.push("--header", header));
  if (binaryPath) args.push("--data-binary", `@${binaryPath}`);
  else if (body) args.push("--data", body);
  args.push(url);

  try {
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 10 * 1024 * 1024 });
    return {
      status: Number(stdout.trim()),
      headers: await readFile(headerPath, "utf8").catch(() => ""),
      body: await readFile(bodyPath, "utf8").catch(() => ""),
    };
  } catch (error) {
    const detail = error.stderr || error.stdout || error.message;
    throw new Error(`Google upload proxy request failed: ${detail}`);
  } finally {
    await Promise.all([
      unlink(headerPath).catch(() => {}),
      unlink(bodyPath).catch(() => {}),
    ]);
  }
}

async function requestJson(url, { method = "GET", headers = {}, body = "" } = {}) {
  const headerEntries = Object.entries(headers);
  if (outboundProxy) {
    const response = await curlRaw(url, {
      method,
      headers: headerEntries.map(([key, value]) => `${key}: ${value}`),
      body,
      timeout: 60,
    });
    const data = response.body ? JSON.parse(response.body) : {};
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`API request failed: ${response.status} ${response.body}`);
    }
    return data;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body || undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`API request failed: ${response.status} ${text}`);
  return data;
}

function latestHeaderValue(headers, name) {
  const matches = [...headers.matchAll(new RegExp(`(?:^|\\r?\\n)${name}:\\s*([^\\r\\n]+)`, "gi"))];
  return matches.at(-1)?.[1]?.trim() || "";
}

function upsertChannel(db, channel) {
  db.channels = db.channels || [];
  const index = db.channels.findIndex((item) => item.id === channel.id);
  if (index >= 0) db.channels[index] = { ...db.channels[index], ...channel };
  else db.channels.unshift(channel);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

async function saveDraft(req, res) {
  const payload = await readJson(req);
  const db = await readDb();
  const draft = {
    id: payload.id || crypto.randomUUID(),
    userId: localUserId,
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  const index = db.drafts.findIndex((item) => item.id === draft.id);
  if (index >= 0) db.drafts[index] = draft;
  else db.drafts.unshift(draft);
  await writeDb(db);
  sendJson(res, { ok: true, draft });
}

async function saveTask(req, res) {
  const payload = await readJson(req);
  const db = await readDb();
  const task = {
    id: crypto.randomUUID(),
    userId: localUserId,
    status: "queued",
    createdAt: new Date().toISOString(),
    ...payload,
  };
  db.tasks.unshift(task);
  await writeDb(db);
  sendJson(res, { ok: true, task });
}

async function deleteDraft(url, res) {
  const id = decodeURIComponent(url.pathname.split("/").at(-1));
  const db = await readDb();
  const before = db.drafts.length;
  db.drafts = db.drafts.filter((draft) => draft.id !== id);
  await writeDb(db);
  sendJson(res, { ok: db.drafts.length < before });
}

async function updateTask(url, req, res) {
  const id = decodeURIComponent(url.pathname.split("/").at(-1));
  const payload = await readJson(req);
  const db = await readDb();
  const task = db.tasks.find((item) => item.id === id);
  if (!task) return sendJson(res, { error: "Task not found" }, 404);
  Object.assign(task, payload, { updatedAt: new Date().toISOString() });
  await writeDb(db);
  sendJson(res, { ok: true, task });
}

async function deleteTask(url, res) {
  const id = decodeURIComponent(url.pathname.split("/").at(-1));
  const db = await readDb();
  const before = db.tasks.length;
  db.tasks = db.tasks.filter((task) => task.id !== id);
  await writeDb(db);
  sendJson(res, { ok: db.tasks.length < before });
}

async function uploadTaskToYouTube(url, res) {
  const taskId = decodeURIComponent(url.pathname.split("/").at(-1));
  const db = await readDb();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return sendJson(res, { error: "Task not found" }, 404);
  const channel = db.channels?.find((item) => item.id === "youtube" && item.connected);
  if (!channel) return sendJson(res, { error: "YouTube is not connected" }, 400);
  if (!task.asset?.filename) return sendJson(res, { error: "This task has no uploaded local video file" }, 400);

  const youtubeCopy = task.platforms?.find((item) => item.id === "youtube");
  if (!youtubeCopy) return sendJson(res, { error: "This task does not include YouTube" }, 400);
  if (task.status === "publishing") return sendJson(res, { ok: true, accepted: true, task });

  task.status = "publishing";
  task.publishResults = {
    ...(task.publishResults || {}),
    youtube: { status: "publishing", progress: 0, uploadedBytes: 0, totalBytes: task.asset.size || 0, startedAt: new Date().toISOString() },
  };
  await writeDb(db);
  runYouTubeUpload(taskId).catch((error) => console.error("Background YouTube upload failed:", error));
  sendJson(res, { ok: true, accepted: true, task });
}

async function publishTaskToPlatform(url, res) {
  const parts = url.pathname.split("/");
  const platform = parts.at(-2);
  const taskId = decodeURIComponent(parts.at(-1));
  if (platform === "youtube") return uploadTaskToYouTube(new URL(`/api/youtube/upload/${taskId}`, appBaseUrl), res);
  if (!["instagram", "tiktok"].includes(platform)) return sendJson(res, { error: "Unsupported platform" }, 400);

  const db = await readDb();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return sendJson(res, { error: "Task not found" }, 404);
  const channel = db.channels?.find((item) => item.id === platform && item.connected);
  if (!channel) return sendJson(res, { error: `${platform} is not connected` }, 400);
  if (!task.asset?.filename) return sendJson(res, { error: "This task has no uploaded local video file" }, 400);
  const platformCopy = task.platforms?.find((item) => item.id === platform);
  if (!platformCopy) return sendJson(res, { error: `This task does not include ${platform}` }, 400);
  if (task.publishResults?.[platform]?.status === "publishing") return sendJson(res, { ok: true, accepted: true, task });

  task.status = "publishing";
  task.publishResults = {
    ...(task.publishResults || {}),
    [platform]: { status: "publishing", progress: 0, uploadedBytes: 0, totalBytes: task.asset.size || 0, startedAt: new Date().toISOString() },
  };
  await writeDb(db);
  runPlatformUpload(platform, taskId).catch((error) => console.error(`Background ${platform} upload failed:`, error));
  sendJson(res, { ok: true, accepted: true, task });
}

async function runPlatformUpload(platform, taskId) {
  if (platform === "instagram") return runInstagramUpload(taskId);
  if (platform === "tiktok") return runTikTokUpload(taskId);
}

async function runYouTubeUpload(taskId) {
  const db = await readDb();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const channel = db.channels?.find((item) => item.id === "youtube" && item.connected);
  if (!channel) throw new Error("YouTube is not connected");
  const youtubeCopy = task.platforms?.find((item) => item.id === "youtube");
  try {
    const freshChannel = await ensureYouTubeAccessToken(db, channel);
    const assetPath = join(uploadDir, task.asset.filename);
    const result = await uploadVideoToYouTube({
      accessToken: freshChannel.accessToken,
      assetPath,
      mimeType: task.asset.mimeType || "video/mp4",
      title: youtubeCopy.title || task.title || "ClipRelay upload",
      description: youtubeCopy.caption || task.masterCaption || "",
      onProgress: (progress) => updatePlatformTaskProgress(taskId, "youtube", progress),
    });

    await updatePlatformTaskProgress(taskId, "youtube", {
      status: "published",
      progress: 100,
      videoId: result.id,
      url: result.id ? `https://www.youtube.com/watch?v=${result.id}` : "",
      raw: result,
      publishedAt: new Date().toISOString(),
      taskStatus: "published",
    });
  } catch (error) {
    await updatePlatformTaskProgress(taskId, "youtube", {
      status: "failed",
      error: youtubeUploadErrorMessage(error),
      failedAt: new Date().toISOString(),
      taskStatus: "failed",
    });
  }
}

function youtubeUploadErrorMessage(error) {
  if (error?.code === "ENOENT" || /no such file or directory/i.test(error?.message || "")) {
    return "本地视频文件不存在了。请重新上传这个视频，再创建一次发布任务。";
  }
  return error?.message || "YouTube upload failed";
}

async function runInstagramUpload(taskId) {
  const db = await readDb();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const channel = db.channels?.find((item) => item.id === "instagram" && item.connected);
  const copy = task.platforms?.find((item) => item.id === "instagram");
  try {
    if (!channel?.externalId) throw new Error("Instagram channel is missing Business Account ID. Please reconnect Instagram.");
    if (!env.PUBLIC_ASSET_BASE_URL) {
      throw new Error("Instagram Reels 发布需要公网 HTTPS 视频地址。请配置 PUBLIC_ASSET_BASE_URL，例如 Cloudflare Tunnel / S3 / R2 地址。");
    }
    const videoUrl = `${env.PUBLIC_ASSET_BASE_URL.replace(/\/$/, "")}${task.asset.url}`;
    await updatePlatformTaskProgress(taskId, "instagram", { status: "publishing", progress: 5, note: "已提交 Reels 创建容器" });
    const token = channel.pageAccessToken || channel.accessToken;
    const createBody = new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption: copy.caption || task.masterCaption || "",
      share_to_feed: "true",
      access_token: token,
    });
    const container = await requestJson(`https://graph.facebook.com/v19.0/${channel.externalId}/media`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: createBody.toString(),
    });
    await waitForInstagramContainer(container.id, token, (progress) => updatePlatformTaskProgress(taskId, "instagram", progress));
    const publishBody = new URLSearchParams({ creation_id: container.id, access_token: token });
    const published = await requestJson(`https://graph.facebook.com/v19.0/${channel.externalId}/media_publish`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: publishBody.toString(),
    });
    await updatePlatformTaskProgress(taskId, "instagram", {
      status: "published",
      progress: 100,
      postId: published.id || "",
      url: published.id ? `https://www.instagram.com/p/${published.id}/` : "",
      raw: published,
      publishedAt: new Date().toISOString(),
      taskStatus: "published",
    });
  } catch (error) {
    await updatePlatformTaskProgress(taskId, "instagram", {
      status: "failed",
      error: youtubeUploadErrorMessage(error),
      failedAt: new Date().toISOString(),
      taskStatus: "failed",
    });
  }
}

async function waitForInstagramContainer(containerId, accessToken, onProgress) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const status = await requestJson(
      `https://graph.facebook.com/v19.0/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (status.status_code === "FINISHED") {
      await onProgress?.({ status: "publishing", progress: 85, note: "Reels 容器已处理完成" });
      return;
    }
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Instagram container failed: ${status.status || status.status_code}`);
    }
    await onProgress?.({ status: "publishing", progress: Math.min(80, 10 + attempt * 3), note: status.status || status.status_code || "处理中" });
    await delay(5000);
  }
  throw new Error("Instagram container processing timed out");
}

async function runTikTokUpload(taskId) {
  const db = await readDb();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const channel = db.channels?.find((item) => item.id === "tiktok" && item.connected);
  const copy = task.platforms?.find((item) => item.id === "tiktok");
  try {
    if (!channel?.accessToken) throw new Error("TikTok channel is missing access token. Please reconnect TikTok.");
    const assetPath = join(uploadDir, task.asset.filename);
    const fileStat = await stat(assetPath);
    const totalBytes = fileStat.size;
    const chunkSize = Math.min(8 * 1024 * 1024, totalBytes);
    const totalChunkCount = Math.ceil(totalBytes / chunkSize);
    await updatePlatformTaskProgress(taskId, "tiktok", { status: "publishing", progress: 0, uploadedBytes: 0, totalBytes });
    const init = await requestJson("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        authorization: `Bearer ${channel.accessToken}`,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: compactForPlatform(copy.caption || copy.title || task.masterCaption || task.title || "New video", 2200),
          privacy_level: env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: totalBytes,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
      }),
    });
    const uploadUrl = init.data?.upload_url || init.upload_url;
    const publishId = init.data?.publish_id || init.publish_id;
    if (!uploadUrl || !publishId) throw new Error(`TikTok did not return upload_url/publish_id: ${JSON.stringify(init)}`);
    await uploadGenericChunksWithCurl({
      uploadUrl,
      assetPath,
      mimeType: task.asset.mimeType || "video/mp4",
      totalBytes,
      chunkSize,
      onProgress: (progress) => updatePlatformTaskProgress(taskId, "tiktok", progress),
    });
    await updatePlatformTaskProgress(taskId, "tiktok", {
      status: "published",
      progress: 100,
      publishId,
      raw: init,
      publishedAt: new Date().toISOString(),
      taskStatus: "published",
    });
  } catch (error) {
    await updatePlatformTaskProgress(taskId, "tiktok", {
      status: "failed",
      error: youtubeUploadErrorMessage(error),
      failedAt: new Date().toISOString(),
      taskStatus: "failed",
    });
  }
}

async function uploadGenericChunksWithCurl({ uploadUrl, assetPath, mimeType, totalBytes, chunkSize, onProgress }) {
  const fd = openSync(assetPath, "r");
  let uploadedBytes = 0;
  try {
    while (uploadedBytes < totalBytes) {
      const start = uploadedBytes;
      const end = Math.min(start + chunkSize, totalBytes) - 1;
      const size = end - start + 1;
      const buffer = Buffer.alloc(size);
      const bytesRead = readSync(fd, buffer, 0, size, start);
      const chunkPath = join(tmpdir(), `cliprelay-platform-chunk-${crypto.randomUUID()}.bin`);
      await writeFile(chunkPath, buffer.subarray(0, bytesRead));
      try {
        const response = await curlRaw(uploadUrl, {
          method: "PUT",
          timeout: 300,
          headers: [
            `content-length: ${bytesRead}`,
            `content-type: ${mimeType}`,
            `content-range: bytes ${start}-${start + bytesRead - 1}/${totalBytes}`,
          ],
          binaryPath: chunkPath,
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Chunk upload failed: ${response.status} ${response.body}`);
        }
        uploadedBytes = start + bytesRead;
        await onProgress?.(youtubeProgress(uploadedBytes, totalBytes));
      } finally {
        await unlink(chunkPath).catch(() => {});
      }
    }
  } finally {
    closeSync(fd);
  }
}

function compactForPlatform(value, limit) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > limit ? clean.slice(0, limit - 1) : clean;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updatePlatformTaskProgress(taskId, platform, patch) {
  const db = await readDb();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const { taskStatus, ...resultPatch } = patch;
  task.publishResults = {
    ...(task.publishResults || {}),
    [platform]: {
      ...(task.publishResults?.[platform] || {}),
      ...resultPatch,
      updatedAt: new Date().toISOString(),
    },
  };
  if (taskStatus) task.status = taskStatus;
  task.updatedAt = new Date().toISOString();
  await writeDb(db);
}

async function ensureYouTubeAccessToken(db, channel) {
  if (channel.accessToken && Number(channel.expiresAt || 0) > Date.now() + 60_000) return channel;
  if (!channel.refreshToken) throw new Error("Missing YouTube refresh token. Please reconnect YouTube.");
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: channel.refreshToken,
    grant_type: "refresh_token",
  });
  const tokenData = env.GOOGLE_PROXY_URL
    ? await curlJson("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: ["content-type: application/x-www-form-urlencoded"],
        body: body.toString(),
      })
    : await refreshYouTubeTokenWithFetch(body);
  channel.accessToken = tokenData.access_token;
  channel.expiresAt = Date.now() + Number(tokenData.expires_in || 3600) * 1000;
  upsertChannel(db, channel);
  await writeDb(db);
  return channel;
}

async function refreshYouTubeTokenWithFetch(body) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Google token refresh failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function uploadVideoToYouTube({ accessToken, assetPath, mimeType, title, description, onProgress }) {
  const metadata = {
    snippet: {
      title,
      description,
      categoryId: "22",
    },
    status: {
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
    },
  };
  const fileStat = await stat(assetPath);
  const totalBytes = fileStat.size;
  await onProgress?.({ status: "publishing", progress: 0, uploadedBytes: 0, totalBytes });

  if (env.GOOGLE_PROXY_URL) {
    return uploadVideoToYouTubeViaCurl({ accessToken, assetPath, mimeType, metadata, totalBytes, onProgress });
  }

  const sessionResponse = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": mimeType,
      "x-upload-content-length": String(totalBytes),
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(30_000),
  });
  if (!sessionResponse.ok) throw new Error(`YouTube resumable session failed: ${sessionResponse.status} ${await sessionResponse.text()}`);
  const uploadUrl = sessionResponse.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube resumable session did not return an upload URL");
  return uploadVideoChunksWithFetch({ uploadUrl, assetPath, mimeType, totalBytes, onProgress });
}

async function uploadVideoToYouTubeViaCurl({ accessToken, assetPath, mimeType, metadata, totalBytes, onProgress }) {
  const session = await curlRaw("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    timeout: 60,
    headers: [
      `authorization: Bearer ${accessToken}`,
      "content-type: application/json; charset=UTF-8",
      `x-upload-content-type: ${mimeType}`,
      `x-upload-content-length: ${totalBytes}`,
    ],
    body: JSON.stringify(metadata),
  });
  if (session.status < 200 || session.status >= 300) {
    throw new Error(`YouTube resumable session failed: ${session.status} ${session.body}`);
  }
  const uploadUrl = latestHeaderValue(session.headers, "location");
  if (!uploadUrl) throw new Error("YouTube resumable session did not return an upload URL");
  return uploadVideoChunksWithCurl({ uploadUrl, assetPath, mimeType, totalBytes, onProgress });
}

async function uploadVideoChunksWithCurl({ uploadUrl, assetPath, mimeType, totalBytes, onProgress }) {
  const chunkSize = 8 * 1024 * 1024;
  const fd = openSync(assetPath, "r");
  let uploadedBytes = 0;
  try {
    while (uploadedBytes < totalBytes) {
      const start = uploadedBytes;
      const end = Math.min(start + chunkSize, totalBytes) - 1;
      const size = end - start + 1;
      const buffer = Buffer.alloc(size);
      const bytesRead = readSync(fd, buffer, 0, size, start);
      const chunkPath = join(tmpdir(), `cliprelay-youtube-chunk-${crypto.randomUUID()}.bin`);
      await writeFile(chunkPath, buffer.subarray(0, bytesRead));
      try {
        const response = await curlRaw(uploadUrl, {
          method: "PUT",
          timeout: 300,
          headers: [
            `content-length: ${bytesRead}`,
            `content-type: ${mimeType}`,
            `content-range: bytes ${start}-${start + bytesRead - 1}/${totalBytes}`,
          ],
          binaryPath: chunkPath,
        });
        if (response.status === 308) {
          uploadedBytes = start + bytesRead;
          await onProgress?.(youtubeProgress(uploadedBytes, totalBytes));
          continue;
        }
        if (response.status >= 200 && response.status < 300) {
          uploadedBytes = totalBytes;
          await onProgress?.(youtubeProgress(uploadedBytes, totalBytes));
          return JSON.parse(response.body || "{}");
        }
        throw new Error(`YouTube chunk upload failed: ${response.status} ${response.body}`);
      } finally {
        await unlink(chunkPath).catch(() => {});
      }
    }
  } finally {
    closeSync(fd);
  }
  throw new Error("YouTube upload finished without a final video response");
}

async function uploadVideoChunksWithFetch({ uploadUrl, assetPath, mimeType, totalBytes, onProgress }) {
  const chunkSize = 8 * 1024 * 1024;
  const fd = openSync(assetPath, "r");
  let uploadedBytes = 0;
  try {
    while (uploadedBytes < totalBytes) {
      const start = uploadedBytes;
      const end = Math.min(start + chunkSize, totalBytes) - 1;
      const size = end - start + 1;
      const buffer = Buffer.alloc(size);
      const bytesRead = readSync(fd, buffer, 0, size, start);
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "content-length": String(bytesRead),
          "content-type": mimeType,
          "content-range": `bytes ${start}-${start + bytesRead - 1}/${totalBytes}`,
        },
        body: buffer.subarray(0, bytesRead),
        signal: AbortSignal.timeout(300_000),
      });
      if (response.status === 308) {
        uploadedBytes = start + bytesRead;
        await onProgress?.(youtubeProgress(uploadedBytes, totalBytes));
        continue;
      }
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        uploadedBytes = totalBytes;
        await onProgress?.(youtubeProgress(uploadedBytes, totalBytes));
        return data;
      }
      throw new Error(`YouTube chunk upload failed: ${response.status} ${JSON.stringify(data)}`);
    }
  } finally {
    closeSync(fd);
  }
  throw new Error("YouTube upload finished without a final video response");
}

function youtubeProgress(uploadedBytes, totalBytes) {
  return {
    status: "publishing",
    uploadedBytes,
    totalBytes,
    progress: totalBytes ? Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)) : 0,
  };
}

async function uploadVideo(req, res) {
  const contentType = req.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) return sendJson(res, { error: "Missing multipart boundary" }, 400);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const parsed = parseMultipart(buffer, boundary);
  const file = parsed.files.video || parsed.files.file;
  if (!file) return sendJson(res, { error: "Missing video file" }, 400);

  const safeName = file.filename.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const filename = `${Date.now()}-${safeName}`;
  const filePath = join(uploadDir, filename);
  await writeFile(filePath, file.content);

  const db = await readDb();
  const asset = {
    id: crypto.randomUUID(),
    userId: localUserId,
    title: parsed.fields.title || file.filename,
    filename,
    originalName: file.filename,
    mimeType: file.contentType,
    size: file.content.length,
    url: `/uploads/${filename}`,
    status: "ready",
    statusText: "可发布",
    ratio: parsed.fields.ratio || "待检测",
    duration: parsed.fields.duration || "待检测",
    tags: ["本地上传"],
    createdAt: new Date().toISOString(),
  };
  db.assets.unshift(asset);
  await writeDb(db);
  sendJson(res, { ok: true, asset });
}

async function deleteAsset(url, res) {
  const id = decodeURIComponent(url.pathname.split("/").at(-1));
  const db = await readDb();
  const asset = db.assets.find((item) => item.id === id);
  if (!asset) return sendJson(res, { error: "Asset not found" }, 404);
  db.assets = db.assets.filter((item) => item.id !== id);
  await writeDb(db);
  if (asset.filename) {
    try {
      await unlink(join(uploadDir, asset.filename));
    } catch {
      // File may have been removed manually; database deletion should still succeed.
    }
  }
  sendJson(res, { ok: true });
}

function parseMultipart(buffer, boundary) {
  const boundaryText = `--${boundary}`;
  const body = buffer.toString("binary");
  const parts = body.split(boundaryText).slice(1, -1);
  const fields = {};
  const files = {};

  parts.forEach((part) => {
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const splitAt = trimmed.indexOf("\r\n\r\n");
    if (splitAt === -1) return;
    const rawHeaders = trimmed.slice(0, splitAt);
    const contentBinary = trimmed.slice(splitAt + 4);
    const disposition = rawHeaders.match(/content-disposition:\s*form-data;\s*([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    if (!name) return;
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const contentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "application/octet-stream";
    if (filename) {
      files[name] = { filename, contentType, content: Buffer.from(contentBinary, "binary") };
    } else {
      fields[name] = Buffer.from(contentBinary, "binary").toString("utf8");
    }
  });

  return { fields, files };
}

async function optimizeText(req, res) {
  const payload = await readJson(req);
  const base = String(payload.base || "").trim();
  const platform = payload.platform || {};
  if (!base) return sendJson(res, { error: "Missing base text" }, 400);

  if (!env.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY === "your_deepseek_api_key_here") {
    return sendJson(res, {
      ok: true,
      provider: "local-fallback",
      needsApiKey: true,
      result: localRewrite(base, platform),
    });
  }

  const result = await callDeepSeek(base, platform);
  sendJson(res, { ok: true, provider: "deepseek", result });
}

async function callDeepSeek(base, platform) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || "deepseek-chat",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a US/EU social-native short-form video copywriter for creators and product-led brands. Write in natural, idiomatic English by default, even if the source text is Chinese. Do not translate literally. Localize the idea for Western audiences: clear hook, specific benefit, casual but credible tone, no Chinese internet slang, no overhyped sales language, no generic motivational filler. Output only JSON in this exact shape: {\"title\":\"...\",\"caption\":\"...\"}. Adapt the title and caption to the requested platform, its character limit, and hashtag habits.",
        },
        {
          role: "user",
          content: JSON.stringify({
            base,
            platform: platform.name,
            platformId: platform.id,
            limit: platform.limit,
            styleHint: platform.hint,
            hashtagHint: platform.suffix,
            market: "US/EU",
            outputLanguage: "English",
            localizationRules: [
              "Write as a real Western creator or brand account would post.",
              "Use plain, specific language and avoid awkward translated phrasing.",
              "Keep the first line strong enough to stop a scroll.",
              "Use hashtags sparingly and only when platform-appropriate.",
            ],
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return {
    title: String(parsed.title || "").trim(),
    caption: String(parsed.caption || "").trim(),
  };
}

function localRewrite(base, platform) {
  const clean = base.replace(/#[\p{L}\p{N}_-]+/gu, "").replace(/\s+/g, " ").trim();
  const isMostlyChinese = /[\u4e00-\u9fff]/.test(clean);
  const idea = isMostlyChinese
    ? "a tool that helps creators upload once, adapt the copy for each platform, and publish faster"
    : clean;
  const shortIdea = idea.length > 92 ? `${idea.slice(0, 91)}…` : idea;

  if (platform.id === "youtube") {
    return {
      title: "Upload once. Tailor every post.",
      caption: `This is the faster way to turn one video into platform-ready posts.\n\n${shortIdea}\n\nBuilt for creators who would rather spend time making the next clip than rewriting the same caption four times.\n\n${platform.suffix || "#Shorts #YouTubeShorts"}`,
    };
  }
  if (platform.id === "instagram") {
    return {
      title: "One video, four platform-ready captions",
      caption: `If you post the same video everywhere, the caption should not be copy-paste.\n\n${shortIdea}\n\nSmall workflow upgrade, big time saver.\n\n${platform.suffix || "#reels #creator"}`,
    };
  }
  if (platform.id === "tiktok") {
    return {
      title: "Stop rewriting the same caption",
      caption: `Posting should not mean rewriting the same idea four different ways by hand.\n\n${shortIdea}\n\nUpload once, tweak for each platform, move on to the next video.\n\n${platform.suffix || "#fyp #contentcreator"}`,
    };
  }
  return {
    title: "A faster way to repurpose short-form video",
    caption: `One video should not create four separate posting chores.\n\n${shortIdea}\n\nUpload once, adapt the copy for each platform, and keep the workflow moving.\n\n${platform.suffix || "#buildinpublic"}`,
  };
}
