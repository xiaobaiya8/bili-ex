import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Spinner, Alert, Card, ListGroup, Badge, Row, Col } from 'react-bootstrap';
import './SubtitleViewer.css'; // 复用CSS样式
import './AISummaryViewer.css'; // <-- 引入新的 CSS 文件 (后面创建)
import ReactMarkdown from 'react-markdown';

// --- BIF 解析器 (来自 https://gist.github.com/pkulak/61de475a74d824a9d875) ---
interface BifImage {
  seconds: number;
  bytes: ArrayBuffer;
}

const sliceToLong = (data: Uint8Array, start: number, end: number): number => {
  let value = 0;
  for (let i = end - 1; i >= start; i--) {
    value = (value * 256) + data[i];
  }
  return value;
};

const parseBif = (buffer: ArrayBuffer): BifImage[] | false => {
  const data = new Uint8Array(buffer);
  const magicNumber = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

  for (let i = 0; i < magicNumber.length; i++) {
    if (data[i] !== magicNumber[i]) {
      console.error("Invalid BIF magic number");
      return false;
    }
  }

  const version = sliceToLong(data, 8, 12);
  if (version !== 0) {
    console.error("Unsupported BIF version:", version);
    return false;
  }

  const imageCount = sliceToLong(data, 12, 16);
  // Note: Gist uses separation at 16, but Roku spec says image count is at 12
  // and multiplier at 16. Let's follow the spec.
  const separation = sliceToLong(data, 16, 20); // Timestamp multiplier (ms)
  const timestampMultiplier = separation === 0 ? 1000 : separation;

  interface BifRef { timestamp: number; start: number; end?: number }
  const refs: BifRef[] = [];
  let lastRef: BifRef | null = null;
  const indexStart = 64;

  for (let i = indexStart; i < buffer.byteLength; i += 8) {
    // --- 添加详细日志 ---
    const ts = sliceToLong(data, i, i + 4);
    const offset = sliceToLong(data, i + 4, i + 8);
    console.log(`[parseBif] Read index at ${i}: timestamp=${ts}, offset=${offset}`);
    // ---------------------

    if (ts === 0xFFFFFFFF) {
      if (lastRef) lastRef.end = offset;
      break; // End of index table
    }
    
    // Basic check for valid offset
    if (offset >= buffer.byteLength) {
        console.error(`Invalid offset ${offset} at index ${i}`);
        // Potentially break or try to recover, for now return false
        return false;
    }

    const ref: BifRef = { timestamp: ts, start: offset };
    if (lastRef) {
      lastRef.end = offset; // End of previous image is start of this one
    }
    refs.push(ref);
    lastRef = ref;
    
    // Check if index table goes beyond data bounds, accounting for the last entry
    if (i + 8 >= offset && ts !== 0xFFFFFFFF) { 
       console.warn(`Index table entry at ${i} potentially overlaps with image data starting at ${offset}`);
       // Heuristic: If the next potential index overlaps where the first image *should* be,
       // assume the index table ended. This handles BIFs where the 0xFFFFFFFF marker isn't present.
       if (refs.length > 0 && i + 8 >= refs[0].start) {
           console.warn("Index table seems to overlap image data, stopping index read.");
           if (lastRef) lastRef.end = buffer.byteLength; // Assume last image goes to EOF
           break; 
       }
    }
  }
  
  // If the loop finished without the FFFFFFFF marker and lastRef exists, set end
  if (lastRef && lastRef.end === undefined) {
       lastRef.end = buffer.byteLength; 
       console.warn("BIF index did not end with 0xFFFFFFFF marker, assuming last image extends to EOF.");
  }

  const images: BifImage[] = [];
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (ref.end === undefined || ref.end <= ref.start) {
        console.warn(`Skipping image ${i} due to invalid end offset: start=${ref.start}, end=${ref.end}`);
        continue;
    }
    images.push({
      seconds: (ref.timestamp * timestampMultiplier) / 1000,
      bytes: buffer.slice(ref.start, ref.end)
    });
  }

  if (images.length !== imageCount) {
      console.warn(`Expected ${imageCount} images based on header, but parsed ${images.length}`);
  }

  return images;
};
// --------------------------

