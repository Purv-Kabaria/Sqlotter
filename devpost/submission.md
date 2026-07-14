# Sqlotter: Devpost Submission Content

This is everything you need to fill out the Devpost form for Reddit's Games with a
Hook hackathon. Copy each section into the matching field on Devpost. I pulled every
fact from the actual code and docs in this repo, so the numbers and feature names are
real, not filler. Swap in your own voice where you want, but the substance is accurate.

The "try it out" links are filled in below with the real, verified URLs (app listing,
live game post, subreddit, and source repo). The one thing left that only you can do
is the demo video — there's a script further down you can read straight into a screen
recording.

---

## Title

Sqlotter

## Tagline

Wordle's daily habit meets Factory Balls' paint-and-mask logic, running natively
inside a Reddit post.

---

## Inspiration

We wanted a puzzle game that felt like it belonged on Reddit instead of one that was
just embedded there. Reddit already runs on daily rituals and inside jokes, so we
looked at Factory Balls, the old flash game where you dress a blank character in
stencils and paint to match a target look, and asked what happens if the target look
becomes a daily community puzzle, the stencils become removable accessories on a
mascot, and the solving becomes something you can brag about, race a stranger over, or
build yourself and hand to the subreddit as a dare. That mascot became Splot, a round
slime who lives in the feed and reacts to everything you do to him.

## What it does

Every level shows a goal pattern: a bare slime painted in colored zones. You start
from a blank white slime and reproduce the pattern by wearing accessories as paint
stencils and splashing color over them. A stencil worn when the paint lands protects
whatever it covers. Taking it off later reveals what was underneath. Order is the
entire puzzle, and every tap costs a move, so the same five tools can hide a two move
solution or a twenty move one depending on how they're sequenced.

The signature twist is goggles. They protect like any stencil, but the very first
splash that lands on them shatters them for the rest of that attempt, automatically
and for free. Glasses cover almost the same area but survive forever. Deciding which
splash you spend your one pair of goggles on is where most of the actual thinking
happens.

On top of that core loop:

The Daily Sqlot is a fresh puzzle generated and posted every day, already skewed
toward the harder end of the difficulty scale and pushed even harder on weekends,
with a streak that shows up on your Reddit flair and a one time crown you can claim
and post as an image if you solve it before anyone else.

Anyone can build their own level. The editor doesn't give you a separate goal-drawing
tool, you just play the level yourself, and your own recorded solution becomes both
the goal image and the proof that it's solvable. Publishing turns it into a real
Reddit post framed as a challenge, complete with a pinned scoreboard comment that
updates itself as people try to beat your move count, and a small Sparks payout to you
every time ten more people solve it.

Sparks are the game's currency, earned by solving levels quickly and efficiently, and
spent on a cosmetic shop for Splot: dozens of colors, faces, and accessories. Every
Thursday a Fit Check thread opens where you can dress Splot up and post an actual
picture of him to the thread. The community upvotes their favorite fit, the winner
gets Sparks and a flair badge, and the old thread is deleted and replaced with a fresh
one automatically.

Your Reddit flair updates on its own to show your streak and your Sparks tier, so your
standing in the community is visible everywhere you post, not just inside the game.

## How we built it

The whole thing runs on Devvit Web, Reddit's platform for building apps that live
directly in posts. The client is Phaser 4, chosen because the core mechanic is really
a compositing problem: each paint action layers a tinted, masked stamp onto a canvas
texture, punching out whatever is currently worn using real alpha data read from the
actual accessory art. That canvas becomes the slime you see, and the exact same
technique renders the goal preview, the win screen, and every shareable card.

The server is Hono running on Devvit's serverless Node, with Redis for everything
persistent: profiles, levels, leaderboards, the daily puzzle index, the Fit Check
state. Scheduled Devvit tasks post the daily puzzle every hour until it lands, and
cycle the Fit Check thread every Thursday.

The one decision that shaped everything else was putting the entire simulation, every
rule about what a splash does, what a stencil protects, when goggles break, into one
plain TypeScript module with no framework dependencies. The client runs it live so
taps feel instant, the server runs the identical copy to verify every submitted
solution, and the renderer runs it a third time just to know what to draw. Because
it's one module instead of three approximations of the same idea, there's no way for
client and server to quietly disagree about whether a move was legal.

## Challenges we ran into

