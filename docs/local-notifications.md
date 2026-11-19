# 本机通知与 SQLite

本机 AI 通知直接写入 SQLite，不经过 ntfy。Plane 和远端 ntfy 通知仍通过网络接收，并保存到同一个数据库。

## 安装发送命令

在「设置 > AI 集成」复制 `noty-notify` 的安装命令。标准安装路径为：

```bash
mkdir -p ~/.local/bin
ln -sf "$HOME/Library/Application Support/noty-mac/notification-tools/current/noty-notify" ~/.local/bin/noty-notify
```

应用只提供命令，不会自动修改 PATH、shell 配置或 agent hook。已有 hook 可转发标准输入给 `noty-notify`。

应用在自己的数据目录准备发送脚本和数据库 schema。稳定的 `current` 路径会跟随版本更新。脚本和 SQLite 模块都包含在 `app.asar`，兼容现有的应用内更新方式；运行时无需下载依赖。

```bash
noty-notify <<EOF
{"title":"AI 通知","message":"检查已完成","cwd":"$PWD"}
EOF
```

需要明确指定窗格时，输入中可增加 `"target":"%94"`。通常由脚本自动解析。共享 Codex daemon 的继承环境可能属于其他窗格；同目录有多个 agent 且没有可靠来源绑定时，脚本不会猜测。更换传输方式不会自动补全旧消息缺失的来源。

发送命令依赖系统自带的 `sqlite3` 和 `jq`。它每次使用短事务写入一条记录。Noty 不运行时也能写入。Noty 每 500 毫秒通过索引检查未接收的本地记录，启动时补收积压。接收不改变已读状态。重复使用同一个输入 `id` 不会新增记录或恢复旧提醒。

## 存储与迁移

默认目录为 `~/Library/Application Support/noty-mac/`：

| 文件 | 内容 |
| --- | --- |
| `config.json` | 订阅、窗口位置及其他设置 |
| `notifications.sqlite3` | 本地和远端通知、已读状态、分组键及去重凭据 |
| `notifications.sqlite3-wal`、`notifications.sqlite3-shm` | SQLite 运行期间使用的文件，不要手工删除 |
| `notifications-legacy-backup.json` | 首次迁移前保存的旧通知数组 |

首次启动会先备份旧通知，再用一个事务导入所有记录和迁移标记。成功提交后才从设置中移除通知数组。迁移失败时保留旧数据。后续启动不会重新导入备份，因此已清除的记录不会复活。历史记录不再使用旧的 1000 条截断规则。

SQLite 使用 WAL、5 秒锁等待及完整同步写入。内容补充与已读状态分列保存，避免后台 Plane 查询覆盖用户刚完成的操作。多个进程可以同时发送；SQLite 依次提交各个短写事务。

## 远端兼容

需要从其他机器通过 ntfy 发送时，显式选择远端传输：

```bash
NOTY_TRANSPORT=ntfy NTFY_CHANNEL=my-topic noty-notify <<EOF
{"title":"AI 通知","message":"远端检查已完成","cwd":"$PWD"}
EOF
```

远端机器需要安装发送脚本。只有本地模式需要 SQLite schema 文件。原有 ntfy 订阅继续工作，不会自动删除。

开发和隔离测试可以用 `NOTY_DATABASE_PATH` 指定数据库文件。Noty 和发送命令必须使用相同路径。
