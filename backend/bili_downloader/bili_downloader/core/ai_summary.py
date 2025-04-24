# -*- coding: utf-8 -*-
import os
import json
import re
import sys
from datetime import datetime
import openai
import requests  # 添加 requests 库用于 Claude API 调用

def generate_summary(subtitle_path: str, config: dict):
    """
    使用 AI API (OpenAI 或 Claude) 生成视频字幕的 AI 总结。

    Args:
        subtitle_path (str): 字幕文件的相对路径 (相对于 config/download 目录)。
        config (dict): 包含 AI 配置和偏好设置的字典。

    Returns:
        tuple: (bool, str|dict): 包含成功状态和结果的元组。
               成功时，结果是包含完整总结数据的 JSON 字符串。
               失败时，结果是错误信息字符串。
    """
    # 获取 AI 提供商设置
    ai_provider = config.get('ai_provider', 'openai')  # 默认为 OpenAI
    
    # OpenAI 配置
    openai_base_url = config.get('openai_base_url')
    openai_api_key = config.get('openai_api_key')
    openai_model = config.get('openai_model', 'gpt-4o')  # 默认模型
    
    # Claude 配置
    claude_base_url = config.get('claude_base_url')
    claude_api_key = config.get('claude_api_key')
    claude_model = config.get('claude_model', 'claude-3-5-sonnet-20240620')  # 默认模型
    
    # 根据提供商检查配置完整性
    if ai_provider == 'openai':
        if not openai_base_url or not openai_api_key:
            return False, "OpenAI 配置不完整"
    elif ai_provider == 'claude':
        if not claude_base_url or not claude_api_key:
            return False, "Claude 配置不完整"
    else:
        return False, f"不支持的 AI 提供商: {ai_provider}"

    # 检查偏好设置
    ai_summary_prefs = config.get('ai_summary_prefs', {})
    summary_length = ai_summary_prefs.get('summary_length', 'medium')
    # --- 读取 content_focus 数组，确保是列表 --- 
    content_focus_list = ai_summary_prefs.get('content_focus', ['core_points'])
    if not isinstance(content_focus_list, list):
        content_focus_list = ['core_points'] # 回退到默认
    content_focus_str = ", ".join(content_focus_list) # 转换为逗号分隔的字符串
    
    # --- 处理术语解释设置 ---
    term_explanation = ai_summary_prefs.get('term_explanation', 'all')  # 默认使用'all'
    
    # 确定术语解释级别
    term_explanation_level = "all"  # 默认全部解释
    
    # 处理所有可能的值类型
    if isinstance(term_explanation, bool):
        # 向后兼容布尔值
        term_explanation_level = "all" if term_explanation else "none"
    elif isinstance(term_explanation, str):
        # 确保字符串值有效
        if term_explanation in ["all", "medium", "minimal", "none"]:
            term_explanation_level = term_explanation
        else:
            print(f"[ai_summary.py] 警告：未识别的术语解释级别：{term_explanation}，使用默认值'all'")
    else:
        print(f"[ai_summary.py] 警告：术语解释级别格式错误：{type(term_explanation)}，使用默认值'all'")
    
    # 根据术语解释级别生成提示词描述
    term_explanation_prompt = ""
    if term_explanation_level == "all":
        term_explanation_prompt = "解释所有专业和非专业术语（适合初学者）"
    elif term_explanation_level == "medium":
        term_explanation_prompt = "解释中等难度的术语，忽略常见网络用语（适合普通用户）"
    elif term_explanation_level == "minimal":
        term_explanation_prompt = "仅解释专业领域的术语，忽略普通网络用语和常见概念（适合资深用户）"
    else:  # "none" 或其他值
        term_explanation_prompt = "仅解释晦涩难懂的专业术语，忽略大部分常见概念（适合专业人士）"
    
    tone_style = ai_summary_prefs.get('tone_style', 'casual')
    purpose = ai_summary_prefs.get('purpose', 'learning') # <-- 读取目的

    try:
        # 获取字幕内容 (需要知道下载基础路径)
        base_download_dir = os.path.join(os.getcwd(), 'config/download')
        full_subtitle_path = os.path.join(base_download_dir, subtitle_path)
        
        if not os.path.exists(full_subtitle_path):
             return False, f"字幕文件不存在: {subtitle_path}"
        
        with open(full_subtitle_path, 'r', encoding='utf-8') as f:
            subtitle_content = f.read()

        # 获取视频标题和简介
        title_match = re.match(r'^(.+?)/BV', subtitle_path)
        title = title_match.group(1) if title_match else "未知视频"
        
        nfo_path = os.path.join(os.path.dirname(full_subtitle_path), "movie.nfo")
        description = ""
        owner_from_nfo = "" # <-- 初始化 owner 变量
        if os.path.exists(nfo_path):
            try:
                import xml.etree.ElementTree as ET
                tree = ET.parse(nfo_path)
                root = tree.getroot()
                description = root.findtext("plot", "")
                owner_from_nfo = root.findtext("director", "")
            except Exception as e:
                print(f"读取NFO文件失败: {e}")
        
        # --- 通用提示词内容 --- 
        base_prompt = f"""
# 视频总结助手

## 视频信息
- 标题: {title}
- UP主: {owner_from_nfo}
- 简介: {description}
- 字幕: {subtitle_content}

## 分析要求
- 总结目的: {purpose}
- 长度: {summary_length}
- 关注维度: {content_focus_str}
- 风格: {tone_style}

## 总结要求
1. 生成整体主题概述和3-5个主题标签(2-4字短语)
2. 提取关键点并标注时间戳(MM:SS格式)和重要性
3. 根据指定总结目的和关注维度组织内容，确保适用于B站多样化的视频类型
4. 提供流畅的段落式总结，非简单罗列要点
5. 术语解释要求: {term_explanation_prompt}
6. 对视频整体内容，评估知识难度级别和适合人群
7. 根据视频内容复杂度动态调整详细程度
8. 对于full_text字段，请使用Markdown格式来增强可读性：
   - 为重要段落或关键点添加**加粗**格式
   - 为核心概念添加*斜体*格式
   - 使用适当的标题层级(## 和 ###)来组织结构
   - 在需要时使用引用块和列表格式
   - 减少段落之间的空行，使用紧凑格式，段落之间只需1个换行符
   - 标题和段落间不需要额外空行

## 输出格式
请严格按照以下JSON格式返回，不要包含额外文字:

```json
{{
  "summary_title": "总结标题",
  "core_theme": "视频核心主题概述",
  "tags": ["标签1", "标签2", "标签3"],
  "difficulty_level": "入门|进阶|专家",
  "suitable_for": "适合人群描述(一句话)",
  "key_points": [
    {{"content": "关键点内容", "timestamp": "01:24", "importance": "high|medium|low"}}
  ],
  "technical_terms": [
    {{"term": "术语", "explanation": "解释"}}
  ],
  "full_text": "使用紧凑Markdown格式的流畅总结，减少不必要的空行"
}}
```
"""

        # 根据不同的 AI 提供商处理 API 调用
        if ai_provider == 'openai':
            # OpenAI API 调用
            summary_content_str = call_openai_api(base_prompt, openai_base_url, openai_api_key, openai_model)
        elif ai_provider == 'claude':
            # Claude API 调用
            summary_content_str = call_claude_api(base_prompt, claude_base_url, claude_api_key, claude_model)
        else:
            return False, f"不支持的 AI 提供商: {ai_provider}"
        
        # --- 解析 AI 返回的核心内容 JSON --- 
        try:
            ai_generated_data = json.loads(summary_content_str)
            
            # --- 在本地构建完整的 JSON 结构 --- 
            full_summary_data = {
                "version": "1.0",
                "status": "success",
                "generated_at": datetime.now().isoformat(), # 使用ISO格式时间
                "video_info": {
                    "title": title,
                    "url": f"https://www.bilibili.com/video/{title_match.group(0)}" if title_match else "", # 尝试添加URL
                    "owner": owner_from_nfo # <-- 使用从 NFO 读取的变量
                },
                "summary": {
                    "title": ai_generated_data.get("summary_title", "AI生成总结"),
                    "core_theme": ai_generated_data.get("core_theme", ""),
                    "content_focus": content_focus_str, # 仍保留内容侧重字段，兼容旧版
                    "tags": ai_generated_data.get("tags", []), # 标签字段
                    "difficulty_level": ai_generated_data.get("difficulty_level", ""), # 新增：难度级别
                    "suitable_for": ai_generated_data.get("suitable_for", "") # 新增：适合人群
                },
                "key_points": ai_generated_data.get("key_points", []),
                "technical_terms": ai_generated_data.get("technical_terms", []), # 如果AI没返回则为空列表
                "full_text": ai_generated_data.get("full_text", ""),
                "format_type": "bullet_points", # 保留兼容性字段
                "ai_provider": ai_provider  # 添加提供商信息
            }
            
            return True, json.dumps(full_summary_data, ensure_ascii=False, indent=2)
            
        except json.JSONDecodeError:
            print(f"无法解析AI响应为JSON格式，原始响应: {summary_content_str}")
            # --- 构建包含错误的完整 JSON --- 
            error_summary_data = {
                "version": "1.0",
                "status": "error",
                "generated_at": datetime.now().isoformat(),
                "error": "无法解析AI响应为JSON格式",
                "raw_response": summary_content_str,
                "video_info": {
                    "title": title
                },
                "ai_provider": ai_provider  # 添加提供商信息
            }
            return True, json.dumps(error_summary_data, ensure_ascii=False, indent=2) # 仍然返回True，但status为error

    except Exception as e:
        print(f"生成AI总结时发生异常: {e}")
        import traceback
        traceback.print_exc()
        # --- 返回包含错误的完整 JSON --- 
        error_summary_data = {
            "version": "1.0",
            "status": "error",
            "generated_at": datetime.now().isoformat(),
            "error": f"生成AI总结失败: {str(e)}",
            "video_info": {
                "title": title
            },
            "ai_provider": ai_provider if 'ai_provider' in locals() else "unknown"  # 添加提供商信息
        }
        # 注意：这里返回 False，因为是生成过程本身失败
        return False, json.dumps(error_summary_data, ensure_ascii=False, indent=2) 

