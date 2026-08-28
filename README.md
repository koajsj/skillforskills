# Skill for Skills

Skill for Skills 是一个面向 Codex 的本地元 Skill。它会扫描兼容位置中的
`SKILL.md` 文件，根据当前任务进行匹配，并返回由主 Skill 和辅助 Skill
组成的最小可用执行路径。

## 功能

- 从 Codex、Claude、Cursor、OpenCode、`.agents/skills` 以及用户明确授权的
  自定义目录中发现 Skill。
- 选择一个主 Skill，并最多选择两个辅助 Skill。
- 返回选中 Skill 的本地 `SKILL.md` 精确路径，方便 Agent 加载对应指令。
- Skill 清单始终保留在本地，拒绝扫描整个磁盘或整个用户主目录。
- 提供零依赖的 Node.js CLI 和本地 JSON API。

## 安装

```bash
codex plugin marketplace add koajsj/skillforskills
codex plugin add skill-for-skills@skill-for-skills
```

安装完成后，重启 Codex 并新建一个任务。

## 使用

显式调用：

```text
$skill-for-skills 帮我把这个 CSV 转换成带图表的 Excel 报告。
```

或者直接让 Codex 选择本地 Skill：

```text
为这个任务寻找并加载最合适的本地 Skill。
```

## 命令行

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

## 隐私与安全

路由器只会从已知的兼容位置，以及用户明确添加的目录中读取 `SKILL.md` 文件。
它不会上传本地 Skill 清单。路由过程也不会绕过所选 Skill 的权限、配置步骤或
安全要求。

## 运行要求

- 支持插件的 Codex
- Node.js 18 或更高版本

## 许可证

MIT
