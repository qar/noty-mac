# RtiTek Plane 通知

在「设置 > 通知 > 新建通知」选择通知类型：

- **Tmux 内的 AI agent 通知**：支持 tmux 跳转、同 pane 合并和独立标记已读。旧订阅自动按此类型显示。
- **RtiTek Plane 通知**：订阅专用 ntfy 频道，将每条 webhook 事件保存为独立待办。

Plane 来源需要填写 ntfy 频道地址和 Plane 网站地址，例如 `https://plane.example.com`。网站地址不包含工作区或任务路径；部署在子路径时保留该前缀。工作区标识优先使用 webhook 的 `workspace_slug`，缺少时使用表单中的值。只有 `workspace_id` 或 `data.workspace` UUID 的事件需要填写工作区标识，它是浏览器任务地址中紧跟网站地址的路径段。频道需要认证时填写具备订阅读取权限的 ntfy 访问令牌，令牌使用 macOS 安全存储加密。

## 点击与处理

菜单栏通知面板提供「全部」「Plane 待处理」「已处理」视图。点击 macOS 系统通知会打开 Noty 通知面板，切换到对应视图并定位、高亮该条消息；已读或已处理消息也能定位。点击应用内通知标题才会打开浏览器任务或跳转 tmux。这两种点击都不会自动标记已读或完成。每条通知有独立的「标记已读」按钮；同 pane 合并的 AI 通知可标记本组已读。Plane 通知另外提供勾选按钮标记已处理，在「已处理」里可以恢复。每条 Plane 事件都是一项独立待办，同一任务的多次更新不会合并。

Plane 评论事件默认显示评论正文前 200 个字符，HTML 转为纯文本，超长内容追加省略号；系统通知使用相同评论预览。应用内其他 Plane 事件及没有正文的评论显示事件摘要，解析异常或附件读取失败时显示错误提示。所有 Plane 通知的完整原文都保存在本地并默认折叠，可展开「原始 JSON」查看格式化内容和复制；非 JSON 原文使用「原始内容」入口。已有记录同样适用。展开原文不改变已读或已处理状态，任务定位仍使用事件字段。

「全部已读」、隐藏已读设置和旧通知的 1000 条历史限制都不会清除 Plane 待办。Plane 已处理记录同样保留，支持恢复和重连去重。删除通知来源只停止订阅，已接收记录仍保留。数据存储在应用本地 `config.json` 中。

支持标准 Plane `issue`、`issue_comment`、`cycle_issue` 和 `module_issue` 任务定位：

```text
{Plane 网站地址}/{workspace_slug}/projects/{project_id}/issues/{issue_id}
```

使用 `/browse/{项目编号}-{任务编号}/` 的新版 Plane 仍提供上述 UUID 路由，并自动转向对应任务详情，因此评论事件不需要额外包含项目编号或任务编号。

也支持 ntfy `click` 或正文中的 `issue_url` 明确提供 HTTP(S) 任务链接。评论使用所属 `issue`，不会错误地打开评论 ID。删除事件、非任务事件或格式异常消息仍进入堆栈；无法确定任务地址时显示「缺少任务链接」，原始事件直接显示在正文中。

## 中转 Worker

推荐使用 [plane-ntfy-relay.mjs](../scripts/plane-ntfy-relay.mjs)，在 Cloudflare Worker 环境配置：

| 变量 | 内容 |
| --- | --- |
| `PLANE_WEBHOOK_SECRET` | Plane webhook 的签名密钥 |
| `TARGET_WEBHOOK_URL` | 完整 ntfy topic 地址，例如 `https://ntfy.example.com/company-plane` |
| `TARGET_BEARER_TOKEN` | 对该 topic 有发布权限的 ntfy 令牌 |

目标必须是 **topic 地址**，不能是 `/json`、`/sse` 或服务器根地址。Worker 用原始字节验证 HMAC-SHA256，校验 JSON 后将相同字节转发到 ntfy，保留完整评论、描述和其他字段。自定义 `X-Plane-*` 请求头不会成为 ntfy 消息字段。无需把 Plane 签名密钥放入 Noty。

ntfy 默认将超过 **4096 字节**的正文转成附件。Noty 会用订阅令牌读取同一 ntfy 服务提供的 JSON 附件，将完整原文存入本地，并直接格式化展示。附件读取上限为 16 MB，15 秒超时；失败时消息仍保留，显示具体错误和「重试读取正文」按钮，不会自动变成已读或已处理。附件地址不允许跨服务跳转。

旧版本仅保存了 `You received a file: attachment.json` 的消息，会在重新订阅时尝试从 ntfy 缓存补全原文，保留本地消息 ID、已读和已处理状态。恢复受 ntfy 消息缓存和附件过期时间限制；服务器已删除的附件无法恢复。下载成功后的原文保存在本地，不依赖服务端附件继续存在。

上游失败会返回上游错误状态或 502，便于 Plane 重试。相同 ntfy 消息 ID 只入栈一次，正文明确包含相同 `delivery_id` 时也会去重；原样转发不会将请求头中的 delivery ID 加入正文。不同事件即使属于同一任务也会分别保存。

首版不按事件重要性过滤，保留 `event`、`action`、`activity.field` 及收到的正文，为后续过滤保留依据。应用关闭期间能补收多少消息受 ntfy 服务端缓存时长限制。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

实际接入时，在 Plane 中触发任务更新，确认「Plane 待处理」新增一条；点击系统通知应打开 Noty 并展示原文，点击应用内标题应打开正确任务。重新打开 Noty 后消息仍在待处理列表，最后通过独立按钮标记已读或已处理。
