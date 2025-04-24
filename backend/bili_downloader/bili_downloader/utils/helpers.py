# -*- coding: utf-8 -*-
import re

def sanitize_filename(filename):
    """清理文件名，移除不允许的字符，并将特殊连字符替换"""
    # 替换特殊连字符 (例如 em dash '—') 为标准连字符 '-'
    filename = filename.replace('—', '-')
    # 移除其他不允许用于文件名的字符
    invalid_chars = r'[\\/*?:"<>|]'
    # 将多个连续的替换字符（如下划线）合并为一个
    sanitized = re.sub(invalid_chars, "_", filename)
    sanitized = re.sub(r'_+', '_', sanitized) # 合并多个下划线
    sanitized = re.sub(r'-+', '-', sanitized) # 合并多个连字符
    # 移除可能存在的前导/尾随空格或特殊字符
    sanitized = sanitized.strip(' ._-')
    return sanitized

def format_time(seconds):
    """将秒转换为SRT时间格式 (HH:MM:SS,mmm)"""
    hours = int(seconds / 3600)
    minutes = int((seconds % 3600) / 60)
    seconds = seconds % 60
    milliseconds = int((seconds - int(seconds)) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{int(seconds):02d},{milliseconds:03d}"

def show_download_menu():
    """显示下载选项菜单"""
    print("\n请选择下载内容:")
    print("1. 只下载视频")
    print("2. 只提取音频 (需要先下载视频)")
    print("3. 只下载字幕")
    print("4. 下载视频和提取音频")
    print("5. 下载视频和字幕")
    print("6. 提取音频和下载字幕")
    print("7. 全部下载 (视频、音频和字幕)")
    
    while True:
        try:
            choice = int(input("\n请输入选项 (1-7): "))
            if 1 <= choice <= 7:
                download_options = {
                    "video": choice in [1, 4, 5, 7],
                    "audio": choice in [2, 4, 6, 7],
                    "subtitle": choice in [3, 5, 6, 7]
                }
                return download_options
            else:
                print("无效选项，请输入1-7的数字")
        except ValueError:
            print("请输入有效的数字")
