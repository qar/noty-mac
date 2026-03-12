# Noty-Mac

macOS 菜单栏应用，用于显示 ntfy.sh 的通知。

## 功能特性

- ✅ 在 macOS 菜单栏显示托盘图标
- ✅ 订阅 ntfy.sh 频道并实时接收通知
- ✅ 管理订阅频道（添加/删除）
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
3. 在"添加频道"区域输入频道名称和地址
   - 频道地址可以是完整 URL（如 `https://ntfy.sh/my-topic`）
   - 或者只输入频道名（如 `my-topic`，会自动添加 `https://ntfy.sh/` 前缀）
4. 点击"添加频道"按钮
5. 当有新通知时，会显示系统通知，托盘图标会显示未读数量
6. 点击托盘图标查看通知列表
7. 点击通知项可标记为已读

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
│   │   ├── app.js         # 通知列表逻辑
│   │   ├── settings.js    # 设置页面逻辑
│   │   └── styles.css     # 样式
│   └── preload.js         # IPC 预加载脚本
├── assets/                # 资源文件
│   ├── icon.png           # 托盘图标
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
- 通知历史（最多 1000 条）
- 用户偏好设置（声音、隐藏已读等）

## 开发

```bash
# 开发模式（带日志）
npm run dev
```

## License

MIT
