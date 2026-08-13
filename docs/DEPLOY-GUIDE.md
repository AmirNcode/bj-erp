# DEPLOY GUIDE — shipping a new version to the client's server

> Prefer the interactive `./deploy/bj-deploy` assistant in
> [DEPLOY-ASSISTANT.md](DEPLOY-ASSISTANT.md). It wraps this pipeline with architecture isolation,
> migration checksums, verified off-server reset backups, and reconnectable server jobs. This guide
> remains useful background and manual recovery detail.

Open this file every time you want to put an update on the client's server. Follow it top to
bottom.

Every command runs **on your Mac**, in Terminal, from the project folder, unless the step says
otherwise. Start by going there:

```bash
cd /Users/amir/Workspace/bj
```

**Read PART 0 first if you have not deployed since the port change (2026-07-29).** It is a
one-time fix, and without it the deploy stops with an error.

---

## PART 0 — One-time: the server's `.env` needs the new port settings

Skip this only if you have already done it once and a deploy has succeeded since.

Since the app moved off port 443 to **3500**, the server's `.env` must carry three separate
values. Older `.env` files only have `APP_HOST`, and the deploy will stop with:

```
set APP_ORIGIN in .env — re-run ./install.sh once
```

### 0.1 Verify public SSH access

The Mac does not need the client VPN; it reaches the public SSH endpoint directly. The phone still
needs the VPN to open the private application URL.

### 0.2 Look at what the server currently has

```bash
ssh bj "grep -E '^APP_(HOST|PORT|ORIGIN)=' bj-erp-installer/.env"
```

If you see all three lines (`APP_HOST`, `APP_PORT`, `APP_ORIGIN`), you are done — go to PART 1.

If you only see `APP_HOST`, continue.

### 0.3 Add the two missing lines

`APP_HOST` must stay a bare address with **no port** — it is the name on the security
certificate. The port belongs in the other two values.

```bash
ssh -t bj "cd bj-erp-installer && sudo sh -c 'printf \"APP_PORT=3500\nAPP_ORIGIN=https://10.10.10.50:3500\n\" >> .env'"
```

### 0.4 Check it took

```bash
ssh bj "grep -E '^APP_(HOST|PORT|ORIGIN)=' bj-erp-installer/.env"
```

Expect exactly this:

```
APP_HOST=10.10.10.50
APP_PORT=3500
APP_ORIGIN=https://10.10.10.50:3500
```

If `APP_HOST` has `:3500` stuck on the end, remove it:

```bash
ssh -t bj "cd bj-erp-installer && sudo sed -i 's|^APP_HOST=.*|APP_HOST=10.10.10.50|' .env"
```

### 0.5 Apply it

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose -f docker-compose.yml -f docker-compose.client-amd64.yml up -d --force-recreate app"
```

`--force-recreate` matters. A plain restart reuses a container that already has the old address
written into it, and nothing changes.

### 0.6 Confirm the app answers on the new port

```bash
ssh bj "curl -sk -o /dev/null -w 'app: %{http_code}\n' https://10.10.10.50:3500/"
```

Expect `app: 200`.

Then open `https://10.10.10.50:3500` on your phone and log in. **Do a hard refresh** — phones
cache the old page aggressively. On an installed app icon, remove it and re-add it.

---

## PART 1 — One-time setup for deploying (do this once, ever)

### 1.1 Confirm the public server address is reachable

### 1.2 Run the setup script

```bash
./deploy/setup-release.sh
```

Enter the **server's** password when it asks. This is the last time you will need to type it for
connecting. It creates a shortcut named `bj` so later commands do not ask for a password.

### 1.3 Confirm it worked

```bash
ssh -o BatchMode=yes bj 'echo OK'
```

Expect `OK`, with no password prompt. If it fails, verify the public host/port and run 1.2 again.

---

## PART 2 — Deploying a new version (every time)

### 2.1 Start from a clean, synchronized `main`

### 2.2 Save your changes to the repository

```bash
git status
```

If anything is listed:

```bash
git add -A
git commit -m "describe what changed"
git push origin main
```

