# 朋友圈帖子图片 — upload, storage, moderation

Branch `feat/social-media`, from `main` at `74e05f4`, then merged with `origin/main` at `07706a5e`. The merge re-added only this branch's keys onto `main`'s bundles; `schema.yml`, `generated/schema.ts` and `egyVocabulary.json` were regenerated, not hand-merged. Draft PR: `feat(social): 朋友圈帖子图片（上传、存储、审核）`.

## What souls and officers get

- **Souls (App):** the composer can pick up to 9 images. Each image uploads on its own request, with its own progress bar. A failed image can be retried or removed. **发出** stays disabled while any image is uploading or has failed, and a line under the button says which. A post may be images only. The feed and post detail show a square grid (1 image = one large tile; 2–4 = two columns; 5–9 = three columns), and tapping a tile opens a full-screen, swipeable viewer. Leaving the composer without posting deletes the uploads right away.
- **Officers (web `/moderation`):** list rows show 「图 N」 in mono next to the report count (C-08); comment and user rows show nothing. The review detail draws C-08's `MediaTile`: square tiles, hairline border, and a mono caption such as 「图 1 · 1080×720」. Each tile links to the full image in a new tab. The report queue and the pending-post queue both carry the count.

## Storage and serving: what is reused, and what could not be

I studied the avatar path first. It is the model for everything below.

| | Avatar (existing) | Post image (this branch) |
|---|---|---|
| Model field | `User.avatar` `ImageField`, `upload_to="avatars/%Y/%m/"` | `PostMedia.file` `FileField`, `upload_to="private/post_media/%Y/%m/"` |
| Storage backend | Django default storage (FileSystemStorage, `MEDIA_ROOT`; the `media_files` volume in compose, backed up by `backup-db.sh`) | **same one**. No new storage service and no new Python dependency. |
| Validation | Pillow decode, PNG/JPEG/WebP allowlist, 5 MB, 40 MP, re-encode without EXIF, random name | **same function**. The avatar code was moved into `apps/social/images.py::reencode` and both paths call it. The avatar's error messages are unchanged (the frontend reads "Avatar must be at most 5 MB."). |
| How files are served | nginx `location /media/` (public); `static()` under DEBUG | **not reused, deliberately.** See below. |
| How tests fake storage | `settings.MEDIA_ROOT = tmp_path` | same fixture (`tests/test_soul_social_media.py::media_root`) |

**Why serving differs.** `/media/` is public: anyone with the path gets the file. Post images belong to PRIVATE, FOLLOWERS-only, pending and hidden posts, so a public path would leak them the moment a URL was seen once. Post images are therefore stored under `MEDIA_ROOT/private/`, and two things refuse that prefix:

- nginx: `location ^~ /media/private/ { return 404; }`
- DEBUG `static()`: a 404 route placed before it, in `config/urls.py`.

`tests/test_debug_does_not_serve_the_source_tree.py` now plants a real file under `private/` and asserts DEBUG `/media/` answers 404 for it.

Files leave only through `GET /api/v1/social-media/<id>/?t=<signature>` (`apps/social/media_views.py`).

- **Why a signed URL rather than a token header:** web `<img src>` cannot send `Authorization`, and neither can a native image view. The serializer signs `(media id, viewer user_id)` with `django.core.signing.TimestampSigner` (salt `social.post_media`, 1 h TTL).
- **The signature only says who the URL was issued to.** Every fetch re-runs `media.may_view(viewer, media)` for that person. If the post was hidden, deleted or unfollowed after the URL was issued, the same URL answers 404. A bad or expired signature, a swapped id and "may not see it" all get the same 404, so nothing can be probed.
- `may_view`:
  - an unattached upload: its uploader only;
  - a soul: the post is in `visible_posts_for_soul(viewer)`, the same rule as the feed, so hidden and pending media reach the author only, and PRIVATE and FOLLOWERS apply;
  - an officer: holds `social.moderate`, and the media passes `scope_to_tenant(..., field="post__tenant")`, the same function every moderation view uses. The author must be a soul. Media of an officer-deleted post (in the recycle bin) stays visible to officers.
