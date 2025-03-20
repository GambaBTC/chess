const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const { Connection, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Constants
const BOARD_SIZE = 35;
const HILL_HOLD_TIME = 45; // seconds
const INACTIVITY_TIMEOUT = 90; // seconds (90 seconds for inactivity timeout)
const GAME_OFFER_TIMEOUT = 15; // seconds (15 seconds to accept game offer)
const SOLANA_PRIZE = 0.005; // SOL
const MOVE_DURATION = 0.2; // seconds
const SHRINE_DELETE_CHANCE = 0.20;
const TERRAIN_GRASS = 0, TERRAIN_FOREST = 1, TERRAIN_WATER = 2;

// Connect to Solana Mainnet
const connection = new Connection('https://api.mainnet-beta.solana.com');

// Load the private key from environment variable
const serverKeypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY || '[]'))
);
console.log('Server Public Key:', serverKeypair.publicKey.toBase58());

app.use(express.static('public'));

const playerPool = []; // Queue of players waiting to play
let currentGame = null; // Track the current active game
const spectators = []; // List of spectators

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Notify the client of a server restart (in case they reconnect after a restart)
    socket.emit('serverRestart');

    socket.on('join', (solAddress) => {
        if (!solAddress) return socket.disconnect();
        console.log(`Player ${socket.id} joined with SOL address: ${solAddress}`);

        // If a game is already active, add the player to the queue
        if (currentGame) {
            playerPool.push({ socket, solAddress, accepted: false });
            socket.emit('waiting', `Waiting for an opponent... You are in the queue (${playerPool.length} players waiting)`);
            // Add to spectators so they can watch the current game
            spectators.push(socket);
            socket.emit('spectate', currentGame.getFullState());
            // Broadcast updated queue size to all clients
            io.emit('queueUpdate', playerPool.length);
        } else {
            // No active game, add to player pool and try to start a game
            playerPool.push({ socket, solAddress, accepted: false });
            socket.emit('waiting', `Waiting for an opponent... You are in the queue (${playerPool.length} players waiting)`);
            io.emit('queueUpdate', playerPool.length);

            // If there are at least 2 players in the pool, start a game
            if (playerPool.length >= 2 && !currentGame) {
                startGameFromQueue();
            }
        }
    });

    socket.on('joinQueue', (solAddress) => {
        if (!solAddress) return socket.disconnect();
        console.log(`Player ${socket.id} rejoined queue with SOL address: ${solAddress}`);

        // Add the player back to the queue
        if (currentGame) {
            playerPool.push({ socket, solAddress, accepted: false });
            socket.emit('waiting', `Waiting for an opponent... You are in the queue (${playerPool.length} players waiting)`);
            // Add to spectators
            spectators.push(socket);
            socket.emit('spectate', currentGame.getFullState());
            io.emit('queueUpdate', playerPool.length);
        } else {
            playerPool.push({ socket, solAddress, accepted: false });
            socket.emit('waiting', `Waiting for an opponent... You are in the queue (${playerPool.length} players waiting)`);
            io.emit('queueUpdate', playerPool.length);

            if (playerPool.length >= 2 && !currentGame) {
                startGameFromQueue();
            }
        }
    });

    socket.on('acceptGame', () => {
        const player = playerPool.find(p => p.socket.id === socket.id);
        if (player) {
            player.accepted = true;
            console.log(`Player ${socket.id} accepted game offer`);

            // Check if both selected players have accepted
            const readyPlayers = playerPool.filter(p => p.accepted);
            if (readyPlayers.length >= 2 && !currentGame) {
                const player1 = readyPlayers[0];
                const player2 = readyPlayers[1];
                playerPool.splice(playerPool.indexOf(player1), 1);
                playerPool.splice(playerPool.indexOf(player2), 1);
                console.log('Starting game between', player1.socket.id, 'and', player2.socket.id);
                currentGame = new Game(player1, player2);
                currentGame.start();
                io.emit('queueUpdate', playerPool.length);
            }
        }
    });

    socket.on('move', (data) => {
        if (currentGame) {
            currentGame.handleMove(socket.id, data);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        // Remove from player pool if they were in the queue
        const playerIdx = playerPool.findIndex(p => p.socket.id === socket.id);
        if (playerIdx !== -1) {
            playerPool.splice(playerIdx, 1);
            io.emit('queueUpdate', playerPool.length);
        }
        // Remove from spectators
        const spectatorIdx = spectators.findIndex(s => s.id === socket.id);
        if (spectatorIdx !== -1) {
            spectators.splice(spectatorIdx, 1);
        }
        // If the player was in the current game, end the game
        if (currentGame && (currentGame.player1.socket.id === socket.id || currentGame.player2.socket.id === socket.id)) {
            currentGame.endGame(currentGame.player1.socket.id === socket.id ? 1 : 0, "opponent_disconnect");
            currentGame = null;
            // Start a new game if there are enough players in the queue
            if (playerPool.length >= 2) {
                startGameFromQueue();
            }
            io.emit('queueUpdate', playerPool.length);
        }
    });

    socket.on('getBalance', async () => {
        try {
            const balance = await connection.getBalance(serverKeypair.publicKey);
            socket.emit('serverBalance', balance / LAMPORTS_PER_SOL);
        } catch (err) {
            console.error('Failed to fetch balance:', err);
            socket.emit('serverBalance', 'Error');
        }
    });
});

