const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const CELL_SIZE = canvas.width / 35;
const MOVE_DURATION = 0.2;

let solAddress = prompt('Enter your SOLANA address:');
if (solAddress) socket.emit('join', solAddress);

let team, gameState, offset, selectedPiece = null;

socket.on('waiting', (message) => {
    statusDiv.textContent = message;
    console.log('Waiting message received:', message);
});

socket.on('gameStart', (data) => {
    console.log('Game started with data:', data);
    team = data.team;
    gameState = data.state;
    offset = Date.now() - data.state.serverTime;
    statusDiv.textContent = `Playing as Team ${team}`;
    render();
});

socket.on('update', (state) => {
    gameState = state;
    offset = Date.now() - state.serverTime;
    console.log('Game state updated:', state);
});

socket.on('gameOver', (state) => {
    gameState = state;
    const message = state.winner === team ? `You won by ${state.winReason}! 0.01 SOL sent to your address.` : `You lost by ${state.winReason}.`;
    statusDiv.textContent = message;
    console.log('Game over:', message);
    setTimeout(() => {
        solAddress = prompt('Enter your SOLANA address to play again:');
        if (solAddress) socket.emit('join', solAddress);
    }, 3000);
});

function render() {
    if (!gameState) {
        console.error('No gameState to render');
        return;
    }
    const currentTime = Date.now() - offset;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let x = 0; x < 35; x++) {
        for (let y = 0; y < 35; y++) {
            ctx.fillStyle = gameState.board[x][y] === 'water' ? '#00f' : gameState.board[x][y] === 'forest' ? '#060' : '#0a0';
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }

    ctx.fillStyle = '#ff0';
    ctx.fillRect(gameState.hill.x * CELL_SIZE, gameState.hill.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    if (gameState.hillOccupant !== null) {
        ctx.fillStyle = gameState.hillOccupant === 0 ? 'rgba(255,0,0,0.5)' : 'rgba(0,0,255,0.5)';
        ctx.fillRect(gameState.hill.x * CELL_SIZE, gameState.hill.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.fillText(gameState.hillTimer.toFixed(1), gameState.hill.x * CELL_SIZE + 2, gameState.hill.y * CELL_SIZE + 12);
    }

    gameState.shrines.forEach(s => {
        ctx.fillStyle = '#ccc';
        ctx.fillRect(s.x * CELL_SIZE, s.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });

    gameState.pieces.forEach((p, i) => {
        let x = p.x, y = p.y;
        if (p.moveStartTime && p.targetX !== null && p.targetY !== null) {
            const elapsed = (currentTime - p.moveStartTime) / 1000;
            const t = Math.min(elapsed / MOVE_DURATION, 1);
            x = p.x + (p.targetX - p.x) * t;
            y = p.y + (p.targetY - p.y) * t;
            if (t >= 1) {
                p.targetX = null;
                p.targetY = null;
            }
        }
        ctx.fillStyle = p.team === 0 ? '#f00' : '#00f';
        ctx.beginPath();
        ctx.arc(x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2, CELL_SIZE / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        if (p.cooldownEndTime) {
            const remaining = (p.cooldownEndTime - currentTime) / 1000;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(remaining.toFixed(1), x * CELL_SIZE + 2, y * CELL_SIZE + 12);
        }
        if (i === selectedPiece) {
            ctx.strokeStyle = '#0f0';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    if (!gameState.gameOver) requestAnimationFrame(render);
}

canvas.addEventListener('click', (e) => {
    if (!gameState || gameState.gameOver) return;
    const x = Math.floor(e.offsetX / CELL_SIZE);
    const y = Math.floor(e.offsetY / CELL_SIZE);
    const pieceIdx = gameState.pieces.findIndex(p => p.x === x && p.y === y && p.team === team && !p.cooldownEndTime);
    if (pieceIdx !== -1 && selectedPiece === null) {
        selectedPiece = pieceIdx;
        console.log('Piece selected:', gameState.pieces[pieceIdx]);
    } else if (selectedPiece !== null) {
        socket.emit('move', { pieceIdx: selectedPiece, targetX: x, targetY: y });
        console.log('Move sent:', { pieceIdx: selectedPiece, targetX: x, targetY: y });
        selectedPiece = null;
    }
});
