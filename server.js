import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { openSync, readSync, closeSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
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
const twitterRedirectUri = `${appBaseUrl}/auth/twitter/callback`;
const outboundProxy = env.OUTBOUND_PROXY_URL || env.GOOGLE_PROXY_URL || "";
const oauthStateSecret =
  env.OAUTH_STATE_SECRET || env.GOOGLE_CLIENT_SECRET || env.META_APP_SECRET || env.TIKTOK_CLIENT_SECRET || "cliprelay-local-state";
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
    if (url.pathname.startsWith("/api/channels/") && req.method === "DELETE") return deleteChannel(url, res);
    if (url.pathname === "/auth/youtube" && req.method === "GET") return startYouTubeAuth(res);
    if (url.pathname === "/auth/youtube/callback" && req.method === "GET") return finishYouTubeAuth(url, res);
    if (url.pathname === "/auth/instagram" && req.method === "GET") return startInstagramAuth(res);
    if (url.pathname === "/auth/instagram/callback" && req.method === "GET") return finishInstagramAuth(url, res);
    if (url.pathname === "/auth/tiktok" && req.method === "GET") return startTikTokAuth(res);
    if (url.pathname === "/auth/tiktok/callback" && req.method === "GET") return finishTikTokAuth(url, res);
    if (url.pathname === "/auth/twitter" && req.method === "GET") return startTwitterAuth(res);
    if (url.pathname === "/auth/twitter/callback" && req.method === "GET") return finishTwitterAuth(url, res);
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
    oauthPkce: undefined,
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
  return !getInstagramAppId() || !getInstagramAppSecret();
}

function hasMetaConfigId() {
  return Boolean(env.META_CONFIG_ID);
}

function getInstagramAppId() {
  return env.INSTAGRAM_APP_ID || env.META_APP_ID || "";
}

function getInstagramAppSecret() {
  return env.INSTAGRAM_APP_SECRET || env.META_APP_SECRET || "";
}

function getInstagramScopes() {
  return env.INSTAGRAM_SCOPES
    || "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights";
}

function missingTikTokCredentials() {
  return !env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET;
}

function missingTwitterCredentials() {
  return !env.X_CLIENT_ID || !env.X_CLIENT_SECRET;
}

