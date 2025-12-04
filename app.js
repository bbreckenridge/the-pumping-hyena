const app = {
    state: {
        roomCode: null,
        playerName: null,
        currentPlayer: null,
        timerCount: 0
    },

    socket: null,

    elements: {
        lobbyScreen: document.getElementById('lobby-screen'),
        gameScreen: document.getElementById('game-screen'),
        playerNameInput: document.getElementById('player-name'),
        roomCodeInput: document.getElementById('room-code-input'),
        createBtn: document.getElementById('create-btn'),
        joinBtn: document.getElementById('join-btn'),
        roomCodeDisplay: document.getElementById('room-code-display'),
        currentTurn: document.getElementById('current-turn'),
        timersList: document.getElementById('timers-list'),
        playersContent: document.getElementById('players-content'),
        deckCount: document.getElementById('deck-count'),
        lastCardDisplay: document.getElementById('last-card-display'),
        deckVisual: document.getElementById('deck-visual'),
        resetBtn: document.getElementById('reset-btn'),

        // Modal
        cardModal: document.getElementById('card-modal'),
        modalCardTitle: document.getElementById('modal-card-title'),
        modalCardText: document.getElementById('modal-card-text'),
        modalTimerBadge: document.getElementById('modal-timer-badge'),
        modalTimerVal: document.getElementById('modal-timer-val'),
        modalCloseBtn: document.getElementById('modal-close-btn'),

        discardModal: document.getElementById('discard-modal'),
        discardList: document.getElementById('discard-list'),
        discardCloseBtn: document.getElementById('discard-close-btn'),

        // Alert
        alertOverlay: document.getElementById('alert-overlay'),
        alertTitle: document.getElementById('alert-title'),
        alertMessage: document.getElementById('alert-message'),
        alertOk: document.getElementById('alert-ok')
    },

    init() {
        this.initSocket();
        this.bindEvents();

        // Check for existing session
        const session = localStorage.getItem('hyena_session');
        if (session) {
            try {
                const { roomCode, playerName } = JSON.parse(session);
                if (roomCode && playerName) {
                    this.state.roomCode = roomCode;
                    this.state.playerName = playerName;
                    this.joinGameRequest(roomCode, playerName);
                }
            } catch (e) {
                console.error('Invalid session');
                localStorage.removeItem('hyena_session');
            }
        }
    },

    initSocket() {
        this.socket = io();

        this.socket.on('game_update', (data) => {
            this.updateUI(data);
        });
    },

    bindEvents() {
        this.elements.createBtn.addEventListener('click', () => this.createGame());
        this.elements.joinBtn.addEventListener('click', () => this.joinGame());
        this.elements.deckVisual.addEventListener('click', () => this.drawCard());
        this.elements.resetBtn.addEventListener('click', () => this.resetGame());
        this.elements.modalCloseBtn.addEventListener('click', () => this.closeModal());
        this.elements.lastCardDisplay.addEventListener('click', () => this.viewDiscardPile());
        this.elements.discardCloseBtn.addEventListener('click', () => this.closeDiscardModal());
        this.elements.alertOk.addEventListener('click', () => this.closeAlert());

        // Auto-uppercase room code
        this.elements.roomCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
    },

    setupSocket() {
        this.socket = io();

        this.socket.on('game_update', (data) => {
            this.updateUI(data);
        });
    },

    // Sound Effects using Web Audio API
    playSound(type) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            if (type === 'draw') {
                // Card draw: Quick ascending whoosh
                oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.1);
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.15);
            } else if (type === 'timer') {
                // Timer: Double beep
                oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.1);

                // Second beep
                setTimeout(() => {
                    const osc2 = audioContext.createOscillator();
                    const gain2 = audioContext.createGain();
                    osc2.connect(gain2);
                    gain2.connect(audioContext.destination);
                    osc2.frequency.setValueAtTime(1000, audioContext.currentTime);
                    gain2.gain.setValueAtTime(0.2, audioContext.currentTime);
                    gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
                    osc2.start(audioContext.currentTime);
                    osc2.stop(audioContext.currentTime + 0.1);
                }, 100);
            }
        } catch (e) {
            console.log('Sound not supported');
        }
    },

    async createGame() {
        const name = this.elements.playerNameInput.value.trim();
        if (!name) return this.showAlert('Error', 'Please enter your name.');

        try {
            const res = await fetch('/api/create_game', {
                method: 'POST',
                body: JSON.stringify({})
            });
            const data = await res.json();
            this.state.roomCode = data.room_code;
            this.state.playerName = name;

            // Auto join
            await this.joinGameRequest(this.state.roomCode, name);
        } catch (e) {
            this.showAlert('Error', 'Failed to create game.');
        }
    },

    async joinGame() {
        const name = this.elements.playerNameInput.value.trim();
        const code = this.elements.roomCodeInput.value.trim();

        if (!name) return this.showAlert('Error', 'Please enter your name.');
        if (!code) return this.showAlert('Error', 'Please enter a room code.');

        this.state.roomCode = code;
        this.state.playerName = name;
        await this.joinGameRequest(code, name);
    },

    async joinGameRequest(roomCode, playerName) {
        try {
            const res = await fetch('/api/join_game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_code: roomCode, player_name: playerName })
            });
            const data = await res.json();

            if (data.success) {
                // Save session
                localStorage.setItem('hyena_session', JSON.stringify({
                    roomCode: roomCode,
                    playerName: playerName
                }));
                this.enterGame();
            } else {
                this.showAlert('Error', data.message || 'Failed to join.');
            }
        } catch (e) {
            this.showAlert('Error', 'Network error.');
        }
    },

    enterGame() {
        this.elements.lobbyScreen.classList.remove('active');
        this.elements.gameScreen.classList.add('active');
        this.elements.roomCodeDisplay.textContent = this.state.roomCode;

        // Join Socket.IO room
        this.socket.emit('join_room', this.state.roomCode);

        // Start polling
        this.pollInterval = setInterval(() => this.fetchGameState(), 1000);
        this.fetchGameState(); // Immediate fetch
    },

    async fetchGameState() {
        if (!this.state.roomCode) return;

        try {
            const res = await fetch(`/api/game_state?room_code=${this.state.roomCode}`);
            if (res.status === 404) {
                clearInterval(this.pollInterval);
                this.showAlert('Game Over', 'The game session has ended.');
                location.reload();
                return;
            }
            const data = await res.json();
            this.updateUI(data);
        } catch (e) {
            console.error(e);
        }
    },

    updateUI(data) {
        // Update current turn indicator
        this.state.currentPlayer = data.current_player;
        if (data.current_player) {
            const isMyTurn = data.current_player === this.state.playerName;
            this.elements.currentTurn.textContent = isMyTurn ? '🎯 YOUR TURN!' : `${data.current_player}'s turn`;
            this.elements.currentTurn.style.background = isMyTurn ? 'rgba(217, 119, 6, 0.3)' : 'rgba(217, 119, 6, 0.1)';
            this.elements.currentTurn.style.fontWeight = isMyTurn ? '900' : '700';

            // Enable/disable deck based on turn
            if (isMyTurn) {
                this.elements.deckVisual.classList.remove('disabled');
                this.elements.deckVisual.title = "Click to draw card";
            } else {
                this.elements.deckVisual.classList.add('disabled');
                this.elements.deckVisual.title = "Wait for your turn";
            }
        }


        // Update Players with shot counters
        if (data.players && data.stats) {
            const isHost = data.players.length > 0 && data.players[0].name === this.state.playerName;

            this.elements.playersContent.innerHTML = data.players.map((p, i) => {
                const isCurrent = i === data.current_player_index;
                const playerStats = data.stats[p.name] || { shots: 0 };
                const isMe = p.name === this.state.playerName;

                let kickBtn = '';
                if (isHost && !isMe) {
                    kickBtn = `<button class="kick-btn" onclick="app.kickPlayer('${p.name}')" title="Kick Player">✕</button>`;
                }

                return `
                    <div class="player-item ${isCurrent ? 'active' : ''}">
                        <div class="player-info">
                            <div class="player-name">${isCurrent ? '👉 ' : ''}${p.name}</div>
                            ${kickBtn}
                        </div>
                        <div class="shot-counter">
                            <span style="font-size:0.8rem; color:#666; margin-right:4px;">🥃 Shots:</span>
                            <button class="shot-btn minus" onclick="app.updateShots('${p.name}', -1)">−</button>
                            <span class="shot-value">${playerStats.shots}</span>
                            <button class="shot-btn plus" onclick="app.updateShots('${p.name}', 1)">+</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Update Deck Count
        this.elements.deckCount.textContent = data.deck_count;

        // Update Last Card
        if (data.last_card) {
            this.elements.lastCardDisplay.innerHTML = `
                <div style="font-weight:bold; color:var(--primary-color); font-size:0.9rem;">${data.last_card.card.title}</div>
                <div style="font-size:0.75rem; margin-top:4px;">${data.last_card.player}</div>
            `;
        } else {
            this.elements.lastCardDisplay.innerHTML = '<p>None</p>';
        }

        // Update Timers
        this.renderTimers(data.timers);
    },

    renderTimers(timers) {
        // Play sound if new timer was added
        if (timers.length > this.state.timerCount && timers.length > 0) {
            this.playSound('timer');
        }
        this.state.timerCount = timers.length;

        if (timers.length === 0) {
            this.elements.timersList.innerHTML = '<div class="empty-state" style="text-align:center; color:#999; font-size:0.9rem;">No active timers</div>';
            return;
        }

        this.elements.timersList.innerHTML = timers.map(t => {
            const pct = (t.remaining / t.duration) * 100;
            const isFinished = t.remaining <= 0;
            return `
                <div class="timer-item" style="${isFinished ? 'opacity:0.6; background:#fee2e2; border-color:#ef4444;' : ''}">
                    <div class="timer-info" style="flex:1">
                        <div class="timer-label">${t.label}</div>
                        <div style="height:4px; background:#e5e7eb; margin-top:4px; border-radius:2px; overflow:hidden;">
                            <div style="width:${pct}%; height:100%; background:var(--secondary-color); transition:width 1s linear;"></div>
                        </div>
                    </div>
                    <div class="timer-val" style="margin-left:10px;">${Math.ceil(t.remaining)}s</div>
                </div>
            `;
        }).join('');
    },

    async updateShots(playerName, change) {
        try {
            await fetch('/api/update_shots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    room_code: this.state.roomCode,
                    player_name: playerName,
                    change: change
                })
            });
        } catch (e) {
            console.error('Failed to update shots:', e);
        }
    },

    async kickPlayer(playerToKick) {
        if (!confirm(`Are you sure you want to kick ${playerToKick}?`)) return;

        try {
            const res = await fetch('/api/kick_player', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    room_code: this.state.roomCode,
                    player_to_kick: playerToKick,
                    requester: this.state.playerName
                })
            });
            const data = await res.json();
            if (!data.success) {
                this.showAlert('Error', data.message || 'Failed to kick player.');
            }
        } catch (e) {
            this.showAlert('Error', 'Network error.');
        }
    },

    async drawCard() {
        if (this.elements.deckVisual.classList.contains('disabled')) return;

        try {
            const res = await fetch('/api/draw_card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_code: this.state.roomCode, player_name: this.state.playerName })
            });

            if (!res.ok) {
                console.error('Draw card failed:', res.status, res.statusText);
                this.showAlert('Error', `Server error: ${res.status}`);
                return;
            }

            const data = await res.json();

            if (data.success) {
                this.playSound('draw');
                this.showCardModal(data.card);
            } else {
                this.showAlert('Info', data.message || 'Could not draw card');
            }
        } catch (e) {
            console.error('Draw card error:', e);
            this.showAlert('Error', 'Failed to draw card. Please try again.');
        }
    },

    async resetGame() {
        if (!confirm('Are you sure you want to reset the game?')) return;
        await fetch('/api/reset_game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_code: this.state.roomCode })
        });
    },

    showCardModal(card) {
        this.elements.modalCardTitle.textContent = card.title;
        this.elements.modalCardText.textContent = card.text;

        if (card.timer_duration) {
            this.elements.modalTimerBadge.classList.remove('hidden');
            this.elements.modalTimerVal.textContent = card.timer_duration;
        } else {
            this.elements.modalTimerBadge.classList.add('hidden');
        }

        this.elements.cardModal.classList.remove('hidden');
    },

    closeModal() {
        this.elements.cardModal.classList.add('hidden');
    },

    showAlert(title, msg) {
        this.elements.alertTitle.textContent = title;
        this.elements.alertMessage.textContent = msg;
        this.elements.alertOverlay.classList.remove('hidden');
    },

    closeAlert() {
        this.elements.alertOverlay.classList.add('hidden');
    },

    async viewDiscardPile() {
        try {
            const res = await fetch(`/api/discard_pile?room_code=${this.state.roomCode}`);
            const data = await res.json();

            if (data.success && data.discard) {
                if (data.discard.length === 0) {
                    this.elements.discardList.innerHTML = '<p style="text-align:center; color:#999;">No cards in discard pile yet</p>';
                } else {
                    this.elements.discardList.innerHTML = data.discard.map((card, index) => `
                        <div style="background: #f9fafb; padding: 12px; border-radius: 8px; border-left: 4px solid var(--primary-color);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <div style="font-weight: bold; color: var(--primary-color);">${card.title}</div>
                                <div style="font-size: 0.75rem; color: #6b7280; font-style: italic;">by ${card.discarded_by || 'Unknown'}</div>
                            </div>
                            <div style="font-size: 0.9rem;">${card.text}</div>
                            ${card.timer_duration ? `<div style="margin-top: 4px; font-size: 0.8rem; color: var(--secondary-color);">⏱ ${card.timer_duration}s</div>` : ''}
                        </div>
                    `).join('');
                }
                this.elements.discardModal.classList.remove('hidden');
            }
        } catch (e) {
            this.showAlert('Error', 'Failed to load discard pile.');
        }
    },

    closeDiscardModal() {
        this.elements.discardModal.classList.add('hidden');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
