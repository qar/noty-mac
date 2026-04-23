# Tmux Pane 跳转：架构与调试指南

## 功能概述

用户在 tmux pane 中触发 Claude Code 通知 -> Noty 菜单栏应用收到通知 -> 用户点击通知 -> 自动切换到 Kitty 终端并定位到对应的 tmux pane。

## 数据流全链路

```
[1] Claude Code Hook              脚本捕获 tmux 位置，发送到 ntfy.sh
     ~/.config/noty/ntfy-notify.sh
              |
              v
[2] ntfy.sh 服务器               ⚠️ 只保留标准字段，丢弃自定义字段
              |
              v
[3] NtfyClient (ntfy-client.js)   SSE 接收 -> 解析 metadata -> 存储
              |
              v
[4] electron-store                notification.metadata.tmux.target
              |
              v
[5] Renderer (app.js)             用户点击 -> IPC 调用
              |
              v
[6] Main Process (index.js)       跳转: focus Kitty -> switch session -> select window -> select pane
```

## 各环节详解

### 环节 1: 通知脚本 — tmux 位置捕获

**文件**: `~/.config/noty/ntfy-notify.sh` (安装自 `scripts/ntfy-notify.example.sh`)

脚本按优先级获取 tmux target:

1. 输入 JSON 中的 `.tmux.target` / `.metadata.tmux.target`
2. 输入 JSON 中的 `.tmux.session` + `.tmux.window` + `.tmux.pane` 拼接
3. `$TMUX_PANE` 环境变量 (tmux 为每个 pane 的进程自动设置，**最准确**)
4. `$TMUX` 环境变量 + `tmux display-message` 获取当前活跃 pane
5. 无 `$TMUX` 时，查找最近活跃的 tmux client

**关键**: 脚本会把 tmux target 嵌入消息体 (`🖥 tmux: <target>`)，这是数据传递的**唯一可靠通道**。

#### 调试方法

```bash
# 手动运行脚本，查看生成的 payload
echo '{"title":"Test","message":"hello"}' | bash -x ~/.config/noty/ntfy-notify.sh 2>&1

# 检查关键变量
# - TMUX_TARGET 是否非空？
# - BODY 是否包含 "🖥 tmux:" 行？
# - PAYLOAD 中 message 字段是否包含 tmux 信息？
```

**常见问题**:
| 现象 | 原因 | 解决 |
|------|------|------|
| `TMUX_TARGET` 为空 | Hook 进程未继承 `$TMUX` / `$TMUX_PANE` | 确认 Claude Code 在 tmux 内运行 |
| `TMUX_TARGET` 指向错误 pane | 使用了 `display-message -p` (获取活跃 pane) 而非 `$TMUX_PANE` | 确认使用最新版 `ntfy-notify.example.sh` |

### 环节 2: ntfy.sh 服务器 — 字段丢失 (核心陷阱)

**ntfy.sh 只保留标准字段**，自定义的顶层字段会被静默丢弃。

发送的 payload:
```json
{
  "topic": "my-topic",
  "title": "Claude Code",
  "message": "🖥 tmux: %42\n\n📂 myproject (main)\n\n任务完成",
  "tags": ["robot"],
  "tmux": {"target": "%42", "session": "myproject", "window": "1", "pane": "2"},
  "metadata": {"tmux": {"target": "%42"}}
}
```

ntfy.sh 返回 (客户端收到):
```json
{
  "id": "abc123",
  "time": 1776049443,
  "event": "message",
  "topic": "my-topic",
  "title": "Claude Code",
  "message": "🖥 tmux: %42\n\n📂 myproject (main)\n\n任务完成",
  "tags": ["robot"]
}
```

**`tmux` 和 `metadata` 字段被完全丢弃。** 客户端只能从 `message` 正文解析 tmux target。

#### 调试方法

```bash
# 发送测试通知并检查返回
curl -s -H "Content-Type: application/json" \
  -d '{"topic":"YOUR_TOPIC","title":"test","message":"🖥 tmux: %42\n\nhello"}' \
  https://ntfy.sh

# 检查返回 JSON 是否包含 tmux 字段 (应该不包含)
```

