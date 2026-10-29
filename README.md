# Noty-Mac

macOS 菜单栏应用，用于显示 ntfy.sh 的通知。

## 功能特性

- ✅ 在 macOS 菜单栏显示托盘图标
- ✅ 订阅 ntfy.sh 频道并实时接收通知
- ✅ 新建通知，区分 Tmux 内的 AI agent 和 RtiTek Plane 通知
- ✅ Plane 提醒逐条保存，点击跳转后自动收起到历史
- ✅ 查看通知历史列表
- ✅ 支持手动收起提醒和从历史恢复
- ✅ 主窗口显示实时提醒，可缩为侧边窄窗并选择置顶
- ✅ Plane 按任务、Tmux 按 pane 分组，默认显示最新消息，较早消息可展开
- ✅ 新通知的系统通知和声音提示
- ✅ 托盘图标显示待看提醒组数

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
7. 点击应用内标题打开任务或跳转 tmux，成功后本次显示的同组提醒自动收起到「历史」；失败时仍保留。也可手动收起或从历史恢复，无需分别确认已读和已处理。批量收起全部提醒需要二次确认，确认期间的新消息仍保留
8. Plane 评论直接显示正文前 200 个字符，其他 Plane 事件显示摘要；所有 Plane 通知的完整原文都默认折叠，可展开查看。Tmux 通知直接展示原文。较大的 Plane JSON 从 ntfy 附件完整读取并保存，失败时可重试
9. 主窗口左侧的铃铛入口显示「提醒」，也可从托盘列表点击「在主窗口查看」。窗口失焦后仍保持显示；拖动到桌面一侧并调整宽度即可持续查看新消息，图钉按钮可切换置顶。提醒视图会记住自己的尺寸和位置，切换其他视图后再返回会恢复；两个窗口的收起与恢复状态实时同步
10. 同一来源的 Plane 消息按任务 ID 分组，Tmux 消息按 pane 分组，列表和托盘按组计数。每组默认显示最新消息，展开「较早消息」可查看其他消息及原始 JSON；原始消息逐条保留

## 键盘操作

主窗口和托盘列表支持 Vimium 风格的键盘操作。窗口获得焦点后即可使用，无需安装浏览器插件。

| 按键 | 操作 |
| --- | --- |
| `f` | 为当前可见控件显示字母提示，输入字母即可操作；输入框获得焦点后可直接输入 |
| `Esc` | 退出字母提示；输入框内按下可退出输入；弹窗内沿用取消操作 |
| `j` / `k` | 聚焦下一条 / 上一条提醒、AI pane 或工作区；其他页面向下 / 向上滚动 |
| `Enter` | 打开聚焦的提醒；其他控件沿用原有确认行为 |
| `gg` / `Shift+g` | 定位第一条 / 最后一条；其他页面滚动到顶部 / 底部 |
| `d` / `u` | 向下 / 向上滚动半页 |
| `Tab` / `Shift+Tab` | 按原有顺序切换控件焦点 |

移动焦点不会收起提醒。打开成功后才沿用现有分组收起逻辑。批量收起仍需要二次确认。字母提示覆盖「较早消息」、原始 JSON、历史、设置及弹窗按钮。新消息或布局变化会取消已有提示，按 `f` 可重新显示。

输入框、中文输入法组合输入和带 `Cmd`、`Ctrl`、`Alt` 的快捷键保留原有行为。按键只在 Noty 窗口内生效。

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
│   │   ├── notifications.tsx # 提醒列表与历史记录
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
- AI 通知历史（最多 1000 条）与 Plane 提醒及历史记录（独立保留）
- 用户偏好设置（声音等）

## 开发

```bash
# 开发模式（带日志）
npm run dev

# 键盘交互回归测试（首次运行前安装 Chromium）
npx playwright install chromium
npm run test:keyboard

# 使用应用自带的 Electron 运行同一组键盘测试
NOTY_KEYBOARD_ELECTRON=1 npm run test:keyboard
```

## License

MIT