function createOAuthState(provider) {
  const nonce = crypto.randomUUID();
  const issuedAt = Date.now().toString();
  const payload = `${provider}.${issuedAt}.${nonce}`;
  const signature = createHmac("sha256", oauthStateSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyOAuthState(state, provider) {
  const parts = String(state || "").split(".");
  if (parts.length !== 4) return false;
  const [stateProvider, issuedAt, nonce, signature] = parts;
  if (!stateProvider || !issuedAt || !nonce || !signature) return false;
  if (stateProvider !== provider) return false;
  const issuedAtNumber = Number(issuedAt);
  if (!Number.isFinite(issuedAtNumber)) return false;
  if (Math.abs(Date.now() - issuedAtNumber) > 30 * 60 * 1000) return false;
  const payload = `${stateProvider}.${issuedAt}.${nonce}`;
  const expected = createHmac("sha256", oauthStateSecret).update(payload).digest("base64url");
  return expected === signature;
}

async function startYouTubeAuth(res) {
  if (missingGoogleCredentials()) {
    return sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>Google OAuth is required</h1>
        <p>Fill in <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> inside <code>.env</code>.</p>
        <p>Use this Authorized redirect URI in Google Cloud Console:</p>
        <pre style="background:#f2f4f3;padding:12px;border-radius:8px">${youtubeRedirectUri}</pre>
        <p><a href="/">Return to ClipRelay</a></p>
      </main>`,
      400,
    );
  }

  const db = await readDb();
  const state = createOAuthState("youtube");
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
      return sendAuthError(res, `Google authorization failed: ${googleError}`, googleErrorDescription || "Check your test users, scopes, and OAuth configuration.");
    }

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code) return sendAuthError(res, "Google did not return an authorization code.", "Start the connection flow again from the channels screen.");

    const db = await readDb();
    if (!returnedState || (returnedState !== db.oauthStates?.youtube && !verifyOAuthState(returnedState, "youtube"))) {
      return sendAuthError(res, "OAuth state validation failed.", "Return to ClipRelay and try connecting YouTube again.");
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
        <h1>YouTube connected</h1>
        <p>Connected channel: <strong>${escapeHtml(channel.displayName)}</strong></p>
        <p><a href="/">Return to ClipRelay</a></p>
      </main>`,
    );
  } catch (error) {
    console.error("YouTube OAuth callback failed:", error);
    sendAuthError(res, "YouTube connection failed", error.message || "Unknown error");
  }
}

async function startInstagramAuth(res) {
  if (missingInstagramCredentials()) {
    return sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>Instagram OAuth is required</h1>
        <p>Fill in <code>INSTAGRAM_APP_ID</code> and <code>INSTAGRAM_APP_SECRET</code> inside <code>.env</code>.</p>
        <p>The server also accepts <code>META_APP_ID</code> and <code>META_APP_SECRET</code> as a fallback for older setups.</p>
        <p>Use this Valid OAuth Redirect URI in your Meta app:</p>
        <pre style="background:#f2f4f3;padding:12px;border-radius:8px">${instagramRedirectUri}</pre>
        <p><a href="/">Return to ClipRelay</a></p>
      </main>`,
      400,
    );
  }

  const db = await readDb();
  const state = createOAuthState("instagram");
  db.oauthStates = { ...(db.oauthStates || {}), instagram: state };
  await writeDb(db);

  const authUrl = new URL("https://www.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", getInstagramAppId());
  authUrl.searchParams.set("redirect_uri", instagramRedirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("force_reauth", "true");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", getInstagramScopes());

  res.writeHead(302, { location: authUrl.toString() });
  res.end();
}

async function finishInstagramAuth(url, res) {
  try {
    const metaError = url.searchParams.get("error");
    const metaErrorDescription = url.searchParams.get("error_description");
    if (metaError) return sendAuthError(res, `Instagram authorization failed: ${metaError}`, metaErrorDescription || "Check your Meta app permissions and test users.");

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code) return sendAuthError(res, "Meta did not return an authorization code.", "Start the connection flow again from the channels screen.");

    const db = await readDb();
    if (!returnedState || (returnedState !== db.oauthStates?.instagram && !verifyOAuthState(returnedState, "instagram"))) {
      return sendAuthError(res, "OAuth state validation failed.", "Return to ClipRelay and try connecting Instagram again.");
    }

    const tokenData = await exchangeInstagramCode(code);
    const profile = await fetchInstagramProfileSafe(tokenData.access_token, tokenData.user_id);
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
        <h1>Instagram connected</h1>
        <p>Connected account: <strong>${escapeHtml(channel.displayName)}</strong></p>
        <p><a href="/">Return to ClipRelay</a></p>
      </main>`,
    );
  } catch (error) {
    console.error("Instagram OAuth callback failed:", error);
    sendAuthError(res, "Instagram connection failed", error.message || "Unknown error");
  }
}

async function startTikTokAuth(res) {
  if (missingTikTokCredentials()) {
    return sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>TikTok OAuth is required</h1>
        <p>Fill in <code>TIKTOK_CLIENT_KEY</code> and <code>TIKTOK_CLIENT_SECRET</code> inside <code>.env</code>.</p>
        <p>Use this Redirect URI in your TikTok app:</p>
        <pre style="background:#f2f4f3;padding:12px;border-radius:8px">${tiktokRedirectUri}</pre>
        <p><a href="/">Return to ClipRelay</a></p>
      </main>`,
      400,
    );
  }

  const db = await readDb();
  const state = createOAuthState("tiktok");
  db.oauthStates = { ...(db.oauthStates || {}), tiktok: state };
  await writeDb(db);

  const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authUrl.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY);
  authUrl.searchParams.set("redirect_uri", tiktokRedirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "user.info.basic,video.upload,video.publish");
  authUrl.searchParams.set("state", state);

  res.writeHead(302, { location: authUrl.toString() });
  res.end();
}

async function startTwitterAuth(res) {
  if (missingTwitterCredentials()) {
    return sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>X OAuth is required</h1>
        <p>Fill in <code>X_CLIENT_ID</code> and <code>X_CLIENT_SECRET</code> inside <code>.env</code>.</p>
        <p>Use this Callback URI in your X app:</p>
        <pre style="background:#f2f4f3;padding:12px;border-radius:8px">${twitterRedirectUri}</pre>
        <p><a href="/">Return to ClipRelay</a></p>
      </main>`,
      400,
    );
  }

  const db = await readDb();
  const state = createOAuthState("twitter");
  const codeVerifier = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  db.oauthStates = { ...(db.oauthStates || {}), twitter: state };
  db.oauthPkce = { ...(db.oauthPkce || {}), twitter: codeVerifier };
  await writeDb(db);

  const authUrl = new URL("https://x.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", env.X_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", twitterRedirectUri);
  authUrl.searchParams.set("scope", "tweet.read tweet.write users.read offline.access media.write");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.writeHead(302, { location: authUrl.toString() });
  res.end();
}

