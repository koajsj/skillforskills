# 🧭 Skill for Skills

<p align="center">
  <strong>让 Codex 自动找到最适合当前任务的本地 Skill</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Codex-Plugin-5B5BD6?style=flat-square" alt="Codex Plugin">
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 18+">
  <img src="https://img.shields.io/github/actions/workflow/status/koajsj/skillforskills/ci.yml?style=flat-square&label=CI" alt="CI">
  <img src="https://img.shields.io/github/license/koajsj/skillforskills?style=flat-square" alt="License">
</p>

> ✨ 一个轻量、本地优先的 Skill 路由工具，帮助 Codex 根据任务自动选择合适的 Skill。

Skill for Skills 是一个面向 Codex 的本地元 Skill。它会扫描兼容位置中的
`SKILL.md` 文件，根据当前任务进行匹配，并返回由主 Skill 和辅助 Skill
组成的最小可用执行路径。

## 🌟 功能

- 从 Codex、Claude、Cursor、OpenCode、`.agents/skills` 以及用户明确授权的
  自定义目录中发现 Skill。
- 选择一个主 Skill，并最多选择两个辅助 Skill。
- 返回选中 Skill 的本地 `SKILL.md` 精确路径，方便 Agent 加载对应指令。
- 使用确定性的目录顺序和来源优先级处理同名 Skill，并公开冲突明细。
- 在结果中标注 Skill 的来源、根目录和可信度，避免把未知来源误认为受管来源。
- 使用标准中文词边界组合 2–8 字短语，优先匹配长词并过滤常见请求套话。
- 对重叠中文子串只计算最高价值命中，避免同一短语被重复加分。
- 本地 API 缓存 Skill 清单并合并并发扫描，减少重复文件遍历。
- 提供受写入令牌保护的手动刷新，并返回缓存命中和时效诊断。
- Skill 清单始终保留在本地，拒绝扫描整个磁盘或整个用户主目录。
- 提供零依赖的 Node.js CLI 和本地 JSON API。

## 🧩 工作方式

```text
当前任务
   ↓
扫描本地 SKILL.md
   ↓
匹配并排序 Skill
   ↓
返回主 Skill + 辅助 Skill
```

Skill for Skills 只负责发现和路由，不会替你执行选中 Skill 中的具体任务。

## 🚀 安装

```bash
codex plugin marketplace add koajsj/skillforskills
codex plugin add skill-for-skills@skill-for-skills
```

安装完成后，重启 Codex 并新建一个任务。

## 💡 使用

显式调用：

```text
$skill-for-skills 帮我把这个 CSV 转换成带图表的 Excel 报告。
```

或者直接让 Codex 选择本地 Skill：

```text
为这个任务寻找并加载最合适的本地 Skill。
```

如果没有达到匹配阈值，路由结果会返回空的 `selected`，并将 `unmatched` 设置为
`true`，避免错误加载无关 Skill。

每个选中项和候选项都会返回 `source`、`root`、`trust`、`trustReason` 和
`matchedTerms`。`matchedTerms` 会列出实际命中的任务短语以及命中名称还是描述，
便于检查中文路由结果。
`trust` 可能是 `managed`、`local` 或 `custom`，它只描述来源管理方式，不代表
Skill 内容已经通过安全审计。

## 🛠️ 命令行

```bash
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs \
  route --task "创建季度汇报演示文稿"
```

其他命令：

```bash
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs scan
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs roots
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs add-root "/path/to/skills"
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs serve \
  --port 4319 --cache-ttl 30000
```

`scan` 结果包含以下诊断字段：

- `scan.truncated`：是否有扫描根目录达到文件或目录数量上限。
- `scan.truncatedRoots`：被截断的根目录及原因。
- `scan.blockedRoots`：因隐私保护而拒绝扫描的磁盘根目录或用户主目录。
- `conflicts`：同名 Skill 的选中来源、忽略来源和选择原因。
- `roots[].fileCount`、`roots[].directoryCount`：各根目录的实际扫描规模。

默认情况下，每个根目录最多读取 1,500 个 `SKILL.md`，最多遍历 10,000 个目录。
达到上限时不会静默返回不完整结果。

## 🔌 本地 API

执行 `serve` 后，服务只会监听 `127.0.0.1`。Skill 清单默认缓存 30 秒，可通过
`--cache-ttl` 或 `SKILL_FOR_SKILLS_CACHE_TTL_MS` 调整为 0–3,600,000 毫秒。
并发请求会共享同一次扫描，`/health`、`/skills` 和 `/route` 会返回缓存状态。

`/health`、`/skills`、`/roots` 和 `/route` 为只读接口；新增或删除自定义目录，
或调用 `POST /refresh` 强制刷新清单时，需要携带启动时生成的一次性令牌，或通过
环境变量配置的固定 API 写入令牌：

```bash
curl -X POST http://127.0.0.1:4319/roots \
  -H "Authorization: Bearer <API_WRITE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"path":"/path/to/skills"}'

curl -X POST http://127.0.0.1:4319/refresh \
  -H "Authorization: Bearer <API_WRITE_TOKEN>"
```

也可以通过 `SKILL_FOR_SKILLS_API_TOKEN` 环境变量设置固定令牌，便于本地扩展程序连接。
API 会返回 Skill 的本地绝对路径，因此只能在可信设备上通过本机地址使用，不应通过
代理转发到局域网或公网。

## 🔒 隐私与安全

路由器只会从已知的兼容位置，以及用户明确添加的目录中读取 `SKILL.md` 文件。
它不会上传本地 Skill 清单。路由过程也不会绕过所选 Skill 的权限、配置步骤或
安全要求。为保护隐私，不能把整个磁盘、整个用户目录、包含用户主目录的上级目录，
或解析后指向这些位置的符号链接添加为自定义扫描目录。

## 📦 运行要求

- 支持插件的 Codex
- Node.js 18 或更高版本

运行回归测试：

```bash
npm test
```

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。
