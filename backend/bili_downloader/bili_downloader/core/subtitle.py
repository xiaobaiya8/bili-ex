# -*- coding: utf-8 -*-
import os
import json
import requests
import time
import re
import random
import logging
from ..utils.helpers import format_time, sanitize_filename
from ..core.downloader import download_file
from ..config.config_manager import get_download_path

# 初始化日志配置
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def download_subtitle(video_info, config, headers):
    """下载字幕，返回 (bool, str|None)元组，表示成功状态和错误信息（如果失败）"""
    bv_id = video_info.get("bv_id", "未知BV") # 使用 get 避免 KeyError
    logging.info(f"[任务 {bv_id}] 进入 download_subtitle 函数")
    
    if not video_info:
        error_msg = "无法获取视频信息，无法下载字幕"
        logging.error(f"[任务 {bv_id}] {error_msg}")
        return False, error_msg
    
    # 明确检查 Cookie 存在性
    cookie_exists = "Cookie" in headers and headers["Cookie"]
    logging.info(f"[任务 {bv_id}] Cookie 检查: {'存在' if cookie_exists else '不存在或为空'}")
    if not cookie_exists:
        error_msg = "未设置有效 Cookie，无法获取 AI 字幕。请在设置中配置 Cookie。"
        logging.error(f"[任务 {bv_id}] {error_msg}")
        return False, error_msg
    
    # 使用无头浏览器获取字幕
    try:
        logging.info(f"[任务 {bv_id}] 尝试使用浏览器获取字幕...")
        success, result_msg = download_subtitle_with_browser(video_info, config, headers.get("Cookie", ""))
        logging.info(f"[任务 {bv_id}] download_subtitle_with_browser 返回: {success}, 消息: {result_msg}")
        if success:
            return True, None
        else:
            return False, result_msg # 直接返回浏览器层返回的错误
    except ImportError as e:
         error_msg = f"缺少 Playwright 依赖: {e}. 请运行 'pip install playwright && playwright install' 安装."
         logging.error(f"[任务 {bv_id}] {error_msg}")
         return False, "缺少 Playwright"
    except Exception as e:
        error_msg = f"使用无头浏览器获取字幕失败: {e}"
        logging.error(f"[任务 {bv_id}] {error_msg}")
        import traceback
        traceback.print_exc() # 打印详细的异常堆栈
        return False, f"浏览器异常: {str(e)[:50]}" # 返回简化的异常信息

