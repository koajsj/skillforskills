#!/usr/bin/env node

import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_FILES = 1_500;
const MAX_DIRECTORIES = 10_000;
const MAX_BYTES = 512 * 1024;
const MAX_CONCURRENT_READS = 32;
const MAX_REQUEST_BYTES = 16 * 1024;
const DEFAULT_CACHE_TTL_MS = 30_000;
const MAX_CACHE_TTL_MS = 60 * 60 * 1_000;
const CONFIG_DIR = path.join(os.homedir(), ".skill-router");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SELF_NAMES = new Set(["skill-for-skills", "skill-for-skills:skill-for-skills"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "generated_images"]);
const SOURCE_PRIORITY = {
  plugin: 500,
  codex: 400,
  agents: 300,
  claude: 250,
  cursor: 200,
  opencode: 200,
  environment: 150,
  custom: 100,
};
const SOURCE_TRUST = {
  plugin: ["managed", "由 Codex 插件缓存管理"],
  codex: ["managed", "来自 Codex 管理的 Skill 目录"],
  agents: ["local", "来自本机 Agent Skill 目录"],
  claude: ["local", "来自本机 Claude Skill 目录"],
  cursor: ["local", "来自本机 Cursor Skill 目录"],
  opencode: ["local", "来自本机 OpenCode Skill 目录"],
  environment: ["custom", "来自环境变量授权的目录"],
  custom: ["custom", "来自用户明确添加的目录"],
};
const MAX_CHINESE_PHRASE_LENGTH = 8;
const CHINESE_BOUNDARY_WORDS = new Set([
  "请",
  "请问",
  "帮",
  "帮我",
  "我",
  "我把",
  "麻烦",
  "一下",
  "这个",
  "那个",
  "进行",
  "一个",
  "需要",
  "可以",
  "如何",
  "什么",
  "把",
  "将",
  "给",
  "对",
  "的",
  "为",
  "并",
  "并且",
  "然后",
  "同时",
  "以及",
  "或者",
  "和",
  "与",
  "及",
  "再",
  "成",
]);
const CHINESE_FILLER_GROUPS = new Set([
  "任务",
  "功能",
  "功能任务",
  "相关任务",
  "相关功能",
]);
const CHINESE_SEGMENTER =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("zh-CN", { granularity: "word" })
    : null;

