# Putting the game online

This is the step-by-step guide for running Backyard Monsters Refitted for real
players. It assumes no server experience. Set aside an afternoon for the first
time; after that, an update takes about five minutes.

## How it fits together

There are two halves:

- **The game page** (what players open in their browser) lives on **Vercel**.
  Vercel rebuilds it by itself every time new code is pushed to GitHub.
- **The game server** (accounts, yards, attacks, chat, and the game art) lives
  on **one rented Linux server** (a "VPS"). On that server, Docker runs five
  small programs side by side:
  - **Caddy**, the front door. It is the only thing the internet can reach. It
    gets the padlock (HTTPS certificate) for your address by itself and renews
    it by itself.
  - **The game server** itself, including chat.
  - **The database** (Postgres), where every account and yard is kept.
  - **Redis**, a small fast memory the game server uses for chat and who is
    online.
  - **The backup helper**, which copies the database to a file once a day.

The game page fetches the game art through Vercel, which quietly passes those
requests on to the game server. Players never see the server's address.

Throughout this guide, `yourgame.com` stands for the domain you buy:

| Address | What it is |
|---|---|
| `play.yourgame.com` | The game page, on Vercel. This is the address you give players. |
| `api.yourgame.com` | The game server, on the VPS. Players never type it. |

You can pick other names than `play` and `api`; just use the same ones
everywhere below.

### Where your domain name is written down

The code ships with the placeholder `EXAMPLE.com`. Your real domain goes in
exactly two files:

1. **`web/vercel.json`**: the game server's address, `https://api.EXAMPLE.com`,
   appears 4 times. Replace all 4 (see step 6).
2. **`server/production.env`** on the VPS: `API_DOMAIN`, `WEB_DOMAIN` and
   `MAIL_FROM` (see step 7).

The game server will not start while either of its settings still says
`EXAMPLE.com`, so you cannot forget the second file.

## Monthly cost

Prices were checked on 2026-10-06 (`hosting-cost-estimate.md`); they change, so
look again when you sign up.

| What | Cost |
|---|---|
| VPS, 2 CPUs, 4 GB memory (Hetzner in Ashburn, Virginia, or DigitalOcean in New York) | about $20-25 a month |
| The VPS provider's own backup copies of the whole server (strongly recommended) | about 20% of the VPS price, $4-5 a month |
| Domain name | $10-15 a year, about $1 a month |
| Resend (password-reset email), free plan: 3,000 emails a month, 100 a day | $0 |
| Cloudflare Turnstile (the "are you a person" check on sign-up) | $0 |
| Vercel (you already pay for it; the game page uses a tiny part of the plan) | $0 extra |
| **Total extra each month** | **about $25-30** |

That is enough for the first few hundred players. `hosting-cost-estimate.md`
explains what changes at 5,000.

## Step 1. Rent the VPS

1. Make an account with a VPS provider. Hetzner Cloud is the cheapest; pick
   the **Ashburn, VA (US East)** location. DigitalOcean (New York) is a little
   more expensive and has a friendlier dashboard. Either is fine.
2. Create a server ("droplet" at DigitalOcean) with:
   - **Ubuntu 24.04**;
   - **2 CPUs, 4 GB memory**, 40 GB disk or more;
   - **backups turned on** (a tick box when you create it);
   - an **SSH key** for logging in. The provider's sign-up pages explain how
     to make one; on Windows, `ssh-keygen` in PowerShell does it.
3. Write down the server's **IP address** (four numbers like `203.0.113.10`).

## Step 2. Buy the domain

Buy `yourgame.com` from any registrar. Cloudflare Registrar sells at cost and
its DNS page is simple, so this guide uses its words; any registrar has the
same settings under similar names.

## Step 3. Point the addresses at the right places (DNS)

In the domain's DNS settings, add:

| Type | Name | Value | Notes |
|---|---|---|---|
| A | `api` | the VPS IP address | On Cloudflare, set the cloud to **grey ("DNS only")**, not orange. With orange, Caddy cannot get its certificate and every player would look like the same person to the game's limits. |
| CNAME | `play` | the value Vercel shows you in step 6 (usually `cname.vercel-dns.com`) | Grey cloud on Cloudflare too. |

Resend (step 4) gives you a few more records to add; add those here as well.

DNS changes can take from a minute to an hour to reach everyone.

## Step 4. Set up email (Resend)

The game sends one kind of email: the "reset your password" link.

1. Make a free account at <https://resend.com>.
2. **Domains → Add domain**, enter `yourgame.com`. Resend shows 3-4 DNS
   records (TXT and MX). Add each one in your DNS settings exactly as shown,
   then press **Verify** in Resend. Wait until it says **Verified**.
3. **API keys → Create API key**, permission "Sending access". Copy the key
   (it starts with `re_`); you only see it once. It goes in
   `SMTP_PASSWORD` in step 7.

## Step 5. Set up the sign-up bot check (Cloudflare Turnstile)

