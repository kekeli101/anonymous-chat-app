// Connect to Socket.IO server
const socket = io();

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
const adminControls = document.getElementById('admin-controls');

// App state
let currentRoom = null;
let currentUsername = null;
let isAdmin = false;

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

function addMessage(username, message, timestamp, isOwnMessage = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(isOwnMessage ? 'own-message' : 'other-message');
    
    const usernameElement = document.createElement('div');
    usernameElement.classList.add('username');
    usernameElement.textContent = username;
    
    const contentElement = document.createElement('div');
    contentElement.classList.add('content');
    contentElement.textContent = message;
    
    const timestampElement = document.createElement('div');
    timestampElement.classList.add('timestamp');
    timestampElement.textContent = formatTimestamp(timestamp);
    
    messageElement.appendChild(usernameElement);
    messageElement.appendChild(contentElement);
    messageElement.appendChild(timestampElement);
    
    chatMessages.appendChild(messageElement);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
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
            message
        });
        
        messageInput.value = '';
        messageInput.focus();
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
    
    // Show admin controls if user is admin
    adminControls.style.display = isAdmin ? 'block' : 'none';
    
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
    
    // Show admin controls if user is admin
    adminControls.style.display = isAdmin ? 'block' : 'none';
    
    showPage(chatRoomPage);
    messageInput.focus();
    
    // Clear join room form
    joinErrorMessage.textContent = '';
    roomKeyInput.value = '';
});

socket.on('newMessage', (data) => {
    const isOwnMessage = data.username === currentUsername;
    addMessage(data.username, data.message, data.timestamp, isOwnMessage);
});

socket.on('userJoined', (data) => {
    addSystemMessage(`${data.username} has joined the room`);
});

socket.on('userLeft', (data) => {
    addSystemMessage(`${data.username} has left the room`);
});

socket.on('roomClosed', (data) => {
    alert(data.message);
    showPage(greetingPage);
    
    // Reset state
    currentRoom = null;
    currentUsername = null;
    isAdmin = false;
    
    // Clear chat messages
    while (chatMessages.firstChild) {
        chatMessages.removeChild(chatMessages.firstChild);
    }
    
    // Add welcome message back
    const welcomeMessage = document.createElement('div');
    welcomeMessage.classList.add('welcome-message');
    welcomeMessage.innerHTML = `
        <p>Welcome to the chat room! You can now start chatting anonymously.</p>
        <p class="room-key-info">Room Key: <span id="room-key-info"></span> <button id="copy-room-key" class="btn-icon"><i class="fas fa-copy"></i></button></p>
    `;
    chatMessages.appendChild(welcomeMessage);
    
    // Update room key info reference
    document.getElementById('room-key-info').id = 'room-key-info';
    document.getElementById('copy-room-key').id = 'copy-room-key';
    
    // Reattach event listener
    document.getElementById('copy-room-key').addEventListener('click', () => {
        navigator.clipboard.writeText(currentRoom)
            .then(() => {
                alert('Room key copied to clipboard!');
            })
            .catch(err => {
                console.error('Could not copy text: ', err);
            });
    });
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
