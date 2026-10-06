# Deploy BJ on Liara

## Current plan and access

One Debian 12 VM runs Next.js, Postgres, GoTrue, PostgREST and Caddy. No Liara
PaaS app, DBaaS or Supabase one-click installation is used. Start with a fresh
database; the client's existing installation and data are separate.

- VM: `bj-vm` / `debian-bj-vm`, 1 vCPU, 2 GB RAM, 20 GB SSD.
- Public address: `https://bjeng.app` (configured 2026-10-06).
- VM/SSH address remains `62.60.191.132`; root DNS A record points there.
- Administrator SSH from BigMac: `ssh liara-bj-vm` (port **32222**).
- Installation: `/opt/bj-erp`; backups: `/var/backups/bj-erp`.
- Docker 29.8.1, Compose 5.5.1, 2 GiB swap, Chrony, log rotation and firewall
  are installed. Only SSH 32222 and public HTTP/HTTPS 80/443 are allowed inbound.
- Docker Hub access uses `https://docker-mirror.liara.ir` because direct layer
  downloads returned HTTP 403. Application images arrive over SSH.
- Checkout quote: 1,475,000 tomans/month plan + 200,000 IPv4 + 10% VAT =
  1,842,500 before traffic. Support says powered-off plan cost is one third,
  with IPv4 billed separately. Check current account billing for actual costs.

