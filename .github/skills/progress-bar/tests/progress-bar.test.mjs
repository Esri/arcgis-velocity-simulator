import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

const extensionSource = await readFile(new URL("../templates/extension.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("../templates/progress.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const themeSource = scripts[0];
const rendererSource = scripts.at(-1);

// Run the actual templates without requiring the host SDK or a browser dependency.
async function loadExtension(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "progress-bar-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "files"));
  await mkdir(join(root, "extensions/task-progress"), { recursive: true });
  await writeFile(join(root, "extensions/task-progress/progress.html"), html);
  let canvas;
  const source = extensionSource
    .replace(/^import .+;\r?$/gm, "")
    .replaceAll("import.meta.url", "extensionUrl");
  await runInNewContext(`(async () => { ${source} })()`, {
    URL, Date, Map, Promise,
    extensionUrl: pathToFileURL(join(root, "extensions/task-progress/extension.mjs")).href,
    fileURLToPath, readFile, writeFile, rename, rm, createServer,
    createCanvas: value => value,
    joinSession: async options => { canvas = options.canvases[0]; },
    ...overrides
  });
  return {
    update: input => canvas.actions[0].handler({ input }),
    open: instanceId => canvas.open({ instanceId }),
    close: instanceId => canvas.onClose({ instanceId }),
    readState: async () => JSON.parse(await readFile(join(root, "files/task-progress.json"), "utf8")),
    files: () => readdir(join(root, "files"))
  };
}

function input(title) {
  return {
    title, phase: "Working", percent: 25, etaMinutes: 2,
    steps: [{ name: "Check", status: "running", percent: 25, etaMinutes: 1 }]
  };
}

function element() {
  return {
    children: [], style: {}, attributes: {}, textContent: "", value: "20", listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.listeners[name] = handler; }
  };
}

async function render(state, viewMode = "compact") {
  const nodes = new Map();
  const document = {
    createElement: element,
    querySelector(selector) {
      if (!nodes.has(selector)) {
        const node = element();
        if (selector === "#view-mode") node.value = viewMode;
        nodes.set(selector, node);
      }
      return nodes.get(selector);
    }
  };
  const context = {
    document, Date,
    fetch: async () => ({ ok: true, json: async () => state }),
    setInterval() {}
  };
  // Suppress only automatic startup; refresh still executes the real fetch/render path.
  runInNewContext(rendererSource.replace(/\bstart\(\);\s*$/, ""), context);
  await context.refresh();
  assert.equal(document.querySelector("#error").textContent, "");
  return nodes;
}

test("unfinished fractions and inconsistent percentages never display completion", async () => {
  const state = {
    ...input("Fractional"),
    percent: 99.6, etaAt: Date.now() + 60000, updatedAt: Date.now(),
    steps: [
      { name: "Running", status: "running", percent: 99.6, etaAt: Date.now() + 60000 },
      { name: "Pending", status: "pending", percent: 100 },
      { name: "Blocked", status: "blocked", percent: 100 },
      { name: "Done", status: "done", percent: 25 }
    ]
  };
  const nodes = await render(state);
  assert.equal(nodes.get("#percent").textContent, "99%");
  assert.notEqual(nodes.get("#eta").textContent, "Done");
  const rows = nodes.get("#steps").children.map(li => li.children[0].children);
  assert.deepEqual(rows.map(row => row[3].textContent), ["99%", "99%", "99%", "100%"]);
  assert.match(rows[0][2].textContent, /ETA/);
  assert.equal(rows[1][2].textContent, "Queued");
  assert.equal(rows[2][2].textContent, "Blocked");
  assert.equal(rows[3][2].textContent, "Done");
  assert.equal(rows[0][0].textContent, "#1  Running");
  const inconsistent = await render({ ...state, percent: 100 });
  assert.equal(inconsistent.get("#percent").textContent, "99%");
  assert.notEqual(inconsistent.get("#eta").textContent, "Done");
});

test("validated completion displays 100 percent and Done", async () => {
  const nodes = await render({
    ...input("Complete"), percent: 100, updatedAt: Date.now(),
    steps: [{ name: "Check", status: "done" }]
  });
  assert.equal(nodes.get("#percent").textContent, "100%");
  assert.equal(nodes.get("#eta").textContent, "Done");
  assert.equal(nodes.get("#steps").children[0].children[0].children[3].textContent, "100%");
});

test("readers retain a complete snapshot while the next write is in progress", async t => {
  let pause = false;
  let release;
  let reached;
  const started = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const extension = await loadExtension(t, {
    writeFile: async (path, content) => {
      if (pause) {
        await writeFile(path, "");
        reached();
        await gate;
      }
      await writeFile(path, content);
    }
  });
  await extension.update(input("Before"));
  pause = true;
  const update = extension.update(input("After"));
  await started;
  try {
    assert.equal((await extension.readState()).title, "Before");
  } finally {
    release();
    await update;
  }
  const state = await extension.readState();
  assert.equal(state.title, "After");
  assert.equal(state.etaAt, state.updatedAt + 120000);
  assert.equal(state.steps[0].etaAt, state.updatedAt + 60000);
  assert.deepEqual(await extension.files(), ["task-progress.json"]);
});

test("concurrent updates publish in invocation order without overlapping writes", async t => {
  let active = 0;
  let maxActive = 0;
  const extension = await loadExtension(t, {
    writeFile: async (path, content) => {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await writeFile(path, content);
      } finally {
        active--;
      }
    }
  });
  const results = await Promise.all(["First", "Second", "Third"].map(title => extension.update(input(title))));
  assert.deepEqual(results.map(state => state.title), ["First", "Second", "Third"]);
  assert.equal(maxActive, 1);
  assert.equal((await extension.readState()).title, "Third");
  assert.deepEqual(await extension.files(), ["task-progress.json"]);
});

