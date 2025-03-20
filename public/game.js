const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const hillBar = document.getElementById('hillBar');
const balanceDisplay = document.getElementById('balanceDisplay');
const queueDisplay = document.getElementById('queueDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const gameCountdown = document.getElementById('gameCountdown');
const notificationDiv = document.getElementById('notification');
const notificationMessage = document.getElementById('notificationMessage');
const countdownSpan = document.getElementById('countdown');
const acceptButton = document.getElementById('acceptButton');
const CELL_SIZE = canvas.width / 35;
const MOVE_DURATION = 0.2;
const BOARD_SIZE = 35;
const HILL_HOLD_TIME = 45;
const TERRAIN_WATER = 2;
const TERRAIN_FOREST = 1;

const notificationSound = new Audio('https://github.com/GambaBTC/chess/raw/refs/heads/main/mixkit-happy-bells-notification-937.wav');

let team, gameState, offset, selectedPiece = null, isSpectating = false, hasJoined = false;

socket.on('requestSolAddress', () => {
    if (!hasJoined) {
        document.getElementById('solPrompt').style.display = 'block';
        statusDiv.textContent = 'Please enter your SOL address to join.';
    }
});

function submitSolAddress() {
    const solAddress = document.getElementById('solAddress').value.trim();
    if (solAddress) {
        socket.emit('join', solAddress);
        localStorage.setItem('solAddress', solAddress);
        hasJoined = true;
        document.getElementById('solPrompt').style.display = 'none';
        socket.emit('getBalance');
    } else {
        alert('A valid Solana address is required to play or spectate.');
    }
}

socket.on('serverRestart', () => {
    console.log('Server restarted, clearing stored SOL address');
    localStorage.removeItem('solAddress');
    hasJoined = false;
    team = null;
    gameState = null;
    document.getElementById('solPrompt').style.display = 'block';
    statusDiv.textContent = 'Server restarted. Please enter your SOL address.';
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
    isSpectating = false;
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
    isSpectating = true;
    console.log('Spectating game state initialized:', gameState);
    requestAnimationFrame(render);
});

socket.on('update', (state) => {
    console.log('Update received:', state);
    if (state.board) {
        gameState = state;
    } else {
        offset = Date.now() - state.serverTime;
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
        gameState.gameTimeRemaining = state.gameTimeRemaining;
    }
});

socket.on('gameOver', (state) => {
    gameState = state;
    let message;
    if (state.winner === null && state.winReason === "dual_inactivity") {
        message = isSpectating 
            ? `Game Over: Both players were inactive. No winner!`
            : `Game Over: Both players were inactive. No winner!`;
    } else if (state.winner === null && state.winReason === "time_limit_reached") {
        message = isSpectating 
            ? `Game Over: Time limit reached. Tie due to equal pieces!`
            : `Game Over: Time limit reached. Tie due to equal pieces!`;
    } else {
        if (isSpectating) {
            message = `Game Over: Team ${state.winner} won by ${state.winReason}!`;
        } else if (state.winner === team) {
            message = state.prize > 0 
                ? `You won by ${state.winReason}! ${state.prize} SOL has been sent to your wallet.`
                : `You won by ${state.winReason}! No SOL awarded (less than 10 moves).`;
        } else {
            message = `You lost by ${state.winReason}. Better luck next time!`;
        }
    }
    statusDiv.textContent = message;
    console.log('Game over:', state);

    if (!isSpectating) {
        const promptDiv = document.createElement('div');
        promptDiv.className = 'game-over-prompt';
        promptDiv.innerHTML = `
            <p>${message} Choose an option within <span id="gameOverCountdown">10</span> seconds:</p>
            <button id="exitButton">Exit</button>
            <button id="queueButton">Go to Queue</button>
        `;
        document.body.appendChild(promptDiv);

        let timeLeft = 10;
        const countdownElement = document.getElementById('gameOverCountdown');
        const countdownInterval = setInterval(() => {
            timeLeft--;
            countdownElement.textContent = timeLeft;
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                promptDiv.remove();
                socket.disconnect();
                window.location.reload();
            }
        }, 1000);

        document.getElementById('exitButton').addEventListener('click', () => {
            clearInterval(countdownInterval);
            promptDiv.remove();
            socket.disconnect();
            window.location.reload();
        });

        document.getElementById('queueButton').addEventListener('click', () => {
            clearInterval(countdownInterval);
            promptDiv.remove();
            const solAddress = localStorage.getItem('solAddress');
            socket.emit('joinQueue', solAddress);
        });
    }
});

socket.on('gameOffer', (timeout) => {
    notificationSound.loop = true;
    notificationSound.play().catch(err => console.error('Error playing sound:', err));
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
            notificationSound.pause();
            notificationSound.currentTime = 0;
            notificationDiv.style.display = 'none';
        }
    }, 1000);

    acceptButton.onclick = () => {
        clearInterval(countdownInterval);
        notificationSound.pause();
        notificationSound.currentTime = 0;
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
        const maxCooldown = (gameState.board[piece.x][piece.y] === TERRAIN_FOREST) ? 10000 : 5000;
        const opacity = Math.max(0, piece.cooldown / maxCooldown);
        ctx.fillStyle = `rgba(255, 0, 0, ${opacity})`;
        ctx.fillRect(rectX, rectY, CELL_SIZE, CELL_SIZE);
    }
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
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
        const remainingTime = (HILL_HOLD_TIME - gameState.hillTimer).toFixed(1);
        hillBar.innerHTML = `<div id="hillProgress" style="width: ${gameState.hillTimer / HILL_HOLD_TIME * 100}%; background: ${gameState.hillOccupant === 0 ? '#fff' : '#f00'}"></div>`;
        hillBar.title = `${remainingTime}s remaining`;
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

    if (gameState.player1Timer !== undefined && gameState.player2Timer !== undefined) {
        timerDisplay.textContent = `Team 0: ${gameState.player1Timer.toFixed(1)}s | Team 1: ${gameState.player2Timer.toFixed(1)}s`;
    }

    if (gameState.gameTimeRemaining !== undefined) {
        gameCountdown.textContent = `Game Time: ${formatTime(gameState.gameTimeRemaining)}`;
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
        "queen": () => getSlidingMoves([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]], 5),
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
    if (!gameState || gameState.gameOver || isSpectating) return;
    const x = Math.floor(e.offsetX / CELL_SIZE), y = Math.floor(e.offsetY / CELL_SIZE);
    const pieceIdx = gameState.pieces.findIndex(p => p.x === x && p.y === y && p.team === team && p.cooldown === 0);

    console.log(`Clicked at (${x}, ${y}), pieceIdx: ${pieceIdx}, selectedPiece: ${selectedPiece}, piece state:`, pieceIdx !== -1 ? gameState.pieces[pieceIdx] : 'none');

    if (pieceIdx !== -1) {
        if (selectedPiece === pieceIdx) {
            selectedPiece = null;
            console.log('Piece deselected:', gameState.pieces[pieceIdx]);
        } else {
            selectedPiece = pieceIdx;
            console.log('Piece selected:', gameState.pieces[pieceIdx]);
        }
    } else if (selectedPiece !== null) {
        socket.emit('move', { pieceIdx: selectedPiece, targetX: x, targetY: y });
        console.log('Move sent:', { pieceIdx: selectedPiece, targetX: x, targetY: y });
        selectedPiece = null;
    } else {
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