Trusting user generated levels without a moderation queue was the hardest problem.
The fix was making the level's own recorded solution do double duty as its proof of
solvability: the server independently replays it and rejects anything that doesn't
resolve cleanly, so a broken or unsolvable level can't be published in the first
place.

Getting a canvas-compositing renderer to feel instant on a phone inside a Reddit
webview took real tuning. Static backgrounds get baked into a single render texture
instead of redrawn every frame, and Phaser 4's newer texture APIs queue their draws
instead of running them immediately, which is not obvious until you've been bitten by
a stamp that silently did nothing because nothing had flushed it yet.

Audio turned out to be five times heavier than every piece of art in the game
combined. We ended up splitting it so only a small set of core UI sounds loads before
the game is interactive, with the rest, including the music, streaming in quietly
after you're already playing.

## Accomplishments that we're proud of

The whole game is one puzzle engine shared by three consumers, which means a solution
that works client side is guaranteed to be accepted server side, every time, with no
separate validation logic to drift out of sync.

Idle rendering sits around six milliseconds and every tap resolves in under
twenty five, measured under six times CPU throttling, so it stays responsive on
modest phones and not just on a dev machine.

User generated content isn't a side feature bolted onto a fixed campaign, it's the
same toybox the built in levels are made from, and every published level becomes a
real, self-updating Reddit post the moment you publish it.

## What we learned

Building for an iframe forces a cleaner architecture than a normal web app, because
a lot of the browser APIs you'd normally reach for either don't exist or are
explicitly off limits, so you end up leaning on the platform's own primitives instead
of working around them.

Sharing one simulation across the whole stack is worth the upfront design cost. Every
bug class we avoided by construction, like a level that looks solvable client side but
isn't, would otherwise have needed its own test coverage and its own fix.

## What's next

More stencil types and seasonal daily themes, deeper post-solve stats so players can
see how their solution compared to others, and more ways for a published community
level to keep paying its creator back the longer it stays popular.

---

## Built With

devvit, devvit-web, phaser, typescript, hono, redis, vite, reddit-api

---

## Links — matched to the Devpost form fields

**"Try it out" links** (add all of these):

```
https://www.reddit.com/r/sqlotter/comments/1ushb6h/sqlotter_paint_the_slime_mind_the_goggles_beat/
https://www.reddit.com/r/sqlotter/
https://developers.reddit.com/apps/sqlotter
https://github.com/Purv-Kabaria/Sqlotter
```

**developers.reddit.com app page:**

```
https://developers.reddit.com/apps/sqlotter
```

Version 0.0.12 was submitted for public review on July 13, 2026. Until Reddit
approves it, this page shows 403 to anyone who isn't the app owner — you'll get
an email when it flips. The game itself is live and playable regardless.

**Link to test post** (pinned game post in r/sqlotter, playable logged-out —
verified from a fresh logged-out browser):

```
https://www.reddit.com/r/sqlotter/comments/1ushb6h/sqlotter_paint_the_slime_mind_the_goggles_beat/
```

Backup test posts, in case the form allows more than one or a judge wants
variety — these are live Daily Sqlots that posted automatically at 00:01 UTC:

```
https://www.reddit.com/r/sqlotter/comments/1uuvqj0/sqlot_20260713_the_chaotic_pumpkin_caper/
https://www.reddit.com/r/sqlotter/comments/1utzqdx/sqlot_20260712_the_smug_squish_parade/
```

**Source code** (public repo):

```
https://github.com/Purv-Kabaria/Sqlotter
```

---

## Demo video script (read this into a screen recording, roughly two to three minutes)

Open on the subreddit feed so judges see the game living inside a real post, not a
standalone site.

Say what it is in one breath: a daily puzzle where you dress a slime in stencils and
paint to match a target pattern, and the order you do it in is the whole game.

Play one level start to finish on camera. Narrate the goggles rule out loud the moment
it happens, since it's the one mechanic that makes people go "oh, clever" instead of
just nodding along.

Cut to the win screen, point out the Sparks earned and the streak badge, then jump to
the Shop and put a new color or accessory on Splot.

Open the editor and record a short level live, tap by tap, so judges see that there's
no separate goal-drawing step, the play through and the goal creation are the same
action. Publish it and show the real Reddit post it creates, including the duel
scoreboard comment.

Close on a Fit Check thread if one is live, showing Splot dressed up and posted as an
image, and end on the subreddit flair showing a streak, since that's the detail that
proves this isn't just a game embedded in Reddit, it's a game that talks back to
Reddit.

---

## Screenshots

