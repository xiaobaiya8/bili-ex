import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Row, Col, Card, Button, Spinner, Alert, Form, InputGroup, Badge } from 'react-bootstrap';
import api from '../services/api'; // 启用api服务导入
import { toast } from 'react-toastify'; 
import VideoDialog from '../components/VideoDialog';
import SubtitleViewer from '../components/SubtitleViewer';
import AudioPlayer from '../components/AudioPlayer';
import AISummaryViewer from '../components/AISummaryViewer';
import '../styles/bilibili-theme.css';

// 从api.ts导入类型，只导入我们实际使用的类型
import type { DownloadedVideo, RunningTask } from '../services/api';

// Placeholder Formatters
const formatDuration = (s: number | undefined) => s ? new Date(s * 1000).toISOString().substr(14, 5) : '--:--';
const formatCount = (c: number | undefined) => c ? (c > 10000 ? `${(c/10000).toFixed(1)}万` : c.toString()) : '-';
const getResourceIcon = (t: string) => ({ video: 'bi-film', audio: 'bi-music-note-beamed', subtitle: 'bi-file-text', ai_summary: 'bi-robot' }[t] || 'bi-file');
const getResourceName = (t: string) => ({ video: '视频', audio: '音频', subtitle: '字幕', ai_summary: 'AI总结' }[t] || '文件');

// Placeholder download function
const downloadFile = (type: string, filename: string) => {
    console.log(`Downloading ${type} - ${filename}`);
    const actualFilename = filename.includes('/') ? filename.substring(filename.lastIndexOf('/') + 1) : filename;
    // Construct the correct API URL
    const downloadUrl = `/api/download/${type}/${encodeURIComponent(filename)}`; 
    
    // Create an anchor element
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.setAttribute('download', decodeURIComponent(actualFilename));
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    toast.info(`开始下载 ${decodeURIComponent(actualFilename)}`);
};

// --- Component --- 