### 环节 3: NtfyClient — metadata 解析

**文件**: `src/main/ntfy-client.js` — `normalizeTmuxMetadata(data)`

解析优先级:
1. `data.tmux.target` — 来自 ntfy 的结构化数据 (**被 ntfy 丢弃，实际拿不到**)
2. `data.tmux.session` + `window` + `pane` 拼接 (**同上，拿不到**)
3. `extractTmuxTargetFromMessage(data.message)` — 从消息正文解析 (**唯一有效路径**)

消息正文解析正则:
```javascript
// 查找匹配 "🖥 tmux: <target>" 的行
/^\s*(?:🖥\s*)?tmux\s*:\s*([A-Za-z0-9_.:%@+/-]+)\s*$/i
```

**要求**: `🖥 tmux: <target>` 必须独占一行 (行尾不能有其他内容)。

#### 调试方法

```bash
# 查看存储的通知 metadata
cat ~/Library/Application\ Support/noty-mac/config.json | \
  jq '.notifications[:5] | .[] | {title, message: .message[:80], metadata}'

# 如果 metadata 为 null，说明解析失败
# 检查 message 中是否有 "🖥 tmux:" 行
# 注意: message 中的 \n 必须是真正的换行符，不能是字面的 "\n" 文本
```

**常见问题**:
| 现象 | 原因 | 解决 |
|------|------|------|
| `metadata: null` 且 message 无 tmux 行 | 脚本没有把 tmux 信息嵌入消息体 | 更新为最新版 `ntfy-notify.example.sh` |
| `metadata: null` 且 message 有 tmux 行但解析失败 | tmux 行不独占一行，或包含非法字符 | 检查消息格式 |
| `metadata.tmux.session` 是 pane ID (如 `%42`) | 从 target 解析 session 时取了错误值 | 仅影响 UI 显示，不影响跳转 |

### 环节 4: Renderer — 点击判断

**文件**: `src/renderer/app.js` — 第 76-102 行

点击时检查两个条件 (满足任一即触发跳转):
```javascript
const hasTmuxTarget = !!notification?.metadata?.tmux?.target;
const hasTmuxLine = /^\s*(?:🖥\s*)?tmux\s*:\s*([A-Za-z0-9_.:%@+/-]+)\s*$/im.test(notification?.message || '');
```

如果两个条件都不满足，点击只会标记已读，不触发跳转。

#### 调试方法

在 Noty 窗口中打开 DevTools (如果可用)，查看 console 输出:
```
Failed to jump tmux target: <reason>
```

或者直接查 electron-store 中的通知数据确认 metadata 是否存在。

### 环节 5: Main Process — tmux 跳转执行

**文件**: `src/main/index.js` — `jumpToTmuxTarget(target, options)`

执行步骤:

```
1. isValidTmuxTarget(target)         验证 target 格式
2. execTmux display-message -t <target> '#S'     获取 session 名
3. execTmux display-message -t <target> '#S:#I'  获取 session:window
4. listTmuxClients()                 列出所有 tmux clients
5. pickTmuxClient(clients, session)  选择 Kitty 终端 client
6. focusApp('Kitty')                 激活 Kitty 到前台
7. execTmux switch-client -c <client> -t <session>  切换 session
8. execTmux select-window -t <session:window>        切换 window
9. execTmux select-pane -t <target>                  切换 pane
```

#### 调试方法

逐步手动执行 tmux 命令:

```bash
# Step 1: target 能否被 tmux 识别？
tmux display-message -p -t '%42' '#S'
# 如果报错 "can't find pane %42"，说明 pane 已不存在

# Step 2: 有没有 Kitty 终端的 tmux client？
tmux list-clients -F '#{client_name}\t#{session_name}\t#{client_termname}'
# termname 应包含 "kitty"

# Step 3: 逐步执行跳转
tmux switch-client -c /dev/ttys001 -t 'mysession'
tmux select-window -t 'mysession:1'
tmux select-pane -t '%42'
```

