// Generates assets/stats.svg from PUBLIC GitHub data (no third-party stats service).
// Node 20+, zero dependencies.
//   node scripts/generate-stats.mjs               -> live data (needs GITHUB_TOKEN in CI)
//   node scripts/generate-stats.mjs --placeholder -> neutral card with no numbers
//   node scripts/generate-stats.mjs --mock        -> random demo data, for local design checks only
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const USER = process.env.GH_USER || 'ArmanGhM';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const OUT = process.env.STATS_OUT || 'assets/stats.svg';
const MODE = process.argv.includes('--placeholder') ? 'placeholder' : process.argv.includes('--mock') ? 'mock' : 'live';

const C = { bg: '#0A0E17', panel: '#101726', panel2: '#141C2E', line: '#1F2B47', txt: '#E6EAF2', muted: '#8B97B0', dim: '#5B6786',
  green: '#34F5A0', cyan: '#22D3EE', violet: '#A78BFA', lime: '#D7FF00' };
const MONO = "'JetBrains Mono','SF Mono','Cascadia Code',Menlo,Consolas,'DejaVu Sans Mono',monospace";
const SANS = "'Segoe UI','Inter','Helvetica Neue',Arial,'DejaVu Sans',sans-serif";
const LANG_COLORS = { JavaScript: '#F1E05A', TypeScript: '#3178C6', HTML: '#E34C26', CSS: '#7A5BD6', SCSS: '#C6538C', Python: '#3572A5', Shell: '#89E051', Vue: '#41B883', Java: '#B07219', 'C++': '#F34B7D', C: '#8B97B0' };
// Colour-cycling theme: same tri-tone filter + timeline as every other SVG in ./assets (red, amber, mint, blue, violet).
const THEMES = [[[1, .16, .24], [.05, .01, .02]], [[1, .78, 0], [.05, .03, .004]], [[.14, .98, .6], [.004, .035, .024]], [[.17, .5, 1], [.008, .022, .065]], [[.66, .33, 1], [.03, .01, .065]]];
function themeFilter(W, H) {
  const D = 4.6, T = 1.8, N = THEMES.length, total = N * (D + T); const kt = [], idx = [];
  for (let i = 0; i < N; i++) { const a = i * (D + T); kt.push(a, a + D); idx.push(i, i); }
  kt.push(total); idx.push(0);
  const keyTimes = kt.map((t) => +(t / total).toFixed(4)).join(';');
  const fn = (name, ch) => {
    const tb = THEMES.map(([t, b]) => [b[ch], b[ch] + (t[ch] - b[ch]) * 0.3, b[ch] + (t[ch] - b[ch]) * 0.72, t[ch], 1].map((v) => v.toFixed(3)).join(' '));
    return `<feFunc${name} type="table" tableValues="${tb[0]}"><animate attributeName="tableValues" values="${idx.map((i) => tb[i]).join(';')}" keyTimes="${keyTimes}" dur="${total}s" repeatCount="indefinite"/></feFunc${name}>`;
  };
  return `<filter id="th" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".299 .587 .114 0 0 .299 .587 .114 0 0 .299 .587 .114 0 0 0 0 0 1 0"/><feComponentTransfer>${fn('R', 0)}${fn('G', 1)}${fn('B', 2)}</feComponentTransfer></filter>`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => new Intl.NumberFormat('en-US').format(n);

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'profile-stats', ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }) } });
  if (!r.ok) throw new Error(`GitHub REST ${path} -> ${r.status}`);
  return r.json();
}
async function gql(query, variables) {
  const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'profile-stats', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(`GitHub GraphQL failed: ${r.status} ${JSON.stringify(j.errors || '')}`);
  return j.data;
}

async function loadLive() {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is required for live mode');
  const user = await gh(`/users/${USER}`);
  const repos = [];
  for (let p = 1; p < 6; p++) {
    const page = await gh(`/users/${USER}/repos?per_page=100&type=owner&page=${p}`);
    repos.push(...page);
    if (page.length < 100) break;
  }
  const own = repos.filter((r) => !r.fork);
  const stars = own.reduce((s, r) => s + r.stargazers_count, 0);
  const langBytes = {};
  for (const r of own) {
    const l = await gh(`/repos/${USER}/${r.name}/languages`);
    for (const [k, v] of Object.entries(l)) langBytes[k] = (langBytes[k] || 0) + v;
  }
  const d = await gql(`query($login:String!){user(login:$login){contributionsCollection{totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions totalIssueContributions contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`, { login: USER });
  const cc = d.user.contributionsCollection;
  return { repos: user.public_repos, stars, followers: user.followers, langBytes,
    total: cc.contributionCalendar.totalContributions, commits: cc.totalCommitContributions, prs: cc.totalPullRequestContributions, reviews: cc.totalPullRequestReviewContributions,
    weeks: cc.contributionCalendar.weeks.map((w) => w.contributionDays.map((x) => ({ date: x.date, n: x.contributionCount }))) };
}

