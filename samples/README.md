# Lottie Samples

将你的 Lottie JSON 文件放在这个文件夹中。

## 使用方法

1. **添加 JSON 文件**
   ```bash
   # 将你的 Lottie JSON 文件复制到这个文件夹
   cp /path/to/your/animation.json samples/
   ```

2. **批量渲染所有文件**
   ```bash
   npm run batch:render
   ```

3. **查看生成的视频**
   ```bash
   # 视频会保存在 videos/ 文件夹中
   open videos/
   ```

## 示例

```bash
samples/
├── animation1.json
├── animation2.json
└── animation3.json
```

运行 `npm run batch:render` 后会生成：

```bash
videos/
├── lottie-1234567890.mp4  (from animation1.json)
├── lottie-1234567891.mp4  (from animation2.json)
└── lottie-1234567892.mp4  (from animation3.json)
```

## 支持的格式

- ✅ Lottie JSON (.json)
- ✅ 从 After Effects 导出的 bodymovin JSON
- ✅ LottieFiles 下载的 JSON

## 渲染配置

默认配置：
- 分辨率: 1920x1080
- 帧率: 30 fps
- 背景色: 白色 (#ffffff)
- 格式: MP4 (H.264)