def call_openai_api(prompt, base_url, api_key, model):
    """调用 OpenAI API 获取总结"""
    print(f"[ai_summary.py] 即将调用 OpenAI API (模型: {model})...")
    sys.stdout.flush()
    
    # 配置OpenAI客户端
    client = openai.OpenAI(
        api_key=api_key,
        base_url=base_url
    )
    
    # --- 打印完整的提示词内容 (替换字幕) ---
    prompt_for_logging = prompt.replace(prompt[prompt.find("- 字幕:"):prompt.find("## 分析要求")], "- 字幕: [Subtitle Content Placeholder]")
    print("--- OpenAI Prompt ---")
    print(prompt_for_logging)
    print("--- End OpenAI Prompt ---")
    sys.stdout.flush()
    
    # 调用API
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "你是专业的视频内容分析助手，专长于生成简洁精确的视频总结。请严格按照指定的JSON格式输出。支持使用Markdown格式增强文本可读性。根据用户指定的术语解释级别调整解释的详细程度。"},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7,
        max_tokens=4000,
        response_format={"type": "json_object"}  # 强制要求JSON输出
    )
    print("[ai_summary.py] OpenAI API 调用成功返回")
    sys.stdout.flush()
    
    return response.choices[0].message.content

def call_claude_api(prompt, base_url, api_key, model):
    """调用 Claude API 获取总结"""
    print(f"[ai_summary.py] 即将调用 Claude API (模型: {model})...")
    sys.stdout.flush()
    
    # --- 打印完整的提示词内容 (替换字幕) ---
    prompt_for_logging = prompt.replace(prompt[prompt.find("- 字幕:"):prompt.find("## 分析要求")], "- 字幕: [Subtitle Content Placeholder]")
    print("--- Claude Prompt ---")
    print(prompt_for_logging)
    print("--- End Claude Prompt ---")
    sys.stdout.flush()
    
    # 构建 Claude API 请求
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }
    
    payload = {
        "model": model,
        "max_tokens": 4000,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }
    
    # 发送请求
    response = requests.post(
        f"{base_url}/v1/messages",
        headers=headers,
        json=payload
    )
    
    if response.status_code != 200:
        error_message = f"Claude API 调用失败: 状态码 {response.status_code}, 响应: {response.text}"
        print(error_message)
        sys.stdout.flush()
        raise Exception(error_message)
    
    response_data = response.json()
    print("[ai_summary.py] Claude API 调用成功返回")
    sys.stdout.flush()
    
    # 从 Claude 响应中提取内容
    content = response_data["content"][0]["text"]
    
    # --- 改进的JSON提取和解析逻辑 ---
    
    # 首先尝试从Markdown代码块中提取JSON
    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', content, re.DOTALL)
    if json_match:
        json_str = json_match.group(1).strip()
        print(f"[ai_summary.py] 从Markdown代码块中提取到JSON内容")
        
        # 尝试修复JSON并解析
        fixed_json = fix_json_string(json_str)
        if fixed_json:
            return fixed_json
    
    # 如果无法从Markdown中提取，尝试将整个内容作为JSON解析
    fixed_json = fix_json_string(content)
    if fixed_json:
        return fixed_json
    
    # 最后手段：使用正则表达式提取看似JSON的部分
    json_like_match = re.search(r'(\{\s*"summary_title"\s*:.*\})', content, re.DOTALL)
    if json_like_match:
        potential_json = json_like_match.group(1)
        print(f"[ai_summary.py] 使用正则提取的潜在JSON内容")
        
        # 尝试修复JSON并解析
        fixed_json = fix_json_string(potential_json)
        if fixed_json:
            return fixed_json
    
    # 如果所有方法都失败，手动构建兼容的JSON
    print(f"[ai_summary.py] 所有解析方法失败，尝试手动解析关键部分")
    try:
        # 用正则表达式提取JSON的主要部分
        summary_title = re.search(r'"summary_title"\s*:\s*"([^"]*)"', content)
        core_theme = re.search(r'"core_theme"\s*:\s*"([^"]*)"', content)
        
        if summary_title and core_theme:
            # 构建基本的JSON结构
            fallback_json = {
                "summary_title": summary_title.group(1),
                "core_theme": core_theme.group(1),
                "tags": extract_array(content, "tags"),
                "difficulty_level": extract_string(content, "difficulty_level"),
                "suitable_for": extract_string(content, "suitable_for"),
                "key_points": extract_complex_array(content, "key_points"),
                "technical_terms": extract_complex_array(content, "technical_terms"),
                "full_text": extract_string(content, "full_text", multiline=True)
            }
            print("[ai_summary.py] 成功手动构建了JSON")
            return json.dumps(fallback_json, ensure_ascii=False)
    except Exception as e:
        print(f"[ai_summary.py] 手动解析也失败了: {e}")
    
    # 最终失败，返回原始内容
    print(f"[ai_summary.py] 无法从Claude响应中提取有效的JSON，将使用原始响应")
    return content  # 返回原始内容，后续处理将捕获解析错误