test("publication failures reach callers, preserve state, and allow a later update", async t => {
  let fail = false;
  const extension = await loadExtension(t, {
    rename: async (...args) => {
      if (fail) { throw new Error("Publication denied"); }
      await rename(...args);
    }
  });
  await extension.update(input("Before"));
  fail = true;
  await assert.rejects(extension.update(input("Rejected")), /Publication denied/);
  assert.equal((await extension.readState()).title, "Before");
  assert.deepEqual(await extension.files(), ["task-progress.json"]);
  fail = false;
  await extension.update(input("Recovered"));
  assert.equal((await extension.readState()).title, "Recovered");
});

test("only supported URL themes select an explicit override", () => {
  for (const [search, expected] of [
    ["?theme=light", "light"],
    ["?theme=dark", "dark"],
    ["?theme=auto", undefined],
    ["", undefined],
    ["?theme=unknown", undefined]
  ]) {
    const root = element();
    runInNewContext(themeSource, {
      URLSearchParams, location: { search }, document: { documentElement: root }
    });
    assert.equal(root.attributes["data-progress-theme"], expected);
  }
});

test("theme URLs serve the renderer while state and route errors remain available", async t => {
  const extension = await loadExtension(t);
  const { url } = await extension.open("theme-test");
  t.after(() => extension.close("theme-test"));
  await extension.update(input("Theme routes"));
  for (const query of ["?theme=light", "?theme=dark", "?theme=auto", "?theme=unknown"]) {
    const response = await fetch(url + query);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), html);
  }
  const state = await fetch(url + "state?theme=light");
  assert.equal((await state.json()).title, "Theme routes");
  assert.equal((await fetch(url + "missing?theme=dark")).status, 404);
  assert.equal((await fetch(url + "?theme=light", { method: "POST" })).status, 405);
});

test("stable task and step identities retain estimates and recorded durations", async t => {
  let now = 100000;
  const extension = await loadExtension(t, { Date: { now: () => now } });
  const first = await extension.update({ ...input("Title"), taskId: "release",
    initialEstimateMinutes: 10,
    steps: [{ id: "build", name: "Build", status: "running", etaMinutes: 3 }] });
  now += 60000;
  const second = await extension.update({ ...input("Renamed title"), taskId: "release",
    etaMinutes: 1, initialEstimateMinutes: 99,
    steps: [{ id: "build", name: "Build packages", status: "blocked", etaMinutes: 1 }] });
  assert.equal(second.startedAt, first.startedAt);
  assert.equal(second.steps[0].startedAt, first.steps[0].startedAt);
  assert.equal(second.initialEstimateMinutes, 10);
  assert.equal(second.steps[0].initialEstimateMinutes, 3);
  now += 60000;
  const completed = await extension.update({ ...input("Complete"), taskId: "release", percent: 100,
    steps: [{ id: "build", name: "Build packages", status: "done" }] });
  assert.equal(completed.finishedAt - completed.startedAt, 120000);
  assert.equal(completed.steps[0].finishedAt - completed.steps[0].startedAt, 120000);
  now += 60000;
  const repeated = await extension.update({ ...input("Complete"), taskId: "release", percent: 100,
    steps: [{ id: "build", name: "Build packages", status: "done" }] });
  assert.equal(repeated.finishedAt, completed.finishedAt);
  assert.equal(repeated.steps[0].finishedAt, completed.steps[0].finishedAt);
  const nodes = await render(repeated);
  assert.match(nodes.get("#overall-timing").textContent, /Est 10m.*Actual 2m/);
  assert.match(nodes.get("#steps").children[0].children[0].children[1].textContent, /Est 3m.*Actual 2m/);
  assert.equal(nodes.get("#steps").children[0].children.length, 2, "Only one info row and its thin bar");
  assert.match(nodes.get("#steps").children[0].children[0].children[1].attributes.title, /Started.*Finished/);
  const newTask = await extension.update({ ...input("Complete"), taskId: "another" });
  assert.equal(newTask.startedAt, now);
  assert.equal(newTask.initialEstimateMinutes, 2);
  assert.equal(newTask.finishedAt, null);
});

