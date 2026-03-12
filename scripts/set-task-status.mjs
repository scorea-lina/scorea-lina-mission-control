import { setTaskStatus } from "../src/lib/taskControlPlaneClient";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

const idRaw = arg("id");
const status = arg("status");

if (!idRaw || !status) {
  console.error("Usage: node scripts/set-task-status.mjs --id <num> --status <assigned|in_progress|in_review|ready|done>");
  process.exit(2);
}

const taskId = Number(idRaw);
if (!Number.isFinite(taskId)) {
  console.error("Invalid --id");
  process.exit(2);
}

const baseUrl = process.env.MC_BASE_URL;
const apiKey = process.env.API_KEY;

if (!baseUrl || !apiKey) {
  console.error("Missing env: MC_BASE_URL and/or API_KEY");
  process.exit(2);
}

const out = await setTaskStatus(baseUrl, apiKey, taskId, status);
console.log(JSON.stringify(out, null, 2));
