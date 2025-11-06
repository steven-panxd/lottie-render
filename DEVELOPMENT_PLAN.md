# Lottie 渲染服务开发计划

> **项目目标**: 构建一个生产可用的 HTTP API 服务，使用 Playwright + lottie-web 将 Lottie JSON 动画渲染为 MP4 视频

## 技术栈

- **语言**: TypeScript + Node.js 20
- **服务形式**: HTTP API (Express)
- **渲染方法**: **Frame-by-Frame + FFmpeg 合成** (逐帧截图方案)
- **浏览器自动化**: Playwright + lottie-web
- **并发控制**: 内存计数器（简单高效）
- **输出格式**: MP4 (H.264)
- **认证**: API Key
- **部署**: Docker + docker-compose

---

## 渲染方案说明

### Frame-by-Frame (逐帧截图)

**核心原理**:
1. 使用 Playwright 启动浏览器，加载 lottie-web
2. 通过 `animation.goToAndStop(frameIndex, true)` 精确控制每一帧
3. 使用 `page.screenshot()` 截取每一帧（JPEG 格式）
4. 将截图 Buffer 存储在内存数组中（优化性能）
5. 截图完成后批量并行写入磁盘
6. 使用 FFmpeg 将帧序列合成为 MP4 视频

**优势**:
- ✅ **精确时长控制**: 完全消除时长误差（±0.015s）
- ✅ **无白屏问题**: 从第一帧开始完全控制
- ✅ **可靠性高**: 每一帧都是确定性的
- ✅ **内存优化**: 使用内存缓冲，大幅提升速度（5分钟 → 43秒）

**性能指标** (450帧，15秒动画):
- 渲染时间: ~43 秒
- 内存峰值: ~50 MB
- 时长精度: ±0.015 秒
- 文件大小: ~800 KB (1920x1080)

---

## Phase 1: 核心渲染原型 ✅ 已完成

### 核心文件

**`src/renderer/frame-by-frame.ts`** - 核心渲染引擎
- `renderLottieToVideoFrameByFrame()`: 主渲染函数
- `extractMetadata()`: 提取 Lottie JSON 元数据（帧数、时长、FPS）
- `composeVideoFromFrames()`: FFmpeg 视频合成
- `cleanupFrames()`: 临时文件清理

**`templates/lottie-player.html`** - 浏览器播放器
- 加载 lottie-web CDN
- 支持动态注入 Lottie JSON 数据
- 暴露 `animation` 实例供 Playwright 控制

**`src/types/index.ts`** - 类型定义
```typescript
interface RenderOptions {
  width?: number;           // 视频宽度 (默认使用 JSON 中的值)
  height?: number;          // 视频高度
  fps?: number;             // 帧率
  backgroundColor?: string; // 背景色
  quality?: number;         // JPEG 质量 (0-100)，默认 80
}

interface RenderResult {
  success: boolean;
  videoPath?: string;
  error?: string;
  duration: number;         // 渲染耗时(毫秒)
  metadata?: LottieMetadata;
}
```

### 验证测试

```bash
npm run test:render
```

---

## Phase 2: HTTP API 服务基础 ✅ 已完成

### 核心功能

#### 1. Express 应用 (`src/api/app.ts`)
- ✅ body-parser 配置 (JSON 大小限制 10MB)
- ✅ multer 文件上传配置 (10MB 限制)
- ✅ 错误处理中间件
- ✅ **API Key 认证中间件**
- ❌ ~~CORS~~ (移除，后端到后端调用不需要)

#### 2. API 路由 (`src/api/routes.ts`)

##### POST /api/render (提交渲染任务)

**请求方式**: `multipart/form-data`

```bash
curl -X POST http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@lottie.json" \
  -F "width=1920" \
  -F "height=1080" \
  -o output.mp4
```

**参数说明**:
- `file` (必需): Lottie JSON 文件
- `width`, `height`, `fps`, `backgroundColor`, `quality` (可选)

**响应**: 直接返回 **MP4 视频文件** (不是 JSON)

**响应头**:
```
Content-Type: video/mp4
Content-Disposition: attachment; filename="lottie-{taskId}.mp4"
X-Task-ID: {uuid}
X-Render-Duration: {ms}
X-Video-Duration: {seconds}
```

**并发限制**: 当并发数达到上限时返回 503
```json
{
  "success": false,
  "error": "Server is busy. Maximum 5 concurrent renders allowed.",
  "activeRenders": 5,
  "maxConcurrent": 5
}
```

##### GET /api/health (健康检查)

```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2025-11-06T03:00:00.000Z"
}
```

#### 3. 并发控制实现

```typescript
let activeRenders = 0;
const MAX_CONCURRENT_RENDERS = process.env.MAX_CONCURRENT_RENDERS
  ? parseInt(process.env.MAX_CONCURRENT_RENDERS)
  : 5;

// 请求到达时检查
if (activeRenders >= MAX_CONCURRENT_RENDERS) {
  return res.status(503).json({ error: "Server busy" });
}

activeRenders++;
try {
  await renderVideo();
} finally {
  activeRenders--;
}
```

### 配置示例

创建 `.env` 文件:
```env
PORT=3000
API_KEY=your-secret-api-key-here
MAX_CONCURRENT_RENDERS=5
```

---

## Phase 3: 异步任务队列 ⏭️ 跳过

**跳过原因**: 调用方（Web 应用）已实现 Bull + Redis 队列系统，其 Worker 本身就是异步处理的。

**架构分析**:
```
用户请求 → Web应用 → Bull队列 → Worker(并发3)
                                    ↓
                              调用 Lottie 服务 (同步等待)
                                    ↓
                              直接返回视频
```

