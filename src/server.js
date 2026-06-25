const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Runtime room state (connected users are always in-memory)
// roomKey -> {
//   type: 'public' | 'private',
//   name: string | null,
//   deleteCode: string,
//   creator: socketId,
//   admins: Set<socketId>,
//   users: Map<socketId, username>,
//   createdAt: Date,
//   lastActivity: Date,
//   emptySince: Date | null,
//   messages: []
// }
const activeRooms = new Map();
const dbEnabled = db.isEnabled();

const PORT = process.env.PORT || 3000;
const SUPERADMIN_KEY = (process.env.SUPERADMIN_KEY || '').toString().trim();

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
  setInterval(() => {
    http.get(RENDER_EXTERNAL_URL, (res) => {
      console.log(`Self-ping status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error(`Self-ping error: ${err.message}`);
    });
  }, 14 * 60 * 1000);
}

const ROOM_INACTIVITY_LIMIT_MS = process.env.ROOM_INACTIVITY_LIMIT_MS
  ? Number(process.env.ROOM_INACTIVITY_LIMIT_MS)
  : null;

async function removeRoomEverywhere(roomKey, room) {
  activeRooms.delete(roomKey);
  if (dbEnabled) {
    await db.deleteRoom(roomKey);
  }
  if (room && room.type === 'public') {
    broadcastPublicRooms();
  }
}

if (ROOM_INACTIVITY_LIMIT_MS) {
  setInterval(async () => {
    const now = Date.now();
    for (const [roomKey, room] of activeRooms.entries()) {
      if (room.type === 'public') continue;
      if (now - new Date(room.lastActivity).getTime() > ROOM_INACTIVITY_LIMIT_MS) {
        io.to(roomKey).emit('roomClosed', { message: 'Room closed due to long inactivity' });
        await removeRoomEverywhere(roomKey, room);
        console.log(`Room removed (inactivity): ${roomKey}`);
      }
    }
  }, 60 * 1000);
}

// In-memory-only fallback when Supabase is not configured
const EMPTY_ROOM_GRACE_MS = process.env.EMPTY_ROOM_GRACE_MS
  ? Number(process.env.EMPTY_ROOM_GRACE_MS)
  : 30 * 60 * 1000;

if (!dbEnabled) {
  setInterval(() => {
    const now = Date.now();
    for (const [roomKey, room] of activeRooms.entries()) {
      if (room.type === 'public' || room.users.size > 0 || !room.emptySince) continue;
      if (now - new Date(room.emptySince).getTime() >= EMPTY_ROOM_GRACE_MS) {
        activeRooms.delete(roomKey);
        console.log(`Room deleted (empty grace expired): ${roomKey}`);
      }
    }
  }, 60 * 1000);
}

async function roomKeyTaken(roomKey) {
  if (activeRooms.has(roomKey)) return true;
  if (dbEnabled) return db.roomExists(roomKey);
  return false;
}

async function generatePublicId() {
  let id;
  do {
    id = crypto.randomBytes(6).toString('hex');
  } while (await roomKeyTaken(id));
  return id;
}

async function generatePrivateKey() {
  let key;
  do {
    key = Math.floor(100000 + Math.random() * 900000).toString();
  } while (await roomKeyTaken(key));
  return key;
}

function generateDeleteCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function hydrateRoom(roomKey) {
  if (activeRooms.has(roomKey)) {
    return activeRooms.get(roomKey);
  }
  if (!dbEnabled) return null;

  const row = await db.getRoom(roomKey);
  if (!row) return null;

  const room = db.rowToRoom(row);
  activeRooms.set(roomKey, room);
  return room;
}

function getPublicRoomsList() {
  const rooms = [];
  for (const [roomKey, room] of activeRooms.entries()) {
    if (room.type === 'public') {
      rooms.push({
        roomKey,
        name: room.name,
        userCount: room.users.size,
        createdAt: room.createdAt,
      });
    }
  }
  return rooms.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function broadcastPublicRooms() {
  io.emit('publicRoomsUpdated', { rooms: getPublicRoomsList() });
}

function schedulePersist(roomKey, room) {
  if (!dbEnabled) return;
  db.persistRoom(roomKey, room).catch((err) => {
    console.error(`Failed to persist room ${roomKey}:`, err.message || err);
  });
}

function removeUserFromRoom(socket, roomKey, room, leaveSocket = true) {
  if (!room.users.has(socket.id)) return;

  const username = room.users.get(socket.id);
  room.users.delete(socket.id);
  room.admins.delete(socket.id);
  if (leaveSocket) socket.leave(roomKey);

  if (room.users.size > 0) {
    socket.to(roomKey).emit('userLeft', {
      username,
      timestamp: new Date(),
      userCount: room.users.size,
    });
    emitUserList(roomKey, room);
  }

  ensureRoomHasAdmin(roomKey, room);
  markRoomEmptyIfNeeded(roomKey, room);
  if (room.type === 'public') {
    broadcastPublicRooms();
  }
  console.log(`User left ${roomKey}: ${username} (${socket.id})`);
}

function pruneStaleAdmins(room) {
  for (const adminId of [...room.admins]) {
    if (!room.users.has(adminId)) {
      room.admins.delete(adminId);
    }
  }
}

function ensureRoomHasAdmin(roomKey, room) {
  if (room.type === 'public') return;
  pruneStaleAdmins(room);
  if (room.users.size === 0 || room.admins.size > 0) return;

  const newAdminId = room.users.keys().next().value;
  room.admins.add(newAdminId);
  room.creator = newAdminId;

  io.to(newAdminId).emit('promotedToAdmin', {
    message: 'You are now the room admin because the previous admin left.',
    users: publicUserList(room),
    userCount: room.users.size,
  });
  emitUserList(roomKey, room);
  console.log(`Promoted ${newAdminId} to admin in ${roomKey}`);
}

function markRoomEmptyIfNeeded(roomKey, room) {
  if (room.users.size > 0) {
    room.emptySince = null;
    schedulePersist(roomKey, room);
    return;
  }
  if (room.type === 'public') return;
  if (room.emptySince) return;

  room.emptySince = new Date();
  schedulePersist(roomKey, room);

  if (dbEnabled) {
    console.log(`Private room empty (kept in database until deleted): ${roomKey}`);
    return;
  }

  const graceMinutes = Math.round(EMPTY_ROOM_GRACE_MS / 60000);
  console.log(`Room empty, scheduled deletion in ${graceMinutes} min: ${roomKey}`);
}

function generateUsername() {
  const adjectives = [
    'Silent', 'Hidden', 'Shadow', 'Secret', 'Masked', 'Mad',
    'Lost', 'Midnight', 'Ghostly', 'Wandering', 'Unknown',
    'Cosmic', 'Nebulous', 'Encrypted', 'Phantom', 'Veiled'
  ];
  const animals = [
    'Raven', 'Wolf', 'Panther', 'Fox', 'Owl', 'Dog',
    'Serpent', 'Falcon', 'Moth', 'Jaguar', 'Lynx'
  ];
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
  return `${randomAdjective}-${randomAnimal}`;
}

function publicUserList(room) {
  return Array.from(room.users.entries()).map(([id, username]) => ({ id, username }));
}

function emitUserList(roomKey, room) {
  io.to(roomKey).emit('roomUsers', {
    users: publicUserList(room),
    userCount: room.users.size
  });
}

function isRoomAdmin(room, socketId) {
  return room.admins.has(socketId);
}

function canDeletePublicRoom(room, deleteCode) {
  const code = (deleteCode || '').toString().trim();
  if (!code) return false;
  if (code === room.deleteCode) return true;
  if (SUPERADMIN_KEY && code === SUPERADMIN_KEY) return true;
  return false;
}

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('createRoom', async (data = {}) => {
    const type = data.type === 'public' ? 'public' : 'private';
    const roomName = (data.name || '').toString().trim().slice(0, 50);

    if (type === 'public' && !roomName) {
      socket.emit('error', { message: 'Please enter a room name before creating' });
      return;
    }

    const roomKey = type === 'public' ? await generatePublicId() : await generatePrivateKey();
    const deleteCode = type === 'private' ? roomKey : generateDeleteCode();
    const username = generateUsername();

    const room = {
      type,
      name: type === 'public' ? roomName : null,
      deleteCode,
      creator: socket.id,
      admins: new Set([socket.id]),
      users: new Map([[socket.id, username]]),
      createdAt: new Date(),
      lastActivity: new Date(),
      emptySince: null,
      messages: []
    };

    activeRooms.set(roomKey, room);

    if (dbEnabled) {
      const saved = await db.insertRoom(roomKey, room);
      if (!saved) {
        activeRooms.delete(roomKey);
        socket.emit('error', { message: 'Failed to create room. Please try again.' });
        return;
      }
    }

    socket.join(roomKey);

    socket.emit('roomCreated', {
      roomKey,
      type,
      name: room.name,
      deleteCode,
      username,
      isAdmin: true,
      userCount: 1
    });

    if (type === 'public') {
      broadcastPublicRooms();
    }

    console.log(`${type} room created: ${roomKey} (${roomName || 'private'}) by ${username} (${socket.id})`);
  });

  socket.on('joinRoom', async (data) => {
    const { roomKey } = data;
    const room = await hydrateRoom(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const username = generateUsername();

    room.users.set(socket.id, username);
    room.lastActivity = new Date();
    room.emptySince = null;
    socket.join(roomKey);
    schedulePersist(roomKey, room);

    const isAdmin = room.admins.has(socket.id);

    socket.emit('roomJoined', {
      roomKey,
      type: room.type,
      name: room.name,
      username,
      isAdmin,
      userCount: room.users.size,
      messages: room.messages,
      users: publicUserList(room)
    });

    socket.to(roomKey).emit('userJoined', {
      username,
      timestamp: new Date(),
      userCount: room.users.size
    });

    emitUserList(roomKey, room);

    if (room.type === 'public') {
      broadcastPublicRooms();
    }

    console.log(`User joined ${room.type} room ${roomKey} as ${username} (${socket.id})`);
  });

  socket.on('leaveRoom', (data) => {
    const { roomKey } = data || {};
    const room = activeRooms.get(roomKey);
    if (!room) return;
    removeUserFromRoom(socket, roomKey, room);
    socket.emit('leftRoom', { roomKey });
  });

  socket.on('authenticateAdmin', (data) => {
    const { roomKey, deleteCode } = data || {};
    const room = activeRooms.get(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (!room.users.has(socket.id)) {
      socket.emit('error', { message: 'Join the room first' });
      return;
    }

    if (deleteCode && deleteCode === room.deleteCode) {
      room.admins.add(socket.id);
      socket.emit('adminAuthenticated', {
        success: true,
        users: publicUserList(room),
        userCount: room.users.size
      });
    } else {
      socket.emit('adminAuthenticated', { success: false, message: 'Invalid delete code' });
    }
  });

  socket.on('changeUsername', (data) => {
    const clean = ((data && data.newUsername) || '').toString().trim().slice(0, 30);
    if (!clean) return;

    for (const [roomKey, room] of activeRooms.entries()) {
      if (room.users.has(socket.id)) {
        room.users.set(socket.id, clean);
        room.lastActivity = new Date();
        emitUserList(roomKey, room);
        return;
      }
    }
  });

  socket.on('sendMessage', (data) => {
    const { roomKey, message, replyTo } = data;

    if (!activeRooms.has(roomKey)) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const room = activeRooms.get(roomKey);
    if (!room.users.has(socket.id)) {
      socket.emit('error', { message: 'You are not in this room' });
      return;
    }

    const username = room.users.get(socket.id);
    const text = (message || '').toString();
    if (!text.trim()) return;

    const messageObj = {
      id: Date.now() + Math.random().toString(36).substr(2, 5),
      username,
      message: text,
      timestamp: new Date(),
      replyTo
    };

    room.messages.push(messageObj);
    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100);
    }
    room.lastActivity = new Date();
    schedulePersist(roomKey, room);

    io.to(roomKey).emit('newMessage', messageObj);
    console.log(`Message in room ${roomKey} from ${username}: ${text}`);
  });

  socket.on('typing', (data) => {
    const { roomKey } = data;
    const room = activeRooms.get(roomKey);
    if (room && room.users.has(socket.id)) {
      const username = room.users.get(socket.id);
      socket.to(roomKey).emit('userTyping', { username });
    }
  });

  socket.on('stopTyping', (data) => {
    const { roomKey } = data;
    const room = activeRooms.get(roomKey);
    if (room && room.users.has(socket.id)) {
      const username = room.users.get(socket.id);
      socket.to(roomKey).emit('userStopTyping', { username });
    }
  });

  socket.on('removeUser', (data) => {
    const { roomKey, targetId } = data || {};
    const room = activeRooms.get(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (room.type === 'private' && !isRoomAdmin(room, socket.id)) {
      socket.emit('error', { message: 'Only a room admin can remove users' });
      return;
    }
    if (!room.users.has(targetId)) {
      socket.emit('error', { message: 'User is not in the room' });
      return;
    }

    const targetUsername = room.users.get(targetId);
    room.users.delete(targetId);
    room.admins.delete(targetId);

    io.to(targetId).emit('removedFromRoom', {
      message: 'You have been removed from the room by an admin'
    });
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.leave(roomKey);

    io.to(roomKey).emit('systemMessage', {
      message: `${targetUsername} was removed by an admin`,
      timestamp: new Date()
    });
    emitUserList(roomKey, room);
    ensureRoomHasAdmin(roomKey, room);
    markRoomEmptyIfNeeded(roomKey, room);
    if (room.type === 'public') {
      broadcastPublicRooms();
    }
    console.log(`User ${targetUsername} removed from ${roomKey}`);
  });

  socket.on('deleteRoom', async (data) => {
    const { roomKey, deleteCode } = data || {};
    const room = await hydrateRoom(roomKey);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.type === 'public') {
      if (!canDeletePublicRoom(room, deleteCode)) {
        socket.emit('error', { message: 'Invalid delete code' });
        return;
      }
      const usedSuperadmin = SUPERADMIN_KEY && deleteCode === SUPERADMIN_KEY;
      io.to(roomKey).emit('roomClosed', { message: 'This room has been deleted' });
      await removeRoomEverywhere(roomKey, room);
      console.log(`Public room deleted: ${roomKey}${usedSuperadmin ? ' (superadmin)' : ''}`);
      return;
    }

    if (!isRoomAdmin(room, socket.id)) {
      socket.emit('error', { message: 'Only a room admin can delete this room' });
      return;
    }
    if (room.users.size > 1) {
      socket.emit('error', {
        message: 'This room can only be deleted when no one else is in it. Ask others to leave first.'
      });
      return;
    }

    io.to(roomKey).emit('roomClosed', { message: 'This room has been deleted' });
    await removeRoomEverywhere(roomKey, room);
    console.log(`Room deleted: ${roomKey}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    for (const [roomKey, room] of activeRooms.entries()) {
      if (room.users.has(socket.id)) {
        removeUserFromRoom(socket, roomKey, room, false);
      }
    }
  });
});

app.get('/api/public-rooms', (req, res) => {
  res.json({ rooms: getPublicRoomsList() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

async function startServer() {
  if (dbEnabled) {
    const rows = await db.loadAllRooms();
    for (const row of rows) {
      activeRooms.set(row.room_key, db.rowToRoom(row));
    }
    console.log(`Loaded ${rows.length} room(s) from Supabase`);
  } else {
    console.warn('Supabase not configured — rooms are in-memory only (lost on restart).');
    console.warn('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable persistence.');
  }

  if (!process.env.VERCEL) {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

if (process.env.VERCEL) {
  module.exports = app;
} else {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app;
