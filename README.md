# Mobikasa audit tool

Two parts:

1. **Website** — login, users, run audits, download PDFs. Deploy on **Vercel**.
2. **Worker** — actually runs the tests. Run on a **server or your laptop**. Not on Vercel.

## Local

```bash
cp .env.example .env
```

Fill `.env`, then:

```bash
npm install
npm run dev
```

In a second terminal:

```bash
npm run worker
```

Open http://localhost:3000

## Production

Same two parts, on two machines:

**1. Website — Vercel**

- Push this repo to GitHub and import it in Vercel.
- In Vercel → Settings → Environment Variables, add the same keys as `.env` (`AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, Redis, Shopify, `NPM_TOKEN` if the build needs it).
- Deploy. People open the Vercel URL to log in and start audits.
- Do **not** run `npm run worker` on Vercel.
- Do **not** add `APP_ROLE` on Vercel. That variable is only for Docker. Vercel always runs the website.

**2. Worker — a server (not Vercel)**

Vercel has no Docker container and no `APP_ROLE`. I cannot restart production from this laptop — that only exists on **your worker server** after you start it.

**First time (once):** on that server, build and start a container named `audit-worker`:

```bash
docker build --secret id=npm_token,env=NPM_TOKEN -t audit-app .
docker run -d --restart unless-stopped --name audit-worker --env-file .env -e APP_ROLE=worker audit-app
```

**Later (new kit or new npm token):** on that same server:

```bash
docker restart audit-worker
```

The name is always `audit-worker` if you started it with `--name audit-worker`. You do not need `docker ps` to guess it.

If you only deployed Vercel and never ran those Docker commands on a server, **there is no production worker yet**. The live site will queue audits until this container is running.

If the worker is stopped, the site still works, but new audits will sit in the queue until you start it again.

## New audit-kit version

Publish the kit to npm, then **restart the worker**.

```bash
npm run worker
```

That is all. It downloads the latest kit by itself.

On the worker server: restart the Docker container (`APP_ROLE=worker`).

You do not need to change `package.json` or push Vercel for a kit-only update.

## New npm token

Put the new `NPM_TOKEN` in:

- laptop `.env`
- worker server env
- Vercel env (if the Vercel build installs packages)

Then restart the worker. Do not commit the token.

## Free limits

**Redis (Upstash free):** about 256 MB and 500,000 commands per month.  
We only store users, jobs, and report lists there. Jobs drop after 24 hours. Activity drops after 45 days. Report lists follow the project retention (default 30 days).

**PDFs** are in Shopify Files, not Redis. Old PDFs are deleted when retention ends. Use a shorter retention in project Settings if storage is high.

If Redis is full, login and audits can break. Check the Upstash dashboard.
