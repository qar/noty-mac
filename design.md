# Noty · UI 设计规范

> 本文档是 Noty 产品所有 UI 决策的**唯一事实源（Single Source of Truth）**。
> 新增/修改任何界面前，先读这份文档；文档没覆盖的场景，先补充规范再动手写样式。
> 违反规范的代码在 Review 中一律要求返工，不接受"看起来也还行"这种论证。

## Workflow Surfaces

- 工作流采用“定义/执行列表 + 详情”布局，不使用营销式卡片或装饰性流程图。
- 阶段是全宽分组，任务使用稳定高度的行；串行/并行模式使用选择控件。
- 任务状态只使用现有 accent、success、danger 和 neutral token。阻塞状态不增加新颜色。
- 自动任务解锁后仅显示可执行状态，必须由用户明确启动；运行、停止、重试和跳过操作不得改变任务行的主尺寸。

---

## 0. 一句话总结

**克制、锋利、贴近 macOS 原生。信息优先，装饰归零。**

Noty 是一个常驻菜单栏的通知聚合器，用户单次停留时间极短（多数不超过 3 秒）。
任何拖慢扫读、增加视觉噪音、让空间"看起来漂亮但不承载信息"的设计，都不允许出现。

---

## 1. 设计原则（不可违背）

| # | 原则 | 含义 | 反面例子 |
|---|------|------|----------|
| P1 | **信息 > 装饰** | 每一个像素都要为信息服务 | 分隔线、背景色、图标只为"好看"存在 |
| P2 | **少即是多** | 能删就删，能合并就合并 | 一屏塞五个次要 CTA、多层卡片嵌套 |
| P3 | **贴近系统** | 视觉语言跟随 macOS，不发明新语言 | 自造深色主题、自造强调色、自造字体阶梯 |
| P4 | **一致性 > 新颖性** | 同一场景永远用同一控件、同一间距 | 三个页面三种按钮圆角 |
| P5 | **响应默认** | 完整支持深色模式、支持系统降噪偏好 | 只有浅色一套皮肤 |
| P6 | **克制强调** | 全局至多一个"最高强调"，其余降级 | 满屏都是蓝色主按钮 |
| P7 | **动效为反馈服务** | 动效解释状态变化，不做"演出" | 弹跳、旋转、悬浮特效 |

---

## 2. 色彩系统（Color）

### 2.1 三色原则

全站配色**至多三类**，超出必须先修改本节：

1. **Neutral（中性色阶）** —— 承担 ~90% 的界面：文字、背景、边框、分隔线。灰阶体系视为一类。
2. **Accent（品牌强调色）** —— 唯一的"高亮意图"色，用于主 CTA、选中态、焦点态、未读徽章。
3. **Semantic（语义状态色）** —— 只用于"状态告知"，禁止用于装饰。仅两个语义：`success`、`danger`。

**没有第四类。** 想加"温馨提示黄"、"次要蓝"、"品牌紫"，先删掉一个现有色。

### 2.2 具体色值（Design Tokens）

以 CSS 自定义属性形式定义，所有组件必须消费 token，禁止硬编码色值。

```css
:root {
  /* Neutral · 浅色模式 */
  --color-bg-base:        rgba(255, 255, 255, 0.72);  /* 毛玻璃底 */
  --color-bg-elevated:    #FFFFFF;                     /* 卡片、输入框 */
  --color-bg-subtle:      rgba(0, 0, 0, 0.03);        /* 分组背景、hover */
  --color-border:         rgba(0, 0, 0, 0.08);
  --color-border-strong:  rgba(0, 0, 0, 0.14);
  --color-divider:        rgba(0, 0, 0, 0.06);

  --color-text-primary:   #1D1D1F;   /* 标题、正文 */
  --color-text-secondary: #6E6E73;   /* 次要说明 */
  --color-text-tertiary:  #A1A1A6;   /* 时间戳、占位 */
  --color-text-inverse:   #FFFFFF;

  /* Accent · 单一强调色 —— 直接对齐 macOS System Blue */
  --color-accent:         #0A84FF;
  --color-accent-hover:   #0071E3;
  --color-accent-pressed: #0058B8;
  --color-accent-subtle:  rgba(10, 132, 255, 0.10);   /* 强调色的浅底 */

  /* Semantic · 仅两枚 */
  --color-success:        #30D158;
  --color-danger:         #FF453A;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg-base:        rgba(28, 28, 30, 0.72);
    --color-bg-elevated:    #1C1C1E;
    --color-bg-subtle:      rgba(255, 255, 255, 0.06);
    --color-border:         rgba(255, 255, 255, 0.10);
    --color-border-strong:  rgba(255, 255, 255, 0.18);
    --color-divider:        rgba(255, 255, 255, 0.08);

    --color-text-primary:   #F5F5F7;
    --color-text-secondary: #A1A1A6;
    --color-text-tertiary:  #6E6E73;

    --color-accent:         #0A84FF;
    --color-accent-hover:   #409CFF;
    --color-accent-pressed: #0071E3;
    --color-accent-subtle:  rgba(10, 132, 255, 0.16);

    --color-success:        #32D74B;
    --color-danger:         #FF453A;
  }
}
```

