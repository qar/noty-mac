# Workspace 功能 · 需求文档（v1，已定稿）

> **状态**：v1 定稿 · 2026-07-03
> **实现范围**：阶段一 MVP。详情见 §0.5 定稿决策速览。
> **红线约束**：见 §0.5 与 §11 —— 不得破坏用户已有 tmux session / git worktree 等外部状态，任何写操作必须显式且可回退。
> 原始 Q&A 决策脉络（Q1–Q13）保留在 §6，供未来 archaeology；不再作为待决策项。
> 后续如需调整需求，请在此文档基础上升版本（v2），并在 PR 描述中说明变更。

---

## 0. 一句话总结

给 Noty 增加**桌面主窗口**和**工作区（Workspace）**两个新概念。
第一阶段：主窗口作为工作区列表的容器，工作区由 tmux session 一键同步生成，点击工作区跳转到对应 tmux session。

---

## 0.5 定稿决策速览

**Q1–Q13 决策一览**（原始讨论保留在 §6）：

| Q   | 主题             | 决策                                                                                        |
| --- | ---------------- | ------------------------------------------------------------------------------------------- |
| Q1  | Dock 图标        | **常驻显示**（形态升级为标准桌面应用，移除 `LSUIElement`）                                  |
| Q2  | 全局快捷键       | 阶段一不做                                                                                  |
| Q3  | tray 菜单形态    | `打开通知面板 / 打开主界面 / — / 同步 tmux 到工作区 / — / 设置 / 退出`                      |
| Q4  | macOS 顶部菜单栏 | 用 Electron 默认菜单                                                                        |
| Q5  | tmux 不可用时    | **菜单项灰掉 + tooltip**（需维护 tmux 可用性状态）                                          |
| Q6  | 同步完成反馈     | **系统通知**（`新增 N，跳过 M`；N=0 也发）                                                  |
| Q7  | 跳转默认 pane    | 只 `switch-client -t {session}`，让 tmux 停在上次位置                                       |
| Q8  | 卡片右键菜单     | 跳转 / 在 Finder 中打开 / 重命名 / 删除工作区 / 复制 tmux session name                      |
| Q9  | tmux session 消失 | 卡片显示"离线"灰色标签，点击时弹提示"是否创建同名 session"                                  |
| Q10 | 数据模型         | 阶段一仅新增 `lastActiveAt`（用于排序）；`color / icon / description / pinned` 延后到阶段二 |
| Q11 | 列表呈现         | 网格卡片（每行 3–4 张，卡片约 200×120）                                                     |
| Q12 | 目录初始文件     | **`workspace.json` 元数据文件**（跨设备迁移友好；electron-store 为权威副本）                |
| Q13 | 主窗口尺寸       | **初始 1120×720，最小 880×560**，可 resize，无最大限制                                      |

**与初始推荐不同的选择**（重点强调，避免实现时按推荐值错做）：

- Q1（Dock 常驻）、Q5（菜单灰化）、Q6（系统通知）、Q12（`workspace.json`）—— 均改动了默认推荐，实现时以本速览表为准。

**红线约束（硬性禁止，见 §11）**：

- ❌ 禁止对 tmux 的破坏性操作（`kill-session` / `kill-server` / 杀 pane / 强制 detach 已在使用的 client）。
- ❌ 禁止删除、移动、修改任何 git worktree（无论是否与 workspace 关联）。
- ❌ 禁止删除、移动用户本地未受 Noty 管理的文件。
- ✅ 允许：`new-session -d` 创建**新** session（Q9 场景，需用户显式确认）、创建/删除 workspace 自己的目录（`~/Library/Application Support/noty-mac/workspaces/<uuid>/`）。
- 涉及删除 workspace 时，默认**只删元数据、保留目录**；删除目录必须二次确认。

---

## 1. 背景与产品定位演进

Noty 目前是一个**菜单栏（tray）应用**，只做通知聚合 + tmux 跳转，产品形态偏"配件"。
这次要把它演进成**桌面应用（desktop app）+ 菜单栏常驻**的组合：

- **菜单栏 Popover**：保留原有形态，仍是通知快看/快跳的低摩擦入口。
- **主窗口（Main Window）**：新增。作为长时间停留、承载"工作区管理 / 未来的文档 / PR 视图"等重信息的画布。
- **设置窗口**：保留独立，不合并进主窗口（避免主窗口页面爆炸）。

