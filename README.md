# DHQ Lab

The Lab is a **generated mirror of the website**. Nothing here is hand-edited.

Every file in this repo is produced by `scripts/publish-lab.cjs` in the
website repo (skjjcruz/Owner-Dashboard---V6): it builds the website exactly
as the Pages deploy does, copies that build here, and adds an access-code
gate to every page. The pipeline is

    website repo (staging branch) -> publish -> this repo -> owner tests
    -> merge to website main (deploys dhqfootball.com) -> port to native app

Doors: `index.html` and `trade-lab.html` are the same app page. With no
session the app sends you to `landing.html` to sign in, as on the website.
`espn-lab.html` is the ESPN test harness. The Cutdown Desk ships inside the
app page. These Lab-only extras live under `lab/` in the website repo.

Only `.github`, `.nojekyll`, `robots.txt` and this file belong to this repo.