interface AISummaryViewerProps {
  summaryPath: string;
  title?: string;
  onClose: () => void;
  show: boolean;
  bifPath?: string;
}

interface SummaryKeyPoint {
  content: string;
  timestamp: string;
  importance: 'high' | 'medium' | 'low';
}

interface TechnicalTerm {
  term: string;
  explanation: string;
}

interface AISummaryData {
  version: string;
  status: string;
  generated_at: string;
  video_info: {
    title: string;
    url?: string;
    owner?: string;
  };
  summary: {
    title: string;
    core_theme: string;
    content_focus: string;
    tags?: string[];
    difficulty_level?: string;
    suitable_for?: string;
  };
  key_points: SummaryKeyPoint[];
  technical_terms?: TechnicalTerm[];
  full_text: string;
  format_type: 'bullet_points' | 'paragraph';
  error?: string;
  raw_response?: string;
}

// --- 添加内容侧重/关注维度中文映射 ---
const contentFocusMap: { [key: string]: string } = {
  // 旧映射（保留向后兼容性）
  core_points: '核心观点',
  technical_details: '技术细节',
  practical_tips: '实用技巧',
  plot_summary: '情节梳理',
  entertainment_highlights: '娱乐看点',
  
  // 新关注维度映射
  factual_info: '事实信息',
  opinions: '观点立场',
  emotional_aspects: '情感体验',
  visual_elements: '视觉表现',
  technical_aspects: '技术细节',
  cultural_context: '文化背景'
};

// --- 辅助函数：翻译内容侧重 --- 
const translateContentFocus = (focusString: string): string => {
  if (!focusString) return '未指定';
  const focusKeys = focusString.split(',').map(key => key.trim());
  const translatedFocus = focusKeys.map(key => contentFocusMap[key] || key); // 如果找不到映射，显示原始 key
  return translatedFocus.join(', ');
};
// --------------------------

// --- 时间戳转换 MM:SS -> ms ---
const parseTimestamp = (timestampStr: string): number => {
  if (!timestampStr || !timestampStr.includes(':')) return 0;
  const parts = timestampStr.split(':');
  const minutes = parseInt(parts[0], 10);
  const seconds = parseInt(parts[1], 10);
  if (isNaN(minutes) || isNaN(seconds)) return 0;
  return (minutes * 60 + seconds) * 1000; // 返回毫秒
};

// --- 添加难度级别映射和颜色 ---
const difficultyLevelColors: { [key: string]: string } = {
  '入门': 'success',
  '进阶': 'warning',
  '专家': 'danger'
};