def fix_json_string(json_str):
    """尝试修复JSON字符串中的常见错误"""
    try:
        # 首先尝试直接解析
        json.loads(json_str)
        print("[ai_summary.py] JSON格式正确")
        return json_str
    except json.JSONDecodeError as e:
        print(f"[ai_summary.py] JSON格式错误: {e}")
        
        # 1. 清理特殊字符和格式
        cleaned_str = json_str
        # 移除所有不可见的控制字符
        cleaned_str = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', cleaned_str)
        # 移除中文方括号及其内容
        cleaned_str = re.sub(r'【[^】]*】', '', cleaned_str)
        
        # 2. 尝试修复常见的格式问题
        
        # 修复缺失逗号的问题：
        # 在 "} {" 之间添加逗号
        cleaned_str = re.sub(r'}\s*{', '}, {', cleaned_str)
        # 在 "] [" 之间添加逗号
        cleaned_str = re.sub(r']\s*\[', '], [', cleaned_str)
        # 在 "] {" 之间添加逗号
        cleaned_str = re.sub(r']\s*{', '], {', cleaned_str)
        # 在 "} [" 之间添加逗号
        cleaned_str = re.sub(r'}\s*\[', '}, [', cleaned_str)
        
        # 3. 处理特定于AI总结的格式问题
        
        # 修复key_points数组中常见的格式问题
        key_points_pattern = r'"key_points"\s*:\s*\[(.*?)\]'
        key_points_match = re.search(key_points_pattern, cleaned_str, re.DOTALL)
        if key_points_match:
            kp_content = key_points_match.group(1)
            # 检查并修复对象之间是否缺少逗号
            fixed_kp = re.sub(r'}\s*{', '}, {', kp_content)
            # 替换回原字符串
            cleaned_str = cleaned_str.replace(kp_content, fixed_kp)
        
        # 同样处理technical_terms数组
        terms_pattern = r'"technical_terms"\s*:\s*\[(.*?)\]'
        terms_match = re.search(terms_pattern, cleaned_str, re.DOTALL)
        if terms_match:
            terms_content = terms_match.group(1)
            fixed_terms = re.sub(r'}\s*{', '}, {', terms_content)
            cleaned_str = cleaned_str.replace(terms_content, fixed_terms)
            
        # 4. 尝试解析修复后的字符串
        try:
            json.loads(cleaned_str)
            print("[ai_summary.py] 修复JSON格式成功")
            return cleaned_str
        except json.JSONDecodeError as e2:
            print(f"[ai_summary.py] 修复JSON失败: {e2}")
            
            # 5. 尝试更激进的修复：
            # 根据有问题的位置，尝试再次修复
            error_info = str(e2)
            if "Expecting ',' delimiter" in error_info:
                # 获取错误位置
                try:
                    position_match = re.search(r'char (\d+)', error_info)
                    if position_match:
                        pos = int(position_match.group(1))
                        # 在错误位置前后插入逗号
                        if pos < len(cleaned_str):
                            prefix = cleaned_str[:pos]
                            suffix = cleaned_str[pos:]
                            # 检查是否是数组或对象中缺少逗号的情况
                            if re.search(r'["\]}]\s*[{\[]', prefix[-5:] + suffix[:5]):
                                modified_str = prefix + ',' + suffix
                                try:
                                    json.loads(modified_str)
                                    print("[ai_summary.py] 在错误位置插入逗号成功修复JSON")
                                    return modified_str
                                except json.JSONDecodeError:
                                    pass  # 继续尝试其他修复方法
                except Exception as e3:
                    print(f"[ai_summary.py] 尝试定位修复错误时出错: {e3}")
            
            return None  # 所有修复方法都失败

