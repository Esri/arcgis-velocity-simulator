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
    children: [], style: {}, attributes: {}, textContent: "",
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

async function render(state) {
  const nodes = new Map();
  const document = {
    createElement: element,
    querySelector(selector) {
      if (!nodes.has(selector)) { nodes.set(selector, element()); }
      return nodes.get(selector);
    }
  };
  const context = {
    document, Date,
    fetch: async () => ({ ok: true, json: async () => state }),
    setInterval() {}
  };
  // Suppress only automatic startup; refresh still executes the real fetch/render path.
  runInNewContext(rendererSource.replace("refresh();setInterval", "setInterval"), context);
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
  assert.deepEqual(rows.map(row => row[1].textContent), ["99%", "99%", "99%", "100%"]);
  assert.match(rows[0][2].textContent, /min left/);
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
  assert.equal(nodes.get("#steps").children[0].children[0].children[1].textContent, "100%");
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
