# -*- coding: utf-8 -*-
import os
import sys
import requests
import time
from tqdm import tqdm

def download_file(url, file_path, headers=None, chunk_size=1024*1024):
    """下载文件并显示进度条
    
    参数:
        url: 下载链接
        file_path: 保存路径
        headers: 请求头
        chunk_size: 分块大小，单位为字节
    
    返回:
        下载是否成功
    """
    try:
        # 创建必要的目录
        os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
        
        # 发起请求
        response = requests.get(url, headers=headers, stream=True)
        response.raise_for_status()
        
        # 获取文件大小
        total_size = int(response.headers.get('content-length', 0))
        
        # 初始化进度条
        progress_bar = tqdm(
            total=total_size,
            unit='B',
            unit_scale=True,
            unit_divisor=1024,
            desc=f"下载视频: ",
            ascii=False,
            ncols=100,
            bar_format="{desc} |{bar}| {percentage:.1f}% - {n_fmt}/{total_fmt} ({rate_fmt})"
        )
        
        # 使用with语句确保文件正确关闭
        with open(file_path, 'wb') as f:
            downloaded_size = 0
            
            # 分块下载
            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)
                    progress_bar.update(len(chunk))
                    # 强制刷新输出，确保实时显示进度
                    sys.stdout.flush()
                    
                    # 定期刷新文件，保证数据写入磁盘
                    if downloaded_size % (10 * chunk_size) == 0:
                        f.flush()
            
        # 关闭进度条
        progress_bar.close()
        
        # 打印完成信息
        print(f"视频下载完成: {file_path}")
        sys.stdout.flush()  # 确保消息立即显示
        
        # 校验文件大小
        if total_size > 0 and os.path.getsize(file_path) != total_size:
            print(f"警告: 文件大小不匹配，预期 {total_size}，实际 {os.path.getsize(file_path)}")
            sys.stdout.flush()  # 确保消息立即显示
            return False
        
        return True
        
    except Exception as e:
        print(f"下载失败: {e}")
        sys.stdout.flush()  # 确保错误消息立即显示
        
        # 如果文件已经创建，但下载失败，则删除不完整的文件
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                print(f"已删除不完整的文件: {file_path}")
                sys.stdout.flush()  # 确保消息立即显示
            except Exception as del_e:
                print(f"无法删除不完整的文件: {del_e}")
                sys.stdout.flush()  # 确保消息立即显示
        
        return False
