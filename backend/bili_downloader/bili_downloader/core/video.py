# -*- coding: utf-8 -*-
import os
import sys
import json
import re
import time
import requests
import subprocess
from ..utils.helpers import sanitize_filename
from ..core.downloader import download_file
from ..config.config_manager import get_download_path

def get_video_info(bv_id, cookie=""):
    """获取视频信息"""
    # 确保BV号格式正确
    if not bv_id.startswith("BV"):
        print(f"错误的BV号格式: {bv_id}，应该以'BV'开头")
        sys.stdout.flush()
        return None
    
    print(f"正在获取视频信息: {bv_id}")
    sys.stdout.flush()
    
    try:
        # 构建请求头
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': f'https://www.bilibili.com/video/{bv_id}'
        }
        
        # 如果有cookie，则添加到头部
        if cookie:
            headers['Cookie'] = cookie
        
        # 获取视频信息
        video_url = f"https://api.bilibili.com/x/web-interface/view?bvid={bv_id}"
        response = requests.get(video_url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        # 检查是否获取成功
        if data["code"] != 0:
            error_msg = data["message"]
            print(f"获取视频信息失败: {error_msg}")
            sys.stdout.flush()
            return None
        
        # 提取视频信息
        info = data["data"]
        title = sanitize_filename(info["title"])
        cid = info["cid"]
        duration = info["duration"]
        owner = info["owner"]["name"]
        desc = info.get("desc", "")
        cover_url = info.get("pic", "")
        pubdate = info.get("pubdate", 0)
        view_count = info.get("stat", {}).get("view", 0)
        danmaku_count = info.get("stat", {}).get("danmaku", 0)
        favorite_count = info.get("stat", {}).get("favorite", 0)
        coin_count = info.get("stat", {}).get("coin", 0)
        like_count = info.get("stat", {}).get("like", 0)
        
        print(f"视频标题: {title}")
        print(f"UP主: {owner}")
        print(f"时长: {format_duration(duration)}")
        sys.stdout.flush()
        
        # 返回视频信息字典
        return {
            "bv_id": bv_id,
            "cid": cid,
            "title": title,
            "duration": duration,
            "owner": owner,
            "description": desc,
            "cover_url": cover_url,
            "pubdate": pubdate,
            "view_count": view_count,
            "danmaku_count": danmaku_count,
            "favorite_count": favorite_count,
            "coin_count": coin_count,
            "like_count": like_count
        }
        
    except Exception as e:
        print(f"获取视频信息过程中出错: {e}")
        sys.stdout.flush()
        return None

def download_and_process_video(video_info, config, download_options, headers):
    """下载并处理视频"""
    bv_id = video_info["bv_id"]
    cid = video_info["cid"]
    title = video_info["title"]
    
    # 使用新的路径规则获取视频保存路径
    video_path = get_download_path(config, video_info, "video")
    
    # 下载封面图
    if video_info.get("cover_url"):
        cover_path = get_download_path(config, video_info, "poster")
        download_cover(video_info["cover_url"], cover_path, headers)
        
    # 生成NFO文件
    nfo_path = get_download_path(config, video_info, "nfo")
    generate_nfo_file(video_info, nfo_path)
    
    # 如果只需要音频且视频已存在，跳过视频下载
    if download_options.get("audio", False) and not download_options.get("video", False):
        if os.path.exists(video_path):
            print(f"视频已存在，跳过下载: {video_path}")
            return True, video_path
    
    try:
        # 获取视频下载地址
        print(f"获取视频下载地址: {bv_id}, cid={cid}")
        
        download_url = f"https://api.bilibili.com/x/player/playurl?bvid={bv_id}&cid={cid}&qn=80&otype=json&fnval=1&fnver=0"
        response = requests.get(download_url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        # 检查响应
        if data["code"] != 0:
            error_msg = data["message"]
            print(f"获取下载地址失败: {error_msg}")
            return False, ""
        
        # 提取视频地址
        durl = data["data"]["durl"][0]["url"]
        
        # 下载视频
        print(f"开始下载视频: {title}")
        
        # 确保目录存在
        os.makedirs(os.path.dirname(video_path), exist_ok=True)
        
        # 下载视频文件
        success = download_file(durl, video_path, headers)
        
        if success:
            # 如果视频下载失败，返回失败状态
            if not os.path.exists(video_path):
                print(f"下载视频失败: 文件不存在 - {video_path}")
                return False, ""
            
            # 如果只需要音频，但视频下载完成后，不需要保留视频
            if download_options.get("audio", False) and not download_options.get("video", False):
                print("只提取音频，视频文件将在提取后删除")
            
            # 返回成功和文件路径
            return True, video_path
        else:
            print(f"下载视频失败: {bv_id}")
            return False, ""
            
    except Exception as e:
        print(f"下载视频时出错: {e}")
        return False, ""

def sanitize_filename(filename):
    """移除文件名中的非法字符，避免路径问题"""
    # 移除Windows和类Unix系统中不允许的字符
    illegal_chars = r'[\\/*?:"<>|]'
    safe_name = re.sub(illegal_chars, '_', filename)
    
    # 替换其他可能导致问题的字符
    safe_name = safe_name.replace('/', '_')
    safe_name = safe_name.replace('\\', '_')
    
    # 限制长度
    if len(safe_name) > 200:
        safe_name = safe_name[:197] + '...'
    
    return safe_name

def format_duration(seconds):
    """将秒数格式化为时分秒"""
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    seconds = seconds % 60
    
    if hours > 0:
        return f"{hours}小时{minutes}分{seconds}秒"
    else:
        return f"{minutes}分{seconds}秒"

def download_cover(cover_url, cover_path, headers):
    """下载视频封面图"""
    try:
        if not cover_url:
            print("未找到封面图URL，跳过下载")
            return False
            
        # 确保目录存在
        os.makedirs(os.path.dirname(cover_path), exist_ok=True)
        
        # 下载封面图
        print(f"开始下载封面图: {cover_path}")
        response = requests.get(cover_url, headers=headers)
        response.raise_for_status()
        
        with open(cover_path, 'wb') as f:
            f.write(response.content)
            
        print(f"封面图下载完成: {cover_path}")
        return True
    except Exception as e:
        print(f"下载封面图出错: {e}")
        return False

def generate_nfo_file(video_info, nfo_path):
    """生成emby兼容的nfo文件"""
    try:
        if not video_info:
            print("无视频信息，无法生成NFO文件")
            return False
            
        # 确保目录存在
        os.makedirs(os.path.dirname(nfo_path), exist_ok=True)
        
        # 格式化发布日期
        pubdate_str = ""
        if video_info.get("pubdate"):
            from datetime import datetime
            pubdate_dt = datetime.fromtimestamp(video_info["pubdate"])
            pubdate_str = pubdate_dt.strftime("%Y-%m-%d")
        
        # 添加XML特殊字符转义函数
        def escape_xml(text):
            if text is None:
                return ""
            # 转义XML特殊字符
            text = str(text)
            text = text.replace("&", "&amp;")
            text = text.replace("<", "&lt;")
            text = text.replace(">", "&gt;")
            text = text.replace("\"", "&quot;")
            text = text.replace("'", "&apos;")
            return text
        
        # 转义所有可能包含特殊字符的字段
        title = escape_xml(video_info.get('title', ''))
        description = escape_xml(video_info.get('description', ''))
        owner = escape_xml(video_info.get('owner', ''))
        bv_id = escape_xml(video_info.get('bv_id', ''))
        
        # 构建NFO内容 (Emby兼容格式)
        nfo_content = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<movie>
    <title>{title}</title>
    <originaltitle>{title}</originaltitle>
    <sorttitle>{title}</sorttitle>
    <rating>{video_info.get('score', 0)}</rating>
    <year>{pubdate_str[:4] if pubdate_str else ''}</year>
    <premiered>{pubdate_str}</premiered>
    <releasedate>{pubdate_str}</releasedate>
    <plot>{description}</plot>
    <runtime>{video_info.get('duration', 0) / 60}</runtime>
    <thumb aspect="poster">poster.jpg</thumb>
    <uniqueid type="bilibili">{bv_id}</uniqueid>
    <director>{owner}</director>
    <studio>哔哩哔哩</studio>
    <genre>bilibili</genre>
    <tag>bilibili</tag>
    <tag>{owner}</tag>
    <!-- B站特有信息 -->
    <customrating type="view_count">{video_info.get('view_count', 0)}</customrating>
    <customrating type="danmaku_count">{video_info.get('danmaku_count', 0)}</customrating>
    <customrating type="like_count">{video_info.get('like_count', 0)}</customrating>
    <customrating type="coin_count">{video_info.get('coin_count', 0)}</customrating>
    <customrating type="favorite_count">{video_info.get('favorite_count', 0)}</customrating>
</movie>
"""
        
        # 写入文件
        with open(nfo_path, 'w', encoding='utf-8') as f:
            f.write(nfo_content)
            
        print(f"NFO文件生成完成: {nfo_path}")
        return True
    except Exception as e:
        print(f"生成NFO文件出错: {e}")
        return False
