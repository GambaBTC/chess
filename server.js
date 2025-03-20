const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const { Connection, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Constants
const BOARD_SIZE = 35;
const HILL_HOLD_TIME = 30; // seconds
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

const playerPool = [];
const games = [];

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    socket.on('join', (solAddress) => {
        if (!solAddress) return socket.disconnect();
        console.log(`Player ${socket.id} joined with SOL address: ${solAddress}`);
        playerPool.push({ socket, solAddress });
        socket.emit('waiting', 'Waiting for an opponent...');
        if (playerPool.length >= 2) {
            const player1 = playerPool.shift();
            const player2 = playerPool.shift();
            console.log('Starting game between', player1.socket.id, 'and', player2.socket.id);
            const game = new Game(player1, player2);
            games.push(game);
            game.start();
        }
    });

    socket.on('move', (data) => {
        const game = games.find(g => g.player1.socket.id === socket.id || g.player2.socket.id === socket.id);
        if (game) game.handleMove(socket.id, data);
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        const gameIdx = games.findIndex(g => g.player1.socket.id === socket.id || g.player2.socket.id === socket.id);
        if (gameIdx !== -1) {
            const game = games[gameIdx];
            game.endGame(game.player1.socket.id === socket.id ? 1 : 0, "opponent_disconnect");
            games.splice(gameIdx, 1);
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
    }

    getLegalMoves(board, pieces) {
        const moves = {
            "pawn": this.getPawnMoves,
            "knight": this.getKnightMoves,
            "bishop": () => this.getSlidingMoves(board, pieces, [[-1, -1], [-1, 1], [1, -1], [1, 1]], 5),
            "rook": () => this.getSlidingMoves(board, pieces, [[-1, 0], [1, 0], [0, -1], [0, 1]], 5),
            "queen": () => this.getSlidingMoves(board, pieces, [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]], 7),
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
                pieces.push(new Piece(team, "pawn", xStart + i, pawnRow));
            }
            const backPieces = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];
            for (let i = 0; i < 8; i++) {
                pieces.push(new Piece(team, backPieces[i], xStart + i, backRow));
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
                    && !(x === 17 && y === 17)) {
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

        if (changed) {
            const delta = this.getDeltaState();
            this.player1.socket.emit('update', delta);
            this.player2.socket.emit('update', delta);
        }
    }

    handleMove(socketId, { pieceIdx, targetX, targetY }) {
        const team = this.player1.socket.id === socketId ? 0 : 1;
        const piece = this.pieces[pieceIdx];
        if (!piece || piece.team !== team || piece.cooldown > 0) {
            console.log('Move rejected:', { pieceIdx, targetX, targetY, reason: 'invalid piece or cooldown' });
            return;
        }

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
        piece.cooldown = (this.board[targetX][targetY] === TERRAIN_FOREST ? 2 : 1) * 1500;
        
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
    }

    async endGame(winnerTeam, reason) {
        clearInterval(this.interval);
        const winner = winnerTeam === 0 ? this.player1 : this.player2;
        const loser = winnerTeam === 0 ? this.player2 : this.player1;
        const state = this.getFullState();
        state.gameOver = true;
        state.winner = winnerTeam;
        state.winReason = reason;
        console.log(`Game ended: Team ${winnerTeam} won by ${reason}`);
        winner.socket.emit('gameOver', state);
        loser.socket.emit('gameOver', state);

        try {
            const txId = await sendSol(winner.solAddress, SOLANA_PRIZE);
            console.log(`Prize sent to ${winner.solAddress}: ${txId}`);
        } catch (err) {
            console.error('SOLANA transaction failed:', err);
        }
        games.splice(games.indexOf(this), 1);
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
            winReason: null
        };
    }

    getDeltaState() {
        return {
            serverTime: Date.now(),
            pieces: this.pieces.filter(p => p.cooldown > 0).map(p => ({
                team: p.team,
                type: p.type,
                x: p.x,
                y: p.y,
                cooldown: p.cooldown
            })),
            hillOccupant: this.hillOccupant,
            hillTimer: this.hillStartTime ? (Date.now() - this.hillStartTime) / 1000 : 0
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