1. Make a free Cloudflare account (you may have one from step 2).
2. In the dashboard, open **Turnstile → Add widget**.
3. Name it "BYMR sign-up", add the hostname `play.yourgame.com`, widget mode
   **Managed**.
4. Cloudflare shows two keys:
   - the **site key** goes into Vercel (step 6);
   - the **secret key** goes into `server/production.env` (step 7).

## Step 6. Put the game page on Vercel

1. On GitHub, open `web/vercel.json` in your copy of the code, press the
   pencil (edit) button, and replace each of the 4 `api.EXAMPLE.com` with
   `api.yourgame.com`. Commit the change.
2. In Vercel: **Add New → Project**, import the
   `backyard-monsters-refitted` repository.
3. Set **Root Directory** to `web`. Leave the build settings alone:
   `web/vercel.json` already says how to build.
4. Under **Environment Variables**, add `TURNSTILE_SITE_KEY` = the site key
   from step 5.
5. Press **Deploy**.
6. In the project's **Settings → Git**, set the **Production Branch** to the
   branch you play from (for this project, `revamp`).
7. In **Settings → Domains**, add `play.yourgame.com`. Vercel shows the CNAME
   value for step 3 if you have not added it yet.

The page will load now but cannot log anyone in until the game server is up.

## Step 7. Start the game server

Open PowerShell on your computer and log in to the VPS (use your IP address):

```
ssh root@203.0.113.10
```

Everything from here is typed into that window, on the server.

**Install Docker and the firewall** (once):

```
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

**Get the code** (once). If the GitHub repository is private, GitHub asks for
your username and a "personal access token" instead of your password; GitHub's
settings page under **Developer settings → Personal access tokens** makes one.

```
git clone -b revamp https://github.com/sim-yujie/backyard-monsters-refitted.git /opt/bymr
cd /opt/bymr/server
cp production.env.example production.env
```

**Keep the logs short** (once). Everything the server prints goes to the
VPS's own log store. Those lines include players' IP addresses, so the game
keeps them for at most 30 days and lets them take up to 2 GB in all; older
lines are deleted on their own. This copies that rule into place:

```
mkdir -p /etc/systemd/journald.conf.d
cp deploy/journald-bymr.conf /etc/systemd/journald.conf.d/bymr.conf
systemctl restart systemd-journald
```

**Make two random secrets** and copy them somewhere safe for a minute:

```
openssl rand -hex 32
openssl rand -hex 24
```

**Fill in the settings**:

```
nano production.env
```

Go through the file top to bottom. Every line with `FILL IN` or `EXAMPLE.com`
needs your value:

- `API_DOMAIN=api.yourgame.com` and `WEB_DOMAIN=play.yourgame.com`;
- `ACME_EMAIL`: your email address;
- `SECRET_KEY`: the first (longer) random secret;
- `DB_PASSWORD`: the second random secret;
- `SMTP_PASSWORD`: the Resend API key from step 4;
- `MAIL_FROM`: for example `Backyard Monsters Refitted <no-reply@yourgame.com>`;
- `TURNSTILE_SECRET_KEY`: the secret key from step 5.

Save with Ctrl+O, Enter, then leave with Ctrl+X.

Keep a copy of `production.env` somewhere safe off the server (a password
manager is ideal). Without `SECRET_KEY` and `DB_PASSWORD` a backup is much
harder to bring back.

**Start everything**:

```
deploy/prod.sh up -d --build
```

The first start takes a few minutes. Then check it:

```
deploy/prod.sh ps
```

`caddy`, `web`, `db`, `redis` and `backup` should say **Up** (and `db-init`
**Exited (0)**, which is right: it sets up the database and stops).

If `web` keeps restarting, look at why:

```
deploy/prod.sh logs web | grep "Refusing to start"
```

Each line names a setting to fix in `production.env`. Fix it and run
`deploy/prod.sh up -d` again.

## Step 8. Check it works

1. Open `https://api.yourgame.com/assets/alliances/10_large.png`. A small
   picture should appear, with the padlock in the address bar.
2. Open `https://play.yourgame.com`, create an account and play for a minute.
   The "World chat" dot in the corner turns green when chat is connected.
3. Sign out, press **Forgot password?**, and enter your email. The email
   should arrive within a minute. Its link opens a "New password" form.

The game is live. It is a beta: tell players so wherever you announce it.

## Updating the game

When new code is on GitHub:

- **The game page** updates by itself: Vercel rebuilds whenever the
  production branch changes.
- **The game server** needs three commands on the VPS:

```
cd /opt/bymr/server
deploy/prod.sh exec backup bash /backup.sh
git pull
deploy/prod.sh up -d --build
```

The first takes a fresh backup, just in case. The last rebuilds the game
server and brings the database up to date by itself. Players are cut off for
about half a minute while it restarts.

## Backups

