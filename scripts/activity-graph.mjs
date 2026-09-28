// Builds assets/activity-graph.svg from the last 31 days of GitHub contributions.
// Run by .github/workflows/activity-graph.yml; can also be run locally with `node scripts/activity-graph.mjs`.
import { mkdir, writeFile } from "node:fs/promises";

const USERNAME = "fraze7";
const DAYS = 31;
const OUTPUT = "assets/activity-graph.svg";

const COLORS = {
  bg: "#0d1117",
  title: "#9be9a8",
  text: "#8b949e",
  grid: "#21262d",
  line: "#3fb950",
  point: "#2ea043",
  area: "#3fb950",
};

// Uses the GraphQL API when a token is available (in GitHub Actions), otherwise
// reads the public contributions page so the script also works locally.
async function fetchContributions() {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const query = `query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
        }
      }
    }`;
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { login: USERNAME } }),
    });
    const json = await res.json();
    if (!res.ok || json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors ?? json)}`);
    return json.data.user.contributionsCollection.contributionCalendar.weeks
      .flatMap((week) => week.contributionDays)
      .map((day) => ({ date: day.date, count: day.contributionCount }));
  }

  const res = await fetch(`https://github.com/users/${USERNAME}/contributions`);
  if (!res.ok) throw new Error(`Contributions page returned ${res.status}`);
  const html = await res.text();
  const tooltips = new Map(
    [...html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)/g)].map((m) => [m[1], m[2]])
  );
  return [...html.matchAll(/<td[^>]*data-date="([^"]+)"[^>]*id="([^"]+)"/g)]
    .map(([, date, id]) => ({ date, count: parseInt(tooltips.get(id), 10) || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function niceMax(value) {
  if (value <= 4) return 4;
  const step = Math.ceil(value / 4);
  return step * 4;
}

function buildSvg(days) {
  const width = 1000;
  const height = 330;
  const pad = { top: 60, right: 30, bottom: 45, left: 50 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...days.map((d) => d.count)));
  const total = days.reduce((sum, d) => sum + d.count, 0);

  const x = (i) => pad.left + (i / (days.length - 1)) * plotW;
  const y = (count) => pad.top + plotH - (count / max) * plotH;
  const points = days.map((d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`);
  const baseline = pad.top + plotH;

  const gridLines = [0, 1, 2, 3, 4].map((step) => {
    const value = (max / 4) * step;
    const gy = y(value).toFixed(1);
    return `<line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" stroke="${COLORS.grid}" />
    <text x="${pad.left - 12}" y="${gy}" text-anchor="end" dominant-baseline="middle">${value}</text>`;
  });

  const xLabels = days.map((d, i) =>
    `<text x="${x(i).toFixed(1)}" y="${baseline + 22}" text-anchor="middle">${Number(d.date.slice(8))}</text>`
  );

  const dots = days.map((d, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(d.count).toFixed(1)}" r="3.5" fill="${COLORS.point}"><title>${d.date}: ${d.count} contribution${d.count === 1 ? "" : "s"}</title></circle>`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${USERNAME}'s contributions over the last ${DAYS} days">
  <style>text { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; fill: ${COLORS.text}; }</style>
  <rect width="100%" height="100%" rx="6" fill="${COLORS.bg}" />
  <text x="${width / 2}" y="32" text-anchor="middle" style="font-size: 20px; font-weight: 600; fill: ${COLORS.title}">${USERNAME}'s Contribution Graph</text>
  <text x="${width - pad.right}" y="32" text-anchor="end">${total} contributions in the last ${DAYS} days</text>
  ${gridLines.join("\n  ")}
  <polygon points="${pad.left},${baseline} ${points.join(" ")} ${width - pad.right},${baseline}" fill="${COLORS.area}" fill-opacity="0.15" />
  <polyline points="${points.join(" ")}" fill="none" stroke="${COLORS.line}" stroke-width="2.5" stroke-linejoin="round" />
  ${dots.join("\n  ")}
  ${xLabels.join("\n  ")}
  <text x="${pad.left + plotW / 2}" y="${height - 6}" text-anchor="middle">Days</text>
</svg>
`;
}

const today = new Date().toISOString().slice(0, 10);
const days = (await fetchContributions()).filter((d) => d.date <= today).slice(-DAYS);
if (days.length < 2) throw new Error("Not enough contribution data to draw a graph");

await mkdir("assets", { recursive: true });
await writeFile(OUTPUT, buildSvg(days));
console.log(`Wrote ${OUTPUT} (${days[0].date} to ${days.at(-1).date})`);
