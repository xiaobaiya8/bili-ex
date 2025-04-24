import React, { useState, useEffect } from 'react';
import { Modal, Button, Spinner, Table, Alert, Form } from 'react-bootstrap';
import './SubtitleViewer.css';

interface SubtitleViewerProps {
  subtitlePath: string;
  title?: string;
  onClose: () => void;
  show: boolean;
  isAISummary?: boolean;
}

interface SubtitleItem {
  id: number;
  startTime: string;
  endTime: string;
  text: string;
}

const SubtitleViewer: React.FC<SubtitleViewerProps> = ({
  subtitlePath,
  title,
  onClose,
  show,
  isAISummary = false
}) => {
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState<string>('');
  const [showRawContent, setShowRawContent] = useState(false);

  useEffect(() => {
    if (show) {
      fetchSubtitle();
    }
  }, [show, subtitlePath]);

  const fetchSubtitle = async () => {
    setLoading(true);
    setError(null);
    setRawContent('');
    
    try {
      // 直接使用下载链接获取字幕内容
      const response = await fetch(`/api/download/subtitle/${encodeURIComponent(subtitlePath)}`);
      
      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`);
      }
      
      const data = await response.text();
      setRawContent(data); // 保存原始内容
      
      // 检查文件扩展名
      const fileExt = subtitlePath.split('.').pop()?.toLowerCase();
      if (fileExt !== 'srt') {
        setError(`检测到文件扩展名为 .${fileExt}，而非标准SRT格式(.srt)`);
        setLoading(false);
        return;
      }
      
      const parsedSubtitles = parseSRT(data);
      setSubtitles(parsedSubtitles);
    } catch (err: any) {
      console.error('获取字幕失败:', err);
      setError(err.message || '无法加载字幕内容');
    } finally {
      setLoading(false);
    }
  };

  const parseSRT = (srtContent: string): SubtitleItem[] => {
    // 首先检查内容是否包含HTML标签，这可能表明不是有效的SRT格式
    if (/<html|<!DOCTYPE|<head|<body/i.test(srtContent)) {
      setError('检测到无效字幕格式：字幕文件可能包含HTML代码而非SRT格式');
      return [];
    }

    try {
      // 简单的SRT格式解析
      const blocks = srtContent.trim().split(/\n\s*\n/);
      const parsedItems = blocks.map(block => {
        const lines = block.split('\n');
        if (lines.length < 3) return null;
        
        // 尝试解析字幕ID
        const idStr = lines[0].trim();
        const id = parseInt(idStr);
        if (isNaN(id)) {
          console.warn(`无效的字幕ID: ${idStr}`);
          return null;
        }
        
        // 检查时间轴格式
        const timelineStr = lines[1].trim();
        const timeMatch = timelineStr.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
        if (!timeMatch) {
          console.warn(`无效的时间轴格式: ${timelineStr}`);
          return null;
        }
        
        const startTime = timeMatch[1];
        const endTime = timeMatch[2];
        const text = lines.slice(2).join('\n');
        
        return { id, startTime, endTime, text };
      }).filter(Boolean) as SubtitleItem[];
      
      // 如果解析后没有有效字幕项，但原始内容非空，则认为格式有问题
      if (parsedItems.length === 0 && srtContent.trim().length > 0) {
        setError('无法解析字幕内容，可能不是标准的SRT格式');
      }
      
      return parsedItems;
    } catch (err) {
      console.error('字幕解析错误:', err);
      setError('字幕解析出错，可能是格式问题');
      return [];
    }
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = `/api/download/subtitle/${encodeURIComponent(subtitlePath)}`;
    a.download = subtitlePath.split('/').pop() || 'subtitle.srt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  
  const toggleRawContent = () => {
    setShowRawContent(!showRawContent);
  };

  // 格式化时间显示
  const formatTime = (timeStr: string) => {
    return timeStr.replace(',', '.').substring(3, 8);
  };

  return (
    <Modal
      show={show}
      onHide={onClose}
      dialogClassName="subtitle-viewer-modal"
      contentClassName="subtitle-viewer-content"
      centered
      size="lg"
    >
      <Modal.Header closeButton>
        <Modal.Title>
          <i className={`bi ${isAISummary ? 'bi-robot' : 'bi-file-text'} me-2`}></i>
          {title ? title : (isAISummary ? 'AI总结' : '字幕预览')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading ? (
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
            <p className="mt-2">{isAISummary ? '加载AI总结中...' : '加载字幕中...'}</p>
          </div>
        ) : error ? (
          <div className="subtitle-error-container">
            <Alert variant="danger">
              <i className="bi bi-exclamation-triangle-fill me-2"></i>
              {error}
            </Alert>
            
            {rawContent && (
              <div className="mt-3">
                <Button 
                  variant="outline-secondary" 
                  size="sm"
                  onClick={toggleRawContent}
                >
                  <i className={`bi bi-${showRawContent ? 'eye-slash' : 'eye'} me-1`}></i>
                  {showRawContent ? "隐藏" : "查看"}原始内容
                </Button>
                
                {showRawContent && (
                  <Form.Control
                    as="textarea"
                    rows={10}
                    value={rawContent}
                    readOnly
                    className="raw-content-textarea font-monospace mt-2"
                  />
                )}
              </div>
            )}
          </div>
        ) : subtitles.length === 0 ? (
          <div className="text-center py-3">无字幕内容</div>
        ) : (
          <div className="subtitle-table-container">
            <Table striped hover className="subtitle-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>#</th>
                  <th style={{ width: '100px' }}>开始时间</th>
                  <th style={{ width: '100px' }}>结束时间</th>
                  <th>字幕文本</th>
                </tr>
              </thead>
              <tbody>
                {subtitles.map(sub => (
                  <tr key={sub.id}>
                    <td>{sub.id}</td>
                    <td>{formatTime(sub.startTime)}</td>
                    <td>{formatTime(sub.endTime)}</td>
                    <td>{sub.text}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>
          关闭
        </Button>
        <Button 
          variant="primary" 
          onClick={handleDownload}
          disabled={loading}
        >
          <i className="bi bi-download me-1"></i>
          {isAISummary ? '下载总结' : '下载字幕'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SubtitleViewer; 