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

## Site-first admin flow

The admin now opens on Sites. The original **Adeel Portfolio** has its own clearly marked live card. **Open files & details** opens its original static files (read-only), live URL and shortcuts to the existing original-only content/projects/services/media/inbox editor. Original static files are pinned to the last pre-manager-change root snapshot (`240fba4`) so the read-only view cannot drift during a download; original content itself is unchanged.

**Upload new website** accepts a complete built folder or individual files and previews the selected paths. A unique name/slug creates a new draft, then opens its files. Edit/add/replace draft files and choose **Publish new website** to create `sites/<slug>/` in this same repository. Uploading alone does not publish.

**Duplicate** on the original uses the existing standalone portfolio-copy operation, including local content and assets. Duplicate on another site creates its own independent draft. Each copy appears in the site list. New copies use unused slugs; original and existing published folders remain protected from overwrite. No demo copy is created automatically.

Published sites remain immutable; duplicate to a new slug for changes. Arbitrary uploaded sites use the file editor; portfolio copies also have guided details through `site-content.json`.

## Admin appearance and website themes

The **Admin dark mode** switch changes only the admin panel and login screen. Its light/dark selection is saved in this browser as `wanhar-admin-theme`, survives reload/sign-out, and synchronizes across tabs. The initial appearance follows the device preference when no selection has been saved. If browser storage is disabled, switching still works for the current page.

New copies created from the original portfolio include an opt-in website theme adapter. Open a draft's files and details, choose **Website color mode** (Dark, Light or System) and **Website accent color** (Gold, Emerald, Blue or Rose), then choose **Save website theme**. This updates only that draft's `site-theme.json`; publish the new folder to make it live. Published websites remain immutable: duplicate one to change its theme. Admin appearance and website appearance are independent. System mode follows each visitor's device preference.

Imported websites keep their original HTML/CSS unchanged. Theme controls appear only for the supported `wanhar-portfolio-v1` adapter: root `site-theme.json`, `site-theme.js`, `site-theme.css`, and an `index.html` that explicitly declares `<meta name="cue-site-theme" content="wanhar-portfolio-v1">` and links the local `./site-theme.css` stylesheet and deferred `./site-theme.js` script. The configuration is exactly `{"version":1,"adapter":"wanhar-portfolio-v1","mode":"dark","accent":"gold"}` with the supported mode/accent choices above. Invalid/unsupported settings leave existing styling alone. The manager never rewrites arbitrary imported CSS or applies a theme to the original live portfolio.

Existing portfolio drafts created before this feature are not silently converted; create a fresh independent copy of the original portfolio to get the supported theme files. Theme configuration and runtime assets are included in ZIP exports.