产品心智升级：从"通知收件箱"变成**"以工作区为组织单位的开发者上下文中心"**。
通知只是工作区的一种输入源，未来还会汇聚 git worktree、tmux、GitHub PR、任务文档。

---

## 2. 名词与概念

| 名词                      | 定义                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace（工作区）**   | 用户手动或自动创建的一个"工作上下文"单元。承担认知隔离（"我在做 A 而不是 B"）和文件隔离（每个工作区一个独立目录，用于存文档、配置、附件等）。                                          |
| **主窗口 / Main Window**  | 标准 macOS 应用窗口，可 resize、有交通灯、有 Dock 图标（可选，见 Q1）。第一阶段内容 = 工作区列表。                                                                                     |
| **Popover**               | 现有 tray 面板，通知列表继续在这里。                                                                                                                                                   |
| **同步 tmux → workspace** | 一个幂等操作：读取本地 `tmux list-sessions`，为**尚未有对应工作区**的 session 创建新工作区；已存在的跳过；已消失的 session 对应的工作区**默认保留**（用户可能只是临时 kill 了 tmux）。 |

---

## 3. 用户旅程（阶段一）

1. 用户在 tray 菜单点"打开主界面" → 主窗口出现（首次是空态，引导做同步）。
2. 用户回到 tray 菜单点"同步 tmux session 到工作区" → 本地每个 tmux session 在主窗口里出现一个工作区卡片。
3. 用户在主窗口点某个工作区卡片 → 复用现有 tmux 跳转能力，切换到对应 session（默认第一个 window 的第一个 pane，见 Q7）。
4. 用户关闭主窗口 → 应用继续常驻 tray，不退出。

---

## 4. 功能范围（阶段一，MUST）

### 4.1 主窗口

- 入口：**tray 右键菜单新增一项"打开主界面"**，放在"打开（通知）"下方、"设置"上方。
- 标准 `BrowserWindow`，非 frameless，标题"Noty"。
- 尺寸：初始 960×640，最小 720×480，最大不限；可 resize，可最小化，可全屏。
- 关闭窗口 = 隐藏窗口（不销毁），下次打开秒开、状态不丢。
- 应用继续以 tray 为主体存在，不因主窗口关闭而退出。

### 4.2 工作区数据模型（草案，见 Q10 讨论具体字段）

```ts
type Workspace = {
  id: string; // uuid v4
  name: string; // 显示名，初次同步 = tmux session name
  tmuxSessionName: string | null; // 关联的 tmux session；断链可为 null
  directory: string; // 独立文件目录的绝对路径，见 §4.4
  createdAt: number; // epoch ms
  updatedAt: number;
  source: "tmux-sync" | "manual"; // 来源，为未来"手动创建"预留
};
```

存储位置：`electron-store` 里新增 `workspaces` 数组字段（与 notifications、channels 并列）。

### 4.3 "同步 tmux session 到工作区" 操作

- 入口：**tray 右键菜单新增一项**，位置在"打开主界面"下方、分隔线之前。
- 语义（幂等）：
  1. 执行 `tmux list-sessions -F '#S'` 拿到所有 session name。
  2. 与现有 `workspaces` 按 `tmuxSessionName` 匹配。
  3. **新 session** → 创建新 workspace，`name = tmuxSessionName`，`source = 'tmux-sync'`。
  4. **已存在的 workspace** → 跳过，不修改 name（保护用户改名），只更新 `updatedAt`。
  5. **workspace 对应的 tmux session 已消失** → 默认保留 workspace，`tmuxSessionName` 保持不变（**不置空**），UI 上标记为"离线/未运行"（见 Q9）。
- 同步完成后：
  - 主窗口若打开则实时刷新。
  - 通过系统通知或 tray 短暂提示"新增 N 个工作区"（见 Q6）。
- 无 tmux 时：菜单项禁用 or 点击后弹提示（见 Q5）。

### 4.4 工作区目录

- 根目录：`~/Library/Application Support/noty-mac/workspaces/<workspace-id>/`。
  - 用 uuid 而不是 name 作为目录名，避免改名/重名冲突。
- 同步时**自动创建空目录**（`mkdir -p`），第一阶段目录里什么都不放。
- 主窗口的工作区卡片右键菜单提供"在 Finder 中打开"（见 Q8）。

