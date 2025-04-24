#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Bilibili视频下载器入口脚本
"""

import sys
import os

# 尝试从config目录读取cookie
if os.path.exists('config/cookie.txt'):
    try:
        with open('config/cookie.txt', 'r', encoding='utf-8') as f:
            cookie = f.read().strip()
        # 如果存在cookie，则添加到命令行参数中
        if cookie and len(sys.argv) > 1 and '-c' not in sys.argv and '--cookie' not in sys.argv:
            sys.argv.extend(['-c', cookie])
    except Exception as e:
        print(f"读取cookie文件失败: {e}")

from bili_downloader.bili_downloader.main import main

if __name__ == "__main__":
    main()