### 2.3 使用约束

- 主按钮 = Accent；次按钮 = Neutral 描边或幽灵按钮；**同屏至多一枚主按钮**。
- 删除类操作 = `--color-danger`；成功/开关"开"态 = `--color-success`；**其余场景禁用语义色**。
- 禁止使用彩色渐变、彩色阴影、彩色描边作为装饰。
- 禁止在文字上直接使用 Accent 色（除非它就是链接/操作触发点）。

---

## 3. 排版（Typography）

### 3.1 字体族

```css
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
             "PingFang SC", "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
```

**只用系统字体。** 不引入 Web Font，不引入图标字体（用 SVG）。

### 3.2 字号阶梯（通用 6 级 + 主窗口专用 1 级）

| Token | 大小 | 行高 | 字重 | 用途 | 场景 |
|---|---|---|---|---|---|
| `--fs-caption`    | 11px | 1.4  | 500 | 时间戳、徽章、辅助元数据 | 全部 |
| `--fs-small`      | 12px | 1.5  | 400 | 次要说明、频道路径 | 全部 |
| `--fs-body`       | 13px | 1.5  | 400 | 通知正文、表单值 | 全部 |
| `--fs-label`      | 13px | 500  | 500 | 表单标签、设置项 | 全部 |
| `--fs-title`      | 15px | 1.4  | 600 | 分组标题、通知标题、卡片标题 | 全部 |
| `--fs-headline`   | 17px | 1.3  | 600 | Popover / 设置窗顶部标题 | Popover / Settings |
| `--fs-page-title` | 22px | 1.25 | 600 | 主窗口页面级主标题（如"工作区"）| Main Window 独占 |

- 通用 6 级适用于全部场景；`--fs-page-title` **只允许**用于主窗口的页面标题，Popover 一律使用 `--fs-headline`。
- **禁止**中间插入 14 / 16 / 18 / 20px 等未定义档次的字号。
- 字重只允许 400 / 500 / 600 三档，禁止 700 及以上。
- 中文与英文行高一致，不因语言切换调整。

### 3.3 排版细节

- 段落最长宽度 ≤ 60 中文字符 / 72 拉丁字符。
- 通知正文默认 **2 行截断 + ellipsis**，点击展开。
- 时间戳一律使用相对时间（"3 分钟前"、"昨天 14:32"），悬停显示绝对时间。
- 数字使用等宽变体（`font-variant-numeric: tabular-nums`）用于对齐。

---

## 4. 间距与网格（Spacing）

采用 **4px 基础网格**（Google Stitch 与 Apple HIG 一致的做法）。

```css
/* 基础网格 · 全场景通用 */
--space-0:  0;
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;

/* 主窗口 · 页面级密度（仅 Main Window 使用） */
--space-page-x:   24px;  /* content 左右内边距 */
--space-page-y:   20px;  /* content 上下内边距 */
--space-page-gap: 20px;  /* 主内容区块之间的垂直间距 */
```

### 4.1 使用约束

- 组件内部间距（padding）只从 `--space-2/3/4` 中选。
- 组件之间的垂直间距（gap）只从 `--space-2/3/4/6` 中选。
- 分组之间的大间距用 `--space-6` 或 `--space-8`，**禁止用 `margin: 30px` 之类的自造值**。
- **主窗口**的 content 层左右使用 `--space-page-x`、上下使用 `--space-page-y`；**Popover / 设置窗** 保持紧凑，不使用 `--space-page-*`。
- **反对"呼吸感"叙事下的空间浪费**：任何单块留白 > 40px 都要在 PR 描述里说明为什么。