- Response headers: `Cache-Control: private, max-age=3600` (never a shared cache) and `X-Content-Type-Options: nosniff`.
- Throttle: `post_media` 600/minute, keyed by the signed viewer, falling back to IP. One feed page can be 20 posts × 9 images, which the global anonymous 60/minute would have cut off.

## Limits chosen

- **9 images per post** (`media.MAX_PER_POST`), checked by the serializer (`max_length`) and again in `attach()`.
- **PNG / JPEG / WebP only**, identified by **magic bytes** (`images.sniff_format`), never by the filename or the Content-Type. Pillow then decodes with **only the sniffed format's decoder** (`Image.open(..., formats=[sniffed])`) and must decode the whole image. What is stored is a re-encode, under a random name.
- **5 MB per file**, the avatar's limit. **40 MP** pixel cap, checked from the header before decoding (same as the avatar). Stored images are scaled so the long edge is at most **2048 px**; the avatar keeps its 512.
- **EXIF (including GPS) is stripped**, because the avatar path strips it and the same function now does it for both. Orientation is applied first. ICC and text chunks are dropped too.
- **At most 18 unattached uploads per soul** (`MAX_PENDING`, two full posts). Beyond that, 409 `too_many_pending`. This keeps "upload and never post" from filling the disk.
- A muted or retired soul cannot upload (`ensure_can_write`, same gate as posting).

## Model and migration

`backend/apps/social/migrations/0008_post_media.py` creates `PostMedia`:

- fields: `post` FK (nullable until attached, CASCADE), `uploader` FK, `position` (0..8), `file`, `width`, `height`, `byte_size`, `content_type`, `created_at`;
- `SoftDeleteMixin`: `is_deleted`, `deleted_*`, `delete_cascade_id`;
- indexes on `(post, position)` and `(uploader, created_at)`.

There is **no tenant column**: tenant comes from the post (`post__tenant`), as asked. There is **no moderation status of its own**: an image is visible exactly when its post is.

## Lifecycle

| Event | Rows | Files |
|---|---|---|
| Upload | a row with `post=NULL` | written under `private/post_media/` |
| Post created with `media: [ids]` | attached in the given order, in the same transaction as the post. Any id that is not "mine, unattached, not deleted" → 400 `media_not_found` and **no post is created** | — |
| Soul removes an unposted image (`DELETE /me/social/media/<id>/`) | really deleted | deleted after commit |
| Officer **hides** a post | unchanged | unchanged; souls get 404 on fetch (author and officers still 200) |
| Officer **deletes** a post (moderation DELETE or report resolution DELETE) | soft-deleted with **the post's `delete_cascade_id`** (`cascade_soft_delete`) | kept |
| Recycle bin **restore** | come back with the post (`restore_cascade`) | — |
| Recycle bin **hard delete** (after 30 days) | CASCADE-deleted with the post | deleted after commit (`post_delete` receiver) |
| Soul deletes **its own** post | really deleted (the post itself stays soft-deleted, as before) | deleted after commit |
| Orphan cleanup | unattached rows older than 24 h are deleted | deleted, plus any file under `private/post_media/` that no row points to and that is older than the cutoff |

The bin now shows an officer-deleted post with images as one entry, 「含 N 项关联」. Files are deleted in `transaction.on_commit`, so a rolled-back delete keeps its file.

**Orphan cleanup: `manage.py cleanup_orphan_post_media [--hours 24] [--dry-run]`.** It is idempotent. It is **not** a celery task and **not** in `apps/scheduler/registry.py`: celery beat is not deployed, so a registry entry would be a PeriodicTask that never fires. **It must run once a day from the deployment host's cron**, e.g.

    17 3 * * *  docker compose exec -T backend python manage.py cleanup_orphan_post_media

If it never runs, the only cost is disk space. Orphans are invisible to everyone but their uploader, and `MAX_PENDING` bounds the pile per soul.

## Endpoints

