const tmi = require('tmi.js');
const axios = require('axios');
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ── Config Management ──────────────────────────────────────────────────────────

const CONFIG_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (err) {
    log(`Failed to load config.json: ${err.message}`, 'ERROR');
  }

  // Fallback: read from environment variables (.env compat)
  if (process.env.TWITCH_CHANNEL && process.env.TWITCH_CLIENT_ID && process.env.TWITCH_ACCESS_TOKEN && process.env.REDEMPTION_ID) {
    return {
      twitchChannel: process.env.TWITCH_CHANNEL,
      clientId: process.env.TWITCH_CLIENT_ID,
      accessToken: process.env.TWITCH_ACCESS_TOKEN.replace('oauth:', ''),
      broadcasterId: process.env.BROADCASTER_ID || null,
      redemptionId: process.env.REDEMPTION_ID
    };
  }

  return null;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function isConfigured() {
  const config = loadConfig();
  return config && config.twitchChannel && config.clientId && config.accessToken && config.redemptionId;
}

// ── Logger ─────────────────────────────────────────────────────────────────────

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${level}: ${message}`);
}

// ── HTTP Server ────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

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

// ── Setup API Routes ───────────────────────────────────────────────────────────

app.get('/api/config-status', (req, res) => {
  res.json({ configured: isConfigured() });
});

app.post('/api/validate-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const resp = await axios.get('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${token}` }
    });
    res.json({
      login: resp.data.login,
      scopes: resp.data.scopes,
      user_id: resp.data.user_id,
      client_id: resp.data.client_id
    });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.post('/api/rewards', async (req, res) => {
  const { token, clientId, broadcasterId } = req.body;
  if (!token || !clientId || !broadcasterId) {
    return res.status(400).json({ error: 'token, clientId, and broadcasterId required' });
  }

  try {
    const resp = await axios.get(
      `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`,
      {
        headers: {
          'Client-ID': clientId,
          'Authorization': `Bearer ${token}`
        }
      }
    );
    res.json({ rewards: resp.data.data });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.message || err.message });
  }
});

