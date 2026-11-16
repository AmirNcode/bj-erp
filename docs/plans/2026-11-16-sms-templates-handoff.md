# Handoff: SMS pattern templates (FR-78), written 2026-11-16

Paste the prompt below into a new session.

---

You are continuing the SMS notification work (FR-78) in the bj repo (`/Users/amir/Workspace/bj`). Read
`CLAUDE.md` first, then the newest 5 entries of `docs/AGENT-LOG.md` (all from 2026-11-16, all about
SMS). Then read `docs/TASKS.md` (the ⏸ SMS item) and §3.4a + §3.6 of
`docs/specs/2026-11-03-admin-panel-sms-design.md`. Use the agent-log template for your own entry before
you finish.

## Where things stand

- **Deployed on bjeng.app** (main @ 3f498f6). Migrations `20261116150000`–`20261116180000`:
  - Melipayamak "web service" connection: panel username + panel API key → `rest.payamak-panel.com/api/SendSMS/*`, JSON. This is the default; the old console key is the other option.
  - A refused sign-in pauses live sending (`sms_settings.auth_error`).
  - PR #17 F4: only connect/DNS/TLS errors are retried; timeouts and 5xx fail as "not resent".
  - F5: each row is handled in its own exception block.
  - Melipayamak refusal codes show in plain English plus the raw reply.
  - Every free-text SMS gets a first line from `header_label` and a last line from `site_label`.
- **Live settings** (Admin › SMS): Live, Username + API key, From the sender line (`50004001293778`,
  promotional), first line «سامانه پرسنلی بهسازان جنوب», last line «لغو11» (Melipayamak requires it on line
  texts: error 15). Links are refused (code 14), so there is no `bjeng.app` in the texts.
- **Problem:** the free-text tests were accepted by Melipayamak ("Sent", recId), but nobody received them.
  - Likely cause 1: advertising texts are held at night (~21:00–08:00; tests went out 20:57–21:26 Tehran).
  - Likely cause 2: 09163066264 got code 11, probably because it blocks ads.
  - The owner put SMS **on hold** until Melipayamak approves pattern templates. Pattern texts go through the shared service line, which should not have either problem. Not yet confirmed by Melipayamak.
- **Templates the owner is resubmitting** (old IDs 589006–589008 were rejected, likely for the `bjeng.app`
  link). The placeholder order matches the app (`sms_enqueue_request`, `sms_on_approval`, `app_enqueue_password_sms`):
  1. Request filed (approver_new): {0} name, {1} type, {2} date
     `سامانه پرسنلی بهسازان جنوب` / `درخواست {1} {0} برای تاریخ {2} ثبت شد و منتظر تأیید شماست.`
  2. Result (employee_decision): {0} type, {1} date, {2} «تأیید شد»/«رد شد»
     `سامانه پرسنلی بهسازان جنوب` / `درخواست {0} شما برای تاریخ {1} {2}. جزئیات در سامانه قابل مشاهده است.`
  3. Temporary password (password_reset): {0} password, {1} login code
     `سامانه پرسنلی بهسازان جنوب` / `رمز عبور موقت شما: {0}` / `کد ورود: {1}` / `لطفاً پس از ورود، رمز خود را تغییر دهید.`
  Dates are sent as `۱۴۰۵/۰۸/۲۵` (`private.jalali_text`).
- **Melipayamak panel access:** the owner may put the Liara IP `62.60.191.132` back on the panel's
  allowed-IP list. That list also limits panel *login*, so after that the panel opens only through the server:
  `ssh -q -D 1080 -N liara-bj-vm`, then
  `open -na "Google Chrome" --args --proxy-server="socks5://127.0.0.1:1080" --user-data-dir=/tmp/meli-chrome`.
  The "channel … open failed" noise is Chrome's background calls to foreign sites; `-q` hides it.

## What to do next (only with the owner)

1. Ask whether the templates are approved and what their new body IDs are. Also ask whether the
   morning-after tests arrived, which would confirm the night hold.
2. When approved: the owner sets Admin › SMS › How to send = **Pattern** and enters the three body IDs.
   **Send test** always uses the line, not a pattern, so check pattern sending with a real event: an admin
   password reset with "Text it" ticked, or a test leave request. Do this at night and to 09163066264 too.
   Read each row's history in the log.
3. If pattern sends fail, read the raw reply in the log. `sms_ws_error` maps the known codes. Endpoint:
   `SendSMS/BaseServiceNumber`, body `{username, password, to, bodyId, text: args joined by ';'}`. It is not yet
   verified against a real approved template.
4. Possible follow-ups (ask first, don't start):
   - Delivery-status check (`GetDeliveries2` by recId). Today "Sent" only means Melipayamak accepted the text.
   - A pattern-mode test button.
   - Hold free-text sends overnight, if the owner stays on the line method.

## Rules that bite here

- Push to `main` deploys to Liara. Commit and push only when the owner asks. Docs-only commits get `[skip ci]`.
- Migrations are frozen once applied anywhere. Dry-run on a clone DB in `bj-approvals-finance-db-1` (create db → `pg_dump -Fc -d postgres | pg_restore` → apply `20261116150000`+ → run `tests/sql/sms.sql` → drop). Patch `supabase/schema.sql` from before/after dumps; local `anon` grant drift means grant hunks are fixed by hand.
- Never hand-run SQL on the Liara server. Never print or log the API key (`sms_scrub`).
- The admin panel is English only (`messages/en.json` `admin.*`). Error strings go in both fa and en.
- Uncommitted at handoff: `docs/TASKS.md`, `docs/AGENT-LOG.md`, this file.
