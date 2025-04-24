// frontend-react/src/services/api.ts

// Base function for making API requests, handling credentials and errors
async function fetchApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  const defaultOptions: RequestInit = {
    credentials: 'include', // Always send cookies
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // Add other default headers if needed, like Cache-Control
      'Cache-Control': 'no-cache', 
      ...(options.headers || {}), // Merge custom headers
    },
    ...options, // Merge custom options (method, body, etc.)
  };

  try {
    const response = await fetch(url, defaultOptions);

    if (!response.ok) {
      // Try to parse error response from backend if available
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        // Ignore if response is not JSON
      }
      // Throw an error with backend message or default status text
      throw new Error(errorData?.message || response.statusText || `HTTP error ${response.status}`);
    }

    // Handle successful responses
    if (response.status === 204) { // No Content
      return undefined as T; // Return undefined for 204 No Content
    }
    
    // Assuming backend always returns JSON
    const data: T = await response.json(); 
    return data;

  } catch (error) {
    console.error(`API Fetch Error (${url}):`, error);
    // Re-throw the error to be handled by the calling function
    throw error; 
  }
}

// --- API Endpoint Definitions --- //

// Define expected response types (adjust based on actual backend responses)
interface LoginResponse {
  success: boolean;
  message: string;
  username?: string; 
}

interface CheckLoginResponse {
  success: boolean;
  isLogin: boolean;
  username?: string;
  message?: string;
}

interface LogoutResponse {
  success: boolean;
  message: string;
}

interface StandardResponse {
    success: boolean;
    message?: string;
}

interface ConfigResponse {
    cookie?: string;
    ai_provider?: string;
    openai_base_url?: string;
    openai_api_key?: string;
    openai_model?: string;
    claude_base_url?: string;
    claude_api_key?: string;
    claude_model?: string;
    ai_summary_prefs?: {
      summary_length?: string;
      content_focus?: string[];
      term_explanation?: boolean | string;
      tone_style?: string;
      purpose?: string;
    };
}

interface TestCookieResponse {
    success: boolean;
    message: string;
    username?: string;
}

interface CreateDownloadResponse {
    success: boolean;
    message: string;
    task_id?: string;
}

// Add types for /api/downloads and /api/tasks/running responses later
// interface DownloadsListResponse { ... }
// interface RunningTasksResponse { ... }

// 定义视频相关接口
export interface FileInfo {
  name: string;
  size: number;
}

export interface VideoMetadata {
  duration?: number;
  view_count?: number;
  danmaku_count?: number;
  owner?: string;
  pubdate?: string;
  like_count?: number;
  coin_count?: number;
  favorite_count?: number;
}

export interface DownloadedVideo {
  bv_id: string;
  title: string;
  metadata: VideoMetadata;
  files: {
    video?: FileInfo;
    audio?: FileInfo;
    subtitle?: FileInfo;
    poster?: FileInfo;
    bif?: FileInfo;
  };
}

export interface DownloadsListResponse {
  success?: boolean;
  videos?: DownloadedVideo[];
}

export interface TaskInfo {
  bv_id: string;
  title?: string;
  cover_url?: string;
  duration?: number;
  owner?: string;
  pubdate?: string | number;
  view_count?: number;
  danmaku_count?: number;
  description?: string;
  favorite_count?: number;
  coin_count?: number;
  like_count?: number;
}

export interface RunningTask {
  task_id: string;
  info: TaskInfo;
  overall_status: string;
  resource_status: { [key: string]: string };
  timestamp: number;
  progress?: number;
}

export interface RunningTasksResponse {
  success?: boolean;
  tasks?: { [key: string]: RunningTask };
}

// 删除未使用的 OpenAIConfigData 接口定义
interface AIConfigData {
  ai_provider?: string;
  openai_base_url?: string;
  openai_api_key?: string;
  openai_model?: string;
  claude_base_url?: string;
  claude_api_key?: string;
  claude_model?: string;
  ai_summary_prefs: {
    summary_length: string;
    content_focus: string[];
    term_explanation: boolean | string;
    tone_style: string;
    purpose: string;
  };
}

// 添加AI总结响应类型
interface AISummaryResponse extends StandardResponse {
  summary_path?: string;
  summary_data?: any;
}