const CAPABILITIES = [
  {
    id: "security",
    label: "安全审查",
    task: /(?:安全(?:性)?(?:审查|审核|评估|扫描|检测)?|security|漏洞|渗透|威胁模型|攻击面|依赖安全|\bcve\b|\bxss\b|\bcsrf\b|\bsqli\b)/i,
    skill: /(?:security|vulnerability|attack path|threat model|security scan|安全扫描|安全审查)/i,
    reason: "负责识别安全风险、验证攻击路径并输出安全审查结果",
    hints: ["security", "vulnerability", "threat"],
  },
  {
    id: "code-review",
    label: "代码审查",
    task: /(?:代码\s*(?:审查|评审)|代码\s*review|code\s*review|review\s*(?:code|pr|pull request)|(?:pr|pull request)\s*(?:review|审查))/i,
    skill: /(?:code review|review.*(?:code|pull request|repository)|review-agent|代码审查|审查代码)/i,
    reason: "负责审查代码变更、识别回归风险并提出可执行问题",
    hints: ["review", "code-review"],
  },
  {
    id: "ux-audit",
    label: "体验审查",
    task: /(?:\bux\b|\bui\b|用户体验|体验(?:审查|审核|评估)?|可用性|无障碍|accessibility|usability|onboarding|checkout|design critique|视觉审查)/i,
    skill: /(?:\baudit\b|\bcritique\b|user experience|\bux\b|usability|accessibility|体验审查|可用性)/i,
    reason: "负责体验审查、问题分析与报告输出",
    hints: ["audit", "ux"],
  },
  {
    id: "browser",
    label: "浏览器操作",
    task: /(?:浏览器|网页|网站|页面|链接|网址|\burl\b|截图|点击|填写|browser|website|screenshot|navigate|playwright|chrome)/i,
    skill: /(?:control.*browser|browser automation|in-app browser|\bplaywright\b|\bchrome\b|navigate.*page|clicking.*page)/i,
    reason: "负责打开页面、完成交互与截图采集",
    hints: ["browser", "chrome"],
  },
  {
    id: "spreadsheet",
    label: "表格处理",
    task: /(?:表格|工作簿|\bexcel\b|\bxlsx?\b|\bcsv\b|\btsv\b|spreadsheet|workbook|google sheets?)/i,
    skill: /(?:spreadsheet|workbook|\bexcel\b|\bxlsx?\b|\bcsv\b|\btsv\b|google sheets?)/i,
    reason: "负责创建、分析并验证表格",
    hints: ["spreadsheet", "excel"],
  },
  {
    id: "presentation",
    label: "演示文稿",
    task: /(?:演示文稿|幻灯片|汇报材料|\bpptx?\b|powerpoint|presentation|slide deck|slides)/i,
    skill: /(?:presentation|powerpoint|\bpptx?\b|slide deck|google slides?)/i,
    reason: "负责生成、编辑并验证演示文稿",
    hints: ["presentation", "slides"],
  },
  {
    id: "document",
    label: "文档处理",
    task: /(?:文档|合同|公文|\bword\b|\bdocx\b|document|google docs?|redline)/i,
    skill: /(?:\bdocument\b|\bdocx\b|microsoft word|google docs?|redline)/i,
    reason: "负责创建、编辑并验证结构化文档",
    hints: ["document", "docx"],
  },
  {
    id: "pdf",
    label: "PDF 处理",
    task: /(?:\bpdf\b|合并pdf|拆分pdf|填写pdf|提取pdf)/i,
    skill: /(?:\bpdf\b|acroform|pypdf|pdfplumber|poppler)/i,
    reason: "负责读取、生成并验证 PDF",
    hints: ["pdf"],
  },
  {
    id: "database",
    label: "数据库查询",
    task: /(?:数据库|查库|查表|表结构|查询数据|跑sql|执行sql|\bsql\b|mysql|oracle|milvus|rds|database|query)/i,
    skill: /(?:数据库|\bdatabase\b|\bsql\b|mysql|oracle|milvus|rds|query.*table)/i,
    reason: "负责连接数据源、生成查询并返回结果",
    hints: ["db", "database", "query"],
  },
  {
    id: "design",
    label: "产品设计",
    task: /(?:产品设计|界面设计|交互设计|视觉稿|原型|落地页|设计系统|figma|figjam|design|prototype|wireframe|mockup)/i,
    skill: /(?:product design|interface design|visual design|\bfigma\b|\bfigjam\b|prototype|wireframe|mockup|design system)/i,
    reason: "负责设计探索、界面实现或设计系统工作",
    hints: ["design", "figma"],
  },
  {
    id: "image",
    label: "图像生成",
    task: /(?:生成图片|做图|生图|插画|海报|图片编辑|抠图|image generation|imagegen|illustration|poster)/i,
    skill: /(?:image generation|generate.*image|edit.*image|raster image|illustration|imagegen)/i,
    reason: "负责生成或编辑视觉图像",
    hints: ["image", "imagegen"],
  },
  {
    id: "code",
    label: "代码开发",
    task: /(?:写代码|开发|实现(?:新)?功能|修复bug|重构|前端|后端|接口|脚本|coding|implement|debug|refactor|frontend|backend|\bapi\b)/i,
    skill: /(?:code|coding|implementation|developer|frontend|backend|\bapi\b|debug|repository|codebase)/i,
    reason: "负责实现、修改或验证代码",
    hints: ["code", "implement", "developer"],
  },
  {
    id: "research",
    label: "研究分析",
    task: /(?:研究|调研|论文|文献|学术|arxiv|research|paper|literature|academic)/i,
    skill: /(?:research|paper|literature|academic|arxiv|论文|学术|研究)/i,
    reason: "负责检索、分析并总结研究材料",
    hints: ["research", "paper", "arxiv"],
  },
  {
    id: "writing",
    label: "写作润色",
    task: /(?:写作|撰写|改写|润色|翻译|摘要|周报|文案|polish|rewrite|translate|writing|summary)/i,
    skill: /(?:writing|polish|rewrite|translate|summary|润色|写作|改写|翻译|周报)/i,
    reason: "负责撰写、改写或润色内容",
    hints: ["writing", "polish", "summary"],
  },
  {
    id: "visualization",
    label: "数据可视化",
    task: /(?:可视化|图表|仪表盘|看板|趋势图|visualization|chart|graph|dashboard|plot)/i,
    skill: /(?:visualization|chart|graph|dashboard|plot|可视化|图表|看板)/i,
    reason: "负责生成图表或交互可视化",
    hints: ["visualize", "chart"],
  },
  {
    id: "collaboration",
    label: "协作消息",
    task: /(?:\bslack\b|teams|频道消息|工作区消息|发消息|消息摘要|回复草稿)/i,
    skill: /(?:\bslack\b|\bteams\b|channel summary|outbound.*message|reply draft|daily digest)/i,
    reason: "负责读取、整理或发送协作消息",
    hints: ["slack", "teams"],
  },
  {
    id: "ticket",
    label: "工单处理",
    task: /(?:工单|tt\.sankuai\.com|催办|转单|服务目录|ticket)/i,
    skill: /(?:工单|tt\.sankuai\.com|ticket|服务目录|转单)/i,
    reason: "负责查询、创建或流转工单",
    hints: ["ticket", "tt"],
  },
];

const INFRASTRUCTURE = /(?:control-in-app-browser|control-chrome|excel-live-control|figma-use(?:$|:|-))/i;

class RouterInputError extends Error {
  constructor(message, status = 400, code = "invalid_request") {
    super(message);
    this.name = "RouterInputError";
    this.status = status;
    this.code = code;
  }
}

let configMutationQueue = Promise.resolve();

function displayPath(value) {
  const home = os.homedir();
  if (value === home) return "~";
  return value.startsWith(`${home}${path.sep}`) ? `~${value.slice(home.length)}` : value;
}

