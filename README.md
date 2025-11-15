# WheelV2 - Twitch Wheel Bot

Twitch wheel bot with OBS overlay. Viewers redeem a channel point reward to spin the wheel - 10% chance for VIP, 90% chance for timeout.

## Setup

1. **Install dependencies**
```bash
npm install
```

2. **Configure `.env`**

Copy `.env.example` to `.env` and fill in:

- `TWITCH_CHANNEL` - Your channel name
- `TWITCH_CLIENT_ID` - Get from [Twitch Dev Console](https://dev.twitch.tv/console)
- `TWITCH_ACCESS_TOKEN` - Generate at [Twitch Token Generator](https://twitchtokengenerator.com/) with scopes: `chat:read`, `chat:edit`, `channel:manage:vips`, `moderator:manage:banned_users`
- `REDEMPTION_ID` - Find yours at https://www.instafluff.tv/TwitchCustomRewardID/?channel=YOURTWITCHCHANNEL

3. **Add assets to `public/assets/`**

Required:
- `Lose.webp` - Wheel background
- `Win.png` - VIP section image
- `Pointer.png` - Center pointer
- `w_Brian.wav` - Win sound
- `L_Brian.wav` - Lose sound

4. **Run the bot**
```bash
node index.js
```

## OBS Setup

1. Add **Browser Source** in OBS
2. URL: `http://localhost:3000`
3. Width: `800`, Height: `800`, FPS: `60`

The wheel appears automatically when someone redeems the reward.

## How It Works

- Spins for 14 seconds
- Win (>90): VIP assigned after animation completes
- Lose (≤90): 90 second timeout after animation completes
- Tick sound plays as wheel spins past segments
- W or L sound plays depending on result

## License

MIT
