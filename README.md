# The Pumping Hyena 🦁💪

A wild party drinking game! Turn-based multiplayer card game with timers and challenges.

## Features

- 🎮 **Turn-based gameplay** - Players take turns drawing cards
- 🎯 **Party challenges** - Fun drinking game cards with various challenges
- ⏱️ **Timed challenges** - Some cards have countdown timers
- 🌐 **Multiplayer** - Play with friends on the same WiFi or online
- 📱 **Mobile-friendly** - Works great on phones and tablets
- 🔒 **Secure** - Input validation, rate limiting, and XSS protection

## How to Play

1. One player creates a new game and shares the room code
2. Other players join using the room code
3. Players take turns drawing cards
4. Follow the card instructions
5. Fail a challenge? Take a shot! 🍻

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Security**: Helmet, CORS, Rate Limiting, Input Validation

## Local Development

```bash
# Install dependencies
npm install

# Start the server
npm start

# Server runs on http://localhost:8000
```

## Deployment

This app is ready to deploy to:
- Railway.app (recommended)
- Render.com
- Fly.io
- Any Node.js hosting platform

## Environment Variables

- `PORT` - Server port (default: 8000)
- `ALLOWED_ORIGIN` - CORS allowed origin (default: *)

## License

MIT

## Disclaimer

Drink responsibly! This game is intended for adults 21+ only.
