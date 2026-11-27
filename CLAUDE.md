# sleepa-draft

Mock drafts with your real Sleeper league: its teams, draft order, traded picks and keepers, against CPU drafters.
`index.html` is the app, `engine.js` the pure draft engine it loads, `build_pool.py` builds `pool.json` (the player
pool and rankings). Read `PROJECT_CONTEXT.md` for how it works, its data sources and the keeper rules.

Test the engine with `node --test tests/engine.test.js` (Node 18+, no dependencies) after any change to `engine.js`.

## Security rules (public repo)

Anyone can read this repo and its Actions logs. Keep it that way safely:

- **No secrets in files, ever.** The app and the build use only public, keyless sources (Sleeper, the DynastyProcess
  mirror on raw.githubusercontent.com). If a key is ever needed it lives in GitHub repository secrets and reaches
  scripts through `env:`; scripts never print it.
- **index.html loads no third-party JavaScript** (only Google Fonts CSS). Its only script besides itself is the
  first-party `engine.js`. No CDN scripts.
- **Escape everything other people control** before it goes into HTML: Sleeper team names, display names, league
  names, player names. Use `escapeHTML()`. Image URLs must be `https://` (`safeImg`).
- **The Sleeper username stays in localStorage** (`sd-user`), never in the URL or sent anywhere except Sleeper's own
  API. Every localStorage key starts with `sd-`: all Sleepa apps share the `adambar-io.github.io` origin.
- **Actions are pinned to full commit SHAs** with the version in a comment (`actions/checkout@<sha> # v5.1.0`), the
  same pins as Sleepa. Dependabot (`.github/dependabot.yml`) proposes updates weekly. Triggers stay
  `schedule` / `workflow_dispatch` (no `pull_request_target`); `permissions:` as narrow as the job needs. Python is
  standard library only, so the Actions install nothing from PyPI.
- **Don't rewrite pushed history.** Add files by name rather than `git add -A`.
- Commit as `adambar-io@users.noreply.github.com`, never a personal email (set repo-locally; the global git email is
  personal). The Action commits `pool.json` to `main` daily, so `git pull --rebase` right before every push.
