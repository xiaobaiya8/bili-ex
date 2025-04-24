import React, { useState, useRef } from 'react';
import { Modal, Button, Spinner } from 'react-bootstrap';
import './AudioPlayer.css';

interface AudioPlayerProps {
  audioSrc: string;
  title?: string;
  onClose: () => void;
  show: boolean;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioSrc,
  title,
  onClose,
  show
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = audioSrc;
    a.download = audioSrc.split('/').pop() || 'audio.mp3';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleLoadedData = () => {
    setLoading(false);
  };

  const handleError = () => {
    setLoading(false);
    setError('加载音频失败');
  };

  return (
    <Modal
      show={show}
      onHide={onClose}
      dialogClassName="audio-player-modal"
      contentClassName="audio-player-content"
      centered
    >
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-music-note-beamed me-2"></i>
          {title ? `${title} - 音频` : '音频预览'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="audio-player-container">
          {loading && (
            <div className="audio-loading">
              <Spinner animation="border" variant="primary" />
              <p className="mt-2">加载音频中...</p>
            </div>
          )}
          
          {error && (
            <div className="audio-error">
              <i className="bi bi-exclamation-triangle-fill me-2"></i>
              {error}
            </div>
          )}
          
          <audio 
            ref={audioRef}
            controls
            className="w-100"
            onLoadedData={handleLoadedData}
            onError={handleError}
            style={{ display: loading ? 'none' : 'block' }}
            autoPlay
          >
            <source src={audioSrc} type="audio/mpeg" />
            您的浏览器不支持音频播放。
          </audio>
          
          <div className="audio-visualization">
            <div className="audio-cover">
              <i className="bi bi-music-note"></i>
            </div>
            <div className="audio-wave">
              {Array.from({ length: 30 }).map((_, index) => (
                <div key={index} className="wave-bar"></div>
              ))}
            </div>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>
          关闭
        </Button>
        <Button 
          variant="primary" 
          onClick={handleDownload}
        >
          <i className="bi bi-download me-1"></i>
          下载音频
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AudioPlayer; 