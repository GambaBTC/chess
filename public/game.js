const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const hillBar = document.getElementById('hillBar');
const balanceDisplay = document.getElementById('balanceDisplay');
const queueDisplay = document.getElementById('queueDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const notificationDiv = document.getElementById('notification');
const notificationMessage = document.getElementById('notificationMessage');
const countdownSpan = document.getElementById('countdown');
const acceptButton = document.getElementById('acceptButton');
const CELL_SIZE = canvas.width / 35;
const MOVE_DURATION = 0.2;
const BOARD_SIZE = 35;
const HILL_HOLD_TIME = 45; // Increased from 30 to 45 seconds
const TERRAIN_WATER = 2;
const TERRAIN_FOREST = 1;

// Notification sound (base64-encoded WAV file for a simple "ding" sound)
const notificationSound = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');

let team, gameState, offset, selectedPiece = null, isSpectating = false;

document.addEventListener('DOMContentLoaded', () => {
    // Check if SOL address is stored in localStorage
    let solAddress = localStorage.getItem('solAddress');
    if (!solAddress) {
        solAddress = prompt('Enter your SOLANA address:');
        if (solAddress && solAddress.trim() !== '') {
            localStorage.setItem('solAddress', solAddress);
        } else {
            alert('A valid Solana address is required to play.');
            window.location.reload();
            return;
        }
    }

    socket.emit('join', solAddress);
    socket.emit('getBalance');
});

socket.on('waiting', (message) => {
    statusDiv.textContent = message;
    console.log('Waiting message received:', message);
});

socket.on('gameStart', (data) => {
    console.log('GameStart received:', JSON.stringify(data, null, 2));
    if (!data || !data.state) {
        console.error('Invalid gameStart data:', data);
        return;
    }
    team = data.team;
    gameState = data.state;
    if (!gameState.board || !gameState.pieces) {
        console.error('Invalid gameState missing board or pieces:', gameState);
        return;
    }
    offset = Date.now() - data.state.serverTime;
    statusDiv.textContent = `Playing as Team ${team}`;
    isSpectating = false; // Player is in the game, not spectating
    console.log('Game state initialized:', gameState);
    requestAnimationFrame(render);
});

socket.on('spectate', (state) => {
    console.log('Spectate received:', state);
    gameState = state;
    if (!gameState.board || !gameState.pieces) {
        console.error('Invalid spectate state missing board or pieces:', gameState);
        return;
    }
    offset = Date.now() - state.serverTime;
    statusDiv.textContent = 'Spectating the current game';
    isSpectating = true; // Client is in spectator mode
    console.log('Spectating game state initialized:', gameState);
    requestAnimationFrame(render);
});

socket.on('update', (state) => {
    console.log('Update received:', state);
    if (state.board) {
        // Full state update
        gameState = state;
    } else {
        // Delta update
        offset = Date.now() - state.serverTime;
        // Update all pieces with the server's state
        state.pieces.forEach(dp => {
            const piece = gameState.pieces.find(p => p.x === dp.x && p.y === dp.y && p.team === dp.team && p.type === dp.type);
            if (piece) {
                piece.cooldown = dp.cooldown;
                console.log(`Updated piece at (${piece.x}, ${piece.y}) cooldown to ${piece.cooldown}`);
            } else {
                console.warn(`Piece not found for update:`, dp);
            }
        });
        gameState.hillOccupant = state.hillOccupant;
        gameState.hillTimer = state.hillTimer;
        gameState.player1Timer = state.player1Timer;
        gameState.player2Timer = state.player2Timer;
    }
});

socket.on('gameOver', (state) => {
    gameState = state;
    statusDiv.textContent = isSpectating 
        ? `Game Over: Team ${state.winner} won by ${state.winReason}!`
        : state.winner === team 
            ? `You won by ${state.winReason}! 0.005 SOL sent.` 
            : `You lost by ${state.winReason}.`;
    console.log('Game over:', state);
    if (!isSpectating) {
        // Show prompt with "Exit" or "Go to Queue" options
        const promptDiv = document.createElement('div');
        promptDiv.className = 'game-over-prompt';
        promptDiv.innerHTML = `
            <p>Game Over! What would you like to do?</p>
            <button id="exitButton">Exit</button>
            <button id="queueButton">Go to Queue</button>
        `;
        document.body.appendChild(promptDiv);

        document.getElementById('exitButton').addEventListener('click', () => {
            socket.disconnect();
            window.location.reload(); // Or redirect to a homepage if you have one
        });

        document.getElementById('queueButton').addEventListener('click', () => {
            const solAddress = localStorage.getItem('solAddress');
            socket.emit('joinQueue', solAddress);
            promptDiv.remove();
        });
    }
});

socket.on('gameOffer', (timeout) => {
    // Play notification sound
    notificationSound.play().catch(err => console.error('Error playing sound:', err));

    // Show notification with countdown
    notificationDiv.style.display = 'block';
    notificationMessage.textContent = 'You have been selected to play! Accept within:';
    countdownSpan.textContent = timeout;
    acceptButton.disabled = false;

    let timeLeft = timeout;
    const countdownInterval = setInterval(() => {
        timeLeft--;
        countdownSpan.textContent = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            notificationDiv.style.display = 'none';
        }
    }, 1000);

    acceptButton.onclick = () => {
        clearInterval(countdownInterval);
        notificationDiv.style.display = 'none';
        socket.emit('acceptGame');
    };
});

