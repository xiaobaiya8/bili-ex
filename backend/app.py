import os
import json
import secrets
import threading
# import queue # --- 不再在这里导入 queue ---
import time
import logging # 导入 logging 模块
import re
from flask import Flask, request, jsonify, send_from_directory, redirect, url_for, session
from flask_cors import CORS
from bili_downloader.bili_downloader.config.config_manager import load_config, save_config, ensure_folders_exist, get_download_path
from bili_downloader.bili_downloader.core.network import create_headers, check_login_status
from bili_downloader.bili_downloader.core.video import get_video_info, download_and_process_video
from bili_downloader.bili_downloader.core.audio import extract_audio
from bili_downloader.bili_downloader.core.subtitle import download_subtitle
# --- 从 task_manager 导入 task_queue --- 
from bili_downloader.bili_downloader.core import task_manager
from bili_downloader.bili_downloader.core.ai_summary import generate_summary
from bili_downloader.bili_downloader.core.bif import generate_bif # <-- 导入 BIF 生成函数
import openai  # 添加OpenAI库
from datetime import datetime
import requests

# 获取当前文件所在目录
current_dir = os.path.dirname(os.path.abspath(__file__))
# --- 修改: 指向新的 React 构建产物目录 --- 
# static_folder_old = os.path.join(current_dir, 'frontend/dist')
static_folder = os.path.join(current_dir, 'frontend') # Correct path as per Dockerfile copy

# 检查是否处于开发模式
DEV_MODE = os.environ.get('DEV_MODE', 'false').lower() == 'true'
if DEV_MODE:
    print("运行在开发模式下，将使用前端开发服务器")

app = Flask(__name__, static_folder=static_folder)
CORS(app)

# --- 添加日志过滤器 --- 
class RequestPathFilter(logging.Filter):
    def filter(self, record):
        # 获取请求路径，注意 Werkzeug 日志记录的格式可能不同
        # 通常消息格式为 '"GET /path HTTP/1.1" status -'
        log_message = record.getMessage()
        # 简单检查是否包含特定路径前缀
        # 可以根据实际日志格式调整检查方式
        return '/api/download/poster/' not in log_message

# 获取 Werkzeug (Flask 使用的 WSGI 服务器) 的 logger
werkzeug_logger = logging.getLogger('werkzeug')
# 添加过滤器
werkzeug_logger.addFilter(RequestPathFilter())
# ---------------------

# 密码配置文件路径
AUTH_CONFIG_FILE = '/app/backend/config/auth_config.json'

# 默认密码配置
DEFAULT_AUTH_CONFIG = {
    "password": "admin",
    "session_secret_key": secrets.token_hex(16)
}

# --- 移除 task_queue 的定义 --- 
# task_queue = queue.Queue()
# 移除内存中的任务状态存储
# task_results = {}
# task_status = {}
# task_info = {}

# 任务处理线程
def process_tasks():
    while True:
        try:
            # --- 使用导入的 task_manager.task_queue --- 
            task_id, task_type, task_params = task_manager.task_queue.get()
            if task_id:
                # 更新任务整体状态
                task_manager.update_task(task_id, {"overall_status": "处理中", "timestamp": time.time()})
                
                try:
                    if task_type == "download":
                        # --- 解包参数，现在包含 cookie --- 
                        bv_id, download_options, cookie = task_params 
                        
                        # 更新状态：获取视频信息中
                        task_manager.update_task(task_id, {"overall_status": "获取视频信息中"})
                        
                        # 先获取视频信息
                        config = load_config()
                        # --- cookie 已从 task_params 获取 --- 
                        # cookie = config.get("cookie", "") 
                        headers = create_headers(cookie)
                        video_info = get_video_info(bv_id, cookie)
                        
                        if not video_info:
                            error_msg = f"获取视频信息失败: {bv_id}"
                            task_manager.update_task(task_id, {
                                "overall_status": "失败", 
                                "error_message": error_msg,
                                "timestamp": time.time()
                            })
                        else:
                            # 1. 保存视频基本信息 (元数据) 并更新状态
                            #    将 info 和表示元数据获取成功的状态合并更新
                            task_manager.update_task(task_id, {
                                "info": {
                                    "bv_id": video_info["bv_id"],
                                    "title": video_info["title"],
                                    "owner": video_info["owner"],
                                    "description": video_info.get("description", ""),
                                    "cover_url": video_info.get("cover_url", ""),
                                    "duration": video_info.get("duration", 0),
                                    "pubdate": video_info.get("pubdate", 0),
                                    "view_count": video_info.get("view_count", 0),
                                    "danmaku_count": video_info.get("danmaku_count", 0),
                                    "favorite_count": video_info.get("favorite_count", 0),
                                    "coin_count": video_info.get("coin_count", 0),
                                    "like_count": video_info.get("like_count", 0)
                                },
                                "overall_status": "下载资源中" # 直接进入下载资源状态，因为元数据已包含
                            })
                            
                            # 2. 下载视频及其他资源
                            download_media_with_status_update(task_id, video_info, config, download_options, headers)
                            
                            # 检查最终资源状态，确定整体状态
                            final_task_data = task_manager.get_task(task_id)
                            if final_task_data:
                                all_resources_successful = True
                                resource_status = final_task_data.get('resource_status', {}) 
                                requested_resources = []
                                if download_options.get("video"): requested_resources.append("video")
                                if download_options.get("audio"): requested_resources.append("audio")
                                if download_options.get("subtitle"): requested_resources.append("subtitle")
                                # --- 如果请求了AI总结，也加入检查列表 --- 
                                if download_options.get("ai_summary"): requested_resources.append("ai_summary")
                                
                                # --- 添加详细日志 --- 
                                print(f"[任务 {task_id}] 最终状态检查：请求的资源 = {requested_resources}")
                                print(f"[任务 {task_id}] 最终状态检查：获取到的资源状态 = {resource_status}")
                                # --------------------
                                
                                for res_type in requested_resources:
                                    # --- AI 总结允许 "生成中" 状态，不立即标记失败 --- 
                                    # --- 但如果最终仍是生成中，可能需要额外处理或标记为警告 --- 
                                    # --- 这里暂时简化：只要不是 '完成' 都算未成功 --- 
                                    if resource_status.get(res_type) != "完成":
                                        print(f"[任务 {task_id}] 最终状态检查：资源 '{res_type}' 状态不是 '完成' (状态: {resource_status.get(res_type)}), 标记整体失败")
                                        all_resources_successful = False
                                        break
                                
                                if all_resources_successful:
                                     print(f"[任务 {task_id}] 最终状态检查：所有请求资源均完成，设置 overall_status = '完成'")
                                     task_manager.update_task(task_id, {"overall_status": "完成", "timestamp": time.time()})
                                else:
                                     print(f"[任务 {task_id}] 最终状态检查：部分资源失败或未完成，设置 overall_status = '失败'") # 更新日志消息
                                     # 如果有任何请求的资源失败，标记为失败
                                     task_manager.update_task(task_id, {
                                         "overall_status": "失败", 
                                         "error_message": "部分资源下载或处理失败", 
                                         "timestamp": time.time()
                                     })
                            else:
                                print(f"警告: 任务 {task_id} 在检查最终状态时未找到")
                                task_manager.update_task(task_id, {"overall_status": "失败", "error_message": "任务状态丢失", "timestamp": time.time()})
                                
                except Exception as e:
                    error_msg = str(e)
                    print(f"处理任务 {task_id} 出错: {error_msg}")
                    task_manager.update_task(task_id, {
                        "overall_status": "失败", 
                        "error_message": error_msg,
                        "timestamp": time.time()
                    })
            
            # --- 使用导入的 task_manager.task_queue --- 
            task_manager.task_queue.task_done()
        except Exception as e:
            # 这个异常通常发生在队列操作本身，比较少见
            print(f"任务队列处理线程发生严重错误: {e}")
            # 可能需要记录日志或重启线程
            time.sleep(5) # 防止快速失败循环
            continue

