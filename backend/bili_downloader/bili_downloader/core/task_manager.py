# -*- coding: utf-8 -*-
import os
import json
import time
import threading
import queue # 导入 queue

# --- 在这里定义任务队列 --- 
task_queue = queue.Queue()

# 任务状态文件路径
TASKS_FILE = 'config/tasks.json'
# 文件锁
file_lock = threading.Lock()

def _ensure_config_dir():
    """确保config目录存在"""
    config_dir = os.path.dirname(TASKS_FILE)
    if config_dir and not os.path.exists(config_dir):
        try:
            os.makedirs(config_dir)
        except OSError as e:
            print(f"创建目录 {config_dir} 失败: {e}")

def load_tasks():
    """从JSON文件加载所有任务状态"""
    _ensure_config_dir()
    with file_lock:
        if not os.path.exists(TASKS_FILE):
            return {}
        try:
            with open(TASKS_FILE, 'r', encoding='utf-8') as f:
                tasks = json.load(f)
                # 兼容旧格式或空文件
                if not isinstance(tasks, dict):
                    return {}
                return tasks
        except (json.JSONDecodeError, IOError) as e:
            print(f"加载任务文件失败: {e}")
            # 如果文件损坏，尝试备份并创建一个新的空文件
            try:
                backup_file = f"{TASKS_FILE}.{int(time.time())}.bak"
                os.rename(TASKS_FILE, backup_file)
                print(f"任务文件已备份到: {backup_file}")
            except OSError as rename_e:
                print(f"备份任务文件失败: {rename_e}")
            return {}

def save_tasks(tasks):
    """将所有任务状态保存到JSON文件"""
    _ensure_config_dir()
    with file_lock:
        try:
            # 写入临时文件，然后重命名，保证原子性
            temp_file = f"{TASKS_FILE}.tmp"
            with open(temp_file, 'w', encoding='utf-8') as f:
                json.dump(tasks, f, ensure_ascii=False, indent=2)
            os.replace(temp_file, TASKS_FILE) # 原子替换
            return True
        except IOError as e:
            print(f"保存任务文件失败: {e}")
            return False
        except Exception as e:
            print(f"保存任务时发生未知错误: {e}")
            # 尝试删除临时文件
            if os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                except OSError as del_e:
                    print(f"删除临时任务文件失败: {del_e}")
            return False


def get_task(task_id):
    """获取单个任务的信息"""
    tasks = load_tasks()
    return tasks.get(task_id)

def add_task(task_id, initial_data):
    """添加一个新任务"""
    tasks = load_tasks()
    if task_id in tasks:
        print(f"警告：尝试添加已存在的任务 {task_id}")
        # 可以选择更新或忽略，这里选择更新
    tasks[task_id] = initial_data
    return save_tasks(tasks)

def update_task(task_id, updates):
    """更新指定任务的信息"""
    tasks = load_tasks()
    if task_id in tasks:
        # 使用字典的update方法合并更新
        if isinstance(tasks[task_id], dict) and isinstance(updates, dict):
            # 特殊处理 resource_status，进行合并而不是替换
            if 'resource_status' in updates and 'resource_status' in tasks[task_id]:
                if isinstance(tasks[task_id]['resource_status'], dict) and isinstance(updates['resource_status'], dict):
                    tasks[task_id]['resource_status'].update(updates['resource_status'])
                    # 从 updates 中移除 resource_status，避免覆盖
                    del updates['resource_status']
                else:
                     print(f"警告: 任务 {task_id} 的 resource_status 类型不匹配，将直接覆盖")

            tasks[task_id].update(updates)
            return save_tasks(tasks)
        else:
             print(f"警告: 任务 {task_id} 或更新数据格式错误，无法更新")
             return False
    else:
        print(f"警告：尝试更新不存在的任务 {task_id}")
        return False

def remove_task(task_id):
    """移除一个任务"""
    tasks = load_tasks()
    if task_id in tasks:
        del tasks[task_id]
        return save_tasks(tasks)
    return False

def get_running_tasks():
    """获取所有非完成/失败状态的任务"""
    tasks = load_tasks()
    running = {}
    for task_id, task_data in tasks.items():
        # 确保 task_data 是字典并且包含 'overall_status'
        if isinstance(task_data, dict):
            status = task_data.get('overall_status', '未知')
            if status not in ["完成", "失败"]:
                running[task_id] = task_data
        else:
            print(f"警告: 任务 {task_id} 数据格式错误: {task_data}")
    return running

def cleanup_old_tasks(days_to_keep=7):
    """清理指定天数前的已完成或失败的任务记录"""
    tasks = load_tasks()
    cleaned_tasks = {}
    cutoff_time = time.time() - (days_to_keep * 24 * 60 * 60)
    
    for task_id, task_data in tasks.items():
         if isinstance(task_data, dict):
            status = task_data.get('overall_status', '未知')
            timestamp = task_data.get('timestamp', 0) # 假设任务完成或失败时会记录时间戳
            
            # 保留运行中的任务或最近的任务
            if status not in ["完成", "失败"] or timestamp > cutoff_time:
                cleaned_tasks[task_id] = task_data
         else:
             # 保留格式错误的任务以供检查，或者直接丢弃
             print(f"警告: 清理时发现任务 {task_id} 数据格式错误，将保留")
             cleaned_tasks[task_id] = task_data
             
    if len(cleaned_tasks) < len(tasks):
        print(f"清理了 {len(tasks) - len(cleaned_tasks)} 个旧任务记录")
        save_tasks(cleaned_tasks)

# 可以在应用启动时调用一次清理
# cleanup_old_tasks() 

def create_task(bv_id, download_options, cookie=''):
    """创建一个新的下载任务
    
    Args:
        bv_id: B站视频BV号
        download_options: 下载选项，包含video, audio, subtitle, ai_summary等键
        cookie: B站cookie字符串

    Returns:
        创建的任务ID，如果失败则返回None
    """
    try:
        # 创建任务ID
        task_id = f"download_{bv_id}_{int(time.time())}"
        
        # 添加初始任务记录到持久化存储
        initial_task_data = {
            "task_id": task_id,
            "bv_id": bv_id,
            "download_options": download_options,
            "overall_status": "排队中", # 初始状态
            "info": {"title": f"等待处理: {bv_id}"}, # 临时信息
            "resource_status": {}, # 初始化资源状态
            "timestamp": time.time()
        }
        
        # 设置各资源的初始状态
        if download_options.get('video', False):
            initial_task_data["resource_status"]["video"] = "排队中"
        if download_options.get('audio', False):
            initial_task_data["resource_status"]["audio"] = "排队中"
        if download_options.get('subtitle', False):
            initial_task_data["resource_status"]["subtitle"] = "排队中"
        
        # 保存任务记录
        if not add_task(task_id, initial_task_data):
            print(f"创建任务记录失败: {task_id}")
            return None
            
        # 将任务放入处理队列（现在 task_queue 在本模块定义）
        # --- 移除导入语句 --- 
        # from ..core import task_queue 
        task_queue.put((task_id, "download", (bv_id, download_options, cookie)))
        
        return task_id
    except Exception as e:
        print(f"创建任务时出错: {e}")
        return None 