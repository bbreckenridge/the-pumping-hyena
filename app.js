const app = {
    state: {
        roomCode: null,
        playerName: null,
        currentPlayer: null,
        unreadMessages: 0,
        activeTab: 'logs'
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
        logsContent: document.getElementById('logs-content'),
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
        alertOk: document.getElementById('alert-ok'),

        // Tabs
        tabBtns: document.querySelectorAll('.tab-btn'),
        tabContents: document.querySelectorAll('.tab-content'),

        // Chat
        chatContent: document.getElementById('chat-content'),
        chatMessages: document.getElementById('chat-messages'),
        chatInput: document.getElementById('chat-input'),
        sendChatBtn: document.getElementById('send-chat-btn')
    },

    init() {
        this.initSocket();
        this.bindEvents();
    },

    initSocket() {
        this.socket = io();

        this.socket.on('game_update', (data) => {
            this.updateUI(data);
        });

        this.socket.on('chat_message', (data) => {
            this.addChatMessage(data);
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
        this.elements.sendChatBtn.addEventListener('click', () => this.sendChatMessage());
        this.elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });

        this.elements.tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                this.switchTab(tab);
            });
        });
    },

    setupSocket() {
        this.socket = io();

        this.socket.on('game_update', (data) => {
            this.updateUI(data);
        });

        this.socket.on('chat_message', (data) => {
            this.addChatMessage(data);
        });
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

        // Update Logs
        this.elements.logsContent.innerHTML = data.logs.map(log => `<div class="log-entry">${log}</div>`).join('');

        // Update Players
        this.elements.playersContent.innerHTML = data.players.map((p, i) => {
            const isCurrent = i === data.current_player_index;
            return `<div style="padding:5px; ${isCurrent ? 'font-weight:bold; color:var(--primary-color);' : ''}">${isCurrent ? '👉 ' : ''}${p.name}</div>`;
        }).join('');

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

    switchTab(tabName) {
        this.state.activeTab = tabName;

        this.elements.tabBtns.forEach(btn => {
            if (btn.dataset.tab === tabName) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        this.elements.tabContents.forEach(content => {
            if (content.id === `${tabName}-content`) content.classList.add('active');
            else content.classList.remove('active');
        });

        // Reset unread count if switching to chat
        if (tabName === 'chat') {
            this.state.unreadMessages = 0;
            this.updateChatTabLabel();
        }
    },

    updateChatTabLabel() {
        const chatTabBtn = document.querySelector('.tab-btn[data-tab="chat"]');
        if (chatTabBtn) {
            if (this.state.unreadMessages > 0) {
                chatTabBtn.textContent = `Chat (${this.state.unreadMessages})`;
                chatTabBtn.classList.add('has-unread');
            } else {
                chatTabBtn.textContent = 'Chat';
                chatTabBtn.classList.remove('has-unread');
            }
        }
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
    },

    sendChatMessage() {
        const message = this.elements.chatInput.value.trim();
        if (!message || !this.state.roomCode || !this.state.playerName) return;

        this.socket.emit('chat_message', {
            room_code: this.state.roomCode,
            player_name: this.state.playerName,
            message: message
        });

        this.elements.chatInput.value = '';
    },

    addChatMessage(data) {
        const messagesContainer = this.elements.chatMessages;

        // Remove empty state if present
        const emptyState = messagesContainer.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.innerHTML = `
            <span class="chat-player">${data.player}:</span>
            <span class="chat-text">${data.text}</span>
        `;

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Increment unread count if not on chat tab
        if (this.state.activeTab !== 'chat') {
            this.state.unreadMessages++;
            this.updateChatTabLabel();
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
