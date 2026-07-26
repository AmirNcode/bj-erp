# DEPLOY GUIDE — shipping a new version to the client's server

Follow top to bottom. Every command runs **on your Mac**, in Terminal, from the project folder,
unless it says otherwise.

Project folder:

```bash
cd /Users/amir/Workspace/bj
```

---

## PART 1 — One-time setup (do this once, ever)

### 1.1 Connect the company VPN

Turn on the L2TP VPN on your Mac or phone. The server is unreachable without it.

### 1.2 Run the setup script

```bash
./deploy/setup-release.sh
```

Enter the **server password** when `ssh-copy-id` asks. This is the last time you will need it.

### 1.3 Confirm it worked

```bash
ssh -o BatchMode=yes bj 'echo OK'
```

Expect `OK` with no password prompt. If it fails, re-check the VPN and re-run 1.2.

---

## PART 2 — Deploying a new version (every time)

### 2.1 Connect the company VPN

### 2.2 Commit your changes

```bash
git status
```

If anything is listed:

```bash
git add -A
git commit -m "describe what changed"
git push origin main
```

### 2.3 Start Docker Desktop

Open Docker Desktop and wait until it says **Running**. Then verify:

```bash
docker info > /dev/null 2>&1 && echo "Docker ready"
```

### 2.4 Deploy

Pick a version name — use today's date:

```bash
./deploy/release.sh 2026-08-14
```

Then:

1. Wait. Build takes **5–15 minutes** (it emulates the server's CPU).
2. When it asks for a password, type the **server's** password (for `sudo`).
3. Wait for the upload (~300 MB) and the health check.

### 2.5 Confirm success

The last lines must show:

```
 Deployed 2026-08-14
   App:      https://10.10.10.50
   Data:     verified — no table lost rows
```

Then open `https://10.10.10.50` on your phone and log in.

**Done.**

---

## PART 3 — If something goes wrong

### 3.1 It stopped with an error — what do I do?

| Message contains | Meaning | Action |
|---|---|---|
| `cannot reach 'bj'` | VPN off | Connect the VPN, run 2.4 again |
| `Docker is not running` | Docker Desktop closed | Open Docker Desktop, run 2.4 again |
| `lint failed` / `unit tests failed` | Your code has errors | Fix the code, run 2.4 again |
| `docker build failed` | Build error | Fix the code, run 2.4 again |
| `built 'arm64'` | Wrong CPU type | Report it — do not retry blindly |
| `another update is already running` | A deploy is in progress | Wait 5 minutes, run 2.4 again |
| `only 3GB free` | Server disk full | See 3.4 |
| `the backup is empty` / `not a valid archive` | Database problem | **Stop.** See 3.5 |
| `migration ... failed` | Bad SQL | App untouched and still running. Fix the migration |
| `rolled back to ...` | New version was broken | App restored automatically. See 3.2 |
| `ROWS LOST` | Data missing | **Stop immediately.** See 3.5 |

Anything not in this table: stop and ask before running more commands.

### 3.2 The deploy rolled itself back

The app is already working again on the previous version. To see why the new one failed:

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose logs --tail 50 app"
```

Fix the code, then deploy again with a new version name.

### 3.3 The app is broken but the deploy said it succeeded

Roll back manually. Replace `PREVIOUS` with the version you had before:

```bash
ssh -t bj "cd bj-erp-installer && sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=PREVIOUS/' .env && sudo docker compose up -d app"
```

Check it recovered:

```bash
ssh bj "curl -sk -o /dev/null -w 'app: %{http_code}\n' https://10.10.10.50/"
```

Expect `app: 200`.

To see which versions are available:

```bash
ssh bj "sudo docker images bj-erp-app --format '{{.Tag}}'"
```

### 3.4 Server disk is full

```bash
ssh -t bj "cd bj-erp-installer && sudo docker image prune -f && df -h /"
```

Then run 2.4 again.

### 3.5 Restore the database (last resort — data loss only)

List the backups:

```bash
ssh bj "ls -lt bj-erp-installer/backups/"
```

Restore one. Replace `FILENAME` with the file you picked:

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose exec -T db pg_restore -U supabase_admin -d postgres --clean --if-exists < backups/FILENAME"
```

Verify:

```bash
ssh bj "curl -sk -o /dev/null -w 'app: %{http_code}\n' https://10.10.10.50/"
```

---

## PART 4 — Checks you can run any time

App is up:

```bash
ssh bj "curl -sk -o /dev/null -w 'app: %{http_code}\n' https://10.10.10.50/"
```

All five containers running:

```bash
ssh -t bj "cd bj-erp-installer && sudo docker compose ps"
```

Which version is live:

```bash
ssh bj "grep APP_VERSION bj-erp-installer/.env"
```

Deploy history:

```bash
ssh bj "cat bj-erp-installer/update.log"
```

Employee count (should never drop unexpectedly):

```bash
ssh -t bj "cd bj-erp-installer && sudo bash -c 'set -a; . ./.env; set +a; docker compose exec -T -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" db psql -tAc \"select count(*) from public.profiles\" -U supabase_admin -d postgres'"
```

---

## RULES

1. **Deploy outside working hours.** The app is down for about a minute.
2. **Never run these on the server** — they erase the database:
   `docker compose down -v` · `docker volume rm bj-erp_db-data`
3. **Never run `npm run cleanup:e2e`** while pointed at the server. It deletes test accounts.
4. **Never commit the `backups/` folder.** It holds employee data and password hashes.
   (It is already in `.gitignore` — leave it there.)
5. **One deploy at a time.** Do not run `release.sh` twice at once.
6. If a deploy fails in a way this guide does not cover, **stop** and ask.
