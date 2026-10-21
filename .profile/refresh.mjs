import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickIcons, readme, render, streakOf, usedIcons } from './renderer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(resolve(root, 'profile.json'), 'utf8'));
if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(config.login)) throw new Error('Invalid GitHub username');

const fields = 'name url description isFork stargazerCount primaryLanguage{name} repositoryTopics(first:10){nodes{topic{name}}}';
const query = `query($login:String!){user(login:$login){
  followers{totalCount}
  repositories(ownerAffiliations:OWNER,privacy:PUBLIC,first:100,orderBy:{field:STARGAZERS,direction:DESC}){
    totalCount nodes{${fields} languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}}
  pinnedItems(first:6,types:REPOSITORY){nodes{... on Repository{${fields}}}}
  contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount date weekday}}}}
}}`;

async function loadData() {
  let json;
  if (process.env.GITHUB_TOKEN) {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'mikan-profile' },
      body: JSON.stringify({ query, variables: { login: config.login } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
    json = await response.json();
  } else {
    json = JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`, '-f', `login=${config.login}`], { encoding: 'utf8', timeout: 45000 }));
  }
  if (json.errors) throw new Error('GitHub could not load public profile data');
  const user = json.data?.user;
  if (!user) throw new Error('GitHub profile was not found');
  const convert = r => ({ name: r.name, url: r.url, text: (r.description ?? '').trim(), fork: r.isFork, stars: r.stargazerCount, language: r.primaryLanguage?.name ?? null, topics: r.repositoryTopics.nodes.map(t => t.topic.name) });
  const repositories = user.repositories.nodes;
  const totals = new Map();
  const noise = new Set(['Inno Setup','Batchfile','PowerShell','VBScript','Shell','Makefile','Dockerfile']);
  for (const r of repositories.filter(r => !r.isFork)) for (const { size, node } of r.languages.edges) {
    if (!noise.has(node.name)) totals.set(node.name, (totals.get(node.name) ?? 0) + size);
  }
  const today = new Date().toISOString().slice(0,10);
  const calendar = user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks.slice(-3).map(week => {
    const row = Array(7).fill(null);
    for (const day of week.contributionDays) row[day.weekday] = { c: day.contributionCount, day: Number(day.date.slice(8)), today: day.date === today };
    return row;
  });
  while (days.length < 3) days.unshift(Array(7).fill(null));
  return {
    stars: repositories.filter(r => !r.isFork).reduce((n,r) => n + r.stargazerCount, 0),
    contributions: calendar.totalContributions,
    repos: user.repositories.totalCount,
    followers: user.followers.totalCount,
    languages: [...totals].sort((a,b) => b[1] - a[1]).slice(0,7),
    days,
    streak: streakOf(calendar.weeks.flatMap(w => w.contributionDays).filter(d => d.date <= today).map(d => d.contributionCount)),
    pins: user.pinnedItems.nodes.filter(Boolean).map(convert),
    all: repositories.map(convert),
  };
}

const data = await loadData();
let avatar;
try {
  const response = await fetch(`https://github.com/${encodeURIComponent(config.login)}.png?size=320`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Avatar: HTTP ${response.status}`);
  avatar = `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
  await writeFile(resolve(root, '.profile/avatar.txt'), avatar);
} catch (error) {
  try { avatar = await readFile(resolve(root, '.profile/avatar.txt'), 'utf8'); }
  catch { throw new Error('Could not load the avatar and no previous avatar is available'); }
}

config.hero.brandMark = `data:image/png;base64,${(await readFile(resolve(root, '.profile/mikan.png'))).toString('base64')}`;
let icons;
try { icons = JSON.parse(await readFile(resolve(root,'.profile/icons-all.json'), 'utf8')); }
catch { icons = JSON.parse(await readFile(resolve(root,'.profile/icons.json'), 'utf8')); }
const names = usedIcons(config, data);
for (const name of names) {
  if (name.startsWith('brand:') ? !icons.brand[name.slice(6)] : !icons.symbol[name]) throw new Error(`Missing icon: ${name}`);
}
icons = pickIcons(icons, names);
const rendered = render(config, data, icons, avatar);
let markdown = readme(config, data, rendered);
const sourcePaths = new Set(markdown.match(/profile-assets\/[\w-]+\.svg/g));
const manifestPath = resolve(root, '.profile/asset-versions.json');
let previous = {};
try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const files = {};
const versions = {};
for (const path of sourcePaths) {
  if (!rendered[path]) throw new Error(`Missing generated image: ${path}`);
  const hash = createHash('sha256').update(rendered[path]).digest('hex').slice(0,12);
  const versioned = path.replace(/\.svg$/, `-${hash}.svg`);
  files[versioned] = rendered[path];
  markdown = markdown.replaceAll(path, versioned);
  const older = previous[path] ?? [path];
  if (!Array.isArray(older) || older.some(p => typeof p !== 'string' || !/^profile-assets\/[\w-]+\.svg$/.test(p))) throw new Error('Invalid image version manifest');
  // Retain the previous version for readers with a cached README.
  versions[path] = [...new Set([versioned, ...older])].slice(0,2);
}
const retained = new Set(Object.values(versions).flat());
await mkdir(resolve(root,'profile-assets'), { recursive: true });
for (const file of await readdir(resolve(root,'profile-assets'))) {
  if (file.endsWith('.svg') && !retained.has(`profile-assets/${file}`)) await unlink(resolve(root,'profile-assets',file));
}
for (const [path, content] of Object.entries(files)) {
  await writeFile(resolve(root,path), content);
}
await writeFile(resolve(root,'README.md'), markdown);
await writeFile(manifestPath, JSON.stringify(versions,null,2) + '\n');
await writeFile(resolve(root,'.profile/icons.json'), JSON.stringify(icons));
await writeFile(resolve(root,'.profile/data.json'), JSON.stringify(data,null,2) + '\n');
console.log(`Rendered ${sourcePaths.size} versioned SVG cards; ${config.stack.groups.reduce((n,g) => n+g.items.length,0)} technologies; live public GitHub data.`);
