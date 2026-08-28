import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addCustomRoot,
  parseSkillDocument,
  routeTask,
  startServer,
} from "../plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs";

function skill(id, capabilities) {
  return {
    id,
    name: id,
    qualifiedName: id,
    description: id,
    excerpt: id,
    source: "test",
    version: null,
    capabilities,
    explicitSelectionOnly: false,
    requiresSetup: false,
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
