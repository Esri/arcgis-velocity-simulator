import { createServer } from "node:http";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const servers = new Map();
let pendingWrite = Promise.resolve();
const statePath = fileURLToPath(new URL("../../files/task-progress.json", import.meta.url));
const htmlPath = fileURLToPath(new URL("./progress.html", import.meta.url));
const schema = {
  type: "object",
  required: ["percent", "phase", "etaMinutes", "steps"],
  additionalProperties: false,
  properties: {
    taskId: { type: "string", minLength: 1 },
    startedAt: { type: "integer", minimum: 0 },
    finishedAt: { type: "integer", minimum: 0 },
    initialEstimateMinutes: { type: "number", minimum: 0 },
    title: { type: "string" },
    description: { type: "string" },
    execution: { type: "string" },
    percent: { type: "number", minimum: 0, maximum: 100 },
    phase: { type: "string" },
    etaMinutes: { type: "number", minimum: 0 },
    steps: { type: "array", items: {
      type: "object", required: ["name", "status"], additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1 },
        startedAt: { type: "integer", minimum: 0 },
        finishedAt: { type: "integer", minimum: 0 },
        initialEstimateMinutes: { type: "number", minimum: 0 },
        name: { type: "string" },
        worker: { type: "string" },
        model: { type: "string" },
        status: { enum: ["done", "running", "pending", "blocked"] },
        percent: { type: "number", minimum: 0, maximum: 100 },
        etaMinutes: { type: "number", minimum: 0 }
      }
    } }
  }
};

function timedState(input, previous, now) {
  const taskId = input.taskId || input.title || "task";
  const prior = previous?.taskId === taskId ? previous : null;
  const seen = new Set();
  function timing(value, old, status) {
    const startedAt = value.startedAt ?? old?.startedAt ?? (status === "running" ? now : null);
    const finishedAt = status === "done"
      ? value.finishedAt ?? (old?.status === "done" ? old.finishedAt : null) ?? now : null;
    for (const timestamp of [startedAt, finishedAt]) {
      if (timestamp != null && (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > now)) {
        throw new Error("Recorded times must be valid past or present epoch milliseconds");
      }
    }
    if (startedAt != null && finishedAt != null && finishedAt < startedAt) {
      throw new Error("Recorded finish cannot precede start");
    }
    return {
      startedAt, finishedAt,
      initialEstimateMinutes: old?.initialEstimateMinutes ?? value.initialEstimateMinutes
        ?? (status === "pending" || status === "running" ? value.etaMinutes : null) ?? null,
    };
  }
  const steps = input.steps.map(step => {
    const id = step.id || step.name;
    if (seen.has(id)) throw new Error("Progress step ids must be unique");
    seen.add(id);
    const old = prior?.steps.find(item => (item.id || item.name) === id);
    return { ...step, id, ...timing(step, old, step.status),
      etaAt: step.etaMinutes == null ? null : now + step.etaMinutes * 60000 };
  });
  const status = input.percent === 100 && steps.every(step => step.status === "done") ? "done" : "running";
  return { ...input, taskId, status, ...timing(input, prior, status),
    steps, updatedAt: now, etaAt: now + input.etaMinutes * 60000 };
}

async function startServer() {
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (req.method !== "GET") { res.writeHead(405); res.end("Method not allowed"); return; }
      const pathname = new URL(req.url, "http://127.0.0.1").pathname;
      if (pathname === "/state") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(await readFile(statePath, "utf8"));
      } else if (pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await readFile(htmlPath, "utf8"));
      } else { res.writeHead(404); res.end("Not found"); }
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Progress unavailable: " + error.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

await joinSession({ canvases: [createCanvas({
  id: "task-progress",
  displayName: "Task progress",
  description: "Live numbered milestone progress with overall and per-line percentages and local finish-time estimates.",
  actions: [{
    name: "update",
    description: "Publish verified milestone progress and revise estimated remaining minutes.",
    inputSchema: schema,
    handler: async ({ input }) => {
      async function publish() {
        const now = Date.now();
        let previous = null;
        try { previous = JSON.parse(await readFile(statePath, "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        const state = timedState(input, previous, now);
        const temporaryPath = statePath + ".tmp";
        try {
          await writeFile(temporaryPath, JSON.stringify(state));
          await rename(temporaryPath, statePath);
        } finally {
          await rm(temporaryPath, { force: true });
        }
        return state;
      }

      // Each caller receives its own failure; a failed write must not block later updates.
      const update = pendingWrite.then(publish, publish);
      pendingWrite = update;
      return update;
    }
  }],
  open: async ({ instanceId }) => {
    let entry = servers.get(instanceId);
    if (!entry) { entry = await startServer(); servers.set(instanceId, entry); }
    return { title: "Task progress", url: entry.url };
  },
  onClose: async ({ instanceId }) => {
    const entry = servers.get(instanceId);
    if (entry) {
      servers.delete(instanceId);
      entry.server.closeAllConnections();
      await new Promise(resolve => entry.server.close(resolve));
    }
  }
})] });
