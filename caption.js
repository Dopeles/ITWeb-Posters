// caption.js — headline highlighting + social caption / hashtag building.
// Pure helpers, no network. generate.js imports these.

const STOP = new Set([
  'the','a','an','and','or','but','for','nor','on','in','at','to','of','by','as','is','are',
  'was','were','be','been','with','from','that','this','it','its','into','over','under','out',
  'up','down','off','than','then','so','via','amid','over','new','says','say','said','how','why',
]);

// Words worth highlighting in red when they appear in a headline (priority order).
const PRIORITY = [
  'risk','ai','cyber','cybersecurity','breach','breaches','ransomware','phishing','threat','threats',
  'data','cloud','security','attack','attacks','hack','hacking','fraud','privacy','quantum','5g',
  'chip','chips','outage','scam','malware','identity','deepfake','deepfakes','startup','funding',
];

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function clean(w) { return w.replace(/[^A-Za-z0-9'\-]/g, ''); }

// Choose the single most "punchy" word in the title to colour red.
export function pickKeyword(title) {
  const words = title.split(/\s+/).map(clean).filter(Boolean);
  for (const p of PRIORITY) {
    const m = words.find(w => w.toLowerCase() === p);
    if (m) return m;
  }
  let best = '';
  for (const w of words) {
    if (w.length > best.length && !STOP.has(w.toLowerCase())) best = w;
  }
  return best || words[words.length - 1] || '';
}

// Build the headline markup with the keyword wrapped in <span class="red">.
export function buildHeadlineHtml(title, keyword) {
  const safe = escHtml(title.trim());
  if (!keyword) return safe;
  const re = new RegExp('(^|\\s)(' + escRe(keyword) + ')(\\s|$|[.,!?:;])', 'i');
  return safe.replace(re, (m, pre, word, post) => `${pre}<span class="red">${word}</span>${post}`);
}

function truncate(s, n) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '\u2026' : s;
}

function buildHashtags(title, desc, keyword) {
  const base = ['#ITWeb', '#TechNews', '#SouthAfrica'];
  const text = (title + ' ' + desc).toLowerCase();
  const map = {
    '#CyberSecurity': /cyber|security|ciso|breach|ransomware|phishing|hack|threat/,
    '#AI': /\bai\b|artificial intelligence|machine learning|genai|llm/,
    '#Cloud': /cloud|azure|aws|datacent/,
    '#Fintech': /bank|fintech|payment|fraud/,
    '#DataPrivacy': /privacy|popia|gdpr|data protection/,
  };
  const extra = Object.entries(map).filter(([, re]) => re.test(text)).map(([t]) => t);
  if (keyword && /^[a-z0-9]+$/i.test(keyword)) {
    const tag = '#' + keyword.replace(/[^A-Za-z0-9]/g, '');
    if (tag.length > 2) extra.push(tag);
  }
  return [...new Set([...base, ...extra])].slice(0, 6);
}

// The text that goes in the social post body.
export function buildSocialCaption(item, keyword) {
  const title = (item.title || '').trim();
  const desc = item.contentSnippet || item.summary || item.description || '';
  const hashtags = buildHashtags(title, desc, keyword);
  const text = [
    title,
    '',
    truncate(desc, 180),
    '',
    `Read more: ${item.link}`,
    '',
    hashtags.join(' '),
  ].join('\n');
  return { text, hashtags };
}

// OPTIONAL: rewrite the caption with Claude for a punchier hook.
// Only runs if ANTHROPIC_API_KEY is set and @anthropic-ai/sdk is installed.
export async function enhanceWithClaude(item, fallback) {
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content:
          `Write a short, professional LinkedIn/X post for this South African tech-news article. ` +
          `1-2 sentence hook, no emojis, end with the link and 3-5 relevant hashtags.\n\n` +
          `Title: ${item.title}\nSummary: ${item.contentSnippet || item.description || ''}\nLink: ${item.link}`,
      }],
    });
    const text = msg.content?.map(b => b.text || '').join('').trim();
    return text ? { text, hashtags: fallback.hashtags } : fallback;
  } catch (e) {
    console.warn('[caption] Claude enhancement skipped:', e.message);
    return fallback;
  }
}