const FilesPage: React.FC = () => {
  const [videos, setVideos] = useState<DownloadedVideo[]>([]);
  const [runningTasks, setRunningTasks] = useState<{ [key: string]: RunningTask }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [subtitleInfo, setSubtitleInfo] = useState<{path: string, title: string} | null>(null);

  const [showAudio, setShowAudio] = useState(false);
  const [audioInfo, setAudioInfo] = useState<{path: string, title: string} | null>(null);

  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoModalInfo, setVideoModalInfo] = useState<{path: string, title: string, posterPath?: string} | null>(null);

  // AI总结相关状态 - 修改为使用Set记录正在生成的资源ID
  const [generatingAISummaries, setGeneratingAISummaries] = useState<Set<string>>(new Set());
  const [showAISummary, setShowAISummary] = useState(false);
  const [aiSummaryInfo, setAISummaryInfo] = useState<{path: string, title: string, bifPath?: string} | null>(null);

  // 搜索、排序和筛选状态
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'title-asc' | 'title-desc' | 'pubdate-asc' | 'pubdate-desc'>('newest');
  const [filterType, setFilterType] = useState<'all' | 'completed' | 'running'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'waiting' | 'downloading' | 'completed' | 'error'>('all');

  // 合并运行中任务和已完成视频到一个统一视图
  const combinedItems = useMemo(() => {
    const runningTaskValues = Object.values(runningTasks);
    const runningBvIds = new Set(runningTaskValues.map(task => task.info?.bv_id).filter(Boolean));
    
    // 过滤掉在运行任务中出现的已完成视频
    const filteredVideos = videos.filter(video => !runningBvIds.has(video.bv_id));
    
    // 构建组合项目，每个项目包含类型和数据
    let result = [
      ...runningTaskValues.map(task => ({ type: 'task' as const, data: task })),
      ...filteredVideos.map(video => ({ type: 'video' as const, data: video }))
    ];
    
    // 应用搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(item => {
        const title = item.type === 'task' 
          ? item.data.info?.title 
          : item.data.title;
        
        return title?.toLowerCase().includes(query);
      });
    }
    
    // 应用类型过滤
    if (filterType !== 'all') {
      if (filterType === 'running') {
        result = result.filter(item => item.type === 'task');
      } else if (filterType === 'completed') {
        result = result.filter(item => 
          item.type === 'video' || 
          (item.type === 'task' && item.data.overall_status === '完成')
        );
      }
    }
    
    // 应用状态过滤 (filterStatus)
    if (filterType !== 'completed' && filterStatus !== 'all') {
      result = result.filter(item => {
        // 状态筛选只适用于任务
        if (item.type === 'video') {
          return filterStatus === 'completed'; // 视频永远是"完成"状态
        }
        
        const task = item.data as RunningTask;
        switch (filterStatus) {
          case 'waiting':
            return task.overall_status === '等待中' || task.overall_status === '排队中';
          case 'downloading':
            return task.overall_status === '下载中' || task.overall_status.includes('下载') || 
                  (task.overall_status !== '完成' && task.overall_status !== '失败' && !task.overall_status.includes('错误'));
          case 'completed':
            return task.overall_status === '完成';
          case 'error':
            return task.overall_status === '失败' || task.overall_status.includes('错误') || task.overall_status.includes('失败');
          default:
            return true;
        }
      });
    }
    
    // 排序逻辑
    return result.sort((a, b) => {
      // 按最新排序（添加时间降序）
      if (sortOrder === 'newest') {
        // 对于两个任务，按时间戳比较
        if (a.type === 'task' && b.type === 'task') {
          return b.data.timestamp - a.data.timestamp;
        }
        // 对于一个任务和一个视频
        if (a.type === 'task' && b.type === 'video') {
          return -1; // 任务（较新）排在前面
        }
        if (a.type === 'video' && b.type === 'task') {
          return 1; // 视频排在任务后面
        }
        // 对于两个视频，没有明确的添加时间，按原顺序
        return 0;
      } 
      // 按最旧排序（添加时间升序）
      else if (sortOrder === 'oldest') {
        // 对于两个任务，按时间戳比较
        if (a.type === 'task' && b.type === 'task') {
          return a.data.timestamp - b.data.timestamp;
        }
        // 对于一个任务和一个视频
        if (a.type === 'task' && b.type === 'video') {
          return 1; // 任务（较新）排在后面
        }
        if (a.type === 'video' && b.type === 'task') {
          return -1; // 视频排在任务前面
        }
        // 对于两个视频，没有明确的添加时间，按原顺序
        return 0;
      }
      // 按标题排序
      else if (sortOrder === 'title-asc') {
        const titleA = a.type === 'task' ? (a.data.info?.title || '') : a.data.title;
        const titleB = b.type === 'task' ? (b.data.info?.title || '') : b.data.title;
        return titleA.localeCompare(titleB, 'zh-CN');
      }
      else if (sortOrder === 'title-desc') {
        const titleA = a.type === 'task' ? (a.data.info?.title || '') : a.data.title;
        const titleB = b.type === 'task' ? (b.data.info?.title || '') : b.data.title;
        return titleB.localeCompare(titleA, 'zh-CN');
      }
      // 按发布时间升序
      else if (sortOrder === 'pubdate-asc') {
        // 获取发布时间
        const getPubDate = (item: typeof a): Date | null => {
          let pubdate: string | number | undefined;
          
          if (item.type === 'task') {
            const task = item.data as RunningTask;
            pubdate = task.info?.pubdate;
          } else {
            const video = item.data as DownloadedVideo;
            pubdate = video.metadata?.pubdate;
          }
          
          // 返回null表示没有日期
          if (!pubdate) return null;
          
          // 尝试转换为Date对象
          try {
            // 如果pubdate是时间戳（数字）
            if (typeof pubdate === 'number' || !isNaN(Number(pubdate))) {
              return new Date(Number(pubdate) * 1000); // 假设是Unix时间戳（秒）
            }
            
            // 如果pubdate是日期字符串
            return new Date(pubdate);
          } catch (e) {
            console.warn("日期转换失败:", pubdate, e);
            return null;
          }
        };
        
        const dateA = getPubDate(a);
        const dateB = getPubDate(b);
        
        // 如果两个都有日期，按日期排序
        if (dateA && dateB) {
          return dateA.getTime() - dateB.getTime();
        }
        
        // 将没有日期的排在后面
        if (!dateA && dateB) return 1;
        if (dateA && !dateB) return -1;
        
        // 如果都没有日期，保持原顺序
        return 0;
      }
      // 按发布时间降序
      else if (sortOrder === 'pubdate-desc') {
        // 获取发布时间
        const getPubDate = (item: typeof a): Date | null => {
          let pubdate: string | number | undefined;
          
          if (item.type === 'task') {
            const task = item.data as RunningTask;
            pubdate = task.info?.pubdate;
          } else {
            const video = item.data as DownloadedVideo;
            pubdate = video.metadata?.pubdate;
          }
          
          // 返回null表示没有日期
          if (!pubdate) return null;
          
          // 尝试转换为Date对象
          try {
            // 如果pubdate是时间戳（数字）
            if (typeof pubdate === 'number' || !isNaN(Number(pubdate))) {
              return new Date(Number(pubdate) * 1000); // 假设是Unix时间戳（秒）
            }
            
            // 如果pubdate是日期字符串
            return new Date(pubdate);
          } catch (e) {
            console.warn("日期转换失败:", pubdate, e);
            return null;
          }
        };
        
        const dateA = getPubDate(a);
        const dateB = getPubDate(b);
        
        // 如果两个都有日期，按日期排序
        if (dateA && dateB) {
          return dateB.getTime() - dateA.getTime();
        }
        
        // 将没有日期的排在后面
        if (!dateA && dateB) return 1;
        if (dateA && !dateB) return -1;
        
        // 如果都没有日期，保持原顺序
        return 0;
      }
      
      return 0;
    });
  }, [videos, runningTasks, searchQuery, sortOrder, filterType, filterStatus]);

  const loadData = useCallback(async (showLoadingIndicator = true) => {
    if (showLoadingIndicator) {
        setIsLoading(true);
    }
    try {
        // 使用真实API调用
        const [downloadsRes, tasksRes] = await Promise.all([
          api.getDownloads(),
          api.getRunningTasks()
        ]);

        let fetchError = false;
        
        // 检查下载列表响应 - 处理不包含success字段的情况
        if (downloadsRes.videos || Array.isArray(downloadsRes)) {
          // 直接访问videos数组，如果downloadsRes本身就是数组也处理
          const videosData = Array.isArray(downloadsRes) ? downloadsRes : downloadsRes.videos || [];
          setVideos(videosData);
          console.log("成功加载视频列表:", videosData.length, "个视频");
        } else if (downloadsRes.success) {
          // 兼容包含success字段的情况
          setVideos(downloadsRes.videos || []);
        } else {
          fetchError = true;
          console.error("Failed to load downloads list:", downloadsRes);
        }
        
        // 检查任务列表响应
        if (tasksRes.success && tasksRes.tasks) {
          setRunningTasks(tasksRes.tasks);
        } else if (tasksRes.tasks) {
          // 如果没有success字段但有tasks字段
          setRunningTasks(tasksRes.tasks);
        } else {
          fetchError = true;
          console.error("Failed to load running tasks:", tasksRes);
        }

        if (fetchError) {
          toast.warn('刷新数据时遇到问题');
        } 

    } catch (err: any) {
      console.error("加载错误详情:", err);
      toast.error(err.message || '加载视频列表失败');
    } finally {
      if (showLoadingIndicator) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData(true); // Pass true for initial load indicator
  }, [loadData]);

  // Polling for running tasks
  useEffect(() => {
      const interval = setInterval(() => {
          console.log("[Polling] Checking running tasks...");
          // Fetch only running tasks without showing the main loading indicator
          const pollTasks = async () => {
              try {
                  // 使用真实API调用
                  const tasksRes = await api.getRunningTasks(); 
                  console.log("[Polling] 收到任务数据:", tasksRes);
                  
                  // 处理不同的响应格式
                  if (tasksRes.success && tasksRes.tasks) {
                      // 检查任务状态变化
                      const updatedTasks = tasksRes.tasks;
                      const currentTasks = { ...runningTasks };
                      let tasksChanged = false;
                      let completedTasks: string[] = [];
                      
                      // 检查完成的任务
                      Object.keys(currentTasks).forEach(taskId => {
                          if (!updatedTasks[taskId]) {
                              console.log(`[Polling] 任务 ${taskId} 不再运行，可能已完成`);
                              completedTasks.push(taskId);
                              tasksChanged = true;
                          }
                      });
                      
                      // 检查新增或更新的任务
                      Object.keys(updatedTasks).forEach(taskId => {
                          const newTask = updatedTasks[taskId];
                          const oldTask = currentTasks[taskId];
                          
                          if (!oldTask || JSON.stringify(oldTask) !== JSON.stringify(newTask)) {
                              console.log(`[Polling] 任务 ${taskId} 数据更新`);
                              tasksChanged = true;
                          }
                      });
                      
                      // 如果有任务完成或状态变化，刷新视频列表
                      if (completedTasks.length > 0) {
                          console.log("[Polling] 检测到任务完成，刷新视频列表");
                          loadData(false); // 刷新全部数据但不显示加载指示器
                      } else if (tasksChanged) {
                          // 只更新运行中任务状态
                          setRunningTasks(updatedTasks);
                      }
                  } else if (tasksRes.tasks) {
                      // 如果没有success字段但有tasks字段
                      setRunningTasks(tasksRes.tasks);
                  } else {
                      console.warn("[Polling] 没有找到tasks字段或返回格式不正确:", tasksRes);
                  }
              } catch (err) {
                  console.error("[Polling] Error fetching tasks:", err);
              }
          };
          pollTasks();
      }, 3000); // Poll every 3 seconds

      return () => clearInterval(interval); // Cleanup on unmount
  }, [runningTasks, loadData]); // 添加依赖，确保使用最新的状态

  // 处理打开字幕预览
  const handleOpenSubtitle = (type: 'task' | 'video', resourceData: any, title: string) => {
    let subtitlePath = '';
    
    if (type === 'task') {
      const task = resourceData as RunningTask;
      if (task.info?.title && task.info?.bv_id) {
        subtitlePath = `${task.info.title}/${task.info.bv_id}.srt`;
      }
    } else {
      const video = resourceData as DownloadedVideo;
      if (video.files.subtitle) {
        subtitlePath = video.files.subtitle.name;
      }
    }
    
    if (subtitlePath) {
      setSubtitleInfo({ path: subtitlePath, title });
      setShowSubtitle(true);
    } else {
      toast.error('无可用字幕');
    }
  };

  // 关闭字幕预览
  const handleCloseSubtitle = () => {
    setShowSubtitle(false);
  };

  // 处理打开音频预览
  const handleOpenAudio = (type: 'task' | 'video', resourceData: any, title: string) => {
    let audioPath = '';
    
    if (type === 'task') {
      const task = resourceData as RunningTask;
      if (task.info?.title && task.info?.bv_id) {
        audioPath = `${task.info.title}/${task.info.bv_id}.mp3`;
      }
    } else {
      const video = resourceData as DownloadedVideo;
      if (video.files.audio) {
        audioPath = video.files.audio.name;
      }
    }
    
    if (audioPath) {
      setAudioInfo({ path: audioPath, title });
      setShowAudio(true);
    } else {
      toast.error('无可用音频');
    }
  };
  
  // 关闭音频预览
  const handleCloseAudio = () => {
    setShowAudio(false);
  };

  // 处理打开视频预览
  const handleOpenVideo = (type: 'task' | 'video', resourceData: any, title: string) => {
    let videoPath = '';
    let posterPath = '';
    
    if (type === 'task') {
      const task = resourceData as RunningTask;
      if (task.info?.title && task.info?.bv_id) {
        videoPath = `${task.info.title}/${task.info.bv_id}.mp4`;
        posterPath = `${task.info.title}/poster.jpg`;
      }
    } else {
      const video = resourceData as DownloadedVideo;
      if (video.files.video) {
        videoPath = video.files.video.name;
        if (video.files.poster) {
          posterPath = video.files.poster.name;
        }
      }
    }
    
    if (videoPath) {
      setVideoModalInfo({ path: videoPath, title, posterPath });
      setShowVideoModal(true);
    } else {
      toast.error('无可用视频');
    }
  };
  
  // 关闭视频预览
  const handleCloseVideo = () => {
    setShowVideoModal(false);
  };

  // 处理生成AI总结
  const handleGenerateAISummary = async (type: 'task' | 'video', resourceData: any, title: string, bvId?: string) => {
    let subtitlePath = '';
    let resourceId = ''; // 用于跟踪生成状态的ID (可以是 task_id 或 bv_id)
    let videoTitle = title; // 用于API调用
    let videoBvId = bvId; // 用于API调用
    
    if (type === 'task') {
      const task = resourceData as RunningTask;
      if (task.info?.title && task.info?.bv_id) {
        subtitlePath = `${task.info.title}/${task.info.bv_id}.srt`;
        resourceId = task.task_id || task.info.bv_id;
        videoTitle = task.info.title;
        videoBvId = task.info.bv_id;
      }
    } else {
      const video = resourceData as DownloadedVideo;
      if (video.files.subtitle) {
        subtitlePath = video.files.subtitle.name;
        resourceId = video.bv_id;
        videoTitle = video.title;
        videoBvId = video.bv_id;
      }
    }
    
    if (!subtitlePath || !resourceId || !videoBvId) {
      toast.error('无法确定必要的视频信息（字幕路径/资源ID/BV号），无法生成AI总结');
      return;
    }
    
    // 更新生成状态
    setGeneratingAISummaries(prev => {
      const newSet = new Set(prev);
      newSet.add(resourceId);
      return newSet;
    });
    
    try {
      // --- 传递 bv_id 和 title 给 API --- 
      console.log(`调用 API 生成总结: bv_id=${videoBvId}, title=${videoTitle}, subtitlePath=${subtitlePath}`);
      const response = await api.generateAISummary(subtitlePath, videoBvId, videoTitle);
      
      if (response.success) {
        // 根据后端返回的消息判断是生成了新总结还是使用了已有总结
        if (response.message === "AI总结已存在") {
          toast.info('使用已有AI总结');
        } else {
          toast.success('AI总结生成成功');
        }
        
        // 显示生成或已有的总结内容
        // --- 后端现在返回相对路径，前端需要拼接 --- 
        // --- 假设 AI 总结文件和字幕在同一目录下 --- 
        const summaryDisplayPath = response.summary_path || `${videoTitle}/${videoBvId}_ai_summary.json`;
        
        // --- 尝试获取 BIF 路径 --- 
        let bifPath: string | undefined = undefined;
        if (type === 'task') {
            const task = resourceData as RunningTask;
            if (task.resource_status?.bif === '完成' && task.info?.title && task.info?.bv_id) {
                bifPath = `${task.info.title}/${task.info.bv_id}.bif`;
            }
        } else {
            const video = resourceData as DownloadedVideo;
            if (video.files.bif) {
                bifPath = video.files.bif.name;
            }
        }
        // ------------------------
        
        setAISummaryInfo({ 
          path: summaryDisplayPath, // 使用后端返回或推断的相对路径
          title: `${videoTitle} - AI总结`,
          bifPath: bifPath // <-- 传递 BIF 路径
        });
        setShowAISummary(true);
      } else {
        toast.error(response.message || 'AI总结生成失败');
      }
    } catch (error: any) {
      toast.error(error.message || 'AI总结生成请求失败');
    } finally {
      // 更新生成状态 - 移除当前资源
      setGeneratingAISummaries(prev => {
        const newSet = new Set(prev);
        newSet.delete(resourceId);
        return newSet;
      });
    }
  };

  // 关闭AI总结预览
  const handleCloseAISummary = () => {
    setShowAISummary(false);
  };

  // 渲染各种资源按钮（视频/音频/字幕/AI总结）
  const renderResourceButtons = (
    type: 'task' | 'video', 
    resourceData: { [key: string]: any }, 
    resourceStatus?: { [key: string]: string }
  ) => {
    const types = ['video', 'audio', 'subtitle', 'ai_summary'];
    
    return types.map(resourceType => {
      if (type === 'task') {
        // 运行中任务的资源按钮
        const task = resourceData as RunningTask;
        const taskId = task.task_id || (task.info?.bv_id ? task.info.bv_id : '');
        const bvId = task.info?.bv_id; // 获取BV号
        const title = task.info?.title || 'AI总结'; // 获取标题
        const status = resourceStatus?.[resourceType] || '未知';
        const isCompleted = status === '完成';
        const isFailed = status.startsWith('失败');
        
        // 检查此资源是否正在 *手动* 生成AI总结 (前端状态)
        const isGeneratingAISummaryFrontend = generatingAISummaries.has(taskId);
        // 检查此资源是否正在 *后台* 生成AI总结 (后端状态)
        const isGeneratingAISummaryBackend = resourceStatus?.ai_summary === '生成中';
        // 合并两种加载状态
        const shouldShowAiSpinner = isGeneratingAISummaryFrontend || isGeneratingAISummaryBackend;

        // 文件名构建
        const baseFilename = (task.info?.title && task.info?.bv_id) ? `${task.info.title}/${task.info.bv_id}` : null;
        const fileExt = resourceType === 'video' ? 'mp4' : (resourceType === 'audio' ? 'mp3' : 'srt');
        const fullFilename = baseFilename ? `${baseFilename}.${fileExt}` : null;
        
        // AI总结按钮特殊处理
        if (resourceType === 'ai_summary') {
          // 检查是否有字幕可用
          const hasSubtitle = resourceStatus?.subtitle === '完成';
          // AI总结资源本身的状态 (来自后端)
          const aiSummaryStatus = resourceStatus?.ai_summary || '未知'; 
          const isAiSummaryFailed = aiSummaryStatus.startsWith('失败');
          const isAiSummaryCompleted = aiSummaryStatus === '完成';
          
          // 构建按钮标题
          let buttonTitle = '生成AI总结';
          if (!hasSubtitle) {
            buttonTitle = '需要先下载字幕';
          } else if (shouldShowAiSpinner) {
            buttonTitle = '生成中...';
          } else if (isAiSummaryFailed) {
            buttonTitle = `生成失败: ${aiSummaryStatus}`;
          } else if (isAiSummaryCompleted) {
             buttonTitle = '查看AI总结'; // 或者保持'生成AI总结'，让用户重新生成？
          }

          // 构建按钮样式
          let buttonClassName = 'text-primary'; // 默认
          if (shouldShowAiSpinner) {
            buttonClassName = 'text-warning';
          } else if (isAiSummaryFailed) {
            buttonClassName = 'text-danger';
          } else if (!hasSubtitle) {
            buttonClassName = 'text-secondary'; // 字幕未完成时灰显
          }

          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className={`bili-action-btn p-1 text-decoration-none ${buttonClassName}`}
              style={{fontSize: '0.8rem'}}
              disabled={!hasSubtitle || shouldShowAiSpinner} // 禁用条件：字幕未就绪或正在生成
              onClick={() => hasSubtitle && bvId && !shouldShowAiSpinner && handleGenerateAISummary(type, task, title, bvId)} 
              title={buttonTitle}
            >
              {shouldShowAiSpinner && <Spinner animation="border" size="sm" variant="warning" className="me-1" />} 
              {!shouldShowAiSpinner && <i className={`bi ${getResourceIcon(resourceType)} me-1`}></i>}
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        }
        
        // --- 修改其他按钮的 isInProgress 逻辑 --- 
        // 现在需要单独判断每个资源的状态
        const isResourceInProgress = !isCompleted && !isFailed && status !== '未请求' && status !== '排队中';

        // 保留原有逻辑处理其他资源类型
        if (resourceType === 'subtitle' && isCompleted && fullFilename) {
          // 字幕预览按钮
          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className="bili-action-btn text-primary p-1 text-decoration-none" 
              style={{fontSize: '0.8rem'}}
              onClick={() => handleOpenSubtitle(type, task, task.info?.title || '字幕')}
              title="查看字幕"
            >
              <i className={`bi ${getResourceIcon(resourceType)} me-1`}></i>
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        } else if (resourceType === 'audio' && isCompleted && fullFilename) {
          // 音频预览按钮
          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className="bili-action-btn text-primary p-1 text-decoration-none" 
              style={{fontSize: '0.8rem'}}
              onClick={() => handleOpenAudio(type, task, task.info?.title || '音频')}
              title="播放音频"
            >
              <i className={`bi ${getResourceIcon(resourceType)} me-1`}></i>
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        } else if (resourceType === 'video' && isCompleted && fullFilename) {
          // 视频预览按钮
          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className="bili-action-btn text-primary p-1 text-decoration-none" 
              style={{fontSize: '0.8rem'}}
              onClick={() => handleOpenVideo(type, task, task.info?.title || '视频')}
              title="播放视频"
            >
              <i className={`bi ${getResourceIcon(resourceType)} me-1`}></i>
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        }
        
        // 其他/未完成资源按钮 (不包括AI总结)
        if (resourceType !== 'ai_summary') {
          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className={`bili-action-btn p-1 text-decoration-none ${isFailed ? 'text-danger' : (isCompleted ? 'text-primary' : (isResourceInProgress ? 'text-secondary' : 'text-muted'))}`} // 根据资源状态显示样式
              style={{fontSize: '0.8rem'}}
              disabled={!isCompleted || !fullFilename} // 完成才能下载
              onClick={() => isCompleted && fullFilename && downloadFile(resourceType, fullFilename)}
              title={isFailed ? `失败: ${status}` : (isCompleted && fullFilename ? `下载${getResourceName(resourceType)}` : status)}
            >
              {isResourceInProgress && <Spinner animation="border" size="sm" variant="secondary" className="me-1" />} 
              {!isResourceInProgress && <i className={`bi ${getResourceIcon(resourceType)} me-1`}></i>}
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        }
        
        return null;
      } else {
        // 已完成视频的资源按钮
        const video = resourceData as DownloadedVideo;
        const videoId = video.bv_id;
        const file = video.files[resourceType as keyof typeof video.files];
        const isGeneratingAISummary = generatingAISummaries.has(videoId);
        
        // AI总结按钮特殊处理
        if (resourceType === 'ai_summary') {
          const hasSubtitle = !!video.files.subtitle;
          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className={`bili-action-btn p-1 text-decoration-none ${isGeneratingAISummary ? 'text-warning' : 'text-primary'}`}
              style={{fontSize: '0.8rem'}}
              disabled={!hasSubtitle || isGeneratingAISummary || !videoId} // 确保有videoId
              onClick={() => hasSubtitle && videoId && handleGenerateAISummary(type, video, video.title, videoId)} // 传递videoId(即bv_id)和title
              title={!hasSubtitle ? '需要先下载字幕' : (isGeneratingAISummary ? '生成中...' : '生成AI总结')}
            >
              {isGeneratingAISummary && <Spinner animation="border" size="sm" variant="warning" className="me-1" />}
              {!isGeneratingAISummary && <i className={`bi ${getResourceIcon(resourceType)} me-1`}></i>}
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        }
        
        // 保留原有逻辑处理其他资源类型
        if (resourceType === 'subtitle' && file) {
          // 字幕预览按钮
          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className="bili-action-btn text-primary p-1 text-decoration-none" 
              style={{fontSize: '0.8rem'}}
              onClick={() => handleOpenSubtitle(type, video, video.title)}
              title="查看字幕"
            >
              <i className={`bi ${getResourceIcon(resourceType)} me-1`}></i>
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        } else if (resourceType === 'audio' && file) {
          // 音频预览按钮
          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className="bili-action-btn text-primary p-1 text-decoration-none" 
              style={{fontSize: '0.8rem'}}
              onClick={() => handleOpenAudio(type, video, video.title)}
              title="播放音频"
            >
              <i className={`bi ${getResourceIcon(resourceType)} me-1`}></i>
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        } else if (resourceType === 'video' && file) {
          // 视频预览按钮
          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className="bili-action-btn text-primary p-1 text-decoration-none" 
              style={{fontSize: '0.8rem'}}
              onClick={() => handleOpenVideo(type, video, video.title)}
              title="播放视频"
            >
              <i className={`bi ${getResourceIcon(resourceType)} me-1`}></i>
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        }
        
        // 其他资源按钮
        if (resourceType !== 'ai_summary') {
          return (
            <Button 
              key={resourceType} 
              variant="link" 
              size="sm" 
              className="bili-action-btn text-primary p-1 text-decoration-none" 
              style={{fontSize: '0.8rem'}}
              disabled={!file}
              onClick={() => file && downloadFile(resourceType, file.name)}
              title={file ? `下载 ${getResourceName(resourceType)}` : `${getResourceName(resourceType)} 不可用`}
            >
              <i className={`bi ${file ? getResourceIcon(resourceType) : 'bi-slash-circle'} me-1`}></i>
              <span>{getResourceName(resourceType)}</span>
            </Button>
          );
        }
        
        return null;
      }
    }).filter(Boolean); // 过滤掉null按钮
  };

  // 渲染统一的内容卡片（处理任务或视频）
  const renderContentCard = (item: { type: 'task' | 'video', data: RunningTask | DownloadedVideo }) => {
    const { type, data } = item;
    
    if (type === 'task') {
      const task = data as RunningTask;
      const { task_id, info, overall_status, resource_status, progress } = task;
      const title = info.title || '加载中...';
      const owner = info.owner || '未知';
      const duration = formatDuration(info.duration);
      
      // 检查是否有本地封面
      const posterApiUrl = (info.title && !info.title.startsWith('加载中...')) 
        ? `/api/download/poster/${encodeURIComponent(info.title)}/poster.jpg` 
        : info.cover_url || null;

      // 是否有可播放视频
      const hasPlayableVideo = overall_status === '完成' && resource_status?.video === '完成';

      return (
        <Col key={task_id} xs={12} sm={6} md={3} lg={2} xl={2} className="mb-4 bili-card-col">
          <Card className="bili-video-card h-100" style={{ opacity: overall_status === '完成' ? 1 : 0.85 }}>
            <div className="bili-video-cover position-relative bg-light d-flex align-items-center justify-content-center" style={{ aspectRatio: '16/10' }}>
              {posterApiUrl ? (
                <Card.Img 
                  variant="top" 
                  src={posterApiUrl} 
                  style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => { 
                    e.currentTarget.style.display = 'none'; 
                  }} 
                />
              ) : (
                <div className="bili-no-image">
                  <i className="bi bi-image-fill text-muted"></i>
                </div>
              )}
              {duration && <span className="bili-video-duration position-absolute bottom-0 end-0 bg-dark text-white px-1 py-0 me-1 mb-1 rounded">{duration}</span>}
              
              {/* 添加视频统计数据在封面左下角 */}
              {overall_status === '完成' && info && (
                <div className="position-absolute bottom-0 start-0 d-flex align-items-center ms-1 mb-1">
                  {'view_count' in info && info.view_count !== undefined && info.view_count > 0 && 
                    <div className="bili-cover-stat bg-dark bg-opacity-75 text-white rounded px-1 py-0 me-1 d-flex align-items-center">
                      <i className="bi bi-eye me-1 small"></i>
                      <span className="small">{formatCount(info.view_count as number)}</span>
                    </div>
                  }
                  {'danmaku_count' in info && info.danmaku_count !== undefined && info.danmaku_count > 0 && 
                    <div className="bili-cover-stat bg-dark bg-opacity-75 text-white rounded px-1 py-0 me-1 d-flex align-items-center">
                      <i className="bi bi-chat-dots me-1 small"></i>
                      <span className="small">{formatCount(info.danmaku_count as number)}</span>
                    </div>
                  }
                </div>
              )}
              
              {overall_status !== '完成' && (
                <div className="position-absolute w-100 bottom-0 bg-dark bg-opacity-75 text-white p-1 text-center task-status-container">
                  <i className="bi bi-cloud-arrow-down-fill me-1"></i> {overall_status}
                </div>
              )}
              
              {hasPlayableVideo && (
                <div className="video-play-overlay" onClick={() => handleOpenVideo(type, task, task.info?.title || '视频')}>
                  <i className="bi bi-play-circle-fill video-play-icon"></i>
                </div>
              )}
            </div>
            <Card.Body className="bili-video-info p-2 d-flex flex-column">
              <Card.Title className="bili-video-title mb-1" title={title}>{title}</Card.Title>
              <div className="bili-uploader mb-2">
                <i className="bi bi-person-circle me-1 text-muted small"></i>
                <span className="bili-uploader-name">{owner}</span>
              </div>
              {/* 进度条只在非完成状态显示 */}
              {overall_status !== '完成' && (
                <div className="progress mt-auto" style={{ height: '5px' }}>
                  <div 
                    className={`progress-bar progress-bar-striped progress-bar-animated ${overall_status === '失败' ? 'bg-danger' : ''}`} 
                    role="progressbar" 
                    style={{ width: `${progress || 0}%` }}
                    aria-valuenow={progress || 0}
                    aria-valuemin={0} 
                    aria-valuemax={100}></div>
                </div>
              )}
              {/* 完成状态则显示视频统计 */}
              {overall_status === '完成' && info && 'view_count' in info && (
                <div className="bili-video-stats mt-auto d-flex justify-content-between align-items-center text-muted">
                  <div className="bili-video-stats-count d-flex gap-2">
                    {'view_count' in info && info.view_count !== undefined && <div className="bili-stat-item d-flex align-items-center gap-1"><i className="bi bi-eye"></i><span>{formatCount(info.view_count as number)}</span></div>}
                    {'danmaku_count' in info && info.danmaku_count !== undefined && <div className="bili-stat-item d-flex align-items-center gap-1"><i className="bi bi-chat-dots"></i><span>{formatCount(info.danmaku_count as number)}</span></div>}
                    {'like_count' in info && info.like_count !== undefined && info.like_count > 0 && <div className="bili-stat-item d-flex align-items-center gap-1"><i className="bi bi-hand-thumbs-up"></i><span>{formatCount(info.like_count as number)}</span></div>}
                    {'coin_count' in info && info.coin_count !== undefined && info.coin_count > 0 && <div className="bili-stat-item d-flex align-items-center gap-1"><i className="bi bi-coin"></i><span>{formatCount(info.coin_count as number)}</span></div>}
                    {'favorite_count' in info && info.favorite_count !== undefined && info.favorite_count > 0 && <div className="bili-stat-item d-flex align-items-center gap-1"><i className="bi bi-star"></i><span>{formatCount(info.favorite_count as number)}</span></div>}
                  </div>
                  <div className="bili-pubdate">
                    {'pubdate' in info && info.pubdate ? <><i className="bi bi-calendar me-1"></i> {`${info.pubdate}`}</> : null}
                  </div>
                </div>
              )}
            </Card.Body>
            <Card.Footer className="bili-action-bar p-1 d-flex justify-content-around">
              {renderResourceButtons('task', task, resource_status)}
            </Card.Footer>
          </Card>
        </Col>
      );
    } else {
      const video = data as DownloadedVideo;
      const { bv_id, title, metadata, files } = video;
      const posterApiUrl = (files.poster && title) ? `/api/download/poster/${encodeURIComponent(title)}/poster.jpg` : null;
      const duration = formatDuration(metadata.duration);
      const viewCount = formatCount(metadata.view_count);
      const danmakuCount = formatCount(metadata.danmaku_count);
      const pubdate = metadata.pubdate ? metadata.pubdate : '-';
      const videoFilePath = files.video ? files.video.name : null;
      const hasPlayableVideo = !!videoFilePath;

      return (
        <Col key={bv_id} xs={12} sm={6} md={3} lg={2} xl={2} className="mb-4 bili-card-col">
          <Card className="bili-video-card h-100">
            <div className="bili-video-cover position-relative bg-light d-flex align-items-center justify-content-center" style={{ aspectRatio: '16/10' }}>
              {posterApiUrl ? (
                <Card.Img 
                  variant="top" 
                  src={posterApiUrl} 
                  style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => { 
                    e.currentTarget.style.display = 'none'; 
                  }} 
                />
              ) : (
                <div className="bili-no-image">
                  <i className="bi bi-image-fill text-muted"></i>
                </div>
              )}
              {duration && <span className="bili-video-duration position-absolute bottom-0 end-0 bg-dark text-white px-1 py-0 me-1 mb-1 rounded">{duration}</span>}
              
              {/* 添加视频统计数据在封面左下角 */}
              {metadata.view_count !== undefined && metadata.view_count > 0 && (
                <div className="position-absolute bottom-0 start-0 d-flex align-items-center ms-1 mb-1">
                  <div className="bili-cover-stat bg-dark bg-opacity-75 text-white rounded px-1 py-0 me-1 d-flex align-items-center">
                    <i className="bi bi-eye me-1 small"></i>
                    <span className="small">{viewCount}</span>
                  </div>
                  {metadata.danmaku_count !== undefined && metadata.danmaku_count > 0 && 
                    <div className="bili-cover-stat bg-dark bg-opacity-75 text-white rounded px-1 py-0 me-1 d-flex align-items-center">
                      <i className="bi bi-chat-dots me-1 small"></i>
                      <span className="small">{danmakuCount}</span>
                    </div>
                  }
                </div>
              )}
              
              {hasPlayableVideo && (
                <div className="video-play-overlay" onClick={() => handleOpenVideo(type, video, title)}>
                  <i className="bi bi-play-circle-fill video-play-icon"></i>
                </div>
              )}
            </div>
            <Card.Body className="bili-video-info p-2 d-flex flex-column">
              <Card.Title className="bili-video-title mb-1" title={title}>{title}</Card.Title>
              <div className="bili-uploader mb-1">
                <i className="bi bi-person-circle me-1 text-muted small"></i>
                <span className="bili-uploader-name">UP: {metadata.owner || '未知'}</span>
              </div>
              <div className="bili-video-stats mt-auto d-flex justify-content-between align-items-center text-muted">
                <div className="bili-video-stats-count d-flex gap-2">
                  {metadata.like_count !== undefined && metadata.like_count > 0 && <div className="bili-stat-item d-flex align-items-center gap-1"><i className="bi bi-hand-thumbs-up"></i><span>{formatCount(metadata.like_count)}</span></div>}
                  {metadata.coin_count !== undefined && metadata.coin_count > 0 && <div className="bili-stat-item d-flex align-items-center gap-1"><i className="bi bi-coin"></i><span>{formatCount(metadata.coin_count)}</span></div>}
                  {metadata.favorite_count !== undefined && metadata.favorite_count > 0 && <div className="bili-stat-item d-flex align-items-center gap-1"><i className="bi bi-star"></i><span>{formatCount(metadata.favorite_count)}</span></div>}
                </div>
                <div className="bili-pubdate">
                  {pubdate !== '-' && <><i className="bi bi-calendar me-1"></i> {pubdate}</>}
                </div>
              </div>
            </Card.Body>
            <Card.Footer className="bili-action-bar p-1 d-flex justify-content-around">
              {renderResourceButtons('video', video)}
            </Card.Footer>
          </Card>
        </Col>
      );
    }
  };

  return (
    <Container fluid className="px-3 py-2">
      <Container fluid className="px-lg-5">
        <Card className="mb-3 bili-filter-bar shadow-sm border-0">
          <Card.Body className="p-2">
            <div className="d-flex flex-wrap justify-content-between align-items-center">
              <div className="d-flex flex-wrap bili-filter-group">
                <div className="me-2 mb-2 mb-md-0 bili-filter-item">
                  <Form.Select 
                    value={filterType} 
                    onChange={e => setFilterType(e.target.value as 'all' | 'completed' | 'running')}
                    size="sm"
                    className="border-0 bg-light rounded-pill"
                  >
                    <option value="all">全部内容</option>
                    <option value="running">下载任务</option>
                    <option value="completed">已完成视频</option>
                  </Form.Select>
                </div>
                <div className="me-2 mb-2 mb-md-0 bili-filter-item">
                  <Form.Select 
                    value={filterStatus} 
                    onChange={e => setFilterStatus(e.target.value as 'all' | 'waiting' | 'downloading' | 'completed' | 'error')}
                    disabled={filterType === 'completed'}
                    size="sm"
                    className={`border-0 bg-light rounded-pill ${filterType === 'completed' ? 'opacity-50' : ''}`}
                  >
                    <option value="all">全部状态</option>
                    <option value="waiting">等待中</option>
                    <option value="downloading">下载中</option>
                    <option value="completed">已完成</option>
                    <option value="error">错误</option>
                  </Form.Select>
                </div>
                <div className="me-2 mb-2 mb-md-0 bili-filter-item">
                  <Form.Select 
                    value={sortOrder} 
                    onChange={e => setSortOrder(e.target.value as 'newest' | 'oldest' | 'title-asc' | 'title-desc' | 'pubdate-asc' | 'pubdate-desc')}
                    size="sm"
                    className="border-0 bg-light rounded-pill"
                  >
                    <option value="newest">添加时间 ↓</option>
                    <option value="title-asc">标题升序 ↑</option>
                    <option value="title-desc">标题降序 ↓</option>
                    <option value="pubdate-asc">发布时间升序 ↑</option>
                    <option value="pubdate-desc">发布时间降序 ↓</option>
                  </Form.Select>
                </div>
              </div>
              <div className="bili-search-input flex-grow-1 flex-md-grow-0 mt-2 mt-md-0" style={{maxWidth: '300px'}}>
                <InputGroup size="sm">
                  <Form.Control
                    type="text"
                    placeholder="搜索视频..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="border-0 bg-light focus-ring rounded-start-pill"
                    aria-label="搜索视频"
                  />
                  {searchQuery && (
                    <Button 
                      variant="light" 
                      onClick={() => setSearchQuery('')}
                      title="清除搜索"
                      className="border-0"
                    >
                      <i className="bi bi-x"></i>
                    </Button>
                  )}
                  <Button variant="primary" className="border-0 rounded-end-pill">
                    <i className="bi bi-search"></i>
                  </Button>
                </InputGroup>
              </div>
            </div>
            
            {/* 结果计数和过滤状态 */}
            {!isLoading && (
              <div className="d-flex flex-wrap justify-content-between align-items-center mt-2 px-1">
                <div className="bili-result-info text-muted small">
                  共找到 <Badge bg="info" pill>{combinedItems.length}</Badge> 个结果
                  {filterType !== 'all' && <> · 已筛选: <Badge bg="primary" pill>{filterType === 'running' ? '下载任务' : '已完成视频'}</Badge></>}
                  {filterStatus !== 'all' && filterType !== 'completed' && <> · 状态: <Badge bg="secondary" pill>{
                    filterStatus === 'waiting' ? '等待中' : 
                    filterStatus === 'downloading' ? '下载中' : 
                    filterStatus === 'completed' ? '已完成' : '错误'
                  }</Badge></>}
                  {searchQuery && <> · 搜索: <Badge bg="success" pill className="text-truncate" style={{maxWidth: '150px'}}>{searchQuery}</Badge></>}
                </div>
                <div className="bili-refresh-btn">
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="p-0 text-muted" 
                    onClick={() => loadData(false)}
                    title="刷新"
                  >
                    <i className="bi bi-arrow-clockwise"></i> 刷新
                  </Button>
                </div>
              </div>
            )}
          </Card.Body>
        </Card>
        
        {isLoading ? (
          <div className="bili-loading py-5">
            <Spinner animation="border" className="bili-loading-spinner mb-2" />
            <div className="text-muted">加载中...</div>
          </div>
        ) : combinedItems.length > 0 ? (
          <Row>
            {combinedItems.map(renderContentCard)}
          </Row>
        ) : (
          <Alert variant="info" className="text-center py-4">
            <i className="bi bi-info-circle me-2 fs-4"></i>
            <div className="mt-2">没有找到符合条件的内容</div>
            {searchQuery && <div className="mt-2 small">尝试清除搜索条件 "<strong>{searchQuery}</strong>"</div>}
            <Button variant="outline-primary" size="sm" className="mt-3" onClick={() => {
              setSearchQuery('');
              setFilterType('all');
              setFilterStatus('all');
            }}>
              <i className="bi bi-arrow-counterclockwise me-1"></i> 重置所有筛选
            </Button>
          </Alert>
        )}
      </Container>

      {/* 字幕预览组件 */}
      {subtitleInfo && (
        <SubtitleViewer
          show={showSubtitle}
          onClose={handleCloseSubtitle}
          subtitlePath={subtitleInfo.path}
          title={subtitleInfo.title}
        />
      )}
      
      {/* 音频播放器组件 */}
      {audioInfo && (
        <AudioPlayer
          show={showAudio}
          onClose={handleCloseAudio}
          audioSrc={`/api/download/audio/${encodeURIComponent(audioInfo.path)}`}
          title={audioInfo.title}
        />
      )}
      
      {/* 视频播放器组件 */}
      {videoModalInfo && (
        <VideoDialog
          show={showVideoModal}
          onClose={handleCloseVideo}
          videoSrc={`/api/download/video/${encodeURIComponent(videoModalInfo.path)}`}
          title={videoModalInfo.title}
          animationStyle="top-in-bottom-out"
        />
      )}
      
      {/* AI总结预览组件 */}
      {aiSummaryInfo && (
        <AISummaryViewer
          show={showAISummary}
          onClose={handleCloseAISummary}
          summaryPath={aiSummaryInfo.path}
          title={aiSummaryInfo.title}
          bifPath={aiSummaryInfo.bifPath}
        />
      )}
    </Container>
  );
};

export default FilesPage; 