import React, { useState, useRef, useEffect } from 'react';
import { Modal, Button } from 'react-bootstrap';
import './VideoDialog.css';

interface VideoDialogProps {
  videoSrc: string;
  thumbnailSrc?: string;
  title?: string;
  animationStyle?: 'from-center' | 'from-bottom' | 'top-in-bottom-out';
  children?: React.ReactNode;
  show?: boolean;
  onClose?: () => void;
}

const VideoDialog: React.FC<VideoDialogProps> = ({
  videoSrc,
  title,
  animationStyle = 'from-center',
  children,
  show: externalShow,
  onClose: externalOnClose
}) => {
  const [internalShow, setInternalShow] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [aspectRatio, setAspectRatio] = useState(16/9); // 默认宽高比

  // 使用外部或内部状态
  const show = externalShow !== undefined ? externalShow : internalShow;
  const handleClose = () => {
    if (externalOnClose) {
      externalOnClose();
    } else {
      setInternalShow(false);
    }
  };
  const handleShow = () => {
    if (externalOnClose === undefined) {
      setInternalShow(true);
    }
  };

  useEffect(() => {
    if (!show && videoRef.current) {
      videoRef.current.pause();
    }
  }, [show]);

  // 处理视频加载完成后获取实际宽高比
  const handleVideoLoaded = () => {
    if (videoRef.current) {
      const { videoWidth, videoHeight } = videoRef.current;
      if (videoWidth && videoHeight) {
        setAspectRatio(videoWidth / videoHeight);
      }
    }
  };
  
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = videoSrc;
    a.download = videoSrc.split('/').pop() || 'video.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      {children && (
        <div onClick={handleShow} className="video-dialog-trigger">
          {children}
        </div>
      )}

      <Modal 
        show={show} 
        onHide={handleClose} 
        centered
        dialogClassName={`video-dialog ${animationStyle}`}
        contentClassName="video-dialog-content"
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-film me-2"></i>
            {title || "视频播放"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <video 
            ref={videoRef}
            controls 
            autoPlay
            className="video-player"
            onLoadedMetadata={handleVideoLoaded}
            style={{
              aspectRatio: aspectRatio > 0 ? `${aspectRatio}` : undefined,
              maxHeight: '100%',
              maxWidth: '100%'
            }}
          >
            <source src={videoSrc} type="video/mp4" />
            您的浏览器不支持视频播放。
          </video>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose}>
            关闭
          </Button>
          <Button variant="primary" onClick={handleDownload}>
            <i className="bi bi-download me-1"></i>
            下载视频
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default VideoDialog; 