如果实现异步队列，会造成双层队列，增加不必要的复杂度。

**替代方案**: 简单的并发限制（默认 5）+ 503 重试机制

---

## Phase 7: Docker 容器化 ✅ 已完成

### 核心文件

#### `Dockerfile`
- **Multi-stage build**: 分离 builder 和 production 阶段
- **Base image**: Node 20 + Debian Bookworm (stable)
- **依赖**: FFmpeg + Playwright Chromium 所需依赖
- **安全**: 使用非 root 用户 (appuser)
- **健康检查**: 内置 healthcheck

#### `docker-compose.yml`
- **环境变量**: 自动读取 `.env` 文件
- **资源限制**: 2 CPU / 2GB memory
- **日志持久化**: 挂载 logs 目录
- **健康检查**: 配置 healthcheck

#### `.dockerignore`
- 排除不必要的文件（node_modules, dist, videos, logs, .git 等）
- **保留** `package-lock.json`（npm ci 需要）

#### `DOCKER.md`
- 完整的部署指南
- .env 配置说明
- docker-compose 使用方法

### 部署方式

**方式 1: docker-compose (推荐)**
```bash
# 创建 .env 文件
cp .env.example .env
# 编辑 .env，设置 API_KEY 等参数

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

**方式 2: 纯 Docker**
```bash
# 构建镜像
docker build -t lottie-render-service:latest .

# 运行容器
docker run -d \
  -p 3000:3000 \
  -e API_KEY=your-api-key \
  -e MAX_CONCURRENT_RENDERS=5 \
  --name lottie-service \
  lottie-render-service:latest
```

### 验证部署

```bash
# 健康检查
curl http://localhost:3000/api/health

# 测试渲染
curl -X POST http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@samples/template.json" \
  -o output.mp4
```

---

## 项目结构

```
lottie-render-service/
├── src/
│   ├── api/
│   │   ├── app.ts                # Express 应用配置
│   │   └── routes.ts             # API 路由
│   ├── renderer/
│   │   └── frame-by-frame.ts    # Frame-by-Frame 渲染引擎
│   ├── types/
│   │   └── index.ts              # TypeScript 类型定义
│   ├── index.ts                  # 服务器入口
│   └── test-render.ts            # 测试脚本
├── templates/
│   └── lottie-player.html        # Lottie 播放器模板
├── samples/                       # 测试 JSON 文件
├── videos/                        # 输出视频目录 (临时)
├── temp/                          # 临时文件目录
├── logs/                          # 日志目录
├── dist/                          # 编译输出
├── Dockerfile                     # Docker 镜像构建文件
├── docker-compose.yml            # Docker Compose 配置
├── .dockerignore                 # Docker 构建忽略文件
├── DOCKER.md                     # Docker 部署文档
├── .env.example                  # 环境变量示例
├── package.json                  # 项目配置
├── tsconfig.json                 # TypeScript 配置
└── DEVELOPMENT_PLAN.md          # 本文档
```

---

## 性能指标

| 指标 | 数值 |
|------|------|
| 单任务渲染时间 (15s 动画, 450帧) | ~43 秒 |
| 内存占用 (渲染中) | ~50 MB |
| 时长精度 | ±0.015 秒 |
| 视频文件大小 (15s, 1080p) | ~800 KB |
| JPEG 质量 | 80% (可配置) |
| FFmpeg 编码速度 | fast preset, CRF 21 |
| 并发支持 | 5 个 (可配置) |

---

## 开发阶段总结

| Phase | 状态 | 说明 |
|-------|------|------|
| Phase 1: 核心渲染原型 | ✅ 已完成 | Frame-by-Frame 渲染引擎 |
| Phase 2: HTTP API 服务基础 | ✅ 已完成 | Express + API Key + 并发控制 |
| Phase 3: 异步任务队列 | ⏭️ 已跳过 | 调用方已有队列系统，不需要 |
| Phase 4: 错误处理和日志 | 📝 可选 | 当前使用基础 console 日志 |
| Phase 5: 性能优化 | 📝 可选 | 浏览器池、文件清理等 |
| Phase 6: 配置管理 | ✅ 已完成 | 基础环境变量配置 |
| Phase 7: Docker 容器化 | ✅ 已完成 | Docker + docker-compose 部署 |

---

## 项目当前状态

**🎉 生产就绪** - 项目已具备生产环境部署所需的核心功能：

### ✅ 核心功能
- Frame-by-Frame 渲染引擎（精确时长控制）
- HTTP API 服务（文件上传、参数配置、视频返回）
- API Key 认证
- 并发控制（防止资源耗尽）
- 自动清理（临时文件自动删除）
- Docker 容器化部署

### 🚀 技术优势
- 完美的时长控制（±0.015s）
- 无白屏问题
- 性能优化（内存缓冲，43秒渲染）
- 可靠性高（确定性渲染）
- 灵活配置（宽高、FPS、质量等）

### 🔄 架构决策
- **跳过异步队列**: 调用方已有队列系统，避免双层队列复杂度
- **同步渲染**: 对当前场景最优（Worker 并发数 3）
- **简单并发控制**: 内存计数器 + 503 重试机制

### 📦 可选优化方向

根据实际使用情况，可以考虑：

1. **错误处理增强** (Phase 4): Winston 日志、结构化错误码、超时重试
2. **性能优化** (Phase 5): 浏览器实例复用、更精细的资源管理
3. **功能扩展**: WebM 输出（透明背景）、GIF 输出、动态文本替换

**当前状态**: 已满足生产环境基本需求，可根据实际运行情况决定是否需要进一步优化。
