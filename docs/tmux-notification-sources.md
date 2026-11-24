# Tmux 提醒的来源校验

提醒的显示项目和终端来源是两个概念。Agent 可以在临时 worktree 中执行任务，而用户仍在原来的 TUI 中查看结果。项目名称和分支不足以区分同目录的多个客户端。

## Codex 线程归属

本地发送脚本保存 `metadata.agent.threadId`。原生子代理及 headless exec 有可核实的父线程时，同时保存 `originThreadId`，即使子代理退出也能找到原始线程。接收端通过 Codex 已有的本地控制 socket 查询归属，不读取令牌，也不启动任务或切换客户端。

1. 使用 `ws` 连接 `$CODEX_HOME/app-server-control/app-server-control.sock`。默认 `CODEX_HOME` 为 `~/.codex`。
2. 使用 `thread/read` 追溯原生子代理的父线程，拒绝循环或无效 ID。
3. 使用线程范围的 `mcpServerStatus/list`，读取唯一 `codex_tui` 注册的 `httpOrigin`。仅接受已连接的本机 HTTP origin。
4. 通过该线程已有的认证连接执行只读 `list_threads`，然后再次核对注册地址和环境未变化。空闲 HTTP 连接可以关闭，不能以常驻 TCP 连接代替认证核实。
5. 使用 `lsof` 确认监听端口的唯一 Codex 进程，再沿进程父链匹配 tmux pane。目录、标题和最近活动时间不参与这个选择。

新本地提醒会在后台补充已核实的 target、session、sourceProject 和 sourceThreadId。原文和独立存储的已读状态保持不变。同一线程并发到达的消息共享正在进行的查询。

点击时重新查询归属，并在跳转前再次核对客户端进程、pane、端口、服务端进程和父线程。只有跳转成功后才自动确认提醒。认证失败、客户端退出、地址变化、歧义或校验错误都会保留提醒。

## 兼容范围

这条路径需要 Codex 提供线程范围的 `codex_tui` MCP 注册、`httpOrigin` 和只读工具调用协议。经典 CLI、控制 socket 不存在或旧协议不支持时，未绑定的旧提醒继续使用原有项目校验和唯一候选恢复。已经保存线程绑定的提醒不会在绑定失效时退回目录匹配。

未提供这些归属信息的其他 agent 保持原有行为。普通非 Git 目录的校验继续沿用 `1.4.1` 的修复。

## 验证

`tests/codex-tmux-source.test.js` 使用真实 WebSocket 服务验证协议和归属选择。`tests/tmux-notification-navigation.test.js` 验证最终选中 pane、二次校验、并发补全及成功后确认。诊断真实消息时仅模拟终端选择，不写入用户通知数据库。