Five screenshots are ready in `devpost/screenshots/`, captured directly from the
running client at 1024 by 768:

- `01-mainmenu.png`: home screen, good as the lead gallery image
- `02-gameplay.png`: a daily puzzle mid solve, goal next to your current slime
- `03-win.png`: the three star win celebration
- `04-shop.png`: the cosmetic shop with Sparks balance and color rack
- `05-editor.png`: the full level editor mid build

Devpost accepts these as is, but if you want a couple more for variety, the same
approach works for the Leaderboard and LevelSelect world map screens.

---

## Image generator prompts

Two images to generate: the subreddit banner and the Devpost thumbnail. Exact
dimensions are listed with each prompt. If your image generator doesn't support the
exact aspect ratio, generate a bit larger than the target and crop to size afterward
rather than stretching, since stretching will warp the pixel art.

### Subreddit banner, desktop

Target size: 1920 by 384 pixels (5 to 1 ratio), PNG, under 500KB. Reddit places the
subreddit icon and name over the bottom left corner, so keep that area calm, and leave
roughly 300 pixels of breathing room on both the far left and far right since those
edges can get cropped on some layouts.

Prompt:

A wide horizontal banner in clean pixel art style, matching a cute mobile puzzle game.
Center composition, a round expressive slime mascot with big glossy eyes and a simple
smile, colored a vibrant lime green, standing on a soft pastel purple background with
faint drifting cloud shapes. The slime is flanked by a few floating painter's palette
icons, a pair of round goggles, and small paint splashes in red, yellow, and blue,
arranged loosely so the far left and far right thirds of the image stay open and
uncluttered. Bold, chunky pixel outlines, warm saturated colors, soft rim lighting,
no readable text anywhere in the image, wide banner aspect ratio, crisp retro game
art, high detail on the mascot only, background kept simple and low detail so it does
not compete with foreground UI.

### Subreddit banner, mobile

Target size: 1600 by 480 pixels. Reuse the same prompt as above with one change since
the mobile crop is taller relative to its width, so the mascot needs to read clearly
even when the sides get trimmed tighter:

Same prompt as the desktop banner, but shift the slime mascot slightly larger and
keep every important element, the slime, the goggles, and the paint splashes, within
the center 60 percent of the frame so a tighter crop on mobile does not lose them.

### Devpost thumbnail

Target size: 1200 by 800 pixels (3 to 2 ratio), PNG or JPG, under 5MB. This is the
cover image for your whole project gallery, so it should read instantly as a game
screenshot or key art, not an abstract banner.

Prompt:

A vibrant pixel art key art image for a mobile puzzle game, square-ish landscape
composition. A round, glossy, expressive green slime character front and center,
wearing a small pair of round dark goggles pushed up on its forehead and a single
streak of red paint dripping down one side of its body, big shiny cartoon eyes, happy
open smile, standing on a simple rounded pastel platform. Around it, a scattering of
colorful paint drop icons and one goggles icon float in the background at low
opacity. Warm gradient background from soft purple at the top to warm peach at the
bottom, soft drop shadow under the character, bold clean pixel outlines, bright
saturated retro game palette, no readable text or logos anywhere in the image, high
detail on the character, simple uncluttered background.

Alternate prompt, if you want a screenshot style thumbnail instead of character art:

A clean pixel art screenshot mockup of a mobile puzzle game interface. Left side
shows a small square card with a goal pattern, a round slime painted in bands of
white, green, and red. Right side shows a matching square card labeled with a bold
moves counter and three gold stars above it. A cheerful round green slime mascot
peeks up from the bottom edge of the frame. Warm purple and peach gradient
background, chunky pixel UI panels in a warm tan color with brown borders, bright
saturated colors throughout, no readable body text, clean and uncluttered, retro
handheld game console aesthetic.

---

## A few honest notes before you submit

Submit a few days before the deadline if you can. The research consistently says
judges reward projects that had time to fix a last minute bug over ones that shipped
at the wire with something broken.

The live demo post matters as much as the writeup. Judging leans heavily on being able
to actually open your subreddit and play the thing, so double check that a logged out
judge with no history in your subreddit can open the post and get to a puzzle in a few
seconds.

Write the "how we built it" and "challenges" sections so they visibly answer the
specific prize categories you're going for, Best App with a Hook, Best Use of Phaser,
Best Use of User Contributions, Best Use of Retention Mechanics, rather than reading
as a generic project summary. The sections above already lean that way on purpose.