function cleanScalar(value) {
  const text = value.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function blockScalarStyle(value) {
  const marker = value.trim();
  const match = marker.match(/^([>|])(?:(?:[1-9][+-]?)|(?:[+-][1-9]?))?$/);
  return match?.[1] || null;
}

export function parseSkillDocument(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const frontmatter = match?.[1] || "";
  const readValue = (key) => {
    const lines = frontmatter.split(/\r?\n/);
    const pattern = new RegExp(`^${key}:\\s*(.*)$`, "i");
    for (let index = 0; index < lines.length; index += 1) {
      const found = lines[index].match(pattern);
      if (!found) continue;
      const style = blockScalarStyle(found[1]);
      if (!style) return cleanScalar(found[1]);
      const block = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (!/^\s+/.test(lines[cursor])) break;
        block.push(lines[cursor].trim());
      }
      return block.join(style === ">" ? " " : "\n");
    }
    return "";
  };
  return {
    name: readValue("name"),
    description: readValue("description"),
    body: match ? content.slice(match[0].length) : content,
    frontmatter,
  };
}

async function readConfig() {
  try {
    const value = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray(value.customRoots) ||
      value.customRoots.some((item) => typeof item !== "string")
    ) {
      throw new RouterInputError(
        `配置文件格式无效：${CONFIG_FILE}`,
        500,
        "invalid_config",
      );
    }
    return {
      customRoots: value.customRoots.map((item) => item.trim()).filter(Boolean),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { customRoots: [] };
    if (error instanceof RouterInputError) throw error;
    if (error instanceof SyntaxError) {
      throw new RouterInputError(
        `配置文件不是有效 JSON：${CONFIG_FILE}`,
        500,
        "invalid_config",
      );
    }
    throw error;
  }
}

async function writeConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await chmod(CONFIG_DIR, 0o700);
  const temporary = `${CONFIG_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, CONFIG_FILE);
    await chmod(CONFIG_FILE, 0o600);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function updateConfig(mutator) {
  const update = configMutationQueue.then(async () => {
    const config = await readConfig();
    await mutator(config);
    await writeConfig(config);
  });
  configMutationQueue = update.catch(() => {});
  return update;
}

function automaticRoots() {
  const home = os.homedir();
  const codex = process.env.CODEX_HOME || path.join(home, ".codex");
  const extra = String(process.env.SKILL_FOR_SKILLS_PATHS || "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  return [
    ["codex", "Codex Skills", path.join(codex, "skills")],
    ["plugin", "Codex Plugins", path.join(codex, "plugins", "cache")],
    ["claude", "Claude Skills", path.join(home, ".claude", "skills")],
    ["agents", "Agent Skills", path.join(home, ".agents", "skills")],
    ["cursor", "Cursor Skills", path.join(home, ".cursor", "skills")],
    ["opencode", "OpenCode Skills", path.join(home, ".opencode", "skills")],
    ["opencode", "OpenCode Config Skills", path.join(home, ".config", "opencode", "skills")],
    ...extra.map((value) => ["environment", "Environment Skill Path", value]),
  ].map(([kind, label, value]) => ({
    kind,
    label,
    path: path.resolve(value),
    automatic: true,
  }));
}

export async function getSkillRoots() {
  const config = await readConfig();
  const roots = [
    ...automaticRoots(),
    ...config.customRoots.map((value) => ({
      kind: "custom",
      label: "Custom Skills",
      path: path.resolve(value),
      automatic: false,
    })),
  ];
  const unique = new Map();
  for (const root of roots) {
    let resolved = root.path;
    try {
      resolved = await realpath(root.path);
    } catch {
      // Preserve unavailable roots so clients can explain their status.
    }
    if (!unique.has(resolved)) unique.set(resolved, { ...root, path: resolved });
  }
  const output = [];
  for (const root of unique.values()) {
    let available = false;
    const blockedReason = isProtectedRoot(root.path) ? "protected-root" : null;
    try {
      available = !blockedReason && (await stat(root.path)).isDirectory();
    } catch {
      available = false;
    }
    output.push({
      ...root,
      available,
      blockedReason,
      displayPath: displayPath(root.path),
    });
  }
  return output;
}

function normalizeCustomRoot(input, { allowProtected = false } = {}) {
  if (typeof input !== "string" || !input.trim()) {
    throw new RouterInputError("请输入具体的 Skill 文件夹路径");
  }
  const trimmed = input.trim();
  const expanded =
    trimmed === "~"
      ? os.homedir()
      : trimmed.startsWith(`~${path.sep}`)
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed;
  const normalized = path.resolve(expanded);
  if (!allowProtected && isProtectedRoot(normalized)) {
    throw new RouterInputError("为保护隐私，不能扫描整块磁盘或整个用户目录");
  }
  return normalized;
}

function isProtectedRoot(candidate) {
  const home = os.homedir();
  const relativeHome = path.relative(candidate, home);
  const containsHome =
    relativeHome === "" ||
    (relativeHome !== ".." &&
      !relativeHome.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeHome));
  return candidate === path.parse(candidate).root || containsHome;
}

export async function addCustomRoot(input) {
  const normalized = normalizeCustomRoot(input);
  let resolved;
  try {
    resolved = await realpath(normalized);
  } catch {
    throw new RouterInputError("找不到这个文件夹");
  }
  if (isProtectedRoot(resolved)) {
    throw new RouterInputError("为保护隐私，不能扫描整块磁盘或整个用户目录");
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new RouterInputError("所选路径不是文件夹");
  }
  await updateConfig((config) => {
    if (!config.customRoots.includes(resolved)) config.customRoots.push(resolved);
  });
  return getSkillRoots();
}

export async function removeCustomRoot(input) {
  const normalized = normalizeCustomRoot(input, { allowProtected: true });
  let resolved = normalized;
  try {
    resolved = await realpath(normalized);
  } catch {
    // Missing directories can still be removed from configuration.
  }
  await updateConfig((config) => {
    config.customRoots = config.customRoots.filter(
      (item) => item !== resolved && item !== normalized,
    );
  });
  return getSkillRoots();
}

export async function findSkillFiles(
  root,
  { maxFiles = MAX_FILES, maxDirectories = MAX_DIRECTORIES } = {},
) {
  const files = [];
  const pending = [root];
  let scannedDirectories = 0;
  const truncationReasons = new Set();
  while (pending.length) {
    if (scannedDirectories >= maxDirectories) {
      truncationReasons.add("directory-limit");
      break;
    }
    const current = pending.pop();
    scannedDirectories += 1;
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    const directories = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) directories.push(target);
      if (entry.isFile() && entry.name === "SKILL.md") {
        if (files.length >= maxFiles) {
          truncationReasons.add("file-limit");
          break;
        }
        files.push(target);
      }
    }
    if (truncationReasons.has("file-limit")) break;
    for (let index = directories.length - 1; index >= 0; index -= 1) {
      pending.push(directories[index]);
    }
  }
  return {
    files,
    scannedDirectories,
    truncated: truncationReasons.size > 0,
    truncationReasons: [...truncationReasons],
  };
}

async function nearestPlugin(filePath, rootPath) {
  let cursor = path.dirname(filePath);
  const boundary = path.resolve(rootPath);
  while (cursor === boundary || cursor.startsWith(`${boundary}${path.sep}`)) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(cursor, ".codex-plugin", "plugin.json"), "utf8"),
      );
      return {
        name: manifest.name || path.basename(cursor),
        version: manifest.version || null,
      };
    } catch {
      // Keep walking toward the root.
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function detectCapabilities(skill) {
  const searchable = `${skill.qualifiedName}\n${skill.description}`;
  return CAPABILITIES.filter((item) => item.skill.test(searchable)).map(
    (item) => item.id,
  );
}

function detectTaskCapabilities(task) {
  return CAPABILITIES.filter((item) => item.task.test(task));
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

async function loadSkill(filePath, root) {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat || fileStat.size > MAX_BYTES) return null;
  const content = await readFile(filePath, "utf8").catch(() => "");
  if (!content) return null;
  const parsed = parseSkillDocument(content);
  const name = parsed.name || path.basename(path.dirname(filePath));
  const plugin = await nearestPlugin(filePath, root.path);
  const qualifiedName =
    plugin?.name && !name.includes(":") ? `${plugin.name}:${name}` : name;
  if (SELF_NAMES.has(name) || SELF_NAMES.has(qualifiedName)) return null;
  const source = root.kind;
  const [trust, trustReason] = SOURCE_TRUST[source] || [
    "custom",
    "来自未分类的本地目录",
  ];
  const excerpt = parsed.body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_[\]`]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 2_000);
  const skill = {
    id: qualifiedName,
    name,
    qualifiedName,
    description: parsed.description || excerpt.slice(0, 240),
    excerpt,
    filePath,
    source,
    rootKind: root.kind,
    rootPath: root.path,
    trust,
    trustReason,
    version: plugin?.version || null,
    requiresSetup: /(?:api[_ -]?key|需要登录|requires? (?:an? )?(?:api key|login))/i.test(
      `${parsed.frontmatter}\n${excerpt}`,
    ),
    explicitSelectionOnly:
      /(?:use|trigger)(?: this skill)? only when the user (?:selects|names|explicitly|asks)|use when the user (?:selects|names)|仅当用户(?:选择|点名|明确)/i.test(
        parsed.description,
      ),
  };
  skill.capabilities = detectCapabilities(skill);
  return skill;
}