The guarded assistant refuses any other branch or any modified/untracked file. Commit and push the
reviewed work first; never bypass, weaken, or remove that safety check.

### 2.3 Start Docker Desktop

Open Docker Desktop and wait until it says **Running**. Then check:

```bash
docker info > /dev/null 2>&1 && echo "Docker ready"
```

### 2.4 Run the deploy

Pick a version name. Use today's date:

```bash
./deploy/bj-deploy update client
```

What happens, in order:

1. It checks clean `main`, Docker, public SSH, and your code (lint and unit tests). Anything wrong
   stops it here, before the slow part.
2. It builds the app for the server's processor type. **This takes 5–15 minutes.**
3. It asks for the **server's** password once, for administrator rights on the server.
4. It uploads (~300 MB), backs up the database, applies any database changes, swaps in the new
   app, and checks the app answers.

### 2.5 Confirm it succeeded

The last lines must look like this:

```
 Deployed 2026-08-14
   App:      https://10.10.10.50:3500
   Data:     verified — no table lost rows
```

Both lines matter. `Data: verified` means no table lost rows during the update.

Then open `https://10.10.10.50:3500` on your phone and log in.

**Done.**

If a run fails after the archive was fully uploaded and the deployment code has since been fixed,
the assistant can safely reuse that exact checksum-verified upload while creating a new run:

```bash
./deploy/bj-deploy retry-uploaded FAILED_RUN_ID
```

It refuses an active/successful run, changed migrations or seed data, and any local/server checksum
mismatch. It still takes a fresh backup and runs all migration, health, architecture, and row-count
checks. Do not use `resume` for a terminal `FAILED` run.

---

## PART 3 — Checking everything is running correctly

Run these any time. Nothing here changes anything — they only report.

**Is the app up?**

```bash
ssh bj "curl -sk -o /dev/null -w 'app: %{http_code}\n' https://10.10.10.50:3500/"
```

Expect `app: 200`.

**Is the login service up?** (This is the part that broke during the port change.)

```bash
ssh bj "curl -sk -o /dev/null -w 'auth: %{http_code}\n' https://10.10.10.50:3500/auth/v1/health"
```

Expect `auth: 200`.

**Are all five containers running?**

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose -f docker-compose.yml -f docker-compose.client-amd64.yml ps"
```

Expect `app`, `auth`, `rest`, `db`, `gateway` — all `Up`, with `db` showing `healthy`.

**Which version is live?**

```bash
ssh bj "grep APP_VERSION bj-erp-installer/.env"
```

**Deploy history:**

```bash
ssh bj "cat bj-erp-installer/update.log"
```

**Employee count** — should never drop unexpectedly:

```bash
ssh -t bj "cd bj-erp-installer && sudo bash -c 'set -a; . ./.env; set +a; PGPASSWORD=\"\$POSTGRES_PASSWORD\"; export PGPASSWORD; docker compose -f docker-compose.yml -f docker-compose.client-amd64.yml exec -T -e PGPASSWORD db psql -tAc \"select count(*) from public.profiles\" -U supabase_admin -d postgres'"
```

**Recent app errors:**

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose -f docker-compose.yml -f docker-compose.client-amd64.yml logs --tail 50 app"
```

---

## PART 4 — If something goes wrong

### 4.1 It stopped with an error

| Message contains | Meaning | Action |
|---|---|---|
| `set APP_ORIGIN in .env` | Server `.env` predates the port change | Do PART 0, then deploy again |
| `cannot reach 'bj'` | Public SSH/key setup failed | Verify the public host/port and run setup again |
| `Docker is not running` | Docker Desktop closed | Open Docker Desktop, run 2.4 again |
| `lint failed` / `unit tests failed` | Your code has errors | Fix the code, run 2.4 again |
| `docker build failed` | Build error | Fix the code, run 2.4 again |
| `built 'arm64'` | Wrong processor type | Report it — do not retry blindly |
| `another update is already running` | A deploy is in progress | Wait 5 minutes, run 2.4 again |
| `only ... GiB free` | Server below the 5 GiB release minimum | See 4.4 |
| `the backup is empty` / `not a valid archive` | Database problem | **Stop.** See 4.5 |
| `migration ... failed` | Bad database change | App untouched and still running. Fix it |
| `rolled back to ...` | New version was broken | App restored automatically. See 4.2 |
| `ROWS LOST` | Data missing | **Stop immediately.** See 4.5 |