### 4.2 触控/点击目标

- 图标按钮最小可点击区域 **28×28px**（视觉可以更小，热区补足）。
- 文本按钮内边距至少 `--space-2 --space-3`。
- 相邻可点击目标之间至少留 4px 空隙。

---

## 5. 圆角、描边、阴影、模糊

### 5.1 圆角（Radius）

```css
--radius-sm: 6px;   /* 输入框、小按钮、徽章 */
--radius-md: 8px;   /* 卡片（含工作区卡片）、通知项、主按钮 */
--radius-lg: 12px;  /* 窗口容器、Popover、主窗口 */
--radius-pill: 999px; /* Toggle、圆形头像 */
```

**只有这四档。** 不出现 10px、14px 等中间值。
桌面主窗口的卡片场景（如工作区卡片）也统一使用 `--radius-md`，不新增"卡片专用"档。

### 5.2 描边

- 卡片/输入框默认描边 `1px solid var(--color-border)`。
- Focus 态描边 `1px solid var(--color-accent)` + `0 0 0 3px var(--color-accent-subtle)` outline，**不使用 box-shadow 模拟**。
- 危险操作 hover 时可切到 `--color-danger`。

### 5.3 阴影（极度克制）

只允许两档，用于表达"层级抬升"，不用于装饰：

```css
--shadow-window:  0 12px 40px rgba(0, 0, 0, 0.18);
--shadow-popover: 0 4px 16px  rgba(0, 0, 0, 0.10);
```

- 通知项、按钮、卡片**默认无阴影**。
- Hover 不加阴影，只调背景色。
- 深色模式下阴影透明度 × 1.5。

### 5.4 毛玻璃（Vibrancy）

窗口容器统一：

```css
background: var(--color-bg-base);
backdrop-filter: saturate(180%) blur(30px);
-webkit-backdrop-filter: saturate(180%) blur(30px);
```

**只有窗口最外层容器使用毛玻璃**，内部卡片/列表项不叠加第二层模糊。

---

## 6. 组件规范

### 6.1 按钮（Button）

三类，多一类都不允许：

| 类别 | 用途 | 视觉 |
|---|---|---|
| **Primary** | 页面唯一主操作（如"添加频道"）| Accent 填充 + 白字 |
| **Secondary** | 中性次操作（如"取消"、"关闭"）| Neutral 描边 + 主色文字 |
| **Ghost / IconButton** | 高频轻量操作（如全部已读、设置、关闭 X）| 无背景，hover 显示 `--color-bg-subtle` 底 |

- **每屏最多一个 Primary。** 出现两个及以上，重新审视信息架构。
- 高度：紧凑 28px / 常规 32px / 舒适 36px，三档任选一档并全站保持。
- 危险按钮不用红色填充，用红色文字 + 描边（避免视觉恐吓）。

### 6.2 通知项（NotificationItem）—— 产品核心

这是全应用停留时间最长的组件，规范最严格：

```
┌──────────────────────────────────────────────┐
│ [channel · 3m ago]                         · │  ← 元信息一行，右侧未读点
│ Title 一行截断..........................      │  ← --fs-title
│ Body 两行截断，第三行 ellipsis                  │  ← --fs-body / secondary
└──────────────────────────────────────────────┘
```

- 左右内边距 `--space-3`（12px），上下 `--space-3`。
- 通知项之间用 **1px divider**，不用间距、不用卡片阴影。
- 已读：整块透明度 0.55，不删减布局。
- 未读：右上角 6px 圆点 `--color-accent`，**不做红点、不做数字徽章**（数字徽章只出现在托盘图标上）。
- Hover：整块背景切 `--color-bg-subtle`，**不做位移、不做缩放**。
- Session Title / Type 标签等元信息，一律降级为 `--fs-caption` + `--color-text-secondary`，**禁止再上背景色徽章**。

### 6.3 表单

- Label 在输入框正上方，`--fs-label` + `--color-text-secondary`，间距 `--space-1`。
- Input 高度 32px，圆角 `--radius-sm`，聚焦按 §5.2 规则。
- 占位符文本使用 `--color-text-tertiary`；**禁止用占位符替代 Label**。
- 一个表单区块内的 field 垂直间距 `--space-3`。

