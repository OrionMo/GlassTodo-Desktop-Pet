# GlassTodo

GlassTodo 是一个极简的 Windows 桌面待办小工具。它平时以可拖动的小圆球停留在桌面上，点击后展开毛玻璃待办面板，适合随手记录今天、明天和未完成事项。

## 功能

- 桌面悬浮小圆球，支持拖动与点击展开
- 简约的 Apple 风格透明毛玻璃界面
- 今日待办、明日待办和手动加入的未完成待办
- 勾选完成后自动下沉到“已完成”区域
- 每 30 分钟提醒查看今日待办
- 本地 JSON 数据持久化，升级版本不会主动清空任务
- 一键创建桌面启动快捷方式
- 面板内提供关闭程序按钮

## 下载与使用

前往仓库的 **Releases** 页面下载 `GlassTodo-v7.1-Windows.zip`，解压后运行 `GlassTodo.exe`。

任务数据默认保存在：

```text
%APPDATA%\glasstodo\tasks.json
```

提醒功能需要 GlassTodo 保持运行。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

运行桌面版：

```bash
npm run desktop
```

构建 Windows 便携版：

```bash
npm run dist:win
```

## 数据与隐私

GlassTodo 的待办内容只保存在本机，不会上传到网络。公开仓库与 Release 安装包不包含作者的个人任务数据。