Anything not in this table: stop and ask before running more commands.

### 4.2 The deploy rolled itself back

The app is already working again on the previous version. To see why the new one failed:

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose -f docker-compose.yml -f docker-compose.client-amd64.yml logs --tail 50 app"
```

Fix the code, then deploy again with a new version name.

Note: an automatic rollback restores the **app**, not database changes. If the failure happened
after a database change was applied, say so when you ask for help.

### 4.3 The app is broken but the deploy said it succeeded

Roll back by hand. Replace `PREVIOUS` with the version you had before:

```bash
ssh -t bj "cd bj-erp-installer && sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=PREVIOUS/' .env && sudo docker compose -f docker-compose.yml -f docker-compose.client-amd64.yml up -d app"
```

Check it recovered:

```bash
ssh bj "curl -sk -o /dev/null -w 'app: %{http_code}\n' https://10.10.10.50:3500/"
```

To see which versions are available on the server:

```bash
ssh bj "sudo docker images bj-erp-app --format '{{.Tag}}'"
```

### 4.4 Server disk is full

The assistant checks this over SSH before lint, build, or transfer. Inspect first; never prune
volumes because `bj-erp_db-data` is the production database.

```bash
ssh bj
df -h /
sudo docker system df -v
sudo du -xhd2 /home/behsazan 2>/dev/null | sort -h | tail -40
```

Remove only reviewed obsolete installer archives/backups or unreferenced images. Do not run
`docker system prune --volumes`, `docker volume prune`, `docker compose down -v`, database reset,
or factory reset merely to free space. Confirm at least 5 GiB available with `df -h /`, then start
a **new** Safe Update; a terminal failed run is not resumable.

### 4.5 Restore the database (last resort — only for data loss)

List the backups, newest first:

```bash
ssh bj "ls -lt bj-erp-installer/backups/"
```

Restore one. Replace `FILENAME` with the file you picked:

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose -f docker-compose.yml -f docker-compose.client-amd64.yml exec -T db pg_restore -U supabase_admin -d postgres --clean --if-exists < backups/FILENAME"
```

Verify:

```bash
ssh bj "curl -sk -o /dev/null -w 'app: %{http_code}\n' https://10.10.10.50:3500/"
```

### 4.6 The page loads but logging in fails

Almost always an address mismatch: the browser loads the page from one address and sends the
login to another. Check what the server thinks its address is:

```bash
ssh bj "grep -E '^APP_(HOST|PORT|ORIGIN)=' bj-erp-installer/.env"
```

`APP_ORIGIN` must be exactly what you type in the phone's browser, **including the port**. If you
change it, apply it with `--force-recreate` (step 0.5) and hard-refresh the phone.

---

## Where things live

| What | Where |
|---|---|
| App address | `https://10.10.10.50:3500` (LAN or company VPN only) |
| Server login | `ssh bj` — the alias set up in PART 1 |
| Server folder | `/home/behsazan/bj-erp-installer` |
| Server settings | `bj-erp-installer/.env` on the server |
| Database backups | `bj-erp-installer/backups/` on the server, copied to `backups/` on your Mac |

---

## RULES

1. **Deploy outside working hours.** The app is down for about a minute.
2. **Never run these on the server** — they erase the database:
   `docker compose down -v` · `docker volume rm bj-erp_db-data`
3. **Never run `npm run cleanup:e2e`** while pointed at the server. It deletes test accounts.
4. **Never commit the `backups/` folder.** It holds employee data and password hashes.
   (It is already ignored by git — leave it that way.)
5. **Never put a port in `APP_HOST`.** It is the security certificate's name. The port goes in
   `APP_PORT` and `APP_ORIGIN`.
6. **One deploy at a time.** Do not start two `bj-deploy` update/reset operations at once.
7. If a deploy fails in a way this guide does not cover, **stop** and ask.
