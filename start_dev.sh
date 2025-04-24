#!/bin/bash

# 启动前端开发服务器
cd /app/frontend-react
echo "正在安装前端依赖..."
npm install

# 创建或更新vite.config.js文件，添加代理配置
echo "配置开发服务器代理..."
cat > vite.config.js << EOL
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:9160',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
EOL

echo "启动前端开发服务器..."
# 在后台运行前端开发服务器，监听所有网络接口
npm run dev > /app/frontend-react/frontend.log 2>&1 &
FRONTEND_PID=$!

# 等待前端服务启动
sleep 3
echo "前端开发服务器已启动 (PID: $FRONTEND_PID)"

# 如果有新建的端口，在这里添加端口映射转发

# 启动后端服务器
cd /app/backend
echo "启动后端服务器..."
python app.py

# 确保前端服务在脚本退出时也退出
trap "kill $FRONTEND_PID" EXIT 