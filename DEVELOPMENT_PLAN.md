# Lottie 渲染服务开发计划

> **项目目标**: 构建一个生产可用的 HTTP API 服务，使用 Playwright + lottie-web 将 Lottie JSON 动画渲染为 MP4 视频

## 技术栈

- **语言**: TypeScript
- **服务形式**: HTTP API (Express)
- **渲染方法**: **Frame-by-Frame + FFmpeg 合成** (逐帧截图方案)
- **浏览器自动化**: Playwright + lottie-web
- **任务队列**: Bull + Redis
- **输出格式**: MP4 (H.264)
- **日志系统**: Winston

## 渲染方案说明

### 当前实现：Frame-by-Frame (逐帧截图)

**核心原理**:
1. 使用 Playwright 启动浏览器，加载 lottie-web
2. 通过 `animation.goToAndStop(frameIndex, true)` 精确控制每一帧
3. 使用 `page.screenshot()` 截取每一帧（JPEG 格式，quality 90）
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

**当前实现状态**:

### ✅ 已完成的功能

#### 1.1 项目结构
```
lottie-render-service/
├── src/
│   ├── renderer/
│   │   └── frame-by-frame.ts    # Frame-by-Frame 渲染引擎
│   ├── types/
│   │   └── index.ts              # TypeScript 类型定义
│   └── test-render.ts            # 测试脚本
├── templates/
│   └── lottie-player.html        # Lottie 播放器 HTML 模板
├── samples/                       # 测试 JSON 文件
├── videos/                        # 输出视频目录
└── temp/                          # 临时文件目录
```

#### 1.2 核心文件说明

**`src/renderer/frame-by-frame.ts`** - 核心渲染引擎
- `renderLottieToVideoFrameByFrame()`: 主渲染函数
- `extractMetadata()`: 提取 Lottie JSON 元数据（帧数、时长、FPS）
- `composeVideoFromFrames()`: FFmpeg 视频合成
- `cleanupFrames()`: 临时文件清理

**`templates/lottie-player.html`** - 浏览器播放器
- 加载 lottie-web CDN
- 支持动态注入 Lottie JSON 数据
- 暴露 `animation` 实例供 Playwright 控制
- 事件监听: `DOMLoaded`（第一帧就绪）、`complete`（动画完成）

**`src/types/index.ts`** - 类型定义
```typescript
interface RenderOptions {
  width?: number;           // 视频宽度 (默认使用 JSON 中的值)
  height?: number;          // 视频高度
  fps?: number;             // 帧率
  backgroundColor?: string; // 背景色
  quality?: number;         // JPEG 质量 (0-100)
}

interface RenderResult {
  success: boolean;
  videoPath?: string;
  error?: string;
  duration: number;         // 渲染耗时(毫秒)
  metadata?: LottieMetadata;
}
```

#### 1.3 验证测试

```bash
npm run test:render
```

**测试结果示例**:
```
Total frames to capture: 450 (15.02s @ 30fps)
Using in-memory frame storage
Progress: 100.0% (450/450 frames) | Memory: 34.5 MB
✅ All frames captured in memory!
Writing frames to disk (batch write)...
✅ 450 frames written to disk
Composing video with FFmpeg...
✅ Video composition completed!
✅ Rendering completed in 43249ms
Video: 15.000000s (perfect accuracy!)
```

---

## Phase 2: HTTP API 服务基础 🎯 下一步

**目标**: 搭建 Express API 服务，支持文件上传和异步渲染

### 任务清单

#### 2.1 创建 Express 应用
文件: `src/api/app.ts`
- [ ] 初始化 Express 应用
- [ ] 配置 body-parser (JSON 大小限制 10MB)
- [ ] 配置 multer (文件上传，限制 5MB)
- [ ] CORS 配置
- [ ] 错误处理中间件

#### 2.2 实现 API 路由
文件: `src/api/routes.ts`

##### POST /api/render (提交渲染任务)
```typescript
// 请求体:
{
  lottieJson: object | string,  // Lottie JSON 对象或字符串
  options?: {
    width?: number,
    height?: number,
    fps?: number,
    backgroundColor?: string,
    quality?: number
  }
}

// 响应:
{
  success: boolean,
  taskId: string,           // 任务 ID (UUID)
  message: string
}
```

##### GET /api/health (健康检查)
```typescript
{
  status: "ok",
  uptime: number,
  timestamp: string
}
```

