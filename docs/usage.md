# Noty-Mac 使用指南

Noty-Mac 是 macOS 菜单栏应用，用于接收 ntfy.sh 通知。其核心功能是：收到通知后点击通知，可以自动跳转到发送通知的 tmux pane。

## 安装

安装 Noty-Mac 应用后，需要将通知脚本安装到指定位置：

```bash
mkdir -p ~/.configs/noty/noty
cp scripts/ntfy-notify.example.sh ~/.configs/noty/noty/ntfy-notify.sh
chmod +x ~/.configs/noty/noty/ntfy-notify.sh
```

脚本路径为：`~/.configs/noty/noty/ntfy-notify.sh`

## 快速开始

### 1. 环境变量配置

在使用脚本前，需要配置以下环境变量：

```bash
# 必填：ntfy 频道名称（Topic）
export NTFY_CHANNEL="your-topic"

# 可选：ntfy 服务器地址（默认 https://ntfy.sh）
export NTFY_SERVER="https://ntfy.sh"

# 可选：在跳转前先打开指定应用（calendar 或 safari）
export NTFY_CHAIN_TEST_APP="calendar"
```

### 2. 发送通知

将 JSON 输入传递给脚本：

```bash
echo '{"title": "任务完成", "message": "PR #184 已合并"}' | ~/.configs/noty/noty/ntfy-notify.sh
```

或使用更完整的格式：

```bash
cat << 'EOF' | ~/.configs/noty/noty/ntfy-notify.sh
{
  "title": "Claude Code",
  "message": "任务已完成"
}
EOF
```

## 自动捕获 tmux 位置信息

脚本会自动检测当前是否在 tmux 环境中运行。如果是，会自动捕获并附加 tmux 位置信息：

- `session`: tmux 会话名称
- `window`: 窗口编号
- `pane`: pane 编号
- `target`: 完整目标（格式：`session:window.pane`）

示例输出：

```json
{
  "title": "Claude Code",
  "message": "🖥 tmux: myproject:3.1\n\n任务已完成",
  "tags": ["robot"],
  "tmux": {
    "target": "myproject:3.1",
    "session": "myproject",
    "window": "3",
    "pane": "1"
  },
  "metadata": {
    "tmux": {
      "target": "myproject:3.1",
      "session": "myproject",
      "window": "3",
      "pane": "1"
    }
  }
}
```

## 通知格式

### 基本格式

```json
{
  "title": "通知标题",
  "message": "通知内容",
  "topic": "频道名称（可选，会覆盖环境变量）"
}
```

### 带 tmux 信息的格式

如果需要在消息中显式包含 tmux 信息（便于阅读），可以在消息第一行添加：

```
🖥 tmux: <target>
```

例如：

```json
{
  "title": "Claude Code",
  "message": "🖥 tmux: myproject:3.1\n\n任务已完成：添加了新功能"
}
```

### 带测试应用链的格式

如果你希望在跳转到 tmux 之前先打开 Calendar 或 Safari：

```bash
export NTFY_CHAIN_TEST_APP="calendar"
echo '{"title": "提醒", "message": "会议即将开始"}' | ~/.configs/noty/noty/ntfy-notify.sh
```

或者在 JSON 中指定：

```json
{
  "title": "提醒",
  "message": "会议即将开始",
  "chainTestApp": "safari"
}
```

## 在 Claude Code 中发送通知

### 方法一：使用脚本

```bash
# 确保环境变量已配置
export NTFY_CHANNEL="your-channel"

# 发送简单通知
echo '{"title": "任务完成", "message": "代码已提交"}' | ~/.configs/noty/noty/ntfy-notify.sh

# 发送带 tmux 位置的通知
echo '{"title": "需要输入", "message": "Claude 等待你的确认"}' | ~/.configs/noty/noty/ntfy-notify.sh
```

### 方法二：使用 curl 直接发送

如果不想使用脚本，也可以直接用 curl：

```bash
# 简单通知
curl -d "任务完成" ntfy.sh/your-topic

# 带 tmux 信息
curl -H "Content-Type: application/json" \
  -d '{"title": "Claude Code", "message": "🖥 tmux: myproject:3.1\n\n需要你的输入"}' \
  ntfy.sh/your-topic
```

## 点击通知后的行为

1. **有 tmux 信息**：点击通知 → Noty 窗口隐藏 → 自动跳转到对应的 tmux pane
2. **无 tmux 信息**：点击通知 → Noty 窗口隐藏 → 不执行跳转

## 完整示例

### 工作流完成通知

```bash
# 任务完成后发送通知
cat << 'EOF' | ~/.configs/noty/noty/ntfy-notify.sh
{
  "title": "Claude Code (任务完成)",
  "message": "✅ 功能开发完成：添加了用户认证模块"
}
EOF
```

### 需要输入时通知

```bash
cat << 'EOF' | ~/.configs/noty/noty/ntfy-notify.sh
{
  "title": "Claude Code (需要输入)",
  "message": "Claude 需要你的批准才能继续执行"
}
EOF
```

### 错误通知

```bash
cat << 'EOF' | ~/.configs/noty/noty/ntfy-notify.sh
{
  "title": "Claude Code (错误)",
  "message": "❌ 构建失败：测试用例未通过"
}
EOF
```

### 带分支信息

```bash
cat << 'EOF' | ~/.configs/noty/noty/ntfy-notify.sh
{
  "title": "Claude Code (提交)",
  "message": "📝 已提交: feat: 添加新功能\n\n分支: feature/new-auth"
}
EOF
```

## 故障排查

### 通知没有跳转功能

检查通知是否包含以下之一：
1. JSON 中包含 `metadata.tmux.target` 字段
2. 消息文本第一行包含 `🖥 tmux:` 模式

### 脚本执行失败

1. 确认 `jq` 已安装：`command -v jq`
2. 确认 `NTFY_CHANNEL` 环境变量已设置
3. 检查网络连接是否正常

### tmux 信息未捕获

确保：
1. 脚本在 tmux 会话中运行
2. tmux 命令可执行：`tmux display-message -p '#S'`

## 相关文件

- `~/.configs/noty/noty/ntfy-notify.sh` - 通知发送脚本
- `src/main/index.js` - 主进程逻辑（tmux 跳转实现）
- `src/main/ntfy-client.js` - ntfy 客户端（metadata 解析）
- `src/renderer/app.js` - 渲染进程逻辑（点击事件处理）