| Method and path | Who | What |
|---|---|---|
| `POST /api/v1/me/social/media/` (multipart `file`) | soul | 201 `{id, url, width, height, byte_size, content_type}`. 400 `not_an_image` / `too_large` / `too_many_pixels` / `file_required`; 409 `too_many_pending`; 403 `muted` / `account_retired` |
| `DELETE /api/v1/me/social/media/<id>/` | soul (uploader) | 204. Only unattached uploads; anything else is 404 |
| `POST /api/v1/me/social/feed/` | soul | now accepts `media: [uuid…]` (≤ 9, in order). `content` may be empty when there are images; neither gives 400 `empty_post`. Also 400 `media_not_found` / `duplicate_media` / `too_many_media` |
| `GET /api/v1/me/social/feed/`, `…/posts/<id>/` | soul | each post now has `media: [{id, url, width, height}]`, ordered, with URLs signed for the viewer |
| `GET /api/v1/social-moderation/posts/`, `…/posts/<id>/` | officer, `social.moderate` | `media` (signed for the officer) and `media_count` |
| `GET /api/v1/social-moderation/reports/` | officer, `social.moderate` | `media_count` (images on the reported post; 0 for comments and users) |
| `GET /api/v1/social-media/<id>/?t=…` | whoever holds the signed URL | the file, after `may_view` for the signed viewer; otherwise 404 |

The OpenAPI schema is regenerated the repo's way:

    manage.py spectacular --file ../packages/core/openapi/schema.yml
    npm run schema:generate --workspace @soulledger/core

## Client code

- **`packages/core`**
  - `soulSocialApi.uploadMedia(body, onProgress)`, `removeMedia(id)`, and `createPost(content, visibility, media)`.
  - `domain/postMedia.ts`: `mediaUrl()` joins a signed site-rooted path to the API host on a phone and leaves it as is on the web; `mediaGridColumns()`; `SOUL_POST_MEDIA_MAX`; the `PostMedia` type. These live outside `soul-social` so the web admin draws a grid without importing the soul HTTP client.
  - `hooks/useSoulMediaUploads`: the per-image upload queue, `ready` gate, retry, remove, and discard.
- **Mobile**
  - `screens/circleMedia.tsx`: grid, viewer, composer tray, picker.
  - `screens/circle.tsx`: wiring and refusal copy.
  - `emblems.tsx`: a `close` glyph.
  - `composing.ts`: `useCommittedSend(…, allowEmpty)`, for image-only posts.
  - Styling follows `theme.ts`: `borderRadius: 0`, `hair` / `hair2` / `s2` / `accent` / `neg*` tokens, so tiles follow light and dark and every civilization.
- **Web:** `components/moderation/MediaGrid.tsx`, wired into `ReportsReview.tsx`.

### Dependency added: `expo-image-picker ~57.0.20`

It was **not** a dependency before, and the App had no way to reach the photo library at all. This is the SDK 57 version (`npm view expo-image-picker dist-tags` → `sdk-57: 57.0.20`).

- `app.json` gains its config plugin with a photo-library purpose string. Camera and microphone permissions are set to `false`: the app only picks from the library.
- **This is a native module. The dev client must be rebuilt (`expo run:android` / `run:ios`) before the composer works on a device.** An old dev-client build will throw on pick, and the App will say 「需要相册权限才能选图」.
- The lockfile diff is large (~1850 lines) but inert. npm hoists `expo` and its `@expo/*` helpers from `mobile/node_modules` to the root, because the picker peers on `expo`. The only version changes are two patch bumps: `@babel/plugin-transform-typescript` 7.29.7→7.29.9 and `regjsparser` 0.13.2→0.13.3. No `libc` lines were removed.
- I checked that the diff is not npm drift. Two npm 11 versions (11.19.1 and 11.20.0), and a lockfile-only install, all produce the identical lockfile. A no-op install on `main` produces no diff at all.

The picker uses `quality: 0.8` and the `Compatible` representation, so iOS hands over JPEG instead of HEIC (the server refuses HEIC) and most phone photos land under 5 MB. There is no client-side resizing (see open questions).

