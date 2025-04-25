// Connect to Socket.IO server
const socket = io({
  transports: ['websocket', 'polling']
});

// DOM Elements
const greetingPage = document.getElementById('greeting-page');
const joinRoomPage = document.getElementById('join-room-page');
const chatRoomPage = document.getElementById('chat-room-page');

const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const joinSubmitBtn = document.getElementById('join-submit-btn');
const joinBackBtn = document.getElementById('join-back-btn');
const closeRoomBtn = document.getElementById('close-room-btn');
const sendMessageBtn = document.getElementById('send-message-btn');
const copyRoomKeyBtn = document.getElementById('copy-room-key');

const roomKeyInput = document.getElementById('room-key-input');
const messageInput = document.getElementById('message-input');
const chatMessages = document.getElementById('chat-messages');
const joinErrorMessage = document.getElementById('join-error-message');

const roomKeyDisplay = document.getElementById('room-key-display');
const roomKeyInfo = document.getElementById('room-key-info');
const usernameDisplay = document.getElementById('username-display');
const userCountDisplay = document.getElementById('user-count-display');
const adminControls = document.getElementById('admin-controls');

const replyContainer = document.getElementById('reply-container');
const replyUsername = document.getElementById('reply-username');
const replyMessage = document.getElementById('reply-message');
const cancelReplyBtn = document.getElementById('cancel-reply');

// App state
let currentRoom = null;
let currentUsername = null;
let isAdmin = false;
let replyingTo = null;
let messageMap = new Map(); // Store messages by ID for reply functionality

// Helper functions
function showPage(page) {
    // Hide all pages
    greetingPage.classList.remove('active');
    joinRoomPage.classList.remove('active');
    chatRoomPage.classList.remove('active');
    
    // Show the selected page
    page.classList.add('active');
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function addMessage(messageObj, isOwnMessage = false) {
    const { id, username, message, timestamp, replyTo } = messageObj;
    
    // Store message in map for reply functionality
    messageMap.set(id, messageObj);
    
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(isOwnMessage ? 'own-message' : 'other-message');
    messageElement.dataset.messageId = id;
    
    // Add swipe hint icon
    const swipeHint = document.createElement('div');
    swipeHint.classList.add('swipe-hint');
    swipeHint.innerHTML = '<i class="fas fa-reply"></i>';
    messageElement.appendChild(swipeHint);
    
    const usernameElement = document.createElement('div');
    usernameElement.classList.add('username');
    usernameElement.textContent = username;
    
    // If this is a reply to another message, add the quote
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
    
    // Set up Hammer.js for swipe gestures
    const hammer = new Hammer(messageElement);
    hammer.on('swiperight', function(e) {
        startReply(id);
    });
    
    // Also detect touch start/end for visual feedback
    messageElement.addEventListener('touchstart', function() {
        this.classList.add('swiping');
    });
    
    messageElement.addEventListener('touchend', function() {
        this.classList.remove('swiping');
    });
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function startReply(messageId) {
    if (!messageMap.has(messageId)) return;
    
    const messageObj = messageMap.get(messageId);
    replyingTo = messageId;
    
    // Show reply container
    replyContainer.classList.add('active');
    replyUsername.textContent = messageObj.username;
    replyMessage.textContent = messageObj.message.length > 30 
        ? messageObj.message.substring(0, 30) + '...' 
        : messageObj.message;
    
    // Focus input
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
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Event listeners
createRoomBtn.addEventListener('click', () => {
    socket.emit('createRoom');
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
    
    socket.emit('joinRoom', { roomKey });
});

joinBackBtn.addEventListener('click', () => {
    showPage(greetingPage);
    joinErrorMessage.textContent = '';
    roomKeyInput.value = '';
});

closeRoomBtn.addEventListener('click', () => {
    if (currentRoom) {
        if (confirm('Are you sure you want to close this room? All users will be disconnected.')) {
            socket.emit('closeRoom', { roomKey: currentRoom });
        }
    }
});

cancelReplyBtn.addEventListener('click', () => {
    cancelReply();
});

sendMessageBtn.addEventListener('click', () => {
    sendMessage();
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

copyRoomKeyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoom)
        .then(() => {
            alert('Room key copied to clipboard!');
        })
        .catch(err => {
            console.error('Could not copy text: ', err);
        });
});

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
        
        // Clear reply state
        if (replyingTo) {
            cancelReply();
        }
    }
}

// Socket.IO event handlers
socket.on('roomCreated', (data) => {
    currentRoom = data.roomKey;
    currentUsername = data.username;
    isAdmin = data.isAdmin;
    
    roomKeyDisplay.textContent = currentRoom;
    roomKeyInfo.textContent = currentRoom;
    usernameDisplay.textContent = currentUsername;
    userCountDisplay.textContent = data.userCount;
    
    // Show admin controls if user is admin
    adminControls.style.display = isAdmin ? 'block' : 'none';
    
    // Reset message map
    messageMap.clear();
    
    showPage(chatRoomPage);
    messageInput.focus();
});

socket.on('roomJoined', (data) => {
    currentRoom = data.roomKey;
    currentUsername = data.username;
    isAdmin = data.isAdmin;
    
    roomKeyDisplay.textContent = currentRoom;
    roomKeyInfo.textContent = currentRoom;
    usernameDisplay.textContent = currentUsername;
    userCountDisplay.textContent = data.userCount;
    
    // Show admin controls if user is admin
    adminControls.style.display = isAdmin ? 'block' : 'none';
    
    // Reset message map
    messageMap.clear();
    
    // Load existing messages if any
    if (data.messages && data.messages.length > 0) {
        // Clear existing messages
        while (chatMessages.firstChild) {
            if (chatMessages.firstChild.classList && chatMessages.firstChild.classList.contains('welcome-message')) {
                break;
            }
            chatMessages.removeChild(chatMessages.firstChild);
        }
        
        // Add messages
        data.messages.forEach(msg => {
            const isOwnMessage = msg.username === currentUsername;
            addMessage(msg, isOwnMessage);
        });
    }
    
    showPage(chatRoomPage);
    messageInput.focus();
    
    // Clear join room form
    joinErrorMessage.textContent = '';
    roomKeyInput.value = '';
});

socket.on('newMessage', (data) => {
    const isOwnMessage = data.username === currentUsername;
    addMessage(data, isOwnMessage);
});

socket.on('userJoined', (data) => {
    addSystemMessage(`${data.username} has joined the room`);
    userCountDisplay.textContent = data.userCount;
});

socket.on('userLeft', (data) => {
    addSystemMessage(`${data.username} has left the room`);
    userCountDisplay.textContent = data.userCount;
});

socket.on('roomClosed', (data) => {
    alert(data.message);
    showPage(greetingPage);
    
    // Reset state
    currentRoom = null;
    currentUsername = null;
    isAdmin = false;
    messageMap.clear();
    
    // Clear chat messages
    while (chatMessages.firstChild) {
        if (chatMessages.firstChild.classList && chatMessages.firstChild.classList.contains('welcome-message')) {
            break;
        }
        chatMessages.removeChild(chatMessages.firstChild);
    }
});

socket.on('error', (data) => {
    if (joinRoomPage.classList.contains('active')) {
        joinErrorMessage.textContent = data.message;
    } else {
        alert(data.message);
    }
});

// Initialize
showPage(greetingPage);