function startGameFromQueue() {
    if (playerPool.length < 2) return;

    // Select the first two players
    const player1 = playerPool[0];
    const player2 = playerPool[1];

    // Emit game offer to both players
    player1.socket.emit('gameOffer', GAME_OFFER_TIMEOUT);
    player2.socket.emit('gameOffer', GAME_OFFER_TIMEOUT);

    // Set a timeout to check if players accept
    setTimeout(() => {
        if (!currentGame) { // Only proceed if a game hasn't already started
            // Check if players accepted
            const player1Accepted = playerPool.find(p => p.socket.id === player1.socket.id)?.accepted || false;
            const player2Accepted = playerPool.find(p => p.socket.id === player2.socket.id)?.accepted || false;

            if (!player1Accepted) {
                console.log(`Player ${player1.socket.id} did not accept game offer, removing from queue`);
                playerPool.splice(playerPool.findIndex(p => p.socket.id === player1.socket.id), 1);
                player1.socket.emit('queueUpdate', playerPool.length);
            }
            if (!player2Accepted) {
                console.log(`Player ${player2.socket.id} did not accept game offer, removing from queue`);
                playerPool.splice(playerPool.findIndex(p => p.socket.id === player2.socket.id), 1);
                player2.socket.emit('queueUpdate', playerPool.length);
            }

            // Try to start a new game with the remaining players
            if (playerPool.length >= 2) {
                startGameFromQueue();
            }
            io.emit('queueUpdate', playerPool.length);
        }
    }, GAME_OFFER_TIMEOUT * 1000);
}

class Piece {
    constructor(team, type, x, y) {
        this.team = team;
        this.type = type;
        this.x = x;
        this.y = y;
        this.old_x = x;
        this.old_y = y;
        this.cooldown = 0;
        this.move_start_time = null;
        this.move_duration = MOVE_DURATION;

        // Bind methods to ensure `this` always refers to the Piece instance
        this.getLegalMoves = this.getLegalMoves.bind(this);
        this.getPawnMoves = this.getPawnMoves.bind(this);
        this.getKnightMoves = this.getKnightMoves.bind(this);
        this.getSlidingMoves = this.getSlidingMoves.bind(this);
        this.getKingMoves = this.getKingMoves.bind(this);
    }

