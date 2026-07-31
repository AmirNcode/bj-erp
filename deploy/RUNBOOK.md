# BJ ERP — Self-Host Runbook / راهنمای نصب و نگهداری

One server, one command, no internet required. English first; خلاصه فارسی در انتها.

## Requirements (give this list to IT)

- A 64-bit **Linux** server (Ubuntu 22.04+ / Debian 12+ recommended)
- **4 GB RAM**, 2 CPU cores, **20 GB** free disk (grows with data)
- **Docker Engine 24+** with the compose plugin (`docker compose version` works)
  — this is the only software to install; everything else is in the bundle
- **One free TCP port** for HTTPS — 443 by default; the installer asks, so IT
  can reserve a different one (e.g. 3500). Port 80 is not used at all.
- A fixed **LAN IP** (or internal DNS name) employees can reach

No internet access is needed on the server — all container images ship inside
the bundle.

## Install

```bash
tar xzf bj-erp-installer-<version>.tar.gz
cd bj-erp-installer
sudo ./install.sh
```

The installer asks two questions — the server address (IP/domain) and a
password for the first admin — then does everything else. At the end it prints
the app URL and writes `bj-root-ca.crt` (see next section).

First login: code **`admin`** + the password you chose. Then create real
employees in the app (Manage → Employees), enter the official holidays
(Manage → Settings), and allocate leave balances.

## Trusting the certificate on phones (one-time, per device)

The app serves HTTPS with its own private certificate authority. Each phone
must trust `bj-root-ca.crt` once; afterwards the app installs and stays
logged in like any normal app.

- **Android:** copy the file to the phone → Settings → Security → Encryption &
  credentials → Install a certificate → **CA certificate** → choose the file.
- **iPhone:** send the file (AirDrop/em­ail) → open it → Settings → Profile
  Downloaded → Install → then Settings → General → About → Certificate Trust
  Settings → enable full trust for it.

Then open the `APP_ORIGIN` from `.env` in the phone browser — the full address
including the port when it is not 443, e.g. `https://10.10.10.50:3500` — and
"Add to Home Screen" / "Install app". There is no http:// redirect: typing the
bare address without `https://` and the port will not reach the app.

## Backups (do this on a schedule)

Every release already takes a verified backup automatically (see *Updating the
app*), kept in `bj-erp-installer/backups/` — newest 14 — and copied to the
developer's Mac. The command below is for **scheduled backups between
releases**, which you still need.

The database image's superuser is `supabase_admin`, and it requires password
auth even over the local socket — hence the `.env` sourcing:

```bash
cd bj-erp-installer
sudo bash -c 'set -a; . ./.env; set +a
  docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    pg_dump -U supabase_admin -d postgres -Fc' > backup-$(date +%F).dump
```

**Always verify a dump before trusting it** — a failed dump leaves a file that
looks fine but restores nothing:

```bash
sudo docker compose exec -T db pg_restore -l < backup-$(date +%F).dump | head
```

Expect a table-of-contents listing (`profiles`, `leave_requests`, …). An empty
result means the backup is worthless — investigate before relying on it.

Copy the dump files off the server. Also back up the `.env` file **once**
(it holds the secrets; without it a restore cannot decrypt logins).

**Restore** (same `.env`):

```bash
cd bj-erp-installer
sudo docker compose exec -T db pg_restore -U supabase_admin -d postgres \
  --clean --if-exists < backup-YYYY-MM-DD.dump
```

## Updating the app

An update ships **only a new app image** — never the full installer bundle. The
database, its volume, and the four service images stay exactly as they are.

**Step-by-step operator instructions: [`../docs/DEPLOY-GUIDE.md`](../docs/DEPLOY-GUIDE.md).**

### The pipeline

Releases are built on the developer's Mac and pushed to the server — the server
needs no internet, no git, and no build toolchain, exactly like the original
installer. One command, with the company VPN connected:

```bash
./deploy/release.sh 2026-08-14
```

`deploy/release.sh` (Mac) runs lint + unit tests, cross-builds the image for
**linux/amd64** and verifies the architecture, compresses it, ships it with
resumable `rsync`, then triggers `deploy/update.sh` on the server.

`deploy/update.sh` (server, re-shipped with every release) takes a lock, checks
disk and database health, takes a **verified** `pg_dump` backup, records row
counts, loads the image, replays migrations, swaps only the `app` container,
health-checks for 90s, **re-checks row counts**, and **rolls back automatically**
if the app does not come up. `release.sh` then copies the backup to the Mac.

One-time setup on a new machine (SSH key + `bj` host alias):

```bash
./deploy/setup-release.sh
```

### Manual fallback (if the scripts are unavailable)

```bash
# on the Mac — the cross-build is mandatory; an arm64 image will not start
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker build -f deploy/Dockerfile -t bj-erp-app:manual .
docker image inspect bj-erp-app:manual --format '{{.Architecture}}'   # must print amd64
docker save bj-erp-app:manual -o dist/bj-erp-app.tar
scp -P 2222 dist/bj-erp-app.tar <user>@<server>:~/bj-erp-installer/
```

