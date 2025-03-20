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

    // Add balance request handler
    socket.on('getBalance', async () => {
        const balance = await connection.getBalance(serverKeypair.publicKey);
        socket.emit('serverBalance', balance / LAMPORTS_PER_SOL);
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

    getLegalMoves(grid, pieces) {
        const moves = {
            "pawn": this.getPawnMoves,
            "knight": this.getKnightMoves,
            "bishop": () => this.getSlidingMoves(grid, pieces, [[-1, -1], [-1, 1], [1, -1], [1, 1]], 5),
            "rook": () => this.getSlidingMoves(grid, pieces, [[-1, 0], [1, 0], [0, -1], [0, 1]], 5),
            "queen": () => this.getSlidingMoves(grid, pieces, [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]], 7),
            "king": this.getKingMoves
        };
        return moves[this.type](grid, pieces);
    }

    getPawnMoves(grid, pieces) {
        const moves = [];
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // Omnidirectional movement
        const captureDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]]; // Diagonal captures
        for (const [dx, dy] of directions) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && grid[nx][ny] !== TERRAIN_WATER && !pieces[nx]?.[ny]) {
                moves.push([nx, ny]);
            }
        }
        for (const [dx, dy] of captureDirections) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && pieces[nx]?.[ny]?.team !== this.team) {
                moves.push([nx, ny]);
            }
        }
        return moves;
    }

    getKnightMoves(grid, pieces) {
        const moves = [];
        const knightMoves = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        for (const [dx, dy] of knightMoves) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && grid[nx][ny] !== TERRAIN_WATER &&
                (!pieces[nx]?.[ny] || pieces[nx][ny].team !== this.team)) {
                moves.push([nx, ny]);
            }
        }
        return moves;
    }

    getSlidingMoves(grid, pieces, directions, maxRange) {
        const moves = [];
        for (const [dx, dy] of directions) {
            for (let i = 1; i <= maxRange; i++) {
                const nx = this.x + dx * i, ny = this.y + dy * i;
                if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE || grid[nx][ny] === TERRAIN_WATER) break;
                if (pieces[nx]?.[ny]) {
                    if (pieces[nx][ny].team !== this.team) moves.push([nx, ny]);
                    break;
                }
                moves.push([nx, ny]);
            }
        }
        return moves;
    }

    getKingMoves(grid, pieces) {
        const moves = [];
        const kingMoves = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (const [dx, dy] of kingMoves) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && grid[nx][ny] !== TERRAIN_WATER &&
                (!pieces[nx]?.[ny] || pieces[nx][ny].team !== this.team)) {
                moves.push([nx, ny]);
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

        // Ensure spawn areas (13-20, 0-1 and 13-20, 33-34) and 1 square around are grass
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
            if (board[x][y] === TERRAIN_GRASS && 
                !(x >= 12 && x <= 21 && y <= 2) && 
                !(x >= 12 && x <= 21 && y >= 32) && 
                (x !== 17 || y !== 17)) {
                board[x][y] = TERRAIN_WATER;
                placedWater++;
            }
        }

        let placedForest = 0;
        while (placedForest < forestCells) {
            const x = Math.floor(Math.random() * BOARD_SIZE);
            const y = Math.floor(Math.random() * BOARD_SIZE);
            if (board[x][y] === TERRAIN_GRASS && 
                !(x >= 12 && x <= 21 && y <= 2) && 
                !(x >= 12 && x <= 21 && y >= 32) && 
                (x !== 17 || y !== 17)) {
                board[x][y] = TERRAIN_FOREST;
                placedForest++;
            }
        }

        board[17][17] = TERRAIN_GRASS; // Hill
        return board;
    }

    placePieces() {
        const pieces = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE));
        const placeTeam = (team, xStart, pawnRow, backRow) => {
            for (let i = 0; i < 8; i++) {
                pieces[xStart + i][pawnRow] = new Piece(team, "pawn", xStart + i, pawnRow);
            }
            const backPieces = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];
            for (let i = 0; i < 8; i++) {
                pieces[xStart + i][backRow] = new Piece(team, backPieces[i], xStart + i, backRow);
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
                if (this.board[x][y] === TERRAIN_GRASS && 
                    !(x >= 12 && x <= 21 && y <= 2) && 
                    !(x >= 12 && x <= 21 && y >= 32) && 
                    !(x === 17 && y === 17)) {
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
        const state = this.getState();
        this.player1.socket.emit('gameStart', { team: 0, state });
        this.player2.socket.emit('gameStart', { team: 1, state });
        console.log(`Game started for players ${this.player1.socket.id} and ${this.player2.socket.id}`);
        this.interval = setInterval(() => this.update(), 1000 / 60);
    }

    update() {
        const currentTime = Date.now();
        for (let x = 0; x < BOARD_SIZE; x++) {
            for (let y = 0; y < BOARD_SIZE; y++) {
                const piece = this.pieces[x]?.[y];
                if (piece && piece.cooldown > 0) {
                    piece.cooldown = Math.max(0, piece.cooldown - 1000 / 60);
                }
            }
        }

        const hillPiece = this.pieces[this.hill.x]?.[this.hill.y];
        if (hillPiece) {
            if (this.hillOccupant === hillPiece.team) {
                if (currentTime - this.hillStartTime >= HILL_HOLD_TIME * 1000) {
                    this.endGame(hillPiece.team, "hill_conquest");
                    return;
                }
            } else {
                this.hillOccupant = hillPiece.team;
                this.hillStartTime = currentTime;
            }
        } else {
            this.hillOccupant = null;
            this.hillStartTime = null;
        }

        const state = this.getState();
        this.player1.socket.emit('update', state);
        this.player2.socket.emit('update', state);
    }

    handleMove(socketId, { pieceIdx, targetX, targetY }) {
        const team = this.player1.socket.id === socketId ? 0 : 1;
        const piecesFlat = this.pieces.flat().filter(p => p);
        const piece = piecesFlat[pieceIdx];
        if (!piece || piece.team !== team || piece.cooldown > 0) return;

        const legalMoves = piece.getLegalMoves(this.board, this.pieces);
        if (!legalMoves.some(([x, y]) => x === targetX && y === targetY)) return;

        const targetPiece = this.pieces[targetX]?.[targetY];
        if (targetPiece && targetPiece.team === piece.team) return;

        if (targetPiece) {
            this.pieces[targetX][targetY] = null;
            if (targetPiece.type === 'king') {
                this.endGame(team, "king_capture");
                return;
            }
        }

        const shrineIdx = this.shrines.findIndex(([x, y]) => x === targetX && y === targetY);
        this.pieces[piece.x][piece.y] = null;
        piece.old_x = piece.x; piece.old_y = piece.y;
        piece.x = targetX; piece.y = targetY;
        piece.move_start_time = Date.now();
        piece.cooldown = (this.board[targetX][targetY] === TERRAIN_FOREST ? 2 : 1) * 1500;
        this.pieces[targetX][targetY] = piece;

        if (shrineIdx !== -1) {
            this.shrines.splice(shrineIdx, 1);
            if (Math.random() < SHRINE_DELETE_CHANCE) {
                this.pieces[targetX][targetY] = null;
            } else {
                const newX = targetX + 1;
                if (newX < BOARD_SIZE && !this.pieces[newX]?.[targetY]) {
                    this.pieces[newX][targetY] = new Piece(team, piece.type, newX, targetY);
                }
            }
        }

        this.update();
    }

    async endGame(winnerTeam, reason) {
        clearInterval(this.interval);
        const winner = winnerTeam === 0 ? this.player1 : this.player2;
        const loser = winnerTeam === 0 ? this.player2 : this.player1;
        const state = this.getState();
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

    getState() {
        const piecesFlat = this.pieces.flat().filter(p => p);
        return {
            serverTime: Date.now(),
            board: this.board,
            pieces: piecesFlat.map(p => ({
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