function compareSkillSource(left, right) {
  return (
    (SOURCE_PRIORITY[right.source] || 0) - (SOURCE_PRIORITY[left.source] || 0) ||
    left.filePath.localeCompare(right.filePath, "en")
  );
}

function skillOrigin(skill) {
  return {
    filePath: skill.filePath,
    source: skill.source,
    rootKind: skill.rootKind,
    rootPath: skill.rootPath,
    trust: skill.trust,
    trustReason: skill.trustReason,
    version: skill.version,
  };
}

export async function scanSkillInventory(
  { roots: providedRoots, maxFiles = MAX_FILES, maxDirectories = MAX_DIRECTORIES } = {},
) {
  const configuredRoots = providedRoots || (await getSkillRoots());
  const roots = await Promise.all(
    configuredRoots.map(async (root) => {
      if (!root || typeof root.path !== "string" || !root.path.trim()) {
        throw new RouterInputError("Skill 根目录路径无效");
      }
      const absolutePath = path.resolve(root.path);
      let resolvedPath = absolutePath;
      try {
        resolvedPath = await realpath(absolutePath);
      } catch {
        // Unavailable roots remain visible in diagnostics.
      }
      const blockedReason =
        root.blockedReason ||
        (isProtectedRoot(resolvedPath) ? "protected-root" : null);
      return {
        ...root,
        path: absolutePath,
        blockedReason,
        available: root.available !== false && !blockedReason,
        displayPath: displayPath(absolutePath),
      };
    }),
  );
  const groups = await Promise.all(
    roots.map(async (root) => {
      if (!root.available) {
        return {
          root,
          files: [],
          scannedDirectories: 0,
          truncated: false,
          truncationReasons: [],
        };
      }
      return {
        root,
        ...(await findSkillFiles(root.path, { maxFiles, maxDirectories })),
      };
    }),
  );
  const skillFiles = groups.flatMap((group) =>
    group.files.map((filePath) => ({ filePath, root: group.root })),
  );
  const loaded = await mapWithConcurrency(
    skillFiles,
    MAX_CONCURRENT_READS,
    ({ filePath, root }) => loadSkill(filePath, root),
  );
  const candidates = new Map();
  for (const skill of loaded.filter(Boolean)) {
    const matches = candidates.get(skill.qualifiedName) || [];
    matches.push(skill);
    candidates.set(skill.qualifiedName, matches);
  }
  const unique = new Map();
  const conflicts = [];
  for (const [qualifiedName, matches] of candidates) {
    matches.sort(compareSkillSource);
    const [selected, ...ignored] = matches;
    unique.set(qualifiedName, selected);
    if (ignored.length) {
      const selectedPriority = SOURCE_PRIORITY[selected.source] || 0;
      conflicts.push({
        id: qualifiedName,
        selected: skillOrigin(selected),
        ignored: ignored.map((skill) => ({
          ...skillOrigin(skill),
          reason:
            (SOURCE_PRIORITY[skill.source] || 0) < selectedPriority
              ? "lower-source-priority"
              : "stable-path-tiebreak",
        })),
      });
    }
  }
  const skills = [...unique.values()].sort((left, right) =>
    left.qualifiedName.localeCompare(right.qualifiedName, "zh-CN"),
  );
  conflicts.sort((left, right) => left.id.localeCompare(right.id, "zh-CN"));
  const counts = {};
  for (const skill of skills) counts[skill.source] = (counts[skill.source] || 0) + 1;
  const rootResults = groups.map((group) => ({
    ...group.root,
    fileCount: group.files.length,
    directoryCount: group.scannedDirectories,
    truncated: group.truncated,
    truncationReasons: group.truncationReasons,
  }));
  const truncatedRoots = rootResults
    .filter((root) => root.truncated)
    .map((root) => ({
      kind: root.kind,
      path: root.displayPath,
      reasons: root.truncationReasons,
    }));
  const blockedRoots = rootResults
    .filter((root) => root.blockedReason)
    .map((root) => ({
      kind: root.kind,
      path: root.displayPath,
      reason: root.blockedReason,
    }));
  return {
    skills,
    total: skills.length,
    counts,
    roots: rootResults,
    scan: {
      truncated: truncatedRoots.length > 0,
      truncatedRoots,
      blockedRoots,
      discoveredFiles: groups.reduce((total, group) => total + group.files.length, 0),
      scannedDirectories: groups.reduce(
        (total, group) => total + group.scannedDirectories,
        0,
      ),
      limits: {
        maxFilesPerRoot: maxFiles,
        maxDirectoriesPerRoot: maxDirectories,
        maxConcurrentReads: MAX_CONCURRENT_READS,
      },
    },
    conflicts,
    scannedAt: new Date().toISOString(),
  };
}