    getLegalMoves(board, pieces) {
        console.log(`Getting legal moves for ${this.type} at (${this.x}, ${this.y})`);
        const moves = {
            "pawn": this.getPawnMoves,
            "knight": this.getKnightMoves,
            "bishop": this.getSlidingMoves.bind(this, board, pieces, [[-1, -1], [-1, 1], [1, -1], [1, 1]], 5),
            "rook": this.getSlidingMoves.bind(this, board, pieces, [[-1, 0], [1, 0], [0, -1], [0, 1]], 5),
            "queen": this.getSlidingMoves.bind(this, board, pieces, [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]], 5), // Reduced range from 7 to 5
            "king": this.getKingMoves
        };
        return moves[this.type](board, pieces);
    }

    getPawnMoves(board, pieces) {
        const moves = [];
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const captureDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const [dx, dy] of directions) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[nx][ny] !== TERRAIN_WATER) {
                const target = pieces.find(p => p.x === nx && p.y === ny);
                if (!target) {
                    moves.push([nx, ny]);
                }
            }
        }
        for (const [dx, dy] of captureDirections) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[nx][ny] !== TERRAIN_WATER) {
                const target = pieces.find(p => p.x === nx && p.y === ny);
                if (target && target.team !== this.team) {
                    moves.push([nx, ny]);
                }
            }
        }
        console.log(`Pawn at (${this.x}, ${this.y}) legal moves:`, moves);
        return moves;
    }

    getKnightMoves(board, pieces) {
        const moves = [];
        const knightMoves = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        for (const [dx, dy] of knightMoves) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[nx][ny] !== TERRAIN_WATER) {
                const target = pieces.find(p => p.x === nx && p.y === ny);
                if (!target || target.team !== this.team) {
                    moves.push([nx, ny]);
                }
            }
        }
        console.log(`Knight at (${this.x}, ${this.y}) legal moves:`, moves);
        return moves;
    }

    getSlidingMoves(board, pieces, directions, maxRange) {
        const moves = [];
        for (const [dx, dy] of directions) {
            for (let i = 1; i <= maxRange; i++) {
                const nx = this.x + dx * i, ny = this.y + dy * i;
                if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE || board[nx][ny] === TERRAIN_WATER) break;
                const target = pieces.find(p => p.x === nx && p.y === ny);
                if (target) {
                    if (target.team !== this.team) moves.push([nx, ny]);
                    break;
                }
                moves.push([nx, ny]);
            }
        }
        return moves;
    }

    getKingMoves(board, pieces) {
        const moves = [];
        const kingMoves = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (const [dx, dy] of kingMoves) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[nx][ny] !== TERRAIN_WATER) {
                const target = pieces.find(p => p.x === nx && p.y === ny);
                if (!target || target.team !== this.team) moves.push([nx, ny]);
            }
        }
        return moves;
    }
}

class Game {
    constructor(player1, player2) {
        this.player1 = player1;
        this.player2 = player2;
        this.board = this.generateBoard();
        this.pieces = this.placePieces();
        this.hill = { x: 17, y: 17 };
        this.hillOccupant = null;
        this.hillStartTime = null;
        this.shrines = this.placeShrines();
        this.interval = null;
        // Inactivity timers for each player
        this.player1LastMoveTime = Date.now();
        this.player2LastMoveTime = Date.now();
    }

    generateBoard() {
        const board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(TERRAIN_GRASS));
        const totalCells = BOARD_SIZE * BOARD_SIZE;
        const waterCells = Math.floor(totalCells * 0.1);
        const forestCells = Math.floor(totalCells * 0.1);