#### 2.3 创建入口文件
文件: `src/index.ts`
- [ ] 启动 HTTP 服务器
- [ ] 监听端口 (默认 3000，可配置)
- [ ] 优雅关闭处理
- [ ] 启动日志

**交付物**: 可通过 HTTP 请求渲染 Lottie 的基础 API

**验证方式**:
```bash
# 启动服务
npm run dev

# 测试渲染
curl -X POST http://localhost:3000/api/render \
  -H "Content-Type: application/json" \
  -d @samples/template.json
```

---

## Phase 3: 异步任务队列 ⚡

**目标**: 实现异步任务处理，支持并发和任务状态查询

### 任务清单

#### 3.1 集成 Bull 队列
文件: `src/queue/queue.ts`
- [ ] 创建渲染任务队列 `renderQueue`
- [ ] 配置 Redis 连接 (默认 localhost:6379)
- [ ] 设置并发限制 (默认 2-3 个并发任务)
- [ ] 配置任务优先级
- [ ] 设置任务过期时间 (24 小时)

#### 3.2 实现任务处理器
文件: `src/queue/processor.ts`
```typescript
interface RenderJob {
  taskId: string;
  lottieJson: object;
  options: RenderOptions;
}

async function processRenderJob(job: Job<RenderJob>): Promise<void> {
  // 1. 更新任务状态为 processing
  // 2. 调用 renderLottieToVideoFrameByFrame()
  // 3. 保存视频文件
  // 4. 更新任务状态为 completed
  // 5. 错误处理和重试
}
```

#### 3.3 任务状态管理
文件: `src/queue/storage.ts`
- [ ] 使用 Redis 存储任务元数据
- [ ] 任务状态枚举: `pending`, `processing`, `completed`, `failed`

```typescript
interface TaskInfo {
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  videoPath?: string;
  error?: string;
  progress?: number;  // 0-100
}
```

#### 3.4 扩展 API 路由

##### GET /api/tasks/:taskId (查询任务状态)
```typescript
{
  taskId: string,
  status: "pending" | "processing" | "completed" | "failed",
  progress: number,
  videoUrl?: string,  // 下载链接
  error?: string,
  createdAt: string,
  completedAt?: string
}
```

##### GET /api/download/:taskId (下载视频)
- [ ] 返回视频文件 (Content-Type: video/mp4)
- [ ] 设置适当的 Content-Disposition header
- [ ] 任务不存在返回 404
- [ ] 任务未完成返回 400

##### DELETE /api/tasks/:taskId (取消/删除任务)
- [ ] 取消正在等待的任务
- [ ] 删除任务数据和视频文件
- [ ] 返回操作结果

**交付物**: 支持异步处理的完整 API 服务

---

## Phase 4: 错误处理和日志系统 📝

**目标**: 增强服务稳定性和可观测性

### 任务清单

#### 4.1 统一错误处理
文件: `src/utils/errors.ts`

```typescript
enum ErrorCode {
  INVALID_JSON = 'INVALID_JSON',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  RENDER_TIMEOUT = 'RENDER_TIMEOUT',
  BROWSER_CRASHED = 'BROWSER_CRASHED',
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  DISK_SPACE_FULL = 'DISK_SPACE_FULL',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public message: string,
    public statusCode: number,
    public details?: any
  ) {}
}
```

#### 4.2 集成 Winston 日志
文件: `src/utils/logger.ts`
- [ ] 配置日志级别 (dev: debug, prod: info)
- [ ] Console 输出: 彩色格式化
- [ ] File 输出: `logs/app.log` (所有日志)
- [ ] File 输出: `logs/error.log` (仅错误)
- [ ] 日志分割 (每天或 10MB)

#### 4.3 添加请求日志中间件
文件: `src/api/middleware.ts`
- [ ] 记录所有 HTTP 请求（方法、路径、IP、响应时间）
- [ ] 错误请求详细日志（请求体、错误堆栈）

#### 4.4 实现超时和重试机制
- [ ] 单个渲染任务超时: 10 分钟 (可配置)
- [ ] 失败任务自动重试: 最多 3 次
- [ ] 重试间隔: 指数退避 (10s, 20s, 40s)
- [ ] 浏览器崩溃自动恢复

---

## Phase 5: 性能优化和资源管理 🚀

**目标**: 提升渲染性能和系统吞吐量

