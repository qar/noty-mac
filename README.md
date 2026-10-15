# Noty-Mac

macOS 菜单栏应用，用于显示 ntfy.sh 的通知。

## 功能特性

- ✅ 在 macOS 菜单栏显示托盘图标
- ✅ 订阅 ntfy.sh 频道并实时接收通知
- ✅ 新建通知，区分 Tmux 内的 AI agent 和 RtiTek Plane 通知
- ✅ Plane 事件逐条持久化，点击打开任务，支持手动完成与恢复
- ✅ 查看通知历史列表
- ✅ 标记已读并隐藏已读通知
- ✅ 新通知的系统通知和声音提示
- ✅ 托盘图标显示未读通知数量

## 安装

```bash
npm install
```

## 运行

```bash
npm start
```

## 使用方法

1. 启动应用后，点击菜单栏的托盘图标
2. 点击"设置"按钮
3. 在「通知 > 新建通知」选择通知类型，输入名称和 ntfy 频道地址
   - 频道地址可以是完整 URL（如 `https://ntfy.sh/my-topic`）
   - 或者只输入频道名（如 `my-topic`，会自动添加 `https://ntfy.sh/` 前缀）
4. 点击「新建通知」；Plane 类型还需填写 Plane 网站地址，详见 [Plane 接入说明](docs/plane-notifications.md)
5. 当有新通知时，会显示系统通知，托盘图标会显示未读数量
6. 点击托盘图标查看通知列表；点击系统通知会打开 Noty 并定位该条消息
7. 点击应用内通知标题打开任务或跳转 tmux，点击独立的「标记已读」按钮确认已读；Plane 待办通过勾选按钮标记已处理
8. 通知正文直接展示原文；JSON 格式化展开，支持选中复制；较大的 Plane JSON 从 ntfy 附件完整读取并保存，失败时可重试

## 项目结构

```
noty-mac/
├── src/
│   ├── main/              # 主进程
│   │   ├── index.js       # 应用入口
│   │   ├── store.js       # 数据存储
│   │   ├── ntfy-client.js # ntfy.sh 客户端
│   │   └── window.js      # 窗口管理
│   ├── renderer/          # 渲染进程
│   │   ├── index.html     # 通知列表
│   │   ├── settings.html  # 设置页面
│   │   ├── notifications.tsx # 通知列表与 Plane 待处理堆栈
│   │   ├── settings.js    # 设置页面逻辑
│   │   └── styles.css     # 样式
│   └── preload.js         # IPC 预加载脚本
├── assets/                # 资源文件
│   ├── icon.png           # 应用图标
│   ├── tray-template.png  # 菜单栏模板图标
│   └── icon-unread.png    # 未读状态图标
└── package.json
```

## 技术栈

- Electron - 桌面应用框架
- electron-store - 配置持久化
- ntfy.sh - 通知服务（使用 SSE 订阅）

## 配置存储

配置文件存储在：
- macOS: `~/Library/Application Support/noty-mac/config.json`

存储内容包括：
- 订阅的频道列表
- AI 通知历史（最多 1000 条）与 Plane 待处理/已处理记录（独立保留）
- 用户偏好设置（声音、隐藏已读等）

## 开发

```bash
# 开发模式（带日志）
npm run dev
```

## License

MIT