// 获取字幕内容
const getSubtitleContent = async (subtitlePath: string) => {
  try {
    const response = await fetch(`/api/subtitle/content?path=${encodeURIComponent(subtitlePath)}`);
    
    // 检查返回状态
    if (!response.ok) {
      const statusText = response.statusText || `HTTP错误 ${response.status}`;
      throw new Error(`获取字幕失败: ${statusText}`);
    }
    
    // 检查内容类型
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      // 如果返回的是JSON（可能是错误信息）
      const jsonData = await response.json();
      if (jsonData.error) {
        throw new Error(jsonData.error);
      }
      return JSON.stringify(jsonData); // 转回文本
    }
    
    // 正常获取文本
    const text = await response.text();
    return text;
  } catch (error: any) {
    console.error('字幕获取错误:', error);
    throw new Error(error.message || '无法获取字幕内容');
  }
};

// 类型定义：设置OpenAI配置的请求体
/* 
interface SetOpenAIConfigRequest {
  openai_base_url: string;
  openai_api_key: string;
  openai_model?: string;
  ai_summary_prefs: {
    summary_length: string;
    content_focus: string[];
    term_explanation: boolean;
    tone_style: string;
    purpose: string;
  };
}
*/

/**
 * 设置 AI 配置 (OpenAI 或 Claude)
 * @param {AIConfigData} config AI 配置对象
 * @returns {Promise<StandardResponse>} 响应对象 
 */
async function setAIConfig(config: AIConfigData): Promise<StandardResponse> {
  return fetchApi<StandardResponse>('/api/set_ai_config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

// 保留原有的 setOpenAIConfig 方法，但内部调用新的 setAIConfig 方法以保持兼容性
async function setOpenAIConfig(config: any): Promise<StandardResponse> {
  return setAIConfig(config as AIConfigData);
}

const api = {
  // Authentication
  login: (password: string): Promise<LoginResponse> => {
    return fetchApi<LoginResponse>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },
  checkLogin: (): Promise<CheckLoginResponse> => {
    return fetchApi<CheckLoginResponse>('/api/check_login');
  },
  logout: (): Promise<LogoutResponse> => {
    // Usually a GET or POST request depending on backend implementation
    return fetchApi<LogoutResponse>('/logout', { method: 'GET' }); // Assuming GET for logout based on header link
  },
  changePassword: (password: string): Promise<StandardResponse> => {
    return fetchApi<StandardResponse>('/api/change_password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },
  
  // Configuration
  getConfig: (): Promise<ConfigResponse> => {
    return fetchApi<ConfigResponse>('/api/config');
  },
  setCookie: (cookie: string): Promise<StandardResponse> => {
    return fetchApi<StandardResponse>('/api/set_cookie', {
      method: 'POST',
      body: JSON.stringify({ cookie }),
    });
  },
  testCookie: (cookie: string): Promise<TestCookieResponse> => {
    return fetchApi<TestCookieResponse>('/api/test_cookie', {
      method: 'POST',
      body: JSON.stringify({ cookie }),
    });
  },
  setOpenAIConfig,
  setAIConfig,

  // Downloads & Tasks
  createDownload: (bv_id: string, options: { video: boolean; audio: boolean; subtitle: boolean }): Promise<CreateDownloadResponse> => {
    return fetchApi<CreateDownloadResponse>('/api/download', {
        method: 'POST',
        body: JSON.stringify({ bv_id, options }),
    });
  },
  
  // 实现下载列表获取
  getDownloads: (): Promise<DownloadsListResponse> => {
    return fetchApi<DownloadsListResponse>('/api/downloads');
  },
  
  // 实现运行任务获取
  getRunningTasks: (): Promise<RunningTasksResponse> => {
    return fetchApi<RunningTasksResponse>('/api/tasks/running');
  },

  // AI Summary
  generateAISummary: (subtitlePath: string, bvId: string, title: string): Promise<AISummaryResponse> => {
    return fetchApi<AISummaryResponse>('/api/generate_ai_summary', {
      method: 'POST',
      body: JSON.stringify({ 
        subtitle_path: subtitlePath, 
        bv_id: bvId,
        title: title
      }),
    });
  },

  // Note: Download file links (e.g., /api/download/video/...) are usually handled directly
  // via <a href=...> or window.location, not via fetch unless you need to handle the blob in JS.

  getSubtitleContent,
};

export default api; 