### 任务清单

#### 5.1 实现浏览器池 (可选优化)
文件: `src/renderer/BrowserPool.ts`

```typescript
class BrowserPool {
  private pool: Pool<Browser>;

  constructor(options: {
    min: number,      // 最小实例数 (默认 1)
    max: number,      // 最大实例数 (默认 2)
    idleTimeout: number  // 空闲超时 (默认 60s)
  });

  async acquire(): Promise<Browser>;
  async release(browser: Browser): Promise<void>;
  async drain(): Promise<void>;
}
```

**说明**: 由于当前单任务渲染时间 ~43秒，浏览器池的收益有限。建议先实现任务队列，根据实际负载情况决定是否需要。

#### 5.2 添加文件清理机制
文件: `src/utils/cleanup.ts`

```typescript
class FileCleanup {
  // 定时清理过期临时文件 (超过 24 小时)
  startPeriodicCleanup(intervalMs: number): void;

  // 清理指定任务的所有文件
  cleanupTask(taskId: string): Promise<void>;

  // 磁盘空间监控
  checkDiskSpace(): Promise<DiskInfo>;
}
```

- [ ] 定时清理 (每小时运行一次)
- [ ] 完成任务后自动删除临时帧文件
- [ ] 视频文件保留 24 小时后自动删除
- [ ] 磁盘空间不足时拒绝新任务

#### 5.3 实现请求限流
- [ ] 基于 IP 的请求频率限制 (15分钟内最多 100 个请求)
- [ ] 队列容量限制 (最大等待任务数 50)
- [ ] 返回 503 Service Unavailable 当队列满时

---

## Phase 6: 配置管理和环境变量 ⚙️

**目标**: 支持灵活的配置和多环境部署

### 任务清单

#### 6.1 创建配置模块
文件: `src/config/index.ts`

```typescript
interface Config {
  // 服务器配置
  port: number;
  nodeEnv: 'development' | 'production';

  // Redis 配置
  redisUrl: string;

  // 队列配置
  maxConcurrentJobs: number;
  jobTimeout: number;  // 毫秒
  maxRetries: number;

  // 渲染配置
  defaultWidth: number;
  defaultHeight: number;
  defaultFps: number;
  jpegQuality: number;  // 90

  // 存储配置
  videoOutputDir: string;
  tempDir: string;
  fileRetentionHours: number;

  // 日志配置
  logLevel: string;
  logDir: string;

  // 限制配置
  maxFileSize: number;  // bytes
  maxQueueSize: number;
}
```

#### 6.2 环境变量支持
创建 `.env.example`:
```bash
# Server
PORT=3000
NODE_ENV=development

# Redis
REDIS_URL=redis://localhost:6379

# Queue
MAX_CONCURRENT_JOBS=2
JOB_TIMEOUT=600000
MAX_RETRIES=3

# Rendering
DEFAULT_WIDTH=1920
DEFAULT_HEIGHT=1080
DEFAULT_FPS=30
JPEG_QUALITY=90

# Storage
VIDEO_OUTPUT_DIR=./videos
TEMP_DIR=./temp
FILE_RETENTION_HOURS=24

# Logging
LOG_LEVEL=info
LOG_DIR=./logs

# Limits
MAX_FILE_SIZE=10485760
MAX_QUEUE_SIZE=50
```

---

## Phase 7: Docker 容器化 🐳

**目标**: 准备生产部署，提供 Docker 镜像

### 任务清单

#### 7.1 创建 Dockerfile
文件: `Dockerfile`

```dockerfile
# 多阶段构建
FROM node:18-bullseye AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 生产镜像
FROM node:18-bullseye-slim

# 安装 Playwright 依赖和 FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY templates ./templates

# 创建必要的目录
RUN mkdir -p videos temp logs

# 非 root 用户
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app
USER appuser

# 安装 Playwright Chromium
RUN npx playwright install chromium

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

**重要**: 必须安装 FFmpeg，因为使用 frame-by-frame 方法需要 FFmpeg 合成视频。

#### 7.2 创建 docker-compose.yml
```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  lottie-service:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - PORT=3000
      - MAX_CONCURRENT_JOBS=2
    volumes:
      - ./videos:/app/videos
      - ./logs:/app/logs
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

volumes:
  redis-data:
```

---

## 附录

### A. 当前项目结构

```
lottie-render-service/
├── src/
│   ├── renderer/
│   │   └── frame-by-frame.ts    # ✅ Frame-by-Frame 渲染引擎
│   ├── types/
│   │   └── index.ts              # ✅ TypeScript 类型定义
│   └── test-render.ts            # ✅ 测试脚本
├── templates/
│   └── lottie-player.html        # ✅ Lottie 播放器模板
├── samples/                       # ✅ 测试 JSON 文件
│   └── template.json
├── videos/                        # ✅ 输出视频目录
├── temp/                          # ✅ 临时文件目录
├── package.json                   # ✅ 项目配置
├── tsconfig.json                  # ✅ TypeScript 配置
└── DEVELOPMENT_PLAN.md           # ✅ 本文档
```

### B. 渲染流程详解

```
1. 读取 Lottie JSON 文件
   ↓
2. 提取元数据（总帧数、时长、FPS）
   ↓
3. 创建内存缓冲区 (frameBuffers: Buffer[])
   ↓
4. 启动 Playwright 浏览器
   ↓
5. 加载 HTML 模板，注入 Lottie 数据
   ↓
6. 等待第一帧渲染完成 (DOMLoaded 事件)
   ↓
7. 逐帧截图循环:
   for (frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
     - animation.goToAndStop(frameIndex, true)
     - await page.waitForTimeout(20ms)
     - screenshot = await page.screenshot({ type: 'jpeg', quality: 90 })
     - frameBuffers.push(screenshot)
   }
   ↓
8. 关闭浏览器
   ↓
9. 批量并行写入磁盘
   Promise.all(frameBuffers.map((buffer, index) =>
     fs.writeFile(`frame-${index}.jpg`, buffer)
   ))
   ↓
10. FFmpeg 合成视频
    ffmpeg -framerate ${fps} -i frame-%05d.jpg \
           -c:v libx264 -preset fast -crf 18 \
           -pix_fmt yuv420p -movflags +faststart \
           output.mp4
   ↓
11. 清理临时帧文件
   ↓
12. 返回渲染结果
```

### C. 性能指标 (当前实现)

| 指标 | 数值 |
|------|------|
| 单任务渲染时间 (15s 动画, 450帧) | ~43 秒 |
| 内存占用 (渲染中) | ~50 MB |
| 时长精度 | ±0.015 秒 |
| 视频文件大小 (15s, 1080p) | ~800 KB |
| JPEG 质量 | 90% |
| FFmpeg 编码速度 | fast preset, CRF 18 |

### D. 开发时间估算

| Phase | 预计时间 | 优先级 |
|-------|---------|--------|
| ~~Phase 1: 核心渲染原型~~ | ~~2-3 小时~~ | ✅ 已完成 |
| Phase 2: HTTP API 服务基础 | 3-4 小时 | P0 必须 |
| Phase 3: 异步任务队列 | 4-5 小时 | P0 必须 |
| Phase 4: 错误处理和日志 | 2-3 小时 | P1 重要 |
| Phase 5: 性能优化 | 2-3 小时 | P2 可选 |
| Phase 6: 配置管理 | 1-2 小时 | P1 重要 |
| Phase 7: Docker 容器化 | 2-3 小时 | P0 必须 |

**总计**: 14-20 小时 (约 2-3 个工作日)

### E. 后续优化方向

1. **功能增强**
   - 支持 WebM 输出 (透明背景)
   - 支持 GIF 输出
   - 动态文本替换
   - 颜色主题替换

2. **性能提升**
   - 浏览器实例复用
   - GPU 加速渲染
   - 分布式渲染集群

3. **运维优化**
   - Prometheus 监控
   - Grafana 仪表板
   - 健康检查增强

4. **用户体验**
   - Web UI 界面
   - 实时进度推送 (WebSocket)
   - Webhook 通知

---

## 总结

本项目已成功实现基于 **Frame-by-Frame** 方案的 Lottie 渲染引擎，相比传统的 `recordVideo` 方案具有以下优势：

✅ **完美的时长控制**: 通过逐帧精确控制，完全消除时长误差
✅ **无白屏问题**: 从第一帧开始就是动画内容
✅ **性能优化**: 使用内存缓冲，将渲染速度提升 7 倍
✅ **可靠性高**: 每次渲染结果完全一致

下一步将专注于构建 HTTP API 服务和异步任务队列，为生产部署做好准备。