### 4.5 点击工作区 = 跳转 tmux

- 复用 `src/main/index.js` 的 `focusTmux` / `execTmux` 能力。
- target 构造：`{tmuxSessionName}` 或 `{tmuxSessionName}:@1.@1`（见 Q7）。
- 若 session 已消失：跳转失败 → 提示用户，可选"重新同步"或"忘记该工作区"（见 Q9）。

### 4.6 主窗口 UI（骨架，具体规范补进 design.md）

- **左侧 Sidebar**（240px 固定）：占位，第一阶段只放应用 Logo + 主导航"工作区"一项，为二阶段留位置。
- **主内容区**：工作区列表（网格卡片，见 Q11）+ 顶部一个 toolbar（含"同步 tmux"按钮，冗余提供入口）。
- **空态**：一句引导文案 + 一枚"同步 tmux"按钮，居中，遵守 design.md §6.6。

---

## 5. 阶段一**不做**（NON-GOALS，避免范围蔓延）

- ❌ 手动创建工作区（阶段二）。
- ❌ 工作区详情页（阶段二，会有 sidebar/main-content 双栏）。
- ❌ 工作区关联 git worktree / PR / 文档的 UI（阶段二/三）。
- ❌ 主窗口内的通知视图（通知继续留在 Popover）。
- ❌ 工作区拖拽排序、分组、标签（阶段二）。
- ❌ 工作区搜索/过滤（阶段二，如果列表长再做）。
- ❌ 工作区之间的"当前激活态"概念（阶段二讨论是否需要）。
- ❌ 云端同步、跨设备（不做）。

---

## 6. 待你 CONFIRM / DECIDE 的开放问题

**Q1. Dock 图标是否显示？**

- (a) 默认隐藏（保持 `LSUIElement=true`），只有主窗口打开时临时显示 Dock 图标；关闭主窗口后自动隐藏。**← 推荐**
- (b) 只要 app 运行就一直显示 Dock 图标（更像"桌面应用"）。
- (c) 完全不显示 Dock 图标，永远只从 tray 进入。
- A: b

**Q2. 主窗口打开入口是否需要全局快捷键？** 例如 `⌘⇧N`。

- (a) 阶段一不做，只从 tray 菜单进入。**← 推荐**
- (b) 做，快捷键 =
- A: a

**Q3. tray 菜单的最终形态？** 建议如下，请确认或调整：

```
打开通知面板     ← 原"打开"
打开主界面       ← 新增
─────────
同步 tmux 到工作区   ← 新增
─────────
设置
退出
```

- A: 确认

**Q4. 主窗口是否需要 macOS 顶部菜单栏（File / Edit / View / Window / Help）？**

- (a) 阶段一先用 Electron 默认菜单，够用即可。**← 推荐**
- (b) 完全自定义。
- (c) 不要顶部菜单栏。
- A: a

**Q5. tmux 未安装/不可用时的行为？**

- (a) 菜单项灰掉 + tooltip 说明。
- (b) 菜单项可点，点击后弹系统通知"未检测到 tmux"。**← 推荐（与现有跳转逻辑一致）**
- A: a

**Q6. 同步完成后如何反馈？**

- (a) 系统通知："新增 N 个工作区、跳过 M 个"。
- (b) 主窗口内 toast/横幅提示。**← 推荐（若主窗口已打开）**
- (c) (a) + (b) 组合。
- A: a

**Q7. 跳转 tmux 时的默认 pane？**

- (a) 只 `switch-client -t {session}`，不指定 window/pane，让 tmux 停在 session 上次的位置。**← 推荐**
- (b) 强制跳到第一个 window 的第一个 pane。
- (c) 记住每个 workspace 上次的 window.pane。
- A: a

**Q8. 工作区卡片的右键菜单**该包含哪些项？建议：

- 跳转到 tmux（= 单击行为）
- 在 Finder 中打开工作区目录
- 重命名
- 删除工作区（会问：是否同时删除本地目录？）
- 复制 tmux session name
- A: 可以

**Q9. tmux session 消失后，工作区 UI 如何表达？**

- (a) 卡片显示"离线"灰色标签，点击时弹提示"session 已不存在，是否创建同名 session？"。**← 推荐**
- (b) 直接从列表隐藏。
- (c) 不区分，点击时才提示失败。
- A: a