function loadMock() {
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const weeks = []; const start = new Date(); start.setDate(start.getDate() - 52 * 7 - start.getDay());
  for (let w = 0; w < 53; w++) { const days = []; for (let d = 0; d < 7; d++) { const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d); days.push({ date: dt.toISOString().slice(0, 10), n: rnd() < 0.55 ? Math.floor(rnd() * 9) : 0 }); } weeks.push(days); }
  return { repos: 12, stars: 8, followers: 3, langBytes: { JavaScript: 52000, HTML: 31000, TypeScript: 22000, CSS: 17000 }, total: 321, commits: 280, prs: 9, reviews: 2, weeks };
}

function streaks(weeks) {
  const days = weeks.flat().filter((d) => d.date <= new Date().toISOString().slice(0, 10));
  let longest = 0, run = 0, active = 0;
  for (const d of days) { if (d.n > 0) { run++; active++; longest = Math.max(longest, run); } else run = 0; }
  let cur = 0; for (let i = days.length - 1; i >= 0; i--) { if (days[i].n > 0) cur++; else if (i === days.length - 1) continue; else break; }
  return { current: cur, longest, active };
}

const CSS = `text{font-family:${SANS}}.m{font-family:${MONO}}
.pop{opacity:0;animation:pop .6s ease-out forwards}@keyframes pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
.cell{transform-box:fill-box;transform-origin:center}
.grow{transform-box:fill-box;transform-origin:left;transform:scaleX(0);animation:grow 1.4s cubic-bezier(.2,.8,.2,1) forwards}@keyframes grow{to{transform:scaleX(1)}}
.rise{opacity:0;animation:rise .8s ease-out forwards}@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.sweep{animation:sw 6s ease-in-out 2.5s infinite}@keyframes sw{0%{transform:translateX(-120px)}60%,100%{transform:translateX(900px)}}
.pl{animation:pl 2.2s ease-in-out infinite}@keyframes pl{0%,100%{opacity:.35}50%{opacity:1}}
.chase{animation:ch 9s linear infinite}@keyframes ch{to{stroke-dashoffset:-3200}}
@media (prefers-reduced-motion: reduce){*{animation:none!important;opacity:1!important;transform:none!important}}`;

