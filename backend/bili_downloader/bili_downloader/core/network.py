# -*- coding: utf-8 -*-
import requests

# 默认请求头
DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://www.bilibili.com'
}

def create_headers(cookie=""):
    """创建请求头"""
    headers = DEFAULT_HEADERS.copy()
    if cookie:
        headers["Cookie"] = cookie
    return headers

def check_login_status(cookie, return_json=False):
    """检查是否已登录"""
    result = {
        "isLogin": False,
        "username": "未知",
        "message": "未设置Cookie，某些功能将不可用"
    }
    
    # 处理空或纯空白字符的cookie
    if not cookie or cookie.strip() == "":
        if not return_json:
            print("未设置Cookie或Cookie为空，某些功能将不可用。请使用 -c 参数设置Cookie。")
        result["message"] = "Cookie为空或未设置"
        return result if return_json else False
    
    # 创建头部
    headers = create_headers(cookie)
    
    try:
        # 尝试访问用户个人信息API
        response = requests.get("https://api.bilibili.com/x/web-interface/nav", headers=headers, timeout=10)
        data = response.json()
        
        # 成功验证cookie
        if data["code"] == 0 and data["data"]["isLogin"] and data["data"].get("uname"):
            username = data['data']['uname']
            if not return_json:
                print(f"登录成功! 欢迎, {username}!")
            
            result = {
                "isLogin": True,
                "username": username,
                "message": "登录成功"
            }
            return result if return_json else True
        else:
            # 处理API返回错误或未登录的情况
            error_msg = data.get("message", "Cookie无效或已过期")
            if not return_json:
                print(f"Cookie无效: {error_msg}")
            
            result = {
                "isLogin": False,
                "username": "未知",
                "message": error_msg
            }
            return result if return_json else False
    except Exception as e:
        error_msg = f"检查登录状态时出错: {e}"
        if not return_json:
            print(error_msg)
        
        result = {
            "isLogin": False,
            "username": "未知",
            "message": error_msg
        }
        return result if return_json else False