**Q10. 数据模型是否要再加字段？** 我目前设计的是 `{id, name, tmuxSessionName, directory, createdAt, updatedAt, source}`。
候选新增：

- `color` / `icon`（视觉区分，阶段二再加？）
- `description` / `notes`（用户备注）
- `lastActiveAt`（最后一次跳转/打开的时间，用于排序）
- `pinned`（置顶）
- A: 同意

**Q11. 工作区列表的呈现方式？**

- (a) 网格卡片（每行 3-4 张，每卡 ~200×120）。**← 推荐（视觉呼吸感 + 未来能放缩略信息）**
- (b) 单列列表（信息密度高，扫读快）。
- (c) 用户可切换。
- A: a

**Q12. 工作区目录内的初始文件？**

- (a) 空目录，什么都不放。**← 推荐**
- (b) 放一个 `README.md` 占位。
- (c) 放一个 `workspace.json` 元数据文件（把 name/description 等冗余写一份，方便未来跨设备迁移）。
- A: c

**Q13. 主窗口的初始尺寸 960×640 是否合适？**

- A: 大一点

---

## 7. 技术实现范围提示（不写代码，只给锚点）

- **主进程新增**：
  - `src/main/window.js` 里加 `openMainWindow()`，或新建 `main-window.js`。
  - `src/main/workspace.js`（新文件），承载：list / syncFromTmux / getDirectory / remove / rename。
  - `src/main/store.js` schema 里加 `workspaces: []`。
  - `src/main/index.js` tray 菜单增加两个 item + IPC handler。
- **渲染进程新增**：
  - `src/renderer/main.html` + `src/renderer/main.js` + 复用 `styles.css`。
- **复用**：
  - tmux 跳转直接调 `focusTmux` handler（IPC 已有 `ntfy:jumpTmux` 之类，见 index.js）；新增一个更纯的 `workspace:jump` IPC，target 是 session name。
- **preload**：
  - 暴露 `workspace.list()` / `workspace.syncFromTmux()` / `workspace.jump(id)` / `workspace.openInFinder(id)`。

---

## 8. design.md 扩展建议（**强烈建议阶段一同步做**）

现在的 design.md 是围绕 **380×540 的 Popover** 写的，很多规则不能直接照搬到 **960×640 的可 resize 主窗口**。为了避免主窗口出来后规范失效，建议这次增补以下章节（每一项都是 design.md 的**新章节或既有章节的补充**）：

### 8.1 §3.2 字号阶梯 —— 新增一档 Page Title

- 目前顶格是 `--fs-headline` 17px（用于 Popover header）。桌面主窗口的页面主标题（如"工作区"）需要 20-22px 才立得住。
- **建议新增**：`--fs-page-title: 22px / 600 / 1.25`，仅用于主窗口的页面级标题。

### 8.2 §4 间距 —— 新增"密度"变量

- Popover 是"紧凑密度"（padding 12/16），主窗口是"常规密度"（padding 20/24）。
- **建议新增**：`--space-page-x: 24px`（主窗口 content 左右内边距）、`--space-page-y: 20px`（上下）。
- 组件规范里补注：紧凑场景用小 padding，桌面场景用大 padding。

### 8.3 §7 布局 —— 新增"主窗口结构"章节

- 主窗口的骨架：**TitleBar（macOS 交通灯）+ Sidebar（左，可折叠？）+ Content**。
- 与 Popover 的三段式（Header/Content/Footer）并列，作为第二种窗口模板。
- Sidebar 宽度、折叠行为、Content 最大宽度（比如中央限宽 1200px？）都要写明。
- macOS 交通灯样式选择：标准 title bar vs `hiddenInset` vs 全隐藏 —— **推荐 `hiddenInset`**（交通灯浮在内容上，视觉更"应用感"），需要在规范里明确。

### 8.4 §5.1 圆角 —— 新增卡片圆角

- 工作区卡片可能需要 `--radius-lg: 12px` 以外的一档，比如 `--radius-card: 10px`；或者复用现有档次并明确"卡片用 md=8px"。
- 决策后写进规范，避免每次凭感觉。

### 8.5 §6 组件 —— 新增两个组件规范