async function finishTwitterAuth(url, res) {
  try {
    const xError = url.searchParams.get("error");
    const xErrorDescription = url.searchParams.get("error_description");
    if (xError) return sendAuthError(res, `X authorization failed: ${xError}`, xErrorDescription || "Check your X app permissions and callback URL.");

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code) return sendAuthError(res, "X did not return an authorization code.", "Start the connection flow again from the channels screen.");

    const db = await readDb();
    if (!returnedState || (returnedState !== db.oauthStates?.twitter && !verifyOAuthState(returnedState, "twitter"))) {
      return sendAuthError(res, "OAuth state validation failed.", "Return to ClipRelay and try connecting X again.");
    }

    const tokenData = await exchangeTwitterCode(code, db.oauthPkce?.twitter || "");
    const profile = await fetchTwitterProfileSafe(tokenData.access_token);
    const channel = {
      id: "twitter",
      provider: "twitter",
      connected: true,
      displayName: profile.name || profile.username || "X Account",
      externalId: profile.id || "",
      avatarUrl: profile.profile_image_url || "",
      username: profile.username || "",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_in ? Date.now() + Number(tokenData.expires_in) * 1000 : undefined,
      scopes: tokenData.scope || "",
      connectedAt: new Date().toISOString(),
    };
    upsertChannel(db, channel);
    db.oauthStates.twitter = undefined;
    if (db.oauthPkce) db.oauthPkce.twitter = undefined;
    await writeDb(db);

    sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>X connected</h1>
        <p>Connected account: <strong>${escapeHtml(channel.displayName)}</strong></p>
        <p><a href="/">Return to ClipRelay</a></p>
      </main>`,
    );
  } catch (error) {
    console.error("X OAuth callback failed:", error);
    sendAuthError(res, "X connection failed", error.message || "Unknown error");
  }
}

async function finishTikTokAuth(url, res) {
  try {
    const tiktokError = url.searchParams.get("error");
    const tiktokErrorDescription = url.searchParams.get("error_description");
    if (tiktokError) return sendAuthError(res, `TikTok authorization failed: ${tiktokError}`, tiktokErrorDescription || "Check your TikTok app permissions and test users.");

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code) return sendAuthError(res, "TikTok did not return an authorization code.", "Start the connection flow again from the channels screen.");

    const db = await readDb();
    if (!returnedState || (returnedState !== db.oauthStates?.tiktok && !verifyOAuthState(returnedState, "tiktok"))) {
      return sendAuthError(res, "OAuth state validation failed.", "Return to ClipRelay and try connecting TikTok again.");
    }

    const tokenData = await exchangeTikTokCode(code);
    const profile = await fetchTikTokProfileSafe(tokenData.access_token);
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
    await writeDb(db);

    sendHtml(
      res,
      `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:760px">
        <h1>TikTok connected</h1>
        <p>Connected account: <strong>${escapeHtml(channel.displayName)}</strong></p>
        <p><a href="/">Return to ClipRelay</a></p>
      </main>`,
    );
  } catch (error) {
    console.error("TikTok OAuth callback failed:", error);
    sendAuthError(res, "TikTok connection failed", error.message || "Unknown error");
  }
}

function sendAuthError(res, title, detail) {
  sendHtml(
    res,
    `<main style="font-family:system-ui;padding:32px;line-height:1.6;max-width:820px">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
      <p>Return to ClipRelay and try connecting again.</p>
      <p><a href="/">Return to ClipRelay</a></p>
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
  const body = new URLSearchParams({
    client_id: getInstagramAppId(),
    client_secret: getInstagramAppSecret(),
    redirect_uri: instagramRedirectUri,
    code,
    grant_type: "authorization_code",
  });
  return requestJson("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

async function fetchInstagramProfile(userAccessToken) {
  const profile = await requestJson(
    `https://graph.instagram.com/v24.0/me?fields=id,user_id,username,name,profile_picture_url&access_token=${encodeURIComponent(userAccessToken)}`,
  );
  const igUserId = profile.id || profile.user_id;
  if (!igUserId) {
    throw new Error("No Instagram professional account ID was returned. Confirm that you connected a Business or Creator account in Instagram Login.");
  }
  return {
    instagramBusinessAccountId: igUserId,
    displayName: profile.username || profile.name || "Instagram Account",
    thumbnail: profile.profile_picture_url || "",
  };
}

async function fetchInstagramProfileSafe(userAccessToken, fallbackUserId = "") {
  try {
    const profile = await fetchInstagramProfile(userAccessToken);
    if (profile?.instagramBusinessAccountId) return profile;
  } catch (error) {
    console.warn("Instagram profile lookup failed, using fallback profile:", error.message || error);
  }

  if (!fallbackUserId) {
    throw new Error("Instagram authorization succeeded, but no Instagram account ID was returned. Please verify the app permissions and reconnect.");
  }

  return {
    instagramBusinessAccountId: String(fallbackUserId),
    displayName: "Instagram Account",
    thumbnail: "",
  };
}

async function exchangeTikTokCode(code) {
  const body = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    client_secret: env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: tiktokRedirectUri,
  });
  return requestJson("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

async function exchangeTwitterCode(code, codeVerifier) {
  if (!codeVerifier) throw new Error("The X login session expired. Start the connection flow again.");
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: env.X_CLIENT_ID,
    redirect_uri: twitterRedirectUri,
    code_verifier: codeVerifier,
  });
  const basicAuth = Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString("base64");
  return requestJson("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });
}

async function fetchTikTokProfile(accessToken) {
  const data = await requestJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return data.data?.user || {};
}

async function fetchTikTokProfileSafe(accessToken) {
  try {
    return await fetchTikTokProfile(accessToken);
  } catch (error) {
    if (String(error?.message || "").includes("scope_not_authorized")) {
      return {};
    }
    throw error;
  }
}

async function fetchTwitterProfile(accessToken) {
  const data = await requestJson("https://api.x.com/2/users/me?user.fields=profile_image_url,username,name", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return data.data || {};
}

async function fetchTwitterProfileSafe(accessToken) {
  try {
    return await fetchTwitterProfile(accessToken);
  } catch (error) {
    console.warn("X profile lookup failed, using fallback profile:", error.message || error);
    return {};
  }
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

async function curlMultipart(url, { headers = [], fields = {}, fileFieldName = "", filePath = "", timeout = 300 } = {}) {
  const bodyPath = join(tmpdir(), `cliprelay-curl-multipart-${crypto.randomUUID()}.txt`);
  const args = [
    "--silent",
    "--show-error",
    "--max-time",
    String(timeout),
    "--request",
    "POST",
    "--output",
    bodyPath,
    "--write-out",
    "%{http_code}",
  ];
  if (outboundProxy) args.splice(4, 0, "--proxy", outboundProxy);
  headers.forEach((header) => args.push("--header", header));
  Object.entries(fields).forEach(([key, value]) => {
    args.push("--form-string", `${key}=${value}`);
  });
  if (fileFieldName && filePath) {
    args.push("--form", `${fileFieldName}=@${filePath}`);
  }
  args.push(url);

  try {
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 10 * 1024 * 1024 });
    return {
      status: Number(stdout.trim()),
      body: await readFile(bodyPath, "utf8").catch(() => ""),
    };
  } catch (error) {
    const detail = error.stderr || error.stdout || error.message;
    throw new Error(`Multipart upload request failed: ${detail}`);
  } finally {
    await unlink(bodyPath).catch(() => {});
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

async function deleteChannel(url, res) {
  const id = decodeURIComponent(url.pathname.split("/").at(-1));
  const db = await readDb();
  const before = db.channels.length;
  db.channels = db.channels.filter((channel) => channel.id !== id);
  if (db.oauthStates && id in db.oauthStates) db.oauthStates[id] = undefined;
  if (db.oauthPkce && id in db.oauthPkce) db.oauthPkce[id] = undefined;
  await writeDb(db);
  sendJson(res, { ok: db.channels.length < before });
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
  if (!["instagram", "tiktok", "twitter"].includes(platform)) return sendJson(res, { error: "Unsupported platform" }, 400);

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
  if (platform === "twitter") return runTwitterUpload(taskId);
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
    return "The local video file no longer exists. Re-upload the video and create the publish task again.";
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
    if (!channel?.externalId) throw new Error("Instagram channel is missing the Instagram account ID. Please reconnect Instagram.");
    if (!env.PUBLIC_ASSET_BASE_URL) {
      throw new Error("Instagram Reels publishing requires a public HTTPS video URL. Set PUBLIC_ASSET_BASE_URL, such as a Cloudflare Tunnel, S3, or R2 URL.");
    }
    const videoUrl = `${env.PUBLIC_ASSET_BASE_URL.replace(/\/$/, "")}${task.asset.url}`;
    await updatePlatformTaskProgress(taskId, "instagram", { status: "publishing", progress: 5, note: "Reels container submitted" });
    const token = channel.accessToken;
    const createBody = new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption: copy.caption || task.masterCaption || "",
      share_to_feed: "true",
    });
    const container = await requestJson(`https://graph.instagram.com/v24.0/${channel.externalId}/media`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${token}`,
      },
      body: createBody.toString(),
    });
    await waitForInstagramContainer(container.id, token, (progress) => updatePlatformTaskProgress(taskId, "instagram", progress));
    const publishBody = new URLSearchParams({ creation_id: container.id });
    const published = await requestJson(`https://graph.instagram.com/v24.0/${channel.externalId}/media_publish`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${token}`,
      },
      body: publishBody.toString(),
    });
    await updatePlatformTaskProgress(taskId, "instagram", {
      status: "published",
      progress: 100,
      postId: published.id || "",
      url: "",
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
      `https://graph.instagram.com/v24.0/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (status.status_code === "FINISHED") {
      await onProgress?.({ status: "publishing", progress: 85, note: "Reels container finished processing" });
      return;
    }
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Instagram container failed: ${status.status || status.status_code}`);
    }
    await onProgress?.({ status: "publishing", progress: Math.min(80, 10 + attempt * 3), note: status.status || status.status_code || "Processing" });
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
    const { chunkSize, totalChunkCount } = tiktokChunkPlan(totalBytes);
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
      oversizedFinalChunk: true,
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

