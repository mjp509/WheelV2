require('dotenv').config();
const tmi = require('tmi.js');
const axios = require('axios');
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');

// Validate required environment variables
const requiredEnvVars = [
  'TWITCH_BOT_USERNAME',
  'TWITCH_CHANNEL',
  'TWITCH_CLIENT_ID',
  'TWITCH_ACCESS_TOKEN',
  'REDEMPTION_ID'
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

// HTTP server for wheel overlay
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  log('Browser source connected', 'SUCCESS');

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
  options: { debug: false },
  connection: {
    reconnect: true,
    secure: true
  },
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

    return res.data.data[0].id;
  } catch (err) {
    log(`Failed to get user ID for ${username}: ${err.message}`, 'ERROR');
    throw err;
  }
}

async function timeoutUser(broadcasterId, userId, duration, reason) {
  try {
    const res = await axios.post(
      `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`,
      {
        data: {
          user_id: userId,
          duration: duration,
          reason: reason
        }
      },
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${getCleanAccessToken()}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return { success: res.status === 200 };
  } catch (err) {
    log(`Failed to timeout user: ${err.message}`, 'ERROR');
    return { success: false };
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

    return { success: res.status === 204 };
  } catch (err) {
    const isAlreadyVIP = err.response?.status === 409 ||
                         err.response?.data?.message?.toLowerCase().includes('already');

    if (!isAlreadyVIP) {
      log(`Failed to assign VIP: ${err.message}`, 'ERROR');
    }

    return { success: false, alreadyVIP: isAlreadyVIP };
  }
}

client.on('message', async (channel, tags, message, self) => {
  if (self) return;

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

      // Wait for wheel animation to complete (12 seconds) before applying VIP/timeout
      setTimeout(async () => {
        if (roll > 90) {
          log(`${displayName} won!`, 'SUCCESS');
          await assignVIP(broadcasterId, userId);
          client.say(channel, `aga`);
        } else {
          log(`${displayName} lost`);
          await timeoutUser(broadcasterId, userId, 300, 'Lost the wheel spin');
          client.say(channel, `o7`);
        }
      }, 12000);
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
