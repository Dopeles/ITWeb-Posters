// Daily ITWeb / ITWeb Africa poster generator.
// Reads each RSS feed, picks the newest unseen stories, builds a 1080x1350 poster, renders a 2x PNG.
import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { chromium } from 'playwright';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'config.json'), 'utf8'));
const DRY = process.argv.includes('--dry');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone }).format(new Date());
const outDir = path.join(ROOT, cfg.outputDir, today);
const seenFile = path.join(ROOT, cfg.outputDir, 'seen.json');

const BRANDS = {
  itweb:  { mark: 'IT<span style="color:#FF3B2F;">Web</span>', tag: 'Africa’s business technology media community', domain: 'itweb.co.za' },
  africa: { mark: 'ITWeb<span style="color:#FF3B2F;">Africa</span>', tag: 'Business technology media for Africa', domain: 'itweb.africa' }
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = s => String(s ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const curly = s => s.replace(/(\w)'(\w)/g, '$1’$2').replace(/'(\w)/g, '‘$1').replace(/'/g, '’').replace(/"(\S)/g, '“$1').replace(/"/g, '”');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const meta = (html, key) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'))
         || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'));
  return m ? decode(m[1]).trim() : '';
};

async function readFeed(feed) {
  const xml = await (await fetch(feed.url, { headers: { 'user-agent': 'itweb-poster-bot/1.0' } })).text();
  const doc = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const items = [].concat(doc?.rss?.channel?.item ?? []);
  const cutoff = Date.now() - cfg.windowHours * 3600e3;
  return items.map(i => ({
    brand: feed.brand,
    title: decode(i.title).trim(),
    link: String(i.link).trim(),
    date: new Date(i.pubDate || Date.now()).getTime(),
    category: decode([].concat(i.category ?? [])[0] ?? '').trim()
  })).filter(i => i.date >= cutoff && !cfg.skipCategories.includes(i.category)).sort((a, b) => b.date - a.date);
}

async function readArticle(item) {
  const html = await (await fetch(item.link, { headers: { 'user-agent': 'itweb-poster-bot/1.0' } })).text();
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .match(/<p[^>]*>[\s\S]*?<\/p>/gi)?.map(p => decode(p.replace(/<[^>]+>/g, '')).trim()).filter(t => t.length > 60).join('\n\n') ?? '';
  return {
    ...item,
    image: meta(html, 'og:image'),
    dek: meta(html, 'og:description') || meta(html, 'description'),
    kicker: (item.category || meta(html, 'article:section') || 'NEWS').toUpperCase(),
    body: body.slice(0, 12000)
  };
}

