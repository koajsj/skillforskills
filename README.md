# 🧭 Skill for Skills

Skill for Skills 是一个运行在本机的 Codex Meta Skill。它会扫描本机可用的 Agent Skills，根据任务内容进行匹配和排序，并返回需要加载的 `SKILL.md` 文件路径。

发布者：**kikou**

## ✨ 功能

- 🔎 自动发现 Codex、Claude、Cursor、OpenCode、`.agents/skills` 等目录中的 Skills，也支持添加自定义目录。
- 🎯 根据任务描述、Skill 名称、说明和能力标签计算匹配度。
- 🧩 为任务推荐一个主 Skill 和最多两个辅助 Skill，并提供候选项及匹配原因。
- 📍 返回 Skill 的本机文件路径、来源和版本信息。
- 🔒 清单保留在本机，不会上传；扫描范围限制在已知目录和用户添加的目录中。
- ⚙️ 提供无需额外依赖的 Node.js 命令行工具，以及仅监听本机的 JSON API。

路由器只负责发现和推荐 Skills。加载 Skill 后，仍需遵守该 Skill 自身的权限、配置和安全要求。

## 📦 安装

需要支持插件的 Codex。运行以下命令：

```bash
codex plugin marketplace add koajsj/skillforskills
codex plugin add skill-for-skills@skill-for-skills
```

安装后重启 Codex，并在新任务中调用 Skill。

## 🚀 快速开始

直接指定 Skill：

```text
$skill-for-skills 帮我把这个 CSV 转成带图表的 Excel 报告。
```

也可以让 Codex 为当前任务选择本地 Skills：

```text
为这个任务寻找并加载最合适的本地 Skills。
```

## 🛠️ 命令行

路由一个任务：

```bash
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs \
  route --task "创建季度汇报演示文稿"
```

查看本机 Skill 清单：

```bash
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs scan
```

查看扫描目录、添加或移除自定义目录：

```bash
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs roots
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs add-root "/path/to/skills"
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs remove-root "/path/to/skills"
```

启动本地 API（默认端口 `4319`）：

```bash
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs serve --port 4319
```

## 🔌 本地 JSON API

服务仅监听 `127.0.0.1`。可用接口如下：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 检查服务状态 |
| `GET` | `/skills` | 获取本地 Skill 清单 |
| `GET` | `/roots` | 查看扫描目录 |
| `POST` | `/route` | 根据请求中的 `task` 字段路由任务 |
| `POST` | `/roots` | 添加自定义扫描目录 |
| `DELETE` | `/roots` | 移除自定义扫描目录 |

路由请求示例：

```bash
curl -X POST http://127.0.0.1:4319/route \
  -H "Content-Type: application/json" \
  -d '{"task":"创建季度汇报演示文稿"}'
```

## 🛡️ 隐私与安全

- 只读取兼容目录中的 `SKILL.md` 文件，以及插件的必要元数据。
- 不会上传本机 Skill 清单或文件内容。
- API 仅绑定本机回环地址 `127.0.0.1`；不要把服务代理到局域网或公网。
- 选择 Skill 不会绕过它自己的权限和安全要求。

## 📋 运行要求

- 支持插件的 Codex
- Node.js 18 或更高版本

## 📄 许可证

MIT © 2026 kikou
