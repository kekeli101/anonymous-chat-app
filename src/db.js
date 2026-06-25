const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client = null;

function isEnabled() {
  return Boolean(supabaseUrl && supabaseKey);
}

function getClient() {
  if (!isEnabled()) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

function rowToRoom(row) {
  return {
    type: row.type,
    name: row.name,
    deleteCode: row.delete_code,
    creator: null,
    admins: new Set(),
    users: new Map(),
    createdAt: new Date(row.created_at),
    lastActivity: new Date(row.last_activity),
    emptySince: row.empty_since ? new Date(row.empty_since) : null,
    messages: Array.isArray(row.messages) ? row.messages : [],
  };
}

function roomToRow(roomKey, room) {
  return {
    room_key: roomKey,
    type: room.type,
    name: room.name,
    delete_code: room.deleteCode,
    messages: room.messages,
    created_at: room.createdAt.toISOString(),
    last_activity: room.lastActivity.toISOString(),
    empty_since: room.emptySince ? room.emptySince.toISOString() : null,
  };
}

async function loadAllRooms() {
  const supabase = getClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load rooms from Supabase:', error.message);
    return [];
  }

  return data || [];
}

async function getRoom(roomKey) {
  const supabase = getClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('room_key', roomKey)
    .maybeSingle();

  if (error) {
    console.error(`Failed to load room ${roomKey}:`, error.message);
    return null;
  }

  return data;
}

async function roomExists(roomKey) {
  const supabase = getClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('rooms')
    .select('room_key')
    .eq('room_key', roomKey)
    .maybeSingle();

  if (error) {
    console.error(`Failed to check room ${roomKey}:`, error.message);
    return false;
  }

  return Boolean(data);
}

async function insertRoom(roomKey, room) {
  const supabase = getClient();
  if (!supabase) return false;

  const { error } = await supabase.from('rooms').insert(roomToRow(roomKey, room));

  if (error) {
    console.error(`Failed to insert room ${roomKey}:`, error.message);
    return false;
  }

  return true;
}

async function updateRoom(roomKey, room) {
  const supabase = getClient();
  if (!supabase) return false;

  const payload = roomToRow(roomKey, room);
  delete payload.room_key;
  delete payload.created_at;

  const { error } = await supabase.from('rooms').update(payload).eq('room_key', roomKey);

  if (error) {
    console.error(`Failed to update room ${roomKey}:`, error.message);
    return false;
  }

  return true;
}

async function deleteRoom(roomKey) {
  const supabase = getClient();
  if (!supabase) return false;

  const { error } = await supabase.from('rooms').delete().eq('room_key', roomKey);

  if (error) {
    console.error(`Failed to delete room ${roomKey}:`, error.message);
    return false;
  }

  return true;
}

async function persistRoom(roomKey, room) {
  return updateRoom(roomKey, room);
}

module.exports = {
  isEnabled,
  rowToRoom,
  loadAllRooms,
  getRoom,
  roomExists,
  insertRoom,
  updateRoom,
  deleteRoom,
  persistRoom,
};
