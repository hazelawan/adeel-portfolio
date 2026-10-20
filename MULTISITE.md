# Multi-site manager

The portfolio remains at the repository root. The **Sites** admin tab manages independent static websites. Its new Supabase project must remain separate from 1HourMart and the portfolio's existing Appwrite backend.

## Everyday workflow

1. **Copy current portfolio to a draft**, or import your own built website folder/files. Root `index.html` is required.
2. Enter a name and unique slug. Publication creates `sites/<slug>/` in `hazelawan/adeel-portfolio`.
3. **Edit site content** exposes portfolio-template details as fields, including services, projects, contact details and asset paths. Arbitrary imports can be edited as HTML/CSS/JS/text; they do not automatically gain a custom visual editor.
4. Add text files or upload/replace draft files. Saves create new immutable GitHub blobs. Published source files stay unchanged.
5. **Publish** creates the new folder atomically. **Refresh status** checks its public marker after GitHub Pages deployment; a commit alone is not called live.
6. To change a published site, **Duplicate** with a new slug, edit, and publish. The source remains unchanged.
7. **Download ZIP** exports all files and assets with their folder structure. Single-file downloads are also available.

## Import limits

Trusted, already-built static HTML/CSS/JavaScript sites: 150 files, 2 MiB per file, 40 MiB total; text editing up to 512 KiB per file. Folder import preserves paths and removes a shared enclosing folder. Multiple flat files can also be selected.

This does not build source projects or run Node/PHP servers or databases. Import React/Vue build output, not the source project. Backend features require their own connection. Only import files you own or have permission to reuse; downloading arbitrary third-party websites is not supported.

Never upload credentials, private data, hidden files, `.env`, `.git`, `.github` or `node_modules`. Imported scripts run on the same GitHub Pages origin as the admin: do not publish untrusted code there. GitHub draft blobs are not confidential storage, even before a main-branch commit.

## Separate Supabase deployment

Create **Portfolio Sites Manager** in the owner's confirmed organization. Never apply this migration or function to 1HourMart or another existing project.

- Apply `supabase/migrations/202610200001_sites.sql` only to the new project.
- Deploy `supabase/functions/site-manager/index.ts` as `site-manager` with platform `verify_jwt: false`. The function itself authenticates every application operation with an Appwrite session JWT and requires `portfolioAdmin`.
- Supabase supplies server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never put the service key in browser settings or the repository.
- The default browser origin is `https://hazelawan.github.io`; additional test origins require explicit `CORS_ORIGINS` configuration.
- Enable `sites-config.json` with the new function HTTPS URL after deployment and access checks. This public file contains no credentials.

Catalog and encrypted-credential tables have RLS enabled and no anon/authenticated grants. The service role is used only inside the Edge Function. Existing Appwrite content, inbox, media and configuration are unchanged; Appwrite verifies the existing owner login and supplies public content for the initial template snapshot.

## Publisher credential

Use a durable fine-grained token restricted to **hazelawan/adeel-portfolio**, with **Contents: Read and write** and **Metadata: Read**. Temporary task credentials must not be installed as permanent application credentials.

Prefer a server environment secret named `GITHUB_TOKEN`. Alternatively, call authenticated `configurePublisher` through a secure setup script: it verifies repository push access and AES-GCM encrypts the token in a service-role-only table using a service-role-derived key. Never embed a token in browser code, public settings or committed files. Service-key rotation requires reinitializing the encrypted token. Responses and logs do not expose credentials.

## No-overwrite publishing

Writes are restricted to the selected new `sites/<slug>/` folder. Existing target folders, case-only collisions, traversal and file/folder conflicts are rejected. Publication uses non-force atomic Git ref updates. A secret-free marker supports reconciliation after ambiguous requests. Imported source is never executed during publishing.

## Tests and rollout status

Run `node --test tests/frontend-zip.test.mjs tests/supabase-sites.test.mjs` and `git diff --check`. ZIP tests include Python `zipfile` interoperability. Mocked backend tests do not replace a real new-project import/duplicate/edit/publish/live-marker test.

Deployment status is reported separately. This source guide is not evidence that the new manager is live.
