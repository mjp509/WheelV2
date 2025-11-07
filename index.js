require('dotenv').config();
const tmi = require('tmi.js');
const axios = require('axios');
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');
const OBSWebSocket = require('obs-websocket-js').default;

// Validate required environment variables
const requiredEnvVars = [
  'TWITCH_BOT_USERNAME',
  'TWITCH_CHANNEL',
  'TWITCH_CLIENT_ID',
  'TWITCH_ACCESS_TOKEN',
  'REDEMPTION_ID',
  'OBS_PASSWORD'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Logger with timestamps
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const emoji = level === 'ERROR' ? '❌' : level === 'SUCCESS' ? '✅' : 'ℹ️';
  console.log(`[${timestamp}] ${emoji} ${level}: ${message}`);
}

// OBS WebSocket connection
const obs = new OBSWebSocket();
let obsConnected = false;
let obsReconnectAttempts = 0;
const MAX_OBS_RECONNECT_ATTEMPTS = 5;
const OBS_RECONNECT_DELAY = 5000;

async function connectOBS() {
  try {
    log('Attempting to connect to OBS WebSocket...');

    await obs.connect('ws://localhost:4455', process.env.OBS_PASSWORD, {
      rpcVersion: 1
    });

    obsConnected = true;
    obsReconnectAttempts = 0;
    log('Connected to OBS WebSocket', 'SUCCESS');
  } catch (err) {
    obsConnected = false;
    log(`OBS connection failed: ${err.message}`, 'ERROR');

    if (obsReconnectAttempts < MAX_OBS_RECONNECT_ATTEMPTS) {
      obsReconnectAttempts++;
      const delay = OBS_RECONNECT_DELAY * obsReconnectAttempts;
      log(`Retrying OBS connection in ${delay / 1000} seconds (attempt ${obsReconnectAttempts}/${MAX_OBS_RECONNECT_ATTEMPTS})...`);

      setTimeout(connectOBS, delay);
    } else {
      log(`Max OBS reconnection attempts reached. Please check OBS WebSocket settings.`, 'ERROR');
      log(`Make sure OBS is running and WebSocket server is enabled (Tools > WebSocket Server Settings)`, 'ERROR');
    }
  }
}

// Handle OBS disconnection
obs.on('ConnectionClosed', () => {
  obsConnected = false;
  log('OBS connection closed', 'ERROR');
  obsReconnectAttempts = 0;
  setTimeout(connectOBS, OBS_RECONNECT_DELAY);
});

obs.on('ConnectionError', (err) => {
  obsConnected = false;
  log(`OBS connection error: ${err.message}`, 'ERROR');
});

obs.on('Identified', () => {
  log('OBS WebSocket identified successfully', 'SUCCESS');
});

connectOBS();

// HTTP server for wheel overlay
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  log('WebSocket client connected (likely OBS browser source)', 'SUCCESS');

  ws.on('close', () => {
    log('WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    log(`WebSocket error: ${error.message}`, 'ERROR');
  });
});

function broadcastToClients(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log(`HTTP server running on http://localhost:${PORT}`, 'SUCCESS');
  log(`Add to OBS as Browser Source: http://localhost:${PORT}`, 'SUCCESS');
});

const client = new tmi.Client({
  identity: {
    username: process.env.TWITCH_BOT_USERNAME,
    password: process.env.TWITCH_ACCESS_TOKEN
  },
  channels: [process.env.TWITCH_CHANNEL]
});

let broadcasterId = null;

client.connect();

function getCleanAccessToken() {
  return process.env.TWITCH_ACCESS_TOKEN.replace('oauth:', '');
}

async function getUserId(username) {
  try {
    const res = await axios.get(`https://api.twitch.tv/helix/users?login=${username}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${getCleanAccessToken()}`
      }
    });

    if (!res.data.data || res.data.data.length === 0) {
      throw new Error(`User not found: ${username}`);
    }

    const userId = res.data.data[0].id;
    log(`Retrieved user ID for ${username}: ${userId}`);
    return userId;
  } catch (err) {
    log(`Failed to get user ID for ${username}: ${err.message}`, 'ERROR');
    throw err;
  }
}

async function assignVIP(broadcasterId, userId) {
  try {
    const res = await axios.post(
      `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}&user_id=${userId}`,
      null,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${getCleanAccessToken()}`
        }
      }
    );

    if (res.status === 204) {
      log(`Successfully assigned VIP to user ID: ${userId}`, 'SUCCESS');
      return { success: true };
    }
    return { success: false };
  } catch (err) {
    log(`Failed to assign VIP to user ID ${userId}: ${err.message}`, 'ERROR');
    if (err.response) {
      log(`API Response: ${JSON.stringify(err.response.data)}`, 'ERROR');

      if (err.response.status === 409 ||
          (err.response.data && err.response.data.message &&
           err.response.data.message.toLowerCase().includes('already'))) {
        log(`User ${userId} is already a VIP`, 'INFO');
        return { success: false, alreadyVIP: true };
      }
    }
    return { success: false, alreadyVIP: false };
  }
}

client.on('message', async (channel, tags, message, self) => {
  if (self) return;

  console.log(message, tags['custom-reward-id'], tags['custom-reward-title']);

  if (tags['custom-reward-id'] === process.env.REDEMPTION_ID) {
    const displayName = tags['display-name'];
    const username = tags.username;
    const roll = Math.floor(Math.random() * 100) + 1;

    log(`${displayName} spun the wheel and rolled ${roll}`);

    broadcastToClients({
      type: 'spin',
      username: displayName,
      roll: roll,
      isWin: roll > 90
    });

    try {
      if (!broadcasterId) {
        const channelName = process.env.TWITCH_CHANNEL.replace("#", "");
        broadcasterId = await getUserId(channelName);
        log(`Broadcaster ID cached: ${broadcasterId}`);
      }

      const userId = await getUserId(username);

      if (roll > 90) {
        log(`${displayName} won! Attempting to assign VIP...`);
        const result = await assignVIP(broadcasterId, userId);

        setTimeout(() => {
          if (result.success) {
            client.say(channel, `aga`);
          } else if (result.alreadyVIP) {
            client.say(channel, `aga`);
          } else {
            client.say(channel, `aga`);
          }
        }, 12000);
      } else {
        log(`${displayName} lost. Timing out for 300 seconds.`);
        client.say(channel, `/timeout ${username} 300`);
        setTimeout(() => {
          client.say(channel, `o7`);
        }, 12000);
      }
    } catch (err) {
      log(`Error processing wheel spin for ${displayName}: ${err.message}`, 'ERROR');
      client.say(channel, `Something went wrong processing the wheel spin for ${displayName}.`);
    }
  }
});

client.on('connected', (address, port) => {
  log(`Connected to ${address}:${port}`, 'SUCCESS');
  log(`Monitoring channel: ${process.env.TWITCH_CHANNEL}`);
  log(`Watching for redemptions: "${process.env.REDEMPTION_ID}"`);
});

client.on('disconnected', (reason) => {
  log(`Disconnected: ${reason}`, 'ERROR');
});

process.on('unhandledRejection', (err) => {
  log(`Unhandled rejection: ${err.message}`, 'ERROR');
  console.error(err);
});