### 6.4 开关 / Toggle

- 尺寸 40×24px，Thumb 20px，圆角 pill。
- 关：`--color-bg-subtle` 底；开：`--color-accent` 底（**不是绿色**，收敛到 Accent）。
- 只有"这个开关代表某种状态成功/警告"时才允许语义色，其他场景一律 Accent。

### 6.5 列表分组（Section）

- 分组标题：`--fs-title` + `--color-text-primary`，与内容间距 `--space-3`。
- 分组之间间距 `--space-6`。
- 分组内部若是纯设置项，用 divider 分隔；若是卡片式（如订阅频道），卡片间用 `--space-2` gap。

### 6.6 空状态（Empty State）

分两种密度：

- **紧凑（Popover / 设置窗）**：一行 `--fs-body` 文本 + 一个 Ghost / Secondary 按钮，居中；**不加图标**。高度不超过内容区 40%。
- **常规（主窗口）**：允许 1 个 SF Symbol 图标（32–40px，颜色 `--color-text-tertiary`） + 一句 `--fs-title` 引导文案 + 1 个 Primary 按钮，三行垂直居中。

**共同禁止**：营销式插画、多层按钮、大段说教文案、emoji 图标。

### 6.7 徽章（Badge）

- 只用于两种场景：托盘图标未读数（红色圆角矩形，系统 API 提供的样式）、通知列表未读点。
- **禁止**把"Type / Priority / Tag"做成彩色徽章列。信息用文字排版表达，不用色块堆砌。

### 6.8 代码块（Code Block）

出现在教程/日志中：

- 字体 `--font-mono`，字号 `--fs-small`。
- 深色底 `#1C1C1E`（深色模式）/ `#F5F5F7`（浅色模式），**不与主界面深色反差**。
- 圆角 `--radius-sm`，内边距 `--space-3`。
- 支持一键复制（右上角 Ghost IconButton）。

### 6.9 Sidebar / NavItem（主窗口专用）

主窗口左侧导航，承担应用主结构入口：

- **Sidebar 容器**：宽度 240px 固定（阶段一不折叠）；材质使用系统 sidebar vibrancy；顶部预留 44px 空白供 macOS 交通灯浮层；分组之间用 `--space-4` 垂直间距，不用 divider。
- **NavItem**：高度 36px，左右内边距 `--space-3`，圆角 `--radius-sm`，图标 18px（见 §9）+ `--space-2` gap + `--fs-body` 文字。
- **NavItem 状态**：
  - 默认：文字 `--color-text-secondary`，图标同色。
  - Hover：背景 `--color-bg-subtle`。
  - Active（选中）：背景 `--color-accent-subtle`，文字/图标 `--color-accent`。
  - Focus 键盘态：叠加 §5.2 focus 环，不替换背景。
- **分组标题**（如 "工作区"、"通知"）：`--fs-caption` + `--color-text-tertiary` + `text-transform: uppercase` + `letter-spacing: 0.04em`，位于 Sidebar 顶部而不是每组之上。
- **禁止**：Sidebar 内出现 Primary 按钮、彩色徽章、深层折叠树（超过 1 级嵌套）。

### 6.10 Card（工作区卡片是首个用例）

主窗口中承载"一组关联信息 + 一个主操作"的原子块：

- **尺寸**：宽度用网格 `repeat(auto-fill, minmax(220px, 1fr))` 自适应；固定高度 128px（不允许因内容伸缩）。
- **视觉**：底 `--color-bg-elevated`，1px 描边 `--color-border`，圆角 `--radius-md`；**默认无阴影**（§5.3 依然生效）。
- **内边距**：`--space-4`（16px）。
- **信息层级**：
  - 主标题：`--fs-title` + `--color-text-primary`，一行截断。
  - 副信息（如关联的 tmux session 名）：`--fs-small` + `--color-text-secondary`，一行截断。
  - 元信息（如最后活跃时间）：`--fs-caption` + `--color-text-tertiary`，置于卡片右下或左下。
- **交互**：
  - Hover：背景切 `--color-bg-subtle`；**禁止**位移、缩放、阴影加强。
  - 单击 = 卡片主操作（如"跳转到 tmux"）。
  - 右键 = 弹出 context menu，条目参见对应功能规范。
