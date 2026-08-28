import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addCustomRoot,
  findSkillFiles,
  parseSkillDocument,
  routeTask,
  scanSkillInventory,
  startServer,
} from "../plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs";

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

test("parses YAML folded and literal block scalar indicators", () => {
  const folded = parseSkillDocument("---\nname: demo\ndescription: >-\n  first line\n  second line\n---\nbody");
  const literal = parseSkillDocument("---\nname: demo\ndescription: |+\n  first line\n  second line\n---\nbody");

  assert.equal(folded.description, "first line second line");
  assert.equal(literal.description, "first line\nsecond line");
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

test("requires a token before changing custom roots through the local API", async () => {
  const server = startServer(0, { writeToken: "test-write-token" });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

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
