# RtiTek Plane 通知

在「设置 > 通知 > 新建通知」选择通知类型：

- **Tmux 内的 AI agent 通知**：保留现有 tmux 跳转、同 pane 合并和已读行为。旧订阅自动按此类型显示。
- **RtiTek Plane 通知**：订阅专用 ntfy 频道，将每条 webhook 事件保存为独立待办。

Plane 来源需要填写 ntfy 频道地址和 Plane 网站地址，例如 `https://plane.example.com`。网站地址不包含工作区或任务路径；部署在子路径时保留该前缀。工作区标识优先使用 webhook 的 `workspace_slug`，缺少时使用表单中的可选值。频道需要认证时填写具备订阅读取权限的 ntfy 访问令牌，令牌使用 macOS 安全存储加密。

## 点击与处理

菜单栏通知面板提供「全部」「Plane 待处理」「已处理」视图。点击 Plane 通知在默认浏览器打开任务，不会自动完成；点击勾选按钮才标记已处理，在「已处理」里可以恢复。每条事件都是一项独立待办，同一任务的多次更新不会合并。

「全部已读」、隐藏已读设置和旧通知的 1000 条历史限制都不会清除 Plane 待办。Plane 已处理记录同样保留，支持恢复和重连去重。删除通知来源只停止订阅，已接收记录仍保留。数据存储在应用本地 `config.json` 中。

支持标准 Plane `issue`、`issue_comment`、`cycle_issue` 和 `module_issue` 任务定位：

```text
{Plane 网站地址}/{workspace_slug}/projects/{project_id}/issues/{issue_id}
```

也支持 ntfy `click` 或正文中的 `issue_url` 明确提供 HTTP(S) 任务链接。评论使用所属 `issue`，不会错误地打开评论 ID。删除事件、非任务事件或格式异常消息仍进入堆栈；无法确定任务地址时显示「缺少任务链接」，原始事件可展开检查。

## 中转 Worker

推荐使用 [plane-ntfy-relay.mjs](../scripts/plane-ntfy-relay.mjs)，在 Cloudflare Worker 环境配置：

| 变量 | 内容 |
| --- | --- |
| `PLANE_WEBHOOK_SECRET` | Plane webhook 的签名密钥 |
| `TARGET_WEBHOOK_URL` | 完整 ntfy topic 地址，例如 `https://ntfy.example.com/company-plane` |
| `TARGET_BEARER_TOKEN` | 对该 topic 有发布权限的 ntfy 令牌 |

原始转发代码也适用于小于 ntfy 正文上限的事件：目标必须是 **topic 地址**，不能是 `/json`、`/sse` 或服务器根地址。原样转发的自定义 `X-Plane-*` 请求头不会成为 ntfy 消息字段。

ntfy 默认将超过 **4096 字节**的正文转成会过期的附件，Plane 的完整任务描述容易触发这个限制。示例 Worker 在用原始字节验证 HMAC-SHA256 后才解析、精简消息，保留任务 ID、项目 ID、工作区、事件类型、操作、变更字段和 delivery ID，正文始终不超过 4096 字节。长描述被移除，长名称和字段值会截短；应用的「事件详情」保存的是收到的精简正文。无需把 Plane 签名密钥放入 Noty。

上游失败会返回上游错误状态或 502，便于 Plane 重试。相同 ntfy 消息 ID（以及示例 Worker 携带的相同 delivery ID）只入栈一次；不同事件即使属于同一任务也会分别保存。

首版不按事件重要性过滤，保留 `event`、`action`、`activity.field` 及收到的正文，为后续过滤保留依据。应用关闭期间能补收多少消息受 ntfy 服务端缓存时长限制。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

实际接入时，在 Plane 中触发任务更新，确认「Plane 待处理」新增一条、点击打开正确任务、重新打开 Noty 后仍在待处理列表，最后手动标记已处理。
