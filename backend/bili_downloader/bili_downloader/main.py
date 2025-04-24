# -*- coding: utf-8 -*-
import sys
import os
import argparse
from .config.config_manager import load_config, set_cookie, ensure_folders_exist, get_download_path
from .core.network import create_headers, check_login_status
from .core.video import get_video_info, download_and_process_video
from .core.audio import extract_audio
from .core.subtitle import download_subtitle
from .utils.helpers import show_download_menu

def download_video(bv_id, download_options=None):
    """下载视频、音频和字幕"""
    if download_options is None:
        download_options = {"video": True, "audio": False, "subtitle": False}
    
    # 加载配置
    config = load_config()
    
    # 确保文件夹存在
    ensure_folders_exist(config)
    
    # 获取视频信息
    cookie = config.get("cookie", "")
    
    # 如果配置中没有cookie但存在cookie文件，则从文件读取
    if not cookie:
        cookie_paths = ['cookie.txt', 'config/cookie.txt']
        for path in cookie_paths:
            if os.path.exists(path):
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        cookie = f.read().strip()
                    if cookie:
                        # 更新配置
                        config['cookie'] = cookie
                        set_cookie(cookie)
                        print(f"已从 {path} 读取Cookie")
                        break
                except Exception as e:
                    print(f"读取 {path} 失败: {e}")
    
    headers = create_headers(cookie)
    video_info = get_video_info(bv_id, cookie)
    
    if not video_info:
        print(f"获取视频信息失败: {bv_id}")
        return False
    
    # 下载视频
    video_success = False
    video_path = ""
    
    if download_options["video"] or download_options["audio"]:
        video_success, video_path = download_and_process_video(video_info, config, download_options, headers)
    
    # 提取音频
    audio_success = False
    
    if download_options["audio"] and video_success:
        audio_path = get_download_path(config, video_info, "audio")
        
        print(f"开始提取音频...")
        audio_success = extract_audio(video_path, audio_path)
    
    # 下载字幕
    subtitle_success = False
    
    if download_options["subtitle"]:
        print(f"开始下载字幕...")
        subtitle_success = download_subtitle(video_info, config, headers)
    
    # 输出下载结果
    print("\n下载结果:")
    if download_options["video"]:
        print(f"视频: {'成功' if video_success else '失败'}")
    if download_options["audio"]:
        print(f"音频: {'成功' if audio_success else '失败'}")
    if download_options["subtitle"]:
        print(f"字幕: {'成功' if subtitle_success else '失败'}")
    
    return video_success or audio_success or subtitle_success

def main():
    parser = argparse.ArgumentParser(description="BILI-EX")
    parser.add_argument("bvid", nargs="?", help="B站视频的BV号")
    parser.add_argument("-a", "--audio", action="store_true", help="仅下载/提取音频")
    parser.add_argument("-s", "--subtitle", action="store_true", help="仅下载字幕")
    parser.add_argument("-c", "--cookie", help="设置Cookie")
    parser.add_argument("--check", action="store_true", help="检查登录状态")
    
    args = parser.parse_args()
    
    # 加载配置
    config = load_config()
    
    # 如果提供了cookie，就设置cookie
    if args.cookie:
        set_cookie(args.cookie)
        config = load_config()  # 重新加载配置
    
    # 如果配置中没有cookie但存在cookie文件，则从文件读取
    if not config.get("cookie", ""):
        cookie_paths = ['cookie.txt', 'config/cookie.txt']
        for path in cookie_paths:
            if os.path.exists(path):
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        cookie = f.read().strip()
                    if cookie:
                        # 更新配置
                        set_cookie(cookie)
                        config = load_config()  # 重新加载配置
                        print(f"已从 {path} 读取Cookie")
                        break
                except Exception as e:
                    print(f"读取 {path} 失败: {e}")
    
    # 如果指定了检查登录状态
    if args.check:
        check_login_status(config.get("cookie", ""))
        sys.exit(0)
    
    # 如果没有提供BV号，则提示输入
    bv_id = args.bvid
    
    if not bv_id:
        # 显示交互式菜单让用户选择下载内容
        print("欢迎使用BILI-EX!")
        check_login_status(config.get("cookie", ""))  # 检查登录状态
        
        # 请求输入BV号
        bv_id = input("请输入要下载的B站视频BV号: ")
        
        if not bv_id:
            print("未提供有效的BV号，退出程序")
            sys.exit(1)
        
        # 显示下载选项菜单
        download_options = show_download_menu()
        
        # 下载视频
        download_video(bv_id, download_options)
    else:
        # 根据命令行参数设置下载选项
        download_options = {
            "video": not (args.audio or args.subtitle),  # 如果指定了音频或字幕，则不下载视频
            "audio": args.audio,
            "subtitle": args.subtitle or not args.audio  # 如果未指定音频，默认下载字幕
        }
        
        # 下载视频
        download_video(bv_id, download_options)

if __name__ == "__main__":
    main()