**返回的错误码**:
| reason | 含义 | 排查方向 |
|--------|------|----------|
| `no_target` | 通知中没有 tmux target | 检查环节 3 |
| `invalid_target` | target 格式不合法 | 检查 target 字符串 |
| `no_attached_client` | 没有 Kitty 终端连接 tmux | 确认 Kitty 正在运行且 attach 了 tmux |
| `tmux_not_found` | 找不到 tmux 二进制 | 检查 PATH |
| `kitty_unavailable` | Kitty 应用未安装 | — |
| `kitty_activate_failed` | 无法激活 Kitty | 检查辅助功能权限 |
| pane/window/session 错误 | tmux 命令执行失败 | pane 可能已关闭 |

### 环节 6: tmux Client 选择逻辑

`pickTmuxClient(clients, targetSession)`:

1. 从所有 client 中筛选 `termname` 包含 `kitty` 的
2. 优先选已经在 target session 上的 kitty client (最近活跃的)
3. 否则选任意 kitty client (最近活跃的)

如果没有任何 kitty client，返回 `null` -> 报 `no_attached_client`。

## 快速诊断清单

当点击通知无法跳转时，按以下顺序排查:

```
1. 查 electron-store 中的 notification.metadata
   -> 如果 null: 问题在脚本或 ntfy 传输 (环节 1-3)
   -> 如果有 target: 问题在跳转执行 (环节 5)

2. metadata 为 null 时:
   a. 查 message 中是否有 "🖥 tmux:" 行
      -> 没有: 脚本没嵌入 tmux 信息，更新脚本
      -> 有但 metadata 仍为 null: 正则匹配失败，检查格式

3. metadata 有 target 但跳转失败:
   a. target 对应的 pane 是否还存在？
   b. 是否有 Kitty 终端在运行 tmux？
   c. 手动执行 tmux select-pane -t <target> 是否成功？
```

## 添加调试日志

在 `jumpToTmuxTarget` 函数中临时添加 `console.log` 可以看到每一步的执行情况:

```bash
# 启动带日志的 dev 版本
npm run dev > /tmp/noty-mac-debug.log 2>&1 &

# 实时监控跳转日志
tail -f /tmp/noty-mac-debug.log | grep '\[jump\]\|\[ipc\]'
```

## 相关文件索引

| 文件 | 职责 |
|------|------|
| `~/.config/noty/ntfy-notify.sh` | 通知发送脚本 (已安装) |
| `scripts/ntfy-notify.example.sh` | 通知脚本源码 (最新版) |
| `src/main/index.js` | 跳转逻辑 (`jumpToTmuxTarget`) |
| `src/main/ntfy-client.js` | 通知接收 + metadata 解析 (`normalizeTmuxMetadata`) |
| `src/renderer/app.js` | 点击事件处理 |
| `src/preload.js` | IPC 桥接 |
| `src/main/store.js` | 数据存储 schema |
| `~/Library/Application Support/noty-mac/config.json` | 运行时数据 (通知列表) |
| `~/.claude/settings.json` | Claude Code hook 配置 |

## 历史教训

### 2026-04-13: 点击通知无法跳转

**现象**: 在 tmux pane 中触发 Claude Code 通知，消息列表中点击通知没有任何反应。

**根因**: 安装的 `ntfy-notify.sh` 是旧版本，有两个致命问题:
1. 只把 tmux 信息放在 JSON 自定义字段 (`tmux`, `metadata`)，但 **ntfy.sh 会丢弃所有非标准字段**
2. 没有在消息体 (`message`) 中嵌入 `🖥 tmux: <target>` 行

**结果**: 客户端收到的通知 `metadata` 为 `null`，点击时无法识别跳转目标。

**修复**: 用 `scripts/ntfy-notify.example.sh` 覆盖安装脚本。新版本:
- 在消息体中嵌入 `🖥 tmux: <target>` 行 (不依赖自定义 JSON 字段)
- 优先使用 `$TMUX_PANE` 环境变量精确定位 pane
- 多级回退机制确保 tmux 信息捕获

**验证**: 手动发送包含 `🖥 tmux: %100` 的测试通知后，跳转链路全部通过:
```
focus Kitty -> switch-client -> select-window -> select-pane -> success
```
