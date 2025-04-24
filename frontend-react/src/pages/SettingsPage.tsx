import React, { useState, useEffect, useCallback } from 'react';
import { Container, Row, Col, Card, Form, Button, ButtonGroup, Spinner, Modal, InputGroup } from 'react-bootstrap';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext'; 
import { toast } from 'react-toastify';
import '../styles/bilibili-theme.css';

// 更新常用的模型列表，将其分为 OpenAI 和 Claude 两组
const commonOpenAIModels = [
  { value: 'gpt-4o', label: 'gpt-4o (最新推荐)' },
  { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
  { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo' },
];

const commonClaudeModels = [
  { value: 'claude-3-5-sonnet-20240620', label: 'claude-3.5-sonnet (最新推荐)' },
  { value: 'claude-3-opus-20240229', label: 'claude-3-opus' },
  { value: 'claude-3-sonnet-20240229', label: 'claude-3-sonnet' },
  { value: 'claude-3-haiku-20240307', label: 'claude-3-haiku' },
];

// 定义术语解释级别的类型
type TermExplanationLevel = 'all' | 'medium' | 'minimal' | 'none' | boolean;

const SettingsPage: React.FC = () => {
  const [cookie, setCookie] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // AI 提供商
  const [aiProvider, setAiProvider] = useState('openai'); // 默认使用 OpenAI

  // OpenAI 配置
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o'); // 默认模型
  const [customOpenAIModelName, setCustomOpenAIModelName] = useState(''); // 自定义 OpenAI 模型

  // Claude 配置
  const [claudeBaseUrl, setClaudeBaseUrl] = useState('');
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [claudeModel, setClaudeModel] = useState('claude-3-5-sonnet-20240620'); // 默认模型
  const [customClaudeModelName, setCustomClaudeModelName] = useState(''); // 自定义 Claude 模型

  const [isLoadingAIConfig, setIsLoadingAIConfig] = useState(true);
  const [isSavingAIConfig, setIsSavingAIConfig] = useState(false);

  // AI总结偏好设置
  const [aiSummaryPrefs, setAiSummaryPrefs] = useState({
    summaryLength: 'medium' as string,
    contentFocus: ['core_points'] as string[],
    termExplanation: 'all' as TermExplanationLevel,
    toneStyle: 'casual' as string,
    purpose: 'learning' as string,
  });

  const [isLoadingCookie, setIsLoadingCookie] = useState(true);
  const [isSavingCookie, setIsSavingCookie] = useState(false);
  const [isTestingCookie, setIsTestingCookie] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [showHelpModal, setShowHelpModal] = useState(false);
  const { checkLogin } = useAuth();

  const loadConfig = useCallback(async () => {
    setIsLoadingCookie(true);
    setIsLoadingAIConfig(true);
    try {
      const response = await api.getConfig();
      setCookie(response.cookie || '');
      
      // 加载 AI 提供商设置
      setAiProvider(response.ai_provider || 'openai');
      
      // 加载 OpenAI 配置
      setOpenaiBaseUrl(response.openai_base_url || 'https://api.openai.com/v1');
      setOpenaiApiKey(response.openai_api_key || '');
      
      // 加载 OpenAI 模型
      const configuredOpenAIModel = response.openai_model || 'gpt-4o';
      setOpenaiModel(configuredOpenAIModel);
      // 如果加载的模型不在常用列表中，则显示自定义输入框
      if (!commonOpenAIModels.some(m => m.value === configuredOpenAIModel)) {
        setOpenaiModel('custom');
        setCustomOpenAIModelName(configuredOpenAIModel);
      }
      
      // 加载 Claude 配置
      setClaudeBaseUrl(response.claude_base_url || 'https://api.anthropic.com');
      setClaudeApiKey(response.claude_api_key || '');
      
      // 加载 Claude 模型
      const configuredClaudeModel = response.claude_model || 'claude-3-5-sonnet-20240620';
      setClaudeModel(configuredClaudeModel);
      // 如果加载的模型不在常用列表中，则显示自定义输入框
      if (!commonClaudeModels.some(m => m.value === configuredClaudeModel)) {
        setClaudeModel('custom');
        setCustomClaudeModelName(configuredClaudeModel);
      }
      
      // 加载AI总结偏好设置
      if (response.ai_summary_prefs) {
        // 处理术语解释设置 - 确保兼容新旧格式
        let termExplanationValue: TermExplanationLevel = 'all'; // 默认值
        
        if (response.ai_summary_prefs.term_explanation !== undefined) {
          const termExplanation = response.ai_summary_prefs.term_explanation;
          
          if (typeof termExplanation === 'boolean') {
            // 将布尔值转换为字符串值
            termExplanationValue = termExplanation ? 'all' : 'none';
          } else if (typeof termExplanation === 'string') {
            // 确保字符串值有效
            if (['all', 'medium', 'minimal', 'none'].includes(termExplanation)) {
              termExplanationValue = termExplanation as TermExplanationLevel;
            } else {
              console.warn(`未知的术语解释值: ${termExplanation}，使用默认值'all'`);
            }
          }
        }
        
        setAiSummaryPrefs({
          summaryLength: response.ai_summary_prefs.summary_length || 'medium',
          contentFocus: Array.isArray(response.ai_summary_prefs.content_focus) && response.ai_summary_prefs.content_focus.length > 0 
                          ? response.ai_summary_prefs.content_focus 
                          : ['core_points'],
          termExplanation: termExplanationValue,
          toneStyle: response.ai_summary_prefs.tone_style || 'casual',
          purpose: response.ai_summary_prefs.purpose || 'learning',
        });
      }
    } catch (err: any) {
      toast.error(err.message || '加载配置失败');
    } finally {
      setIsLoadingCookie(false);
      setIsLoadingAIConfig(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSaveCookie = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingCookie(true);
    try {
      const response = await api.setCookie(cookie);
      if (response.success) {
        toast.success('Cookie 保存成功！');
        checkLogin();
      } else {
        toast.error(response.message || '保存Cookie失败');
      }
    } catch (err: any) {
      toast.error(err.message || '保存Cookie时出错');
    } finally {
      setIsSavingCookie(false);
    }
  };
  
  const handleTestCookie = async () => {
      if (!cookie) {
          toast.warning('请先输入Cookie后再测试');
          return;
      }
      setIsTestingCookie(true);
      
      try {
          const result = await api.testCookie(cookie);
          
          // 验证返回结果：必须成功且用户名存在且不为"未知"
          if (result.success && result.username && result.username !== '未知') {
              toast.success(`Cookie 有效！用户名: ${result.username}`);
          } else {
              // 明确显示为失败状态
              toast.error(`Cookie 无效: ${result.message || '用户名未知或未返回'}`);
          }
      } catch (error: any) {
          toast.error(`测试失败: ${error.message || '网络错误'}`);
      } finally {
          setIsTestingCookie(false);
      }
  };

  const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }
    if (newPassword.length < 4) { 
      toast.warn('密码太短，至少需要4个字符');
      return;
    }

    setIsChangingPassword(true);
     toast.promise(
        api.changePassword(newPassword),
        {
          pending: '正在修改密码...',
          success: {
              render(){
                  setNewPassword('');
                  setConfirmPassword('');
                  return '密码修改成功！';
              },
              autoClose: 3000,
          },
          error: {
              render({data}){
                  return `修改失败: ${(data as Error)?.message || '未知错误'}`;
              },
              autoClose: 4000,
          }
        }
    ).finally(() => setIsChangingPassword(false));
  };

  const handleSaveAIConfig = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingAIConfig(true);
    
    // 根据当前 AI 提供商确定要使用的模型
    let modelToSave = '';
    if (aiProvider === 'openai') {
      modelToSave = openaiModel === 'custom' ? customOpenAIModelName.trim() : openaiModel;
      if (openaiModel === 'custom' && !modelToSave) {
        toast.error('请输入自定义 OpenAI 模型名称');
        setIsSavingAIConfig(false);
        return;
      }
    } else if (aiProvider === 'claude') {
      modelToSave = claudeModel === 'custom' ? customClaudeModelName.trim() : claudeModel;
      if (claudeModel === 'custom' && !modelToSave) {
        toast.error('请输入自定义 Claude 模型名称');
        setIsSavingAIConfig(false);
        return;
      }
    }
    
    try {
      // 确保术语解释设置始终以字符串形式保存
      const termExplanationValue = 
        typeof aiSummaryPrefs.termExplanation === 'boolean' 
          ? (aiSummaryPrefs.termExplanation ? 'all' : 'none') 
          : aiSummaryPrefs.termExplanation;
      
      // 构建请求数据
      const requestData: any = {
        ai_provider: aiProvider,
        ai_summary_prefs: {
          summary_length: aiSummaryPrefs.summaryLength,
          content_focus: aiSummaryPrefs.contentFocus,
          term_explanation: termExplanationValue,
          tone_style: aiSummaryPrefs.toneStyle,
          purpose: aiSummaryPrefs.purpose,
        }
      };
      
      // 根据提供商添加相应的配置
      if (aiProvider === 'openai') {
        requestData.openai_base_url = openaiBaseUrl;
        requestData.openai_api_key = openaiApiKey;
        requestData.openai_model = modelToSave;
      } else if (aiProvider === 'claude') {
        requestData.claude_base_url = claudeBaseUrl;
        requestData.claude_api_key = claudeApiKey;
        requestData.claude_model = modelToSave;
        // 保留 OpenAI 配置，以备切换回来使用
        requestData.openai_base_url = openaiBaseUrl;
        requestData.openai_api_key = openaiApiKey;
      }
      
      // 发送配置到新的 AI 配置端点
      const response = await api.setAIConfig(requestData);
      
      if (response.success) {
        toast.success(`${aiProvider === 'openai' ? 'OpenAI' : 'Claude'} 配置保存成功！`);
      } else {
        toast.error(response.message || `保存 ${aiProvider === 'openai' ? 'OpenAI' : 'Claude'} 配置失败`);
      }
    } catch (err: any) {
      toast.error(err.message || `保存 AI 配置时出错`);
    } finally {
      setIsSavingAIConfig(false);
    }
  };

  // 处理AI总结偏好设置的变更 (需要区分普通字段和多选字段)
  const handleAiPrefChange = (field: string, value: string | boolean | string[]) => {
    setAiSummaryPrefs(prev => ({
      ...prev,
      [field]: value as any // 使用类型断言处理多种可能的类型
    }));
  };

  // 处理内容侧重多选框的变更
  const handleContentFocusChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = event.target;
    setAiSummaryPrefs(prev => {
      const currentFocus = prev.contentFocus;
      let newFocus;
      if (checked) {
        // 添加选项
        newFocus = [...currentFocus, value];
      } else {
        // 移除选项，确保至少保留一个（或者允许为空？暂定允许为空）
        newFocus = currentFocus.filter(item => item !== value);
        // if (newFocus.length === 0) { // 如果需要至少保留一项，取消注释
        //   return prev; // 或者toast提示
        // }
      }
      return { ...prev, contentFocus: newFocus };
    });
  };

  // 处理 OpenAI 模型选择变更
  const handleOpenAIModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = event.target.value;
    setOpenaiModel(selectedValue);
    if (selectedValue !== 'custom') {
      setCustomOpenAIModelName(''); // 清空自定义输入
    }
  };

  // 处理 Claude 模型选择变更
  const handleClaudeModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = event.target.value;
    setClaudeModel(selectedValue);
    if (selectedValue !== 'custom') {
      setCustomClaudeModelName(''); // 清空自定义输入
    }
  };

  // 处理 AI 提供商变更
  const handleAIProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setAiProvider(event.target.value);
  };

  return (
    <Container className="py-4">
      <Row className="justify-content-center">
        <Col xs={12} lg={10}>
          <Card className="bilibili-card shadow-sm mb-4">
            <Card.Header className="bili-card-header d-flex align-items-center">
              <i className="bi bi-gear-fill me-2 bili-header-icon"></i>
              <Card.Title as="h5" className="mb-0">Cookie设置</Card.Title>
            </Card.Header>
            <Card.Body className="p-4">
              <Row className="align-items-center mb-3">
                <Col>
                  <p className="card-text mb-0">
                    B站Cookie用于访问需要登录的内容，如高清视频和字幕。
                  </p>
                </Col>
                <Col xs="auto">
                  <Button variant="outline-primary" size="sm" onClick={() => setShowHelpModal(true)}>
                    <i className="bi bi-question-circle me-1"></i>如何获取?
                  </Button>
                </Col>
              </Row>
              
              {isLoadingCookie && (
                <div className="text-center py-4">
                  <Spinner animation="border" className="mb-2" />
                  <p className="text-muted mb-0">加载Cookie中...</p>
                </div>
              )}
              
              {!isLoadingCookie && (
                <Form id="cookie-form" onSubmit={handleSaveCookie}>
                  <Form.Group className="mb-3" controlId="cookie">
                    <Form.Label className="bili-form-label">
                      <i className="bi bi-key-fill me-1"></i>Cookie
                    </Form.Label>
                    <Form.Control 
                      as="textarea" 
                      rows={5} 
                      placeholder="在此粘贴您的B站Cookie" 
                      value={cookie}
                      onChange={(e) => setCookie(e.target.value)}
                      disabled={isSavingCookie || isTestingCookie}
                      className="bili-form-textarea"
                    />
                    <Form.Text className="text-muted">
                      <i className="bi bi-shield-lock me-1"></i>
                      Cookie 信息仅用于访问B站并存储在您的服务器上，不会上传到其他位置
                    </Form.Text>
                  </Form.Group>
                  
                  <div className="d-flex justify-content-end mt-4">
                    <ButtonGroup>
                      <Button 
                        variant="outline-primary" 
                        onClick={handleTestCookie} 
                        disabled={isSavingCookie || isTestingCookie || !cookie}
                        className="bili-button-test"
                      >
                        {isTestingCookie ? (
                          <><Spinner size="sm" as="span" animation="border" className="me-1"/> 测试中...</>
                        ) : (
                          <><i className="bi bi-check-circle me-1"></i>测试Cookie</>
                        )}
                      </Button>
                      <Button 
                        variant="primary" 
                        type="submit" 
                        disabled={isSavingCookie || isTestingCookie || !cookie}
                      >
                        {isSavingCookie ? (
                          <><Spinner size="sm" as="span" animation="border" className="me-1"/> 保存中...</>
                        ) : (
                          <><i className="bi bi-save me-1"></i>保存Cookie</>
                        )}
                      </Button>
                    </ButtonGroup>
                  </div>
                </Form>
              )}
            </Card.Body>
          </Card>

          {/* AI 配置卡片 */}
          <Card className="bilibili-card shadow-sm mb-4">
            <Card.Header className="bili-card-header d-flex align-items-center">
              <i className="bi bi-robot me-2 bili-header-icon"></i>
              <Card.Title as="h5" className="mb-0">AI 配置</Card.Title>
            </Card.Header>
            <Card.Body className="p-4">
              <p className="card-text mb-3">
                配置 AI API，用于生成视频的 AI 总结。您需要有自己的 API 密钥。
              </p>
              
              {isLoadingAIConfig && (
                <div className="text-center py-4">
                  <Spinner animation="border" className="mb-2" />
                  <p className="text-muted mb-0">加载 AI 配置中...</p>
                </div>
              )}
              
              {!isLoadingAIConfig && (
                <Form id="ai-config-form" onSubmit={handleSaveAIConfig}>
                  <Row>
                    <Col md={12}>
                      <Form.Group className="mb-3" controlId="ai-provider">
                        <Form.Label className="bili-form-label">
                          <i className="bi bi-lightning-fill me-1"></i>AI 提供商
                        </Form.Label>
                        <Form.Select 
                          value={aiProvider}
                          onChange={handleAIProviderChange}
                          disabled={isSavingAIConfig}
                        >
                          <option value="openai">OpenAI (GPT)</option>
                          <option value="claude">Anthropic (Claude)</option>
                        </Form.Select>
                        <Form.Text className="text-muted">
                          选择您想要使用的 AI 服务提供商
                        </Form.Text>
                      </Form.Group>
                    </Col>
                  </Row>

                  {/* OpenAI 配置 */}
                  {aiProvider === 'openai' && (
                    <Row>
                      <Col md={6}>
                        <Form.Group className="mb-3" controlId="openai-base-url">
                          <Form.Label className="bili-form-label">
                            <i className="bi bi-link-45deg me-1"></i>OpenAI API 基础 URL
                          </Form.Label>
                          <InputGroup>
                            <InputGroup.Text className="bili-input-icon">
                              <i className="bi bi-globe"></i>
                            </InputGroup.Text>
                            <Form.Control 
                              type="text" 
                              placeholder="https://api.openai.com/v1" 
                              value={openaiBaseUrl}
                              onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                              disabled={isSavingAIConfig}
                              className="bili-form-input"
                            />
                          </InputGroup>
                          <Form.Text className="text-muted">
                            默认为官方 API 地址，如需使用第三方服务可更改
                          </Form.Text>
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group className="mb-3" controlId="openai-api-key">
                          <Form.Label className="bili-form-label">
                            <i className="bi bi-key me-1"></i>OpenAI API 密钥
                          </Form.Label>
                          <InputGroup>
                            <InputGroup.Text className="bili-input-icon">
                              <i className="bi bi-shield-lock"></i>
                            </InputGroup.Text>
                            <Form.Control 
                              type="password" 
                              placeholder="sk-..." 
                              value={openaiApiKey}
                              onChange={(e) => setOpenaiApiKey(e.target.value)}
                              disabled={isSavingAIConfig}
                              className="bili-form-input"
                            />
                          </InputGroup>
                          <Form.Text className="text-muted">
                            请输入您的 OpenAI API 密钥，通常以"sk-"开头
                          </Form.Text>
                        </Form.Group>
                      </Col>
                      <Col md={12}>
                        <Form.Group className="mb-3" controlId="openai-model">
                          <Form.Label className="bili-form-label">
                            <i className="bi bi-cpu-fill me-1"></i>OpenAI 模型
                          </Form.Label>
                          <Form.Select 
                            value={openaiModel}
                            onChange={handleOpenAIModelChange}
                            disabled={isSavingAIConfig}
                          >
                            {commonOpenAIModels.map(model => (
                              <option key={model.value} value={model.value}>{model.label}</option>
                            ))}
                            <option value="custom">自定义模型名称...</option>
                          </Form.Select>
                          
                          {openaiModel === 'custom' && (
                            <Form.Control 
                              type="text" 
                              placeholder="输入自定义 OpenAI 模型名称 (例如 gpt-4)"
                              value={customOpenAIModelName}
                              onChange={(e) => setCustomOpenAIModelName(e.target.value)}
                              disabled={isSavingAIConfig}
                              className="mt-2 bili-form-input"
                            />
                          )}
                          <Form.Text className="text-muted">
                            选择用于生成 AI 总结的 OpenAI 模型，如不确定请使用默认推荐
                          </Form.Text>
                        </Form.Group>
                      </Col>
                    </Row>
                  )}

                  {/* Claude 配置 */}
                  {aiProvider === 'claude' && (
                    <Row>
                      <Col md={6}>
                        <Form.Group className="mb-3" controlId="claude-base-url">
                          <Form.Label className="bili-form-label">
                            <i className="bi bi-link-45deg me-1"></i>Claude API 基础 URL
                          </Form.Label>
                          <InputGroup>
                            <InputGroup.Text className="bili-input-icon">
                              <i className="bi bi-globe"></i>
                            </InputGroup.Text>
                            <Form.Control 
                              type="text" 
                              placeholder="https://api.anthropic.com" 
                              value={claudeBaseUrl}
                              onChange={(e) => setClaudeBaseUrl(e.target.value)}
                              disabled={isSavingAIConfig}
                              className="bili-form-input"
                            />
                          </InputGroup>
                          <Form.Text className="text-muted">
                            默认为官方 API 地址，如需使用第三方服务可更改
                          </Form.Text>
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group className="mb-3" controlId="claude-api-key">
                          <Form.Label className="bili-form-label">
                            <i className="bi bi-key me-1"></i>Claude API 密钥
                          </Form.Label>
                          <InputGroup>
                            <InputGroup.Text className="bili-input-icon">
                              <i className="bi bi-shield-lock"></i>
                            </InputGroup.Text>
                            <Form.Control 
                              type="password" 
                              placeholder="sk-..." 
                              value={claudeApiKey}
                              onChange={(e) => setClaudeApiKey(e.target.value)}
                              disabled={isSavingAIConfig}
                              className="bili-form-input"
                            />
                          </InputGroup>
                          <Form.Text className="text-muted">
                            请输入您的 Claude API 密钥，通常以"sk-"开头
                          </Form.Text>
                        </Form.Group>
                      </Col>
                      <Col md={12}>
                        <Form.Group className="mb-3" controlId="claude-model">
                          <Form.Label className="bili-form-label">
                            <i className="bi bi-cpu-fill me-1"></i>Claude 模型
                          </Form.Label>
                          <Form.Select 
                            value={claudeModel}
                            onChange={handleClaudeModelChange}
                            disabled={isSavingAIConfig}
                          >
                            {commonClaudeModels.map(model => (
                              <option key={model.value} value={model.value}>{model.label}</option>
                            ))}
                            <option value="custom">自定义模型名称...</option>
                          </Form.Select>
                          
                          {claudeModel === 'custom' && (
                            <Form.Control 
                              type="text" 
                              placeholder="输入自定义 Claude 模型名称"
                              value={customClaudeModelName}
                              onChange={(e) => setCustomClaudeModelName(e.target.value)}
                              disabled={isSavingAIConfig}
                              className="mt-2 bili-form-input"
                            />
                          )}
                          <Form.Text className="text-muted">
                            选择用于生成 AI 总结的 Claude 模型，如不确定请使用默认推荐
                          </Form.Text>
                        </Form.Group>
                      </Col>
                    </Row>
                  )}

                  {/* AI 总结偏好设置 - 保持不变 */}
                  <h6 className="mt-4 mb-3">
                    <i className="bi bi-sliders me-2"></i>
                    AI总结偏好设置
                  </h6>
                  <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3" controlId="summary-length">
                        <Form.Label className="bili-form-label">总结长度</Form.Label>
                        <Form.Select 
                          value={aiSummaryPrefs.summaryLength}
                          onChange={(e) => handleAiPrefChange('summaryLength', e.target.value)}
                          disabled={isSavingAIConfig}
                        >
                          <option value="短(总结80字，每个关键点不低于15字，且关键点需大于4个)">短 (约200字)</option>
                          <option value="中(总结150字，每个关键点不低于30字，且关键点需大于7个)">中 (约500字)</option>
                          <option value="长 (总结300字，每个关键点不低于50字，且关键点需大于10个)">长 (约800字)</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3" controlId="summary-purpose">
                        <Form.Label className="bili-form-label">总结目的</Form.Label>
                        <Form.Select 
                          value={aiSummaryPrefs.purpose}
                          onChange={(e) => handleAiPrefChange('purpose', e.target.value)}
                          disabled={isSavingAIConfig}
                        >
                          <option value="快速了解 - 获取视频核心内容">快速了解 - 获取视频核心内容</option>
                          <option value="深入学习 - 提取知识与要点">深入学习 - 提取知识与要点</option>
                          <option value="重点时刻 - 关注精彩与亮点">重点时刻 - 关注精彩与亮点</option>
                          <option value="批判分析 - 思考与评价">批判分析 - 思考与评价</option>
                          <option value="创意灵感 - 获取创作素材">创意灵感 - 获取创作素材</option>
                          <option value="实际应用 - 技巧与方法">实际应用 - 技巧与方法</option>
                        </Form.Select>
                        <Form.Text className="text-muted">
                          根据你希望从视频中获取的价值选择，适用于任何视频类型
                        </Form.Text>
                      </Form.Group>
                    </Col>
                    <Col md={6}>
                      <Form.Group className="mb-3" controlId="focus-points">
                        <Form.Label className="bili-form-label">关注维度 (可多选)</Form.Label>
                        <div>
                          {[ 
                            { value: '事实信息', label: '事实信息' },
                            { value: '观点立场', label: '观点立场' },
                            { value: '情感体验', label: '情感体验' },
                            { value: '视觉表现', label: '视觉表现' },
                            { value: '技术细节', label: '技术细节' },
                            { value: '文化背景', label: '文化背景' },
                          ].map(option => (
                            <Form.Check 
                              key={option.value}
                              type="checkbox"
                              id={`focus-${option.value}`}
                              label={option.label}
                              value={option.value}
                              checked={aiSummaryPrefs.contentFocus.includes(option.value)}
                              onChange={handleContentFocusChange}
                              disabled={isSavingAIConfig}
                              inline
                              className="me-3"
                            />
                          ))}
                        </div>
                        <Form.Text className="text-muted">
                          选择你希望总结重点关注的维度，不受视频类型限制
                        </Form.Text>
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group className="mb-3" controlId="term-explanation">
                        <Form.Label className="bili-form-label">术语解释</Form.Label>
                        <div>
                          <Form.Select
                            value={
                              typeof aiSummaryPrefs.termExplanation === 'boolean'
                                ? (aiSummaryPrefs.termExplanation ? "all" : "none")
                                : aiSummaryPrefs.termExplanation
                            }
                            onChange={(e) => {
                              const value = e.target.value as TermExplanationLevel;
                              handleAiPrefChange('termExplanation', value);
                            }}
                            disabled={isSavingAIConfig}
                          >
                            <option value="全部解释 (初学者)">全部解释 (初学者)</option>
                            <option value="中等难度术语 (普通用户)">中等难度术语 (普通用户)</option>
                            <option value="仅专业术语 (资深用户)">仅专业术语 (资深用户)</option>
                            <option value="仅解释晦涩术语 (专业人士)">仅解释晦涩术语 (专业人士)</option>
                          </Form.Select>
                          <Form.Text className="text-muted">
                            选择您的知识水平，系统将据此决定哪些术语需要解释
                          </Form.Text>
                        </div>
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group className="mb-3" controlId="tone-style">
                        <Form.Label className="bili-form-label">语调风格</Form.Label>
                        <Form.Select 
                          value={aiSummaryPrefs.toneStyle}
                          onChange={(e) => handleAiPrefChange('toneStyle', e.target.value)}
                          disabled={isSavingAIConfig}
                        >
                          <option value="学术严谨">学术严谨</option>
                          <option value="硬核专业">硬核专业</option>
                          <option value="日常通俗">日常通俗</option>
                          <option value="UP主风">UP主风</option>
                          <option value="弹幕风">弹幕风</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                  </Row>
                  
                  <div className="d-flex justify-content-end mt-4">
                    <Button 
                      variant="primary" 
                      type="submit" 
                      disabled={isSavingAIConfig || 
                        (aiProvider === 'openai' && (!openaiBaseUrl || !openaiApiKey || (openaiModel === 'custom' && !customOpenAIModelName.trim()))) ||
                        (aiProvider === 'claude' && (!claudeBaseUrl || !claudeApiKey || (claudeModel === 'custom' && !customClaudeModelName.trim())))
                      }
                    >
                      {isSavingAIConfig ? (
                        <><Spinner size="sm" as="span" animation="border" className="me-1"/> 保存中...</>
                      ) : (
                        <><i className="bi bi-save me-1"></i>保存 AI 配置</>
                      )}
                    </Button>
                  </div>
                </Form>
              )}
            </Card.Body>
          </Card>

          <Card className="bilibili-card shadow-sm">
            <Card.Header className="bili-card-header d-flex align-items-center">
              <i className="bi bi-key-fill me-2 bili-header-icon"></i>
              <Card.Title as="h5" className="mb-0">修改密码</Card.Title>
            </Card.Header>
            <Card.Body className="p-4">
              <Form id="password-form" onSubmit={handleChangePassword}>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3" controlId="new-password">
                      <Form.Label className="bili-form-label">
                        <i className="bi bi-lock-fill me-1"></i>新密码
                      </Form.Label>
                      <InputGroup>
                        <InputGroup.Text className="bili-input-icon">
                          <i className="bi bi-shield-lock"></i>
                        </InputGroup.Text>
                        <Form.Control 
                          type="password" 
                          required 
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          disabled={isChangingPassword}
                          placeholder="输入新密码"
                          className="bili-form-input"
                        />
                      </InputGroup>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3" controlId="confirm-password">
                      <Form.Label className="bili-form-label">
                        <i className="bi bi-check-circle-fill me-1"></i>确认新密码
                      </Form.Label>
                      <InputGroup>
                        <InputGroup.Text className="bili-input-icon">
                          <i className="bi bi-shield-check"></i>
                        </InputGroup.Text>
                        <Form.Control 
                          type="password" 
                          required 
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          disabled={isChangingPassword}
                          placeholder="再次输入新密码"
                          className="bili-form-input"
                        />
                      </InputGroup>
                    </Form.Group>
                  </Col>
                </Row>
                
                <div className="d-flex justify-content-end mt-4">
                  <Button 
                    variant="primary" 
                    type="submit" 
                    disabled={isChangingPassword || !newPassword || !confirmPassword}
                    className="bili-button-submit"
                  >
                    {isChangingPassword ? (
                      <><Spinner size="sm" as="span" animation="border" className="me-1"/> 修改中...</>
                    ) : (
                      <><i className="bi bi-check-lg me-1"></i>修改密码</>
                    )}
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
      
      <Modal show={showHelpModal} onHide={() => setShowHelpModal(false)} size="xl" className="bili-modal">
        <Modal.Header closeButton className="bili-modal-header">
          <Modal.Title>
            <i className="bi bi-info-circle me-2"></i>
            如何获取B站Cookie
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4">
          <Row>
            <Col md={5}>
              <div className="bili-help-steps">
                <h5 className="mb-3 bili-help-title">操作步骤</h5>
                <ol className="bili-step-list ps-3">
                  <li className="mb-2">在浏览器中登录 <a href="https://www.bilibili.com" target="_blank" rel="noopener noreferrer" className="bili-link">哔哩哔哩</a> 网站</li>
                  <li className="mb-2">按 <kbd>F12</kbd> 打开开发者工具（或右键点击页面，选择"检查"）</li>
                  <li className="mb-2">切换到"网络"（Network）选项卡</li>
                  <li className="mb-2">刷新页面，然后点击任意一个 bilibili.com 请求</li>
                  <li className="mb-2">在右侧找到"请求标头"（Headers）区域，下拉找到"Cookie"</li>
                  <li className="mb-2">复制整个Cookie值并粘贴到输入框中</li>
                </ol>
                <div className="alert alert-warning mt-3" role="alert">
                  <i className="bi bi-exclamation-triangle-fill me-2"></i>
                  <strong>注意：</strong> Cookie包含您的账号信息，请不要分享给他人
                </div>
              </div>
            </Col>
            <Col md={7}>
              <div className="bili-help-image">
                <img 
                  src="/img/helper.png" 
                  className="img-fluid border rounded shadow-sm" 
                  alt="获取Cookie示意图" 
                />
                <div className="text-center mt-2 text-muted">
                  <small>获取Cookie示意图（点击图片可放大）</small>
                </div>
              </div>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer className="bili-modal-footer">
          <Button variant="primary" onClick={() => setShowHelpModal(false)}>
            <i className="bi bi-check2 me-1"></i>
            我知道了
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default SettingsPage; 