async function runTwitterUpload(taskId) {
  const db = await readDb();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const channel = db.channels?.find((item) => item.id === "twitter" && item.connected);
  const copy = task.platforms?.find((item) => item.id === "twitter");
  try {
    if (!channel?.accessToken) throw new Error("X channel is missing access token. Please reconnect X.");
    const freshChannel = await ensureTwitterAccessToken(db, channel);
    const assetPath = join(uploadDir, task.asset.filename);
    const fileStat = await stat(assetPath);
    const totalBytes = fileStat.size;
    await updatePlatformTaskProgress(taskId, "twitter", { status: "publishing", progress: 0, uploadedBytes: 0, totalBytes, note: "Initializing X media upload" });
    const mediaId = await uploadVideoToX({
      accessToken: freshChannel.accessToken,
      assetPath,
      mimeType: task.asset.mimeType || "video/mp4",
      totalBytes,
      onProgress: (progress) => updatePlatformTaskProgress(taskId, "twitter", progress),
    });

    const text = buildTwitterText(copy, task);
    const created = await requestJson("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        authorization: `Bearer ${freshChannel.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text,
        media: { media_ids: [mediaId] },
      }),
    });

    const postId = created.data?.id || "";
    const postUrl = postId && freshChannel.username ? `https://x.com/${freshChannel.username}/status/${postId}` : "";
    await updatePlatformTaskProgress(taskId, "twitter", {
      status: "published",
      progress: 100,
      postId,
      url: postUrl,
      raw: created,
      publishedAt: new Date().toISOString(),
      taskStatus: "published",
    });
  } catch (error) {
    await updatePlatformTaskProgress(taskId, "twitter", {
      status: "failed",
      error: youtubeUploadErrorMessage(error),
      failedAt: new Date().toISOString(),
      taskStatus: "failed",
    });
  }
}

