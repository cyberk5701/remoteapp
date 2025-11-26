import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './App.css';
import { FaDesktop, FaKeyboard, FaTimes, FaStopCircle, FaCopy, FaArrowLeft } from 'react-icons/fa';

const SIGNALING_SERVER = 'http://localhost:5000';
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.google.com:19302' }
  ]
};

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const ROBOT_KEY_MAP = {
  "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right",
  "Enter": "enter", "Backspace": "backspace", "Tab": "tab", "Escape": "escape",
  " ": "space", "Shift": "shift", "Control": "control", "Alt": "alt", "Meta": "command", "AltGraph": "alt",
  "Delete": "delete", "Home": "home", "End": "end", "PageUp": "pageup", "PageDown": "pagedown",
  "CapsLock": "capslock", "F1": "f1", "F2": "f2", "F3": "f3", "F4": "f4", "F5": "f5",
  "F6": "f6", "F7": "f7", "F8": "f8", "F9": "f9", "F10": "f10", "F11": "f11", "F12": "f12"
};

function App() {
  const [view, setView] = useState('dashboard');
  const [status, setStatus] = useState('Idle');
  const [sourceList, setSourceList] = useState([]);
  const [role, setRole] = useState(null);
  const [activeTab, setActiveTab] = useState('screen');
  const [connectionCode, setConnectionCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const videoRef = useRef(null);
  const socketRef = useRef();
  const peerRef = useRef();
  const dataChannelRef = useRef();
  const roomIdRef = useRef('');
  const remoteStreamRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0, isDirty: false });
  const videoBoundsRef = useRef(null);
  const loopRef = useRef(null);
  const candidateQueueRef = useRef([]);

  //Resize Window
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.resizeWindow) {
      if (view === 'active') {
        if (role === 'host') {
          window.electronAPI.resizeWindow('mini');
        } else if (role === 'client') {
          window.electronAPI.resizeWindow('fullscreen');
        }
      } else {
        window.electronAPI.resizeWindow('restore');
      }
    }
  }, [view, role]);

  //cleanConnection
  const cleanupConnection = () => {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null; }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    if (dataChannelRef.current) { dataChannelRef.current.close(); dataChannelRef.current = null; }
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    candidateQueueRef.current = [];
    setConnectionCode(''); setInputCode(''); setRole(null);
    setSourceList([]); roomIdRef.current = ''; remoteStreamRef.current = null;

    if (socketRef.current && socketRef.current.connected) setStatus('Connected to Server');
    else setStatus('Idle');

    setView('dashboard');
  };

  const processCandidateQueue = async () => {
    if (!peerRef.current || peerRef.current.signalingState === 'closed') return;
    if (!peerRef.current.remoteDescription) return;
    while (candidateQueueRef.current.length > 0) {
      const candidate = candidateQueueRef.current.shift();
      try { await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (e) { console.warn(e); }
    }
  };

  useEffect(() => {
    socketRef.current = io(SIGNALING_SERVER);
    socketRef.current.on('connect', () => setStatus('Connected to Server'));
    socketRef.current.on('ice-candidate', async (candidate) => {
      if (!peerRef.current || peerRef.current.signalingState === 'closed') return;
      if (peerRef.current.remoteDescription && peerRef.current.remoteDescription.type) {
        try { await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { }
      } else { candidateQueueRef.current.push(candidate); }
    });
    socketRef.current.on('offer', async (offer) => {
      if (!peerRef.current) createPeerConnection();
      if (peerRef.current.signalingState !== "stable") {
        await Promise.all([peerRef.current.setLocalDescription({ type: "rollback" }), peerRef.current.setRemoteDescription(offer)]);
      } else { await peerRef.current.setRemoteDescription(new RTCSessionDescription(offer)); }
      const answer = await peerRef.current.createAnswer();
      await peerRef.current.setLocalDescription(answer);
      await processCandidateQueue();
      socketRef.current.emit('answer', { roomId: roomIdRef.current, answer });
    });
    socketRef.current.on('answer', async (answer) => {
      if (!peerRef.current || peerRef.current.signalingState === 'closed') return;
      if (peerRef.current.signalingState === 'have-local-offer') {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        await processCandidateQueue();
      }
      setView('active');
    });
    socketRef.current.on('user-disconnected', () => { alert("Đối phương đã ngắt kết nối!"); cleanupConnection(); });
    return () => { if (socketRef.current) { socketRef.current.disconnect(); } cleanupConnection(); };
  }, []);

  useEffect(() => {
    if (role === 'client' && view === 'active') {
      const sendKey = (type, keyName) => {
        if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
          dataChannelRef.current.send(JSON.stringify({ type: type, key: keyName }));
        }
      };

      const handleKeyEvent = (e, type) => {
        e.preventDefault();
        let robotKey = ROBOT_KEY_MAP[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : null);
        if (robotKey) sendKey(type, robotKey);
      };


      const handleBlur = () => {
        console.log("Window blurred - Releasing modifiers");
        ['alt', 'control', 'shift', 'command'].forEach(key => sendKey('keyup', key));
      };

      window.addEventListener('keydown', (e) => handleKeyEvent(e, 'keydown'));
      window.addEventListener('keyup', (e) => handleKeyEvent(e, 'keyup'));
      window.addEventListener('blur', handleBlur);

      return () => {
        window.removeEventListener('keydown', (e) => handleKeyEvent(e, 'keydown'));
        window.removeEventListener('keyup', (e) => handleKeyEvent(e, 'keyup'));
        window.removeEventListener('blur', handleBlur);
      };
    }
  }, [role, view]);

  useEffect(() => {
    if (view === 'active') {
      if (videoRef.current && remoteStreamRef.current) {
        videoRef.current.srcObject = remoteStreamRef.current;
        videoRef.current.play().catch(e => console.error(e));
      }
      if (role === 'client') {
        const observer = new ResizeObserver(entries => {
          const rect = entries[0].target.getBoundingClientRect();
          videoBoundsRef.current = { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
        });
        if (videoRef.current) observer.observe(videoRef.current);
        loopRef.current = setInterval(sendMouseData, 33);
        return () => { observer.disconnect(); clearInterval(loopRef.current); };
      }
    }
  }, [view, role]);

  const handleStartHost = async () => {
    try {
      const s = await window.electronAPI.getScreenSources();
      setSourceList(s); setView('source-select');
    } catch (e) { alert("Error"); }
  };
  const selectSource = async (sourceId) => {
    try {
      const code = generateCode(); setConnectionCode(code); roomIdRef.current = code; setRole('host');
      await window.electronAPI.setSource(sourceId);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minFrameRate: 20,
            maxFrameRate: 60,
            maxWidth: 1920,
            maxHeight: 1080
          }
        }
      });
      remoteStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      createPeerConnection();
      stream.getTracks().forEach(track => peerRef.current.addTrack(track, stream));
      const dc = peerRef.current.createDataChannel("control");
      dc.onmessage = (e) => window.electronAPI.sendControl(e.data);
      dataChannelRef.current = dc;
      socketRef.current.emit('join-room', code);
      setView('waiting');
      socketRef.current.off('user-connected');
      socketRef.current.on('user-connected', async () => {
        if (peerRef.current && (peerRef.current.signalingState === 'stable' || peerRef.current.signalingState === 'closed')) {
          if (peerRef.current.signalingState === 'closed') createPeerConnection();
          const offer = await peerRef.current.createOffer();
          await peerRef.current.setLocalDescription(offer);
          socketRef.current.emit('offer', { roomId: code, offer });
        }
      });
    } catch (e) { console.error(e); }
  };
  const handleStartClient = () => { setRole('client'); setView('enter-code'); };
  const connectToHost = () => {
    if (inputCode.length !== 6) return alert("Mã sai!");
    setConnectionCode(inputCode); roomIdRef.current = inputCode;
    createPeerConnection();
    peerRef.current.ontrack = (event) => { remoteStreamRef.current = event.streams[0]; setView('active'); };
    peerRef.current.ondatachannel = (event) => { dataChannelRef.current = event.channel; };
    socketRef.current.emit('join-room', inputCode);
  };
  const createPeerConnection = () => {
    if (peerRef.current) peerRef.current.close();
    peerRef.current = new RTCPeerConnection(rtcConfig);
    peerRef.current.onicecandidate = (event) => {
      if (event.candidate) socketRef.current.emit('ice-candidate', {
        roomId: roomIdRef.current, candidate: event.candidate
      });
    };
  };
  const handleMouseMove = (e) => {
    mousePosRef.current.x = e.clientX;
    mousePosRef.current.y = e.clientY;
    mousePosRef.current.isDirty = true;
  };
  const sendMouseData = () => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open' || !mousePosRef.current.isDirty) return;
    const videoEl = videoRef.current; const bounds = videoBoundsRef.current;
    if (!videoEl || !bounds || videoEl.videoWidth === 0) return;
    const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
    const containerRatio = bounds.width / bounds.height;
    let renderWidth, renderHeight, offsetX, offsetY;
    if (containerRatio > videoRatio) {
      renderHeight = bounds.height;
      renderWidth = renderHeight * videoRatio;
      offsetX = (bounds.width - renderWidth) / 2;
      offsetY = 0;
    }
    else {
      renderWidth = bounds.width;
      renderHeight = renderWidth / videoRatio;
      offsetX = 0;
      offsetY = (bounds.height - renderHeight) / 2;
    }
    const xOnVideo = mousePosRef.current.x - bounds.left - offsetX;
    const yOnVideo = mousePosRef.current.y - bounds.top - offsetY;
    const xPercent = xOnVideo / renderWidth; const yPercent = yOnVideo / renderHeight;
    mousePosRef.current.isDirty = false;
    if (xPercent < 0 || xPercent > 1 || yPercent < 0 || yPercent > 1) return;
    dataChannelRef.current.send(JSON.stringify({ type: 'mousemove', xPercent, yPercent }));
  };
  const handleMouseDown = (e) => {
    if (role === 'client' && dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify({
        type: 'mousedown', button: e.button === 2 ? 'right' : 'left'
      }));
    }
  };
  const handleMouseUp = (e) => {
    if (role === 'client' && dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify({
        type: 'mouseup', button: e.button === 2 ? 'right' : 'left'
      }));
    }
  };
  const handleWheel = (e) => {
    if (role === 'client' && dataChannelRef.current?.readyState === 'open') {
      const data = { type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY };
      console.log("📤 [Client] Đang gửi lệnh Scroll:", data);
      dataChannelRef.current.send(JSON.stringify(data));
    }
  };
  const stopSharing = () => {
    socketRef.current.emit('leave-room', roomIdRef.current);
    cleanupConnection();
  };

  return (
    <div className="container">
      {view !== 'active' && (
        <div className="header">
          <div className="logo">RemoteApp Pro</div>
          <div className={`status-badge ${status.includes('Connected') ? 'connected' : ''}`}>{status}</div>
        </div>
      )}

      {view === 'dashboard' && (
        <div className="dashboard">
          <div className="card" onClick={handleStartHost}>
            <div className="card-icon"><FaDesktop />
            </div><h3>Share Screen</h3><p>Allow control.</p></div>
          <div className="card" onClick={handleStartClient}>
            <div className="card-icon"><FaKeyboard /></div><h3>Remote Control</h3><p>Control another PC.</p>
          </div>
        </div>
      )}

      {view === 'source-select' && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button className="close-modal-btn" onClick={() => setView('dashboard')}><FaTimes /></button>
            <h3>Select Source</h3>
            <div className="tab-group">
              <button className={`tab-btn ${activeTab === 'screen' ? 'active' : ''}`}
                onClick={() => setActiveTab('screen')}>Screens</button>
              <button className={`tab-btn ${activeTab === 'window' ? 'active' : ''}`}
                onClick={() => setActiveTab('window')}>Windows</button>
            </div>
            <div className="screen-grid">{sourceList.filter(s => s.id.startsWith(activeTab + ':')).map(s =>
            (<div key={s.id} className="screen-item"
              onClick={() => selectSource(s.id)}><img src={s.thumbnail} alt="" />
              <p>{s.name}</p>
            </div>))}
            </div>
          </div>
        </div>
      )}

      {view === 'waiting' && (
        <div className="dashboard">
          <div className="code-container">
            <h3>Your Connection Code</h3>
            <div className="display-code" onClick={() => navigator.clipboard.writeText(connectionCode)}>
              {connectionCode} <FaCopy style={{ fontSize: '1rem', marginLeft: 10 }} />
            </div>
            <p style={{ color: '#a6adc8' }}>Share this code with your partner.</p>
            <p className="loader">Waiting for connection...</p>
            <button className="btn-primary" style={{ background: '#f38ba8', marginTop: 20 }} onClick={stopSharing}>
              Cancel
            </button>
          </div>
        </div>
      )}


      {view === 'enter-code' && (
        <div className="dashboard">
          <div className="code-container">
            <button className="close-modal-btn" style={{ position: 'static', marginBottom: 20, float: 'left' }} onClick={() => setView('dashboard')}>
              <FaArrowLeft />
            </button>
            <h3 style={{ clear: 'both' }}>Enter Connection Code</h3>
            <input className="input-code" placeholder="123456"
              maxLength={6} value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <br />
            <button className="btn-primary" onClick={connectToHost}>Connect</button>
          </div>
        </div>
      )}

      {view === 'active' && (
        <div className={`video-container ${role === 'host' ? 'mini-mode' : ''}`}
          style={{ background: role === 'host' ? '#222' : '#000' }}>
          {role === 'client' && (
            <video ref={videoRef}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onWheel={handleWheel}
              onContextMenu={e => e.preventDefault()}
              autoPlay
              muted
              style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'crosshair' }} />
          )}
          {role === 'host' && (
            <div className="host-mini-panel">
              <div className="recording-dot"></div>
              <span style={{ fontWeight: 'bold', marginRight: 10 }}>Sharing...</span>
              <button onClick={stopSharing} className="btn-stop">
                <FaStopCircle style={{ marginRight: 5 }} /> Stop Sharing
              </button>
              <video ref={videoRef} autoPlay muted style={{ display: 'none' }} />
            </div>
          )}
          {role === 'client' && (
            <div className="control-bar"><button onClick={stopSharing} className="btn-primary"><FaTimes /> End Session </button></div>
          )}
        </div>
      )}
    </div>
  );
}
export default App;