def download_subtitle_with_browser(video_info, config, cookie_str):
    """使用无头浏览器获取字幕，返回 (bool, str|None)元组"""
    bv_id = video_info.get("bv_id", "未知BV")
    logging.info(f"[任务 {bv_id}] 进入 download_subtitle_with_browser 函数")
    
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
        logging.info(f"[任务 {bv_id}] Playwright 已导入")
    except ImportError as e:
        error_msg = f"导入 Playwright 失败: {e}. 请确保已安装."
        logging.error(f"[任务 {bv_id}] {error_msg}")
        # 这里再次抛出，让上层捕获并提示安装
        raise ImportError("请先安装 playwright: pip install playwright 并运行 playwright install")
    
    # 获取视频信息
    cid = video_info.get("cid")
    title = video_info.get("title")
    if not title:
         error_msg = "缺少视频标题，无法继续"
         logging.error(f"[任务 {bv_id}] {error_msg}")
         return False, error_msg
         
    # 创建视频文件夹
    safe_title = sanitize_filename(title)
    base_dir = config["download_dir"].get("base", "config/download")
    video_dir = os.path.join(base_dir, safe_title)
    debug_folder = os.path.join(video_dir, "debug")
    subtitle_folder = config["download_dir"]["subtitle"]
    
    # 确保各种目录存在
    for folder in [video_dir, debug_folder, subtitle_folder]:
        if not os.path.exists(folder):
            os.makedirs(folder)
    
    # 构建视频URL
    video_url = f"https://www.bilibili.com/video/{bv_id}"
    logging.info(f"[任务 {bv_id}] 准备使用无头浏览器访问: {video_url}")
    
    # 解析 Cookie 函数
    def parse_cookie_string_for_playwright(cookie_string):
        cookies = []
        for item in cookie_string.split(';'):
            item = item.strip()
            if not item:
                continue
            if '=' in item:
                name, value = item.split('=', 1)
                cookies.append({
                    'name': name,
                    'value': value,
                    'domain': '.bilibili.com',
                    'path': '/'
                })
        return cookies
    
    # 设置全局变量
    global_captured_subtitles = []  # 全局变量存储所有尝试中捕获的字幕
    MAX_ATTEMPTS = 3  # 最大尝试次数
    HEADLESS_MODE = True  # 无头模式
    subtitle_found = False
    last_error_msg = "未知错误"
    
    try:
        with sync_playwright() as p:
            browser = None
            try:
                # 初始化浏览器
                logging.info(f"[任务 {bv_id}] 初始化 Playwright (Firefox)...")
                browser = p.firefox.launch(headless=HEADLESS_MODE)
                
                # 进行多次尝试
                for attempt in range(1, MAX_ATTEMPTS + 1):
                    logging.info(f"[任务 {bv_id}] ===== 第 {attempt}/{MAX_ATTEMPTS} 次尝试获取字幕 =====")
                    context = None
                    page = None
                    attempt_captured_subtitles = []  # 每次尝试捕获的字幕
                    
                    try:
                        # 创建上下文和页面
                        logging.info(f"[任务 {bv_id}] 创建浏览器上下文...")
                        context = browser.new_context(
                            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0",
                            viewport={"width": 1470, "height": 770}
                        )
                        
                        # 设置网络响应监听器
                        def handle_response(response):
                            url = response.url
                            if 'aisubtitle.hdslb.com' in url and response.status == 200:
                                try:
                                    content_type = response.headers.get('content-type', '').lower()
                                    if 'json' in content_type or 'application/json' in content_type:
                                        logging.info(f"[任务 {bv_id}] [尝试 {attempt}] 捕获到字幕响应: {url}")
                                        try:
                                            # 同步读取响应文本
                                            content_text = response.text()
                                            logging.info(f"[任务 {bv_id}] [尝试 {attempt}] 成功读取响应文本 (前50字符): {content_text[:50]}")
                                            # 存储 URL 和文本内容
                                            subtitle_data = {
                                                "url": url,
                                                "text": content_text
                                            }
                                            attempt_captured_subtitles.append(subtitle_data)
                                            global_captured_subtitles.append(subtitle_data)
                                        except Exception as read_e:
                                            logging.warning(f"[任务 {bv_id}] [尝试 {attempt}] 读取字幕响应文本失败: {read_e}")
                                except Exception as resp_e:
                                    logging.error(f"[任务 {bv_id}] [尝试 {attempt}] 处理响应时出错: {resp_e}")
                        
                        # 添加 Cookie 并打开页面
                        if cookie_str:
                            logging.info(f"[任务 {bv_id}] 解析并添加 Cookie...")
                            cookies = parse_cookie_string_for_playwright(cookie_str)
                            if cookies:
                                context.add_cookies(cookies)
                                logging.info(f"[任务 {bv_id}] 已添加 {len(cookies)} 个 Cookie")
                        
                        logging.info(f"[任务 {bv_id}] 创建新页面...")
                        page = context.new_page()
                        page.on("response", handle_response)
                        
                        # 打开视频页面
                        logging.info(f"[任务 {bv_id}] 导航到视频页面: {video_url}")
                        page.goto(video_url, wait_until="domcontentloaded", timeout=60000)
                        logging.info(f"[任务 {bv_id}] 页面加载完成 (domcontentloaded)")
                        
                        # 等待播放器容器加载
                        player_container_selector = "div.bpx-player-container"
                        logging.info(f"[任务 {bv_id}] 等待播放器容器加载: {player_container_selector}")
                        player_container = page.wait_for_selector(player_container_selector, state="attached", timeout=30000)
                        logging.info(f"[任务 {bv_id}] 播放器容器已加载。")
                        
                        # 模拟鼠标悬停到播放器
                        logging.info(f"[任务 {bv_id}] 模拟鼠标悬停到播放器...")
                        player_container.scroll_into_view_if_needed()
                        time.sleep(1)
                        player_container.hover()
                        logging.info(f"[任务 {bv_id}] 鼠标已悬停。")
                        time.sleep(0.5)
                        
                        # 点击字幕按钮
                        subtitle_button_selector = "div.bpx-player-ctrl-btn.bpx-player-ctrl-subtitle"
                        subtitle_button = page.locator(subtitle_button_selector).first
                        logging.info(f"[任务 {bv_id}] 尝试点击字幕按钮...")
                        try:
                            subtitle_button.click(timeout=10000)
                            logging.info(f"[任务 {bv_id}] 字幕按钮已点击。")
                        except Exception as click_e:
                            logging.error(f"[任务 {bv_id}] 点击字幕按钮失败，尝试 JavaScript 点击: {click_e}")
                            try:
                                page.evaluate("(selector) => document.querySelector(selector).click()", subtitle_button_selector)
                                logging.info(f"[任务 {bv_id}] JavaScript 点击成功。")
                            except Exception as js_e:
                                logging.error(f"[任务 {bv_id}] JavaScript 点击也失败: {js_e}")
                                raise
                        
                        # 点击后短暂等待，确保点击事件被处理
                        time.sleep(1)
                        
                        # 检查是否已经捕获到字幕
                        if attempt_captured_subtitles:
                            logging.info(f"[任务 {bv_id}] [尝试 {attempt}] 已直接捕获 {len(attempt_captured_subtitles)} 个字幕响应")
                        
                        # 主动关闭上下文以触发字幕请求
                        logging.info(f"[任务 {bv_id}] 主动关闭上下文以触发字幕请求...")
                        
                    except Exception as e:
                        logging.error(f"[任务 {bv_id}] [尝试 {attempt}] 执行过程中出现错误: {e}")
                        import traceback
                        traceback.print_exc()
                        
                    finally:
                        # 关闭上下文 - 这可能会触发字幕请求
                        if context:
                            logging.info(f"[任务 {bv_id}] [尝试 {attempt}] 关闭浏览器上下文...")
                            try:
                                context.close()
                            except Exception as ce:
                                logging.error(f"[任务 {bv_id}] [尝试 {attempt}] 关闭上下文出错: {ce}")
                    
                    # 检查本次尝试捕获结果
                    if attempt_captured_subtitles:
                        logging.info(f"[任务 {bv_id}] [尝试 {attempt}] 在关闭上下文后发现 {len(attempt_captured_subtitles)} 个字幕响应")
                        # 如果成功捕获字幕，可以提前结束尝试
                        break
                    else:
                        logging.warning(f"[任务 {bv_id}] [尝试 {attempt}] 未捕获到字幕数据")
                        if attempt < MAX_ATTEMPTS:
                            logging.info(f"[任务 {bv_id}] 将在 2 秒后开始第 {attempt+1} 次尝试...")
                            time.sleep(2)
                
                # 处理捕获到的字幕
                subtitle_found = False
                if global_captured_subtitles:
                    logging.info(f"[任务 {bv_id}] 总共捕获到 {len(global_captured_subtitles)} 个字幕响应")
                    
                    for i, req_data in enumerate(global_captured_subtitles):
                        subtitle_url = req_data["url"]
                        content_text = req_data["text"]
                        
                        try:
                            logging.info(f"[任务 {bv_id}] 处理第 {i+1} 个字幕响应: {subtitle_url}")
                            logging.info(f"[任务 {bv_id}] 字幕响应文本 (前100字符): {content_text[:100]}")
                            
                            # 获取字幕语言标识
                            subtitle_lang = f"browser_response_{i+1}"
                            
                            # 保存字幕JSON
                            subtitle_json_path = get_download_path(config, video_info, f"subtitle_{subtitle_lang}_raw")
                            
                            try:
                                with open(subtitle_json_path, 'w', encoding='utf-8') as f:
                                    f.write(content_text)
                                logging.info(f"[任务 {bv_id}] 原始字幕 JSON 已保存到: {subtitle_json_path}")
                            except Exception as write_e:
                                 logging.error(f"[任务 {bv_id}] 保存原始字幕 JSON 失败: {write_e}")
                                 # 保存失败不影响后续解析尝试
                            
                            # 尝试解析JSON
                            try:
                                subtitle_data = json.loads(content_text)
                                logging.info(f"[任务 {bv_id}] 字幕 JSON 解析成功")
                                
                                # 检查body结构
                                if "body" in subtitle_data and isinstance(subtitle_data["body"], list):
                                    logging.info(f"[任务 {bv_id}] 找到 'body' 字段，包含 {len(subtitle_data['body'])} 条字幕")
                                    # 转换为SRT
                                    srt_path = get_download_path(config, video_info, f"subtitle_{subtitle_lang}")
                                    
                                    try:
                                        with open(srt_path, 'w', encoding='utf-8') as f:
                                            for j, line in enumerate(subtitle_data["body"]):
                                                # 添加对line结构的健壮性检查
                                                if isinstance(line, dict) and "from" in line and "to" in line and "content" in line:
                                                    start_time = format_time(line["from"])
                                                    end_time = format_time(line["to"])
                                                    content = line["content"]
                                                    
                                                    f.write(f"{j+1}\n") # 使用内部计数器j
                                                    f.write(f"{start_time} --> {end_time}\n")
                                                    f.write(f"{content}\n\n")
                                                else:
                                                    logging.warning(f"[任务 {bv_id}] 警告: 第 {j+1} 条字幕行格式不正确: {line}")
                                                    continue # 跳过格式错误的行
                                        
                                        logging.info(f"[任务 {bv_id}] 字幕已转换为SRT格式: {srt_path}")
                                        subtitle_found = True # *** 只有 SRT 写入成功才设置为 True ***
                                        
                                        # 创建主字幕文件的副本 (与BV号同名)
                                        if i == 0:  # 只用第一个字幕作为主字幕
                                            main_srt_path = get_download_path(config, video_info, "subtitle")
                                            import shutil
                                            try:
                                                shutil.copy2(srt_path, main_srt_path)
                                                logging.info(f"[任务 {bv_id}] 已创建主字幕文件: {main_srt_path}")
                                            except Exception as copy_e:
                                                logging.error(f"[任务 {bv_id}] 复制主字幕文件失败: {copy_e}")
                                                
                                    except Exception as srt_write_e:
                                        last_error_msg = f"写入 SRT 文件失败: {srt_write_e}"
                                        logging.error(f"[任务 {bv_id}] {last_error_msg}")
                                        # SRT写入失败，不能算成功
                                        subtitle_found = False
                                else:
                                    last_error_msg = f"字幕 JSON 缺少 'body' 列表结构。Keys: {subtitle_data.keys()}"
                                    logging.error(f"[任务 {bv_id}] {last_error_msg}")
                                    # 没有body，不能算成功
                                    subtitle_found = False 
                                    
                            except Exception as json_e:
                                last_error_msg = f"解析字幕JSON出错: {json_e}"
                                logging.error(f"[任务 {bv_id}] {last_error_msg}")
                                # JSON解析失败，不能算成功
                                subtitle_found = False
                                
                        except Exception as outer_e:
                            logging.error(f"[任务 {bv_id}] 处理响应内容时发生意外错误: {outer_e}")
                            last_error_msg = f"处理响应时出错: {outer_e}"
                            # 出错，不能算成功
                            subtitle_found = False
                            
                        # 如果处理某个响应成功，就跳出循环
                        if subtitle_found:
                            break
                            
                else:
                    last_error_msg = "未捕获到字幕请求"
                    logging.error(f"[任务 {bv_id}] {last_error_msg}")
            
            except Exception as e:
                last_error_msg = f"浏览器操作异常: {str(e)[:100]}" # 截断异常信息
                logging.error(f"[任务 {bv_id}] {last_error_msg}")
                import traceback
                traceback.print_exc()
                subtitle_found = False # 确保出错时为 False
            finally:
                # 确保浏览器被关闭
                if browser:
                    try:
                        browser.close()
                        logging.info(f"[任务 {bv_id}] 浏览器实例已关闭")
                    except Exception as be:
                        logging.error(f"[任务 {bv_id}] 关闭浏览器实例出错: {be}")
    
    except Exception as e:
        last_error_msg = f"浏览器操作异常: {str(e)[:100]}" # 截断异常信息
        logging.error(f"[任务 {bv_id}] {last_error_msg}")
        import traceback
        traceback.print_exc()
        subtitle_found = False # 确保出错时为 False
    finally:
        # 这里不需要操作，因为真正的浏览器关闭在with语句内部完成
        pass
    
    if subtitle_found:
        logging.info(f"[任务 {bv_id}] download_subtitle_with_browser 最终成功返回")
        return True, None
    else:
        logging.error(f"[任务 {bv_id}] download_subtitle_with_browser 最终失败返回: {last_error_msg}")
        return False, last_error_msg