socket.on('serverBalance', (balance) => {
    balanceDisplay.textContent = `Server SOL: ${typeof balance === 'string' ? balance : balance.toFixed(4)} SOL`;
});

socket.on('queueUpdate', (queueSize) => {
    queueDisplay.textContent = `Players in queue: ${queueSize}`;
});

function drawPiece(piece, selected = false) {
    const currentTime = Date.now() - offset;
    let rx = piece.x, ry = piece.y;
    if (piece.move_start_time && currentTime - piece.move_start_time < MOVE_DURATION * 1000) {
        const t = Math.min((currentTime - piece.move_start_time) / (MOVE_DURATION * 1000), 1);
        rx = piece.old_x + (piece.x - piece.old_x) * t;
        ry = piece.old_y + (piece.y - piece.old_y) * t;
    }
    const rectX = rx * CELL_SIZE, rectY = ry * CELL_SIZE;
    const centerX = rectX + CELL_SIZE / 2, centerY = rectY + CELL_SIZE / 2;
    const size = CELL_SIZE / 2 - 1;
    ctx.fillStyle = piece.team === 0 ? '#fff' : '#f00';
    const shapes = {
        "pawn": () => ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2),
        "knight": () => ctx.polygon([[centerX, centerY - size], [centerX - size, centerY + size], [centerX + size, centerY + size]]),
        "bishop": () => {
            ctx.beginPath();
            ctx.moveTo(rectX, rectY);
            ctx.lineTo(rectX + CELL_SIZE, rectY + CELL_SIZE);
            ctx.moveTo(rectX + CELL_SIZE, rectY);
            ctx.lineTo(rectX, rectY + CELL_SIZE);
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = 2;
            ctx.stroke();
        },
        "rook": () => {
            ctx.beginPath();
            ctx.rect(rectX + 2, rectY + 2, CELL_SIZE - 4, CELL_SIZE - 4);
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = 2;
            ctx.stroke();
        },
        "queen": () => {
            ctx.arc(centerX, centerY, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(rectX, rectY);
            ctx.lineTo(rectX + CELL_SIZE, rectY + CELL_SIZE);
            ctx.moveTo(rectX + CELL_SIZE, rectY);
            ctx.lineTo(rectX, rectY + CELL_SIZE);
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = 2;
            ctx.stroke();
        },
        "king": () => {
            ctx.arc(centerX, centerY, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
            ctx.fillStyle = '#000';
            ctx.fill();
            ctx.fillStyle = piece.team === 0 ? '#fff' : '#f00';
        }
    };
    ctx.beginPath();
    if (piece.type === "knight") {
        shapes[piece.type]();
        ctx.fill();
    } else if (piece.type !== "bishop" && piece.type !== "rook") {
        shapes[piece.type]();
        ctx.fill();
    } else {
        shapes[piece.type]();
    }
    if (selected) {
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.strokeRect(rectX, rectY, CELL_SIZE, CELL_SIZE);
    }
    if (piece.cooldown > 0) {
        const elapsed = currentTime - (piece.move_start_time || currentTime);
        const maxCooldown = (gameState.board[piece.x][piece.y] === TERRAIN_FOREST) ? 10000 : 5000; // Updated to match server: 5s on grass, 10s on forest
        const opacity = Math.max(0, piece.cooldown / maxCooldown);
        ctx.fillStyle = `rgba(255, 0, 0, ${opacity})`;
        ctx.fillRect(rectX, rectY, CELL_SIZE, CELL_SIZE);
    }
}

function render() {
    if (!gameState) {
        console.error('No gameState to render');
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let x = 0; x < BOARD_SIZE; x++) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            ctx.fillStyle = gameState.board[x][y] === TERRAIN_WATER ? '#00f' : gameState.board[x][y] === TERRAIN_FOREST ? '#060' : '#0a0';
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }

    ctx.fillStyle = '#ff0';
    ctx.fillRect(gameState.hill.x * CELL_SIZE, gameState.hill.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    if (gameState.hillOccupant !== null) {
        hillBar.innerHTML = `<div id="hillProgress" style="width: ${gameState.hillTimer / HILL_HOLD_TIME * 100}%; background: ${gameState.hillOccupant === 0 ? '#fff' : '#f00'}"></div>`;
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.fillText(`${gameState.hillTimer.toFixed(1)}/${HILL_HOLD_TIME}s`, gameState.hill.x * CELL_SIZE + 2, gameState.hill.y * CELL_SIZE + 12);
    } else {
        hillBar.innerHTML = '';
    }

    gameState.shrines.forEach(s => {
        ctx.fillStyle = '#ccc';
        ctx.fillRect(s[0] * CELL_SIZE, s[1] * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });

    gameState.pieces.forEach((p, i) => {
        drawPiece(p, i === selectedPiece);
        if (i === selectedPiece) {
            const legalMoves = calculateLegalMoves(p);
            ctx.fillStyle = 'rgba(255, 255, 0, 0.5)';
            legalMoves.forEach(([mx, my]) => ctx.fillRect(mx * CELL_SIZE, my * CELL_SIZE, CELL_SIZE, CELL_SIZE));
        }
    });

    // Display inactivity timers for both teams
    if (gameState.player1Timer !== undefined && gameState.player2Timer !== undefined) {
        timerDisplay.textContent = `Team 0: ${gameState.player1Timer.toFixed(1)}s | Team 1: ${gameState.player2Timer.toFixed(1)}s`;
    }

    if (!gameState.gameOver) {
        requestAnimationFrame(render);
    }
}

function calculateLegalMoves(piece) {
    const moves = {
        "pawn": () => {
            const moves = [], captures = [];
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const nx = piece.x + dx, ny = piece.y + dy;
                if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && gameState.board[nx][ny] !== TERRAIN_WATER &&
                    !gameState.pieces.some(p => p.x === nx && p.y === ny)) moves.push([nx, ny]);
            }
            for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
                const nx = piece.x + dx, ny = piece.y + dy;
                if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE &&
                    gameState.pieces.some(p => p.x === nx && p.y === ny && p.team !== piece.team)) captures.push([nx, ny]);
            }
            return moves.concat(captures);
        },
        "knight": () => {
            const moves = [];
            for (const [dx, dy] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
                const nx = piece.x + dx, ny = piece.y + dy;
                if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && gameState.board[nx][ny] !== TERRAIN_WATER &&
                    (!gameState.pieces.some(p => p.x === nx && p.y === ny && p.team === piece.team))) moves.push([nx, ny]);
            }
            return moves;
        },
        "bishop": () => getSlidingMoves([[-1, -1], [-1, 1], [1, -1], [1, 1]], 5),
        "rook": () => getSlidingMoves([[-1, 0], [1, 0], [0, -1], [0, 1]], 5),
        "queen": () => getSlidingMoves([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]], 5), // Reduced range from 7 to 5
        "king": () => {
            const moves = [];
            for (const [dx, dy] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
                const nx = piece.x + dx, ny = piece.y + dy;
                if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && gameState.board[nx][ny] !== TERRAIN_WATER &&
                    (!gameState.pieces.some(p => p.x === nx && p.y === ny && p.team === piece.team))) moves.push([nx, ny]);
            }
            return moves;
        }
    };

    function getSlidingMoves(directions, maxRange) {
        const moves = [];
        for (const [dx, dy] of directions) {
            for (let i = 1; i <= maxRange; i++) {
                const nx = piece.x + dx * i, ny = piece.y + dy * i;
                if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE || gameState.board[nx][ny] === TERRAIN_WATER) break;
                const targetPiece = gameState.pieces.find(p => p.x === nx && p.y === ny);
                if (targetPiece) {
                    if (targetPiece.team !== piece.team) moves.push([nx, ny]);
                    break;
                }
                moves.push([nx, ny]);
            }
        }
        return moves;
    }

    return moves[piece.type]();
}