def extract_string(content, key, multiline=False):
    """从内容中提取字符串值"""
    if multiline:
        # 对多行文本使用更健壮的提取方法
        pattern = f'"{key}"\\s*:\\s*"((?:.|\n)*?)(?:"\\s*,\\s*"|"\\s*}})'
        match = re.search(pattern, content, re.DOTALL)
        if match:
            # 提取值并处理转义字符
            value = match.group(1)
            # 修复常见的JSON字符串转义问题
            value = value.replace('\\"', '"').replace('\\n', '\n')
            return value
    else:
        # 对单行文本使用简单提取
        pattern = f'"{key}"\\s*:\\s*"([^"]*)"'
        match = re.search(pattern, content)
        if match:
            return match.group(1)
    
    # 如果上述方法失败，尝试一种备用方法
    # 寻找键的开始位置
    key_pattern = f'"{key}"\\s*:\\s*"'
    key_match = re.search(key_pattern, content)
    if key_match:
        # 找到键的开始位置
        start_pos = key_match.end()
        # 从该位置开始，找到匹配的结束引号（考虑转义）
        remaining = content[start_pos:]
        # 初始化结果和状态变量
        result = []
        escape = False
        quote_found = False
        
        for i, char in enumerate(remaining):
            if escape:
                # 前一个字符是转义符，添加当前字符并重置转义状态
                result.append(char)
                escape = False
            elif char == '\\':
                # 当前字符是转义符
                escape = True
                result.append(char)
            elif char == '"' and not escape:
                # 找到非转义的引号，结束提取
                quote_found = True
                break
            else:
                # 其他字符直接添加
                result.append(char)
        
        if quote_found:
            extracted_value = ''.join(result)
            # 额外处理：如果是multiline，保留换行符
            if multiline:
                # 避免双重转义
                extracted_value = extracted_value.replace('\\n', '\n')
            return extracted_value
    
    return ""

