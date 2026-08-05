const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY || "zhaowi0503-rgb/SKINTIFIC";
const workflow = process.env.GITHUB_WORKFLOW || "marketplace-sales-report.yml";
const ref = process.env.GITHUB_REF || "main";

if (!token) {
  throw new Error("GITHUB_TOKEN is required");
}

const response = await fetch(
  `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`,
  {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "skintific-marketplace-report-scheduler",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      ref,
      inputs: {
        mode: "scheduled",
        report_end: "",
        force: "false",
        dry_run: "false",
      },
    }),
  },
);

if (response.status !== 204) {
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`GitHub workflow dispatch failed: ${response.status} ${detail}`);
}

console.log(`[dispatch] accepted repository=${repository} workflow=${workflow} ref=${ref}`);