// Optional: ask Claude for a fact panel. Must quote only what is in the article.
async function factPanel(a) {
  if (!cfg.useClaude || !process.env.ANTHROPIC_API_KEY) return null;
  const prompt = `From this news article, extract a poster fact panel as JSON only, no prose.
Rules: use ONLY figures and quotes that appear verbatim in the article. Never invent or round numbers. If the article has fewer than 3 hard figures, return {"stats":[]}.
Shape: {"label":"SHORT UPPERCASE LABEL","quote":{"text":"verbatim quote under 25 words","who":"Name, title"}|null,"stats":[{"value":"R20.8m","label":"under 9 words"}],"note":"one factual sentence from the article, under 30 words"}
Give exactly 3 stats when possible; the first is the story's headline figure.

HEADLINE: ${a.title}
ARTICLE:
${a.body}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.claudeModel, max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
  });
  if (!res.ok) { console.warn('Claude call failed', res.status); return null; }
  const text = (await res.json()).content?.[0]?.text ?? '';
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    // Drop any stat whose value doesn't appear in the article text.
    j.stats = (j.stats ?? []).filter(s => a.body.includes(String(s.value).replace(/[^\d.,]/g, '').replace(/\.$/, '')) ).slice(0, 3);
    if (j.quote && !a.body.replace(/[“”"]/g, '').includes(j.quote.text.replace(/[“”"]/g, '').slice(0, 40))) j.quote = null;
    return j;
  } catch { return null; }
}

function headlineHtml(title) {
  const t = curly(esc(title));
  const words = t.split(' ');
  const last = words.pop();
  return `${words.join(' ')} <span style="color:#FF3B2F;">${last}</span>`;
}
const headSize = n => n <= 34 ? 66 : n <= 48 ? 60 : n <= 62 ? 54 : 48;

function posterHtml(a, panel) {
  const F = "font-family:'Libre Franklin',sans-serif;";
  const b = BRANDS[a.brand];
  const hasPanel = panel && panel.stats?.length >= 2;
  const imgH = hasPanel ? 640 : 760;
  const stats = hasPanel ? `
    <div style="display:grid; grid-template-columns:repeat(${panel.stats.length}, 1fr); gap:26px; padding-top:18px; border-top:1px solid rgba(252,251,248,.24);">
      ${panel.stats.map((s, i) => `<div style="display:flex; flex-direction:column; gap:8px;">
        <div style="${F} font-weight:800; font-size:42px; line-height:1; letter-spacing:-.025em; color:${i === 0 ? '#FF3B2F' : '#FCFBF8'};">${esc(s.value)}</div>
        <div style="${F} font-weight:600; font-size:19px; line-height:1.25; color:rgba(252,251,248,.86);">${esc(s.label)}</div></div>`).join('')}
    </div>` : '';
  const quote = hasPanel && panel.quote ? `
    <blockquote style="margin:0; font-family:'Newsreader',serif; font-weight:600; font-size:28px; line-height:1.22; color:#FCFBF8;">“${curly(esc(panel.quote.text))}”</blockquote>` : '';
  const panelBlock = hasPanel ? `
  <div style="margin-top:26px; display:flex; flex-direction:column; gap:16px;">
    <div style="${F} font-weight:700; font-size:16px; letter-spacing:.16em; color:rgba(252,251,248,.62);">${esc((panel.quote?.who || panel.label || '').toUpperCase())}</div>
    ${quote}${stats}
    ${panel.note ? `<div style="${F} font-weight:500; font-size:17px; color:rgba(252,251,248,.55);">${curly(esc(panel.note))}</div>` : ''}
  </div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@500;600;700;800;900&family=Newsreader:opsz,wght@16..72,500;16..72,600;16..72,700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;background:#0A0910}</style></head><body>
<div id="poster" style="position:relative; width:1080px; height:1350px; background:#0A0910; overflow:hidden; color:#FCFBF8; display:flex; flex-direction:column; padding:0 68px 52px;">
  <div style="position:absolute; top:0; left:0; width:1080px; height:${imgH}px; overflow:hidden; background:#141019;">
    ${a.image ? `<img src="${esc(a.image)}" crossorigin="anonymous" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:center 25%;">` : ''}
    <div style="position:absolute; inset:0; background:linear-gradient(180deg, rgba(10,9,16,.14) 0%, rgba(10,9,16,.52) 44%, rgba(10,9,16,.95) 88%, #0A0910 100%);"></div>
    <div style="position:absolute; top:0; left:0; width:100%; height:8px; background:#FF3B2F;"></div>
  </div>
  <div id="head" style="position:absolute; left:68px; right:68px; bottom:${1350 - imgH + 34}px;">
    <div style="${F} font-weight:700; font-size:19px; letter-spacing:.22em; color:#FF3B2F; margin-bottom:20px;">${esc(a.kicker)}</div>
    <h1 style="${F} font-weight:800; font-size:${headSize(a.title.length)}px; line-height:1.04; letter-spacing:-.015em; margin:0; text-transform:uppercase; text-wrap:balance; text-shadow:0 2px 16px rgba(0,0,0,.7);">${headlineHtml(a.title)}</h1>
  </div>
  <div style="flex:0 0 ${imgH}px;"></div>
  <div style="display:flex; align-items:center; width:460px; margin:14px 0 20px;">
    <div style="width:64px; height:6px; background:#FF3B2F; margin-right:14px;"></div>
    <div style="flex:1; height:2px; background:rgba(255,255,255,.55);"></div>
  </div>
  <p id="dek" style="font-family:'Newsreader',serif; font-weight:500; font-size:${hasPanel ? 25 : 32}px; line-height:1.32; margin:0; max-width:900px;">${curly(esc(a.dek))}</p>
  ${panelBlock}
  <div style="margin-top:auto; display:flex; flex-direction:column; align-items:center; gap:10px;">
    <div style="${F} font-weight:900; font-size:32px; letter-spacing:-.02em;">${b.mark}</div>
    <div style="font-family:'Newsreader',serif; font-weight:700; font-size:23px;">${b.tag}</div>
    <div style="font-family:'Newsreader',serif; font-weight:700; font-size:23px; letter-spacing:.06em;">${b.domain}</div>
  </div>
</div></body></html>`;
}

async function render(browser, html, file) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: cfg.scale });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Shrink the dek / headline until nothing overflows the 1350px canvas.
  await page.evaluate(() => {
    const p = document.getElementById('poster'), dek = document.getElementById('dek'), h1 = document.querySelector('h1');
    for (let i = 0; i < 20 && p.scrollHeight > p.clientHeight; i++) dek.style.fontSize = (parseFloat(getComputedStyle(dek).fontSize) - 1) + 'px';
    for (let i = 0; i < 20 && document.getElementById('head').getBoundingClientRect().top < 40; i++) h1.style.fontSize = (parseFloat(getComputedStyle(h1).fontSize) - 2) + 'px';
  });
  await page.locator('#poster').screenshot({ path: file });
  await page.close();
}

const seen = new Set(JSON.parse(await fs.readFile(seenFile, 'utf8').catch(() => '[]')));
const picks = [];
for (const feed of cfg.feeds) {
  try {
    const items = (await readFeed(feed)).filter(i => !seen.has(i.link)).slice(0, feed.perRun);
    picks.push(...items);
  } catch (e) { console.error(`Feed failed: ${feed.url}`, e.message); }
}
if (!picks.length) { console.log('No new stories.'); process.exit(0); }

await fs.mkdir(outDir, { recursive: true });
const browser = DRY ? null : await chromium.launch();
const report = [];
for (const item of picks) {
  const a = await readArticle(item);
  const panel = await factPanel(a);
  const name = `${a.brand === 'africa' ? 'ITWeb-Africa' : 'ITWeb'}-${slug(a.title)}`;
  const html = posterHtml(a, panel);
  await fs.writeFile(path.join(outDir, name + '.html'), html);
  if (!DRY) await render(browser, html, path.join(outDir, name + '.png'));
  seen.add(a.link);
  report.push(`- ${a.title}\n  ${a.link}\n  ${panel?.stats?.length >= 2 ? 'fact panel: ' + panel.stats.map(s => s.value).join(' / ') : 'no fact panel (headline + intro only)'}`);
  console.log('Made', name);
}
await browser?.close();
await fs.writeFile(seenFile, JSON.stringify([...seen].slice(-500), null, 1));
await fs.writeFile(path.join(outDir, 'REVIEW.md'), `# Posters for ${today}\n\nCheck every figure against the article before posting.\n\n${report.join('\n')}\n`);
