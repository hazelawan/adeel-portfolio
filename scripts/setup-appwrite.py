#!/usr/bin/env python3
"""Idempotently provision the portfolio's Appwrite Cloud resources."""
from __future__ import annotations

import json
import os
import secrets
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "appwrite-config.json"
DATABASE_ID = "portfolio"
CONTENT_ID = "content"
MESSAGES_ID = "messages"
BUCKET_ID = "portfolio_media"
ADMIN_LABEL = "portfolioAdmin"
PLATFORM_HOSTNAME = "hazelawan.github.io"


class AppwriteError(RuntimeError):
    pass


class Client:
    def __init__(self, endpoint: str, project_id: str, key: str):
        self.base = endpoint.rstrip("/")
        if not self.base.endswith("/v1"):
            self.base += "/v1"
        self.session = requests.Session()
        self.session.headers.update({
            "X-Appwrite-Project": project_id,
            "X-Appwrite-Key": key,
            "X-Appwrite-Response-Format": "1.6.0",
            "Content-Type": "application/json",
        })

    def request(self, method: str, path: str, *, json_body=None, params=None,
                allow=(200, 201, 202, 204)):
        response = self.session.request(method, self.base + path, json=json_body,
                                        params=params, timeout=30)
        if response.status_code not in allow:
            try:
                detail = response.json()
            except ValueError:
                detail = response.text[:500]
            raise AppwriteError(f"{method} {path}: HTTP {response.status_code}: {detail}")
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            return {}

    def ensure(self, method, path, body, get_path):
        try:
            return self.request("GET", get_path)
        except AppwriteError as exc:
            if "HTTP 404" not in str(exc):
                raise
        try:
            return self.request(method, path, json_body=body)
        except AppwriteError as exc:
            if "HTTP 409" not in str(exc):
                raise
            # A conflict is only treated as success if the exact resource exists.
            return self.request("GET", get_path)


def enc(value: str) -> str:
    return quote(value, safe="")


def ensure_attr(api: Client, kind: str, coll: str, body: dict):
    path = f"/databases/{DATABASE_ID}/collections/{coll}/attributes/{kind}"
    key = body["key"]
    api.ensure("POST", path, body,
               f"/databases/{DATABASE_ID}/collections/{coll}/attributes/{enc(key)}")
    # Attribute creation is asynchronous (202); wait until the schema is available.
    attr_path = f"/databases/{DATABASE_ID}/collections/{coll}/attributes/{enc(key)}"
    for _ in range(30):
        attr = api.request("GET", attr_path)
        if attr.get("status") == "available":
            return
        if attr.get("status") in ("failed", "stuck"):
            raise AppwriteError(f"Attribute {coll}.{key} entered status {attr.get('status')}")
        time.sleep(1)
    raise AppwriteError(f"Timed out waiting for attribute {coll}.{key}")


def ensure_collection(api: Client, coll_id: str, name: str, permissions: list[str], attrs: list[tuple[str, dict]]):
    path = f"/databases/{DATABASE_ID}/collections"
    body = {"collectionId": coll_id, "name": name, "permissions": permissions,
            "documentSecurity": False, "enabled": True}
    api.ensure("POST", path, body, f"{path}/{enc(coll_id)}")
    # Reconcile permissions and disable document-level security on existing collections too.
    api.request("PUT", f"{path}/{enc(coll_id)}", json_body={
        "name": name, "permissions": permissions, "documentSecurity": False, "enabled": True
    })
    for kind, attr_body in attrs:
        ensure_attr(api, kind, coll_id, attr_body)


def ensure_admin(api: Client, email: str, password: str | None):
    # REST queries use the same serialized Query.equal syntax as the SDKs.
    query = json.dumps({'method': 'equal', 'attribute': 'email', 'values': [email]})
    result = api.request("GET", "/users", params={"queries[]": query})
    users = result.get("users", [])
    user = next((u for u in users if u.get("email", "").casefold() == email.casefold()), None)
    if user is None:
        generated = password or secrets.token_urlsafe(32)
        # The generated password is never printed, stored, or returned.
        user = api.request("POST", "/users", json_body={
            "userId": "unique()", "email": email, "password": generated,
            "name": "Portfolio Admin",
        })
        if not password:
            print("Created admin user with an undisclosed random password; use Appwrite password recovery to set access.")
    labels = list(user.get("labels") or [])
    if ADMIN_LABEL not in labels:
        labels.append(ADMIN_LABEL)
        user = api.request("PUT", f"/users/{enc(user['$id'])}/labels", json_body={"labels": labels})
    return user["$id"]


def ensure_seed(api: Client):
    docs_path = f"/databases/{DATABASE_ID}/collections/{CONTENT_ID}/documents"
    existing = api.request("GET", docs_path, params={"queries[]": json.dumps({'method': 'equal', 'attribute': '$id', 'values': ['site']})})
    if existing.get("total", 0) or any(doc.get("$id") == "site" for doc in existing.get("documents", [])):
        print("Seed document 'site' already exists; preserving it.")
        return
    defaults_path = ROOT / "content-defaults.json"
    if not defaults_path.is_file():
        raise AppwriteError(f"Seed file not found: {defaults_path}")
    payload = defaults_path.read_text(encoding="utf-8")
    if len(payload) > 65535:
        raise AppwriteError("content-defaults.json exceeds Appwrite's 65,535-character payload attribute limit")
    api.request("POST", docs_path, json_body={
        "documentId": "site", "data": {"payload": payload}, "permissions": []
    })
    print("Seeded content/site from content-defaults.json (only because it was absent).")


