# Desktop Reminder

一个轻量的桌面提醒应用（Electron），支持：

- 开机自启（Windows）
- 窗口置顶
- 缩小到系统托盘，点击托盘图标恢复
- 事件粒度：紧急 / 重要 / 日常
- DDL（截止时间）
- 本地通知提醒（提前 1 天 / 1 小时 / 10 分钟 + 逾期提醒）
- 今日面板（今天到期 / 已逾期）
- 多视图：列表 / 日历 / 表格 / 时间轴
- 事件可切换完成状态、编辑、删除

## 启动

```bash
npm install
npm start
```

## 数据存储

事件和设置会保存到 Electron `userData` 目录下的 `events.json`。
