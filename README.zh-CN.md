# lottie-render

**在 Node.js 后端或自托管 HTTP 服务中，将 Lottie 动画转换为 MP4 视频。**

[English](README.md) · [快速开始](#快速开始) · [HTTP API](docs/http-api.md) · [性能实测](docs/benchmarks.md)

适用于已有 Lottie / bodymovin JSON、需要增加视频导出功能的应用。可以直接调用 Node.js 库，也可以部署一个渲染服务，供 Python、Go 等后端通过 HTTP 调用。

![仓库自带动画的渲染预览](assets/demo.gif)

上方为 GIF 预览；实际输出为 MP4。[示例输入](assets/demo-animation.json)包含 90 帧，默认输出 400 × 400、30 fps、时长 3 秒的视频。

## 适合什么场景

- 为生成 Lottie 动画的应用增加“导出视频”功能。
- 通过 HTTP 上传动画 JSON，获取 MP4 文件。
- 在脚本或已有任务队列中，顺序转换一批动画。

渲染器使用 lottie-web 和 Chromium，逐帧定位、截图，再交给 FFmpeg 编码；截图耗时不会决定视频的播放速度。播放器随包提供，渲染浏览器会阻止 HTTP(S) 素材请求。

**使用前确认：** 当前输出为不带音频、不带透明通道的 MP4；需要 Node.js 20+、Chromium 和 FFmpeg。服务不内置任务队列。

## 快速开始

### 1. 安装依赖

先安装 Node.js 20+ 和 FFmpeg，再安装 npm 包：

```bash
# macOS（Homebrew）
brew install ffmpeg

# Ubuntu / Debian 使用下面的命令替代上面的命令
# sudo apt-get update && sudo apt-get install -y ffmpeg

npm install lottie-render
ffmpeg -version
```

首次安装会下载 Chromium，需要额外时间和数百 MB 空间。Linux 如缺少浏览器系统依赖，可执行 `npx playwright install --with-deps chromium`。也可以使用 [Docker 部署](DOCKER.md)。

### 2. 准备输入和脚本

使用自己的自包含 Lottie JSON，或下载仓库里的示例：

```bash
curl -fL https://raw.githubusercontent.com/steven-panxd/lottie-render/main/assets/demo-animation.json -o animation.json
```

将下面的代码保存为 **`render.mjs`**；使用 `.mjs` 扩展名即可运行 `import` 和顶层 `await`：

```js
import { renderLottie } from 'lottie-render';

const result = await renderLottie('animation.json', {
  outputPath: 'output.mp4',
  backgroundColor: '#ffffff',
});

if (!result.success) throw new Error(result.error);
console.log(`Saved ${result.videoPath}`);
```

### 3. 生成视频

```bash
node render.mjs
```

成功后打开 `output.mp4`。示例默认生成 3 秒、400 × 400、30 fps 的视频。输出路径已有文件时会覆盖。

## 直接运行仓库演示

安装好 Node.js 20+ 和 FFmpeg 后执行：

```bash
git clone https://github.com/steven-panxd/lottie-render.git
cd lottie-render
npm ci
npm run demo
```

命令会构建库、渲染自带动画，将结果写入 `videos/demo.mp4`，并打印耗时。重复执行会覆盖该视频。

也可以指定自己的输入和输出：

```bash
npm run demo -- samples/animation.json videos/animation.mp4
```

这是仓库内的示例命令，npm 包目前不提供全局 CLI。

## 作为 HTTP 服务运行

在仓库目录内执行：

```bash
cp .env.example .env
# 编辑 .env，将 API_KEY 替换为随机生成的强密钥。
docker compose up -d --build
curl --fail http://localhost:3000/api/health
```

将下面的 `your-api-key` 替换为 `.env` 中相同的密钥：

```bash
curl --fail-with-body http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@assets/demo-animation.json" \
  -F "backgroundColor=#ffffff" \
  -o output.mp4
```

成功响应直接返回 MP4；错误响应为 JSON。`--fail-with-body` 会让 HTTP 错误产生非零退出码，因此请确认命令成功后再打开输出文件。请求会等待渲染完成；超过并发上限时返回 `503`。

[部署与排错](DOCKER.md) · [完整 HTTP API](docs/http-api.md) · [库 API 参数](docs/api.md)（详细参考文档为英文）

## 性能与边界

[性能实测](docs/benchmarks.md)包含机器配置、原始结果和复现方法。仓库内执行 `npm run benchmark` 可测量自己的机器，需要 `ffprobe`（通常随 FFmpeg 安装）。简单样例的结果不代表复杂动画的性能。

- **没有透明视频和音频输出。** `backgroundColor: 'transparent'` 不会保留透明通道，建议明确指定背景色。
- **修改 fps 会改变播放速度和时长。** 当前实现不通过补帧或丢帧来保持原始时长。
- **宽高使用偶数像素。** 当前 H.264 编码使用 `yuv420p`。
- **远程图片、字体不会自动下载。** 请内嵌素材，并检查实际导出效果；文字效果取决于播放器可用的字形或字体。
- **每次渲染启动一个 Chromium，并在内存中缓存截图。** 大尺寸、长动画会增加内存需求。默认上限为 6,000 帧、单边 4,096 像素。
- **服务并发限制仅在单进程内生效。** 批量任务、跨实例调度需要自行接入队列。

生产环境必须配置 API key。网络请求过滤和资源上限不等于完整的安全隔离，渲染器仍允许本地 `file://` URL；详见[安全说明](README.md#security)。

## 开发与反馈

```bash
npm run typecheck
npm run build
npm test
```

测试包含真实浏览器、FFmpeg、HTTP API 和 npm 打包安装流程。

如果遇到渲染问题，欢迎[提交 issue](https://github.com/steven-panxd/lottie-render/issues/new)，附上可公开的 JSON、预期效果、实际结果及运行环境。提出新功能时，也请描述你希望完成的导出流程。

如果它帮你解决了问题，欢迎点一个 Star，方便以后找到，也让我知道项目对你有用。

## 许可证

[MIT](LICENSE)