canvas.addEventListener('click', (e) => {
    if (!gameState || gameState.gameOver || isSpectating) return; // Disable interaction for spectators
    const x = Math.floor(e.offsetX / CELL_SIZE), y = Math.floor(e.offsetY / CELL_SIZE);
    const pieceIdx = gameState.pieces.findIndex(p => p.x === x && p.y === y && p.team === team && p.cooldown === 0);

    console.log(`Clicked at (${x}, ${y}), pieceIdx: ${pieceIdx}, selectedPiece: ${selectedPiece}, piece state:`, pieceIdx !== -1 ? gameState.pieces[pieceIdx] : 'none');

    if (pieceIdx !== -1) {
        // If clicking on a piece that can be selected
        if (selectedPiece === pieceIdx) {
            // Clicking the same piece again, deselect it
            selectedPiece = null;
            console.log('Piece deselected:', gameState.pieces[pieceIdx]);
        } else {
            // Selecting a new piece (or a different piece)
            selectedPiece = pieceIdx;
            console.log('Piece selected:', gameState.pieces[pieceIdx]);
        }
    } else if (selectedPiece !== null) {
        // If a piece is selected and we click on a non-piece square, attempt to move
        socket.emit('move', { pieceIdx: selectedPiece, targetX: x, targetY: y });
        console.log('Move sent:', { pieceIdx: selectedPiece, targetX: x, targetY: y });
        selectedPiece = null; // Deselect after moving
    } else {
        // Clicking on an empty square with no piece selected, deselect any piece
        selectedPiece = null;
        console.log('Clicked on empty square, deselected any piece');
    }
});

ctx.polygon = function(points) {
    this.beginPath();
    this.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) this.lineTo(points[i][0], points[i][1]);
    this.closePath();
};

requestAnimationFrame(render);