function buildTwitterText(copy, task) {
  const parts = [copy?.title, copy?.caption || task.masterCaption].filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  const joined = parts.join("\n\n");
  return compactForPlatform(joined || task.title || "New post", 280);
}

function tiktokChunkPlan(totalBytes) {
  if (totalBytes <= 5 * 1024 * 1024) {
    return { chunkSize: totalBytes, totalChunkCount: 1 };
  }

  const preferredChunkSize = 8 * 1024 * 1024;
  const chunkSize = Math.min(preferredChunkSize, 64 * 1024 * 1024, totalBytes);
  const totalChunkCount = Math.max(1, Math.floor(totalBytes / chunkSize));
  return { chunkSize, totalChunkCount };
}

async function uploadGenericChunksWithCurl({ uploadUrl, assetPath, mimeType, totalBytes, chunkSize, oversizedFinalChunk = false, onProgress }) {
  const fd = openSync(assetPath, "r");
  let uploadedBytes = 0;
  try {
    while (uploadedBytes < totalBytes) {
      const start = uploadedBytes;
      let end = Math.min(start + chunkSize, totalBytes) - 1;
      if (oversizedFinalChunk && totalBytes - start <= chunkSize * 2) {
        end = totalBytes - 1;
      }
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

async function uploadVideoToX({ accessToken, assetPath, mimeType, totalBytes, onProgress }) {
  const initBody = new URLSearchParams({
    command: "INIT",
    total_bytes: String(totalBytes),
    media_type: mimeType,
    media_category: "tweet_video",
  });
  const init = await requestJson("https://upload.twitter.com/1.1/media/upload.json", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: initBody.toString(),
  });
  const mediaId = init.media_id_string || String(init.media_id || "");
  if (!mediaId) throw new Error(`X media INIT did not return media_id: ${JSON.stringify(init)}`);

  const fd = openSync(assetPath, "r");
  const chunkSize = 1024 * 1024;
  let uploadedBytes = 0;
  let segmentIndex = 0;
  try {
    while (uploadedBytes < totalBytes) {
      const size = Math.min(chunkSize, totalBytes - uploadedBytes);
      const buffer = Buffer.alloc(size);
      const bytesRead = readSync(fd, buffer, 0, size, uploadedBytes);
      const chunkPath = join(tmpdir(), `cliprelay-x-chunk-${crypto.randomUUID()}.bin`);
      await writeFile(chunkPath, buffer.subarray(0, bytesRead));
      try {
        const append = await curlMultipart("https://upload.twitter.com/1.1/media/upload.json", {
          headers: [`authorization: Bearer ${accessToken}`],
          fields: {
            command: "APPEND",
            media_id: mediaId,
            segment_index: String(segmentIndex),
          },
          fileFieldName: "media",
          filePath: chunkPath,
          timeout: 300,
        });
        if (append.status < 200 || append.status >= 300) {
          throw new Error(`X media APPEND failed: ${append.status} ${append.body}`);
        }
        uploadedBytes += bytesRead;
        segmentIndex += 1;
        await onProgress?.(youtubeProgress(uploadedBytes, totalBytes));
      } finally {
        await unlink(chunkPath).catch(() => {});
      }
    }
  } finally {
    closeSync(fd);
  }

  const finalize = await requestJson("https://upload.twitter.com/1.1/media/upload.json", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ command: "FINALIZE", media_id: mediaId }).toString(),
  });

  if (finalize.processing_info) {
    await waitForXMediaProcessing(mediaId, accessToken, onProgress, totalBytes);
  }

  return mediaId;
}