# 启动任务处理线程
task_thread = threading.Thread(target=process_tasks, daemon=True)
task_thread.start()

# 确保认证配置存在
def ensure_auth_config():
    global AUTH_CONFIG_FILE
    
    # 如果是目录而不是文件，则删除目录并创建文件
    if os.path.isdir(AUTH_CONFIG_FILE):
        import shutil
        try:
            shutil.rmtree(AUTH_CONFIG_FILE)
            print(f"已删除目录 {AUTH_CONFIG_FILE}")
        except Exception as e:
            print(f"删除目录 {AUTH_CONFIG_FILE} 失败: {e}")
            # 如果无法删除目录，使用不同的文件名
            AUTH_CONFIG_FILE = 'auth_config_new.json'
    
    # 如果文件不存在，创建默认配置
    if not os.path.exists(AUTH_CONFIG_FILE) or os.path.isdir(AUTH_CONFIG_FILE):
        try:
            with open(AUTH_CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(DEFAULT_AUTH_CONFIG, f, ensure_ascii=False, indent=2)
            print(f"已创建默认认证配置文件: {AUTH_CONFIG_FILE}")
            return DEFAULT_AUTH_CONFIG
        except Exception as e:
            print(f"创建认证配置文件失败: {e}")
            return DEFAULT_AUTH_CONFIG
    
    # 读取现有配置
    try:
        with open(AUTH_CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)
            return config
    except Exception as e:
        print(f"读取认证配置文件失败: {e}")
        return DEFAULT_AUTH_CONFIG

# 初始化认证配置
auth_config = ensure_auth_config()
app.secret_key = auth_config.get('session_secret_key', DEFAULT_AUTH_CONFIG['session_secret_key'])

# 登录鉴权中间件
def login_required(func):
    def wrapper(*args, **kwargs):
        if 'authenticated' not in session or not session['authenticated']:
            return redirect(url_for('login_page'))
        return func(*args, **kwargs)
    wrapper.__name__ = func.__name__
    return wrapper

# === 移除旧的前端路由 ===
# @app.route('/')
# @login_required
# def route_root():
#     return redirect(url_for('route_download'))

# @app.route('/download')
# @login_required
# def route_download():
#     return app.send_static_file('download.html')

# @app.route('/files')
# @login_required
# def route_files():
#     return app.send_static_file('files.html')

# @app.route('/settings')
# @login_required
# def route_settings():
#     return app.send_static_file('settings.html')

# @app.route('/login', methods=['GET']) # Login page is now handled by React router
# def login_page():
#     return app.send_static_file('login.html')

# === 后端 API 路由保持不变 ===

# 登录 API
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    # Ensure auth_config is loaded correctly
    password = auth_config.get('password')
    if password is not None and data and data.get('password') == password:
        session['authenticated'] = True
        # You might want to return username here if available/needed by frontend
        return jsonify({"success": True, "message": "登录成功"}), 200
    else:
        return jsonify({"success": False, "message": "密码错误"}), 401 # Use 401 Unauthorized

# 登出 API
@app.route('/logout', methods=['GET']) # Keep GET as frontend uses link/GET request
@login_required
def logout():
    session.pop('authenticated', None)
    # Redirecting is not ideal for API, return success message instead
    # return redirect(url_for('login_page'))
    return jsonify({"success": True, "message": "退出成功"}), 200

@app.route('/api/check_login', methods=['GET'])
@login_required
def api_check_login():
    # Check if session exists and is valid
    if session.get('authenticated'):
        # Optionally load username if stored or available
        username = session.get('username', '用户') # Example: get username if stored in session
        return jsonify({"success": True, "isLogin": True, "username": username}), 200
    else:
        # This case might not be reached due to @login_required, but good for clarity
        return jsonify({"success": True, "isLogin": False}), 200

@app.route('/api/set_cookie', methods=['POST'])
@login_required
def api_set_cookie():
    data = request.get_json()
    cookie = data.get('cookie', '')
    if not cookie:
        return jsonify({"success": False, "message": "Cookie不能为空"}), 400
    
    config = load_config()
    config['cookie'] = cookie
    save_config(config)
    
    return jsonify({"success": True, "message": "Cookie设置成功"})

@app.route('/api/download', methods=['POST'])
@login_required
def api_download():
    data = request.get_json()
    bv_id = data.get('bv_id', '').strip()
    options = data.get('options', {})
    
    if not bv_id:
        return jsonify({"success": False, "message": "BV号不能为空"}), 400
    
    # Normalize options
    download_options = {
        'video': options.get('video', True),
        'audio': options.get('audio', True),
        'subtitle': options.get('subtitle', True),
        'ai_summary': options.get('ai_summary', False)  # 添加AI总结选项
    }
    
    # Check if at least one option is selected
    if not any(download_options.values()):
        return jsonify({"success": False, "message": "请至少选择一项下载内容"}), 400
    
    # 确保如果选择了AI总结，则必须选择字幕
    if download_options['ai_summary'] and not download_options['subtitle']:
        return jsonify({"success": False, "message": "如果启用AI总结，必须同时选择下载字幕"}), 400
    
    # Check cookie
    config = load_config()
    cookie = config.get('cookie', '')
    
    # Create task
    task_id = task_manager.create_task(bv_id, download_options, cookie)
    
    if not task_id:
        # --- 添加更详细的日志 --- 
        print(f"创建任务失败，BV号: {bv_id}, 选项: {download_options}")
        return jsonify({"success": False, "message": "创建下载任务失败，请检查日志"}), 500
    
    return jsonify({
        "success": True, 
        "message": "下载任务已创建", 
        "task_id": task_id
    })

@app.route('/api/task/<task_id>', methods=['GET'])
@login_required
def api_task_status(task_id):
    task_data = task_manager.get_task(task_id)
    if task_data:
        # 返回任务的所有信息
        return jsonify({
            "success": True,
            **task_data # 使用解包操作合并字典
        })
    else:
        return jsonify({
            "success": False,
            "message": "任务不存在"
        }), 404

@app.route('/api/tasks/running', methods=['GET'])
@login_required
def api_running_tasks():
    running_tasks = task_manager.get_running_tasks()
    return jsonify({
        "success": True,
        "tasks": running_tasks
    })

@app.route('/api/downloads', methods=['GET'])
@login_required
def api_downloads():
    config = load_config()
    
    # 文件列表结构
    downloads = {
        "videos": []  # 改为以视频为中心的结构
    }
    
    # 处理基于标题的新目录结构
    base_dir = config['download_dir'].get('base', 'config/download')
    if os.path.exists(base_dir):
        for title_dir in os.listdir(base_dir):
            title_path = os.path.join(base_dir, title_dir)
            if os.path.isdir(title_path):
                # 收集每个视频目录的文件信息
                video_info = {
                    "title": title_dir,
                    "bv_id": None, # 初始化 bv_id 字段
                    "files": {
                        "video": None,
                        "audio": None,
                        "subtitle": None,
                        "poster": None,
                        "nfo": None
                    },
                    "metadata": {
                        "owner": "",
                        "description": "",
                        "pubdate": "",
                        "duration": 0,
                        "view_count": 0,
                        "danmaku_count": 0,
                        "like_count": 0,
                        "coin_count": 0,
                        "favorite_count": 0
                    }
                }
                
                has_files = False
                extracted_bv_id = None # 用于临时存储提取到的bv_id
                
                # 检查每个文件
                for file in os.listdir(title_path):
                    file_path = os.path.join(title_path, file)
                    if os.path.isfile(file_path):
                        file_info = {
                            "name": f"{title_dir}/{file}", # 保持相对路径格式
                            "size": os.path.getsize(file_path),
                            "modified": os.path.getmtime(file_path)
                        }
                        
                        # 尝试从文件名提取 BV ID (只需要一次)
                        if not extracted_bv_id:
                            match = re.search(r'(BV[a-zA-Z0-9]+)\.(mp4|mp3|srt)$', file)
                            if match:
                                extracted_bv_id = match.group(1)
                                video_info["bv_id"] = extracted_bv_id # 更新 video_info
                        
                        # 根据文件类型分类
                        if file.endswith(".mp4"):
                            video_info["files"]["video"] = file_info
                            has_files = True
                        elif file.endswith(".mp3"):
                            video_info["files"]["audio"] = file_info
                            has_files = True
                        elif file.endswith(".srt"):
                            video_info["files"]["subtitle"] = file_info
                            has_files = True
                        elif file.endswith(".bif"):
                            video_info["files"]["bif"] = file_info
                            # BIF 不是主要媒体文件，不设置 has_files = True
                        elif file == "poster.jpg":
                            video_info["files"]["poster"] = file_info
                        elif file == "movie.nfo":
                            video_info["files"]["nfo"] = file_info
                            # 解析NFO文件获取元数据
                            try:
                                import xml.etree.ElementTree as ET
                                tree = ET.parse(file_path)
                                root = tree.getroot()
                                
                                # 尝试提取元数据
                                video_info["metadata"]["description"] = root.findtext("plot", "")
                                video_info["metadata"]["owner"] = root.findtext("director", "")
                                runtime_text = root.findtext("runtime", "0")
                                try:
                                    video_info["metadata"]["duration"] = float(runtime_text) * 60 if runtime_text else 0
                                except ValueError:
                                    video_info["metadata"]["duration"] = 0
                                
                                # 获取完整日期，优先使用premiered，其次releasedate，最后fallback到year
                                premiere_date = root.findtext("premiered", "")
                                release_date = root.findtext("releasedate", "")
                                year = root.findtext("year", "")
                                
                                if premiere_date:
                                    video_info["metadata"]["pubdate"] = premiere_date
                                elif release_date:
                                    video_info["metadata"]["pubdate"] = release_date
                                elif year:
                                    video_info["metadata"]["pubdate"] = year
                                
                                # 提取自定义B站特有的信息
                                for custom_rating in root.findall(".//customrating"):
                                    try:
                                        rating_type = custom_rating.get("type")
                                        rating_value = custom_rating.text
                                        if rating_type and rating_value:
                                            if rating_type == "view_count":
                                                video_info["metadata"]["view_count"] = int(rating_value)
                                            elif rating_type == "danmaku_count":
                                                video_info["metadata"]["danmaku_count"] = int(rating_value)
                                            elif rating_type == "like_count":
                                                video_info["metadata"]["like_count"] = int(rating_value)
                                            elif rating_type == "coin_count":
                                                video_info["metadata"]["coin_count"] = int(rating_value)
                                            elif rating_type == "favorite_count":
                                                video_info["metadata"]["favorite_count"] = int(rating_value)
                                    except (ValueError, TypeError) as ve:
                                        print(f"警告: 解析NFO文件中的自定义评分 '{rating_type}' 失败: {ve}")
                            except ET.ParseError as pe:
                                # 捕获特定的解析错误，并打印警告
                                print(f"警告: 解析NFO文件 '{file_path}' 失败 (格式错误，可能文件正在写入): {pe}")
                                # 保留默认元数据
                            except Exception as e:
                                # 捕获其他异常
                                print(f"警告: 处理NFO文件 '{file_path}' 时发生意外错误: {e}")
                                # 保留默认元数据
                
                # 只添加有媒体文件的条目
                if has_files:
                    # 如果循环完所有文件还没提取到bv_id，可以留空或记录警告
                    if not video_info["bv_id"]:
                         print(f"警告: 未能从 '{title_dir}' 目录的文件名中提取 BV ID")
                    downloads["videos"].append(video_info)
    
    # 按照修改时间排序（使用视频文件时间，如果存在）
    def get_modified_time(video):
        if video["files"]["video"]:
            return video["files"]["video"]["modified"]
        elif video["files"]["audio"]:
            return video["files"]["audio"]["modified"]
        elif video["files"]["subtitle"]:
            return video["files"]["subtitle"]["modified"]
        return 0
    
    downloads["videos"].sort(key=get_modified_time, reverse=True)
    
    return jsonify(downloads)

@app.route('/api/download/<media_type>/<path:filename>', methods=['GET'])
@login_required
def download_file(media_type, filename):
    config = load_config()
    
    # 检查是否是新目录结构的文件路径（包含/）
    if '/' in filename:
        title_dir, file_name = filename.split('/', 1)
        base_dir = config['download_dir'].get('base', 'config/download')
        file_path = os.path.join(base_dir, title_dir, file_name)
        
        if os.path.exists(file_path):
            directory = os.path.dirname(file_path)
            return send_from_directory(directory, file_name, as_attachment=True)
    
    # 兼容旧目录结构
    if media_type not in config['download_dir']:
        return jsonify({"success": False, "message": "媒体类型不存在"}), 404
    
    directory = config['download_dir'][media_type]
    return send_from_directory(directory, filename, as_attachment=True)

@app.route('/api/config', methods=['GET'])
@login_required
def get_config():
    config = load_config()
    # 不再隐藏cookie
    return jsonify(config)

@app.route('/api/change_password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json()
    new_password = data.get('password', '')
    
    if not new_password:
        return jsonify({"success": False, "message": "新密码不能为空"}), 400
    
    auth_config['password'] = new_password
    try:
        with open(AUTH_CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(auth_config, f, ensure_ascii=False, indent=2)
        return jsonify({"success": True, "message": "密码修改成功"})
    except Exception as e:
        return jsonify({"success": False, "message": f"密码修改失败: {str(e)}"}), 500

@app.route('/api/test_cookie', methods=['POST'])
@login_required
def api_test_cookie():
    data = request.get_json()
    cookie = data.get('cookie', '')
    
    if not cookie or cookie.strip() == '':
        return jsonify({
            'success': False,
            'message': 'Cookie为空或未设置',
            'username': '未知'
        })
    
    # 使用network.py中的check_login_status函数测试cookie
    from bili_downloader.bili_downloader.core.network import check_login_status
    login_status = check_login_status(cookie, return_json=True)
    
    # 检查登录状态并确保用户名非空
    if login_status['isLogin'] and login_status['username'] and login_status['username'] != '未知':
        return jsonify({
            'success': True,
            'username': login_status['username'],
            'message': '登录成功'
        })
    else:
        # 登录失败
        return jsonify({
            'success': False,
            'username': login_status.get('username', '未知'),
            'message': login_status.get('message', 'Cookie无效或已过期')
        })

@app.route('/api/set_openai_config', methods=['POST'])
@login_required
def api_set_openai_config():
    """
    向后兼容的旧路由，调用 api_set_ai_config
    """
    return api_set_ai_config()

@app.route('/api/set_ai_config', methods=['POST'])
@login_required
def api_set_ai_config():
    """
    设置 AI 配置（支持 OpenAI 和 Claude）
    """
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "提交数据为空"}), 400
    
    # 获取 AI 提供商
    ai_provider = data.get('ai_provider', 'openai')
    
    # 获取 OpenAI 配置
    openai_base_url = data.get('openai_base_url')
    openai_api_key = data.get('openai_api_key')
    openai_model = data.get('openai_model')
    
    # 获取 Claude 配置
    claude_base_url = data.get('claude_base_url')
    claude_api_key = data.get('claude_api_key')
    claude_model = data.get('claude_model')
    
    ai_summary_prefs = data.get('ai_summary_prefs')
    
    # --- 校验 ai_summary_prefs 结构 --- 
    if not isinstance(ai_summary_prefs, dict):
        return jsonify({"success": False, "message": "AI偏好设置格式错误"}), 400
        
    content_focus = ai_summary_prefs.get('content_focus')
    purpose = ai_summary_prefs.get('purpose')
    
    # --- 校验 content_focus 是否为列表 --- 
    if not isinstance(content_focus, list):
        return jsonify({"success": False, "message": "内容侧重必须是列表格式"}), 400
    
    # 根据选择的提供商检查必需参数    
    if ai_provider == 'openai':
        if not openai_base_url or not openai_api_key:
            return jsonify({"success": False, "message": "OpenAI配置不完整"}), 400
    elif ai_provider == 'claude':
        if not claude_base_url or not claude_api_key:
            return jsonify({"success": False, "message": "Claude配置不完整"}), 400
    else:
        return jsonify({"success": False, "message": f"不支持的AI提供商: {ai_provider}"}), 400
    
    config = load_config()
    
    # 保存 AI 提供商设置
    config['ai_provider'] = ai_provider
    
    # 保存 OpenAI 配置
    if ai_provider == 'openai' or (openai_base_url and openai_api_key):
        config['openai_base_url'] = openai_base_url
        config['openai_api_key'] = openai_api_key
        
        # 保存模型名称，如果为空则移除该键
        if openai_model:
            config['openai_model'] = openai_model
        elif 'openai_model' in config:
            del config['openai_model']
    
    # 保存 Claude 配置
    if ai_provider == 'claude' or (claude_base_url and claude_api_key):
        config['claude_base_url'] = claude_base_url
        config['claude_api_key'] = claude_api_key
        
        # 保存模型名称，如果为空则移除该键
        if claude_model:
            config['claude_model'] = claude_model
        elif 'claude_model' in config:
            del config['claude_model']
        
    # --- 保存完整的 ai_summary_prefs --- 
    config['ai_summary_prefs'] = ai_summary_prefs
    
    # --- 确保保存时移除 output_type (如果之前残留) ---
    if 'ai_summary_prefs' in config and isinstance(config['ai_summary_prefs'], dict):
        config['ai_summary_prefs'].pop('output_type', None)
        
    save_config(config)
    
    return jsonify({"success": True, "message": f"{ai_provider.capitalize()} 配置保存成功"})

@app.route('/api/generate_ai_summary', methods=['POST'])
@login_required
def api_generate_ai_summary():
    data = request.get_json()
    subtitle_path_from_req = data.get('subtitle_path')
    bv_id = data.get('bv_id')
    title = data.get('title')
    
    if not bv_id or not title:
        return jsonify({"success": False, "message": "缺少 BV 号或标题"}), 400
        
    config = load_config()
    
    # 使用 bv_id 和 title 构建 video_info 以获取路径
    video_info_for_path = {"title": title, "bv_id": bv_id}
    try:
        # --- 获取路径，依赖 get_download_path 内部的清理 --- 
        full_summary_path = get_download_path(config, video_info_for_path, "ai_summary")
        full_subtitle_path_for_check = get_download_path(config, video_info_for_path, "subtitle") # 用于生成
        
        # --- 从完整路径推断相对路径 --- 
        base_dir = config['download_dir'].get('base', 'config/download')
        try:
            # 计算相对于 base_dir 的路径
            summary_relative_path = os.path.relpath(full_summary_path, base_dir)
            subtitle_relative_path = os.path.relpath(full_subtitle_path_for_check, base_dir)
            # 替换 Windows 路径分隔符
            summary_relative_path = summary_relative_path.replace('\\', '/')
            subtitle_relative_path = subtitle_relative_path.replace('\\', '/')
        except ValueError as rel_e:
             # 如果路径不在 base_dir 下（理论上不应发生），则回退
             print(f"计算相对路径时出错: {rel_e}, full_path={full_summary_path}, base_dir={base_dir}")
             # 使用之前的方法构建相对路径作为回退
             from bili_downloader.bili_downloader.utils.helpers import sanitize_filename
             safe_title = sanitize_filename(title)
             summary_relative_path = f"{safe_title}/{os.path.basename(full_summary_path)}"
             subtitle_relative_path = f"{safe_title}/{bv_id}.srt"

        print(f"[检查存在性] 完整路径: {full_summary_path}")
        print(f"[检查存在性] 相对路径 (返回): {summary_relative_path}")
        print(f"[检查存在性] 字幕相对路径 (生成): {subtitle_relative_path}")
        
    except Exception as path_e:
        print(f"构建路径时出错 ({title}, {bv_id}): {path_e}")
        import traceback
        traceback.print_exc() # 打印更详细的错误
        return jsonify({"success": False, "message": "构建文件路径失败"}), 500
    
    # 使用获取到的 full_summary_path 检查文件是否存在
    if os.path.exists(full_summary_path):
        print(f"AI总结文件已存在: {full_summary_path}，直接返回")
        return jsonify({
            "success": True, 
            "message": "AI总结已存在", 
            "summary_path": summary_relative_path # 返回相对路径
        })
    
    # 如果不存在，则继续生成
    # 检查 AI 配置
    ai_provider = config.get('ai_provider', 'openai')
    
    if ai_provider == 'openai':
        openai_base_url = config.get('openai_base_url')
        openai_api_key = config.get('openai_api_key')
        
        if not openai_base_url or not openai_api_key:
            return jsonify({"success": False, "message": "请先在设置中配置 OpenAI 参数"}), 400
    elif ai_provider == 'claude':
        claude_base_url = config.get('claude_base_url')
        claude_api_key = config.get('claude_api_key')
        
        if not claude_base_url or not claude_api_key:
            return jsonify({"success": False, "message": "请先在设置中配置 Claude 参数"}), 400
    else:
        return jsonify({"success": False, "message": f"不支持的 AI 提供商: {ai_provider}"}), 400
    
    # 调用 generate_summary 函数，传递 *相对字幕路径*
    try:
        print(f"调用 generate_summary 生成 '{subtitle_relative_path}' 的总结，使用 {ai_provider} API...")
        # --- 确保 generate_summary 使用的是正确的相对路径 --- 
        success, result = generate_summary(subtitle_relative_path, config)
        
        if success:
            # 保存生成的总结 JSON 字符串到 *完整路径*
            summary_json_string = result
            os.makedirs(os.path.dirname(full_summary_path), exist_ok=True)
            with open(full_summary_path, 'w', encoding='utf-8') as f:
                f.write(summary_json_string)
            
            return jsonify({
                "success": True, 
                "message": "AI总结生成成功", 
                "summary_path": summary_relative_path # 返回相对路径
            })
        else:
            # 生成失败，result 是错误消息
            return jsonify({"success": False, "message": f"生成AI总结失败: {result}"}), 500

    except Exception as e:
        print(f"处理 AI 总结请求时出错: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"处理AI总结时发生内部错误: {str(e)}"}), 500

# 修改后的下载辅助函数，用于更新状态
def download_media_with_status_update(task_id, video_info, config, download_options, headers):
    """下载视频、音频和字幕，并实时更新任务状态，完成后触发AI总结（如果需要）"""
    
    bv_id = video_info["bv_id"]
    print(f"[任务 {task_id}] 开始处理 {bv_id}，选项: {download_options}")
    resource_updates = {}

    # 1. 下载视频和封面、NFO
    video_path = ""
    video_success = False
    if download_options.get("video") or download_options.get("audio"): 
        resource_updates['video'] = "下载中"
        task_manager.update_task(task_id, {"resource_status": resource_updates})
        try:
            # 确保文件存在，但如果存在则只返回信息，不重新下载
            if os.path.exists(video_path):
                print(f"[任务 {task_id}] 视频文件已存在: {video_path}")
                video_success = True # 标记为成功以便后续处理（如BIF）
            else:
                print(f"[任务 {task_id}] 开始下载视频...")
                video_success, video_path = download_and_process_video(video_info, config, download_options, headers)
            resource_updates['video'] = "完成" if video_success else "失败"
        except Exception as e:
            print(f"下载视频出错 ({bv_id}): {e}")
            resource_updates['video'] = "失败"
        task_manager.update_task(task_id, {"resource_status": resource_updates})

    # 2. 提取音频
    audio_success = False
    if download_options.get("audio"): 
        if video_success:
            resource_updates['audio'] = "提取中"
            task_manager.update_task(task_id, {"resource_status": resource_updates})
            try:
                audio_path = get_download_path(config, video_info, "audio")
                audio_success = extract_audio(video_path, audio_path)
                print(f"[任务 {task_id}] 音频提取调用完成，audio_success={audio_success}")
                resource_updates['audio'] = "完成" if audio_success else "失败"
            except Exception as e:
                print(f"提取音频出错 ({bv_id}): {e}")
                resource_updates['audio'] = "失败"
            task_manager.update_task(task_id, {"resource_status": resource_updates})
        else:
             resource_updates['audio'] = "失败 (依赖视频)"
             task_manager.update_task(task_id, {"resource_status": resource_updates})

    # 3. 下载字幕
    subtitle_success = False # 初始化字幕成功状态
    print(f"[任务 {task_id}] 检查字幕下载选项: {download_options.get('subtitle')}")
    if download_options.get("subtitle"):
        print(f"[任务 {task_id}] 选项包含字幕，尝试下载...")
        resource_updates['subtitle'] = "下载中"
        task_manager.update_task(task_id, {"resource_status": resource_updates})
        try:
            subtitle_timeout = 180
            subtitle_result_holder = {"success": False, "error": "未开始"}
            max_retries = 3
            retry_delay = 5
            
            def subtitle_worker():
                 for attempt in range(1, max_retries + 1):
                     print(f"[任务 {task_id} - 字幕线程] 尝试第 {attempt}/{max_retries} 次...")
                     attempt_success = False
                     attempt_error = "尝试失败"
                     try:
                         print(f"[任务 {task_id} - 字幕线程] 调用 download_subtitle")
                         attempt_success, attempt_error = download_subtitle(video_info, config, headers)
                         print(f"[任务 {task_id} - 字幕线程] download_subtitle 返回: success={attempt_success}, error='{attempt_error}'")
                         
                         if attempt_success:
                             subtitle_result_holder["success"] = True
                             subtitle_result_holder["error"] = None
                             print(f"[任务 {task_id} - 字幕线程] 第 {attempt} 次尝试成功")
                             break
                         else:
                             subtitle_result_holder["success"] = False
                             subtitle_result_holder["error"] = attempt_error or "下载失败"
                             print(f"[任务 {task_id} - 字幕线程] 第 {attempt} 次尝试失败: {attempt_error}")
                             
                     except Exception as sub_e:
                         print(f"[任务 {task_id} - 字幕线程] 第 {attempt} 次尝试时发生异常: {sub_e}")
                         subtitle_result_holder["success"] = False
                         subtitle_result_holder["error"] = f"线程异常: {str(sub_e)[:50]}"
                     
                     if not subtitle_result_holder["success"] and attempt < max_retries:
                         print(f"[任务 {task_id} - 字幕线程] 等待 {retry_delay} 秒后重试...")
                         time.sleep(retry_delay)
                 print(f"[任务 {task_id} - 字幕线程] 重试结束，最终结果: success={subtitle_result_holder['success']}, error='{subtitle_result_holder['error']}'")

            subtitle_thread = threading.Thread(target=subtitle_worker)
            subtitle_thread.start()
            total_timeout = subtitle_timeout * max_retries + retry_delay * (max_retries - 1) + 30
            subtitle_thread.join(total_timeout)

            if subtitle_thread.is_alive():
                print(f"[任务 {task_id}] 字幕下载整体超时 ({bv_id})，放弃下载")
                resource_updates['subtitle'] = "失败 (总超时)"
                subtitle_success = False # 明确失败
            else:
                subtitle_success = subtitle_result_holder["success"]
                final_error = subtitle_result_holder["error"]
                if subtitle_success:
                    resource_updates['subtitle'] = "完成"
                    print(f"[任务 {task_id}] 字幕下载成功")  # 添加明确的成功日志
                else:
                    error_reason = final_error or "未知原因"
                    print(f"[任务 {task_id}] 字幕下载最终失败: {error_reason}")
                    resource_updates['subtitle'] = f"失败 ({error_reason[:30].strip()})"
                
        except Exception as e:
            print(f"[任务 {task_id}] 下载字幕主逻辑出错: {e}")
            resource_updates['subtitle'] = "失败 (逻辑错误)"
            subtitle_success = False # 明确失败
            
        task_manager.update_task(task_id, {"resource_status": resource_updates})
    else:
        print(f"[任务 {task_id}] 未请求下载字幕，跳过")

    # --- 4. 触发 AI 总结 (如果需要) --- 
    print(f"[任务 {task_id}] 字幕成功状态: {subtitle_success}, AI总结选项: {download_options.get('ai_summary')}")  # 添加调试信息
    
    if download_options.get('ai_summary'):
        print(f"[任务 {task_id}] 检测到AI总结选项已开启")
        if subtitle_success:
            print(f"[任务 {task_id}] 字幕下载成功，开始生成 AI 总结...")
            resource_updates['ai_summary'] = "生成中" # 更新AI总结状态
            task_manager.update_task(task_id, {"resource_status": resource_updates})
            try:
                # --- 添加日志：检查 video_info --- 
                print(f"[任务 {task_id}] 准备生成AI总结，检查 video_info: {video_info}")
                # --------------------------------
                
                # 获取字幕的相对路径 (基于视频信息)
                subtitle_relative_path = f"{video_info['title']}/{video_info['bv_id']}.srt"
                print(f"[任务 {task_id}] 构建字幕相对路径: {subtitle_relative_path}")
                
                # 检查字幕文件是否存在
                base_download_dir = os.path.join(os.getcwd(), 'config/download')
                full_subtitle_path = os.path.join(base_download_dir, subtitle_relative_path)
                
                # 添加文件检查的重试机制，解决文件系统延迟导致的文件不可见问题
                max_file_check_retries = 5
                file_check_delay = 2  # 每次重试间隔2秒
                file_exists = False
                
                for file_check_attempt in range(max_file_check_retries):
                    if os.path.exists(full_subtitle_path):
                        file_exists = True
                        print(f"[任务 {task_id}] 字幕文件存在，路径: {full_subtitle_path} (第{file_check_attempt+1}次检查)")
                        break
                    else:
                        print(f"[任务 {task_id}] 字幕文件不存在，路径: {full_subtitle_path} (第{file_check_attempt+1}次检查，等待{file_check_delay}秒后重试)")
                        time.sleep(file_check_delay)
                
                if file_exists:
                    # 确保文件系统完成写入操作，额外等待1秒
                    time.sleep(1)
                    # 调用生成函数
                    ai_success, ai_result = generate_summary(subtitle_relative_path, config)
                    
                    if ai_success:
                         # AI 调用成功，保存文件 (generate_summary 返回的是JSON字符串)
                         summary_json_string = ai_result
                         summary_filename = get_download_path(config, video_info, "ai_summary")
                         os.makedirs(os.path.dirname(summary_filename), exist_ok=True)
                         with open(summary_filename, 'w', encoding='utf-8') as f:
                             f.write(summary_json_string)
                         print(f"[任务 {task_id}] AI 总结已保存到 {summary_filename}")
                         resource_updates['ai_summary'] = "完成"
                    else:
                         # AI 调用失败，ai_result 是错误信息
                         print(f"[任务 {task_id}] AI 总结生成失败: {ai_result}")
                         resource_updates['ai_summary'] = f"失败 ({str(ai_result)[:30]})"
                else:
                    print(f"[任务 {task_id}] 经过多次尝试，字幕文件仍然不存在，路径: {full_subtitle_path}")
                    resource_updates['ai_summary'] = "失败 (字幕文件不存在)"
            except Exception as ai_e:
                print(f"[任务 {task_id}] 生成 AI 总结过程中发生异常: {ai_e}")
                import traceback
                traceback.print_exc()  # 打印完整堆栈跟踪
                resource_updates['ai_summary'] = "失败 (异常)"
            finally:
                # 无论成功失败，都更新最终状态
                task_manager.update_task(task_id, {"resource_status": resource_updates})
        else:
             print(f"[任务 {task_id}] 请求了AI总结，但字幕下载失败，跳过生成")
             resource_updates['ai_summary'] = "失败 (依赖字幕)"
             task_manager.update_task(task_id, {"resource_status": resource_updates})
    else:
        print(f"[任务 {task_id}] 未请求 AI 总结，跳过")

    # --- 5. 生成 BIF 文件 (如果视频下载成功) ---
    if video_success:
        print(f"[任务 {task_id}] 视频处理成功，开始生成 BIF 文件...")
        resource_updates['bif'] = "生成中"
        task_manager.update_task(task_id, {"resource_status": resource_updates})
        try:
            bif_path = get_download_path(config, video_info, "bif")
            # 调用生成函数 (假设 video_path 在 video_success 为 True 时有效)
            bif_success, bif_error = generate_bif(video_path, bif_path)
            
            if bif_success:
                resource_updates['bif'] = "完成"
                print(f"[任务 {task_id}] BIF 文件生成成功: {bif_path}")
            else:
                error_msg = f"失败 ({str(bif_error)[:50]})" # 限制错误消息长度
                resource_updates['bif'] = error_msg
                print(f"[任务 {task_id}] BIF 文件生成失败: {bif_error}")
        except Exception as bif_e:
            print(f"[任务 {task_id}] 生成 BIF 文件过程中发生异常: {bif_e}")
            import traceback
            traceback.print_exc() # 打印完整堆栈跟踪
            resource_updates['bif'] = "失败 (异常)"
        finally:
            # 无论成功失败，都更新最终状态
            task_manager.update_task(task_id, {"resource_status": resource_updates})
    else:
        print(f"[任务 {task_id}] 视频处理失败，跳过生成 BIF 文件")
        # 可以选择性地将BIF状态标记为 N/A 或 失败(依赖视频)
        resource_updates['bif'] = "N/A (无视频)"
        task_manager.update_task(task_id, {"resource_status": resource_updates})

    # --- 资源处理结束 --- 
    final_resource_status = task_manager.get_task(task_id).get('resource_status', {})
    print(f"任务 {task_id} 资源处理完成，状态: {final_resource_status}")

# --- 添加 Catch-all 路由来服务 React App --- 
# This route should be defined *after* all your API routes
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_react_app(path):
    # 如果在开发模式下，将请求代理到前端开发服务器
    if DEV_MODE:
        target_url = f"http://localhost:5173/{path}"
        print(f"开发模式: 代理请求到前端开发服务器 {target_url}")
        response = requests.get(target_url)
        return (response.text, response.status_code, response.headers.items())
    
    # 添加明确的静态文件类型映射
    mime_types = {
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
    }
    
    # 检查是否是静态资源请求
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        # 获取文件扩展名
        _, ext = os.path.splitext(path)
        # 如果是有特定MIME类型的文件，设置正确的MIME类型
        if ext in mime_types:
            return send_from_directory(app.static_folder, path, mimetype=mime_types[ext])
        # 否则使用默认MIME类型
        return send_from_directory(app.static_folder, path)
    else:
        # 对于SPA路由，返回index.html
        return send_from_directory(app.static_folder, 'index.html')

# 启动应用
if __name__ == '__main__':
    config = load_config()  # 先加载配置
    ensure_folders_exist(config)  # 使用加载的配置确保文件夹存在
    # Make sure host is 0.0.0.0 to be accessible from outside the container
    app.run(host='0.0.0.0', port=9160, debug=False) # Set debug=False for production 