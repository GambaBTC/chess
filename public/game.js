const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const CELL_SIZE = 20;
const BOARD_SIZE = 35;
const HILL_HOLD_TIME = 30;

canvas.width = BOARD_SIZE * CELL_SIZE;
canvas.height = BOARD_SIZE * CELL_SIZE;

let gameState = null;
let team = null;
let selectedPiece = null;

socket.on('gameStart', (data) => {
    team = data.team;
    gameState = data.state;
    console.log(`Game started as Team ${team}. Server SOL balance: ${data.serverBalance}`);
    document.getElementById('balanceDisplay').innerText = `Server SOL: ${data.serverBalance}`;
    requestAnimationFrame(render);
});

socket.on('update', (state) => {
    gameState = state;
});

socket.on('serverBalanceUpdate', (balance) => {
    document.getElementById('balanceDisplay').innerText = `Server SOL: ${balance}`;
});

socket.on('gameOver', (state) => {
    gameState = state;
    alert(`Game Over! Winner: Team ${state.winner}. Reason: ${state.winReason}`);
});

function render() {
    if (!gameState) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw board
    for (let x = 0; x < BOARD_SIZE; x++) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            ctx.fillStyle = gameState.board[x][y] === 2 ? '#00f' : gameState.board[x][y] === 1 ? '#060' : '#0a0';
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }

    // Draw hill with capture progress
    ctx.fillStyle = '#ff0';
    ctx.fillRect(gameState.hill.x * CELL_SIZE, gameState.hill.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    if (gameState.hillOccupant !== null) {
        const teamColor = gameState.hillOccupant === 0 ? '#fff' : '#f00'; // White for Team 0, Red for Team 1
        const progress = (gameState.hillTimer / HILL_HOLD_TIME) * CELL_SIZE;
        ctx.fillStyle = teamColor;
        ctx.fillRect(gameState.hill.x * CELL_SIZE, gameState.hill.y * CELL_SIZE + CELL_SIZE - 5, progress, 5); // Progress bar
        ctx.fillStyle = '#000';
        ctx.font = '10px Arial';
        const timeLeft = (HILL_HOLD_TIME - gameState.hillTimer).toFixed(1);
        ctx.fillText(`${timeLeft}s`, gameState.hill.x * CELL_SIZE + 2, gameState.hill.y * CELL_SIZE + 10); // Countdown
    }

    // Draw shrines
    gameState.shrines.forEach(s => {
        ctx.fillStyle = '#ccc';
        ctx.fillRect(s[0] * CELL_SIZE, s[1] * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });

    // Draw pieces (simplified)
    gameState.pieces.forEach((p, i) => {
        ctx.fillStyle = p.team === 0 ? '#fff' : '#f00';
        ctx.fillRect(p.x * CELL_SIZE, p.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.fillStyle = '#000';
        ctx.fillText(p.type[0], p.x * CELL_SIZE + 5, p.y * CELL_SIZE + 15);
    });

    if (!gameState.gameOver) requestAnimationFrame(render);
}

// Add this HTML element to display balance
// <div id="balanceDisplay">Server SOL: 0</div>
