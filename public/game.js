const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const hillBar = document.getElementById('hillBar');
const balanceDisplay = document.getElementById('balanceDisplay');
const CELL_SIZE = canvas.width / 35;
const MOVE_DURATION = 0.2;
const BOARD_SIZE = 35;
const HILL_HOLD_TIME = 30;
const TERRAIN_WATER = 2;
const TERRAIN_FOREST = 1;

let team, gameState, offset, selectedPiece = null;

// Prompt for Solana address after DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    let solAddress = prompt('Enter your SOLANA address:');
    if (solAddress && solAddress.trim() !== '') {
        socket.emit('join', solAddress);
        socket.emit('getBalance'); // Request server balance on load
    } else {
        alert('A valid Solana address is required to play.');
        window.location.reload();
    }
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
    console.log('Game state initialized:', gameState);
    render();
});

socket.on('update', (state) => {
    console.log('Update received:', state);
    gameState = state;
    offset = Date.now() - state.serverTime;
    render(); // Ensure render is called on every update
});

socket.on('gameOver', (state) => {
    gameState = state;
    statusDiv.textContent = state.winner === team ? `You won by ${state.winReason}! 0.005 SOL sent.` : `You lost by ${state.winReason}.`;
    console.log('Game over:', state);
    setTimeout(() => {
        let solAddress = prompt('Enter your SOLANA address to play again:');
        if (solAddress && solAddress.trim() !== '') {
            socket.emit('join', solAddress);
            socket.emit('getBalance');
        } else {
            alert('A valid Solana address is required to play.');
            window.location.reload();
        }
    }, 3000);
});

socket.on('serverBalance', (balance) => {
    balanceDisplay.textContent = `Server SOL: ${typeof balance === 'string' ? balance : balance.toFixed(4)} SOL`;
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
        ctx.fillStyle = `rgba(255, 0, 0, ${piece.cooldown / 3000})`;
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

    // Draw board
    for (let x = 0; x < BOARD_SIZE; x++) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            ctx.fillStyle = gameState.board[x][y] === TERRAIN_WATER ? '#00f' : gameState.board[x][y] === TERRAIN_FOREST ? '#060' : '#0a0';
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }

    // Draw hill
    ctx.fillStyle = '#ff0';
    ctx.fillRect(gameState.hill.x * CELL_SIZE, gameState.hill.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    if (gameState.hillOccupant !== null) {
        hillBar.innerHTML = `<div id="hillProgress" style="width: ${gameState.hillTimer / HILL_HOLD_TIME * 100}%; background: ${gameState.hillOccupant === 0 ? '#fff' : '#f00'}"></div>`;
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.fillText(`${gameState.hillTimer.toFixed(1)}/${HILL_HOLD_TIME}s`, gameState.hill.x * CELL_SIZE + 2, gameисаState.hill.y * CELL_SIZE + 12);
    } else {
        hillBar.innerHTML = '';
    }

    // Draw shrines
    gameState.shrines.forEach(s => {
        ctx.fillStyle = '#ccc';
        ctx.fillRect(s[0] * CELL_SIZE, s[1] * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });

    // Draw pieces and legal moves
    gameState.pieces.forEach((p, i) => {
        drawPiece(p, i === selectedPiece);
        if (i === selectedPiece) {
            const legalMoves = calculateLegalMoves(p);
            ctx.fillStyle = 'rgba(255, 255, 0, 0.5)';
            legalMoves.forEach(([mx, my]) => ctx.fillRect(mx * CELL_SIZE, my * CELL_SIZE, CELL_SIZE, CELL_SIZE));
        }
    });

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
        "queen": () => getSlidingMoves([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]], 7),
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
    if (!gameState || gameState.gameOver) return;
    const x = Math.floor(e.offsetX / CELL_SIZE), y = Math.floor(e.offsetY / CELL_SIZE);
    const pieceIdx = gameState.pieces.findIndex(p => p.x === x && p.y === y && p.team === team && p.cooldown === 0);
    if (pieceIdx !== -1 && selectedPiece === null) {
        selectedPiece = pieceIdx;
        console.log('Piece selected:', gameState.pieces[pieceIdx]);
    } else if (selectedPiece !== null) {
        socket.emit('move', { pieceIdx: selectedPiece, targetX: x, targetY: y });
        console.log('Move sent:', { pieceIdx: selectedPiece, targetX: x, targetY: y });
        selectedPiece = null;
    }
});

ctx.polygon = function(points) {
    this.beginPath();
    this.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) this.lineTo(points[i][0], points[i][1]);
    this.closePath();
};
