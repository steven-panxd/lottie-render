# Docker 部署指南

## 📦 快速开始

### 1. 准备环境变量

**重要**：`docker-compose` 会自动读取同目录下的 `.env` 文件，并将其中的变量注入到容器中。

复制环境变量模板并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，设置你的 API Key：

```env
PORT=3000
NODE_ENV=production
API_KEY=your-strong-api-key-here
MAX_CONCURRENT_RENDERS=5
```

**工作原理**：
1. `docker-compose` 读取 `.env` 文件
2. `docker-compose.yml` 中的 `${API_KEY}` 会被替换为 `.env` 中的值
3. 这些值作为环境变量传递给容器

**验证配置**：
```bash
# 查看实际使用的配置（变量替换后）
docker-compose config
```

### 2. 使用 Docker Compose（推荐）

最简单的方式，一键启动：

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 3. 使用 Docker 命令

手动构建和运行：

```bash
# 构建镜像
docker build -t lottie-render-service:latest .

# 运行容器
docker run -d \
  --name lottie-service \
  -p 3000:3000 \
  -e API_KEY=your-api-key \
  -e MAX_CONCURRENT_RENDERS=5 \
  -v $(pwd)/logs:/app/logs \
  --restart unless-stopped \
  lottie-render-service:latest

# 查看日志
docker logs -f lottie-service

# 停止容器
docker stop lottie-service

# 删除容器
docker rm lottie-service
```

---

## 🔍 验证部署

### 健康检查

```bash
curl http://localhost:3000/api/health
```

预期响应：
```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2025-11-06T12:00:00.000Z",
  "memory": {
    "used": 50,
    "total": 100
  }
}
```

### 测试渲染

```bash
curl -X POST http://localhost:3000/api/render \
  -H "X-API-Key: your-api-key" \
  -F "file=@samples/template.json" \
  -F "width=1920" \
  -F "height=1080" \
  -o test.mp4
```

---

## ⚙️ 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 服务端口 |
| `NODE_ENV` | production | 运行环境 |
| `API_KEY` | - | API 密钥（必需） |
| `MAX_CONCURRENT_RENDERS` | 5 | 最大并发渲染数 |

### 资源限制

`docker-compose.yml` 中已配置默认资源限制：

- **CPU**: 最大 2 核，保留 1 核
- **内存**: 最大 2GB，保留 512MB

根据你的服务器资源调整这些值：

```yaml
deploy:
  resources:
    limits:
      cpus: '4'        # 调整 CPU 限制
      memory: 4G       # 调整内存限制
    reservations:
      cpus: '2'
      memory: 1G
```

### 并发配置建议

根据你的服务器资源和调用方并发数：

| 调用方并发 | 推荐 MAX_CONCURRENT_RENDERS | 推荐内存 |
|-----------|---------------------------|---------|
| 3 个 Worker | 5 | 2GB |
| 5 个 Worker | 8 | 3GB |
| 10 个 Worker | 12 | 4GB |

---

## 🚀 生产部署

### 1. 构建优化镜像

使用多阶段构建已经优化了镜像大小：

```bash
docker build -t lottie-render-service:v1.0.0 .
```

### 2. 推送到镜像仓库（可选）

```bash
# Docker Hub
docker tag lottie-render-service:latest your-username/lottie-render-service:v1.0.0
docker push your-username/lottie-render-service:v1.0.0

# 私有仓库
docker tag lottie-render-service:latest registry.example.com/lottie-render-service:v1.0.0
docker push registry.example.com/lottie-render-service:v1.0.0
```

### 3. 在生产服务器上部署

```bash
# 拉取镜像
docker pull your-username/lottie-render-service:v1.0.0

# 运行容器
docker run -d \
  --name lottie-service \
  -p 3000:3000 \
  -e API_KEY=${API_KEY} \
  -e MAX_CONCURRENT_RENDERS=5 \
  -v /var/log/lottie:/app/logs \
  --restart unless-stopped \
  --memory="2g" \
  --cpus="2" \
  your-username/lottie-render-service:v1.0.0
```

---

## 📊 监控和日志

### 查看日志

```bash
# 实时日志
docker-compose logs -f lottie-service

# 最近 100 行
docker-compose logs --tail=100 lottie-service

# 日志文件位置
ls -lh logs/
```

### 容器状态

```bash
# 查看容器状态
docker ps

# 查看资源使用
docker stats lottie-service

# 健康检查状态
docker inspect lottie-service | grep -A 10 Health
```

---

## 🔧 故障排查

### 容器无法启动

1. **检查日志**：
   ```bash
   docker-compose logs lottie-service
   ```

2. **检查端口占用**：
   ```bash
   lsof -i :3000
   ```

3. **检查环境变量**：
   ```bash
   docker-compose config
   ```

### Playwright 安装失败

Dockerfile 已经包含了所有必需的系统依赖。如果还有问题：

```bash
# 进入容器调试
docker-compose exec lottie-service bash

# 手动安装 Playwright
npx playwright install chromium
```

### 内存不足

如果遇到内存问题，调整 docker-compose.yml：

```yaml
deploy:
  resources:
    limits:
      memory: 4G  # 增加内存限制
```

或者减少并发数：

```env
MAX_CONCURRENT_RENDERS=3
```

### FFmpeg 错误

FFmpeg 已经在 Dockerfile 中安装。验证：

```bash
docker-compose exec lottie-service ffmpeg -version
```

---

## 🔄 更新部署

### 使用 Docker Compose

```bash
# 重新构建并重启
docker-compose up -d --build

# 或者分步骤
docker-compose build
docker-compose down
docker-compose up -d
```

### 零停机更新（可选）

如果需要零停机更新，使用 Docker Swarm 或 Kubernetes。

---

## 🛡️ 安全建议

1. **使用强 API Key**
   ```bash
   # 生成随机 API Key
   openssl rand -hex 32
   ```

2. **限制网络访问**
   - 只暴露给需要访问的服务
   - 使用防火墙规则限制来源 IP

3. **定期更新**
   - 定期更新 Node.js 基础镜像
   - 更新依赖包

4. **监控资源使用**
   - 设置合理的资源限制
   - 监控内存和 CPU 使用情况

---

## 📝 常用命令

```bash
# 启动服务
docker-compose up -d

# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 查看日志
docker-compose logs -f

# 进入容器
docker-compose exec lottie-service bash

# 查看资源使用
docker stats lottie-service

# 清理未使用的镜像
docker system prune -a
```

---

## 🎯 下一步

部署成功后：

1. ✅ 从你的 Web 应用测试调用
2. ✅ 监控性能和资源使用
3. ✅ 根据实际负载调整并发数和资源限制
4. ✅ 设置日志轮转和备份

如有问题，请查看日志或联系开发团队。
