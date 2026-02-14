# WheelV2 - Twitch Wheel Bot

Twitch wheel bot with OBS overlay. Viewers redeem a channel point reward to spin the wheel - 10% chance for VIP, 90% chance for timeout.

## Quick Start

1. **Download** the latest `WheelV2.exe` from [Releases](https://github.com/mjp509/WheelV2/releases) (no Node.js required)
2. **Run** `WheelV2.exe` — it opens a setup wizard at `http://localhost:3000`
3. **Follow the wizard** to connect your Twitch account and pick a channel point reward
4. **Add a Browser Source** in OBS pointing to `http://localhost:3000` (800x800, 60fps)

That's it — the wheel appears automatically when someone redeems the reward.

## Running from Source

If you prefer running from source instead of the `.exe`:

```bash
npm install
node index.js
```

Then open `http://localhost:3000` and follow the setup wizard.

### Building the `.exe` yourself

```bash
npm install
npm run build
```

This produces `dist/WheelV2.exe`.

## Setup Wizard

The built-in setup wizard at `/setup` walks you through:

1. Creating a Twitch application at [dev.twitch.tv/console](https://dev.twitch.tv/console)
2. Authorizing WheelV2 with your Twitch account (OAuth)
3. Selecting which channel point reward triggers the wheel
4. Saving your config and launching the bot

You can revisit `/setup` at any time to reconfigure.

## OBS Setup

1. Add **Browser Source** in OBS
2. URL: `http://localhost:3000`
3. Width: `800`, Height: `800`, FPS: `60`

## How It Works

- Spins for 14 seconds
- Win (>90): VIP assigned after animation completes
- Lose (≤90): 90 second timeout after animation completes
- Tick sound plays as wheel spins past segments
- W or L sound plays depending on result

## Token Expiration

Twitch tokens expire after ~4 hours. If the bot loses connection, re-run the setup wizard to get a fresh token.

## License

MIT
