# syntax=docker/dockerfile:1

# ---- 构建/测试阶段 ----
FROM node:20-alpine AS builder
WORKDIR /app

# 先拷依赖清单，尽量利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝源码并完成生产构建
COPY . .
RUN npm run build

# verify 目标：一次性运行自动化测试与生产构建后退出。
# 默认 builder 阶段以 CMD 占位；compose 的 verify 服务会显式给出命令。
CMD ["npm", "run", "test:ci"]

# ---- 生产静态服务阶段 ----
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
