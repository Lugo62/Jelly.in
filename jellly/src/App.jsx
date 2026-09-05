import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { generateRandomName, getDeviceId, getUserNeonColor, generate6DigitCode } from './identity';
import { sounds } from './soundEffects';
import './App.css';

const POPULAR_EMOJIS = [
  '😂', '❤️', '🔥', '💀', '👍', '✨',
  '😭', '👀', '🥺', '🎉', '💯', '🙏',
  '😍', '🧢', '🚀', '⚡', '🤯', '🤝'
];

export default function App() {
  // Navigation & Session State
  const [activeRoom, setActiveRoom] = useState(null);
  const [currentIdentity, setCurrentIdentity] = useState(generateRandomName);
  const [deviceId] = useState(getDeviceId);

  // Landing Screen Form States
  const [activeTab, setActiveTab] = useState('join'); // 'join' or 'create'
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [createNameInput, setCreateNameInput] = useState('');
  const [formError, setFormError] = useState('');

  // Chat States
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isCooldown, setIsCooldown] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [activeReactionTarget, setActiveReactionTarget] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);

  const textareaRef = useRef(null);
  const longPressTimer = useRef(null);
  const isInitialLoad = useRef(true);

  // Touch & Drag tracking for swipe-to-reply
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState({ id: null, offset: 0 });

  // 1. Fetch Room Messages & Bind Realtime on Active Room Change
  useEffect(() => {
    if (!activeRoom) return;
    isInitialLoad.current = true;

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', activeRoom.code)
        .order('created_at', { ascending: false })
        .limit(50);
      if (data) setMessages(data);
      isInitialLoad.current = false;
    };

    fetchMessages();

    const channel = supabase
      .channel(`room:${activeRoom.code}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${activeRoom.code}` },
        (payload) => {
          setMessages((prev) => [payload.new, ...prev.filter((m) => m.id !== payload.new.id)]);
          if (!isInitialLoad.current && soundEnabled) sounds.playReceive();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${activeRoom.code}` },
        (payload) => {
          setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? payload.new : m)));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRoom, soundEnabled]);

  // 2. Room Action Handlers
  const handleCreateRoom = async (e) => {
    e.preventDefault();
    const name = createNameInput.trim();
    if (!name) return setFormError('Please enter a room name');

    const newCode = generate6DigitCode();
    const { data, error } = await supabase
      .from('rooms')
      .insert([{ code: newCode, name, creator_device_id: deviceId }])
      .select()
      .single();

    if (error) return setFormError('Error creating room. Try again.');
    setActiveRoom(data);
    setFormError('');
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    const code = joinCodeInput.trim();
    if (code.length !== 6) return setFormError('Room code must be 6 digits');

    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code)
      .single();

    if (error || !data) {
      return setFormError('Room expired or does not exist');
    }

    setActiveRoom(data);
    setFormError('');
  };

  // 3. Message Handlers
  const sendMessage = async () => {
    const cleanText = inputText.trim();
    if (!cleanText || isCooldown || !activeRoom) return;

    if (soundEnabled) sounds.playPop();
    setInputText('');
    const replyPayload = replyingTo;
    setReplyingTo(null);

    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsCooldown(true);

    await supabase.from('messages').insert([
      {
        room_id: activeRoom.code,
        alias: currentIdentity.alias,
        avatar_color: currentIdentity.neonColor,
        content: cleanText,
        reactions: {},
        device_id: deviceId,
        reply_to: replyPayload
          ? {
              id: replyPayload.id,
              alias: replyPayload.alias,
              content: replyPayload.content.substring(0, 70),
            }
          : null,
      },
    ]);

    setTimeout(() => setIsCooldown(false), 800);
  };

  const deleteMessage = async (msg) => {
    if (msg.device_id !== deviceId) return;
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    await supabase.from('messages').delete().eq('id', msg.id);
  };

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Swipe & Hold gesture handlers with context suppression
  const handleTouchStart = (msg, e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    touchStartX.current = clientX;
    touchStartY.current = clientY;

    longPressTimer.current = setTimeout(() => {
      setActiveReactionTarget(msg.id);
      if (soundEnabled) sounds.playPop();
    }, 400);
  };

  const handleTouchMove = (msgId, e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const deltaX = clientX - touchStartX.current;
    const deltaY = Math.abs(clientY - touchStartY.current);

    if (Math.abs(deltaX) > 8 || deltaY > 8) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    }
    if (deltaX > 0 && deltaX < 85 && deltaY < 30) {
      setSwipeOffset({ id: msgId, offset: deltaX });
    }
  };

  const handleTouchEnd = (msg) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (swipeOffset.id === msg.id && swipeOffset.offset > 50) {
      setReplyingTo(msg);
      if (soundEnabled) sounds.playPop();
      if (textareaRef.current) textareaRef.current.focus();
    }
    setSwipeOffset({ id: null, offset: 0 });
  };

  const addReaction = async (msgId, emoji) => {
    setActiveReactionTarget(null);
    const targetMsg = messages.find((m) => m.id === msgId);
    if (!targetMsg) return;

    const currentReactions = targetMsg.reactions || {};
    const count = (currentReactions[emoji] || 0) + 1;
    const updated = { ...currentReactions, [emoji]: count };

    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, reactions: updated } : m))
    );

    await supabase.from('messages').update({ reactions: updated }).eq('id', msgId);
  };

 // ==========================================
  // FULL-SCREEN OCCUPIED GATEWAY (JELLY.IN)
  // ==========================================
  if (!activeRoom) {
    return (
      <div className="fs-landing-viewport">
        {/* Ambient Grid Background */}
        <div className="fs-grid-overlay" />

        {/* Top Header Bar */}
        <header className="fs-top-bar">
          <div className="fs-brand">
            <span className="fs-pulse-beacon" />
            <span className="fs-brand-name">Jelly<span className="fs-cyan-dot">.in</span></span>
          </div>
          <div className="fs-network-pill">
            <span className="fs-status-dot" />
            <span>EPHEMERAL PROTOCOL</span>
          </div>
        </header>

        {/* Center Main Staging Area */}
        <main className="fs-main-content">
          <div className="fs-hero-block">
            <h1 className="fs-hero-title">
              INCIDENTAL ROOMS.<br />
              <span className="fs-gradient-text">ZERO-TRACE CHAT.</span>
            </h1>
            <p className="fs-hero-desc">
              Disposable anonymous communication hubs. Rooms, identities, and message history auto-destruct following 60 minutes of inactivity.
            </p>
          </div>

          <div className="fs-action-console">
            {/* Identity Strip */}
            <div className="fs-identity-banner">
              <div className="fs-id-group">
                <span
                  className="fs-avatar-chip"
                  style={{
                    backgroundColor: currentIdentity.neonColor,
                    boxShadow: `0 0 14px ${currentIdentity.neonColor}60`,
                  }}
                >
                  {currentIdentity.avatarChar}
                </span>
                <div className="fs-id-text">
                
                  <strong className="fs-alias">{currentIdentity.alias}</strong>
                </div>
              </div>
              <button
                type="button"
                className="fs-shuffle-btn"
                onClick={() => setCurrentIdentity(generateRandomName())}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                <span>REROLL</span>
              </button>
            </div>

            {/* Segmented Switcher */}
            <div className="fs-segmented-nav">
              <button
                type="button"
                className={`fs-nav-btn ${activeTab === 'join' ? 'active' : ''}`}
                onClick={() => { setActiveTab('join'); setFormError(''); }}
              >
                JOIN ACTIVE ROOM
              </button>
              <button
                type="button"
                className={`fs-nav-btn ${activeTab === 'create' ? 'active' : ''}`}
                onClick={() => { setActiveTab('create'); setFormError(''); }}
              >
                GENERATE NEW ROOM
              </button>
            </div>

            {formError && <div className="fs-error-toast">{formError}</div>}

            {/* Active Control Dock */}
            {activeTab === 'join' ? (
              <form onSubmit={handleJoinRoom} className="fs-input-dock">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="ENTER 6-DIGIT PIN"
                  maxLength={6}
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.replace(/\D/g, ''))}
                  className="fs-field fs-pin-field"
                  autoFocus
                />
                <button type="submit" className="fs-action-btn">
                  ENTER ROOM ➔
                </button>
              </form>
            ) : (
              <form onSubmit={handleCreateRoom} className="fs-input-dock">
                <input
                  type="text"
                  placeholder="Room Title (e.g. campus_general)"
                  maxLength={24}
                  value={createNameInput}
                  onChange={(e) => setCreateNameInput(e.target.value)}
                  className="fs-field fs-text-field"
                  autoFocus
                />
                <button type="submit" className="fs-action-btn">
                  INITIALIZE ➔
                </button>
              </form>
            )}
          </div>
        </main>

        {/* Bottom Metadata Metrics */}
        <footer className="fs-footer-bar">
          <div className="fs-meta-item">
            <span className="fs-meta-label">MEMORY TTL</span>
            <span className="fs-meta-val">60 MIN</span>
          </div>
          <div className="fs-meta-divider" />
          <div className="fs-meta-item">
            <span className="fs-meta-label">DATABASE PRUNE</span>
            <span className="fs-meta-val">AUTO ROLLING</span>
          </div>
          <div className="fs-meta-divider" />
          <div className="fs-meta-item">
            <span className="fs-meta-label">ENCRYPTION PROTOCOL</span>
            <span className="fs-meta-val">CLIENT ANONYMIZED</span>
          </div>
        </footer>
      </div>
    );
  }

  // ==========================================
  // ACTIVE CHAT ROOM SCREEN
  // ==========================================
  return (
    <div className="neon-shell">
      {/* Centered Reaction Modal */}
      {activeReactionTarget && (
        <div className="reaction-backdrop" onClick={() => setActiveReactionTarget(null)}>
          <div
            className="centered-reaction-modal unselectable"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="reaction-modal-header unselectable">
              <span>REACT TO MESSAGE</span>
              <button className="close-modal-btn" onClick={() => setActiveReactionTarget(null)}>
                ✕
              </button>
            </div>
            <div className="emoji-grid-modal unselectable">
              {POPULAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  className="modal-emoji-cell unselectable"
                  onClick={() => addReaction(activeReactionTarget, emoji)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="neon-sidebar">
        <div className="neon-brand">
          <div className="neon-square" style={{ background: currentIdentity.neonColor, boxShadow: `0 0 10px ${currentIdentity.neonColor}` }} />
          <h2>Jelly.in</h2>
        </div>
        <p className="sidebar-copy">
          Swipe right to reply. Inactivity past 1 hour automatically purges all room records and chat feeds.
        </p>

        <div className="telemetry-card">
          <div className="telemetry-row">
            <span>ROOM TITLE</span>
            <strong style={{ color: currentIdentity.neonColor }}>{activeRoom.name}</strong>
          </div>
          <div className="telemetry-row">
            <span>ROOM CODE</span>
            <strong className="mono">{activeRoom.code}</strong>
          </div>
          <div className="telemetry-row">
            <span>YOUR ROLE</span>
            <strong>{activeRoom.creator_device_id === deviceId ? 'Room Owner' : 'Participant'}</strong>
          </div>
        </div>

        <button className="leave-room-btn" onClick={() => setActiveRoom(null)}>
          LEAVE ROOM ➔
        </button>
      </aside>

      {/* Main Chat Interface */}
      <main className="neon-chat">
        {/* Top Header: Room Name and Code */}
        <header className="neon-header">
          <div className="header-meta">
            <button className="back-home-btn" onClick={() => setActiveRoom(null)} title="Leave Room">
              ‹
            </button>
            <div className="header-title-stack">
              <h3 className="room-display-name">{activeRoom.name}</h3>
              <div className="room-code-tag">
                <span className="code-dot" />
                <span>CODE: {activeRoom.code}</span>
              </div>
            </div>
          </div>

          <div className="header-actions">
            <button className="neon-toggle-btn" onClick={() => setSoundEnabled(!soundEnabled)}>
              {soundEnabled ? 'AUDIO [ON]' : 'AUDIO [OFF]'}
            </button>
            <div className="user-indicator-pill" style={{ borderColor: `${currentIdentity.neonColor}50` }}>
              <span className="mini-dot" style={{ backgroundColor: currentIdentity.neonColor }} />
              <span>{currentIdentity.alias}</span>
            </div>
          </div>
        </header>

        {/* Message Feed */}
        <section className="neon-feed">
          {messages.map((msg) => {
            const isOwner = msg.device_id === deviceId;
            const isRoomCreator = msg.device_id === activeRoom.creator_device_id;
            const userAccent = getUserNeonColor(msg.alias);
            const currentOffset = swipeOffset.id === msg.id ? swipeOffset.offset : 0;

            return (
              <div key={msg.id} className="swipe-lane">
                <div className="swipe-reply-cue" style={{ opacity: currentOffset > 30 ? 1 : 0.2 }}>
                  ↩
                </div>

                <div
                  className="neon-card unselectable"
                  style={{
                    transform: `translateX(${currentOffset}px)`,
                    transition: currentOffset === 0 ? 'transform 0.18s ease-out' : 'none',
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  onMouseDown={(e) => handleTouchStart(msg, e)}
                  onMouseMove={(e) => handleTouchMove(msg.id, e)}
                  onMouseUp={() => handleTouchEnd(msg)}
                  onTouchStart={(e) => handleTouchStart(msg, e)}
                  onTouchMove={(e) => handleTouchMove(msg.id, e)}
                  onTouchEnd={() => handleTouchEnd(msg)}
                >
                  {msg.reply_to && (
                    <div className="quote-badge">
                      <div className="quote-bar" />
                      <div className="quote-details">
                        <span className="quote-user">{msg.reply_to.alias}</span>
                        <span className="quote-text">{msg.reply_to.content}</span>
                      </div>
                    </div>
                  )}

                  <div className="neon-card-header">
                    <div className="author-container">
                      <div className="neon-avatar-pill" style={{ backgroundColor: userAccent }}>
                        {msg.alias[0]}
                      </div>
                      <span className="author-alias-text" style={{ color: userAccent }}>
                        {msg.alias}
                      </span>

                      {/* Small Owner Badge */}
                      {isRoomCreator && (
                        <span className="room-owner-badge" title="Created this room">
                          ★ OWNER
                        </span>
                      )}

                      {/* Sleek YOU Tag */}
                      {isOwner && (
                        <span className="sleek-you-tag">
                          <span className="you-pulse-dot" />
                          YOU
                        </span>
                      )}
                    </div>

                    <div className="card-right-group">
                      <time className="message-timestamp">
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>

                      {isOwner && (
                        <button
                          className="neon-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMessage(msg);
                          }}
                          title="Delete message"
                        >
                          DEL
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="neon-card-body">
                    <p className="clean-normal-text">{msg.content}</p>
                  </div>

                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className="reactions-wrap">
                      {Object.entries(msg.reactions).map(([emoji, count]) => (
                        <button
                          key={emoji}
                          className="neon-reaction-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            addReaction(msg.id, emoji);
                          }}
                        >
                          <span>{emoji}</span>
                          <span className="count-num">{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Bottom Composer */}
        <footer className="modern-bottom-bar">
          {replyingTo && (
            <div className="reply-preview-strip">
              <div className="reply-preview-left">
                <span className="reply-label">REPLYING TO</span>
                <span className="reply-author">{replyingTo.alias}</span>
                <p className="reply-snippet">{replyingTo.content}</p>
              </div>
              <button className="cancel-reply-btn" onClick={() => setReplyingTo(null)}>
                ✕
              </button>
            </div>
          )}

          <div className="integrated-input-dock">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                replyingTo
                  ? `Reply to @${replyingTo.alias}...`
                  : `Transmit as ${currentIdentity.alias}...`
              }
              maxLength={400}
            />
            <button
              className="edge-send-btn"
              onClick={sendMessage}
              disabled={isCooldown || !inputText.trim()}
              style={{
                backgroundColor: currentIdentity.neonColor,
                boxShadow: inputText.trim() ? `0 0 18px ${currentIdentity.neonColor}90` : 'none',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}