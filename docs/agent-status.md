# AI 活动状态上报（Agent Status Reporting）

Noty 的主界面会在每个工作区上显示一个 AI 活动状态点（运行中 / 等待输入 / 已完成 / 出错），信息来自工作区目录下的 `agent-status.json` 文件。任何 AI agent（Claude Code、cursor、自研脚本…）都可以通过写这个文件把自己的当前状态上报给 Noty。

Noty 只**读取**这个文件，绝对不修改，也不写它。上报完全在你的 agent / 脚本控制之下。

---

## 状态文件

**位置**：`~/Library/Application Support/noty-mac/workspaces/<workspace-uuid>/agent-status.json`

**Schema**：

```jsonc
{
  "state": "running",          // 必填。idle | running | waiting_input | completed | error
  "message": "生成代码中",       // 可选。一句话摘要，会显示在列表项副标题和详情面板
  "agent": "claude-code",       // 可选。多 agent 场景下区分来源
  "updatedAt": 1720098000000,   // 必填。ms epoch，Noty 用它判断是否 stale
  "pid": 12345                  // 可选。上报进程的 PID
}
```

**Noty 的解析规则**：
- 无文件 → 该工作区显示为 idle（无状态点）
- 有文件但 `state: idle` → 无状态点
- 有文件且 `updatedAt` 超过 **5 分钟** 没更新 → 视为 stale（灰点），tooltip 显示 "X 分钟前上报"
- `running` → 蓝色呼吸点
- `waiting_input` → 蓝色空心圆环
- `completed` → 绿色实心点
- `error` → 红色实心点

**只有 message 存在且状态非 idle** 时，列表项副标题会用 message 覆盖原来的 `tmux · <session>`。

---

## 上报入口：`scripts/noty-status`

Noty 项目里附带了一个 bash 上报脚本，位于 `scripts/noty-status`。无依赖（只需要 `bash` + `tmux` + `date`），能被任何 agent 直接调用。

### 安装

把仓库里的 `scripts/noty-status` 复制或者软链到你 PATH 上：

```bash
# 假设你的项目根目录是 ~/projects/noty-mac
ln -sf ~/projects/noty-mac/scripts/noty-status /usr/local/bin/noty-status
```

或者直接把 `scripts/` 加到 `$PATH`（在 `.zshrc` / `.bashrc` 里）。

### 用法

```bash
noty-status running "generating patches"
noty-status waiting_input "confirm the refactor plan?"
noty-status completed "all tests pass"
noty-status error "compilation failed on foo.ts:42"
noty-status idle
```

**脚本会做什么**：
1. 读取当前 tmux session 名（`tmux display-message -p '#S'`）。**必须在 tmux 里跑**。
2. 扫描 `workspaces/*/workspace.json`，找到 `tmuxSessionName` 匹配的那个工作区。
3. 原子写入 `agent-status.json`（tmp file + `mv -f`），保证 Noty 不会读到半写状态。

### 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `NOTY_AGENT`          | `shell`  | 上报的 `agent` 字段 |
| `NOTY_AGENT_PID`      | `$PPID`  | 上报的 `pid` 字段 |
| `NOTY_WORKSPACES_DIR` | `~/Library/Application Support/noty-mac/workspaces` | 备用工作区目录（测试 / 自建路径） |

例：`NOTY_AGENT=claude-code noty-status running "generating"`

### 退出码

| 值 | 含义 |
|---|---|
| 0 | 上报成功 |
| 1 | 参数错误（state 非法或缺失） |
| 2 | tmux 不在 PATH 里 |
| 3 | 当前 shell 没有 attach 到 tmux session |
| 4 | Noty 工作区根目录不存在 |
| 5 | 找不到匹配当前 tmux session 的工作区 |

---

## Claude Code hook 集成示例

Claude Code 支持在关键时机运行外部 hook。把 `noty-status` 挂上去，可以让 Noty 显示 Claude Code 正在做什么、什么时候等你确认。

在项目根 `.claude/settings.local.json` 里加：

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "NOTY_AGENT=claude-code noty-status running \"执行 $CLAUDE_TOOL_NAME\""
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "NOTY_AGENT=claude-code noty-status waiting_input \"$CLAUDE_NOTIFICATION_MESSAGE\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "NOTY_AGENT=claude-code noty-status completed"
          }
        ]
      }
    ]
  }
}
```

Claude Code 具体的 hook 事件名、matcher 语法和可用环境变量以官方文档为准（示例中的 `CLAUDE_TOOL_NAME` / `CLAUDE_NOTIFICATION_MESSAGE` 名字可能随版本变化，请对照当前 Claude Code hook 文档调整）。

---

## 集成到其他 agent

只要能生成 JSON 并写文件，任何 agent 都可以上报：

**Python 例子**：

```python
import json, os, time, subprocess
from pathlib import Path

session = subprocess.check_output(['tmux', 'display-message', '-p', '#S']).decode().strip()
root = Path.home() / 'Library/Application Support/noty-mac/workspaces'

for meta in root.glob('*/workspace.json'):
    data = json.loads(meta.read_text())
    if data.get('tmuxSessionName') == session:
        target = meta.parent / 'agent-status.json'
        payload = {
            'state': 'running',
            'message': 'training model epoch 3/10',
            'agent': 'my-python-agent',
            'updatedAt': int(time.time() * 1000),
            'pid': os.getpid(),
        }
        tmp = target.with_suffix('.tmp')
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        tmp.replace(target)  # atomic rename
        break
```

---

## 红线（`docs/workspace-mvp.md §11`）

- Noty 主进程**只读**这个文件，永远不写。
- 上报脚本 **只写** workspace 自己的目录，不动 tmux、不动 git worktree。
- 状态文件里的 `pid` 字段只作为信息展示，Noty 永远不会 `kill` 或 signal 这个 PID。