```bash
# on the server — back up FIRST, then load and restart
cd bj-erp-installer
sudo docker load -i bj-erp-app.tar
sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=manual/' .env
sudo docker compose up -d app
```

If the release includes new migrations, copy the `*.sql` files into
`migrations/` first and run `sudo ./install.sh` instead of `compose up`.

Re-running `install.sh` reuses the existing `.env` (secrets are **not**
regenerated), reuses the existing database volume, re-applies the baseline seed
as a no-op, and skips admin creation because the admin already exists.

> **The migrations are NOT idempotent — verified 2026-07-31, not assumed.**
> Replaying all 38 against a populated database fails **9** of them, starting at
> file #1 (`20260623120001_core.sql`, a bare `create type public.app_role`).
> Five were never guarded; four became unreplayable when the days→minutes
> conversion dropped columns and the serial counter was re-keyed.
>
> Consequences, in order of how likely you are to hit them:
> - **A fresh install is fine.** All 38 apply cleanly in order to an empty
>   database, and the resulting state is correct — checked on a throwaway
>   `supabase/postgres:15.8.1.085`, including the seeded leave-type flags that
>   migrations cannot set because they run *before* `seed.sql`.
> - **`update.sh` cannot deliver a schema change to an existing install.** It
>   replays every file under `psql -v ON_ERROR_STOP=1 || fail`, so it aborts on
>   file #1. It aborts *safely* — the app is not restarted and the verified
>   backup is untouched — but the upgrade simply does not happen.
> - **Re-running `install.sh` over an existing database** hits the same wall.
>
> Fixing this is tracked in `docs/TASKS.md`. It must be done before the first
> incremental update once the client holds real data.

### Rollback

`docker load` keeps the previous image if it was tagged with a version. Tag
before each update (`bj-erp-app:2026-07-25`), then roll back by setting
`APP_VERSION` in `.env` to that tag and running `docker compose up -d app`.

## Data safety — what an update does NOT touch

**Employee records, leave requests, balances, holidays and login passwords all
live in the Postgres volume `bj-erp_db-data`, which is completely independent of
the app image.** Replacing the app image cannot affect them.

| Operation | Effect on data |
|---|---|
| `docker compose up -d app` (new image) | **None** — app container only |
| `docker compose restart` / `down` / `up -d` | **None** — volume persists |
| `sudo ./install.sh` (re-run) | **None to data** — secrets reused, admin skipped. But it **aborts on the first migration** against an existing database (see above) |
| Applying a new migration | Adds/alters schema; existing rows preserved |
| `docker compose down -v` | **DESTROYS the database** — never run this |
| `docker volume rm bj-erp_db-data` | **DESTROYS the database** — never run this |

Why re-running the installer is non-destructive, verified against the SQL:

- `seed.sql` contains **no** `delete`/`truncate`/`drop table`; every insert is
  guarded by `on conflict do nothing` or `where not exists`, so a second run is
  a no-op against a configured database.
- The only top-level `delete` statements in the migrations
  (`20260702120001_hardening.sql`) are one-time **de-duplication** of
  `work_settings` / `holidays` before their unique indexes are created. Once the
  indexes exist duplicates cannot occur, so on every later run they match zero
  rows. They never touch employee, leave, or ledger tables.
- `sql/init/00-init.sh` runs **only on an empty data volume** (Postgres
  `docker-entrypoint-initdb.d`), so it cannot re-run on an installed system.
- `bootstrap_admin.sql` exits early when the admin already exists — an update
  never resets the admin password.

**The one destructive function to know about:** `app_cleanup_e2e_users()` (an
admin-only RPC used by the automated test suite, invoked via
`npm run cleanup:e2e`) deletes accounts whose employee code matches test
patterns — including any generated code whose personnel number starts with
`999`. `install.sh` never calls it. **Never run the test cleanup against the
production server**, and keep `999…` personnel numbers reserved for testing.

Take a backup before any update that carries migrations (see *Backups* above);
it costs seconds and makes the update reversible.

## Later: automating deploys (design, not yet built)

The server sits on the LAN behind NAT, so it should **pull** rather than be
pushed to. The intended design, when this is worth building:

1. A read-only GitHub deploy key on the server, and a clone of the repo
   (the server has outbound internet, so it can build its own image — no more
   ~400 MB image transfers).
2. A `deploy.sh` on the server that runs: `git fetch` → check out the target
   **tag** → `docker build` → sync any new `migrations/*.sql` → `install.sh` →
   health-check `https://<APP_HOST>/` → roll back to the previous image tag if
   the health check fails.
3. Trigger by pushing a `deploy-*` git tag, keeping every release a deliberate
   act. A `systemd` timer polling for new tags can make it hands-off later.

Deliberately **not** chosen: auto-deploying every push to `main` (a bad commit
would reach a live HR system with no human gate), and registry-based pulls
(container registries are frequently unreachable from Iran — the reason this
package ships images as tar files in the first place).