        for (let x = 12; x <= 21; x++) {
            for (let y = -1; y <= 2; y++) {
                if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) board[x][y] = TERRAIN_GRASS;
            }
            for (let y = 32; y <= 35; y++) {
                if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) board[x][y] = TERRAIN_GRASS;
            }
        }

        let placedWater = 0;
        while (placedWater < waterCells) {
            const x = Math.floor(Math.random() * BOARD_SIZE);
            const y = Math.floor(Math.random() * BOARD_SIZE);
            if (board[x][y] === TERRAIN_GRASS 
                && !(x >= 12 && x <= 21 && y <= 2) 
                && !(x >= 12 && x <= 21 && y >= 32) 
                && (x !== 17 || y !== 17)) {
                board[x][y] = TERRAIN_WATER;
                placedWater++;
            }
        }

        let placedForest = 0;
        while (placedForest < forestCells) {
            const x = Math.floor(Math.random() * BOARD_SIZE);
            const y = Math.floor(Math.random() * BOARD_SIZE);
            if (board[x][y] === TERRAIN_GRASS 
                && !(x >= 12 && x <= 21 && y <= 2) 
                && !(x >= 12 && x <= 21 && y >= 32) 
                && (x !== 17 || y !== 17)) {
                board[x][y] = TERRAIN_FOREST;
                placedForest++;
            }
        }

        board[17][17] = TERRAIN_GRASS;
        return board;
    }

    placePieces() {
        const pieces = [];
        const placeTeam = (team, xStart, pawnRow, backRow) => {
            for (let i = 0; i < 8; i++) {
                const pawn = new Piece(team, "pawn", xStart + i, pawnRow);
                console.log(`Placed pawn for team ${team} at (${pawn.x}, ${pawn.y})`);
                pieces.push(pawn);
            }
            const backPieces = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];
            for (let i = 0; i < 8; i++) {
                const piece = new Piece(team, backPieces[i], xStart + i, backRow);
                console.log(`Placed ${backPieces[i]} for team ${team} at (${piece.x}, ${piece.y})`);
                pieces.push(piece);
            }
        };

        placeTeam(0, 13, 33, 34); // Team 0: pawns on 33, pieces on 34
        placeTeam(1, 13, 1, 0);   // Team 1: pawns on 1, pieces on 0
        return pieces;
    }

    placeShrines() {
        const shrineCount = Math.floor(BOARD_SIZE * BOARD_SIZE * 0.01);
        const shrines = [];
        const possiblePositions = [];

        for (let x = 0; x < BOARD_SIZE; x++) {
            for (let y = 0; y < BOARD_SIZE; y++) {
                if (this.board[x][y] === TERRAIN_GRASS 
                    && !(x >= 12 && x <= 21 && y <= 2) 
                    && !(x >= 12 && x <= 21 && y >= 32) 
                    && !(x === 17 || y === 17)) {
                    possiblePositions.push([x, y]);
                }
            }
        }

        for (let i = 0; i < Math.min(shrineCount, possiblePositions.length); i++) {
            const idx = Math.floor(Math.random() * possiblePositions.length);
            shrines.push(possiblePositions.splice(idx, 1)[0]);
        }

        console.log('Shrines placed at:', shrines);
        return shrines;
    }

    start() {
        const state = this.getFullState();
        this.player1.socket.emit('gameStart', { team: 0, state });
        this.player2.socket.emit('gameStart', { team: 1, state });
        // Send the initial game state to all spectators
        spectators.forEach(spectator => {
            spectator.emit('spectate', state);
        });
        console.log(`Game started for players ${this.player1.socket.id} and ${this.player2.socket.id}`);
        this.interval = setInterval(() => this.update(), 100); // 10 FPS for lightweight updates
    }

    update() {
        const currentTime = Date.now();
        let changed = false;

        for (let i = 0; i < this.pieces.length; i++) {
            const piece = this.pieces[i];
            if (piece && piece.cooldown > 0) {
                piece.cooldown = Math.max(0, piece.cooldown - 100);
                changed = true;
            }
        }

        const hillPiece = this.pieces.find(p => p.x === this.hill.x && p.y === this.hill.y);
        if (hillPiece) {
            if (this.hillOccupant === hillPiece.team) {
                if (currentTime - this.hillStartTime >= HILL_HOLD_TIME * 1000) {
                    this.endGame(hillPiece.team, "hill_conquest");
                    return;
                }
            } else {
                this.hillOccupant = hillPiece.team;
                this.hillStartTime = currentTime;
                changed = true;
            }
        } else if (this.hillOccupant !== null) {
            this.hillOccupant = null;
            this.hillStartTime = null;
            changed = true;
        }

        // Check inactivity timers for both players
        const player1TimeLeft = INACTIVITY_TIMEOUT * 1000 - (currentTime - this.player1LastMoveTime);
        const player2TimeLeft = INACTIVITY_TIMEOUT * 1000 - (currentTime - this.player2LastMoveTime);

        // Check if both players are inactive
        if (player1TimeLeft <= 0 && player2TimeLeft <= 0) {
            this.endGame(null, "dual_inactivity"); // Both players lose
            return;
        }

        // Check if only one player is inactive
        if (player1TimeLeft <= 0) {
            this.endGame(1, "inactivity_timeout"); // Player 1 (Team 0) loses
            return;
        }
        if (player2TimeLeft <= 0) {
            this.endGame(0, "inactivity_timeout"); // Player 2 (Team 1) loses
            return;
        }

        // Always send an update to include the timers, even if no pieces are in cooldown
        const delta = this.getDeltaState();
        delta.player1Timer = player1TimeLeft / 1000; // Convert to seconds
        delta.player2Timer = player2TimeLeft / 1000; // Convert to seconds
        this.player1.socket.emit('update', delta);
        this.player2.socket.emit('update', delta);
        // Send delta updates to all spectators
        spectators.forEach(spectator => {
            spectator.emit('update', delta);
        });

        // Send piece updates only if something changed (to reduce network traffic)
        if (this.hillOccupant !== null || changed) {
            // Already sent above, no need to send again
        }
    }

    handleMove(socketId, { pieceIdx, targetX, targetY }) {
        const team = this.player1.socket.id === socketId ? 0 : 1;
        const piece = this.pieces[pieceIdx];
        if (!piece || piece.team !== team || piece.cooldown > 0) {
            console.log('Move rejected:', { pieceIdx, targetX, targetY, reason: 'invalid piece or cooldown' });
            return;
        }

        console.log(`Handling move for ${piece.type} at (${piece.x}, ${piece.y}) to (${targetX}, ${targetY})`);
        const legalMoves = piece.getLegalMoves(this.board, this.pieces);
        if (!legalMoves.some(([x, y]) => x === targetX && y === targetY)) {
            console.log('Move rejected:', { pieceIdx, targetX, targetY, reason: 'illegal move', legalMoves });
            return;
        }

        const targetPieceIdx = this.pieces.findIndex(p => p.x === targetX && p.y === targetY);
        if (targetPieceIdx !== -1) {
            const targetPiece = this.pieces[targetPieceIdx];
            if (targetPiece.team === piece.team) {
                console.log('Move rejected:', { pieceIdx, targetX, targetY, reason: 'friendly piece at target' });
                return;
            }
            this.pieces.splice(targetPieceIdx, 1);
            if (targetPiece.type === 'king') {
                this.endGame(team, "king_capture");
                return;
            }
        }

        const shrineIdx = this.shrines.findIndex(([x, y]) => x === targetX && y === targetY);
        piece.old_x = piece.x; piece.old_y = piece.y;
        piece.x = targetX; piece.y = targetY;
        piece.move_start_time = Date.now();
        piece.cooldown = (this.board[targetX][targetY] === TERRAIN_FOREST ? 10 : 5) * 1000; // Increased cooldown: 5s on grass, 10s on forest

        // Reset the inactivity timer for the player who made the move
        if (team === 0) {
            this.player1LastMoveTime = Date.now();
        } else {
            this.player2LastMoveTime = Date.now();
        }
        
        if (shrineIdx !== -1) {
            this.shrines.splice(shrineIdx, 1);
            if (Math.random() < SHRINE_DELETE_CHANCE) {
                this.pieces.splice(pieceIdx, 1);
            } else {
                const newX = targetX + 1;
                if (newX < BOARD_SIZE && !this.pieces.find(p => p.x === newX && p.y === targetY)) {
                    this.pieces.push(new Piece(team, piece.type, newX, targetY));
                }
            }
        }

        console.log('Move accepted:', { pieceIdx, targetX, targetY });
        const state = this.getFullState();
        this.player1.socket.emit('update', state);
        this.player2.socket.emit('update', state);
        // Send the updated state to all spectators
        spectators.forEach(spectator => {
            spectator.emit('update', state);
        });
    }

    async endGame(winnerTeam, reason) {
        clearInterval(this.interval);
        const state = this.getFullState();
        state.gameOver = true;
        state.winner = winnerTeam;
        state.winReason = reason;
        console.log(`Game ended: ${winnerTeam !== null ? `Team ${winnerTeam} won by ${reason}` : `No winner due to ${reason}`}`);

        // Send game over state to players and spectators
        if (winnerTeam !== null) {
            const winner = winnerTeam === 0 ? this.player1 : this.player2;
            const loser = winnerTeam === 0 ? this.player2 : this.player1;
            winner.socket.emit('gameOver', state);
            loser.socket.emit('gameOver', state);
            // Send game over state to all spectators
            spectators.forEach(spectator => {
                spectator.emit('gameOver', state);
            });

            try {
                const txId = await sendSol(winner.solAddress, SOLANA_PRIZE);
                console.log(`Prize sent to ${winner.solAddress}: ${txId}`);
            } catch (err) {
                console.error('SOLANA transaction failed:', err);
            }
        } else {
            // Both players lose (dual inactivity)
            this.player1.socket.emit('gameOver', state);
            this.player2.socket.emit('gameOver', state);
            spectators.forEach(spectator => {
                spectator.emit('gameOver', state);
            });
        }

        // Clear the current game
        currentGame = null;

        // Start a new game if there are enough players in the queue
        if (playerPool.length >= 2) {
            startGameFromQueue();
        }

        // Broadcast updated queue size
        io.emit('queueUpdate', playerPool.length);
    }

    getFullState() {
        return {
            serverTime: Date.now(),
            board: this.board,
            pieces: this.pieces.map(p => ({
                team: p.team,
                type: p.type,
                x: p.x,
                y: p.y,
                old_x: p.old_x,
                old_y: p.old_y,
                cooldown: p.cooldown,
                move_start_time: p.move_start_time
            })),
            hill: this.hill,
            hillOccupant: this.hillOccupant,
            hillTimer: this.hillStartTime ? (Date.now() - this.hillStartTime) / 1000 : 0,
            shrines: this.shrines,
            gameOver: false,
            winner: null,
            winReason: null,
            player1Timer: INACTIVITY_TIMEOUT - (Date.now() - this.player1LastMoveTime) / 1000,
            player2Timer: INACTIVITY_TIMEOUT - (Date.now() - this.player2LastMoveTime) / 1000
        };
    }

    getDeltaState() {
        return {
            serverTime: Date.now(),
            pieces: this.pieces.map(p => ({
                team: p.team,
                type: p.type,
                x: p.x,
                y: p.y,
                cooldown: p.cooldown
            })), // Include all pieces, not just those with cooldown > 0
            hillOccupant: this.hillOccupant,
            hillTimer: this.hillStartTime ? (Date.now() - this.hillStartTime) / 1000 : 0,
            player1Timer: INACTIVITY_TIMEOUT - (Date.now() - this.player1LastMoveTime) / 1000,
            player2Timer: INACTIVITY_TIMEOUT - (Date.now() - this.player2LastMoveTime) / 1000
        };
    }
}

async function sendSol(toAddress, amount) {
    const toPubkey = new PublicKey(toAddress);
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: serverKeypair.publicKey,
            toPubkey: toPubkey,
            lamports: amount * LAMPORTS_PER_SOL
        })
    );
    const signature = await sendAndConfirmTransaction(connection, transaction, [serverKeypair]);
    return signature;
}

server.listen(3000, () => console.log('Server running on port 3000'));
