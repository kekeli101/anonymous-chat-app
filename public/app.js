// Connect to Socket.IO server
const socket = io({
    transports: ['websocket', 'polling']
  });
  
  // DOM Elements — pages
  const greetingPage = document.getElementById('greeting-page');
  const joinRoomPage = document.getElementById('join-room-page');
  const chatRoomPage = document.getElementById('chat-room-page');
  
  // Greeting buttons
  const createPublicBtn = document.getElementById('create-public-btn');
  const createPrivateBtn = document.getElementById('create-private-btn');
  const joinRoomBtn = document.getElementById('join-room-btn');
  
  // Join page
  const joinSubmitBtn = document.getElementById('join-submit-btn');
  const joinBackBtn = document.getElementById('join-back-btn');
  const roomKeyInput = document.getElementById('room-key-input');
  const joinErrorMessage = document.getElementById('join-error-message');
  
  // Chat controls
  const deleteRoomBtn = document.getElementById('delete-room-btn');
  const sendMessageBtn = document.getElementById('send-message-btn');
  const messageInput = document.getElementById('message-input');
  const chatMessages = document.getElementById('chat-messages');
  
  const roomKeyDisplay = document.getElementById('room-key-display');
  const usernameDisplay = document.getElementById('username-display');
  const userCountDisplay = document.getElementById('user-count-display');
  const adminControls = document.getElementById('admin-controls');
  
  // Members panel + admin unlock
  const membersBtn = document.getElementById('members-btn');
  const membersPanel = document.getElementById('members-panel');
  const membersList = document.getElementById('members-list');
  const membersClose = document.getElementById('members-close');
  const adminKeyBtn = document.getElementById('admin-key-btn');
  
  // Reply
  const replyContainer = document.getElementById('reply-container');
  const replyUsername = document.getElementById('reply-username');
  const replyMessage = document.getElementById('reply-message');
  const cancelReplyBtn = document.getElementById('cancel-reply');
  
  // Misc
  const typingIndicator = document.getElementById('typing-indicator');
  const scrollToBottomBtn = document.getElementById('scroll-to-bottom-btn');
  const themeToggle = document.getElementById('theme-toggle');
  
  // App state
  let currentRoom = null;
  let currentType = null;          // 'public' | 'private'
  let currentUsername = null;
  let currentAdminKey = null;      // management key (creator / authenticated admins)
  let pendingAdminKey = null;      // key being verified via authenticateAdmin
  let isAdmin = false;
  let replyingTo = null;
  let messageMap = new Map();
  let roomUsers = [];              // [{ id, username }]
  let isReconnecting = false;
  
  const typingUsers = new Set();
  
  // --- Admin key persistence (convenience; you should also store it yourself) ---
  function storeAdminKey(roomKey, adminKey) {
    try { localStorage.setItem('adminKey:' + roomKey, adminKey); } catch (e) {}
  }
  function getStoredAdminKey(roomKey) {
    try { return localStorage.getItem('adminKey:' + roomKey); } catch (e) { return null; }
  }
  function clearStoredAdminKey(roomKey) {
    try { localStorage.removeItem('adminKey:' + roomKey); } catch (e) {}
  }
  
  // --- Helpers -----------------------------------------------------------------
  
  function loadAdsInPage(page) {
    page.querySelectorAll('ins.adsbygoogle:not([data-ad-loaded])').forEach((ad) => {
      ad.setAttribute('data-ad-loaded', 'true');
      try {
        (adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        console.warn('AdSense load skipped:', e);
      }
    });
  }
  
  function showPage(page) {
    greetingPage.classList.remove('active');
    joinRoomPage.classList.remove('active');
    chatRoomPage.classList.remove('active');
    page.classList.add('active');
    requestAnimationFrame(() => loadAdsInPage(page));
  }
  
  function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  function buildInviteLink() {
    return `${window.location.origin}/?room=${currentRoom}`;
  }
  
  function updateRoomHeader() {
    roomKeyDisplay.textContent = currentType === 'public' ? 'Public' : currentRoom;
  }
  
  function updateAdminUi() {
    adminControls.style.display = isAdmin ? 'block' : 'none';
    if (adminKeyBtn) adminKeyBtn.style.display = isAdmin ? 'none' : 'flex';
  }
  
  // Remove everything in the chat area except the first (static welcome) message
  function clearChatMessages() {
    const children = Array.from(chatMessages.children);
    children.forEach((child, idx) => {
      if (idx === 0) return;
      chatMessages.removeChild(child);
    });
  }
  
  function resetToGreeting() {
    currentRoom = null;
    currentType = null;
    currentUsername = null;
    currentAdminKey = null;
    pendingAdminKey = null;
    isAdmin = false;
    roomUsers = [];
    replyingTo = null;
    messageMap.clear();
    typingUsers.clear();
    typingIndicator.textContent = '';
    replyContainer.classList.remove('active');
    membersPanel.classList.remove('active');
    clearChatMessages();
    showPage(greetingPage);
  }
  
  // Info card shown when you create or join a room (invite link + keys)
  function addRoomInfoCard() {
    const card = document.createElement('div');
    card.classList.add('system-message', 'room-info-card');
  
    const link = buildInviteLink();
    let html = '';
  
    if (currentType === 'private') {
      html += `<div><i class="fas fa-key"></i> Private room key: <strong>${currentRoom}</strong> ` +
        `<button class="btn-icon copy-btn" data-copy="${currentRoom}" title="Copy key"><i class="fas fa-copy"></i></button></div>`;
    } else {
      html += `<div><i class="fas fa-globe"></i> Public room — anyone with the link can join.</div>`;
    }
  
    html += `<div><i class="fas fa-link"></i> Invite link: ` +
      `<button class="btn-icon copy-btn" data-copy="${link}" title="Copy invite link"><i class="fas fa-copy"></i> Copy link</button></div>`;
  
    if (currentAdminKey) {
      html += `<div class="admin-key-warning"><i class="fas fa-shield-halved"></i> Save your management key — it's the only way to remove people or delete this room: ` +
        `<code>${currentAdminKey}</code> ` +
        `<button class="btn-icon copy-btn" data-copy="${currentAdminKey}" title="Copy management key"><i class="fas fa-copy"></i></button></div>`;
    }
  
    card.innerHTML = html;
    chatMessages.appendChild(card);
  
    card.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copy)
          .then(() => {
            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1200);
          })
          .catch((err) => console.error('Copy failed', err));
      });
    });
  }
  
  function renderMembers() {
    membersList.innerHTML = '';
    roomUsers.forEach((u) => {
      const item = document.createElement('div');
      item.classList.add('member-item');
  
      const name = document.createElement('span');
      name.classList.add('member-name');
      name.textContent = u.username + (u.id === socket.id ? ' (you)' : '');
      item.appendChild(name);
  
      if (isAdmin && u.id !== socket.id) {
        const removeBtn = document.createElement('button');
        removeBtn.classList.add('btn-icon', 'member-remove');
        removeBtn.title = 'Remove user';
        removeBtn.innerHTML = '<i class="fas fa-user-slash"></i>';
        removeBtn.addEventListener('click', () => {
          if (confirm(`Remove ${u.username} from the room?`)) {
            socket.emit('removeUser', {
              roomKey: currentRoom,
              adminKey: currentAdminKey,
              targetId: u.id
            });
          }
        });
        item.appendChild(removeBtn);
      }
  
      membersList.appendChild(item);
    });
  }
  
  function addMessage(messageObj, isOwnMessage = false) {
    const { id, username, message, timestamp, replyTo } = messageObj;
    messageMap.set(id, messageObj);
  
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(isOwnMessage ? 'own-message' : 'other-message');
    messageElement.dataset.messageId = id;
  
    const swipeHint = document.createElement('div');
    swipeHint.classList.add('swipe-hint');
    swipeHint.innerHTML = '<i class="fas fa-reply"></i>';
    messageElement.appendChild(swipeHint);
  
    const usernameElement = document.createElement('div');
    usernameElement.classList.add('username');
    usernameElement.textContent = username;
  
    if (replyTo && messageMap.has(replyTo)) {
      const repliedMessage = messageMap.get(replyTo);
      const quoteElement = document.createElement('div');
      quoteElement.classList.add('reply-quote');
  
      const quoteUsername = document.createElement('div');
      quoteUsername.classList.add('reply-quote-username');
      quoteUsername.textContent = repliedMessage.username;
  
      const quoteText = document.createElement('div');
      quoteText.textContent = repliedMessage.message.length > 50
        ? repliedMessage.message.substring(0, 50) + '...'
        : repliedMessage.message;
  
      quoteElement.appendChild(quoteUsername);
      quoteElement.appendChild(quoteText);
      messageElement.appendChild(quoteElement);
    }
  
    messageElement.appendChild(usernameElement);
  
    const contentElement = document.createElement('div');
    contentElement.classList.add('content');
    contentElement.textContent = message;
    messageElement.appendChild(contentElement);
  
    const timestampElement = document.createElement('div');
    timestampElement.classList.add('timestamp');
    timestampElement.textContent = formatTimestamp(timestamp);
    messageElement.appendChild(timestampElement);
  
    chatMessages.appendChild(messageElement);
  
    if (typeof Hammer !== 'undefined') {
      const hammer = new Hammer(messageElement);
      hammer.on('swiperight', function () {
        startReply(id);
      });
    }
  
    messageElement.addEventListener('touchstart', function () {
      this.classList.add('swiping');
    });
    messageElement.addEventListener('touchend', function () {
      this.classList.remove('swiping');
    });
  
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
  }
  
  function startReply(messageId) {
    if (!messageMap.has(messageId)) return;
    const messageObj = messageMap.get(messageId);
    replyingTo = messageId;
    replyContainer.classList.add('active');
    replyUsername.textContent = messageObj.username;
    replyMessage.textContent = messageObj.message.length > 30
      ? messageObj.message.substring(0, 30) + '...'
      : messageObj.message;
    messageInput.focus();
  }
  
  function cancelReply() {
    replyingTo = null;
    replyContainer.classList.remove('active');
  }
  
  function addSystemMessage(message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('system-message');
    messageElement.textContent = message;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
  }
  
  function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentRoom) {
      socket.emit('sendMessage', {
        roomKey: currentRoom,
        message,
        replyTo: replyingTo
      });
      messageInput.value = '';
      messageInput.focus();
      if (replyingTo) cancelReply();
    }
  }
  
  function updateTypingIndicator() {
    const users = Array.from(typingUsers);
    let text = '';
    if (users.length === 1) {
      text = `${users[0]} is typing...`;
    } else if (users.length === 2) {
      text = `${users[0]} and ${users[1]} are typing...`;
    } else if (users.length > 2) {
      text = `${users.length} people are typing...`;
    }
    typingIndicator.textContent = text;
  }
  
  // --- Theme -------------------------------------------------------------------
  
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }
  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
  }
  function updateThemeIcon(theme) {
    if (!themeToggle) return;
    const icon = themeToggle.querySelector('i');
    if (theme === 'dark') {
      icon.classList.remove('fa-moon');
      icon.classList.add('fa-sun');
    } else {
      icon.classList.remove('fa-sun');
      icon.classList.add('fa-moon');
    }
  }
  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
  initTheme();
  
  // --- Event listeners ---------------------------------------------------------
  
  usernameDisplay.addEventListener('blur', () => {
    const newUsername = usernameDisplay.textContent.trim().slice(0, 30);
    if (newUsername && newUsername !== currentUsername) {
      socket.emit('changeUsername', { newUsername });
      currentUsername = newUsername; // optimistic
    } else {
      usernameDisplay.textContent = currentUsername;
    }
  });
  
  usernameDisplay.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      usernameDisplay.blur();
    }
  });
  
  createPublicBtn.addEventListener('click', () => {
    socket.emit('createRoom', { type: 'public' });
  });
  
  createPrivateBtn.addEventListener('click', () => {
    socket.emit('createRoom', { type: 'private' });
  });
  
  joinRoomBtn.addEventListener('click', () => {
    showPage(joinRoomPage);
    roomKeyInput.focus();
  });
  
  joinSubmitBtn.addEventListener('click', () => {
    const roomKey = roomKeyInput.value.trim();
    if (roomKey.length !== 6 || !/^\d+$/.test(roomKey)) {
      joinErrorMessage.textContent = 'Please enter a valid 6-digit room key';
      return;
    }
    socket.emit('joinRoom', { roomKey, adminKey: getStoredAdminKey(roomKey) });
  });
  
  joinBackBtn.addEventListener('click', () => {
    showPage(greetingPage);
    joinErrorMessage.textContent = '';
    roomKeyInput.value = '';
  });
  
  deleteRoomBtn.addEventListener('click', () => {
    if (!currentRoom) return;
    if (confirm('Delete this room for everyone? This cannot be undone.')) {
      socket.emit('deleteRoom', { roomKey: currentRoom, adminKey: currentAdminKey });
    }
  });
  
  cancelReplyBtn.addEventListener('click', cancelReply);
  sendMessageBtn.addEventListener('click', sendMessage);
  
  membersBtn.addEventListener('click', () => {
    membersPanel.classList.toggle('active');
  });
  membersClose.addEventListener('click', () => {
    membersPanel.classList.remove('active');
  });
  
  adminKeyBtn.addEventListener('click', () => {
    const key = prompt('Enter the management key for this room to unlock admin controls:');
    if (key && key.trim()) {
      pendingAdminKey = key.trim();
      socket.emit('authenticateAdmin', { roomKey: currentRoom, adminKey: pendingAdminKey });
    }
  });
  
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    } else if (currentRoom) {
      socket.emit('typing', { roomKey: currentRoom });
    }
  });
  
  let typingTimeout = null;
  messageInput.addEventListener('keyup', () => {
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      if (currentRoom) socket.emit('stopTyping', { roomKey: currentRoom });
    }, 1500);
  });
  
  scrollToBottomBtn.addEventListener('click', () => {
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
  });
  
  chatMessages.addEventListener('scroll', () => {
    const isAtBottom = chatMessages.scrollHeight - chatMessages.clientHeight <= chatMessages.scrollTop + 1;
    scrollToBottomBtn.classList.toggle('visible', !isAtBottom);
  });
  
  // --- Socket.IO handlers ------------------------------------------------------
  
  socket.on('roomCreated', (data) => {
    currentRoom = data.roomKey;
    currentType = data.type;
    currentUsername = data.username;
    currentAdminKey = data.adminKey;
    isAdmin = data.isAdmin;
    roomUsers = [{ id: socket.id, username: currentUsername }];
  
    updateRoomHeader();
    usernameDisplay.textContent = currentUsername;
    userCountDisplay.textContent = data.userCount;
    updateAdminUi();
    storeAdminKey(currentRoom, currentAdminKey);
  
    messageMap.clear();
    showPage(chatRoomPage);
    clearChatMessages();
    addRoomInfoCard();
    renderMembers();
    messageInput.focus();
  });
  
  socket.on('roomJoined', (data) => {
    currentRoom = data.roomKey;
    currentType = data.type;
    currentUsername = data.username;
    isAdmin = data.isAdmin;
    roomUsers = data.users || [];
  
    updateRoomHeader();
    usernameDisplay.textContent = currentUsername;
    userCountDisplay.textContent = data.userCount;
    if (isAdmin) currentAdminKey = pendingAdminKey || getStoredAdminKey(currentRoom);
    updateAdminUi();
  
    if (isReconnecting) {
      isReconnecting = false;
      renderMembers();
      return;
    }
  
    messageMap.clear();
    clearChatMessages();
  
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach((msg) => addMessage(msg, msg.username === currentUsername));
    }
    addRoomInfoCard();
    renderMembers();
  
    showPage(chatRoomPage);
    messageInput.focus();
    joinErrorMessage.textContent = '';
    roomKeyInput.value = '';
  
    // Try to reclaim admin if we have the key stored from before
    if (!isAdmin) {
      const stored = getStoredAdminKey(currentRoom);
      if (stored) {
        pendingAdminKey = stored;
        socket.emit('authenticateAdmin', { roomKey: currentRoom, adminKey: stored });
      }
    }
  });
  
  socket.on('adminAuthenticated', (data) => {
    if (data.success) {
      isAdmin = true;
      currentAdminKey = pendingAdminKey || currentAdminKey;
      if (currentAdminKey) storeAdminKey(currentRoom, currentAdminKey);
      if (data.users) roomUsers = data.users;
      updateAdminUi();
      renderMembers();
      addSystemMessage('Admin controls unlocked.');
    } else {
      alert(data.message || 'Invalid management key');
    }
    pendingAdminKey = null;
  });
  
  socket.on('newMessage', (data) => {
    addMessage(data, data.username === currentUsername);
  });
  
  socket.on('roomUsers', (data) => {
    roomUsers = data.users || [];
    userCountDisplay.textContent = data.userCount;
    renderMembers();
  });
  
  socket.on('userTyping', (data) => {
    if (data.username !== currentUsername) {
      typingUsers.add(data.username);
      updateTypingIndicator();
    }
  });
  
  socket.on('userStopTyping', (data) => {
    typingUsers.delete(data.username);
    updateTypingIndicator();
  });
  
  socket.on('userJoined', (data) => {
    addSystemMessage(`${data.username} has joined the room`);
    userCountDisplay.textContent = data.userCount;
  });
  
  socket.on('userLeft', (data) => {
    addSystemMessage(`${data.username} has left the room`);
    userCountDisplay.textContent = data.userCount;
  });
  
  socket.on('systemMessage', (data) => {
    addSystemMessage(data.message);
  });
  
  socket.on('removedFromRoom', (data) => {
    alert(data.message || 'You have been removed from the room');
    resetToGreeting();
  });
  
  socket.on('roomClosed', (data) => {
    alert(data.message);
    if (currentRoom) clearStoredAdminKey(currentRoom);
    resetToGreeting();
  });
  
  socket.on('error', (data) => {
    if (joinRoomPage.classList.contains('active')) {
      joinErrorMessage.textContent = data.message;
    } else {
      alert(data.message);
    }
  });
  
  // Silent rejoin after a dropped connection (new socket id => re-add to room)
  socket.on('reconnect', () => {
    if (currentRoom) {
      isReconnecting = true;
      socket.emit('joinRoom', {
        roomKey: currentRoom,
        adminKey: currentAdminKey || getStoredAdminKey(currentRoom)
      });
    }
  });
  
  // --- Initialize from URL (public link or private link both work here) --------
  
  const urlParams = new URLSearchParams(window.location.search);
  const roomKeyFromUrl = urlParams.get('room');
  
  if (roomKeyFromUrl) {
    // Strip the param so a refresh doesn't auto-rejoin
    history.replaceState(null, '', window.location.pathname);
    socket.emit('joinRoom', {
      roomKey: roomKeyFromUrl,
      adminKey: getStoredAdminKey(roomKeyFromUrl)
    });
  } else {
    showPage(greetingPage);
  }