function render(d) {
  const W = 1000, H = 520, ph = MODE === 'placeholder';
  const tiles = ph ? [['Public repos', '–'], ['Stars earned', '–'], ['Followers', '–'], ['Contributions · 1y', '–']]
    : [['Public repos', fmt(d.repos)], ['Stars earned', fmt(d.stars)], ['Followers', fmt(d.followers)], ['Contributions · 1y', fmt(d.total)]];
  const accents = [C.green, C.lime, C.cyan, C.violet];
  let b = `<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="24" fill="${C.panel}" stroke="${C.line}" stroke-width="1.5"/>`;
  tiles.forEach(([label, val], i) => {
    const x = 36 + i * 236;
    b += `<g class="rise" style="animation-delay:${i * 0.12}s"><rect x="${x}" y="30" width="220" height="86" rx="16" fill="${C.panel2}" stroke="${C.line}"/><rect x="${x}" y="30" width="5" height="86" rx="2.5" fill="${accents[i]}"/>` +
         `<text class="m" x="${x + 22}" y="58" font-size="13" fill="${C.muted}">${esc(label)}</text><text x="${x + 22}" y="100" font-size="38" font-weight="800" fill="${ph ? C.dim : C.txt}">${esc(val)}</text></g>`;
  });
  // heatmap
  b += `<text class="m" x="36" y="150" font-size="14" fill="${C.muted}">${ph ? '// contribution activity' : '// contributions, last 12 months'}</text>`;
  const weeks = ph ? Array.from({ length: 53 }, () => Array.from({ length: 7 }, () => ({ date: '', n: 0 }))) : d.weeks;
  const max = Math.max(1, ...weeks.flat().map((x) => x.n));
  const shade = (n) => (n === 0 ? '#16203A' : n <= max * 0.25 ? '#0F5A45' : n <= max * 0.5 ? '#12936A' : n <= max * 0.75 ? '#1FD08A' : C.green);
  const hx = 48, hy = 164, cs = 13, gap = 4;
  weeks.forEach((w, wi) => w.forEach((day, di) => {
    const dly = (wi * 0.025 + di * 0.01).toFixed(2);
    b += ph ? `<rect class="pl" style="animation-delay:${(wi % 9) * 0.2}s" x="${hx + wi * (cs + gap)}" y="${hy + di * (cs + gap)}" width="${cs}" height="${cs}" rx="3" fill="#16203A"/>`
            : `<rect class="cell pop" style="animation-delay:${dly}s" x="${hx + wi * (cs + gap)}" y="${hy + di * (cs + gap)}" width="${cs}" height="${cs}" rx="3" fill="${shade(day.n)}"><title>${esc(day.date)}: ${day.n}</title></rect>`;
  }));
  b += `<rect class="sweep" x="${hx}" y="${hy - 4}" width="60" height="${7 * (cs + gap) + 4}" fill="#fff" opacity=".07" transform-origin="0 0"/>`;
  // languages (kept in their real colours, so drawn outside the theme filter)
  let lang = '';
  const ly = 318;
  b += `<text class="m" x="36" y="${ly}" font-size="14" fill="${C.muted}">// most used languages (by bytes, own repos)</text>`;
  if (ph) {
    b += `<rect x="36" y="${ly + 14}" width="600" height="16" rx="8" fill="#16203A"/><rect class="pl" x="36" y="${ly + 14}" width="260" height="16" rx="8" fill="${C.line}"/>`;
    b += `<text class="m" x="36" y="${ly + 62}" font-size="14" fill="${C.cyan}">Live numbers are generated by GitHub Actions.</text>`;
    b += `<text class="m" x="36" y="${ly + 86}" font-size="13" fill="${C.muted}">Repo → Actions → “Update stats card” → Run workflow (once).</text>`;
    b += `<text class="m" x="36" y="${ly + 110}" font-size="13" fill="${C.dim}">After that it refreshes itself every day.</text>`;
  } else {
    const entries = Object.entries(d.langBytes).sort((a, z) => z[1] - a[1]); const sum = entries.reduce((s, e) => s + e[1], 0) || 1;
    const top = entries.slice(0, 6); const rest = entries.slice(6).reduce((s, e) => s + e[1], 0); if (rest) top.push(['Other', rest]);
    let x = 36; const total = 600;
    top.forEach(([name, bytes], i) => {
      const w = Math.max(6, Math.round((bytes / sum) * total)); const col = LANG_COLORS[name] || C.muted;
      lang += `<rect class="grow" style="animation-delay:${0.4 + i * 0.15}s" x="${x}" y="${ly + 14}" width="${w - 2}" height="16" rx="5" fill="${col}"/>`; x += w;
    });
    top.forEach(([name, bytes], i) => {
      const col = LANG_COLORS[name] || C.muted; const cx = 36 + (i % 3) * 200; const cy = ly + 62 + Math.floor(i / 3) * 30;
      lang += `<g class="rise" style="animation-delay:${0.8 + i * 0.1}s"><circle cx="${cx + 6}" cy="${cy - 5}" r="6" fill="${col}"/><text class="m" x="${cx + 20}" y="${cy}" font-size="14" fill="${C.txt}">${esc(name)}</text><text class="m" x="${cx + 20 + name.length * 8.6 + 8}" y="${cy}" font-size="14" fill="${C.muted}">${((bytes / sum) * 100).toFixed(1)}%</text></g>`;
    });
  }
  // streak + activity panel
  const st = ph ? null : streaks(d.weeks);
  b += `<rect x="676" y="${ly - 8}" width="288" height="176" rx="18" fill="${C.panel2}" stroke="${C.line}"/>`;
  const rows = ph ? [['current streak', '–'], ['longest streak', '–'], ['pull requests', '–']] : [['current streak', `${st.current} day${st.current === 1 ? '' : 's'}`], ['longest streak', `${st.longest} day${st.longest === 1 ? '' : 's'}`], ['pull requests (1y)', fmt(d.prs)]];
  rows.forEach(([l, v], i) => { const y = ly + 28 + i * 52; b += `<text class="m" x="700" y="${y}" font-size="13" fill="${C.muted}">${l}</text><text x="700" y="${y + 24}" font-size="24" font-weight="800" fill="${ph ? C.dim : [C.green, C.lime, C.violet][i]}">${esc(v)}</text>`; });
  b += `<text class="m" x="36" y="${H - 22}" font-size="12" fill="${C.dim}">${ph ? 'placeholder · no data yet' : `updated ${new Date().toISOString().slice(0, 10)} · generated by GitHub Actions from public GitHub data`}</text>`;
  b += `<rect class="chase" x="2" y="2" width="${W - 4}" height="${H - 4}" rx="24" fill="none" stroke="${C.green}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="180 3020"/>`;
  const desc = ph ? 'Placeholder for the live GitHub stats card. Numbers appear after the first GitHub Actions run.'
    : `GitHub stats for ${USER}: ${d.repos} public repositories, ${d.stars} stars, ${d.followers} followers, ${d.total} contributions in the last year.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d"><title id="t">GitHub stats for ${esc(USER)}</title><desc id="d">${esc(desc)}</desc><style>${CSS}</style><defs>${themeFilter(W, H)}</defs><g filter="url(#th)">${b}</g>${lang}</svg>`;
}

const data = MODE === 'live' ? await loadLive() : MODE === 'mock' ? loadMock() : null;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, render(data));
console.log(`stats card written to ${OUT} (${MODE})`);
