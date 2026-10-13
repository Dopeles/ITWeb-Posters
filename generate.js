// generate.js — fetch the latest ITWeb article from RSS, render the poster to PNG.
//
//   node generate.js
//
// Output:
//   output/poster-YYYY-MM-DD.png   the share image (2x = 2166x2900)
//   output/poster-YYYY-MM-DD.json  { title, link, caption, socialCaption, hashtags }
//
// post.js reads the newest pair and publishes it.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';
import puppeteer from 'puppeteer';
import { pickKeyword, buildHeadlineHtml, buildSocialCaption, enhanceWithClaude } from './caption.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEED = process.env.ITWEB_FEED || 'https://www.itweb.co.za/rss';
const OUT_DIR = path.join(__dirname, 'output');
const TEMPLATE = path.join(__dirname, 'poster-template.html');
const LOGO = path.join(__dirname, 'itweb-logo.png'); // drop the official logo here (transparent PNG)

const parser = new Parser({
  customFields: { item: [['media:content', 'mediaContent', { keepArray: true }], ['content:encoded', 'contentEncoded']] },
});

// --- pull the first usable image URL out of an RSS item ---
function extractImage(item) {
  if (item.enclosure?.url && /^https?:/.test(item.enclosure.url)) return item.enclosure.url;
  if (Array.isArray(item.mediaContent)) {
    const m = item.mediaContent.find(x => x?.$?.url);
    if (m) return m.$.url;
  }
  const html = item.contentEncoded || item['content:encoded'] || item.content || '';
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (match) return match[1];
  return null;
}

async function fileExists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function logoHtml() {
  if (await fileExists(LOGO)) {
    const data = await fs.readFile(LOGO);
    return `<img class="logo" src="data:image/png;base64,${data.toString('base64')}" alt="ITWeb">`;
  }
  // fallback text wordmark if no logo file present
  return `<div class="wordmark"><div class="dot"></div><div class="wm">ITWeb</div></div>`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`[generate] fetching ${FEED}`);
  const feed = await parser.parseURL(FEED);
  const item = feed.items?.[0];
  if (!item) throw new Error('No items in feed');
  console.log(`[generate] latest: ${item.title}`);

  const imageUrl = extractImage(item);
  if (!imageUrl) console.warn('[generate] no image found in feed item — poster will show the dark fallback bg');

  const keyword = pickKeyword(item.title || '');
  const headlineHtml = buildHeadlineHtml(item.title || '', keyword);
  const caption = (item.contentSnippet || item.summary || item.description || '')
    .replace(/\s+/g, ' ').trim().slice(0, 160);

  let social = buildSocialCaption(item, keyword);
  social = await enhanceWithClaude(item, social); // no-op unless ANTHROPIC_API_KEY set

  // --- fill template ---
  let html = await fs.readFile(TEMPLATE, 'utf8');
  html = html
    .replaceAll('{{IMAGE_URL}}', imageUrl || '')
    .replace('{{HEADLINE_HTML}}', headlineHtml)
    .replace('{{CAPTION}}', caption)
    .replace('{{LOGO_HTML}}', await logoHtml());

  // --- render ---
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1083, height: 1450, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);

    const date = new Date().toISOString().slice(0, 10);
    const pngPath = path.join(OUT_DIR, `poster-${date}.png`);
    await page.screenshot({ path: pngPath });
    console.log(`[generate] wrote ${pngPath}`);

    const meta = {
      title: item.title, link: item.link, date,
      image: imageUrl, keyword, caption,
      socialCaption: social.text, hashtags: social.hashtags,
    };
    await fs.writeFile(path.join(OUT_DIR, `poster-${date}.json`), JSON.stringify(meta, null, 2));
    console.log('[generate] done');
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