function taskTokens(task) {
  const normalized = task.toLowerCase();
  const tokens = new Map();
  const addToken = (value, weight, start, end) => {
    if (value.length < 2) return;
    const key = `${start}:${end}:${value}`;
    const current = tokens.get(key);
    if (!current || weight > current.weight) {
      tokens.set(key, { value, weight, start, end });
    }
  };
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9+#._-]{1,}/g)) {
    const token = match[0];
    const start = match.index;
    addToken(token, 1, start, start + token.length);
    let cursor = 0;
    for (const part of token.split(/[-_.]/)) {
      const offset = token.indexOf(part, cursor);
      addToken(part, 0.9, start + offset, start + offset + part.length);
      cursor = offset + part.length;
    }
  }
  for (const match of normalized.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const run = match[0].slice(0, 80);
    const groups = [];
    let group = null;
    const parts = CHINESE_SEGMENTER
      ? [...CHINESE_SEGMENTER.segment(run)]
      : [{ segment: run, index: 0, isWordLike: true }];
    for (const part of parts) {
      if (!part.isWordLike || CHINESE_BOUNDARY_WORDS.has(part.segment)) {
        if (group) groups.push(group);
        group = null;
        continue;
      }
      if (!group) group = { value: part.segment, start: part.index };
      else group.value += part.segment;
    }
    if (group) groups.push(group);
    for (const item of groups) {
      if (CHINESE_FILLER_GROUPS.has(item.value)) continue;
      const maxSize = Math.min(MAX_CHINESE_PHRASE_LENGTH, item.value.length);
      for (let size = maxSize; size >= 2; size -= 1) {
        const baseWeight = size === 2 ? 0.7 : 1 + size * 0.8;
        for (let index = 0; index <= item.value.length - size; index += 1) {
          const start = match.index + item.start + index;
          const exactGroup = size === item.value.length;
          addToken(
            item.value.slice(index, index + size),
            baseWeight + (exactGroup ? 0.8 : 0),
            start,
            start + size,
          );
        }
      }
    }
  }
  return [...tokens.values()]
    .sort(
      (left, right) =>
        right.weight - left.weight ||
        right.value.length - left.value.length ||
        left.start - right.start ||
        left.value.localeCompare(right.value, "zh-CN"),
    )
    .slice(0, 240);
}