- **Sidebar / NavItem**：宽度、选中态、hover 态、图标 + 文字对齐、分组标题。
- **Card（工作区卡片是首个用例）**：尺寸、内部信息层级、hover 态、右键菜单触发、离线态样式。
- 明确"卡片默认无阴影"依然适用于桌面场景（否则主窗口容易被人加上装饰阴影）。

### 8.6 §6.6 空状态 —— 桌面场景补充规则

- Popover 里禁 emoji、禁大插画，主窗口里也**依然禁**，但可以稍微放宽：允许 1 个 SF Symbol 图标 + 一句引导 + 1 个 Primary 按钮，垂直居中在 content 里。
- 明确禁止：营销式插画、大段文案、多层按钮。

### 8.7 §7.1 窗口尺寸表 —— 追加主窗口一行

```
主窗口   960×640 (初始) / 720×480 (min) / 可 resize
```

### 8.8 §10 深色模式 —— 主窗口标题栏

- macOS `hiddenInset` 模式下，标题栏背景需要跟随 content 或独立处理。
- 深色模式下交通灯自动 invert，不需要额外处理，但需要说明"不要给 title bar 单独加背景色"。

### 8.9 §9 图标 —— Sidebar 图标规格

- 主窗口 Sidebar 的图标尺寸建议 18px（介于当前 header 16 和 page 20 之间），需要在规范里定档。

### 8.10 新增 §16 —— 密度 / 场景（可选）

- 用一节明确"Popover / 主窗口 / 设置窗口"三种场景下的密度差异表格，让所有组件在两种密度下都能查到自己的规格。

**建议流程**：这份草稿定稿后，先扩展 design.md（单独一个 commit），再开始实现主窗口/工作区代码。

---

## 9. 阶段二 / 三预留（不做，只是提醒设计时留位置）

- 工作区详情页：sidebar（工作区列表）+ main（详情），详情里 tab 切换 Overview / Docs / PRs / Worktrees。
- 工作区手动创建、编辑、图标/颜色自定义。
- 每个工作区可挂载 git worktree 路径，主窗口内可打开终端/编辑器。
- 每个工作区订阅特定的 ntfy 频道 → 通知只落到对应工作区。
- 工作区级别的"专注模式"：其他工作区的通知折叠。
- 工作区之间的切换快捷键。

---

## 10. Review 提示

- 请直接在每个 Q 下面写 A（"A: (a)" 或"A: 采纳，但改成 xxx"）。
- §8 design.md 扩展建议整体是否 OK？如果只做部分，请勾选要做的项。
- §5 NON-GOALS 里有没有你其实想放进阶段一的？
- §4.2 数据模型字段是否需要增删？
- 有没有我漏掉的关键场景？

## 11. 红线约束（硬性禁止 · 与 §0.5 呼应）

以下红线在阶段一、阶段二、阶段三**永久生效**，任何 PR 违反都要退回：

**硬性禁止（对用户系统的写操作）**：

- ❌ **绝对不可** kill 已存在的 tmux session（`kill-session` / `kill-server`）。
- ❌ **绝对不可** kill 已存在的 tmux window / pane。
- ❌ **绝对不可** 强制 detach 用户当前正在使用的 tmux client。
- ❌ **绝对不可** 删除、移动、重命名任何 git worktree（不管这个 worktree 是否被某个 workspace 引用）。
- ❌ **绝对不可** 删除、移动用户本地未受 Noty 管理的文件或目录。
- ❌ **绝对不可** 修改用户的 shell 配置（`.zshrc` / `.bashrc` / `.tmux.conf`）。

**允许（在用户显式确认下）**：

- ✅ `tmux new-session -d -s <name>`：为"离线工作区"创建同名 session（Q9），必须先弹确认框。
- ✅ 创建 workspace 自己的目录：`~/Library/Application Support/noty-mac/workspaces/<uuid>/`。
- ✅ 删除 workspace 自己的目录：**必须二次确认**，且默认只删元数据、保留目录。
- ✅ 读取 `tmux list-sessions` 等只读命令。

**代码层守则**：

- 所有涉及 `execTmux` 的写命令（`new-session` / `kill-*` / `detach` / `rename-session` 等）都要在代码 review 时明确讨论；`kill-*` / `detach` 不进主分支。
- 涉及文件系统写操作的代码路径必须白名单化（只允许写 workspace 目录、日志目录）。
