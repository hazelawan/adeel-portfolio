import { createHash, randomUUID, createCipheriv, createDecipheriv } from "node:crypto";
import { Buffer } from "node:buffer";

const APPWRITE = "https://sgp.cloud.appwrite.io/v1";
const PROJECT = "6ad678850018d7fa477c";
const REPO = "hazelawan/adeel-portfolio";
const BRANCH = "main";
const GH = `https://api.github.com/repos/${REPO}`;
const LIMIT = { files: 150, file: 2 * 1024 * 1024, total: 40 * 1024 * 1024, manifest: 65000 };
const enc = encodeURIComponent;
type F = { path: string; size: number; mime: string; sha: string };
type Site = { $id: string; version: 2; name: string; slug: string; status: string; files: F[]; repoPath: string; commit: string; publishedUrl: string; error: string; publicationId: string; sourceId?: string; updated_at?: string; [k: string]: unknown };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function fail(message: string, status = 400): never { throw new HttpError(status, message); }
function slug(value: unknown): string { if (typeof value !== "string" || value.length > 50 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) fail("Invalid site slug"); return value; }
function path(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 240 || value.startsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f:]/.test(value)) fail("Invalid file path");
  const parts = value.split("/");
  if (parts.some(p => !p || p === "." || p === ".." || p.startsWith(".") || /^(node_modules)$/i.test(p)) || parts.some(p => /^\.git$|^\.github$/i.test(p)) || value.toLowerCase() === "cue-site.json") fail("Unsafe or reserved file path");
  return value;
}
function validateFiles(files: F[]) {
  if (!Array.isArray(files) || !files.length || files.length > LIMIT.files) fail("Invalid file list");
  const seen = new Set<string>(); let total = 0;
  for (const f of files) {
    path(f?.path); const key = f.path.toLowerCase();
    if (seen.has(key) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > LIMIT.file || typeof f.mime !== "string" || !f.mime || f.mime.length > 120 || typeof f.sha !== "string" || (f.sha && !/^[a-f0-9]{40}$/.test(f.sha))) fail("Invalid or duplicate file metadata");
    seen.add(key); total += f.size;
  }
  const names = [...seen];
  if (names.some(p => names.some(q => p !== q && q.startsWith(`${p}/`)))) fail("File/directory hierarchy collision");
  if (!files.some(f => f.path === "index.html")) fail("Root index.html is required");
  if (total > LIMIT.total) fail("Site exceeds total size limit");
  return total;
}
function b64(s: unknown): Uint8Array {
  if (typeof s !== "string" || s.length > Math.ceil(LIMIT.file / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) fail("Invalid base64 file content");
  const raw = atob(s); if (raw.length > LIMIT.file || btoa(raw) !== s) fail("File exceeds 2 MiB or has invalid base64");
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function fingerprint(files: F[]) { return createHash("sha256").update(JSON.stringify([...files].map(f => ({ path: f.path, size: f.size, mime: f.mime, sha: f.sha || "" })).sort((a,b) => a.path.localeCompare(b.path)))).digest("hex"); }
function publicSite(s: Site) { const { updated_at: _u, ...out } = s; return out; }
function validateSite(s: Site): Site {
  if (!s || s.version !== 2 || typeof s.name !== "string" || !s.name.trim() || s.name.length > 160) fail("Invalid site metadata", 500);
  slug(s.slug); validateFiles(s.files);
  if (!["draft", "publishing", "published", "error"].includes(s.status) || s.repoPath !== `sites/${s.slug}` || !s.$id || !s.publicationId) fail("Invalid site metadata", 500);
  return s;
}

Deno.serve(async req => {
  const origin = req.headers.get("origin") || "";
  const configured = (Deno.env.get("CORS_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean);
  const allowed = new Set(["https://hazelawan.github.io", ...configured]);
  const cors: Record<string,string> = { "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, authorization" };
  if (origin && allowed.has(origin)) cors["Access-Control-Allow-Origin"] = origin;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (origin && !allowed.has(origin)) return json({ ok: false, error: "Origin not allowed" }, 403);
  try {
    if (req.method !== "POST") fail("POST required", 405);
    const raw = await req.text(); if (new TextEncoder().encode(raw).length > 3 * 1024 * 1024) fail("Request body exceeds 3 MiB", 413);
    let body: any; try { body = JSON.parse(raw); } catch { fail("Malformed JSON request body"); } if (!body || typeof body !== "object" || Array.isArray(body)) fail("Invalid request body");
    if (typeof body.jwt !== "string" || !body.jwt || body.jwt.length > 8192) fail("Authentication required", 401);
    const appUser = await upstream(`${APPWRITE}/account`, { headers: { "X-Appwrite-Project": PROJECT, "X-Appwrite-JWT": body.jwt } });
    if (!Array.isArray(appUser.labels) || !appUser.labels.includes("portfolioAdmin")) fail("Administrator access required", 403);
    const supa = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supa || !key) fail("Server configuration unavailable", 500);
    const secretKey = createHash("sha256").update(key).digest();
    const encryptToken = (token: string) => { const iv = crypto.getRandomValues(new Uint8Array(12)); const cipher = createCipheriv("aes-256-gcm", secretKey, iv); const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]); return { iv: Buffer.from(iv).toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") }; };
    const decryptToken = (rec: any) => { const decipher = createDecipheriv("aes-256-gcm", secretKey, Buffer.from(rec.iv, "base64")); decipher.setAuthTag(Buffer.from(rec.tag, "base64")); return Buffer.concat([decipher.update(Buffer.from(rec.ciphertext, "base64")), decipher.final()]).toString("utf8"); };
    let activeToken = Deno.env.get("GITHUB_TOKEN") || "";
    const gh = async (p: string, method = "GET", payload?: unknown) => { if (!activeToken) fail("Publisher is not configured; ask the administrator to initialize the GitHub publisher", 503); return upstream(`${GH}${p}`, { method, headers: { Authorization: `Bearer ${activeToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}) }); };
    async function loadPublisher() {
      if (activeToken) return;
      const rows = await db("site_manager_secrets?id=eq.github_publisher&select=*");
      if (rows?.[0]) { try { activeToken = decryptToken(rows[0]); } catch { fail("Publisher credential unavailable; reinitialize it", 503); } }
    }
    async function configurePublisher(candidate: unknown) {
      if (typeof candidate !== "string" || candidate.length < 20 || candidate.length > 500 || /[\r\n]/.test(candidate)) fail("Invalid GitHub token");
      const prior = activeToken; activeToken = candidate;
      try {
        const check = await gh("");
        if (check?.permissions?.push !== true) fail("GitHub token needs push access to the configured repository", 403);
        // Repository permissions describe the user, not the token's fine-grained grant.
        // An unreferenced blob proves actual Contents write access without touching files or branches.
        try { await gh("/git/blobs", "POST", { content: "Portfolio Sites Manager publisher capability check. No file or branch update.", encoding: "utf-8" }); }
        catch { fail("GitHub rejected Contents write access. Use a repository-scoped token with Contents: Read and write, and any required owner approval.", 403); }
      }
      catch (e) { activeToken = prior; throw e; }
      const sealed = encryptToken(candidate);
      await db("site_manager_secrets?on_conflict=id", "POST", { id: "github_publisher", ...sealed }, "resolution=merge-duplicates,return=minimal");
      activeToken = Deno.env.get("GITHUB_TOKEN") || candidate;
      return { configured: true };
    }
    const db = async (p: string, method = "GET", payload?: unknown, prefer = "") => upstream(`${supa}/rest/v1/${p}`, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    async function get(id: string): Promise<Site> { const rows = await db(`sites?id=eq.${enc(id)}&select=*`); if (!Array.isArray(rows) || !rows[0]) fail("Site not found", 404); return validateSite({ ...rows[0].payload, $id: rows[0].id, updated_at: rows[0].updated_at }); }
    async function save(site: Site, create = false, expected?: string): Promise<Site> {
      const payload = { ...site }; delete payload.updated_at; delete (payload as any).$id;
      if (new TextEncoder().encode(JSON.stringify(payload)).length > LIMIT.manifest) fail("Site metadata exceeds 65,000 bytes");
      if (create) {
        const r = await db("sites", "POST", { id: site.$id, slug: site.slug, payload }, "return=representation");
        if (!r?.[0]) fail("Could not create site", 502); return { ...r[0].payload, $id: r[0].id, updated_at: r[0].updated_at };
      }
      if (!expected) fail("Missing revision", 409);
      const r = await db(`sites?id=eq.${enc(site.$id)}&updated_at=eq.${enc(expected)}`, "PATCH", { slug: site.slug, payload }, "return=representation");
      if (!Array.isArray(r) || !r[0]) fail("Site changed concurrently; reload and retry", 409);
      return { ...r[0].payload, $id: r[0].id, updated_at: r[0].updated_at };
    }
    async function mutate(id: string, fn: (s: Site) => Site) { const s = await get(id); return save(fn(s), false, s.updated_at); }
    async function list() { const rows = await db("sites?select=*&order=updated_at.desc&limit=500"); if (!Array.isArray(rows)) fail("Catalog unavailable", 502); return { sites: rows.map((r: any) => validateSite({ ...r.payload, $id: r.id, updated_at: r.updated_at })).map(publicSite) }; }
    async function unique(s: string) { const rows = await db(`sites?slug=eq.${enc(s)}&select=id&limit=1`); if (rows.length) fail("A site with this slug already exists", 409); }
    async function templateFiles(content: unknown) {
      const ref = await gh(`/git/ref/heads/${BRANCH}`), commit = await gh(`/git/commits/${ref.object.sha}`), tree = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
      if (tree.truncated || !Array.isArray(tree.tree)) fail("Repository template tree unavailable", 502);
      const rootFiles = new Set(["index.html", "app.js", "style.css", "content.js", "content-defaults.json"]);
      const candidates = tree.tree.filter((e: any) => rootFiles.has(e.path) || e.path.startsWith("assets/"));
      const items = candidates.filter((e: any) => e.type === "blob");
      if (items.some((e: any) => !["100644", "100755"].includes(e.mode) || e.path.split("/").some((p: string) => p.startsWith(".")))) fail("Unsafe template entry", 502);
      // Tree nodes within assets are expected; other non-blob candidates are never fetched.
      if (items.length > LIMIT.files) fail("Template exceeds file limit", 413);
      const out: { path: string; mime: string; bytes: Uint8Array }[] = [];
      let effectiveContent = content;
      if (effectiveContent === undefined) {
        try { const live = await fetch(`${APPWRITE}/databases/portfolio/collections/content/documents/site`, { headers: { "X-Appwrite-Project": PROJECT } }); if (live.ok) { const doc = await live.json(); effectiveContent = JSON.parse(doc.payload); } } catch { /* use the repository defaults when live public content is unavailable */ }
      }
      for (const e of items) {
        if (!rootFiles.has(e.path) && !e.path.startsWith("assets/")) continue;
        const b = await gh(`/git/blobs/${e.sha}`); let bytes = Uint8Array.from(atob(b.content.replace(/\n/g, "")), c => c.charCodeAt(0));
        if (e.path === "index.html") {
          let html = new TextDecoder().decode(bytes);
          html = html.replace(/<link rel="stylesheet" href="contact-form\.css[^>]*>/g, "").replace(/<form id="contact-form"[\s\S]*?<\/form>/g, "").replace(/<a\b[^>]*href=["'](?:\.\.\/)?admin\.html["'][^>]*>[\s\S]*?<\/a>/gi, "").replace(/href="style\.css\?[^\"]*"/g, 'href="style.css"').replace(/src="app\.js\?[^\"]*"/g, 'src="app.js"');
          bytes = new TextEncoder().encode(html);
        }
        if (e.path === "content.js") {
          let js = new TextDecoder().decode(bytes);
          js = js.replace(/^import[^\n]*appwrite-client\.js[^\n]*\n/m, "const isConfigured=()=>true; const getContent=async()=>fetch('./site-content.json').then(r=>{if(!r.ok)throw Error('content unavailable');return r.json()});\n");
          js = js.replace(/const form=\$\('#contact-form'\),status=\$\('#contact-form-status'\);[\s\S]*?\n}\n?$/m, "const form=$('#contact-form'); if(form) form.remove();\ntry{const defaults=await fetch('./content-defaults.json').then(r=>r.json());const content=await getContent().catch(()=>defaults);render(content,defaults);}catch(error){console.warn('Local site content unavailable.',error.message);}");
          bytes = new TextEncoder().encode(js);
        }

        const mime = e.path.endsWith(".html") ? "text/html" : e.path.endsWith(".css") ? "text/css" : e.path.endsWith(".js") ? "text/javascript" : e.path.endsWith(".json") ? "application/json" : e.path.endsWith(".svg") ? "image/svg+xml" : e.path.match(/\.(png|jpe?g|webp|gif|mp4|webm)$/i) ? ({ png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", mp4:"video/mp4", webm:"video/webm" } as any)[e.path.split(".").pop()!.toLowerCase()] : "application/octet-stream";
        out.push({ path: e.path, mime, bytes });
        if (e.path === "content-defaults.json") out.push({path: "site-content.json", mime: "application/json", bytes: effectiveContent === undefined ? bytes : new TextEncoder().encode(JSON.stringify(effectiveContent, null, 2))});
      }
      // Renderer is local-only; content and defaults remain alongside it.
      if (!out.some(x => x.path === "index.html")) fail("Template root index missing", 502);
      return out;
    }
    async function assertAvailable(s: Site) {
      const ref = await gh(`/git/ref/heads/${BRANCH}`), commit = await gh(`/git/commits/${ref.object.sha}`), tree = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
      if (tree.truncated || !Array.isArray(tree.tree)) fail("Repository tree unavailable or truncated; publication stopped", 502);
      const dir = `sites/${s.slug}`.toLowerCase(), entries = tree.tree as any[];
      if (entries.some(e => e.path.toLowerCase() === "sites" && e.type === "blob")) fail("Repository path collision at sites", 409);
      if (entries.some(e => e.path.toLowerCase().split("/")[0] === "sites" && e.path.split("/")[0] !== "sites")) fail("Case-insensitive repository path collision", 409);
      const matching = entries.filter(e => { const low=e.path.toLowerCase(); return low===dir || low.startsWith(`${dir}/`) || (low!=="sites" && dir.startsWith(`${low}/`)); });
      // A normal `sites` tree is allowed. A target directory with an exact valid marker is recoverable.
      if (matching.length) {
        const marker = matching.find(e => e.path.toLowerCase() === `${dir}/cue-site.json`);
        if (marker?.type === "blob") { try { const blob=await gh(`/git/blobs/${marker.sha}`), m=JSON.parse(atob(blob.content.replace(/\n/g,""))); if(m.version===2&&m.siteId===s.$id&&m.publicationId===s.publicationId&&m.filesFingerprint===fingerprint(s.files)) return {ref,commit,recovered:true}; } catch { /* collision remains */ } }
        fail("Published GitHub path already exists; immutable paths cannot be overwritten",409);
      }
      return { ref, commit, recovered: false };
    }
    async function publish(id: string) {
      let current = await get(id); if (current.status === "published") return publicSite(current);
      if (current.status === "publishing") {
        const recovered = await assertAvailable(current);
        if (recovered.recovered) { const fresh=await get(id); return publicSite(fresh); }
        // A retry may reconstruct the same publication; non-force Git CAS prevents conflicting writes.
      }
      if (current.status !== "draft" && current.status !== "publishing") fail("Only drafts can be published", 409);
      if (current.files.some(f => !f.sha)) fail("Upload every file before publishing");
      const initial = current; const pubId = current.publicationId;
      if (current.status === "draft") current = await save({ ...current, status: "publishing", error: "" }, false, current.updated_at);
      const check = await assertAvailable(current);
      if (check.recovered) return publicSite(current);
      const entries = current.files.map(f => ({ path: `${current.repoPath}/${f.path}`, mode: "100644", type: "blob", sha: f.sha }));
      const markerBlob = await gh("/git/blobs", "POST", { content: JSON.stringify({ version: 2, siteId: current.$id, publicationId: pubId, filesFingerprint: fingerprint(current.files) }), encoding: "utf-8" });
      entries.push({ path: `${current.repoPath}/cue-site.json`, mode: "100644", type: "blob", sha: markerBlob.sha });
      const nextTree = await gh("/git/trees", "POST", { base_tree: check.commit.tree.sha, tree: entries });
      const commit = await gh("/git/commits", "POST", { message: `Publish site ${current.slug}`, tree: nextTree.sha, parents: [check.ref.object.sha] });
      const latest = await gh(`/git/ref/heads/${BRANCH}`); if (latest.object.sha !== check.ref.object.sha) fail("Concurrent main branch update; retry publication", 409);
      try { await gh(`/git/refs/heads/${BRANCH}`, "PATCH", { sha: commit.sha, force: false }); }
      catch { const reread = await assertAvailable(current); if (!reread.recovered) fail("Publication outcome is unknown; refresh status before retrying", 409); }
      const fresh = await get(id); return publicSite(await save({ ...fresh, commit: commit.sha }, false, fresh.updated_at));
    }
    const action = body.action; let result: any;
    if (action === "configurePublisher") { result = await configurePublisher(body.githubToken); return json({ ok: true, ...result }); }
    if (!["list", "createDraft", "duplicate", "refresh"].includes(action)) await loadPublisher();
    switch (action) {
      case "list": result = await list(); break;
      case "createDraft": {
        const s = slug(body.slug); if (!Array.isArray(body.files)) fail("Invalid file list"); if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 160) fail("Invalid site name"); const files = body.files.map((f: any) => ({ path: path(f.path), size: f.size, mime: f.mime, sha: "" })); validateFiles(files); await unique(s);
        const id = randomUUID(); result = { site: publicSite(await save({ $id: id, version: 2, name: body.name.trim(), slug: s, status: "draft", files, repoPath: `sites/${s}`, commit: "", publishedUrl: "", error: "", publicationId: randomUUID() }, true)) }; break;
      }
      case "portfolioTemplate": {
        const s = slug(body.slug); if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 160) fail("Invalid site name"); await unique(s);
        const files = await templateFiles(body.content); const id = randomUUID();
        const metas: F[] = files.map(f => ({ path: path(f.path), size: f.bytes.length, mime: f.mime, sha: "" })); validateFiles(metas);
        const site = await save({ $id: id, version: 2, name: body.name.trim(), slug: s, status: "draft", files: metas, repoPath: `sites/${s}`, commit: "", publishedUrl: "", error: "", publicationId: randomUUID() }, true);
        for (const f of files) { const blob = await gh("/git/blobs", "POST", { content: toBase64(f.bytes), encoding: "base64" }); const latest = await get(id); const next = { ...latest, files: latest.files.map(x => x.path === f.path ? { ...x, sha: blob.sha } : x) }; await save(next, false, latest.updated_at); }
        result = { site: publicSite(await get(id)) }; break;
      }
      case "duplicate": {
        const src = await get(body.sourceId); const s = slug(body.slug); if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 160) fail("Invalid site name"); await unique(s);
        result = { site: publicSite(await save({ ...src, $id: randomUUID(), name: body.name.trim(), slug: s, status: "draft", repoPath: `sites/${s}`, commit: "", publishedUrl: "", error: "", publicationId: randomUUID(), sourceId: src.$id }, true)) }; break;
      }
      case "uploadFile": {
        const id = body.siteId, p = path(body.path), bytes = b64(body.content); let site = await get(id); if (site.status !== "draft") fail("Files cannot be changed after publication starts", 409);
        let old = site.files.find(f => f.path === p); const originalSha = old?.sha || "";
        if (!old) { if (typeof body.mime !== "string" || !body.mime || body.mime.length > 120 || (body.size !== undefined && body.size !== bytes.length)) fail("File is not in this draft", 404); old = { path: p, size: bytes.length, mime: body.mime, sha: "" }; site = { ...site, files: [...site.files, old] }; }
        if (validateFiles(site.files.map(f => f.path === p ? { ...f, size: bytes.length, sha: "" } : f)) > LIMIT.total) fail("Site exceeds total size limit");
        const blob = await gh("/git/blobs", "POST", { content: body.content, encoding: "base64" });
        site = await mutate(id, s => { if (s.status !== "draft") fail("Files cannot be changed after publication starts", 409); const files=s.files.some(f=>f.path===p)?s.files.map(f=>f.path===p?{...f,size:bytes.length,sha:blob.sha}:f):[...s.files,{path:p,size:bytes.length,mime:body.mime,sha:blob.sha}]; validateFiles(files); const latest= s.files.find(f=>f.path===p); if((latest?.sha||"")!==originalSha) fail("File changed concurrently; reload and retry",409); return { ...s, files }; }); result = { site: publicSite(site) }; break;
      }
      case "getFile": { const s = await get(body.siteId), p = path(body.path), f = s.files.find(x => x.path === p); if (!f?.sha) fail("File is not uploaded", 404); const blob = await gh(`/git/blobs/${f.sha}`); result = { content: blob.content.replace(/\n/g, ""), mime: f.mime, path: f.path }; break; }
      case "publish": result = { site: await publish(body.siteId) }; break;
      case "refresh": { let s = await get(body.siteId); if (s.status === "publishing") { const url = `https://hazelawan.github.io/adeel-portfolio/${s.repoPath}/cue-site.json`; const r = await fetch(url, { headers: { "Cache-Control": "no-cache" } }); if (r.ok) { const m = await r.json(); if (m.version === 2 && m.siteId === s.$id && m.publicationId === s.publicationId && m.filesFingerprint === fingerprint(s.files)) s = await save({ ...s, status: "published", publishedUrl: `https://hazelawan.github.io/adeel-portfolio/${s.repoPath}/`, error: "" }, false, s.updated_at); } } result = { site: publicSite(s) }; break; }
      default: fail("Unknown action");
    }
    return json({ ok: true, ...result });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 502;
    if (status >= 500) console.error("site-manager request failed");
    const msg = e instanceof HttpError ? e.message : status === 500 ? "Server configuration or catalog error" : status === 502 ? "Upstream service rejected the request" : "Request failed";
    return json({ ok: false, error: msg }, status);
  }
});

async function upstream(url: string, init: RequestInit = {}) {
  const r = await fetch(url, init); let data: any = {}; try { data = await r.json(); } catch { /* non-json upstream response */ }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new HttpError(url.includes("appwrite") ? 401 : 502, "Authentication or upstream request failed");
    if (r.status === 409 || r.status === 412) throw new HttpError(409, "Concurrent change; reload and retry");
    throw new HttpError(r.status === 404 ? 404 : 502, "Upstream service rejected the request");
  }
  return data;
}

function toBase64(bytes: Uint8Array) { let out = ""; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length))); return btoa(out); }