const AISummaryViewer: React.FC<AISummaryViewerProps> = ({
  summaryPath,
  title,
  onClose,
  show,
  bifPath
}) => {
  const [summaryData, setSummaryData] = useState<AISummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState<string>('');
  const [showRawJson, setShowRawJson] = useState(false);

  // --- BIF 相关状态 (更新) ---
  // const [bifData, setBifData] = useState<{ timestamp: number, url: string }[] | null>(null); // 不再需要单独存储
  const [isBifLoading, setIsBifLoading] = useState(false);
  // 新状态：存储每个关键点的预览数据和当前帧索引
  const [keyPointPreviews, setKeyPointPreviews] = useState<Record<number, { images: string[], currentIndex: number }>>({});
  const objectUrlsRef = useRef<string[]>([]);
  // Ref 存储每个关键点的 interval ID
  const intervalIdsRef = useRef<Record<number, number | null>>({});
  // -------------------------

  // --- 调试日志：观察状态变化 ---
  // console.log("Current Hovered Index:", hoveredKeyPointIndex);
  // console.log("Current Preview Index:", currentPreviewIndex);
  // console.log("Preview Images:", previewImages);
  // console.log("BIF Data Loaded:", !!bifData);
  // ---------------------------

  useEffect(() => {
    if (show) {
      fetchSummary();
    }
  }, [show, summaryPath]);

  // --- useEffect for fetching/parsing BIF and setting up previews ---
  useEffect(() => {
    // 清理函数：在 effect 开始或依赖项变化时清除旧 intervals 和 URLs
    const cleanup = () => {
      console.log("[BIF Effect Cleanup] Revoking old Object URLs and clearing intervals.");
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
      Object.values(intervalIdsRef.current).forEach(id => {
        if (id) clearInterval(id);
      });
      intervalIdsRef.current = {};
      setKeyPointPreviews({}); // 清空预览数据
      // setBifData(null); // 不再需要
      setIsBifLoading(false);
    };

    if (show && bifPath && summaryData) { // 确保 summaryData 也已加载
      cleanup(); // 先清理旧状态
      setIsBifLoading(true);
      console.log("[AISummaryViewer] Fetching BIF:", bifPath);

      fetch(`/api/download/bif/${encodeURIComponent(bifPath)}`)
        .then(response => {
          if (!response.ok) throw new Error(`Failed to download BIF (${response.status})`);
          return response.arrayBuffer();
        })
        .then(buffer => {
          console.log("[AISummaryViewer] BIF file downloaded, parsing...");
          const parsedImages = parseBif(buffer);
          if (parsedImages === false) throw new Error("Failed to parse BIF file");
          console.log(`[AISummaryViewer] Parsed ${parsedImages.length} BIF images.`);

          // 创建 Object URLs 并存储数据
          const newObjectUrls: string[] = [];
          const loadedBifData = parsedImages.map(img => {
            const blob = new Blob([img.bytes], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            newObjectUrls.push(url);
            return { timestamp: img.seconds, url: url }; // 使用解析出的毫秒时间戳
          });
          objectUrlsRef.current = newObjectUrls; // 更新 Ref
          // setBifData(loadedBifData); // 不再需要设置状态

          // 为每个关键点计算预览帧并启动 Interval
          const previews: Record<number, { images: string[], currentIndex: number }> = {};
          const newIntervalIds: Record<number, number | null> = {};

          summaryData.key_points.forEach((point, index) => {
            const targetTimestampMs = parseTimestamp(point.timestamp);
            const startTimeMs = Math.max(0, targetTimestampMs - 10000);
            const endTimeMs = targetTimestampMs + 10000;

            const imagesToShow = loadedBifData
              .filter(img => img.timestamp >= startTimeMs && img.timestamp <= endTimeMs)
              .map(img => img.url);

            if (imagesToShow.length > 0) {
              previews[index] = { images: imagesToShow, currentIndex: 0 };

              // 如果有多于一张图片，则启动动画
              if (imagesToShow.length > 1) {
                 const intervalId = setInterval(() => {
                    setKeyPointPreviews(currentPreviews => {
                       // 使用函数式更新确保基于最新状态
                       const currentPointPreview = currentPreviews[index];
                       // 防御性检查，以防状态更新竞争导致数据不一致
                       if (!currentPointPreview || currentPointPreview.images.length <= 1) {
                           return currentPreviews; // 没有变化或只有一帧
                       }
                       const nextIndex = (currentPointPreview.currentIndex + 1) % currentPointPreview.images.length;
                       return {
                           ...currentPreviews,
                           [index]: { ...currentPointPreview, currentIndex: nextIndex }
                       };
                    });
                 }, 300); // 播放速度
                 newIntervalIds[index] = intervalId;
              } else {
                 newIntervalIds[index] = null; // 只有一帧，不需要 interval
              }
            } else {
               newIntervalIds[index] = null; // 没有帧
            }
          });

          setKeyPointPreviews(previews); // 更新所有关键点的预览状态
          intervalIdsRef.current = newIntervalIds; // 存储所有 interval IDs

        })
        .catch(err => {
          console.error("[AISummaryViewer] Error loading/parsing BIF:", err);
          cleanup(); // 出错时也清理
          // setBifData(null); // 不再需要
        })
        .finally(() => {
          setIsBifLoading(false);
        });
    } else {
      cleanup(); // 如果 show 为 false, bifPath 丢失, 或 summaryData 未加载，则清理
      // setBifData(null); // 不再需要
      // setIsBifLoading(false); // cleanup 中已包含
    }

    // 返回最终的清理函数
    return cleanup;
  }, [show, bifPath, summaryData]); // 添加 summaryData 作为依赖项

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // 获取AI总结JSON文件
      const response = await fetch(`/api/download/subtitle/${encodeURIComponent(summaryPath)}`);
      
      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`);
      }
      
      const data = await response.text();
      setRawJson(data); // 保存原始JSON文本
      
      try {
        // 尝试解析JSON
        const parsedData = JSON.parse(data);
        setSummaryData(parsedData);
      } catch (error) {
        console.error('解析AI总结JSON失败:', error);
        setError('无法解析AI总结内容，格式可能不正确');
      }
    } catch (err: any) {
      console.error('获取AI总结失败:', err);
      setError(err.message || '无法加载AI总结内容');
    } finally {
      setLoading(false);
    }
  };
  
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = `/api/download/subtitle/${encodeURIComponent(summaryPath)}`;
    a.download = summaryPath.split('/').pop() || 'ai_summary.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  
  const toggleRawJson = () => {
    setShowRawJson(!showRawJson);
  };

  // 根据重要性获取徽章颜色
  const getImportanceBadgeVariant = (importance: string): string => {
    switch (importance) {
      case 'high': return 'danger';
      case 'medium': return 'warning';
      default: return 'info';
    }
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
          <i className="bi bi-robot me-2"></i>
          {title || 'AI总结'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading ? (
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
            <p className="mt-2">加载AI总结中...</p>
          </div>
        ) : error ? (
          <div className="subtitle-error-container">
            <Alert variant="danger">
              <i className="bi bi-exclamation-triangle-fill me-2"></i>
              {error}
            </Alert>
            
            {rawJson && (
              <div className="mt-3">
                <Button 
                  variant="outline-secondary" 
                  size="sm"
                  onClick={toggleRawJson}
                >
                  <i className={`bi bi-${showRawJson ? 'eye-slash' : 'eye'} me-1`}></i>
                  {showRawJson ? "隐藏" : "查看"}原始内容
                </Button>
                
                {showRawJson && (
                  <pre className="raw-content-textarea font-monospace mt-2 p-3 bg-light">
                    {rawJson}
                  </pre>
                )}
              </div>
            )}
          </div>
        ) : !summaryData ? (
          <div className="text-center py-3">无AI总结内容</div>
        ) : (
          <div className="ai-summary-container p-3">
            {/* 摘要头部 */}
            <div className="ai-summary-header mb-4 pb-3 border-bottom">
              <h3 className="summary-title mb-2">{summaryData.summary.title}</h3>
              
              {summaryData.video_info.owner && (
                <div className="text-muted mb-3 small">
                  <i className="bi bi-person-circle me-1"></i>
                  UP主: {summaryData.video_info.owner}
                </div>
              )}
              
              <p className="my-3 fst-italic text-muted">{summaryData.summary.core_theme}</p>
              
              {/* 添加难度级别和适合人群 */}
              {(summaryData.summary.difficulty_level || summaryData.summary.suitable_for) && (
                <div className="difficulty-suitable-info d-flex flex-wrap align-items-center mb-3 gap-3">
                  {summaryData.summary.difficulty_level && (
                    <div className="difficulty-level">
                      <Badge 
                        bg={difficultyLevelColors[summaryData.summary.difficulty_level] || 'secondary'}
                        className="me-1"
                      >
                        <i className="bi bi-bar-chart-fill me-1"></i>
                        {summaryData.summary.difficulty_level}
                      </Badge>
                    </div>
                  )}
                  {summaryData.summary.suitable_for && (
                    <div className="suitable-for small">
                      <i className="bi bi-people-fill me-1 text-info"></i>
                      {summaryData.summary.suitable_for}
                    </div>
                  )}
                </div>
              )}
              
              <div className="summary-meta mb-2 d-flex justify-content-between align-items-center small">
                {summaryData.summary.tags && summaryData.summary.tags.length > 0 ? (
                  <span className="text-primary">
                    <i className="bi bi-tags-fill me-1 text-primary"></i>
                    标签: {summaryData.summary.tags.map((tag, index) => (
                      <Badge 
                        key={index} 
                        bg="info" 
                        className="me-1"
                        style={{ fontSize: '85%' }}
                      >
                        {tag}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <span className="text-primary">
                    <i className="bi bi-bookmark-fill me-1 text-primary"></i>
                    内容侧重: {translateContentFocus(summaryData.summary.content_focus)}
                  </span>
                )}
                <span className="text-secondary">
                  <i className="bi bi-calendar3 me-1 text-secondary"></i>
                  生成于: {new Date(summaryData.generated_at).toLocaleString()}
                </span>
              </div>
            </div>
            
            {/* 使用 Row 和 Col 实现两列布局 */} 
            <Row>
              <Col md={7}>
                {/* 关键点 */} 
                <h5 className="mb-3">
                  <i className="bi bi-star-fill me-2 text-warning"></i>
                  关键点 {isBifLoading && <Spinner animation="grow" size="sm" variant="secondary" className="ms-2"/>}
                </h5>
                <Card className="mb-4 keypoints-card"> 
                  <ListGroup variant="flush">
                    {summaryData.key_points.map((point, index) => {
                      // 从 state 获取当前关键点的预览数据
                      const previewData = keyPointPreviews[index];
                      const imagesAvailable = previewData && previewData.images.length > 0;
                      const currentImageUrl = imagesAvailable ? previewData.images[previewData.currentIndex] : null;

                      return (
                        <ListGroup.Item
                          key={index}
                          className="py-3 d-flex justify-content-between align-items-start keypoint-item"
                        >
                          <div className="flex-grow-1 me-3">
                            <Badge 
                              bg={getImportanceBadgeVariant(point.importance)}
                              className="me-2 align-self-start mt-1"
                            >
                              {point.timestamp}
                            </Badge>
                            <span>{point.content}</span>
                          </div>

                          {/* 常驻预览区域 */}
                          {imagesAvailable && currentImageUrl && ( // 确认数据和 URL 都存在
                            <div className="bif-preview-container bg-light border rounded">
                              <img
                                src={currentImageUrl}
                                alt={`预览 ${point.timestamp}`}
                                className="bif-preview-image"
                              />
                            </div>
                          )}
                           {/* 无预览图像时的占位符 */}
                           {!isBifLoading && !imagesAvailable && (
                             <div className="bif-preview-container text-muted small d-flex align-items-center justify-content-center bg-light border rounded">
                               (无帧)
                             </div>
                           )}
                           {/* BIF 加载中的占位符 */}
                           {isBifLoading && (
                             <div className="bif-preview-container text-muted small d-flex align-items-center justify-content-center bg-light border rounded">
                               <Spinner animation="border" size="sm" variant="secondary"/>
                             </div>
                           )}
                        </ListGroup.Item>
                      );
                    })}
                  </ListGroup>
                </Card>
                
                {/* 技术术语 (放在关键点下方) */}
                {summaryData.technical_terms && summaryData.technical_terms.length > 0 && (
                  <>
                    <h5 className="mb-3">
                      <i className="bi bi-book-fill me-2 text-info"></i>
                      术语解释
                    </h5>
                    <Card className="mb-4 terms-card">
                      <ListGroup variant="flush">
                        {summaryData.technical_terms.map((term, index) => (
                          <ListGroup.Item key={index} className="py-3">
                            <strong className="me-2">{term.term}:</strong>
                            {term.explanation}
                          </ListGroup.Item>
                        ))}
                      </ListGroup>
                    </Card>
                  </>
                )}
              </Col>
              
              <Col md={5}>
                {/* 完整总结 */} 
                <h5 className="mb-3">
                  <i className="bi bi-file-text-fill me-2 text-primary"></i>
                  完整总结
                </h5>
                <Card className="mb-3 full-summary-card">
                  <Card.Body className="py-2"> {/* 减少上下内边距 */}
                    <div className="full-summary-text markdown-content">
                      <ReactMarkdown>
                        {summaryData.full_text}
                      </ReactMarkdown>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
            
            {/* 原始JSON查看选项 */}
            <div className="mt-4 text-end">
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={toggleRawJson}
              >
                <i className={`bi bi-${showRawJson ? 'eye-slash' : 'code'} me-1`}></i>
                {showRawJson ? "隐藏" : "查看"}JSON
              </Button>
            </div>
            
            {showRawJson && (
              <pre className="raw-content-textarea font-monospace mt-2 p-3 bg-light">
                {JSON.stringify(summaryData, null, 2)}
              </pre>
            )}
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
          下载AI总结
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AISummaryViewer; 