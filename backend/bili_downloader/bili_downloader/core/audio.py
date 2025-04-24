# -*- coding: utf-8 -*-
import os
import sys
import subprocess
import time

def extract_audio(video_path, audio_path):
    """从视频中提取音频
    
    参数:
        video_path: 视频文件路径
        audio_path: 输出音频文件路径
    
    返回:
        是否成功提取
    """
    if not os.path.exists(video_path):
        print(f"视频文件不存在: {video_path}")
        sys.stdout.flush()
        return False
    
    # 确保输出目录存在
    os.makedirs(os.path.dirname(os.path.abspath(audio_path)), exist_ok=True)
    
    try:
        print(f"开始提取音频: {video_path} -> {audio_path}")
        sys.stdout.flush()
        
        start_time = time.time()
        
        # 使用FFmpeg提取音频
        command = [
            "ffmpeg",
            "-i", video_path,             # 输入文件
            "-vn",                        # 不处理视频
            "-acodec", "libmp3lame",      # 使用MP3编码器
            "-ab", "192k",                # 比特率
            "-ar", "44100",               # 采样率
            "-y",                         # 覆盖已有文件
            audio_path                    # 输出文件
        ]
        
        # 执行命令并实时输出处理进度
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )
        
        # 打印处理信息
        print("正在提取音频，请稍候...")
        sys.stdout.flush()
        
        # 读取FFmpeg输出并显示进度
        for line in process.stderr:
            if "time=" in line:
                # 提取当前处理时间，显示进度
                progress_info = line.strip()
                print(f"\r{progress_info}", end="")
                sys.stdout.flush()
        
        # 等待进程结束
        process.wait()
        
        # 检查进程返回值
        if process.returncode == 0:
            elapsed_time = time.time() - start_time
            print(f"\n音频提取成功: {audio_path} (耗时: {elapsed_time:.2f}秒)")
            sys.stdout.flush()
            return True
        else:
            print(f"\n音频提取失败，返回代码: {process.returncode}")
            sys.stdout.flush()
            return False
            
    except Exception as e:
        print(f"\n提取音频时出错: {e}")
        sys.stdout.flush()
        
        # 删除可能存在的不完整文件
        if os.path.exists(audio_path):
            try:
                os.remove(audio_path)
                print(f"已删除不完整的音频文件: {audio_path}")
                sys.stdout.flush()
            except Exception as del_e:
                print(f"无法删除不完整的音频文件: {del_e}")
                sys.stdout.flush()
        
        return False