- **离线态**（如 tmux session 已消失）：整卡透明度 0.55，左上角加 `--fs-caption` 灰色标签"离线"；单击行为改为弹确认框，不静默失败。
- **禁止**：卡片内嵌 Primary 按钮、彩色徽章列、多层背景块、装饰性图标。

---

## 7. 布局与窗口

### 7.1 尺寸

| 窗口 | 宽度 | 高度 | 备注 |
|---|---|---|---|
| Tray Popover（通知列表）| 380px | 540px | 不允许用户拉伸 |
| 设置窗口 | 520px | 620px | 独立窗口，可关闭，不 resize |
| 主窗口（Main Window）| 1120px 初始 · 880px 最小 · 无最大 | 720px 初始 · 560px 最小 · 无最大 | 可 resize、可最小化、可全屏 |
| 系统通知 | 系统决定 | 系统决定 | 不自定义 |

- Popover 与 设置窗**不做响应式**，尺寸即产品的一部分。
- 主窗口在最小尺寸下必须保持功能可用：Sidebar 不折叠、卡片至少 2 列。
- **关闭主窗口 = 隐藏窗口**（不销毁），下次打开秒开、状态不丢；应用继续以 tray 常驻。

### 7.2 结构

所有窗口一律：

```
┌───────────────────┐
│ Header            │  48px 固定高度
├───────────────────┤
│                   │
│ Content (滚动)     │  flex: 1
│                   │
├───────────────────┤
│ Footer (可选)      │  48px，只在有全局 CTA 时出现
└───────────────────┘
```

- Header 只承担：标题（左）+ 少量图标操作（右）。**禁止在 Header 放搜索框、Tab、下拉菜单**（这些放到 Content 顶部）。
- Footer **可选**。没有全局 CTA 就不要 Footer。当前"清空已读"是次操作，放进 Header 图标按钮或长按菜单，不放 Footer。

### 7.3 滚动

- 滚动条使用 macOS 系统默认（`overflow: auto` + 系统 overlay 滚动条），**禁止自定义 6px 细滚动条**（当前 `styles.css` 里那段要移除）。
- 列表滚动到顶时不出现橡皮筋阴影；到底时不做"没有更多了"文案。

### 7.4 主窗口结构（Main Window Layout）

主窗口是与 Popover 并列的第二种窗口模板，用于长时间停留的信息汇聚（首个用例：工作区列表）。

骨架：

```
┌─────────────────────────────────────────────────────────┐
│ ●●●        │                                            │
│ (TrafficL) │   Content                                  │
│            │                                            │
│  Sidebar   │   ┌─ Page Title (--fs-page-title)          │
│  240px     │   ├─ Toolbar (可选, 40px)                  │
│            │   └─ Cards / List (最大宽度 1200px, 居中)  │
│  Nav Items │                                            │
│            │                                            │
└─────────────────────────────────────────────────────────┘
```

- **标题栏**：Electron `titleBarStyle: 'hiddenInset'`。交通灯浮在内容左上，不占独立高度。**不给标题栏加背景色、不加下边框**，让它随 Sidebar / Content 材质自然过渡。
- **Sidebar**：宽度 **240px 固定**（阶段一不做折叠、不做拖拽调宽）。材质使用系统 sidebar vibrancy（Electron `vibrancy: 'sidebar'` 或等价）。规格见 §6.9。
- **Content**：不透明底 `--color-bg-elevated`。左右内边距 `--space-page-x`（24px），上下 `--space-page-y`（20px）。**不使用毛玻璃**（§5.4 只允许最外层，主窗口的最外层是窗口本身而非 Content）。
- **Content 最大宽度**：主内容最大宽度 **1200px**，超过时居中留白，两侧不放次要内容。
- **Toolbar**（可选）：Page Title 下方固定 40px 高度的横向操作区，仅承担页面级 CTA（如"同步 tmux"）。
- **禁止**：主窗口引入 Tab、多层 Sidebar、Ribbon、悬浮 FAB、页面内弹出 Panel。

---

## 8. 交互与动效（Motion）

### 8.1 时长与曲线

```css
--motion-fast:   120ms;   /* hover / focus 反馈 */
--motion-base:   200ms;   /* 展开、收起、切换 */
--motion-slow:   320ms;   /* 窗口出现/消失 */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);       /* 大多数场景 */
--ease-emphasis: cubic-bezier(0.3, 0, 0, 1);       /* Popover 出现 */
```

