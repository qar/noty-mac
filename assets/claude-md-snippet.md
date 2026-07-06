<!-- BEGIN NOTY-STATUS · 由 Noty.app 管理，请勿手改 -->
## AI 活动上报（noty-status）

如果 `noty-status` 命令可用，请在以下**阶段转换**时主动上报你的状态：

- 开始一段有实质推进的工作前：`noty-status running "简短描述"`
- 需要用户澄清 / 决策前：`noty-status waiting_input "问什么"`
- 完成整体任务时：`noty-status completed "简短总结"`
- 遇到不可自动恢复的错误：`noty-status error "错误摘要"`

规则：
- 只在 tmux 里调用（脚本会从 tmux session name 反查 Noty 工作区）
- **不要**在每次 Bash / Edit 工具调用前都上报，只在明显的阶段转换时上报
- 上报失败可忽略（脚本非致命，退出码非 0 不影响主任务）
<!-- END NOTY-STATUS -->
