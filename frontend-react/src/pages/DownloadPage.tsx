import React, { useState, useEffect } from 'react';
import { Container, Card, Form, Button, Spinner, FormCheck, InputGroup, Row, Col, Alert } from 'react-bootstrap';
import api from '../services/api'; // Assuming api.ts is set up
import { toast } from 'react-toastify'; // Import toast
import '../styles/bilibili-theme.css';

const DownloadPage: React.FC = () => {
  const [bvIdInput, setBvIdInput] = useState('');
  const [options, setOptions] = useState({
    video: true,
    audio: true,
    subtitle: true,
    ai_summary: true
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  // 配置状态
  const [config, setConfig] = useState<{
    cookie?: string,
    ai_provider?: string,
    openai_api_key?: string,
    openai_base_url?: string,
    openai_model?: string,
    claude_api_key?: string,
    claude_base_url?: string,
    claude_model?: string
  }>({});
  
  // 加载配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const configData = await api.getConfig();
        setConfig(configData);
      } catch (err: any) {
        console.error('加载配置失败:', err);
      }
    };
    
    loadConfig();
  }, []);

  const handleOptionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { id, checked } = event.target;
    // Extract the type (video, audio, subtitle, ai_summary) from the checkbox id
    const optionType = id.replace('option-', '');
    
    // 更新选项状态
    setOptions(prevOptions => ({
      ...prevOptions,
      [optionType]: checked,
    }));
    
    // 如果取消字幕选项，同时取消AI总结选项
    if (optionType === 'subtitle' && !checked) {
      setOptions(prevOptions => ({
        ...prevOptions,
        subtitle: false,
        ai_summary: false
      }));
    }
  };

  // 验证Cookie是否有效
  const validateCookie = async (cookie: string) => {
    try {
      const result = await api.testCookie(cookie);
      // 只有在返回具体用户名时才视为有效
      return result && result.username && result.username !== '未知';
    } catch (err) {
      return false;
    }
  };

  // 验证AI配置是否完整
  const validateAIConfig = () => {
    // 获取当前选择的AI提供商
    const aiProvider = config.ai_provider || 'openai';
    
    if (aiProvider === 'openai') {
      // 验证OpenAI配置
    return !!(
      config.openai_api_key && 
      config.openai_base_url && 
      config.openai_model
    );
    } else if (aiProvider === 'claude') {
      // 验证Claude配置
      return !!(
        config.claude_api_key && 
        config.claude_base_url && 
        config.claude_model
      );
    }
    
    return false;
  };

  // 验证所需配置
  const validateConfig = async () => {
    setIsValidating(true);
    let valid = true;
    
    // 1. 检查是否需要验证Cookie (如果勾选了视频、音频或字幕)
    if (options.video || options.audio || options.subtitle) {
      if (!config.cookie) {
        toast.error('您需要在设置页面配置Cookie才能下载视频、音频或字幕');
        valid = false;
      } else {
        // 验证Cookie有效性
        const cookieValid = await validateCookie(config.cookie);
        if (!cookieValid) {
          toast.error('当前配置的Cookie无效或已过期，请更新Cookie');
          valid = false;
        }
      }
    }
    
    // 2. 检查是否需要验证AI配置 (如果勾选了AI总结)
    if (options.ai_summary) {
      if (!validateAIConfig()) {
        // 获取当前选择的AI提供商名称，用于错误消息
        const aiProviderName = config.ai_provider === 'claude' ? 'Claude' : 'OpenAI';
        toast.error(`您需要在设置页面完成${aiProviderName}配置才能使用AI总结功能`);
        valid = false;
      }
    }
    
    setIsValidating(false);
    return valid;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);

    let bvId = bvIdInput.trim();
    // Basic BV ID extraction from URL
    if (bvId.includes('bilibili.com/video/')) {
        const match = bvId.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
        if (match && match[1]) {
            bvId = match[1];
        }
    } else if (!bvId.startsWith('BV') && bvId.length > 0) {
        // Allow users to input just the alphanumeric part after BV
        bvId = 'BV' + bvId; 
    } else if (bvId.startsWith('BV') && bvId.length > 2) {
        // Already has BV, use as is
    } else {
         // Invalid format
         bvId = ''; 
    }
    

    if (!bvId) {
      toast.error('请输入有效的视频链接或BV号');
      setIsLoading(false);
      return;
    }

    if (!options.video && !options.audio && !options.subtitle) {
      toast.error('请至少选择一个下载选项');
      setIsLoading(false);
      return;
    }

    // 如果勾选了AI总结但没勾选字幕，则报错
    if (options.ai_summary && !options.subtitle) {
      toast.error('AI总结功能需要同时下载字幕');
      setIsLoading(false);
      return;
    }

    // 验证配置
    const configValid = await validateConfig();
    if (!configValid) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await api.createDownload(bvId, options);
      if (response.success) {
        toast.success(`任务 ${response.task_id || ''} 已创建`);
        setBvIdInput(''); // Clear input on success
        // Optionally show info toast to navigate
        setTimeout(() => toast.info('您可以前往"视频列表"页面查看下载进度'), 1500);
      } else {
        toast.error(response.message || '创建下载任务失败');
      }
    } catch (err: any) {
      toast.error(err.message || '创建任务时出错');
    } finally {
      setIsLoading(false);
    }
  };

  // 是否显示特定的下载选项
  const renderOptions = () => {
    return (
      <div className="bili-option-container bg-light rounded p-3">
        <Row>
          <Col xs={12} sm={6} md={3}>
            <FormCheck 
              className="bili-option-check"
              type="checkbox" 
              id="option-video" 
              label={
                <span className="d-flex align-items-center">
                  <i className="bi bi-film me-2 option-icon"></i>
                  视频
                </span>
              }
              checked={options.video}
              onChange={handleOptionChange}
              disabled={isLoading || isValidating}
            />
          </Col>
          <Col xs={12} sm={6} md={3}>
            <FormCheck 
              className="bili-option-check"
              type="checkbox" 
              id="option-audio" 
              label={
                <span className="d-flex align-items-center">
                  <i className="bi bi-music-note-beamed me-2 option-icon"></i>
                  音频
                </span>
              }
              checked={options.audio}
              onChange={handleOptionChange}
              disabled={isLoading || isValidating}
            />
          </Col>
          <Col xs={12} sm={6} md={3}>
            <FormCheck 
              className="bili-option-check"
              type="checkbox" 
              id="option-subtitle" 
              label={
                <span className="d-flex align-items-center">
                  <i className="bi bi-file-text me-2 option-icon"></i>
                  字幕
                </span>
              }
              checked={options.subtitle}
              onChange={handleOptionChange}
              disabled={isLoading || isValidating}
            />
          </Col>
          <Col xs={12} sm={6} md={3}>
            <FormCheck 
              className="bili-option-check"
              type="checkbox" 
              id="option-ai_summary" 
              label={
                <span className="d-flex align-items-center">
                  <i className="bi bi-robot me-2 option-icon"></i>
                  AI总结
                </span>
              }
              checked={options.ai_summary}
              onChange={handleOptionChange}
              disabled={isLoading || isValidating || !options.subtitle}
            />
            {!options.subtitle && options.ai_summary && (
              <small className="text-danger d-block mt-1">
                <i className="bi bi-exclamation-triangle-fill me-1"></i>
                需要同时勾选字幕选项
              </small>
            )}
          </Col>
        </Row>
        
        {options.ai_summary && (
          <Alert variant="info" className="mt-3 mb-0">
            <i className="bi bi-info-circle-fill me-2"></i>
            AI总结将在字幕下载完成后自动生成，可在设置中配置OpenAI参数和总结偏好。
          </Alert>
        )}
      </div>
    );
  };

  return (
    <Container className="py-4">
      <Row className="justify-content-center">
        <Col xs={12} md={10} lg={8}>
          <Card className="bilibili-card shadow-sm">
            <Card.Header className="bili-card-header d-flex align-items-center">
              <i className="bi bi-cloud-arrow-down-fill me-2 bili-header-icon"></i>
              <Card.Title as="h5" className="mb-0">下载视频</Card.Title>
            </Card.Header>
            <Card.Body className="p-4">
              <Form id="download-form" onSubmit={handleSubmit}>
                <Form.Group className="mb-4" controlId="bv-id">
                  <Form.Label className="bili-form-label">
                    <i className="bi bi-link-45deg me-1"></i>
                    视频链接或BV号
                  </Form.Label>
                  <InputGroup>
                    <InputGroup.Text className="bili-input-icon">
                      <i className="bi bi-search"></i>
                    </InputGroup.Text>
                    <Form.Control 
                      type="text" 
                      placeholder="例如: https://www.bilibili.com/video/BV1xx4y1D7xx 或 BV1xx4y1D7xx" 
                      value={bvIdInput}
                      onChange={(e) => setBvIdInput(e.target.value)}
                      required 
                      disabled={isLoading || isValidating}
                      className="bili-form-input"
                    />
                    {bvIdInput && (
                      <Button 
                        variant="outline-secondary" 
                        onClick={() => setBvIdInput('')}
                        disabled={isLoading || isValidating}
                      >
                        <i className="bi bi-x"></i>
                      </Button>
                    )}
                  </InputGroup>
                  <Form.Text className="text-muted">
                    <i className="bi bi-info-circle me-1"></i>
                    可以直接粘贴B站视频链接或输入BV号
                  </Form.Text>
                </Form.Group>

                <Form.Group className="mb-4">
                  <Form.Label className="bili-form-label">
                    <i className="bi bi-sliders me-1"></i>
                    下载选项
                  </Form.Label>
                  {renderOptions()}
                </Form.Group>

                {/* 配置验证提示 */}
                {(options.video || options.audio || options.subtitle) && !config.cookie && (
                  <Alert variant="warning" className="mb-3">
                    <i className="bi bi-exclamation-triangle-fill me-2"></i>
                    您需要在<a href="/settings" className="alert-link">设置页面</a>配置Cookie才能下载视频、音频或字幕
                  </Alert>
                )}

                {options.ai_summary && !validateAIConfig() && (
                  <Alert variant="warning" className="mb-3">
                    <i className="bi bi-exclamation-triangle-fill me-2"></i>
                    您需要在<a href="/settings" className="alert-link">设置页面</a>完成AI配置才能使用AI总结功能
                  </Alert>
                )}

                <div className="d-grid gap-2 mt-4">
                  <Button variant="primary" type="submit" disabled={isLoading || isValidating} className="bili-submit-button">
                    {isLoading || isValidating ? (
                      <><Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" /> {isValidating ? '验证中...' : '处理中...'}</>
                    ) : (
                      <><i className="bi bi-cloud-arrow-down-fill me-2"></i>开始下载</>
                    )}
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default DownloadPage; 