### 8.2 使用约束

- 状态变化必须有过渡；纯装饰动效一律不做。
- **禁止：**弹跳（bounce）、旋转装饰、悬浮浮动、循环渐变、粒子效果。
- 通知到达：淡入 + 上滑 4px，`--motion-base`。
- 通知移除：淡出 + 折叠高度，`--motion-base`。
- 悬停反馈只切颜色，**禁止 `transform: translateX/scale`**（当前 styles.css 里 `notification-item:hover { transform: translateX(2px) }` 属于违规，需移除）。
- 尊重 `prefers-reduced-motion`：所有非必要动效归零。

---

## 9. 图标（Iconography）

- **只用 SF Symbols 或线条化 SVG。** 禁止用 emoji 作为功能图标（✓ ⚙️ ✕ 目前在用，需替换）。
- 图标线宽 1.5px，尺寸三档：
  - **16px** — Header 图标按钮、通知项内联操作。
  - **18px** — 主窗口 Sidebar NavItem 图标。
  - **20px** — 主窗口页面级主图标（空状态图标 32–40px 是 §6.6 定义的场景例外，不新开档）。
- 图标颜色继承 `currentColor`，默认 `--color-text-secondary`，hover 时 `--color-text-primary`。
- 不给图标加背景色圆圈（除非它承担"状态徽章"的角色）。

---

## 10. 深色模式

- **一等公民，不允许"以后再做"。** 每一个新组件必须同时验证两套模式。
- 深色底不追求纯黑，使用 `#1C1C1E` 系列，避免 OLED 屏"漆黑"造成阅读疲劳。
- 深色模式下毛玻璃透明度略高（0.72），保留系统壁纸质感。
- 深色模式下强调色亮度略提（见 §2.2）。
- **主窗口 `hiddenInset` 标题栏**在深色模式下无需特殊处理：交通灯由 macOS 自动 invert，标题栏区域**不加背景色、不加下边框**，让它随 Content / Sidebar 材质自然过渡。
- **Sidebar vibrancy** 在深色模式下自动切换材质（无需手动 CSS 分支）；NavItem 的 Hover / Active 底色使用 token（`--color-bg-subtle` / `--color-accent-subtle`），会自动跟随。

---

## 11. 可访问性（A11y）

- 正文对比度 ≥ 4.5:1，辅助文字 ≥ 3:1。**Accent 色不作为主要正文色**（对比度不够）。
- 所有可交互元素支持键盘 focus，focus 环见 §5.2。
- 图标按钮必须有 `aria-label` 或 `title`。
- 通知项支持 `role="listitem"`，容器 `role="list"`。
- 支持系统"减弱动效"（`prefers-reduced-motion: reduce`）。

---

## 12. 与 macOS 系统对齐（HIG 补充）

- 窗口圆角使用 12px，与系统 Big Sur 之后的 Popover 一致。
- 使用系统语言的日期/时间格式，尊重 12/24 小时制设置。
- 支持系统"增强对比度"偏好：自动加深 border、text-primary。
- 托盘图标提供 Template Image 版本（黑白 mask），随系统菜单栏色调切换。

---

## 13. 参考与灵感边界

允许参考的设计对象（**参考"如何做减法"，不复制视觉元素**）：

- **Linear** —— 灰阶主导 + 单一强调色的组合方式
- **Raycast** —— 菜单栏 Popover 的信息密度
- **Things 3** —— 列表项的克制排版
- **macOS 系统通知中心** —— 通知项的层次表达
- **Google Stitch / Material 3 tokens 体系** —— Design Token 的组织方式（不用它的视觉）

**明确不参考：**

- 任何带插画、渐变、Neumorphism、Glassmorphism 装饰效果的 Dribbble 稿
- 任何"仪表盘 / 数据大屏 / Web SaaS"风格
- 任何非 macOS 原生外观的图标包与配色方案

---

## 14. Do / Don't 速查

**Do**

- 用 Token，不硬编码色值/字号/间距
- 一屏只有一个 Primary CTA
- 分隔用 1px divider 而不是空白 24px
- Hover 只切颜色
- 系统字体 + 系统图标
- 每次改样式先问"能删吗"

