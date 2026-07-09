# Deployment — from playtest to launch

How Sqlotter goes from this repo to a live game on Reddit. This is the same
path first-party games like Pixelary and community games like r/hotandcold
follow: develop against a playtest subreddit, upload private versions, submit
for Reddit's app review with `devvit publish`, then run the game out of its own
dedicated subreddit.

The repo's npm scripts wrap the Devvit CLI:

| Script | Runs | Meaning |
|--------|------|---------|
| `npm run login` | `devvit login` | one-time browser OAuth with your Reddit account |
| `npm run dev` | `devvit playtest` | live-reload dev loop on the playtest subreddit |
| `npm run deploy` | type-check + lint + `devvit upload` | upload a new **private** version |
| `npm run launch` | deploy + `devvit publish` | submit the version for **launch review** |

---

## 0. One-time setup

1. Create/verify your developer account at
   [developers.reddit.com](https://developers.reddit.com) (log in with the
   Reddit account that will own the app).
2. `npm install`, then `npm run login` — opens a browser window to authorize
   the Devvit CLI.
3. The app is registered under the name in `devvit.json` (`"name": "sqlotter"`).
   The first `devvit upload` claims that name and adds the app to your
   account's app list (asks NSFW yes/no + a CAPTCHA).

## 1. Develop: playtest

```sh
npm run dev
```

- Uses the subreddit from `devvit.json` → `dev.subreddit` (`sqlotter_dev`).
  If it doesn't exist yet, Devvit can auto-create a private playtest subreddit
  (created by u/devvit-dev-bot, you're mod, app pre-installed); playtest
  subreddits must stay **under 200 subscribers**.
- Every save rebuilds and reinstalls the app on the playtest subreddit and
  streams server logs to your terminal.
- Open the printed URL with the `?playtest=sqlotter` query param to also get
  client-side logs and live browser reload.
- **Backend routes only work here** (or on an installed app) — never from a
  bare local server.
- Ctrl+C ends the session, but the playtest version **stays installed**. To
  revert to the last non-playtest version: `devvit install sqlotter_dev [@version]`.

Playtest is where to run the full pre-launch matrix: mobile portrait +
landscape + desktop, and multiple accounts (developer / moderator / regular
user) since permissions differ — e.g. `runAs: USER` actions fall back to the
app account until the app is approved.

## 2. Upload a private version

```sh
npm run deploy
```

Type-checks, lints, and uploads a new version. Uploaded (non-published)
versions are private to you: you can install them on subreddits you moderate
with `devvit install <subreddit>`, but nobody else can, and apps must pass
review before they can be installed on any subreddit **over 200 members**.

## 3. Launch: submit for review

```sh
npm run launch          # = npm run deploy && devvit publish
```

Version control if you need it (publish is per version):

```sh
devvit publish --bump patch|minor|major   # default: patch
devvit publish --version 1.0.1            # explicit; no prereleases
```

What happens next:

- The version enters Reddit's review queue; the team evaluates code, example
  posts, and the app documentation. Most reviews land in **1–2 business days**
  (new apps and higher-risk capabilities can take longer; reviews pause around
  holidays). Approval arrives by email; questions come via Modmail/chat.
- **A `README.md` is required** for review — this repo's README doubles as the
  app README (it describes what the app does and how to use it). We use no
  external fetch domains, so no "Fetch Domains" section is needed.
- **Published apps are unlisted by default** — installable via direct link/CLI
  by anyone you share it with, but not browsable in the App Directory. That is
  the recommended mode for a game that lives in one subreddit, which is exactly
  Sqlotter. (`devvit publish --public` would list it in the directory for any
  moderator to install — not recommended for single-community games.)
- Because every launched version needs its own `devvit publish` + review,
  batch changes into weekly-or-less releases rather than publishing daily.

Reddit's game-specific launch bar (all already true for Sqlotter — keep it
that way):

- Responsive across platforms; custom first screen (our splash view);
- no scrolling inside the inline webview;
- a **dedicated, non-test subreddit** (like r/Pixelary — see step 4);
- immediately understandable to a first-time player.

## 4. Create the game's home subreddit

Reddit expects a launched game to live in its own subreddit — that's the
r/hotandcold model: the subreddit *is* the game, and the feed is a stream of
playable posts.

1. Create **r/Sqlotter** with the account that owns the app (you're mod).
2. Install the app there: `devvit install Sqlotter` (or from the app's page at
   developers.reddit.com/apps → Communities). Requires the approved version if
   the subreddit is over 200 members.
3. The `on-app-install` trigger does the rest automatically: persists the
   subreddit name for the schedulers and creates the welcome/game post.
4. The hourly `daily-puzzle` cron then posts the daily **Sqlot** right after
   UTC midnight (`Sqlot 2026-07-10: …`). Moderator menu actions ("Post Daily
   Sqlotter Puzzle", "Create Sqlotter Post") cover manual posting.
5. Pin the welcome post, set the subreddit description/rules, and let the
   Splotter Flair + Fit Check Friday features run.

**Upgrade note:** publishing a new version does NOT auto-update installed
subreddits. Update via `devvit install Sqlotter` or the App Directory page's
**Installed in communities → Update** button. Remember the in-repo rule:
bumping `LEVELS_VERSION` wipes player level progress on upgrade — batch level
changes deliberately.

## 5. After launch: distribution

- **Get feedback**: cross-post gameplay posts to
  [r/GamesOnReddit](https://reddit.com/r/GamesOnReddit) (Feedback flair) and
  [r/Devvit](https://reddit.com/r/Devvit) (Feedback Friday flair); the Reddit
  Devs Discord has #ideas-and-feedback.
- **Featuring Program**: once published + approved, apply via Reddit's
  Featuring Request Form (linked from the "Get featured" page in the Devvit
  docs). Featured games rotate through the Games Feed, the community drawer,
  weekly home-feed boosts, and the r/GamesOnReddit banner. Selection weighs
  polish and engagement (CTR, dwell, retention).
- **Reddit Developer Funds**: engagement-qualified apps can earn up to
  $167k/app (program runs through July 31, 2026); approval through App Review
  is a prerequisite.
- **Hackathon**: for Games with a Hook, submit per the hackathon's Devpost
  instructions — typically the app listing link, the game subreddit, a demo
  video, and a write-up. Launch review takes 1–2 business days, so publish
  well before the July 15 deadline.

## Quick reference

```sh
npm run login                      # authenticate the CLI
npm run dev                        # playtest on r/sqlotter_dev (live reload + logs)
npm run deploy                     # upload new private version
devvit install <subreddit>         # install/update a version on a sub you mod
npm run launch                     # deploy + publish (submit for review)
devvit publish --public            # (not recommended here) list in App Directory
devvit uninstall <subreddit>       # remove (warning: deletes that install's data)
```
