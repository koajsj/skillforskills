import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  addCustomRoot,
  createInventoryCache,
  findSkillFiles,
  parseSkillDocument,
  routeTask,
  scanSkillInventory,
  startServer,
} from "../plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs";

const ROUTER_SCRIPT = fileURLToPath(
  new URL(
    "../plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs",
    import.meta.url,
  ),
);

function skill(id, capabilities, description = id) {
  return {
    id,
    name: id,
    qualifiedName: id,
    description,
    excerpt: description,
    source: "test",
    rootKind: "custom",
    rootPath: "/test/skills",
    trust: "custom",
    trustReason: "test fixture",
    version: null,
    capabilities,
    explicitSelectionOnly: false,
    requiresSetup: false,
  };
}

async function writeSkill(directory, name, description = `${name} description`) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`,
    "utf8",
  );
}

function root(kind, rootPath) {
  return {
    kind,
    label: `${kind} test root`,
    path: rootPath,
    displayPath: rootPath,
    automatic: kind !== "custom",
    available: true,
  };
}

function inventory(skills = []) {
  return {
    skills,
    total: skills.length,
    counts: skills.length ? { test: skills.length } : {},
    roots: [],
    scan: {
      truncated: false,
      truncatedRoots: [],
      blockedRoots: [],
      discoveredFiles: skills.length,
      scannedDirectories: 1,
      limits: {
        maxFilesPerRoot: 1_500,
        maxDirectoriesPerRoot: 10_000,
        maxConcurrentReads: 32,
      },
    },
    conflicts: [],
    scannedAt: "2026-08-28T00:00:00.000Z",
  };
}

test("parses YAML folded and literal block scalar indicators", () => {
  const folded = parseSkillDocument("---\nname: demo\ndescription: >-\n  first line\n  second line\n---\nbody");
  const literal = parseSkillDocument("---\nname: demo\ndescription: |+\n  first line\n  second line\n---\nbody");

  assert.equal(folded.description, "first line second line");
  assert.equal(literal.description, "first line\nsecond line");
});

test("keeps package and plugin versions aligned", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const pluginJson = JSON.parse(
    await readFile(
      new URL("../plugins/skill-for-skills/.codex-plugin/plugin.json", import.meta.url),
      "utf8",
    ),
  );

  assert.equal(packageJson.version, pluginJson.version);
});

test("returns an explicit unmatched result instead of selecting a zero-score Skill", () => {
  const result = routeTask("研究最新的市场趋势", [skill("formatter", [])]);

  assert.equal(result.unmatched, true);
  assert.deepEqual(result.selected, []);
  assert.equal(result.routeSummary, "");
});

test("separates security, code review, and UX audit routing", () => {
  const skills = [
    skill("security-scan", ["security"]),
    skill("review-agent", ["code-review"]),
    skill("ux-audit", ["ux-audit"]),
  ];

  const security = routeTask("审查这个仓库的代码安全性", skills);
  const review = routeTask("帮我做代码 review", skills);
  const ux = routeTask("评估用户体验和可用性", skills);

  assert.deepEqual(security.detectedCapabilities.map((item) => item.id), ["security"]);
  assert.equal(security.selected[0].id, "security-scan");
  assert.deepEqual(review.detectedCapabilities.map((item) => item.id), ["code-review"]);
  assert.equal(review.selected[0].id, "review-agent");
  assert.deepEqual(ux.detectedCapabilities.map((item) => item.id), ["ux-audit"]);
  assert.equal(ux.selected[0].id, "ux-audit");
});

test("does not match api inside unrelated English words", () => {
  const result = routeTask("research capital markets", [
    skill("code-helper", ["code"], "API backend coding"),
    skill("research-helper", ["research"], "research papers and market analysis"),
  ]);

  assert.deepEqual(result.detectedCapabilities.map((item) => item.id), ["research"]);
  assert.deepEqual(result.selected.map((item) => item.id), ["research-helper"]);
});

test("rejects a custom root that resolves through a symbolic link to the home directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-link-"));
  const link = path.join(tempDir, "home-link");
  try {
    await symlink(os.homedir(), link);

    await assert.rejects(
      () => addCustomRoot(link),
      /不能扫描整块磁盘或整个用户目录/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("allows removing a legacy protected root from isolated configuration", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-remove-protected-"));
  const isolatedHome = path.join(tempDir, "home");
  const configDir = path.join(isolatedHome, ".skill-router");
  try {
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "config.json"),
      `${JSON.stringify({ customRoots: [tempDir] }, null, 2)}\n`,
      "utf8",
    );

    const result = spawnSync(process.execPath, [ROUTER_SCRIPT, "remove-root", tempDir], {
      encoding: "utf8",
      env: { ...process.env, HOME: isolatedHome },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(configDir, "config.json"), "utf8")),
      { customRoots: [] },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("requires a token before changing custom roots through the local API", async () => {
  const messages = [];
  const server = startServer(0, {
    writeToken: "test-write-token",
    logger: {
      log(message) {
        messages.push(message);
      },
    },
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  assert.equal(messages.some((message) => message.includes("test-write-token")), false);

  try {
    const unauthorized = await fetch(`http://127.0.0.1:${port}/roots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/" }),
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`http://127.0.0.1:${port}/roots`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-write-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: "/" }),
    });
    assert.equal(authorized.status, 400);
    assert.match((await authorized.json()).error, /不能扫描整块磁盘/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("does not log a generated API write token", async () => {
  const messages = [];
  const server = startServer(0, {
    logger: {
      log(message) {
        messages.push(message);
      },
    },
  });
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    assert.equal(messages.some((message) => /API write token: [a-f0-9]{64}/i.test(message)), false);
    assert.equal(messages.some((message) => message.includes("generated and redacted")), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("coalesces inventory scans, caches results, and supports explicit refresh", async () => {
  let scans = 0;
  const cache = createInventoryCache({
    ttlMs: 60_000,
    scanInventory: async () => {
      scans += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return inventory();
    },
  });

  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  const cached = await cache.get();

  assert.equal(scans, 1);
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.coalesced, true);
  assert.equal(cached.cache.hit, true);

  await cache.refresh();
  assert.equal(scans, 2);

  cache.invalidate();
  await cache.get();
  assert.equal(scans, 3);
});

test("does not repopulate the cache with a scan invalidated in flight", async () => {
  let scans = 0;
  let releaseFirstScan;
  const firstScanBlocked = new Promise((resolve) => {
    releaseFirstScan = resolve;
  });
  const cache = createInventoryCache({
    ttlMs: 60_000,
    scanInventory: async () => {
      scans += 1;
      if (scans === 1) await firstScanBlocked;
      return inventory();
    },
  });

  const pending = cache.get();
  await new Promise((resolve) => setImmediate(resolve));
  cache.invalidate();
  releaseFirstScan();
  await pending;

  assert.equal(scans, 2);
  assert.equal((await cache.get()).cache.hit, true);
});

test("preserves stale inventory after a failed refresh and retries later", async () => {
  let now = 0;
  let scans = 0;
  const cache = createInventoryCache({
    ttlMs: 10,
    now: () => now,
    scanInventory: async () => {
      scans += 1;
      if (scans === 2) throw new Error("temporary scan failure");
      return inventory();
    },
  });

  await cache.get();
  now = 20;
  await assert.rejects(() => cache.refresh(), /temporary scan failure/);
  assert.deepEqual(cache.status(), {
    ready: true,
    refreshing: false,
    stale: true,
    ageMs: 20,
    ttlMs: 10,
  });

  await cache.get();
  assert.equal(scans, 3);
  assert.equal(cache.status().stale, false);
});

test("rejects invalid cache TTLs and missing CLI option values", () => {
  assert.throws(
    () => createInventoryCache({ ttlMs: -1 }),
    /缓存时间必须是 0 到 3600000 之间的整数毫秒/,
  );
  assert.throws(
    () => createInventoryCache({ ttlMs: 3_600_001 }),
    /缓存时间必须是 0 到 3600000 之间的整数毫秒/,
  );

  const result = spawnSync(process.execPath, [ROUTER_SCRIPT, "serve", "--cache-ttl"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /选项 --cache-ttl 缺少值/);
});

test("uses the default cache TTL when the environment value is blank", () => {
  const previous = process.env.SKILL_FOR_SKILLS_CACHE_TTL_MS;
  try {
    process.env.SKILL_FOR_SKILLS_CACHE_TTL_MS = "   ";
    assert.equal(createInventoryCache().status().ttlMs, 30_000);
  } finally {
    if (previous === undefined) delete process.env.SKILL_FOR_SKILLS_CACHE_TTL_MS;
    else process.env.SKILL_FOR_SKILLS_CACHE_TTL_MS = previous;
  }
});

test("serves cached inventory and protects manual refresh", async () => {
  let scans = 0;
  const server = startServer(0, {
    writeToken: "test-write-token",
    cacheTtlMs: 60_000,
    logger: null,
    scanInventory: async () => {
      scans += 1;
      return inventory([skill("imagegen", ["image"], "生成和编辑图片")]);
    },
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  try {
    const first = await fetch(`http://127.0.0.1:${port}/skills`);
    const second = await fetch(`http://127.0.0.1:${port}/skills`);
    const route = await fetch(`http://127.0.0.1:${port}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "生成图片" }),
    });
    const unauthorized = await fetch(`http://127.0.0.1:${port}/refresh`, {
      method: "POST",
    });
    const refreshed = await fetch(`http://127.0.0.1:${port}/refresh`, {
      method: "POST",
      headers: { authorization: "Bearer test-write-token" },
    });

    assert.equal(first.status, 200);
    assert.equal((await first.json()).cache.hit, false);
    assert.equal((await second.json()).cache.hit, true);
    assert.equal((await route.json()).selected[0].id, "imagegen");
    assert.equal(unauthorized.status, 401);
    assert.equal(refreshed.status, 200);
    assert.equal(scans, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("returns specific client errors and hides unexpected server failures", async () => {
  const server = startServer(0, {
    logger: null,
    scanInventory: async () => {
      throw new Error("sensitive internal detail");
    },
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  try {
    const unsupported = await fetch(`http://127.0.0.1:${port}/route`, {
      method: "POST",
      body: "{}",
    });
    const malformed = await fetch(`http://127.0.0.1:${port}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const nonObject = await fetch(`http://127.0.0.1:${port}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    const invalidTask = await fetch(`http://127.0.0.1:${port}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: { value: "生成图片" } }),
    });
    const oversized = await fetch(`http://127.0.0.1:${port}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "x".repeat(17_000) }),
    });
    const failedScan = await fetch(`http://127.0.0.1:${port}/skills`);
    const wrongMethod = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "POST",
    });

    assert.equal(unsupported.status, 415);
    assert.equal((await unsupported.json()).code, "unsupported_media_type");
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, "invalid_json");
    assert.equal(nonObject.status, 400);
    assert.equal((await nonObject.json()).code, "invalid_body");
    assert.equal(invalidTask.status, 400);
    assert.equal((await invalidTask.json()).code, "invalid_request");
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, "payload_too_large");
    assert.equal(failedScan.status, 500);
    assert.deepEqual(await failedScan.json(), {
      error: "Router failed",
      code: "internal_error",
    });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "GET");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("scans Skill files in deterministic path order", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-order-"));
  try {
    await Promise.all([
      writeSkill(path.join(tempDir, "z-last"), "z-last"),
      writeSkill(path.join(tempDir, "a-first"), "a-first"),
      writeSkill(path.join(tempDir, "m-middle"), "m-middle"),
    ]);

    const result = await findSkillFiles(tempDir);

    assert.deepEqual(
      result.files.map((filePath) => path.basename(path.dirname(filePath))),
      ["a-first", "m-middle", "z-last"],
    );
    assert.equal(result.truncated, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("scans valid Skills and reports sensitive-content keyword warnings", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-sensitive-"));
  try {
    await mkdir(path.join(tempDir, "safe-skill"), { recursive: true });
    await writeFile(
      path.join(tempDir, "safe-skill", "SKILL.md"),
      "---\nname: safe-skill\ndescription: Generate images\n---\nConfigure an API_KEY before use.\n",
      "utf8",
    );

    const result = await scanSkillInventory({ roots: [root("custom", tempDir)] });

    assert.equal(result.total, 1);
    assert.deepEqual(result.skills[0].sensitiveContentWarnings, ["api_key"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("skips empty and unreadable Skill files without aborting the scan", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-unreadable-"));
  const unreadableFile = path.join(tempDir, "unreadable", "SKILL.md");
  try {
    await mkdir(path.join(tempDir, "empty"), { recursive: true });
    await writeFile(path.join(tempDir, "empty", "SKILL.md"), "", "utf8");
    await writeSkill(path.dirname(unreadableFile), "unreadable");
    await chmod(unreadableFile, 0o000);

    const result = await scanSkillInventory({ roots: [root("custom", tempDir)] });

    assert.equal(result.total, 0);
  } finally {
    await chmod(unreadableFile, 0o644).catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("redacts the home directory from routed Skill paths", () => {
  const homeSkill = skill("image-helper", ["image"], "Generate images");
  homeSkill.filePath = path.join(os.homedir(), ".codex", "skills", "image", "SKILL.md");
  homeSkill.rootPath = path.join(os.homedir(), ".codex", "skills");

  const result = routeTask("Generate an image", [homeSkill]);

  assert.equal(result.selected[0].filePath, "~/.codex/skills/image/SKILL.md");
  assert.equal(result.selected[0].root, "~/.codex/skills");
});

test("blocks protected roots even when supplied outside custom-root validation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-direct-link-"));
  const homeLink = path.join(tempDir, "home-link");
  try {
    await symlink(os.homedir(), homeLink);
    const result = await scanSkillInventory({
      roots: [
        root("environment", path.dirname(os.homedir())),
        root("custom", homeLink),
      ],
    });

    assert.equal(result.total, 0);
    assert.equal(result.scan.scannedDirectories, 0);
    assert.deepEqual(result.scan.blockedRoots, [
      {
        kind: "environment",
        path: path.dirname(os.homedir()),
        reason: "protected-root",
      },
      {
        kind: "custom",
        path: homeLink,
        reason: "protected-root",
      },
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reports duplicate Skills and selects the higher-priority source", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-conflict-"));
  const customRoot = path.join(tempDir, "custom");
  const codexRoot = path.join(tempDir, "codex");
  try {
    await Promise.all([
      writeSkill(path.join(customRoot, "shared"), "shared-skill"),
      writeSkill(path.join(codexRoot, "shared"), "shared-skill"),
    ]);

    const inventory = await scanSkillInventory({
      roots: [root("custom", customRoot), root("codex", codexRoot)],
    });

    assert.equal(inventory.total, 1);
    assert.equal(inventory.skills[0].source, "codex");
    assert.equal(inventory.skills[0].trust, "managed");
    assert.equal(inventory.conflicts.length, 1);
    assert.equal(inventory.conflicts[0].selected.source, "codex");
    assert.equal(inventory.conflicts[0].ignored[0].reason, "lower-source-priority");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("does not promote a custom root to managed trust from its plugin manifest", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-trust-"));
  const pluginDir = path.join(tempDir, "embedded-plugin");
  try {
    await writeSkill(path.join(pluginDir, "skills", "embedded"), "embedded");
    await mkdir(path.join(pluginDir, ".codex-plugin"), { recursive: true });
    await writeFile(
      path.join(pluginDir, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "embedded-plugin", version: "1.0.0" }),
      "utf8",
    );

    const inventory = await scanSkillInventory({
      roots: [root("custom", tempDir)],
    });

    assert.equal(inventory.skills[0].qualifiedName, "embedded-plugin:embedded");
    assert.equal(inventory.skills[0].source, "custom");
    assert.equal(inventory.skills[0].trust, "custom");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("uses a stable path tiebreak for duplicate Skills from equal-priority roots", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-tie-"));
  const firstRoot = path.join(tempDir, "a-root");
  const secondRoot = path.join(tempDir, "z-root");
  try {
    await Promise.all([
      writeSkill(path.join(firstRoot, "shared"), "shared-skill"),
      writeSkill(path.join(secondRoot, "shared"), "shared-skill"),
    ]);

    const inventory = await scanSkillInventory({
      roots: [root("custom", secondRoot), root("custom", firstRoot)],
    });

    assert.equal(inventory.skills[0].rootPath, firstRoot);
    assert.equal(inventory.conflicts[0].ignored[0].reason, "stable-path-tiebreak");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("reports file and directory scan truncation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "skill-router-limit-"));
  try {
    await Promise.all([
      writeSkill(path.join(tempDir, "a"), "skill-a"),
      writeSkill(path.join(tempDir, "b"), "skill-b"),
    ]);

    const fileLimited = await findSkillFiles(tempDir, { maxFiles: 1 });
    const directoryLimited = await findSkillFiles(tempDir, { maxDirectories: 1 });
    const inventory = await scanSkillInventory({
      roots: [root("custom", tempDir)],
      maxFiles: 1,
    });

    assert.equal(fileLimited.truncated, true);
    assert.deepEqual(fileLimited.truncationReasons, ["file-limit"]);
    assert.equal(directoryLimited.truncated, true);
    assert.deepEqual(directoryLimited.truncationReasons, ["directory-limit"]);
    assert.equal(inventory.scan.truncated, true);
    assert.equal(inventory.scan.truncatedRoots.length, 1);
    assert.deepEqual(inventory.roots[0].truncationReasons, ["file-limit"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("prefers meaningful Chinese phrases and ignores common request fillers", () => {
  const skills = [
    skill("knowledge-organizer", [], "整理知识库内容并建立索引"),
    skill("generic-helper", [], "帮我处理一下这个功能任务"),
  ];

  const result = routeTask("请帮我进行知识库整理", skills);
  const fillerOnly = routeTask("请帮我进行一下这个功能任务", skills);

  assert.equal(result.selected[0].id, "knowledge-organizer");
  assert.equal(result.selected[0].trust, "custom");
  assert.equal(result.alternatives.some((item) => item.id === "generic-helper"), false);
  assert.equal(fillerOnly.unmatched, true);
});

test("matches Chinese phrases up to eight characters before shorter alternatives", () => {
  const skills = [
    skill("crm-export", [], "客户关系管理系统数据导出与报表"),
    skill("relationship-helper", [], "客户关系维护和管理工具"),
  ];

  const result = routeTask(
    "请帮我把客户关系管理系统的数据导出为可视化报表",
    skills,
  );

  assert.equal(result.selected[0].id, "crm-export");
  assert.equal(result.alternatives[0].role, "候选 Skill");
  assert.deepEqual(result.selected[0].matchedTerms, [
    { term: "客户关系管理系统", target: "description" },
    { term: "数据导出", target: "description" },
    { term: "报表", target: "description" },
  ]);
  assert.ok(result.selected[0].score > result.alternatives[0].score);
});

test("does not repeatedly score overlapping Chinese substrings", () => {
  const result = routeTask("使用自然语言处理", [
    skill("nlp", [], "自然语言处理工具"),
  ]);

  assert.deepEqual(result.selected[0].matchedTerms, [
    { term: "自然语言处理", target: "description" },
  ]);
  assert.ok(result.selected[0].score >= 4 && result.selected[0].score < 8);
});

test("uses Chinese connector words as phrase boundaries", () => {
  const result = routeTask("分析用户反馈并生成报告", [
    skill("feedback-report", [], "分析用户反馈并生成报告"),
    skill("cross-boundary", [], "反馈并生成"),
  ]);

  assert.equal(result.selected[0].id, "feedback-report");
  assert.equal(
    result.selected[0].matchedTerms.some((item) => item.term.includes("并")),
    false,
  );
  assert.equal(
    result.alternatives.some((item) => item.id === "cross-boundary"),
    false,
  );
});

test("keeps domain terms that contain common request words", () => {
  const result = routeTask("检查任务管理系统的功能测试和使用说明", [
    skill("system-quality", [], "任务管理系统功能测试与使用说明"),
  ]);

  assert.equal(result.selected[0].id, "system-quality");
  assert.deepEqual(result.selected[0].matchedTerms, [
    { term: "任务管理系统", target: "description" },
    { term: "功能测试", target: "description" },
    { term: "使用说明", target: "description" },
  ]);
});
