// post.js — publish the newest generated poster to LinkedIn and/or X.
//
//   node post.js
//
// Reads the newest output/poster-*.json (+ matching .png) and posts it.
// Each platform is OPTIONAL — it runs only if its credentials are present.
//
// ── Credentials (set as environment variables / GitHub Actions secrets) ──
//   LinkedIn (Organization page):
//     LINKEDIN_ACCESS_TOKEN   - OAuth2 token with w_organization_social
//     LINKEDIN_ORG_URN        - e.g. urn:li:organization:1234567
//   X / Twitter (API v2, OAuth 1.0a user context):
//     X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
//
// NOTE: every platform requires YOU to authorize via its official developer
// portal. Tokens live in your environment, never in this code.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');

async function newestPost() {
  const files = (await fs.readdir(OUT_DIR)).filter(f => f.endsWith('.json')).sort();
  if (!files.length) throw new Error('No generated posts in output/. Run `node generate.js` first.');
  const meta = JSON.parse(await fs.readFile(path.join(OUT_DIR, files[files.length - 1]), 'utf8'));
  const png = path.join(OUT_DIR, files[files.length - 1].replace('.json', '.png'));
  return { meta, png };
}

// ───────────────────────── LinkedIn ─────────────────────────
async function postToLinkedIn({ meta, png }) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN, org = process.env.LINKEDIN_ORG_URN;
  if (!token || !org) { console.log('[linkedin] skipped (no credentials)'); return; }
  const h = { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' };

  // 1) register an image upload
  const reg = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ registerUploadRequest: {
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'], owner: org,
      serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
    }}),
  }).then(r => r.json());
  const upload = reg.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
  const asset = reg.value.asset;

  // 2) upload the bytes
  await fetch(upload, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: await fs.readFile(png) });

  // 3) create the share
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author: org, lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: meta.socialCaption },
        shareMediaCategory: 'IMAGE',
        media: [{ status: 'READY', media: asset, title: { text: meta.title } }],
      }},
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  console.log(`[linkedin] ${res.ok ? 'posted ✓' : 'failed: ' + res.status + ' ' + await res.text()}`);
}

// ───────────────────────── X / Twitter ─────────────────────────
// X needs OAuth1.0a-signed requests + the v1.1 media-upload endpoint.
// Use the `twitter-api-v2` package, which handles signing and chunked media.
//   npm i twitter-api-v2
async function postToX({ meta, png }) {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = process.env;
  if (!X_API_KEY || !X_ACCESS_TOKEN) { console.log('[x] skipped (no credentials)'); return; }
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey: X_API_KEY, appSecret: X_API_SECRET,
    accessToken: X_ACCESS_TOKEN, accessSecret: X_ACCESS_SECRET,
  });
  const mediaId = await client.v1.uploadMedia(png);
  // X post body is capped at 280 chars — trim to title + link.
  const body = `${meta.title}\n\n${meta.link}`.slice(0, 270);
  await client.v2.tweet({ text: body, media: { media_ids: [mediaId] } });
  console.log('[x] posted ✓');
}

async function main() {
  const post = await newestPost();
  console.log(`[post] publishing: ${post.meta.title}`);
  await postToLinkedIn(post);
  await postToX(post);
}

main().catch(err => { console.error(err); process.exit(1); });