function scoreTaskTokens(skill, tokens) {
  const name = skill.qualifiedName.toLowerCase();
  const description = `${skill.description}\n${skill.excerpt}`.toLowerCase();
  const candidates = [];
  for (const token of tokens) {
    const target = name.includes(token.value)
      ? "name"
      : description.includes(token.value)
        ? "description"
        : null;
    if (!target) continue;
    const multiplier = target === "name" ? 4 : 1.2;
    candidates.push({ ...token, target, points: token.weight * multiplier });
  }
  candidates.sort(
    (left, right) =>
      right.points - left.points ||
      right.value.length - left.value.length ||
      left.start - right.start ||
      left.value.localeCompare(right.value, "zh-CN"),
  );
  const selected = [];
  const selectedValues = new Set();
  for (const candidate of candidates) {
    if (selected.length >= 8 || selectedValues.has(candidate.value)) continue;
    const overlaps = selected.some(
      (current) => candidate.start < current.end && candidate.end > current.start,
    );
    if (overlaps) continue;
    selected.push(candidate);
    selectedValues.add(candidate.value);
  }
  return {
    score: selected.reduce((total, item) => total + item.points, 0),
    matchedTerms: selected
      .sort((left, right) => left.start - right.start)
      .map(({ value, target }) => ({ term: value, target })),
  };
}

function scoreSkill(skill, task, detected, tokens) {
  const matched = detected.filter((item) => skill.capabilities.includes(item.id));
  const name = skill.qualifiedName.toLowerCase();
  const normalizedTask = task.toLowerCase();
  const lexical = scoreTaskTokens(skill, tokens);
  let score = matched.length * 14 + lexical.score;
  for (const item of matched) {
    if (item.hints.some((hint) => name.includes(hint))) score += 5;
  }
  if (normalizedTask.includes(name) || normalizedTask.includes(skill.name.toLowerCase())) {
    score += 16;
  }
  if (
    skill.explicitSelectionOnly &&
    !normalizedTask.includes(name) &&
    !normalizedTask.includes(skill.name.toLowerCase())
  ) {
    score -= 18;
  }
  if (skill.requiresSetup) score -= 1.5;
  return {
    ...skill,
    score: Math.max(0, Number(score.toFixed(2))),
    matchedTerms: lexical.matchedTerms,
    matchedCapabilities: matched.map((item) => item.id),
    infrastructure: INFRASTRUCTURE.test(skill.qualifiedName),
  };
}

function normalizeTask(task) {
  if (typeof task !== "string") {
    throw new RouterInputError("任务内容必须是字符串");
  }
  const cleanTask = task.trim();
  if (!cleanTask) throw new RouterInputError("任务内容不能为空");
  if (cleanTask.length > 4_000) {
    throw new RouterInputError("任务内容不能超过 4000 个字符");
  }
  return cleanTask;
}

export function routeTask(task, skills) {
  const cleanTask = normalizeTask(task);
  const detected = detectTaskCapabilities(cleanTask);
  const tokens = taskTokens(cleanTask);
  const ranked = skills
    .map((skill) => scoreSkill(skill, cleanTask, detected, tokens))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.qualifiedName.localeCompare(right.qualifiedName),
    );
  const meaningful = ranked.filter((skill) => skill.score >= 4);
  const nonInfrastructure = meaningful.filter((skill) => !skill.infrastructure);
  const browserOnly = detected.length === 1 && detected[0]?.id === "browser";
  const primary =
    (browserOnly ? meaningful[0] : nonInfrastructure[0]) || meaningful[0] || null;
  const selected = primary ? [primary] : [];
  const covered = new Set(primary?.matchedCapabilities || []);
  for (const capability of detected) {
    if (selected.length >= 3 || covered.has(capability.id)) continue;
    const helper = meaningful.find(
      (skill) =>
        !selected.some((item) => item.id === skill.id) &&
        skill.matchedCapabilities.includes(capability.id),
    );
    if (helper) {
      selected.push(helper);
      helper.matchedCapabilities.forEach((item) => covered.add(item));
    }
  }
  const format = (skill, role) => ({
    id: skill.id,
    name: skill.qualifiedName,
    role,
    reason:
      CAPABILITIES.find((item) =>
        skill.matchedCapabilities.includes(item.id),
      )?.reason || skill.description,
    filePath: skill.filePath,
    source: skill.source,
    rootKind: skill.rootKind,
    root: skill.rootPath ? displayPath(skill.rootPath) : null,
    trust: skill.trust,
    trustReason: skill.trustReason,
    version: skill.version,
    score: skill.score,
    matchedTerms: skill.matchedTerms,
    matchedCapabilities: skill.matchedCapabilities,
  });
  const selectedIds = new Set(selected.map((skill) => skill.id));
  const selectedOutput = selected.map((skill, index) =>
    format(skill, index === 0 ? "主 Skill" : "辅助 Skill"),
  );
  const alternatives = meaningful
    .filter((skill) => !selectedIds.has(skill.id))
    .slice(0, 5)
    .map((skill) => format(skill, "候选 Skill"));
  const coverage = detected.length ? covered.size / detected.length : primary?.score >= 4 ? 0.55 : 0;
  return {
    task: cleanTask,
    detectedCapabilities: detected.map(({ id, label }) => ({ id, label })),
    selected: selectedOutput,
    alternatives,
    unmatched: !primary,
    confidence:
      primary?.score >= 18 && coverage >= 0.7
        ? "high"
        : primary?.score >= 8
          ? "medium"
          : "low",
    coverage: Number(coverage.toFixed(2)),
    routeSummary: selectedOutput.map((skill) => skill.name).join(" → "),
  };
}

