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

## Backend provisioned

The separate **Portfolio Sites Manager** project is now active in **Wanhar tech** on its Free plan, with a quoted new-project cost of **$0/month**. Project ref: `oesyrfvptnazuvbmpmyx`; region: `ap-south-1`.

- Dashboard: https://supabase.com/dashboard/project/oesyrfvptnazuvbmpmyx
- Edge endpoint: https://oesyrfvptnazuvbmpmyx.supabase.co/functions/v1/site-manager
- Migration applied: `create_private_sites_catalog`.
- Active function version 2 bundles the implementation pinned to Git commit `497e3c8c05cfc4e6ca7645340a71c4d7f0b4b0d5`. Publisher setup proves actual token Contents write access before encrypting it in service-role-only storage.
- Real checks passed: owner authentication, independent draft duplication, edited content with original-source preservation, new-file addition, unique-folder atomic publication, matching public marker, live HTML/JSON/CSS/JS, and repeat publish without a new commit. Anonymous table access and unknown origins are denied.
- The ready **Adeel Portfolio template** draft has 33 files, including local content data and all assets. It is disconnected from the original portfolio's Appwrite content and inbox.

The verified example is live at https://hazelawan.github.io/adeel-portfolio/sites/manager-check-c51dcac4c9/ . Temporary unpublished import-source drafts and verification login sessions were removed; the published example remains intact. The production endpoint is enabled in `sites-config.json` after the successful real test.

Open https://hazelawan.github.io/adeel-portfolio/admin.html and choose **Sites**. Duplicate **Adeel Portfolio template**, choose a new name/slug, edit **site-content.json** through **Edit site content**, save and publish. Published copies are immutable: duplicate them for another version. ZIP export retains all files and nested assets.

1HourMart, original Appwrite content/media/inbox configuration, and the original public portfolio files were not changed. Only the admin integration, new multi-site implementation/configuration, documentation/tests and the new verification-site folder are added or updated on `main` as part of rollout. No token is stored in GitHub files, browser code or response logs.
