# Appwrite setup

This repository provisions an existing **Appwrite Cloud** project. The setup script uses the Appwrite server REST API and is intentionally **not run here**; it must only be run when you have the target project's credentials and have reviewed the changes it will make.

## Required environment

Set these values in the environment where you will run the script:

- `APPWRITE_ENDPOINT` — project region endpoint, e.g. `https://<REGION>.cloud.appwrite.io/v1` (the script accepts either this form or the host without `/v1`).
- `APPWRITE_PROJECT_ID` — existing Appwrite project ID.
- `APPWRITE_API_KEY` — server API key for that project, with the required Database, Users, and Storage permissions. Project platform management may require additional project-level scope; see below.
- `ADMIN_EMAIL` — email address of the administrator to provision or label.
- `ADMIN_PASSWORD` — optional. If omitted, the script creates a new account using a random password that it **never prints or saves**; use Appwrite's password recovery flow to set a usable password later. For an existing account, its password is never changed.

Keep the API key secret: do not commit it, place it in `appwrite-config.json`, or paste it into logs. Run from any working directory:

```sh
python3 scripts/setup-appwrite.py
```

The script requires Python 3 and `requests` (`python3 -m pip install requests` if needed). Export the variables securely in your shell/CI secret store before running; do not hard-code credentials into the script.

## Resources provisioned

- Database `portfolio`.
- Collection `content`: `payload` string (maximum 65,535 characters), publicly readable, writable only by the `portfolioAdmin` label; document security is disabled.
- Collection `messages`: `name` (120), `email` (254), `message` (5,000), and optional `status` (default `new`). Public users may create; only `portfolioAdmin` may read, update, or delete. Document security is disabled so per-document grants cannot bypass the intended collection policy.
- Storage bucket `portfolio_media`: public read, admin create/update/delete, file security disabled, 10 MiB maximum, and extensions `jpg`, `jpeg`, `png`, `webp`, `gif`, `mp4`, `webm`.
- Admin account matched by email (or created if absent), with `portfolioAdmin` added while retaining existing labels.
- GitHub Pages web platform hostname `hazelawan.github.io` (attempted through the API; see limitations below).
- On successful resource verification, public-only `appwrite-config.json` at the repository root. It contains endpoint and IDs, **not** the API key. It is written only after the database, collections, and bucket have been verified. Do not publish it before successful provisioning.

Seed behavior: only when document `content/site` is absent, the script stores the exact text of `content-defaults.json` as its `payload`. Existing content is never overwritten. Provisioning uses stable IDs and is designed to be safely rerun. Existing resources with these IDs may have their permissions/settings reconciled to the policy above; inspect existing project resources first if they contain production data or intentional custom settings.

## Permissions and limitations

The `portfolioAdmin` label is the authorization boundary for privileged frontend operations. Keep that label limited to the intended administrator(s); users who can assign labels effectively gain these privileges. The API key is used only by this setup script and must never be shipped to the browser. Public message creation is intentionally unauthenticated; validate/rate-limit submissions in the application or another trusted layer as appropriate.

The script requests encryption and antivirus scanning for uploaded media. Actual availability and file-size rules depend on Appwrite Cloud; verify the resulting bucket settings rather than assuming scanning or encryption ran for a particular file.

Creating a web platform can be denied if the API key lacks project-platform permissions or the Cloud API disallows the operation. In that case setup prints an actionable warning and continues provisioning; add `hazelawan.github.io` manually in **Appwrite Console → Project → Platforms** before deploying. The script does not contact or configure any other backend service.
