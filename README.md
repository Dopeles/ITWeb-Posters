# ITWeb daily posters — automation

At **13:05 South Africa time** on weekdays, this reads the ITWeb and ITWeb Africa RSS feeds and makes posters for the newest stories it hasn't used before. Each one is a 1080×1350 poster in the house style, saved as a 2160×2700 PNG.

## What it does each run
1. Reads `https://www.itweb.co.za/rss` and `https://itweb.africa/rss`.
2. Takes the newest story from each feed (published in the last 24 hours, not already done, not sponsored).
3. Opens each article and pulls the headline, category, intro text and lead image.
4. **If an Anthropic API key is set**, Claude picks 3 figures and a quote from the article. Any figure or quote that can't be found word for word in the article text is dropped. If there aren't enough figures, the poster falls back to a headline-and-intro layout with a taller image.
5. Saves `posters/YYYY-MM-DD/*.png`, the `.html` source and a `REVIEW.md` listing each story and its figures.

**A person should still check `REVIEW.md` before anything is posted.** The figure check catches made-up numbers, but it can't tell whether a real number has been given the right label.

## Quickest setup: one script
Install **git** and the **GitHub CLI** (`gh`), then run the script for your computer in this folder:
- Mac/Linux: `bash setup.sh`
- Windows: `powershell -ExecutionPolicy Bypass -File setup.ps1`

The script signs you in to GitHub in your browser, creates a private `itweb-posters` repo, uploads everything, asks for your API key, and starts a test run.

## Option A: GitHub Actions by hand
1. Create a GitHub repo and put this `automation/` folder at its root. Move `automation/.github/` to the **repo root** (`.github/workflows/daily-posters.yml`).
2. Repo → Settings → Secrets and variables → Actions → add `ANTHROPIC_API_KEY` (optional, enables fact panels).
3. Repo → Actions → "Daily ITWeb posters" → **Run workflow** to test it once.
4. After that it runs by itself every weekday at 13:05. The PNGs are committed to `posters/` and also attached to each run as a downloadable "posters" zip.

To include weekends, change `1-5` to `*` in the cron line.

## Option B: Your own computer or server
```
cd automation
npm install
npx playwright install chromium
npm run posters        # make today's posters now
npm run posters:dry    # build the HTML only, no PNGs
```
To schedule on macOS or Linux, add this with `crontab -e` (set for a machine on SA time):
```
5 13 * * 1-5  cd /path/to/automation && ANTHROPIC_API_KEY=sk-... npm run posters
```
On Windows, use Task Scheduler with a daily 13:05 trigger running `npm run posters` in this folder.

## Settings (`config.json`)
- `perRun`: how many stories to take from each feed per run.
- `windowHours`: how far back to look (24 = since yesterday's run).
- `skipCategories`: categories to ignore.
- `useClaude`: set to `false` to always use the headline-and-intro layout.

## Known limits
- Lead images are only 512×288 at source, so they look soft when stretched to full width.
- Feed and page structure may change on ITWeb's side. If a run makes no posters, check the Actions log for "Feed failed".
- `seen.json` stops the same story being made twice. Delete an entry from it to remake that poster.
