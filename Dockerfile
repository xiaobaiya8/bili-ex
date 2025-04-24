FROM node:18-alpine as build-stage
WORKDIR /app/frontend-react

# Copy frontend package files
COPY frontend-react/package.json frontend-react/package-lock.json ./

# Ensure node_modules is removed before installing to avoid cache issues
RUN rm -rf node_modules
# Install frontend dependencies
RUN npm install
# Install additional required packages
RUN npm install react-markdown

# Copy the rest of the frontend code
COPY frontend-react ./

# Build the frontend application
RUN npm run build

# Stage 2: Build the Python backend and serve the frontend
FROM python:3.9-slim

# 设置环境变量
ENV PYTHONPATH=/app/backend
ENV DEV_MODE=false

# 设置工作目录
WORKDIR /app/backend

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    ffmpeg \
    wget \
    gnupg \
    ca-certificates \
    # Playwright 浏览器依赖
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY backend/requirements.txt .

# 安装Python依赖
RUN pip install --no-cache-dir -r requirements.txt

# 安装Node.js (用于开发模式下启动前端)
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# 安装Playwright浏览器
RUN playwright install firefox

# 复制应用代码
COPY backend/app.py .
COPY backend/bili_downloader.py .
COPY backend/bili_downloader ./bili_downloader

# 创建必要的目录
RUN mkdir -p /app/download/video /app/download/audio /app/download/subtitle \
    && mkdir -p /app/backend/config/download

# 复制构建好的前端静态文件
RUN mkdir -p /app/backend/frontend
COPY --from=build-stage /app/frontend-react/dist /app/backend/frontend

# 创建默认配置文件
RUN echo '{"cookie":"","download_dir":{"base":"/app/backend/config/download","video":"/app/download/video","audio":"/app/download/audio","subtitle":"/app/download/subtitle"}}' > /app/backend/config/config.json && \
    echo '{"password":"admin","session_secret_key":"12345678901234567890123456789012"}' > /app/backend/config/auth_config.json && \
    touch /app/backend/config/cookie.txt

# 复制开发模式启动脚本
COPY start_dev.sh /app/start_dev.sh
RUN chmod +x /app/start_dev.sh

# 定义持久化卷
VOLUME ["/app/backend/config"]

# 暴露端口
EXPOSE 9160

# 根据环境变量选择启动方式
CMD ["/bin/bash", "-c", "if [ \"$DEV_MODE\" = \"true\" ]; then /app/start_dev.sh; else python app.py; fi"] 