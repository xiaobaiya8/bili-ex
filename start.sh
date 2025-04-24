#!/bin/bash

# 创建必要的目录
echo "创建必要的目录..."
mkdir -p config/download
mkdir -p backend/bilibili_video
mkdir -p backend/bilibili_audio
mkdir -p backend/bilibili_subtitle

# 检查是否存在配置文件，如果不存在则创建
if [ ! -f config/config.json ]; then
    echo '创建默认配置文件...'
    cat > config/config.json << EOL
{
    "cookie": "",
    "download_dir": {
        "base": "/app/backend/config/download",
        "video": "/app/download/video",
        "audio": "/app/download/audio",
        "subtitle": "/app/download/subtitle"
    }
}
EOL
fi

# 确保auth_config.json存在
if [ ! -f config/auth_config.json ]; then
    echo '创建默认认证配置文件...'
    cat > config/auth_config.json << EOL
{
    "password": "admin",
    "session_secret_key": "12345678901234567890123456789012"
}
EOL
fi

# 确保cookie.txt存在
if [ ! -f config/cookie.txt ]; then
    echo '创建空cookie文件...'
    touch config/cookie.txt
fi

# 运行Docker Compose
echo '启动Docker容器...'
docker-compose up --build

echo '启动完成，服务运行在 http://localhost:9160' 