**What happens by itself:** the backup helper copies the whole database once
when it starts and then every night at 03:00 UTC (`BACKUP_HOUR` in
`production.env`). The files go in `/opt/bymr/server/backups/`, named by date
and time, e.g. `bym-20261010-030000.dump`. Files older than 14 days
(`KEEP_DAYS`) are deleted.

**See the backups:**

```
ls -lh /opt/bymr/server/backups/
```

**Keep copies off the server.** The backups sit on the same machine as the
game; if the machine is lost, so are they. That is what the VPS provider's own
backups (step 1) are for. For extra safety, now and then copy the newest file
to your computer, from PowerShell on your computer:

```
scp root@203.0.113.10:/opt/bymr/server/backups/bym-20261010-030000.dump .
```

### Restoring a backup

Only do this if the game's data has gone wrong (a bad update, a mistake) and
you want to go back to how it was at a backup. Everything players did after
that backup is lost.

```
cd /opt/bymr/server
ls -1t backups/
deploy/restore.sh backups/bym-20261010-030000.dump
```

The script first unpacks the backup into a new, separate database, and tells
you how many accounts it holds. If the file is damaged it stops there and
nothing has changed. Otherwise it asks you to type `YES`, stops the game for a
few seconds, swaps the backup in, and starts the game again.

The database as it was just before is **kept**, under a name like
`bym_before_restore_20261010120000`, in case you change your mind. The script
prints the command that deletes it once you are happy.

**Practise once in a while** (every month or two) without touching the game,
by restoring into a separate database:

```
deploy/restore.sh backups/bym-20261010-030000.dump bym_check
deploy/prod.sh exec db sh -c 'dropdb -U "$POSTGRES_USER" bym_check'
```

The first line proves the backup can be read back (it prints the number of
accounts); the second throws the copy away.

## Everyday commands

All from `/opt/bymr/server` on the VPS:

| To | Type |
|---|---|
| See what is running | `deploy/prod.sh ps` |
| Watch the game server's log | `deploy/prod.sh logs -f web` (Ctrl+C to stop watching) |
| Restart the game server | `deploy/prod.sh restart web` |
| Stop everything (data is kept) | `deploy/prod.sh down` |
| Start everything | `deploy/prod.sh up -d` |
| Take a backup now | `deploy/prod.sh exec backup bash /backup.sh` |

## When something goes wrong

| What you see | Likely cause |
|---|---|
| The page loads but no art, or "can't connect" | `api.yourgame.com` does not point at the VPS yet, or `web/vercel.json` still says `EXAMPLE.com`. Check step 3 and step 6. |
| The browser warns the API address is not secure | Caddy has not got its certificate. The `api` DNS record must point at the VPS with the grey cloud, and ports 80 and 443 must be open. `deploy/prod.sh logs caddy` says what went wrong. |
| `web` keeps restarting | A setting is missing or still a placeholder: `deploy/prod.sh logs web \| grep "Refusing to start"`. |
| Sign-up says "We couldn't confirm you're a person" every time | The Turnstile site key (Vercel) and secret key (`production.env`) are from different widgets, or the widget does not list `play.yourgame.com`. After changing the Vercel key, redeploy the page in Vercel. |
| Reset emails never arrive | The domain is not "Verified" in Resend, `MAIL_FROM` uses a different domain, or the API key is wrong. `deploy/prod.sh logs web \| grep ForgotPassword` shows the error. |
| Chat dot stays orange | Chat goes through `wss://api.yourgame.com/chat`. Check `deploy/prod.sh logs caddy`. |

## For the technically curious

- The files: `web/vercel.json` (the page), `server/docker-compose.prod.yml`
  (the five programs), `server/deploy/Caddyfile` (the front door),
  `server/deploy/backup.sh` and `restore.sh`, `server/production.env.example`
  (every setting, explained).
- Only Caddy has open ports (80 and 443). The database, Redis and the game
  server are reachable only from inside Docker.
- The game server refuses to start in production without a strong
  `SECRET_KEY`, a non-default `DB_PASSWORD`, a Turnstile secret, a mail server
  and `WEB_URL`, and while any setting still holds `FILL IN` or `EXAMPLE.com`
  (`server/src/config/StartupSafety.ts`).
- Caddy passes each player's real address to the game server
  (`CF-Connecting-IP`); the game server trusts that header from Caddy's fixed
  internal address only (`TRUSTED_PROXIES`). This is why the `api` DNS record
  must not go through Cloudflare's proxy (orange cloud).
- The old Flash client's port 843 is not opened: this setup serves the web
  client only.
- PM2 (`ecosystem.config.mjs`) is not used here; Docker restarts anything that
  stops.
- Console logs: `docker-compose.prod.yml` sends every container's output to
  journald (`LOG_DRIVER`, default `journald`), and
  `server/deploy/journald-bymr.conf` starts a new file each day, deletes files
  older than 29 days and caps the total at 2 GB. `deploy/prod.sh logs` still
  works. A setup run with PM2 instead of Docker runs
  `server/deploy/pm2-logrotate.sh` once (nightly rotation, 30 files kept).