async function waitForXMediaProcessing(mediaId, accessToken, onProgress, totalBytes) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await requestJson(`https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${encodeURIComponent(mediaId)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const processing = status.processing_info;
    if (!processing || processing.state === "succeeded") {
      await onProgress?.({ status: "publishing", progress: 95, uploadedBytes: totalBytes, totalBytes, note: "X media processing finished" });
      return;
    }
    if (processing.state === "failed") {
      throw new Error(`X media processing failed: ${processing.error?.message || processing.error?.name || "Unknown error"}`);
    }
    await onProgress?.({
      status: "publishing",
      progress: Math.max(80, Math.min(95, Number(processing.progress_percent || 80))),
      uploadedBytes: totalBytes,
      totalBytes,
      note: `X media processing: ${processing.state}`,
    });
    await delay(Math.max(1, Number(processing.check_after_secs || 3)) * 1000);
  }
  throw new Error("X media processing timed out");
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

async function ensureTwitterAccessToken(db, channel) {
  if (channel.accessToken && Number(channel.expiresAt || 0) > Date.now() + 60_000) return channel;
  if (!channel.refreshToken) return channel;
  const body = new URLSearchParams({
    refresh_token: channel.refreshToken,
    grant_type: "refresh_token",
    client_id: env.X_CLIENT_ID,
  });
  const basicAuth = Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString("base64");
  const tokenData = await requestJson("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basicAuth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  channel.accessToken = tokenData.access_token || channel.accessToken;
  channel.refreshToken = tokenData.refresh_token || channel.refreshToken;
  channel.expiresAt = Date.now() + Number(tokenData.expires_in || 7200) * 1000;
  upsertChannel(db, channel);
  await writeDb(db);
  return channel;
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
    statusText: "Ready to publish",
    ratio: parsed.fields.ratio || "Pending scan",
    duration: parsed.fields.duration || "Pending scan",
    tags: ["Local upload"],
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
