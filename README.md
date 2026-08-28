# 🧭 Skill for Skills

<p align="center">
  <strong>让 Codex 自动找到最适合当前任务的本地 Skill</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Codex-Plugin-5B5BD6?style=flat-square" alt="Codex Plugin">
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 18+">
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
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs serve --port 4319
```

## 🔌 本地 API

执行 `serve` 后，服务只会监听 `127.0.0.1`。`/health`、`/skills`、`/roots`
和 `/route` 为只读接口；新增或删除自定义目录时，需要携带启动时输出的 API
写入令牌：

```bash
curl -X POST http://127.0.0.1:4319/roots \
  -H "Authorization: Bearer <API_WRITE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"path":"/path/to/skills"}'
```

也可以通过 `SKILL_FOR_SKILLS_API_TOKEN` 环境变量设置固定令牌，便于本地扩展程序连接。

## 🔒 隐私与安全

路由器只会从已知的兼容位置，以及用户明确添加的目录中读取 `SKILL.md` 文件。
它不会上传本地 Skill 清单。路由过程也不会绕过所选 Skill 的权限、配置步骤或
安全要求。为保护隐私，不能把整个磁盘、整个用户目录，或解析后指向用户目录的
符号链接添加为自定义扫描目录。

## 📦 运行要求

- 支持插件的 Codex
- Node.js 18 或更高版本

运行回归测试：

```bash
npm test
```

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。
