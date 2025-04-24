# -*- coding: utf-8 -*-
import os
import json

# 配置文件路径 - 使用Docker容器中的持久化路径
CONFIG_FILE = '/app/backend/config/config.json'

def load_config():
    """加载配置，如果不存在则创建默认配置"""
    default_config = {
        "cookie": "",
        "download_dir": {
            "base": "/app/backend/config/download",  # 使用持久化路径
            "video": "backend/bilibili_video",
            "audio": "backend/bilibili_audio",
            "subtitle": "backend/bilibili_subtitle"
        }
    }
    
    if not os.path.exists(CONFIG_FILE):
        # 确保父目录存在
        config_dir = os.path.dirname(CONFIG_FILE)
        if config_dir and not os.path.exists(config_dir):
            os.makedirs(config_dir)
            
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(default_config, f, ensure_ascii=False, indent=2)
        return default_config
    
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)
            
        # 确保所有默认键存在
        if "cookie" not in config:
            config["cookie"] = default_config["cookie"]
        if "download_dir" not in config:
            config["download_dir"] = default_config["download_dir"]
        else:
            for key in default_config["download_dir"]:
                if key not in config["download_dir"]:
                    config["download_dir"][key] = default_config["download_dir"][key]
                    
        return config
    except Exception as e:
        print(f"加载配置文件失败: {e}")
        return default_config

def save_config(config):
    """保存配置到文件"""
    try:
        # 确保父目录存在
        config_dir = os.path.dirname(CONFIG_FILE)
        if config_dir and not os.path.exists(config_dir):
            os.makedirs(config_dir)
            
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        print(f"配置已保存到持久化路径: {CONFIG_FILE}")
        return True
    except Exception as e:
        print(f"保存配置文件失败: {e}")
        return False

def set_cookie(cookie_str):
    """设置cookie"""
    config = load_config()
    config["cookie"] = cookie_str
    success = save_config(config)
    if success:
        print("Cookie已更新")
    else:
        print("Cookie更新失败")
    return success

def ensure_folders_exist(config):
    """确保所有必要的文件夹存在"""
    # 确保基础下载目录存在 - 使用Docker容器中的持久化路径
    base_dir = "/app/backend/config/download"
    
    if not os.path.exists(base_dir):
        os.makedirs(base_dir)
        print(f"创建基础下载目录: {base_dir}")
        
    # 旧版兼容：创建独立的媒体类型目录
    for folder_key in ["video", "audio", "subtitle"]:
        folder_path = config["download_dir"][folder_key]
        
        # 如果是相对路径，转为绝对路径
        if not os.path.isabs(folder_path):
            # 获取项目根目录
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.."))
            folder_path = os.path.join(project_root, folder_path)
            
        if not os.path.exists(folder_path):
            os.makedirs(folder_path)
            print(f"创建文件夹: {folder_path}")

def get_download_path(config, video_info, media_type):
    """根据视频信息获取下载路径
    
    Args:
        config: 配置信息
        video_info: 视频信息字典
        media_type: 媒体类型，'video', 'audio', 'subtitle'，以及新增的'poster'和'nfo'
        
    Returns:
        下载路径字符串
    """
    from ..utils.helpers import sanitize_filename
    
    bv_id = video_info["bv_id"]
    title = video_info["title"]
    
    # --- 添加日志：打印原始标题和清理后的标题 ---
    print(f"[get_download_path] 原始标题: '{title}'")
    safe_title = sanitize_filename(title)
    print(f"[get_download_path] 清理后标题 (safe_title): '{safe_title}'")
    # --- 添加检查：如果清理后标题为空，则抛出错误或使用默认值 ---
    if not safe_title:
        print(f"[get_download_path] 错误：清理后的标题为空！原始标题: '{title}'")
        # 可以选择抛出错误或使用默认名称
        # raise ValueError(f"无法从标题 '{title}' 生成有效的文件名") 
        safe_title = f"Untitled_{bv_id}" # 使用默认名称作为回退
        print(f"[get_download_path] 使用默认标题: '{safe_title}'")
        
    # 直接使用Docker容器中的持久化路径
    base_dir = "/app/backend/config/download"
    print(f"使用持久化存储目录: {base_dir}")
    
    video_dir = os.path.join(base_dir, safe_title)
    
    # 确保视频目录存在
    if not os.path.exists(video_dir):
        os.makedirs(video_dir)
        print(f"创建视频目录: {video_dir}")
    
    # 根据媒体类型确定文件名
    if media_type == "video":
        file_path = os.path.join(video_dir, f"{bv_id}.mp4")
        print(f"视频将保存到: {file_path}")
        return file_path
    elif media_type == "audio":
        file_path = os.path.join(video_dir, f"{bv_id}.mp3")
        print(f"音频将保存到: {file_path}")
        return file_path
    elif media_type == "subtitle":
        file_path = os.path.join(video_dir, f"{bv_id}.srt")
        print(f"字幕将保存到: {file_path}")
        return file_path
    elif media_type == "poster":
        # 为Emby兼容，使用poster.jpg文件名
        file_path = os.path.join(video_dir, "poster.jpg")
        print(f"封面图将保存到: {file_path}")
        return file_path
    elif media_type == "nfo":
        # 为Emby兼容，使用movie.nfo文件名
        file_path = os.path.join(video_dir, "movie.nfo")
        print(f"NFO文件将保存到: {file_path}")
        return file_path
    elif media_type == "ai_summary":
        file_path = os.path.join(video_dir, f"{bv_id}_ai_summary.json")
        print(f"AI总结将保存到: {file_path}")
        return file_path
    elif media_type == "bif":
        file_path = os.path.join(video_dir, f"{bv_id}.bif")
        print(f"BIF文件将保存到: {file_path}")
        return file_path
    elif media_type == "subtitle_json":
        return os.path.join(video_dir, f"{bv_id}_raw.json")
    elif media_type.startswith("subtitle_"):
        # 针对特定语言的字幕
        lang = media_type[9:]  # 去掉"subtitle_"
        return os.path.join(video_dir, f"{bv_id}_{lang}.srt")
    else:
        # 默认情况下使用持久化路径
        print(f"警告：未知的媒体类型 '{media_type}'，将使用默认路径格式")
        return os.path.join(base_dir, f"{safe_title}_{bv_id}.{media_type}")