function normalizeCacheTtl(value) {
  const environmentValue = process.env.SKILL_FOR_SKILLS_CACHE_TTL_MS;
  const resolved =
    value ??
    (typeof environmentValue === "string" && environmentValue.trim()
      ? environmentValue
      : DEFAULT_CACHE_TTL_MS);
  const ttlMs = Number(resolved);
  if (!Number.isInteger(ttlMs) || ttlMs < 0 || ttlMs > MAX_CACHE_TTL_MS) {
    throw new RouterInputError(
      `缓存时间必须是 0 到 ${MAX_CACHE_TTL_MS} 之间的整数毫秒`,
    );
  }
  return ttlMs;
}

export function createInventoryCache({
  scanInventory = scanSkillInventory,
  ttlMs,
  now = Date.now,
} = {}) {
  const resolvedTtlMs = normalizeCacheTtl(ttlMs);
  let cachedInventory = null;
  let cachedAt = 0;
  let inFlight = null;
  let generation = 0;

  const status = () => {
    const ageMs = cachedInventory ? Math.max(0, now() - cachedAt) : null;
    return {
      ready: Boolean(cachedInventory),
      refreshing: Boolean(inFlight),
      stale: ageMs !== null && ageMs >= resolvedTtlMs,
      ageMs,
      ttlMs: resolvedTtlMs,
    };
  };

  const load = async (force) => {
    const ageMs = cachedInventory ? Math.max(0, now() - cachedAt) : null;
    if (!force && cachedInventory && ageMs < resolvedTtlMs) {
      return {
        inventory: cachedInventory,
        cache: { ...status(), hit: true, coalesced: false },
      };
    }
    if (inFlight) {
      const activeScan = inFlight;
      const inventory = await activeScan.promise;
      if (activeScan.generation !== generation) return load(true);
      return {
        inventory,
        cache: { ...status(), hit: false, coalesced: true },
      };
    }

    const scan = Promise.resolve().then(() => scanInventory());
    const activeScan = { promise: scan, generation };
    inFlight = activeScan;
    let inventory;
    try {
      inventory = await scan;
      if (activeScan.generation === generation) {
        cachedInventory = inventory;
        cachedAt = now();
      }
    } finally {
      if (inFlight === activeScan) inFlight = null;
    }
    if (activeScan.generation !== generation) return load(true);
    return {
      inventory,
      cache: { ...status(), hit: false, coalesced: false },
    };
  };

  return {
    get: () => load(false),
    refresh: () => load(true),
    invalidate() {
      generation += 1;
      cachedInventory = null;
      cachedAt = 0;
    },
    status,
  };
}

function routeInventory(task, inventory, cache = null) {
  return {
    ...routeTask(task, inventory.skills),
    inventory: {
      total: inventory.total,
      counts: inventory.counts,
      scan: inventory.scan,
      conflicts: inventory.conflicts,
      scannedAt: inventory.scannedAt,
      roots: inventory.roots.map(publicRoot),
      ...(cache ? { cache } : {}),
    },
  };
}

export async function routeWithInventory(task) {
  const inventory = await scanSkillInventory();
  return routeInventory(task, inventory);
}

function publicRoot(root) {
  return {
    kind: root.kind,
    label: root.label,
    path: root.displayPath,
    automatic: root.automatic,
    available: root.available,
    blockedReason: root.blockedReason,
    fileCount: root.fileCount,
    directoryCount: root.directoryCount,
    truncated: root.truncated,
    truncationReasons: root.truncationReasons,
  };
}

function publicInventory(inventory, cache = null) {
  return {
    total: inventory.total,
    counts: inventory.counts,
    scan: inventory.scan,
    conflicts: inventory.conflicts,
    scannedAt: inventory.scannedAt,
    ...(cache ? { cache } : {}),
    roots: inventory.roots.map(publicRoot),
    skills: inventory.skills.map((skill) => ({
      name: skill.qualifiedName,
      description: skill.description,
      filePath: skill.filePath,
      source: skill.source,
      rootKind: skill.rootKind,
      root: displayPath(skill.rootPath),
      trust: skill.trust,
      trustReason: skill.trustReason,
      version: skill.version,
      capabilities: skill.capabilities,
    })),
  };
}

async function readBody(request) {
  const contentType = String(request.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new RouterInputError(
      "请求必须使用 application/json",
      415,
      "unsupported_media_type",
    );
  }
  const contentLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new RouterInputError("请求内容过大", 413, "payload_too_large");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new RouterInputError("请求内容过大", 413, "payload_too_large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RouterInputError(
        "请求内容必须是 JSON 对象",
        400,
        "invalid_body",
      );
    }
    return value;
  } catch (error) {
    if (error instanceof RouterInputError) throw error;
    throw new RouterInputError("请求内容不是有效 JSON", 400, "invalid_json");
  }
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function createWriteToken(value) {
  if (typeof value === "string" && value.trim()) {
    return { token: value.trim(), generated: false };
  }
  if (typeof process.env.SKILL_FOR_SKILLS_API_TOKEN === "string" && process.env.SKILL_FOR_SKILLS_API_TOKEN.trim()) {
    return {
      token: process.env.SKILL_FOR_SKILLS_API_TOKEN.trim(),
      generated: false,
    };
  }
  return { token: randomBytes(32).toString("hex"), generated: true };
}