Status and deployment evidence are recorded in `docs/AGENT-LOG.md`. The first
release is installed and browser-tested. Push-to-main deployment is enabled and
verified: [run 36806814730](https://github.com/AmirNcode/bj-erp/actions/runs/36806814730)
deployed `a0cb7b1bc6534724b8c7f43ad016ee71c8981b12`. Use the journal and Actions
run status for later releases.

## Explicit deployment configuration

Use `docker-compose.yml` plus `docker-compose.liara.yml`, with project `bj-erp`.
The Liara override publishes only ports 80 and 443 and selects Linux amd64
images. Database, Auth, PostgREST, Next.js and Caddy's internal port 8080 have
no host port mappings. Docker-published ports can bypass UFW; maintain this rule.

`deploy/liara/Caddyfile` uses Caddy **2.11.4**, an explicit Let's Encrypt issuer,
HTTP-01 validation and the `shortlived` profile. IP certificates last about six
days and Caddy renews them automatically. Keep `bj-erp_caddy-data` persistent,
ports 80/443 reachable, and the VM running for renewal. Staging IP issuance and
renewal scheduling were verified before requesting a production certificate.
Production issuance and public TLS trust were also verified on 2026-09-30;
the first scheduled renewal has not occurred yet.
See [Let's Encrypt IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)
and [Caddy TLS configuration](https://caddyserver.com/docs/caddyfile/directives/tls).

The public gateway replaces `X-BJ-Client-IP`; server-side Auth calls forward it
through the private listener. The pinned GoTrue rate setting is per five minutes
with burst capacity 30; office users behind one public IP share the bucket.

HTTPS currently uses HTTP/1.1 for compatibility: direct HTTP/2 redirect chains
from Canada stalled, while HTTP/1.1 and HTTP/2 through an SSH tunnel succeeded.
Some reused HTTP/1.1 connections also stalled during browser asset/login requests.
Closing public connections after each response made the complete browser smoke
test pass. TLS verification remains enabled; private service connections still
reuse connections. This adds TLS handshake overhead. Re-evaluate these settings
after the company hostname is connected; the exact upstream cause is unconfirmed.

Do not run `bj-deploy ... client` for Liara: that target intentionally retains
the client's original server defaults. Do not use `liara deploy` for this VM.

## Releases and GitHub Actions

`.github/workflows/deploy-liara.yml` runs on pushes to `main` and manual dispatch:

1. Install the lockfile, audit runtime dependencies, run lint/unit/deploy tests.
2. Build the actual Linux amd64 image with placeholder public configuration.
3. Package the image and explicit deployment files, canonical migrations and
   seed. No real `.env`, SSH key, database backup or admin password is included.
4. Store the public-code release artifact for three days. Database backups must
   never be uploaded as public-repository Actions artifacts.
5. When repository variable `LIARA_DEPLOY_ENABLED=true`, deploy through the
   `liara` environment. It needs secrets `LIARA_SSH_KEY` and `LIARA_KNOWN_HOSTS`.
   The known host is pinned from the already verified server key, not accepted
   blindly during CI. Only `main` is allowed to use this environment.

CI uses a dedicated `bj-deploy` account. It can upload to
`/var/lib/bj-deploy/incoming`, and sudo permits only the root-owned
`/usr/local/sbin/bj-liara-apply` entrypoint with a validated commit SHA. That
entrypoint verifies the archive checksum, rejects unsafe members, serializes
releases and refuses unexpected infrastructure changes. Protect repository
write access: deployment code can affect the VM and database.

The first launch was installed and verified manually. Subsequent releases take a
private database dump, verify its archive structure, apply only pending
checksum-verified migrations, switch the app image, and check service/public
health. Failed service health restores the prior app image. **Database migrations
are forward-only: image rollback does not reverse schema changes.** Use the
pre-deploy dump and a reviewed restore procedure for database recovery.

Infrastructure changes (Compose, Caddy, Postgres init) require explicit operator
application and verification before CI resumes. Application and migration changes
can deploy automatically. No database reset is part of this workflow.

To build a reviewed committed release manually:

```bash
bash deploy/liara/package-release.sh "$(git rev-parse HEAD)"
```

Artifacts are under `.bj-deploy/liara/artifacts/<commit>/`. The clean-tree
requirement prevents a release from silently omitting local work.

## Backups, credentials and operations

The daily backup timer is enabled. The first backup was restored into a disposable
instance of the same Postgres image; all 33 application, Auth and migration-ledger
tables matched by row count and content checksum. This was a recovery rehearsal
against an idle fresh database, not a restore over the live installation.

A fresh installation generates unique secrets and a random initial admin
password, saved on the VM at `/root/bj-liara/admin-password` (root only). The
login code is `admin`. No public demo passwords or sample employee accounts are
loaded. Save the initial password securely and change it after first login.

`bj-liara-backup.timer` runs `liara/backup.sh` daily at approximately 02:00 UTC.
It retains 14 days of full logical database dumps, including Auth and application
data. Pre-deploy backups also remain in `/opt/bj-erp/backups`. These do not back
up `.env` or Caddy certificate storage; preserve secrets separately. `pg_restore
-l` checks archive structure only: validate recovery by restoring a disposable
copy. Maintain off-server copies; local VM backups alone cannot survive VM loss.

For the pinned `supabase/postgres:15.8.1.085`, full dump restoration needs one
extension-specific repair: `pg_dump` records the ACL of the dynamically generated
`graphql_public.graphql` wrapper without its definition. Make a `pg_restore -l`
list, exclude only its ` ACL graphql_public FUNCTION graphql(` entry, restore
with that list and `--clean --if-exists --exit-on-error --single-transaction`,
then run `liara/restore-graphql.sql` as `supabase_admin`. The helper restores the
wrapper, original grants and extension membership. **Do not remove all ACLs.**
This exact procedure passed the isolated restore rehearsal. Revalidate it before
changing the Postgres image. A live database restore requires a separate recovery
plan and explicit authorization; never point a rehearsal at `bj-erp-db-1`.

```bash
cd /opt/bj-erp
sudo docker compose -f docker-compose.yml -f docker-compose.liara.yml ps
sudo systemctl list-timers bj-liara-backup.timer
sudo bash liara/backup.sh
```

Monitor memory/swap, free disk and certificate expiry during the test rollout.
Builds run off the VM. Upgrade capacity if measured use warrants it. Release
artifacts and old images also consume the small disk; retain recovery images
and remove superseded artifacts deliberately rather than pruning all volumes.

## Company domain

`bjeng.app` is delegated to Liara nameservers with a root A record for
`62.60.191.132`. The live `.env` now sets `APP_HOST=bjeng.app` and
`APP_ORIGIN=https://bjeng.app`. Auth/app/gateway were recreated, and Caddy issued
a trusted domain certificate using the existing short-lived ACME profile and
persistent storage. Deployment health checks use the domain; SSH retains the IP.
The app and API share one origin; no separate API subdomain is needed. `www` is
not configured. Existing IP-address browser sessions do not transfer to the domain.
For future hostname changes, update these settings, recreate URL-dependent
containers, verify TLS/login, and update both workflow and installed release health checks.
