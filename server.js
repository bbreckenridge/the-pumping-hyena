const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const validator = require('validator');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 8000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts for now
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*', // Set to your domain in production
    credentials: true
}));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2000, // limit each IP to 2000 requests per windowMs
    message: 'Too many requests, please try again later.'
});

app.use('/api/', apiLimiter);

// Game State
const games = {};

// Serve static files
app.use(express.static(__dirname));
app.use(express.json());

// API Endpoints
app.post('/api/create_game', (req, res) => {
    // Generate safe room code (no I, 1, O, 0, 8, B)
    const chars = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679';
    let roomCode = '';
    for (let i = 0; i < 6; i++) {
        roomCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Ensure uniqueness (though collision is unlikely)
    while (games[roomCode]) {
        roomCode = '';
        for (let i = 0; i < 6; i++) {
            roomCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }
    games[roomCode] = {
        players: [],
        deck: generateDeck(),
        discard: [],
        timers: [],
        logs: ['Welcome to The Pumping Hyena!', 'A wild party drinking game awaits!'],
        lastCard: null,
        currentPlayerIndex: 0,
        lastActivity: Date.now(),
        stats: {}, // Player stats: { playerName: { cardsDrawn, shots, timersCompleted } }
        gameOver: false
    };
    console.log(`Created game: ${roomCode}`);
    res.json({ room_code: roomCode });
});

app.post('/api/join_game', (req, res) => {
    let { room_code, player_name } = req.body;

    // Input validation
    if (!room_code || !player_name) {
        return res.json({ success: false, message: 'Room code and player name required' });
    }

    // Sanitize player name
    player_name = validator.escape(player_name.trim());

    if (player_name.length === 0) {
        return res.json({ success: false, message: 'Player name cannot be empty' });
    }

    if (player_name.length > 20) {
        return res.json({ success: false, message: 'Player name too long (max 20 characters)' });
    }

    // Validate room code format
    if (!room_code || room_code.length !== 6) {
        return res.json({ success: false, message: 'Invalid room code. Room codes are 6 characters.' });
    }

    if (games[room_code]) {
        const existingPlayer = games[room_code].players.find(p => p.name === player_name);

        if (!existingPlayer) {
            games[room_code].players.push({
                name: player_name,
                id: generateId()
            });
            // Initialize stats for new player
            games[room_code].stats[player_name] = {
                cardsDrawn: 0,
                shots: 0,
                timersCompleted: 0
            };
            games[room_code].logs.push(`${player_name} joined the pack.`);
            games[room_code].lastActivity = Date.now();
            io.to(room_code).emit('game_update', getGameState(room_code));
        } else {
            // Reconnect: just update activity
            games[room_code].lastActivity = Date.now();
            // Optional: emit update to ensure client gets latest state immediately
            // io.to(room_code).emit('game_update', getGameState(room_code)); 
        }
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Game not found. Check the room code and try again.' });
    }
});

app.get('/api/game_state', (req, res) => {
    const roomCode = req.query.room_code;
    if (games[roomCode]) {
        res.json(getGameState(roomCode));
    } else {
        res.status(404).json({ error: 'Game not found' });
    }
});

app.post('/api/draw_card', (req, res) => {
    const { room_code, player_name } = req.body;

    if (!games[room_code]) {
        return res.json({ success: false, message: 'Game not found' });
    }

    const game = games[room_code];

    // Check if it's this player's turn
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.name !== player_name) {
        return res.json({
            success: false,
            message: `Not your turn! It's ${currentPlayer ? currentPlayer.name : 'someone else'}'s turn.`
        });
    }

    if (game.deck.length === 0) {
        if (game.discard.length > 0) {
            game.deck = [...game.discard];
            shuffleArray(game.deck);
            game.discard = [];
            game.logs.push('Deck reshuffled!');
        } else {
            return res.json({ success: false, message: 'Deck empty' });
        }
    }

    let card = game.deck.pop();

    // Handle cards that need a target player
    if (card.text.includes('{player}')) {
        const otherPlayers = game.players.filter(p => p.name !== player_name);
        if (otherPlayers.length > 0) {
            const targetPlayer = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
            card = {
                ...card,
                text: card.text.replace('{player}', targetPlayer.name),
                target_player: targetPlayer.name
            };
        }
    }


    game.discard.push({
        ...card,
        discarded_by: player_name
    });
    game.lastCard = { card, player: player_name };

    let logMessage = `${player_name} drew: ${card.title}`;
    if (card.target_player) {
        logMessage += ` → ${card.target_player}`;
    }
    game.logs.push(logMessage);

    // Update stats
    if (game.stats[player_name]) {
        game.stats[player_name].cardsDrawn++;
    }

    if (card.timer_duration) {
        const timerId = generateId();
        game.timers.push({
            id: timerId,
            label: `${player_name}: ${card.title}`,
            duration: card.timer_duration,
            end_time: Date.now() / 1000 + card.timer_duration,
            owner: player_name
        });
        game.logs.push(`Timer started: ${card.timer_duration}s`);
    }

    // Advance to next player
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    game.logs.push(`Next up: ${game.players[game.currentPlayerIndex].name}`);
    game.lastActivity = Date.now();

    io.to(room_code).emit('game_update', getGameState(room_code));
    res.json({ success: true, card });
});

app.post('/api/reset_game', (req, res) => {
    const { room_code } = req.body;
    if (games[room_code]) {
        games[room_code].deck = generateDeck();
        games[room_code].discard = [];
        games[room_code].timers = [];
        games[room_code].logs.push('Game reset!');
        games[room_code].lastCard = null;
        games[room_code].gameOver = false;
        // Optionally reset stats? For now, keep them or maybe reset them too?
        // Let's reset stats for a fresh game
        Object.keys(games[room_code].stats).forEach(player => {
            games[room_code].stats[player].cardsDrawn = 0;
            games[room_code].stats[player].shots = 0;
            games[room_code].stats[player].timersCompleted = 0;
        });
        io.to(room_code).emit('game_update', getGameState(room_code));
        res.json({ success: true });
    }
});

app.post('/api/clear_timer', (req, res) => {
    const { room_code, timer_id } = req.body;
    if (games[room_code]) {
        games[room_code].timers = games[room_code].timers.filter(t => t.id !== timer_id);
        io.to(room_code).emit('game_update', getGameState(room_code));
        res.json({ success: true });
    }
});

app.get('/api/discard_pile', (req, res) => {
    const roomCode = req.query.room_code;
    if (games[roomCode]) {
        res.json({
            success: true,
            discard: games[roomCode].discard.reverse() // Most recent first
        });
    } else {
        res.status(404).json({ success: false, message: 'Game not found' });
    }
});

app.post('/api/update_shots', (req, res) => {
    const { room_code, player_name, change } = req.body;
    if (games[room_code] && games[room_code].stats[player_name]) {
        games[room_code].stats[player_name].shots += change;
        // Ensure shots don't go negative
        if (games[room_code].stats[player_name].shots < 0) {
            games[room_code].stats[player_name].shots = 0;
        }
        io.to(room_code).emit('game_update', getGameState(room_code));
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/api/kick_player', (req, res) => {
    const { room_code, player_to_kick, requester } = req.body;
    const game = games[room_code];

    if (!game) return res.json({ success: false, message: 'Game not found' });

    // Verify requester is host (first player)
    if (game.players.length > 0 && game.players[0].name !== requester) {
        return res.json({ success: false, message: 'Only the host can kick players' });
    }

    // Don't allow kicking yourself (though UI shouldn't show it)
    if (player_to_kick === requester) {
        return res.json({ success: false, message: 'Cannot kick yourself' });
    }

    // Remove player
    const initialLength = game.players.length;
    game.players = game.players.filter(p => p.name !== player_to_kick);

    if (game.players.length < initialLength) {
        // Also remove stats
        delete game.stats[player_to_kick];

        game.logs.push(`${player_to_kick} was kicked from the pack.`);
        game.lastActivity = Date.now();

        // Adjust current player index if needed
        if (game.currentPlayerIndex >= game.players.length) {
            game.currentPlayerIndex = 0;
        }

        io.to(room_code).emit('game_update', getGameState(room_code));
        // Emit specific event to kicked player? (Socket disconnect handles cleanup usually, but we can force reload on client if name matches)
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Player not found' });
    }
});

app.post('/api/end_game', (req, res) => {
    const { room_code } = req.body;
    if (games[room_code]) {
        games[room_code].gameOver = true;
        games[room_code].lastActivity = Date.now();
        io.to(room_code).emit('game_update', getGameState(room_code));
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Socket.IO for real-time updates
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join_room', (roomCode) => {
        socket.join(roomCode);
        console.log(`Socket ${socket.id} joined room ${roomCode}`);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });

});


// Helper Functions
function getGameState(roomCode) {
    const game = games[roomCode];
    const currentTime = Date.now() / 1000;

    // Filter and clean up expired timers
    const activeTimers = [];
    const remainingTimers = [];

    for (const t of game.timers) {
        const remaining = t.end_time - currentTime;
        if (remaining > -2) { // Keep for 2 seconds after expiry for display
            activeTimers.push({
                ...t,
                remaining: Math.max(0, remaining)
            });
            if (remaining > 0) {
                remainingTimers.push(t); // Only keep non-expired in game state
            }
        }
    }

    // Update game state to remove fully expired timers
    game.timers = remainingTimers;

    return {
        players: game.players,
        deck_count: game.deck.length,
        discard_count: game.discard.length,
        timers: activeTimers,
        logs: game.logs.slice(-10),
        last_card: game.lastCard,
        current_player: game.players[game.currentPlayerIndex]?.name || null,
        current_player_index: game.currentPlayerIndex,
        stats: game.stats,
        game_over: game.gameOver
    };
}

function generateDeck() {
    const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'black', 'white'];
    const randomColor = () => colors[Math.floor(Math.random() * colors.length)];

    // Interactive cards (with player targeting)
    const interactiveCards = [
        { title: "Thumb War", text: "Challenge {player} to a thumb war. Loser takes a shot!", timer_duration: null },
        { title: "Staring Contest", text: "Staring contest with {player}. First to blink takes a shot!", timer_duration: null },
        { title: "Truth or Dare", text: "Ask {player} truth or dare. Refuse = take a shot!", timer_duration: null },
        { title: "Rhyme Time", text: "You and {player} take turns rhyming words for 20 seconds. First to fail takes a shot!", timer_duration: 20 },
        { title: "Compliment Battle", text: "You and {player} exchange compliments for 15 seconds. First to hesitate takes a shot!", timer_duration: 15 },
    ];

    // Party-themed cards
    const partyCards = [
        { title: "Hyena Laugh", text: "Laugh like a hyena for 10 seconds. Everyone else must keep a straight face. Fail = take a shot!", timer_duration: 10 },
        { title: "Scavenger Hunt", text: `Find something ${randomColor()} in the room and bring it back in 30 seconds. Fail = take a shot!`, timer_duration: 30 },
        { title: "Statue", text: "Freeze in your current pose for 20 seconds. Move = take a shot!", timer_duration: 20 },
        { title: "Dance Off", text: "Dance your heart out for 15 seconds. No dancing = take a shot!", timer_duration: 15 },
        { title: "Story Time", text: "Tell a 30-second story about a hyena. Boring story = take a shot!", timer_duration: 30 },
        { title: "Never Have I Ever", text: "Say something you've never done. Anyone who HAS done it takes a shot!", timer_duration: null },
        { title: "Categories", text: "Pick a category. Everyone names something in that category. First to fail takes a shot!", timer_duration: null },
        { title: "Accent Challenge", text: "Speak in a random accent for 20 seconds. Bad accent = take a shot!", timer_duration: 20 },
        { title: "Sing It!", text: "Sing the chorus of a song for 15 seconds. Refuse or forget words = take a shot!", timer_duration: 15 },
        { title: "Tongue Twister", text: "Say 'The Pumping Hyena happily hops' 5 times fast. Mess up = take a shot!", timer_duration: null },
        { title: "Impressions", text: "Do your best celebrity impression for 10 seconds. Bad impression = take a shot!", timer_duration: 10 },
        { title: "Backwards Talk", text: "Speak only backwards for 15 seconds. Mess up = take a shot!", timer_duration: 15 },
        { title: "Question Master", text: "For the next minute, you're the Question Master. Anyone who answers your questions takes a shot!", timer_duration: 60 },
        { title: "Silent Game", text: "Stay completely silent for 30 seconds. Make a sound = take a shot!", timer_duration: 30 },
        { title: "Compliment Yourself", text: "Give yourself 3 genuine compliments in 10 seconds. Can't do it = take a shot!", timer_duration: 10 },
        { title: "Movie Quote", text: "Recite a famous movie quote. Can't think of one = take a shot!", timer_duration: null },
        { title: "Animal Sounds", text: "Make 5 different animal sounds in 15 seconds. Fail = take a shot!", timer_duration: 15 },
        { title: "Alphabet Game", text: "Name something for each letter A-E in 10 seconds. Fail = take a shot!", timer_duration: 10 },
        { title: "Two Truths One Lie", text: "Tell 2 truths and 1 lie. Everyone guesses. If they're right, you take a shot!", timer_duration: null },
        { title: "Cheers!", text: "Everyone takes a shot! (Yes, even you!)", timer_duration: null },
        { title: "Waterfall", text: "Start drinking. Everyone else must drink until you stop. Go easy!", timer_duration: null },
        { title: "Social", text: "Everyone takes a shot together! Cheers!", timer_duration: null },
        { title: "Lucky You", text: "You're safe! Skip your shot this round.", timer_duration: null },
        { title: "Make a Rule", text: "Create a new rule for the game. Anyone who breaks it takes a shot!", timer_duration: null },
        { title: "Reverse", text: "Turn order reverses! (Next player goes backwards)", timer_duration: null },
    ];

    // Group Challenge Cards (affect multiple players)
    const groupCards = [
        { title: "Group Huddle", text: "Everyone must touch elbows in the center for 10 seconds. First to break loses!", timer_duration: 10 },
        { title: "Simon Says", text: "You're Simon! Give 3 commands. Anyone who messes up takes a shot!", timer_duration: 30 },
        { title: "Hot Potato", text: "Pass an object around. When timer ends, whoever holds it takes a shot!", timer_duration: 15 },
        { title: "Copycat", text: "Do an action. Everyone must copy you for 10 seconds. Fail = shot!", timer_duration: 10 },
        { title: "Team Chant", text: "Everyone creates a team chant together in 30 seconds. Can't agree = everyone drinks!", timer_duration: 30 },
        { title: "Group Vote", text: "Everyone votes on who should take the next shot. Majority rules!", timer_duration: null },
        { title: "Circle of Trust", text: "Everyone shares one secret. Refuse = take 2 shots!", timer_duration: null },
    ];

    // Wild Cards (player choice)
    const wildCards = [
        { title: "Wild Card", text: "Choose any player to take a shot, OR take one yourself and choose 2 others!", timer_duration: null },
        { title: "Dealer's Choice", text: "Pick any previous card effect to repeat on any player!", timer_duration: null },
        { title: "Double or Nothing", text: "Flip a coin. Heads = give 2 shots. Tails = take 2 shots!", timer_duration: null },
        { title: "Trade Places", text: "Swap seats with any player. Both of you take a shot!", timer_duration: null },
        { title: "Time Warp", text: "Choose: Skip your next turn, OR take a shot now and go again!", timer_duration: null },
    ];

    // Bonus/Penalty Cards
    const bonusPenaltyCards = [
        { title: "Lucky Break", text: "You're immune from the next card that targets you!", timer_duration: null },
        { title: "Double Trouble", text: "Your next shot counts as 2! (Or skip it and take 3 now)", timer_duration: null },
        { title: "Shield", text: "Block the next shot someone tries to give you!", timer_duration: null },
        { title: "Karma", text: "The last person who gave you a shot must take one now!", timer_duration: null },
        { title: "Boomerang", text: "Any shot you give in the next minute comes back to you too!", timer_duration: 60 },
        { title: "Speed Round", text: "Next 3 players must draw immediately. No breaks!", timer_duration: null },
        { title: "Freeze", text: "Pick a player. They can't draw for 2 rounds!", timer_duration: null },
    ];

    // Combine all cards
    const allCards = [...interactiveCards, ...partyCards, ...groupCards, ...wildCards, ...bonusPenaltyCards];

    // Create deck with duplicates for variety
    const deck = [...allCards, ...allCards, ...partyCards];

    shuffleArray(deck);
    return deck;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Get local IP address
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// Clean up inactive games (runs every hour)
setInterval(() => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [code, game] of Object.entries(games)) {
        if (game.lastActivity && now - game.lastActivity > maxAge) {
            delete games[code];
            console.log(`🧹 Cleaned up inactive game: ${code}`);
        }
    }
}, 60 * 60 * 1000); // Run every hour

// Start server on all network interfaces (0.0.0.0)
server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log('\n🦁 The Pumping Hyena Server is running! 💪\n');
    console.log(`Local:   http://localhost:${PORT}`);
    console.log(`Network: http://${localIP}:${PORT}`);
    console.log('\nShare the Network URL with other devices on your WiFi!\n');
});
