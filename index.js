require('dotenv').config();
const tmi = require('tmi.js');
const axios = require('axios');
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');

// Validate required environment variables
const requiredEnvVars = [
  'TWITCH_CHANNEL',
  'TWITCH_CLIENT_ID',
  'TWITCH_ACCESS_TOKEN',
  'REDEMPTION_ID'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Logger with timestamps
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${level}: ${message}`);
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
    username: process.env.TWITCH_CHANNEL,
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
    const status = err.response?.status;
    const message = err.response?.data?.message?.toLowerCase() || '';

    // 400 = Bad Request (user cannot be banned - VIP, mod, broadcaster, or already banned)
    const cannotTimeout = status === 400;

    if (!cannotTimeout) {
      log(`Failed to timeout user (${status}): ${err.response?.data?.message || err.message}`, 'ERROR');
    }

    return { success: false, cannotTimeout: cannotTimeout };
  }
}

async function checkIfModerator(broadcasterId, userId) {
  try {
    const res = await axios.get(
      `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${broadcasterId}&user_id=${userId}`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${getCleanAccessToken()}`
        }
      }
    );

    return res.data.data.length > 0;
  } catch (err) {
    log(`Failed to check moderator status: ${err.message}`, 'ERROR');
    return false;
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
    const status = err.response?.status;

    // 422 = Unprocessable Entity (user is already a VIP)
    const isAlreadyVIP = status === 422;

    if (!isAlreadyVIP) {
      log(`Failed to assign VIP (${status}): ${err.response?.data?.message || err.message}`, 'ERROR');
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

      // Wait for wheel animation to complete (14 seconds) before applying VIP/timeout
      setTimeout(async () => {
        try {
          // Check if user is the broadcaster or a moderator
          const isBroadcaster = userId === broadcasterId;
          const isModerator = await checkIfModerator(broadcasterId, userId);

          if (roll > 90) {
            log(`${displayName} won!`, 'SUCCESS');

            if (isBroadcaster) {
              log(`${displayName} is the broadcaster and cannot be granted VIP.`);
            } else if (isModerator) {
              log(`${displayName} is a moderator - keeping mod status instead of granting VIP.`);
              await client.say(channel, `aga`);
            } else {
              const result = await assignVIP(broadcasterId, userId);

              if (result.success) {
                await client.say(channel, `aga`);
              } else if (result.alreadyVIP) {
                await client.say(channel, `${displayName} is already VIP! Lucky escape.`);
              } else {
                await client.say(channel, `${displayName} won but couldn't grant VIP.`);
              }
            }
          } else {
            log(`${displayName} lost`);

            if (isBroadcaster) {
              log(`${displayName} is the broadcaster and cannot be timed out.`);
            } else if (isModerator) {
              log(`${displayName} is a moderator and cannot be timed out.`);
              await client.say(channel, `o7`);
            } else {
              const result = await timeoutUser(broadcasterId, userId, 90, 'Lost the wheel spin');

              if (result.success) {
                await client.say(channel, `o7`);
              } else if (result.cannotTimeout) {
                await client.say(channel, `o7`);
              } else {
                await client.say(channel, `${displayName} lost but couldn't apply timeout.`);
              }
            }
          }
        } catch (err) {
          log(`Error applying wheel result for ${displayName}: ${err.message || err}`, 'ERROR');
          await client.say(channel, `Something went wrong processing the result for ${displayName}.`).catch(() => {});
        }
      }, 14000);
    } catch (err) {
      log(`Error processing wheel spin for ${displayName}: ${err.message || err}`, 'ERROR');
      await client.say(channel, `Something went wrong processing the wheel spin for ${displayName}.`).catch(() => {});
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
  log(`Unhandled rejection: ${err?.message || err || 'Unknown error'}`, 'ERROR');
  console.error(err);
});
