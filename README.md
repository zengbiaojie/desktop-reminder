# Desktop Reminder

基于 Electron 的轻量桌面提醒应用，支持置顶、托盘驻留、悬浮球、事件多视图管理与到期提醒。

## 主要功能

- 事件管理：新增、编辑、完成/未完成切换、删除
- 事件粒度：`紧急` / `重要` / `日常`
- DDL：支持日期时间设置与到期状态识别
- 重复任务：按 `每天/每周/每月` 生成后续任务
- 子任务：支持新增、勾选完成、删除、展开查看
- 标签：支持逗号分隔录入与筛选
- 多视图：列表 / 日历 / 表格 / 时间轴
- 状态筛选：进行中 / 已完成 / 已逾期

## 桌面体验

- 开机自启
- 主窗口置顶
- 关闭按钮默认隐藏到托盘
- 最小化进入悬浮球模式
- 托盘菜单支持恢复主窗口与退出
- 托盘与窗口图标统一

## 提醒能力

- 提前 1 天 / 1 小时 / 10 分钟提醒
- 逾期提醒
- 系统通知 + 应用内横幅提示
- 提醒开关与规则持久化

## 视图说明

### 列表视图
- 卡片化展示事件信息
- 展开子任务并可直接勾选/删除

### 表格视图
- 主行 + 子任务展开行结构
- 有子任务才显示展开按钮
- 子任务行缩进显示

### 日历视图
- 点击日期打开该日详情
- 支持月份切换：上个月 / 下个月 / 本月
- 详情面板支持直接完成/编辑/删除

### 时间轴视图
- 按时间线展示事件
- 标题、元信息、备注分层展示

## 安装与运行

```bash
npm install
npm start
```

## 打包

### 一键打包（安装包 + 便携版）

```bash
npm run build:all
```

### 分别打包

```bash
npm run build          # NSIS 安装包
npm run build:portable # 便携版 exe
```

打包产物位于 `dist/`：

- `Desktop Reminder Setup x.x.x.exe`（安装包）
- `Desktop Reminder x.x.x.exe`（便携版）

## 项目结构

```text
src/
  main.js
  preload.js
  renderer.js
  index.html
  styles.css
  bubble.html
  bubble.css
  bubble-renderer.js
  bubble-preload.js
assets/
  app.ico
  tray.ico
  tray.png
  icon-*.png
```

## 数据存储

数据保存在 Electron `userData/events.json`，包含：

- `settings`：应用与提醒配置
- `events`：事件列表（含标签、子任务、重复任务、状态）

## 图标说明

当前打包与运行时图标统一使用 `assets/app.ico`（并兼容 `tray.ico/tray.png` 作为候选）。