def extract_array(content, key):
    """从内容中提取简单数组值"""
    pattern = f'"{key}"\\s*:\\s*\\[(.*?)\\]'
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        return []
    
    array_content = match.group(1).strip()
    if not array_content:
        return []
    
    # 通过正则表达式提取数组中的字符串项
    items = re.findall(r'"([^"]*)"', array_content)
    return items

def extract_complex_array(content, key):
    """从内容中提取复杂对象数组值"""
    pattern = f'"{key}"\\s*:\\s*\\[(.*?)\\]'
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        return []
    
    array_content = match.group(1).strip()
    if not array_content:
        return []
    
    result = []
    
    # 改进匹配逻辑：使用状态机解析
    obj_matches = re.finditer(r'{(.*?)}', array_content, re.DOTALL)
    
    for obj_match in obj_matches:
        obj_content = obj_match.group(1).strip()
        obj = {}
        
        # 增强对象属性提取
        # 使用键-值对提取，但要避免在属性值内部匹配引号
        content_pos = 0
        while content_pos < len(obj_content):
            # 匹配键名
            key_match = re.search(r'"([^"]*)"\s*:', obj_content[content_pos:])
            if not key_match:
                break
                
            key_name = key_match.group(1)
            value_start = content_pos + key_match.end()
            
            # 查找值的起始引号
            quote_match = re.search(r'\s*"', obj_content[value_start:])
            if not quote_match:
                break
                
            value_start += quote_match.end()
            
            # 从值的起始位置搜索结束引号（考虑转义）
            value_chars = []
            escape = False
            i = value_start
            
            while i < len(obj_content):
                char = obj_content[i]
                
                if escape:
                    # 转义字符后的字符直接添加
                    value_chars.append(char)
                    escape = False
                elif char == '\\':
                    # 转义符
                    escape = True
                    # 保留转义符以便后处理
                    value_chars.append(char)
                elif char == '"' and not escape:
                    # 找到结束引号
                    break
                else:
                    # 其他字符添加到值中
                    value_chars.append(char)
                
                i += 1
            
            if i < len(obj_content):  # 确保找到了结束引号
                value = ''.join(value_chars)
                # 处理常见转义序列
                value = value.replace('\\n', '\n').replace('\\"', '"')
                obj[key_name] = value
                content_pos = i + 1  # 更新位置到结束引号之后
            else:
                # 没找到结束引号，跳出循环避免无限循环
                break
        
        if obj:  # 只有当成功提取到属性时才添加对象
            result.append(obj)
    
    return result 