## Tests

All new backend tests are in `backend/tests/test_soul_social_media.py`, 39 tests, most running through the HTTP views.

- **Validation:**
  - PNG, JPEG and WebP are accepted and stored privately under a random name;
  - EXIF with GPS is stripped;
  - five type spoofs are refused: text, PHP and SVG wearing image names and Content-Types, plus a PNG magic number and a JPEG magic number each followed by junk;
  - a real GIF is refused;
  - a PNG named `.jpg` and sent as `image/jpeg` is stored as PNG;
  - over 5 MB is refused;
  - the long edge is scaled to 2048;
  - the pending cap, a muted soul, and an officer token are refused;
  - 9 images attach in order; 10 are refused with no post created;
  - someone else's upload, a reused image and a duplicate id are all refused;
  - image-only posts work; empty posts do not;
  - only the uploader can remove a pending upload, and removing it deletes the file.
- **Access, tested on the file URL rather than on lists:**
  - wrong, tampered, swapped and expired signatures → 404;
  - a pending upload is served to its uploader only;
  - **a URL obtained while the post was visible → 404 after the post is hidden, 200 again after restore.** The author and the officer still get 200;
  - a pending-review post's images reach the author only;
  - FOLLOWERS and PRIVATE tiers apply;
  - a deactivated viewer gets 404.
- **Tenant isolation:**
  - another civilization's soul gets 404 on a URL signed for it, and does not see the post in the list;
  - another civilization's moderator gets 404 on the detail and on the file, while the same civilization's moderator gets 200;
  - an EU soul cannot attach a CN upload;
  - a JUDGE, who does not hold `social.moderate`, gets 404.
- **Moderation:** list rows carry `media_count`, reports carry `media_count`, and the detail carries ordered media. A text-only post has `[]` and 0.
- **Recycle bin round trip:**
  - an officer delete soft-deletes the media under the post's cascade id;
  - the bin shows `dependent_count` 3;
  - a soul's URL → 404 while the officer's → 200;
  - restore brings back 4 rows (the post and 3 images), and the soul's URLs → 200 again;
  - hard delete after 30 days removes the rows and the files.
- **Own delete:** the rows and files are really gone, the URLs → 404, other posts are untouched, and nothing appears in the bin.
- **Orphan cleanup:**
  - `--dry-run` reports and deletes nothing;
  - the real run deletes the old orphan and an old stray file, and keeps the recent upload and the attached image;
  - a second run deletes 0.

`tests/test_debug_does_not_serve_the_source_tree.py`: DEBUG `/media/private/…` answers 404 for a file that really exists.

`tests/test_soul_social_boundary.py`: the `/me/social/` route count goes from 13 to 15. The two new routes are `SoulAPIView`s.

The other test suites:

- **Mobile** (`src/__tests__/circleMedia.test.tsx`, 14 tests, using core's real soul client with the network scripted and the picker as a double):
  - column rule;
  - one square tile per image, in order, from the API host;
  - text-only posts have no grid;
  - large > 2 columns > 3 columns;
  - the viewer opens at the tapped image, the counter follows the page, and it reopens at a different image;
  - a load error shows a caption;
  - light and dark tokens;
  - composer: per-image progress, and 发出 disabled with its reason until everything is done, then the ids are sent in order;
  - a failure blocks posting until retry;
  - removing a failed image needs no request, while removing an uploaded one sends a DELETE;
  - image-only posts;
  - the room limit (9, then only the remainder);
  - no photo access;
  - leaving without posting deletes the uploads.
- **Web:**
  - `ModerationPage.test.tsx`: 5 new tests. 「图 N」 appears on post rows only. The detail tiles are square, not rounded, captioned, and linked; the columns are 1/2/3/3 for 1/4/5/9 images; a text-only post has no grid; a load error shows the caption; a rule-hit row brings its own images.
  - `useSoulMediaUploads.test.ts`: 7 tests.
  - `e2e/moderation.spec.ts`: a new E2E test serves real PNG bytes and asserts the images loaded (`naturalWidth > 0`) and the tiles are square.

### Mutation proofs

Each mutation was applied, the suite was run, and the file was restored.

| Mutation | Result |
|---|---|
| `may_view`, soul branch: drop the `visible_posts_for_soul` check (`return not media.is_deleted`) | **4 red**: hidden-post URL, pending-review, visibility tiers, cross-tenant |
| `_officer_may_view`: replace `scope_to_tenant` with an unscoped lookup | **1 red**: `test_another_civilization_cannot_fetch_or_list` |
| `images.reencode`: remove the magic-byte gate and let Pillow pick any format | **2 red**: the post-image GIF test and the avatar GIF test |
| `images.reencode`: remove only `formats=[sniffed]` | **stays green.** Pillow identifies formats by the same magic numbers, so the restriction cannot change an observable outcome; it only keeps other decoders from ever running. My first version checked "Pillow's format == sniffed" instead; that check also survived its mutation, for the same reason, so it was replaced rather than kept as a check that can never fire. |
| Mobile: remove `!uploads.ready` from 发出's `disabled` | **2 red** |
| Web: remove the grid and the 「图 N」 line from `ReportsReview` | **7 red** |

A real bug found by the tests: the viewer's counter was resynced only through `Modal.onShow`, so opening image 2 could read 「图片 1 / 3」. The page state now lives in an inner component keyed by the opening index.

## Gates

All gates were re-run on the **merged tree** (`a7664a75` = this branch + `origin/main` `07706a5e`), with Node 22.22.2, Python 3.11, SQLite and a throwaway Redis on 6399. The exit code is read directly, never through a pipe.

| Gate | Command | Exit | Count |
|---|---|---|---|
| Backend full suite | `.venv/bin/python -m pytest --tb=short -q` | 0 | **5085 passed / 26 skipped** (41 min), coverage 94.11% |
| ruff | `.venv/bin/ruff check .` | 0 | |
| migrations | `manage.py makemigrations --check --dry-run` | 0 | No changes detected |
| schema | `manage.py spectacular --validate --fail-on-warn` | 0 | 0 warnings / 0 errors; the committed `schema.yml` is byte-identical to the generated one |
| core typecheck | `npm run --workspace packages/core typecheck` | 0 | |
| core lint | `npm run --workspace packages/core lint` | 0 | |
| core test | `npm run --workspace packages/core test` | 0 | 150 tests |
| mobile tsc | `npx tsc --noEmit -p tsconfig.json` | 0 | |
| mobile eslint | `npx eslint . --max-warnings 0` | 0 | |
| mobile jest | `npx jest` | 0 | 273 tests |
| frontend tsc | `npx tsc --noEmit` | 0 | |
| frontend lint | `npm run lint` | 0 | |
| frontend coverage | `npm run test:coverage` | 0 | 187 suites / 3061 tests; all thresholds hold |
| frontend build | `npm run build` | 0 | |
| E2E chromium | `npx playwright test --project=chromium` | 0 | 154 passed / 1 skipped |
| E2E mobile-chrome | `npx playwright test --project=mobile-chrome` | 0 | 150 passed / 5 skipped |
| E2E firefox | — | **not run** | no Firefox build in this environment (`/opt/pw-browsers` has only chromium 1194) |
| egy closed vocabulary | `npx jest egyLexiconRules` | 0 | 22 tests |

**Notes on the gates:**

- **Playwright here needed a scratch config.** The environment ships Chromium build 1194, while `@playwright/test` 1.63 wants 1243. Both projects ran through an uncommitted wrapper config that only sets `launchOptions.executablePath=/opt/pw-browsers/chromium`. No repo file was changed for this.
- **Pre-merge history, for the record:**
  - The first pre-merge mobile-chrome run had one failure, in `judgment-queue.spec.ts:107`, while the machine's load average was about 12. That spec is untouched by this diff. It passed 12/12 alone at low load, and the full project was then green.
  - A core vitest run once timed out (5 s) in `nodeGlobals.test.ts` under the same load, and was green on the re-run.
  - On the merged tree, everything above passed on the first run.
- **Frontend coverage was red on my first run, and the cause was mine.** The web grid imported `mediaUrl` from `api/soul-social`, which pulled the whole soul HTTP client (`soul.ts`, 16% covered) into the web coverage denominator: core `api/` fell from 54.44% to 44.29%. The web admin never holds a soul token, so the import was wrong regardless of coverage. The helpers moved to `domain/postMedia.ts` and the number came back.
- **Two backend tests that were red on the old base are green now.** Before the merge, `test_realm_seed_egy_names_match_the_language_pack` and `test_official_notify_messages_match_the_language_packs[egy]` failed identically on `main` at `74e05f4`, with or without this branch. `origin/main` has since fixed them, and they pass on the merged tree.

## Copy

All three bundles (zh-Hans / en / egy) have `soul_app.circle.media.*` (15 keys plus 4 under `errors.*`) and `social_moderation.review.media_*` (4 keys).

The egy strings use **existing words only**: `Tut` (image), `Hab` (send, for upload), `Ini` (bring/load), `Fekh` (delete, for remove), `Wehem Iri` (retry), `Nen Hab` (failure = Nen + verb), `Er Pehwy` (at most), `Em Smen` (pending), `Wa` (only), `Was` (permission), `Sesen` (required), `Wer` (great).

- The closed-vocabulary test was green before refreshing counts: every word was already in the roots, particles or off-lexicon list.
- `EGY_VOCAB_WRITE=1` was then used only to refresh the usage counts in `egyVocabulary.json` (24 count lines changed, no new word).
- `Nen Ini Tut` satisfies the 「加载 → Ini」 rule; no failure uses `Nen Kheper`.

### egy strings I could not express faithfully

| Key | zh-Hans | egy used | What is lost |
|---|---|---|---|
| `media.errors.too_many_pixels` | 图片尺寸太大 | `Tut Wer` ("image great") | no word for dimensions or pixels; it cannot be told apart from "too large in bytes" except by context |
| `media.uploading`, `media.failed` | 上传中 / 上传失败 | `Em Hab` / `Nen Hab` ("sending" / "not sent") | no upload root; `Hab` is "send" |
| `media.permission` | 需要相册权限才能选图 | `Was Tut: Sesen` ("permission, images: required") | no word for photo library or album |
| `media.remove` | 移除 | `Fekh` ("delete") | no "take out of the selection" distinct from delete |
| `media.waiting` | 图片传完后才能发出 | `Hab Er Khet Tut Neb` ("send after all images") | "finish uploading" is not expressible |
| `media.expired` | 有图片已失效，请重新添加 | `Tut Nen Wenen: Wehem Ini Tut` ("image is not; bring image again") | no word for expired |

## Open questions

1. **Signed-URL lifetime (1 h), and URLs as bearer credentials.** Anyone holding a URL can fetch the image as its viewer until the TTL runs out, *provided that viewer can still see the post*. Shorter TTLs cost more re-fetches; per-fetch re-checks already close the hide/delete case. Is 1 h right?
2. **Serving through Django.** Files go through gunicorn (`FileResponse`). For volume, nginx `X-Accel-Redirect` to an `internal` location would keep the access check and hand the bytes to nginx. It was not added here because it changes the nginx and compose setup.
3. **Client-side downscaling.** Phone photos over 5 MB after `quality: 0.8` are refused, with the reason shown. Adding `expo-image-manipulator` to resize before upload would remove that case, at the cost of another native dependency.
4. **The 「已处理」 list** (`HandledContentViewSet`, a values-UNION) has no image count yet. The brief's list rows (reports and the rule-hit queue) do.
5. **Scheduler registration.** Once celery beat is deployed, `cleanup_orphan_post_media` should become a registry job (`apps/scheduler/registry.py`) instead of host cron.
6. **Needs a real PostgreSQL run.** `attach()` uses `select_for_update` on the pending rows. SQLite has no row locks (see CLAUDE.md), so two concurrent posts racing for the same upload are only guarded by the `post__isnull` filter in the UPDATE path, which is untested here.