test("pending and historical completed steps do not invent start times", async t => {
  const extension = await loadExtension(t);
  const state = await extension.update({ ...input("History"), steps: [
    { id: "old", name: "Already finished", status: "done", etaMinutes: 0 },
    { id: "queued", name: "Waiting", status: "pending" },
  ] });
  assert.equal(state.steps[0].startedAt, null);
  assert.equal(state.steps[0].initialEstimateMinutes, null);
  assert.equal(state.steps[1].startedAt, null);
  const nodes = await render(state);
  assert.match(nodes.get("#steps").children[0].children[0].children[1].textContent, /Actual \u2014/);
  assert.match(nodes.get("#steps").children[0].children[0].children[1].attributes.title, /Start not recorded/);
});

test("invalid timestamps and duplicate ids fail without overwriting persisted state", async t => {
  const extension = await loadExtension(t, { Date: { now: () => 1000 } });
  await extension.update(input("Before"));
  await assert.rejects(extension.update({ ...input("Bad"), startedAt: 1001 }), /Recorded times/);
  await assert.rejects(extension.update({ ...input("Bad"), percent: 100,
    startedAt: 900, finishedAt: 800, steps: [{ name: "Done", status: "done" }] }), /precede/);
  await assert.rejects(extension.update({ ...input("Bad"), steps: [
    { id: "same", name: "One", status: "pending" },
    { id: "same", name: "Two", status: "pending" },
  ] }), /unique/);
  assert.equal((await extension.readState()).title, "Before");
});

test("refresh defaults to 20 seconds, changes interval, supports manual refresh and avoids overlap", async () => {
  const nodes = new Map(), intervals = [], cleared = [];
  let fetches = 0, release;
  const document = {
    createElement: element,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    }
  };
  const context = {
    document, Date,
    setInterval(callback, milliseconds) {
      const id = intervals.length + 1;
      intervals.push({ id, callback, milliseconds });
      return id;
    },
    clearInterval(id) { cleared.push(id); },
    fetch: () => {
      fetches++;
      return new Promise(resolve => { release = () => resolve({
        ok: true, json: async () => ({ ...input("Live"), updatedAt: Date.now() })
      }); });
    }
  };
  runInNewContext(rendererSource, context);
  assert.deepEqual(intervals.map(item => item.milliseconds), [20000, 1000]);
  const pending = context.refresh();
  assert.equal(fetches, 1);
  assert.equal(nodes.get("#refresh-now").disabled, true);
  release();
  await pending;
  assert.equal(nodes.get("#refresh-now").disabled, false);
  const selector = nodes.get("#refresh-interval");
  selector.value = "5";
  selector.listeners.change();
  assert.equal(intervals.at(-1).milliseconds, 5000);
  assert.ok(cleared.includes(1));
  selector.value = "0";
  selector.listeners.change();
  assert.ok(cleared.includes(3));
  const manual = nodes.get("#refresh-now").listeners.click();
  assert.equal(fetches, 2);
  release();
  await manual;
  assert.match(nodes.get("#updated").textContent, /Last refreshed.*Last work update/);
  assert.equal(typeof nodes.get("#view-mode").listeners.change, "function");
});

test("compact, standard and detailed use one, two and three information rows with trailing percentages", async () => {
  const state = { ...input("Views"), startedAt: 100000, finishedAt: 160000, updatedAt: 160000,
    steps: [{ name: "Build", status: "done", percent: 100,
      startedAt: 100000, finishedAt: 160000, initialEstimateMinutes: 2, worker: "Builder", model: "Confirmed model" }] };
  const compact = await render(state);
  const compactStep = compact.get("#steps").children[0];
  assert.equal(compactStep.children.length, 2);
  assert.equal(compactStep.children[0].children.at(-1).textContent, "100%");
  assert.equal(compact.get("#overall-details").textContent, "");
  const standard = await render(state, "standard");
  const standardStep = standard.get("#steps").children[0];
  assert.equal(standardStep.children.length, 3);
  assert.match(standardStep.children[2].textContent, /Est 2m.*Actual 1m.*Started.*Finished/);
  assert.equal(standard.get("#overall-times").textContent, "");
  const detailed = await render(state, "detailed");
  const detailedStep = detailed.get("#steps").children[0];
  assert.equal(detailedStep.children.length, 4);
  assert.match(detailedStep.children[2].textContent, /Est 2m.*Actual 1m/);
  assert.doesNotMatch(detailedStep.children[2].textContent, /Started/);
  assert.match(detailedStep.children[3].textContent, /Started.*Finished.*Builder.*Confirmed model/);
  assert.match(detailed.get("#overall-times").textContent, /Started.*Finished/);
  assert.equal(detailedStep.children[0].children.at(-1).textContent, "100%");
});
