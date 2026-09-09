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
  const publicRoomNameInput = document.getElementById('public-room-name');
  const publicRoomsList = document.getElementById('public-rooms-list');
  const createPrivateBtn = document.getElementById('create-private-btn');
  const joinRoomBtn = document.getElementById('join-room-btn');
  
  // Join page
  const joinSubmitBtn = document.getElementById('join-submit-btn');
  const joinBackBtn = document.getElementById('join-back-btn');
  const roomKeyInput = document.getElementById('room-key-input');
  const joinErrorMessage = document.getElementById('join-error-message');
  
  // Chat controls
  const deleteRoomBtn = document.getElementById('delete-room-btn');
  const deleteRoomHeaderBtn = document.getElementById('delete-room-header-btn');
  const leaveRoomBtn = document.getElementById('leave-room-btn');
  const sendMessageBtn = document.getElementById('send-message-btn');
  const messageInput = document.getElementById('message-input');
  const chatMessages = document.getElementById('chat-messages');
  
  const roomKeyDisplay = document.getElementById('room-key-display');
  const roomNameDisplay = document.getElementById('room-name-display');
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
  const publicRoomError = document.getElementById('public-room-error');
  const toastContainer = document.getElementById('toast-container');

  const roomCreatedModal = document.getElementById('room-created-modal');
  const roomCreatedModalTitle = roomCreatedModal ? roomCreatedModal.querySelector('h2') : null;
  const roomCreatedModalText = document.getElementById('room-created-modal-text');
  const createdPinDisplay = document.getElementById('created-pin-display');
  const createdRoomNameLabel = document.getElementById('created-room-name-label');
  const copyCreatedPinBtn = document.getElementById('copy-created-pin-btn');
  const enterCreatedRoomBtn = document.getElementById('enter-created-room-btn');

  const pinModal = document.getElementById('pin-modal');
  const pinModalTitle = document.getElementById('pin-modal-title');
  const pinModalDesc = document.getElementById('pin-modal-desc');
  const pinModalInput = document.getElementById('pin-modal-input');
  const pinModalError = document.getElementById('pin-modal-error');
  const pinModalCancel = document.getElementById('pin-modal-cancel');
  const pinModalConfirm = document.getElementById('pin-modal-confirm');

  const confirmModal = document.getElementById('confirm-modal');
  const confirmModalCancel = document.getElementById('confirm-modal-cancel');
  const confirmModalOk = document.getElementById('confirm-modal-ok');

  const alertModal = document.getElementById('alert-modal');
  const alertModalTitle = document.getElementById('alert-modal-title');
  const alertModalMessage = document.getElementById('alert-modal-message');
  const alertModalOk = document.getElementById('alert-modal-ok');
  
  // App state
  let currentRoom = null;
  let currentRoomName = null;
  let currentType = null;          // 'public' | 'private'
  let currentUsername = null;
  let currentDeleteCode = null;    // 6-digit code to delete the room
  let pendingDeleteCode = null;
  let isAdmin = false;
  let replyingTo = null;
  let messageMap = new Map();
  let roomUsers = [];              // [{ id, username }]
  let isReconnecting = false;
  let pendingRoomEntry = null;
  let pinModalCallback = null;
  let pinModalAllowAnyKey = false;
  let confirmModalCallback = null;
  
  const typingUsers = new Set();

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function showAlert(title, message, onOk) {
    alertModalTitle.textContent = title;
    alertModalMessage.textContent = message;
    alertModal.classList.remove('hidden');
    alertModalOk.onclick = () => {
      alertModal.classList.add('hidden');
      if (onOk) onOk();
    };
  }

  function openPinModal({ title, description, onConfirm, allowAnyKey = false }) {
    pinModalTitle.textContent = title;
    pinModalDesc.textContent = description;
    pinModalInput.value = '';
    pinModalError.classList.add('hidden');
    pinModalAllowAnyKey = allowAnyKey;
    if (allowAnyKey) {
      pinModalInput.maxLength = 64;
      pinModalInput.removeAttribute('inputmode');
      pinModalInput.placeholder = 'Delete PIN or superadmin key';
    } else {
      pinModalInput.maxLength = 6;
      pinModalInput.setAttribute('inputmode', 'numeric');
      pinModalInput.placeholder = '6-digit PIN';
    }
    pinModal.classList.remove('hidden');
    pinModalCallback = onConfirm;
    setTimeout(() => pinModalInput.focus(), 100);
  }

  function closePinModal() {
    pinModal.classList.add('hidden');
    pinModalCallback = null;
  }

  function openConfirmModal({ title, message, onConfirm }) {
    const titleEl = confirmModal.querySelector('h2');
    const messageEl = confirmModal.querySelector('.modal-text');
    if (titleEl) titleEl.innerHTML = title || '<i class="fas fa-triangle-exclamation"></i> Are you sure?';
    if (messageEl) messageEl.textContent = message || 'Please confirm this action.';
    confirmModal.classList.remove('hidden');
    confirmModalCallback = onConfirm;
  }

  function closeConfirmModal() {
    confirmModal.classList.add('hidden');
    confirmModalCallback = null;
  }

  function enterRoomFromPending() {
    if (!pendingRoomEntry) return;
    const data = pendingRoomEntry;
    pendingRoomEntry = null;

    currentRoom = data.roomKey;
    currentRoomName = data.name || null;
    currentType = data.type;
    currentUsername = data.username;
    currentDeleteCode = data.deleteCode;
    isAdmin = data.isAdmin;
    roomUsers = [{ id: socket.id, username: currentUsername }];

    updateRoomHeader();
    usernameDisplay.textContent = currentUsername;
    userCountDisplay.textContent = data.userCount;
    updateAdminUi();
    if (currentDeleteCode) storeDeleteCode(currentRoom, currentDeleteCode);

    messageMap.clear();
    showPage(chatRoomPage);
    clearChatMessages();
    addRoomInfoCard();
    renderMembers();
    messageInput.focus();
  }

  function setButtonLoading(button, loading, defaultHtml) {
    if (!button) return;
    if (loading) {
      button.classList.add('loading');
      button.disabled = true;
      button.dataset.defaultHtml = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Please wait...';
    } else {
      button.classList.remove('loading');
      button.disabled = false;
      button.innerHTML = button.dataset.defaultHtml || defaultHtml;
    }
  }
  
  // --- Delete code persistence (store it — you need it to delete the room) ---
  function storeDeleteCode(roomKey, deleteCode) {
    try { localStorage.setItem('deleteCode:' + roomKey, deleteCode); } catch (e) {}
  }
  function getStoredDeleteCode(roomKey) {
    try { return localStorage.getItem('deleteCode:' + roomKey); } catch (e) { return null; }
  }
  function clearStoredDeleteCode(roomKey) {
    try { localStorage.removeItem('deleteCode:' + roomKey); } catch (e) {}
  }
  
  // --- Helpers -----------------------------------------------------------------
  
  function ensureAdSenseScript() {
    return new Promise((resolve) => {
      if (window.adsbygoogle && window.adsbygoogle.loaded) {
        resolve();
        return;
      }
      const existing = document.querySelector('script[src*="adsbygoogle.js"]');
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => {
          existing.dataset.loaded = 'true';
          resolve();
        });
        return;
      }
      const script = document.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8537594804200864';
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  function loadAdsInPage(page) {
    ensureAdSenseScript().then(() => {
      page.querySelectorAll('ins.adsbygoogle:not([data-ad-loaded])').forEach((ad) => {
        if (ad.getAttribute('data-adsbygoogle-status')) {
          ad.setAttribute('data-ad-loaded', 'true');
          return;
        }
        ad.setAttribute('data-ad-loaded', 'true');
        try {
          (adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {
          console.warn('AdSense load skipped:', e);
        }
      });
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
    if (currentType === 'public') {
      roomNameDisplay.textContent = currentRoomName || 'Public Room';
      roomKeyDisplay.textContent = `ID: ${currentRoom}`;
    } else {
      roomNameDisplay.textContent = 'Private Room';
      roomKeyDisplay.textContent = `Key: ${currentRoom}`;
    }
  }

  async function loadPublicRooms() {
    try {
      const response = await fetch('/api/public-rooms');
      const data = await response.json();
      renderPublicRooms(data.rooms || []);
    } catch (error) {
      console.warn('Could not load public rooms', error);
    }
  }

  function renderPublicRooms(rooms) {
    publicRoomsList.innerHTML = '';

    if (!rooms.length) {
      publicRoomsList.innerHTML = '<p class="public-rooms-empty">No public rooms yet. Create one above.</p>';
      return;
    }

    rooms.forEach((room) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'public-room-item';
      item.innerHTML = `
        <span class="public-room-name">${escapeHtml(room.name)}</span>
        <span class="public-room-meta">${room.userCount} online</span>
      `;
      item.addEventListener('click', () => {
        socket.emit('joinRoom', {
          roomKey: room.roomKey,
          deleteCode: getStoredDeleteCode(room.roomKey),
        });
      });
      publicRoomsList.appendChild(item);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
  
  function updateAdminUi() {
    const isPublic = currentType === 'public';

    if (isPublic) {
      adminControls.style.display = 'none';
      if (adminKeyBtn) adminKeyBtn.style.display = 'none';
      if (deleteRoomHeaderBtn) deleteRoomHeaderBtn.classList.remove('hidden');
      return;
    }

    if (deleteRoomHeaderBtn) deleteRoomHeaderBtn.classList.add('hidden');

    const showDelete = isAdmin;
    adminControls.style.display = showDelete ? 'flex' : 'none';
    if (adminKeyBtn) adminKeyBtn.style.display = isAdmin ? 'none' : 'flex';
    if (deleteRoomBtn) {
      const count = parseInt(userCountDisplay.textContent, 10) || roomUsers.length || 1;
      deleteRoomBtn.disabled = count > 1;
      deleteRoomBtn.title = count > 1
        ? 'Ask everyone else to leave before deleting the room'
        : 'Delete this room';
    }
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
    currentRoomName = null;
    currentType = null;
    currentUsername = null;
    currentDeleteCode = null;
    pendingDeleteCode = null;
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
    loadPublicRooms();
  }
  
  // Info card shown when you create or join a room (invite link + keys)
  function addRoomInfoCard() {
    const card = document.createElement('div');
    card.classList.add('system-message', 'room-info-card');

    const link = buildInviteLink();
    let html = '';

    if (currentType === 'private') {
      html += `<div><i class="fas fa-key"></i> Private room key: <strong>${currentRoom}</strong> ` +
        `<button class="btn-icon copy-btn" data-copy="${currentRoom}" title="Copy key"><i class="fas fa-copy"></i></button></div>` +
        `<div class="admin-key-warning"><i class="fas fa-shield-halved"></i> Only the room admin can delete this room, and only after everyone else has left.</div>`;
    } else {
      html += `<div><i class="fas fa-globe"></i> Public room — anyone with the link can join.</div>`;
      if (currentDeleteCode) {
        html += `<div class="admin-key-warning"><i class="fas fa-shield-halved"></i> Anyone with the delete code can remove this room. The room stays open until then.</div>` +
          `<div><i class="fas fa-shield-halved"></i> Delete code: ` +
          `<code>${currentDeleteCode}</code> ` +
          `<button class="btn-icon copy-btn" data-copy="${currentDeleteCode}" title="Copy delete code"><i class="fas fa-copy"></i></button></div>`;
      }
    }

    html += `<div><i class="fas fa-link"></i> Invite link: ` +
      `<button class="btn-icon copy-btn" data-copy="${link}" title="Copy invite link"><i class="fas fa-copy"></i> Copy link</button></div>`;

    card.innerHTML = html;
    chatMessages.appendChild(card);

    card.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copy)
          .then(() => {
            btn.classList.add('copied');
            showToast('Copied to clipboard', 'success');
            setTimeout(() => btn.classList.remove('copied'), 1200);
          })
          .catch(() => showToast('Could not copy. Please copy manually.', 'error'));
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
  
      if (isAdmin && currentType === 'private' && u.id !== socket.id) {
        const removeBtn = document.createElement('button');
        removeBtn.classList.add('btn-icon', 'member-remove');
        removeBtn.title = 'Remove user';
        removeBtn.innerHTML = '<i class="fas fa-user-slash"></i>';
        removeBtn.addEventListener('click', () => {
          openConfirmModal({
            title: '<i class="fas fa-user-slash"></i> Remove user?',
            message: `Remove ${u.username} from this room?`,
            onConfirm: () => {
              socket.emit('removeUser', {
                roomKey: currentRoom,
                targetId: u.id
              });
            },
          });
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
    const roomName = publicRoomNameInput.value.trim();
    publicRoomError.classList.add('hidden');
    if (!roomName) {
      publicRoomError.textContent = 'Please enter a room name first.';
      publicRoomError.classList.remove('hidden');
      publicRoomNameInput.focus();
      return;
    }
    setButtonLoading(createPublicBtn, true, '<i class="fas fa-globe"></i> Create Public Room');
    socket.emit('createRoom', { type: 'public', name: roomName });
  });

  publicRoomNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createPublicBtn.click();
    }
  });
  
  createPrivateBtn.addEventListener('click', () => {
    setButtonLoading(createPrivateBtn, true, '<i class="fas fa-lock"></i> Create Private Room');
    socket.emit('createRoom', { type: 'private' });
  });
  
  joinRoomBtn.addEventListener('click', () => {
    showPage(joinRoomPage);
    roomKeyInput.focus();
  });
  
  joinSubmitBtn.addEventListener('click', () => {
    const roomKey = roomKeyInput.value.trim();
    if (roomKey.length !== 6 || !/^\d+$/.test(roomKey)) {
      joinErrorMessage.textContent = 'Please enter a valid 6-digit room key.';
      return;
    }
    joinErrorMessage.textContent = '';
    setButtonLoading(joinSubmitBtn, true, '<i class="fas fa-sign-in-alt"></i> Join');
    socket.emit('joinRoom', { roomKey, deleteCode: getStoredDeleteCode(roomKey) });
  });

  roomKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinSubmitBtn.click();
  });
  
  joinBackBtn.addEventListener('click', () => {
    showPage(greetingPage);
    joinErrorMessage.textContent = '';
    roomKeyInput.value = '';
  });

  leaveRoomBtn.addEventListener('click', () => {
    if (!currentRoom) return;
    socket.emit('leaveRoom', { roomKey: currentRoom });
    const rejoinHint = currentType === 'private'
      ? 'You can rejoin with the same key anytime.'
      : '';
    showToast(rejoinHint ? `You left the room. ${rejoinHint}` : 'You left the room', 'success');
    resetToGreeting();
  });

  function handleDeleteRoom() {
    if (!currentRoom) return;

    if (currentType === 'public') {
      openPinModal({
        title: 'Delete room',
        description: 'Enter the room delete PIN, or the superadmin key to delete any public room.',
        allowAnyKey: true,
        onConfirm: (code) => {
          openConfirmModal({
            title: '<i class="fas fa-triangle-exclamation"></i> Delete room?',
            message: 'This removes the room for everyone. This cannot be undone.',
            onConfirm: () => {
              socket.emit('deleteRoom', { roomKey: currentRoom, deleteCode: code });
            },
          });
        },
      });
      return;
    }

    if (!isAdmin) return;
    const count = parseInt(userCountDisplay.textContent, 10) || roomUsers.length;
    if (count > 1) {
      showToast('This room can only be deleted when no one else is in it.', 'error');
      return;
    }
    openConfirmModal({
      title: '<i class="fas fa-triangle-exclamation"></i> Delete room?',
      message: 'You are the last person here. Delete this room permanently?',
      onConfirm: () => {
        socket.emit('deleteRoom', { roomKey: currentRoom });
      },
    });
  }

  deleteRoomBtn.addEventListener('click', handleDeleteRoom);
  if (deleteRoomHeaderBtn) deleteRoomHeaderBtn.addEventListener('click', handleDeleteRoom);

  pinModalCancel.addEventListener('click', closePinModal);
  pinModalConfirm.addEventListener('click', () => {
    const code = pinModalInput.value.trim();
    if (pinModalAllowAnyKey) {
      if (code.length < 4) {
        pinModalError.textContent = 'Enter the room delete PIN or superadmin key.';
        pinModalError.classList.remove('hidden');
        return;
      }
    } else if (!/^\d{6}$/.test(code)) {
      pinModalError.textContent = 'Please enter a valid 6-digit PIN.';
      pinModalError.classList.remove('hidden');
      return;
    }
    pinModalError.classList.add('hidden');
    const cb = pinModalCallback;
    closePinModal();
    if (cb) cb(code);
  });

  pinModalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pinModalConfirm.click();
  });

  confirmModalCancel.addEventListener('click', closeConfirmModal);
  confirmModalOk.addEventListener('click', () => {
    const cb = confirmModalCallback;
    closeConfirmModal();
    if (cb) cb();
  });

  copyCreatedPinBtn.addEventListener('click', () => {
    const pin = createdPinDisplay.textContent;
    const isPrivate = pendingRoomEntry && pendingRoomEntry.type === 'private';
    navigator.clipboard.writeText(pin)
      .then(() => showToast(isPrivate ? 'Room key copied' : 'Delete PIN copied', 'success'))
      .catch(() => showToast('Could not copy', 'error'));
  });

  enterCreatedRoomBtn.addEventListener('click', () => {
    roomCreatedModal.classList.add('hidden');
    enterRoomFromPending();
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
    if (currentType === 'public') return;
    const isPrivate = currentType === 'private';
    openPinModal({
      title: 'Admin access',
      description: isPrivate
        ? 'Enter your 6-digit room key to unlock admin controls.'
        : 'Enter the room delete PIN to unlock admin controls.',
      onConfirm: (code) => {
        pendingDeleteCode = code;
        socket.emit('authenticateAdmin', { roomKey: currentRoom, deleteCode: code });
      },
    });
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
    setButtonLoading(createPublicBtn, false, '<i class="fas fa-globe"></i> Create Public Room');
    setButtonLoading(createPrivateBtn, false, '<i class="fas fa-lock"></i> Create Private Room');
    publicRoomNameInput.value = '';
    storeDeleteCode(data.roomKey, data.deleteCode);

    pendingRoomEntry = data;
    createdPinDisplay.textContent = data.deleteCode;
    createdRoomNameLabel.textContent = data.name || (data.type === 'private' ? 'Private room' : 'Room');

    if (data.type === 'private') {
      if (roomCreatedModalTitle) {
        roomCreatedModalTitle.innerHTML = '<i class="fas fa-check-circle"></i> Private room created!';
      }
      if (roomCreatedModalText) {
        roomCreatedModalText.innerHTML = 'Share this <strong>6-digit room key</strong> so others can join. You are the room admin. The room is removed once everyone has left.';
      }
      if (copyCreatedPinBtn) {
        copyCreatedPinBtn.innerHTML = '<i class="fas fa-copy"></i> Copy key';
      }
      showToast('Room created! Save your room key.', 'success');
    } else {
      if (roomCreatedModalTitle) {
        roomCreatedModalTitle.innerHTML = '<i class="fas fa-check-circle"></i> Room created!';
      }
      if (roomCreatedModalText) {
        roomCreatedModalText.innerHTML = 'Save this <strong>6-digit delete PIN</strong>. Anyone with this PIN can delete the room. Share the invite link so others can join.';
      }
      if (copyCreatedPinBtn) {
        copyCreatedPinBtn.innerHTML = '<i class="fas fa-copy"></i> Copy PIN';
      }
      showToast('Room created! Save your delete PIN.', 'success');
    }

    roomCreatedModal.classList.remove('hidden');
  });

  socket.on('roomJoined', (data) => {
    setButtonLoading(joinSubmitBtn, false, '<i class="fas fa-sign-in-alt"></i> Join');
    currentRoom = data.roomKey;
    currentRoomName = data.name || null;
    currentType = data.type;
    currentUsername = data.username;
    isAdmin = data.isAdmin;
    roomUsers = data.users || [];

    updateRoomHeader();
    usernameDisplay.textContent = currentUsername;
    userCountDisplay.textContent = data.userCount;
    if (isAdmin) currentDeleteCode = pendingDeleteCode || getStoredDeleteCode(currentRoom);
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
    showToast(`Joined ${data.name || 'the room'}`, 'success');
  
    // Try to reclaim admin if we have the key stored from before
    if (!isAdmin && currentType === 'private') {
      const stored = getStoredDeleteCode(currentRoom);
      if (stored) {
        pendingDeleteCode = stored;
        socket.emit('authenticateAdmin', { roomKey: currentRoom, deleteCode: stored });
      }
    }
  });

  socket.on('adminAuthenticated', (data) => {
    if (data.success) {
      isAdmin = true;
      currentDeleteCode = pendingDeleteCode || currentDeleteCode;
      if (currentDeleteCode) storeDeleteCode(currentRoom, currentDeleteCode);
      if (data.users) roomUsers = data.users;
      updateAdminUi();
      renderMembers();
      addSystemMessage('Admin controls unlocked.');
      showToast('Admin controls unlocked', 'success');
    } else {
      showToast(data.message || 'Invalid delete PIN', 'error');
    }
    pendingDeleteCode = null;
  });

  socket.on('promotedToAdmin', (data) => {
    if (currentType === 'public') return;
    isAdmin = true;
    if (data.users) roomUsers = data.users;
    if (data.userCount != null) userCountDisplay.textContent = data.userCount;
    updateAdminUi();
    renderMembers();
    addSystemMessage(data.message || 'You are now the room admin.');
    showToast('You are now the room admin', 'success');
  });

  socket.on('publicRoomsUpdated', (data) => {
    if (greetingPage.classList.contains('active')) {
      renderPublicRooms(data.rooms || []);
    }
  });
  
  socket.on('newMessage', (data) => {
    addMessage(data, data.username === currentUsername);
  });
  
  socket.on('roomUsers', (data) => {
    roomUsers = data.users || [];
    userCountDisplay.textContent = data.userCount;
    renderMembers();
    updateAdminUi();
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
    updateAdminUi();
  });
  
  socket.on('userLeft', (data) => {
    addSystemMessage(`${data.username} has left the room`);
    userCountDisplay.textContent = data.userCount;
    updateAdminUi();
  });
  
  socket.on('systemMessage', (data) => {
    addSystemMessage(data.message);
  });
  
  socket.on('removedFromRoom', (data) => {
    showAlert('Removed from room', data.message || 'You have been removed from the room.', resetToGreeting);
  });
  
  socket.on('roomClosed', (data) => {
    showAlert('Room closed', data.message, () => {
      if (currentRoom) clearStoredDeleteCode(currentRoom);
      resetToGreeting();
    });
  });
  
  socket.on('error', (data) => {
    setButtonLoading(createPublicBtn, false, '<i class="fas fa-globe"></i> Create Public Room');
    setButtonLoading(createPrivateBtn, false, '<i class="fas fa-lock"></i> Create Private Room');
    setButtonLoading(joinSubmitBtn, false, '<i class="fas fa-sign-in-alt"></i> Join');
    if (joinRoomPage.classList.contains('active')) {
      joinErrorMessage.textContent = data.message;
    } else if (publicRoomError && greetingPage.classList.contains('active')) {
      publicRoomError.textContent = data.message;
      publicRoomError.classList.remove('hidden');
    } else {
      showToast(data.message, 'error');
    }
  });
  
  // Silent rejoin after a dropped connection (new socket id => re-add to room)
  socket.on('reconnect', () => {
    if (currentRoom) {
      isReconnecting = true;
      socket.emit('joinRoom', {
        roomKey: currentRoom,
        deleteCode: currentDeleteCode || getStoredDeleteCode(currentRoom)
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
      deleteCode: getStoredDeleteCode(roomKeyFromUrl)
    });
  } else {
    showPage(greetingPage);
    loadPublicRooms();
  }