def main():
    endpoint = os.getenv("APPWRITE_ENDPOINT", "").strip()
    project_id = os.getenv("APPWRITE_PROJECT_ID", "").strip()
    key = os.getenv("APPWRITE_API_KEY", "").strip()
    admin_email = os.getenv("ADMIN_EMAIL", "").strip()
    password = os.getenv("ADMIN_PASSWORD")
    missing = [name for name, value in (("APPWRITE_ENDPOINT", endpoint), ("APPWRITE_PROJECT_ID", project_id),
                                         ("APPWRITE_API_KEY", key), ("ADMIN_EMAIL", admin_email)) if not value]
    if missing:
        print("Missing required environment variables: " + ", ".join(missing), file=sys.stderr)
        return 2
    if not endpoint.startswith("https://"):
        print("APPWRITE_ENDPOINT must be an HTTPS Appwrite Cloud endpoint.", file=sys.stderr)
        return 2

    api = Client(endpoint, project_id, key)
    try:
        database_path = f"/databases/{DATABASE_ID}"
        api.ensure("POST", "/databases", {"databaseId": DATABASE_ID, "name": "Portfolio", "enabled": True}, database_path)
        # Re-fetch to verify the resource and reject a conflicting disabled/mismatched setup.
        db = api.request("GET", database_path)
        if db.get("$id") != DATABASE_ID:
            raise AppwriteError("Database verification returned an unexpected ID")

        admin_id = ensure_admin(api, admin_email, password)
        admin = json.dumps("label:" + ADMIN_LABEL)
        ensure_collection(api, CONTENT_ID, "Content", ["read(\"any\")", f"create({admin})", f"update({admin})", f"delete({admin})"], [
            ("string", {"key": "payload", "size": 65535, "required": True, "array": False})
        ])
        ensure_collection(api, MESSAGES_ID, "Messages", ["create(\"any\")", f"read({admin})", f"update({admin})", f"delete({admin})"], [
            ("string", {"key": "name", "size": 120, "required": True, "array": False}),
            ("email", {"key": "email", "required": True, "array": False}),
            ("string", {"key": "message", "size": 5000, "required": True, "array": False}),
            ("enum", {"key": "status", "elements": ["new", "read", "replied", "archived"], "required": False, "default": "new", "array": False}),
        ])
        bucket_body = {
            "bucketId": BUCKET_ID, "name": "Portfolio Media",
            "permissions": ["read(\"any\")", f"create({admin})", f"update({admin})", f"delete({admin})"],
            "fileSecurity": False, "enabled": True, "maximumFileSize": 10 * 1024 * 1024,
            "allowedFileExtensions": ["jpg", "jpeg", "png", "webp", "gif", "mp4", "webm"],
            "compression": "none", "encryption": True, "antivirus": True,
        }
        bucket_path = f"/storage/buckets/{BUCKET_ID}"
        api.ensure("POST", "/storage/buckets", bucket_body, bucket_path)
        # Explicit reconciliation also makes reruns repair permissions and settings.
        update_body = {k: v for k, v in bucket_body.items() if k != "bucketId"}
        api.request("PUT", bucket_path, json_body=update_body)
        ensure_seed(api)

        platform_ok = False
        platform_path = f"/projects/{enc(project_id)}/platforms"
        try:
            platforms = api.request("GET", platform_path)
            found = any(p.get("hostname") == PLATFORM_HOSTNAME for p in platforms.get("platforms", []))
            if not found:
                api.request("POST", platform_path, json_body={
                    "type": "web", "name": "GitHub Pages", "hostname": PLATFORM_HOSTNAME
                })
            platform_ok = True
        except AppwriteError as exc:
            print(f"WARNING: could not verify/register web platform {PLATFORM_HOSTNAME}: {exc}\n"
                  "Add hazelawan.github.io manually in Appwrite Console > Project > Platforms (or use a key with project-platform scope).",
                  file=sys.stderr)

        # Verify all required resources before publishing client configuration.
        api.request("GET", database_path)
        for cid in (CONTENT_ID, MESSAGES_ID):
            coll = api.request("GET", f"/databases/{DATABASE_ID}/collections/{cid}")
            expected = (['read("any")', f"create({admin})", f"update({admin})", f"delete({admin})"] if cid == CONTENT_ID else ['create("any")', f"read({admin})", f"update({admin})", f"delete({admin})"])
            if set(coll.get("$permissions", [])) != set(expected):
                raise AppwriteError(f"Collection {cid} permissions verification failed")
            if coll.get("documentSecurity") is not False:
                raise AppwriteError(f"Collection {cid} documentSecurity verification failed")
        bucket = api.request("GET", bucket_path)
        if set(bucket.get("$permissions", [])) != set(bucket_body["permissions"]):
            raise AppwriteError("Bucket permissions verification failed")
        if bucket.get("fileSecurity") is not False:
            raise AppwriteError("Bucket fileSecurity verification failed")
        config = {"endpoint": api.base, "projectId": project_id,
                  "databaseId": DATABASE_ID, "contentCollectionId": CONTENT_ID,
                  "messagesCollectionId": MESSAGES_ID, "bucketId": BUCKET_ID,
                  "enabled": True}
        temp_path = CONFIG_PATH.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        os.replace(temp_path, CONFIG_PATH)
        print(f"Provisioning verified. Wrote public client config to {CONFIG_PATH}.")
        if not platform_ok:
            print("Configuration is written, but register the GitHub Pages platform manually before deploying.")
        print(f"Admin user ID: {admin_id}")
        return 0
    except (AppwriteError, requests.RequestException, OSError, ValueError) as exc:
        print(f"Provisioning failed: {exc}\nNo new appwrite-config.json was written.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
