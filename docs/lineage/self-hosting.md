# Self-hosting Allmaps for Lineage

Working plan for running Allmaps inside Lineage's `georef` component. What `georef` takes in
and puts out is in the controlplane's
[components.md](https://github.com/line-age/controlplane/blob/main/components.md#georef);
this file says what we need from Allmaps to get there, and how we'd do each part.

Status: draft, being built up in `lineage/self-hosting-plan`. Upstream baseline is
`allmaps/allmaps` `develop` at `f3633bf` (2026-10-21). Upstream conversation:
[allmaps/allmaps#672](https://github.com/allmaps/allmaps/discussions/672).

Like the rest of Lineage, this is software, not deployment configuration (L-0006): no
hostnames, cluster names or environment values.

## What we need from Allmaps

| Piece | Path | Need | Why |
| --- | --- | --- | --- |
| Editor | `apps/editor` | yes | georeferencing, and the georeferencing review tool (L-0004) |
| Live API | `apis/live` | yes | the editor saves only through its ShareDB websocket |
| REST API | `apis/rest` | partly | projections, image and map lookups, map versions; organizations only feed editor suggestions |
| Annotations API | `apis/annotations` | yes | annotation permalinks, which are `georef`'s output |
| Tile Server | `workers/tileserver` | yes | warped XYZ tiles, how a sheet opens in QGIS |
| Viewer | `apps/viewer` | later | the editor links to it; links can be switched off until we have one |
| Preview | `workers/preview` | later | thumbnails and social cards; same |
| Console | `apps/console` | maybe | better-auth admin UI (users, roles, organizations) |
| here, explore, latest, tiles, homepage | `apps/*` | no | |

## What upstream already gives us

As of `f3633bf`:

- The API server is public (`apis/`, since 2026-03-17).
- Live is Node (Express plus `ws`). REST and Annotations are runtime-neutral Elysia
  `createApp` factories; only `src/worker.ts` and the Neon driver tie them to Cloudflare.
- Databases can be injected (postgres.js), so plain Postgres works. GitHub login is optional.
- `tools/apis` runs all three APIs in one Node process. It is dev-only (it rejects
  non-localhost URLs) but shows the wiring.
- Editor and viewer read config at runtime (`$env/dynamic/public`).
- Tile Server and Preview use no Cloudflare bindings except Preview's `ASSETS`.

## Workstreams

Each one: what's missing, where the fix should live (upstream or ours), and when it's done.
Upstream answers to #672 decide the "where".

### 1. Database

- PostGIS must exist before migrations run; no migration creates it.
- A fresh database needs `drizzle-kit migrate`; `migrate-ci.ts` refuses a database with no
  history.
- Two seed migrations insert allmaps.org's organizations. Decide whether we keep, skip or
  replace them.
- Migrations run as a Kubernetes Job before the APIs roll.

### 2. APIs on Node

- REST and Annotations: a Node entrypoint next to `worker.ts` (#672 item 1), modelled on
  `tools/apis/src/context.ts`: postgres.js db, `createAuth(env, db)`, `nodeAdapter()`.
- Never let auth fall back to `getNeonHttpDb`; always pass the db in.
- Live: runs as is. One replica only, because ShareDB pub/sub is in memory and snapshot
  writes are debounced in-process. Redis pub/sub if we ever need more.
- One image with three commands, or three images. TBD.

### 3. Authentication

- `packages/db/src/auth.ts` hardcodes the `allmaps.org` cookie domain and `trustedOrigins`
  (#672 item 2).
- Login is GitHub, which upstream already supports. Editing is limited to members of a
  configurable list of GitHub team ids: request the `read:org` scope and check membership at
  login (and on each session refresh, so removal from a team takes effect).
- OIDC (#672 item 3) is low priority now. It comes back if hosting moves somewhere with its
  own SSO.
- Live has no authentication: websocket, `POST /maps` and `PATCH /maps` accept anyone.
- REST `PUT /images/:id` and `PUT /manifests/:id` have no auth either. The editor calls them.
- The editor has no login UI and saves anonymously.

Two ways to close the Live gap (#672 item 4):

1. Upstream: Live resolves the better-auth session at the websocket handshake and refuses
   anonymous writes when configured.
2. Ours: an authenticating proxy in front of the editor, Live and REST writes, on one site,
   so the browser sends the session cookie on the websocket handshake.

### 4. Attribution and history

Lineage requirement 4: every saved version, with who saved it and when.

- Every ShareDB op is kept (`ops` table), and `maps` keeps versions (debounced 5-10 s).
- Neither records a user. Ops carry only a connection id.
- Fix: ShareDB `submit` middleware writes the user id into the op metadata; optionally a
  user column on `maps`. Upstream or ours depending on item 4's answer.

### 5. Editor and viewer builds

- `adapter-node` chosen by an env var (#672 item 5). About two lines per app; precedent in
  `tools/iiif-server`.
- Third-party URLs to make settings or switch off:
  - fonts and map glyphs from `fonts.allmaps.org`
  - the basemap's built-in Protomaps key, Esri and OSM presets, Mapterhorn terrain
  - the production umami id in `wrangler.jsonc`
  - the viewer's direct links to `editor.allmaps.org` and `annotations.allmaps.org`
  - the editor's `dns.google` check on fetch errors
- `schemas.allmaps.org` and `api.allmaps.org/projections/...` appear in annotation output as
  identifiers. Leave them; changing them changes the format.
- Editor suggestions and examples come from REST organizations. Empty unless we seed some.

### 6. Tile Server and Preview on workerd

- Bundle with `wrangler deploy --dry-run --outdir`, wrap in a workerd config (#672 item 6).
- The Cache API does nothing in workerd without a cache service, and `cf` fetch options are
  ignored. Put a caching proxy in front.
- Preview's `ASSETS` binding becomes a workerd disk service over `public/`.
- The build needs Rust and `wasm-pack` (`packages/render-wasm`).
- QGIS: use the `.png` XYZ template; `tiles.json` advertises only `.webp`.

### 7. Constraints on the IIIF image server

Not Allmaps work, but it falls out of it (georef#1):

- The WASM renderer decodes JPEG sources only, so the image server must serve JPEG tiles.
- The tile server fetches `info.json` and tiles server-side, so it needs network access to
  the image server, including for scans that need a login to read.

### 8. Images and charts

- Container images per deployable, built in our CI unless upstream wants them (#672 item 7).
- Generic Helm charts in `line-age/deploy` (L-0009).

## Open questions

- Upstream's answers to #672, item by item.
- Fork policy: what we carry while upstream PRs are open, and how we rebase.
- Do we need the console, or is user and role admin done entirely through GitHub teams?
- Team gate in better-auth (upstream-friendly) or at a proxy (oauth2-proxy matches teams by
  slug, not id)?
- How annotations from allmaps.org get imported (the CLI, or an import route).

## Sequencing

TBD.