app.post('/api/save-config', async (req, res) => {
  const { twitchChannel, clientId, accessToken, broadcasterId, redemptionId } = req.body;

  if (!twitchChannel || !clientId || !accessToken || !redemptionId) {
    return res.status(400).json({ error: 'Missing required config fields' });
  }

  const config = { twitchChannel, clientId, accessToken, broadcasterId, redemptionId };

  try {
    saveConfig(config);
    log('Config saved successfully', 'SUCCESS');

    // Restart the bot with the new config
    stopBot();
    startBot(config);

    res.json({ success: true });
  } catch (err) {
    log(`Failed to save config: ${err.message}`, 'ERROR');
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// ── Static File Serving ────────────────────────────────────────────────────────

// Setup wizard static files
app.use('/setup', express.static(path.join(__dirname, 'public', 'setup')));

// Root redirect: if not configured, send to setup wizard
app.get('/', (req, res, next) => {
  if (!isConfigured()) {
    return res.redirect('/setup');
  }
  next();
});

// Main public static files (wheel overlay)
app.use(express.static(path.join(__dirname, 'public')));

// ── Bot Lifecycle ──────────────────────────────────────────────────────────────

let tmiClient = null;
let botBroadcasterId = null;

function getCleanToken(config) {
  return config.accessToken.replace('oauth:', '');
}

async function getUserId(config, username) {
  const token = getCleanToken(config);
  try {
    const res = await axios.get(`https://api.twitch.tv/helix/users?login=${username}`, {
      headers: {
        'Client-ID': config.clientId,
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.data.data || res.data.data.length === 0) {
      throw new Error(`User not found: ${username}`);
    }

    return res.data.data[0].id;
  } catch (err) {
    if (err.response?.status === 401) {
      log('Access token expired or invalid. Please re-authorize via /setup.', 'ERROR');
    }
    log(`Failed to get user ID for ${username}: ${err.message}`, 'ERROR');
    throw err;
  }
}

async function timeoutUser(config, broadcasterId, userId, duration, reason) {
  const token = getCleanToken(config);
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
          'Client-ID': config.clientId,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return { success: res.status === 200 };
  } catch (err) {
    const status = err.response?.status;

    if (status === 401) {
      log('Access token expired or invalid. Please re-authorize via /setup.', 'ERROR');
    }

    const cannotTimeout = status === 400;
    if (!cannotTimeout) {
      log(`Failed to timeout user (${status}): ${err.response?.data?.message || err.message}`, 'ERROR');
    }

    return { success: false, cannotTimeout: cannotTimeout };
  }
}

async function checkIfModerator(config, broadcasterId, userId) {
  const token = getCleanToken(config);
  try {
    const res = await axios.get(
      `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${broadcasterId}&user_id=${userId}`,
      {
        headers: {
          'Client-ID': config.clientId,
          'Authorization': `Bearer ${token}`
        }
      }
    );

    return res.data.data.length > 0;
  } catch (err) {
    if (err.response?.status === 401) {
      log('Access token expired or invalid. Please re-authorize via /setup.', 'ERROR');
    }
    log(`Failed to check moderator status: ${err.message}`, 'ERROR');
    return false;
  }
}

async function assignVIP(config, broadcasterId, userId) {
  const token = getCleanToken(config);
  try {
    const res = await axios.post(
      `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}&user_id=${userId}`,
      null,
      {
        headers: {
          'Client-ID': config.clientId,
          'Authorization': `Bearer ${token}`
        }
      }
    );

    return { success: res.status === 204 };
  } catch (err) {
    const status = err.response?.status;

    if (status === 401) {
      log('Access token expired or invalid. Please re-authorize via /setup.', 'ERROR');
    }

    const isAlreadyVIP = status === 422;
    if (!isAlreadyVIP) {
      log(`Failed to assign VIP (${status}): ${err.response?.data?.message || err.message}`, 'ERROR');
    }

    return { success: false, alreadyVIP: isAlreadyVIP };
  }
}

function startBot(config) {
  botBroadcasterId = config.broadcasterId || null;

  tmiClient = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    identity: {
      username: config.twitchChannel,
      password: `oauth:${getCleanToken(config)}`
    },
    channels: [config.twitchChannel]
  });

  tmiClient.connect();

  tmiClient.on('message', async (channel, tags, message, self) => {
    if (self) return;

    if (tags['custom-reward-id'] === config.redemptionId) {
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
        if (!botBroadcasterId) {
          const channelName = config.twitchChannel.replace('#', '');
          botBroadcasterId = await getUserId(config, channelName);
          log(`Broadcaster ID cached: ${botBroadcasterId}`);
        }

        const userId = await getUserId(config, username);

        setTimeout(async () => {
          try {
            const isBroadcaster = userId === botBroadcasterId;
            const isModerator = await checkIfModerator(config, botBroadcasterId, userId);

            if (roll > 90) {
              log(`${displayName} won!`, 'SUCCESS');

              if (isBroadcaster) {
                log(`${displayName} is the broadcaster and cannot be granted VIP.`);
              } else if (isModerator) {
                log(`${displayName} is a moderator - keeping mod status instead of granting VIP.`);
                await tmiClient.say(channel, `aga`);
              } else {
                const result = await assignVIP(config, botBroadcasterId, userId);

                if (result.success) {
                  await tmiClient.say(channel, `aga`);
                } else if (result.alreadyVIP) {
                  await tmiClient.say(channel, `aga`);
                } else {
                  await tmiClient.say(channel, `${displayName} won but couldn't grant VIP.`);
                }
              }
            } else {
              log(`${displayName} lost`);

              if (isBroadcaster) {
                log(`${displayName} is the broadcaster and cannot be timed out.`);
              } else if (isModerator) {
                log(`${displayName} is a moderator and cannot be timed out.`);
              } else {
                const result = await timeoutUser(config, botBroadcasterId, userId, 90, 'Lost the wheel spin');

                if (result.success) {
                  await tmiClient.say(channel, `o7`);
                } else if (result.cannotTimeout) {
                  await tmiClient.say(channel, `o7`);
                } else {
                  await tmiClient.say(channel, `${displayName} lost but couldn't apply timeout.`);
                }
              }
            }
          } catch (err) {
            log(`Error applying wheel result for ${displayName}: ${err.message || err}`, 'ERROR');
            await tmiClient.say(channel, `Something went wrong processing the result for ${displayName}.`).catch(() => {});
          }
        }, 14000);
      } catch (err) {
        log(`Error processing wheel spin for ${displayName}: ${err.message || err}`, 'ERROR');
        await tmiClient.say(channel, `Something went wrong processing the wheel spin for ${displayName}.`).catch(() => {});
      }
    }
  });

  tmiClient.on('connected', (address, port) => {
    log(`Connected to ${address}:${port}`, 'SUCCESS');
    log(`Monitoring channel: ${config.twitchChannel}`);
    log(`Watching for redemptions: "${config.redemptionId}"`);
  });

  tmiClient.on('disconnected', (reason) => {
    log(`Disconnected: ${reason}`, 'ERROR');
  });

  log('Bot started', 'SUCCESS');
}

function stopBot() {
  if (tmiClient) {
    tmiClient.disconnect().catch(() => {});
    tmiClient = null;
    botBroadcasterId = null;
    log('Bot stopped');
  }
}

// ── Startup ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log(`HTTP server running on http://localhost:${PORT}`, 'SUCCESS');

  if (isConfigured()) {
    const config = loadConfig();
    startBot(config);
    log(`Add to OBS as Browser Source: http://localhost:${PORT}`, 'SUCCESS');
  } else {
    log(`Setup wizard available at http://localhost:${PORT}/setup`, 'SUCCESS');
    log('No configuration found. Please complete the setup wizard.');
  }
});

process.on('unhandledRejection', (err) => {
  log(`Unhandled rejection: ${err?.message || err || 'Unknown error'}`, 'ERROR');
  console.error(err);
});