**Prerequisite:** the repository must be the source of truth. Do not enable
git-based deploys while the deployed image is built from an uncommitted working
tree — the server would silently roll back to whatever is on `main`.

## Day-2 operations

| Task | Command (from `bj-erp-installer/`) |
|---|---|
| Status | `sudo docker compose ps` |
| Logs (app / auth / db) | `sudo docker compose logs -f app` (or `auth`, `db`, `rest`, `gateway`) |
| Restart everything | `sudo docker compose restart` |
| Stop / start | `sudo docker compose down` / `sudo docker compose up -d` |

`install.sh` runs as root, so `.env` is owned by root with mode `600` (it holds
every secret). Docker Compose reads `.env` even just to show status, so these
commands need `sudo`. To run them as your own user instead, take ownership once:
`sudo chown $USER:$USER .env` — it stays mode `600`.

Note `docker compose down` stops the containers but **keeps** the database
volume. Never add `-v`.

## Rules — read before touching anything

- **Never bump one image version alone.** The five services are tested as a
  set (the app writes the auth service's tables directly — versions must move
  together). Updates come as a new bundle from the developer.
- **Never delete the `db-data` volume** unless you intend to erase all data.
- **Keep `.env` private and backed up** — it contains every secret.
- The database enforces all permissions (Row-Level Security); there is no
  "master key" in the app container, and the `SERVICE_ROLE_KEY` in `.env` is
  for emergency database API access only — never put it in the app.

## Troubleshooting

- **Site unreachable:** `docker compose ps` — all five services "running"?
  Is `APP_PORT` blocked by a firewall? Are you using the full `APP_ORIGIN`
  (`https://`, and the port when it is not 443)?
- **Login fails for everyone but the page loads:** `APP_ORIGIN` in `.env`
  disagrees with the address the browser is on — most often the published port
  was changed without updating it. The browser bundle calls `APP_ORIGIN`
  verbatim, so it tries a port nothing listens on. Fix `.env`, then
  `docker compose up -d --force-recreate app auth` — a plain `restart` is not
  enough, because the URL is substituted into the app's files at container
  creation.
- **Login fails for everyone:** check `docker compose logs auth`.
- **Phone won't install the app:** the certificate step was skipped — see
  "Trusting the certificate on phones".
- **`install.sh` fails at migrations:** run `docker compose logs db`; the
  failing SQL file is printed by the installer.

---

## خلاصه فارسی

**نصب:** فایل بسته را باز کنید و `sudo ./install.sh` را اجرا کنید. دو سؤال
می‌پرسد: آدرس سرور و رمز مدیر. در پایان آدرس برنامه چاپ می‌شود.

**ورود اول:** کد پرسنلی `admin` و رمزی که وارد کردید. سپس کارمندان را از بخش
مدیریت بسازید و تعطیلات رسمی را ثبت کنید.

**گوشی‌ها:** فایل `bj-root-ca.crt` را یک‌بار روی هر گوشی نصب کنید
(تنظیمات ← امنیت ← نصب گواهی CA)، بعد برنامه را از مرورگر «به صفحه اصلی
اضافه» کنید.

**پشتیبان‌گیری:** دستور `pg_dump` بالا را به‌صورت منظم اجرا و فایل‌ها را جای
امن نگه دارید. فایل `.env` را هم یک‌بار پشتیبان بگیرید.

**به‌روزرسانی:** نسخهٔ جدید با یک دستور از کامپیوتر توسعه‌دهنده ارسال و نصب
می‌شود (`./deploy/release.sh`). پیش از هر به‌روزرسانی، به‌صورت خودکار از
دیتابیس backup گرفته و صحت آن بررسی می‌شود؛ سپس تعداد رکوردهای هر جدول قبل و
بعد مقایسه می‌شود و اگر داده‌ای کم شده باشد، عملیات با هشدار متوقف می‌شود. اگر
نسخهٔ جدید بالا نیاید، سیستم خودش به نسخهٔ قبلی برمی‌گردد (rollback).

فقط image برنامه عوض می‌شود، نه دیتابیس. اطلاعات کارمندان، مرخصی‌ها، مانده‌ها و
رمزها در volume دیتابیس (`bj-erp_db-data`) ذخیره شده و با به‌روزرسانی برنامه
**پاک نمی‌شوند**. اجرای دوبارهٔ `install.sh` هم بی‌خطر است (migration ها
idempotent هستند و secret ها دوباره ساخته نمی‌شوند).

**هشدار:** دستورهای `docker compose down -v` و `docker volume rm bj-erp_db-data`
کل دیتابیس را **حذف می‌کنند**. هرگز اجرا نکنید. قبل از هر به‌روزرسانی که
migration دارد، یک backup بگیرید.

**قانون مهم:** نسخهٔ سرویس‌ها را جداگانه عوض نکنید؛ به‌روزرسانی فقط با بستهٔ
جدید از توسعه‌دهنده انجام می‌شود.
