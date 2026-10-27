import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export function normalizeGithubRepo(repo, { period = "" } = {}) {
  const stars = Number(repo.stargazers_count ?? repo.stars ?? 0);
  return {
    id: `github:${repo.full_name || repo.name}`,
    type: repo.agent ? "agent-tool" : "ai-tool",
    name: repo.full_name || repo.name,
    url: repo.html_url || repo.url,
    source: "GitHub",
    stars,
    starDelta7d: Number(repo.starDelta7d ?? 0),
    latestReleaseAt: repo.latestReleaseAt || null,
    maturity: stars > 10000 ? "established" : stars > 2000 ? "growing" : "early",
    companyFit: "待信息部审核",
    risks: ["需核查许可证、数据边界和运维成本"],
    reviewStatus: "candidate",
    period,
  };
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const period = arg("--period", new Date().toISOString().slice(0, 10));
  const output = arg("--output", `.local-data/${period}/radar-candidates.json`);
  const payload = {
    collectedAt: new Date().toISOString(),
    period,
    source: "GitHub public API",
    warnings: process.env.GITHUB_TOKEN ? [] : ["未设置 GITHUB_TOKEN，本次仅生成空候选文件；正式采集建议配置环境变量。"],
    items: [],
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Radar candidates written to ${output}`);
}
