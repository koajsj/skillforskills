# 🧭 Skill for Skills

<p align="center">
  <strong>让 Codex 自动找到适合当前任务的本地 Skill</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Codex-Plugin-5B5BD6?style=flat-square" alt="Codex Plugin">
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 18+">
  <img src="https://img.shields.io/github/actions/workflow/status/koajsj/skillforskills/ci.yml?style=flat-square&label=CI" alt="CI">
  <img src="https://img.shields.io/github/license/koajsj/skillforskills?style=flat-square" alt="License">
</p>

> ✨ Skill for Skills 会在本机发现可用的 Agent Skills，根据任务内容匹配并排序，然后把相关 `SKILL.md` 路径交给 Agent 加载。

发布者：`kikou`

## 🌟 它能做什么

- **发现本地 Skill**：扫描 Codex、Claude、Cursor、OpenCode、`.agents/skills` 和用户添加的目录。
- **匹配当前任务**：综合任务描述、Skill 名称、说明和能力标签计算相关度，并识别部分常见任务类型。
- **给出执行路径**：返回一个主 Skill，以及最多两个辅助 Skill；同时附上候选项、匹配原因和命中词。
- **说明来源与冲突**：标记 Skill 的来源、根目录和信任类别，并解释同名 Skill 的选择结果。
- **支持本地集成**：提供命令行和仅监听本机的 JSON API，方便检查清单或连接本地工具。
- **减少重复扫描**：本地 API 会缓存 Skill 清单，共享并发扫描，并支持手动刷新。

路由只负责发现和推荐 Skill。Agent 加载选中的文件后，仍须遵守该 Skill 自己的权限、配置和安全要求。

## 🧩 工作流程

```text
任务描述
   ↓
扫描本地 SKILL.md
   ↓
匹配、排序并检查来源
   ↓
返回主 Skill、辅助 Skill 和候选项
```

如果没有 Skill 达到匹配阈值，结果会将 `unmatched` 设为 `true`，并返回空的 `selected`，避免推荐无关内容。`confidence` 为 `high`、`medium` 或 `low`，表示本次匹配的置信程度。`trust` 描述来源管理方式：Codex 管理的目录标记为 `managed`，本机工具目录标记为 `local`，用户或环境添加的目录标记为 `custom`；这些值不表示 Skill 内容已经通过安全审计。

## 🚀 安装

在终端中运行：

```bash
codex plugin marketplace add koajsj/skillforskills
codex plugin add skill-for-skills@skill-for-skills
```

安装后重启 Codex，并在新任务中调用插件。

## 💡 快速开始

直接调用 Skill：

```text
$skill-for-skills 帮我把这个 CSV 转换成带图表的 Excel 报告。
```

也可以让 Codex 为当前任务选择本地 Skill：

```text
为这个任务寻找并加载最合适的本地 Skill。
```

每个路由结果会列出 `selected`、`alternatives`、`confidence`、`coverage` 和 `unmatched`。所选项包含角色、匹配原因、文件路径、来源、分数、匹配能力和命中词。置信度为 `high`、`medium` 或 `low`。`sensitiveContentWarnings` 会提示 Skill 文件中出现的敏感关键词，供 Agent 检查。

## 🛠️ 命令行

路由任务并输出 JSON：

```bash
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs \
  route --task "创建季度汇报演示文稿"
```

其他命令：

```bash
# 扫描 Skill 并查看清单、来源、冲突和扫描诊断
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs scan

# 查看自动发现和自定义扫描目录
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs roots

# 添加或移除自定义 Skill 目录
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs add-root "/path/to/skills"
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs remove-root "/path/to/skills"

# 启动本地 API
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs serve \
  --port 4319 --cache-ttl 30000
```

扫描默认会报告截断的根目录、受隐私规则限制的根目录、同名 Skill 冲突，以及各目录的扫描规模。每个根目录最多读取 1,500 个 `SKILL.md`，遍历 10,000 个目录；达到上限时会明确标记结果不完整。

自动扫描目录包括 Codex Skills 和插件缓存、Claude、Cursor、OpenCode、`.agents/skills`。你也可以用 `SKILL_FOR_SKILLS_PATHS` 增加目录；多个路径按当前操作系统的路径分隔符连接。`CODEX_HOME` 可指定 Codex 配置目录。

## 🔌 本地 JSON API

服务默认监听 `127.0.0.1:4319`。可用 `--port` 修改端口，`--cache-ttl` 设置清单缓存时间，单位为毫秒；缓存范围是 `0` 到 `3,600,000` 毫秒，默认 `30,000` 毫秒。也可通过 `SKILL_FOR_SKILLS_CACHE_TTL_MS` 设置缓存时间。设为 `0` 会关闭缓存。

| 方法与路径 | 用途 | 写入令牌 |
| --- | --- | --- |
| `GET /health` | 健康状态与缓存状态 | 不需要 |
| `GET /skills` | Skill 清单与扫描诊断 | 不需要 |
| `GET /roots` | 扫描目录及可用状态 | 不需要 |
| `POST /route` | 根据 JSON 中的 `task` 字段路由任务 | 不需要 |
| `POST /roots` | 添加自定义扫描目录 | 需要 |
| `DELETE /roots` | 移除自定义扫描目录 | 需要 |
| `POST /refresh` | 强制刷新 Skill 清单 | 需要 |

路由请求示例：

```bash
curl -X POST http://127.0.0.1:4319/route \
  -H "Content-Type: application/json" \
  -d '{"task":"创建季度汇报演示文稿"}'
```

写入接口使用 `Authorization: Bearer <API_WRITE_TOKEN>`。如需从命令行调用写入接口，请在启动服务前设置固定令牌：

```bash
export SKILL_FOR_SKILLS_API_TOKEN="<your-local-token>"
node plugins/skill-for-skills/skills/skill-for-skills/scripts/skill-router.mjs serve
```

带令牌添加目录、移除目录或刷新清单：

```bash
curl -X POST http://127.0.0.1:4319/roots \
  -H "Authorization: Bearer <API_WRITE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"path":"/path/to/skills"}'

curl -X DELETE http://127.0.0.1:4319/roots \
  -H "Authorization: Bearer <API_WRITE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"path":"/path/to/skills"}'

curl -X POST http://127.0.0.1:4319/refresh \
  -H "Authorization: Bearer <API_WRITE_TOKEN>"
```

服务未配置固定令牌时会生成内部令牌，但不会在日志中打印完整值；因此命令行客户端无法读取这个令牌。服务支持并发请求共享扫描，并会在 `/health`、`/skills` 和 `/route` 的结果中提供缓存诊断。

## 🔒 隐私与安全

- 清单保留在本机；路由器不会上传 Skill 内容或扫描结果。
- 路由器会扫描已知兼容位置和用户明确添加目录中的 `SKILL.md` 文件；对于插件 Skill，还会读取相邻的 `.codex-plugin/plugin.json` 获取插件名称和版本。
- 不允许把磁盘根目录、用户主目录，或包含用户主目录的上级目录作为自定义扫描目录；指向这些位置的符号链接也会受到限制。
- 本地 API 只绑定 `127.0.0.1`。不要通过代理把服务转发到局域网或公网。
- `sensitiveContentWarnings` 会标记 `password`、`token`、`secret`、`api_key` 和 `private_key` 等关键词；提醒不会确认匹配内容是否为真实凭据。
- 返回路径会将用户主目录显示为 `~/...`，减少暴露本机用户名的风险。

## 📦 运行要求与开发

- 支持插件的 Codex
- Node.js 18 或更高版本

运行项目回归测试：

```bash
npm test
```

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。