**Don't**

- 在正文里堆彩色徽章
- 用 emoji 当功能图标
- 加装饰性阴影/渐变/圆点
- 造第 4 种颜色
- 造 §3.2 未定义档次的字号（`--fs-page-title` 是主窗口独占例外，其它场景不适用）
- 用位移或缩放做 hover 反馈
- 在窗口里放广告位、推广位、Banner

---

## 15. 落地与治理

- 所有样式统一在 `src/renderer/styles.css` 顶部声明 Design Token；组件样式必须 `var(--...)` 消费。
- 新组件在提交 PR 前，附上"对照本文档的自检清单"。
- 本文档如需修改，先在 PR 里说明动机、影响范围、迁移路径，禁止"顺手"改规范。
- 目前 `styles.css` / `settings.html` 内 style 块与本规范存在偏差，属于**技术债**，见下节。

### 15.1 现有代码待整改清单（Tech Debt）

以下项目会在后续迭代中逐步整改，新代码不得沿用这些反模式：

1. `.notification-item:hover { transform: translateX(2px) }` —— 违反 §8.2，移除。
2. 通知项中的 `notification-type` 蓝色背景徽章、`notification-session-title` 绿色背景徽章 —— 违反 §6.7，改为纯文字元信息。
3. `settings.html` 内联 `<style>` 中的 `#34C759` / `#FF3B30` / `#FF9500` 硬编码 —— 违反 §2.3，迁移到 Token，且橙色（#FF9500）不属于三色体系，必须替换为 Accent。
4. 自定义 6px 滚动条 —— 违反 §7.3，改用系统滚动条。
5. `✓` `⚙️` `✕` emoji 按钮 —— 违反 §9，替换为 SVG 图标。
6. 字号 18px / 16px 混用 —— 违反 §3.2，收敛到六级阶梯。
7. 深色模式缺失 —— 违反 §10，需补齐。

---

## 16. 密度与场景对照表（Density Cheat Sheet）

同一套 token，在不同场景下**允许**取不同值。下表是三种场景的规格速查，实施时对号入座，不要跨场景挪值。

| 维度 | Tray Popover | 主窗口（Main Window） | 设置窗口 |
|---|---|---|---|
| 窗口尺寸 | 380 × 540（固定） | 1120 × 720 初始 / 880 × 560 最小 / 可 resize | 520 × 620（固定） |
| 标题栏 | 无（Popover 无系统标题栏） | `hiddenInset`（交通灯浮层）| 标准 title bar |
| 外层材质 | 毛玻璃（§5.4） | 不透明 `--color-bg-elevated`（Sidebar 单独用 sidebar vibrancy）| 毛玻璃（§5.4） |
| Header / Page Title 字号 | `--fs-headline` 17px | `--fs-page-title` 22px | `--fs-headline` 17px |
| Content 内边距（左右 / 上下）| `--space-2` / `--space-2`（列表项密堆叠）| `--space-page-x` 24 / `--space-page-y` 20 | `--space-5` 20 / `--space-5` 20 |
| 组件之间垂直间距 | `--space-2` | `--space-page-gap` 20 | `--space-6` 24 |
| 卡片布局 | 不使用卡片，用 divider 列表 | 网格 `repeat(auto-fill, minmax(220px, 1fr))`，卡片见 §6.10 | 卡片式分组，单列 |
| Sidebar | 无 | 240px 固定，规格见 §6.9 | 无 |
| 图标默认尺寸 | 16px（Header）| 18px（Sidebar Nav） / 20px（页面级） | 16px（Header） |
| 空态形态 | Body 文本 + Secondary 按钮，无图标 | SF Symbol 32–40px + 引导文案 + Primary 按钮 | Body 文本 + Secondary 按钮，无图标 |
| 滚动条 | 系统默认 overlay | 系统默认 overlay | 系统默认 overlay |
| Primary CTA 数量上限 | 每屏 ≤ 1 | 每屏 ≤ 1 | 每屏 ≤ 1 |

**核心原则**：**规格分场景，token 不分场景**。同一 token 值在三种场景下都不变；变的是"哪个场景优先选哪个 token"。

---

> 有疑问、有更好的方案，先提 PR 修改本文档，再改代码。
> **规范是所有人共享的默契，不是某个人的偏好。**