function hasWriteAuthorization(request, token) {
  const authorization = request.headers.authorization || "";
  const fallback = request.headers["x-skill-for-skills-token"] || "";
  const candidate =
    typeof authorization === "string" && /^Bearer\s+/i.test(authorization)
      ? authorization.replace(/^Bearer\s+/i, "")
      : fallback;
  if (typeof candidate !== "string") return false;
  const candidateBuffer = Buffer.from(candidate);
  const tokenBuffer = Buffer.from(token);
  return candidateBuffer.length === tokenBuffer.length && timingSafeEqual(candidateBuffer, tokenBuffer);
}

export function startServer(
  port = 4319,
  { writeToken, cacheTtlMs, scanInventory, logger = console } = {},
) {
  const { token, generated: generatedToken } = createWriteToken(writeToken);
  const inventoryCache = createInventoryCache({ scanInventory, ttlMs: cacheTtlMs });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, {
          ok: true,
          name: "skill-for-skills",
          cache: inventoryCache.status(),
        });
      }
      if (request.method === "GET" && url.pathname === "/skills") {
        const { inventory, cache } = await inventoryCache.get();
        return sendJson(response, 200, publicInventory(inventory, cache));
      }
      if (request.method === "GET" && url.pathname === "/roots") {
        return sendJson(response, 200, await getSkillRoots());
      }
      if (request.method === "POST" && url.pathname === "/route") {
        const body = await readBody(request);
        const task = normalizeTask(body.task);
        const { inventory, cache } = await inventoryCache.get();
        return sendJson(response, 200, routeInventory(task, inventory, cache));
      }
      const requiresWriteAuthorization =
        (url.pathname === "/roots" &&
          (request.method === "POST" || request.method === "DELETE")) ||
        (url.pathname === "/refresh" && request.method === "POST");
      if (requiresWriteAuthorization && !hasWriteAuthorization(request, token)) {
        return sendJson(response, 401, { error: "需要 API 写入令牌" });
      }
      if (request.method === "POST" && url.pathname === "/refresh") {
        const { inventory, cache } = await inventoryCache.refresh();
        return sendJson(response, 200, publicInventory(inventory, cache));
      }
      if (request.method === "POST" && url.pathname === "/roots") {
        const body = await readBody(request);
        const roots = await addCustomRoot(body.path);
        inventoryCache.invalidate();
        return sendJson(response, 201, roots);
      }
      if (request.method === "DELETE" && url.pathname === "/roots") {
        const body = await readBody(request);
        const roots = await removeCustomRoot(body.path);
        inventoryCache.invalidate();
        return sendJson(response, 200, roots);
      }
      const allowedMethods = {
        "/health": "GET",
        "/skills": "GET",
        "/route": "POST",
        "/roots": "GET, POST, DELETE",
        "/refresh": "POST",
      };
      if (allowedMethods[url.pathname]) {
        return sendJson(
          response,
          405,
          { error: "Method not allowed" },
          { allow: allowedMethods[url.pathname] },
        );
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof RouterInputError) {
        return sendJson(response, error.status, {
          error: error.status >= 500 ? "Router failed" : error.message,
          code: error.code,
        });
      }
      logger?.error?.("Skill for Skills request failed", error);
      return sendJson(response, 500, {
        error: "Router failed",
        code: "internal_error",
      });
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const listeningPort = typeof address === "object" && address ? address.port : port;
    logger?.log?.(`Skill for Skills listening on http://127.0.0.1:${listeningPort}`);
    logger?.log?.(
      generatedToken
        ? `API write token: ${token}`
        : "API write token configured externally",
    );
  });
  server.writeToken = token;
  server.inventoryCache = inventoryCache;
  return server;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (index === args.length - 1) {
    throw new RouterInputError(`选项 ${name} 缺少值`);
  }
  return args[index + 1];
}

async function main(args = process.argv.slice(2)) {
  const [command] = args;
  let output;
  if (command === "route") {
    const task = optionValue(args, "--task") || args.slice(1).join(" ");
    output = await routeWithInventory(task);
  } else if (command === "scan") {
    output = publicInventory(await scanSkillInventory());
  } else if (command === "roots") {
    output = await getSkillRoots();
  } else if (command === "add-root") {
    output = await addCustomRoot(args.slice(1).join(" "));
  } else if (command === "remove-root") {
    output = await removeCustomRoot(args.slice(1).join(" "));
  } else if (command === "serve") {
    const port = Number(optionValue(args, "--port") || 4319);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new RouterInputError("端口必须是 1 到 65535 之间的整数");
    }
    startServer(port, { cacheTtlMs: optionValue(args, "--cache-ttl") });
    return;
  } else {
    throw new Error(
      "用法：skill-router.mjs <route|scan|roots|add-root|remove-root|serve>",
    );
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
