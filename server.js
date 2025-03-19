const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const { Connection, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction, PublicKey } = require('@solana/web3.js');

const BOARD_SIZE = 35;
const HILL_HOLD_TIME = 30;
const SOLANA_PRIZE = 0.01;
const MOVE_DURATION = 0.2;
const SHRINE_DELETE_CHANCE = 0.20;
const TERRAIN_GRASS = 0, TERRAIN_FOREST = 1, TERRAIN_WATER = 2;

app.use(express.static('public'));

const playerPool = [];
const games = [];
const connection = new Connection('https://api.devnet.solana.com');
const serverKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY || '[]')));

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
            "bishop": () => this.getSlidingMoves(grid, pieces, [(-1, -1), (-1, 1), (1, -1), (1, 1)], 5),
            "rook": () => this.getSlidingMoves(grid, pieces, [(-1, 0), (1, 0), (0, -1), (0, 1)], 5),
            "queen": () => this.getSlidingMoves(grid, pieces, [(-1, -1), (-1, 1), (1, -1), (1, 1), (-1, 0), (1, 0), (0, -1), (0, 1)], 7),
            "king": this.getKingMoves
        };
        return moves[this.type](grid, pieces);
    }

    getPawnMoves(grid, pieces) {
        const moves = [], captures = [];
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && grid[nx][ny] !== TERRAIN_WATER && !(pieces[nx] && pieces[nx][ny])) {
                moves.push([nx, ny]);
            }
        }
        for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && pieces[nx] && pieces[nx][ny] && pieces[nx][ny].team !== this.team) {
                captures.push([nx, ny]);
            }
        }
        return moves.concat(captures);
    }

    getKnightMoves(grid, pieces) {
        const moves = [];
        for (const [dx, dy] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && grid[nx][ny] !== TERRAIN_WATER &&
                (!pieces[nx] || !pieces[nx][ny] || pieces[nx][ny].team !== this.team)) {
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
                if (pieces[nx] && pieces[nx][ny]) {
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
        for (const [dx, dy] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
            const nx = this.x + dx, ny = this.y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && grid[nx][ny] !== TERRAIN_WATER &&
                (!pieces[nx] || !pieces[nx][ny] || pieces[nx][ny].team !== this.team)) {
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
        this.shrines = [[10, 10], [24, 24]];
        this.interval = null;
    }

    generateBoard() {
        const board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(TERRAIN_GRASS));
        let waterCount = 0, forestCount = 0, totalCells = BOARD_SIZE * BOARD_SIZE;
        while (waterCount < totalCells * 0.1) {
            const x = Math.floor(Math.random() * BOARD_SIZE), y = Math.floor(Math.random() * BOARD_SIZE);
            if (board[x][y] === TERRAIN_GRASS && (x < 5 || x >= BOARD_SIZE - 5)) {
                board[x][y] = TERRAIN_WATER;
                waterCount++;
            }
        }
        while (forestCount < totalCells * 0.1) {
            const x = Math.floor(Math.random() * BOARD_SIZE), y = Math.floor(Math.random() * BOARD_SIZE);
            if (board[x][y] === TERRAIN_GRASS) {
                board[x][y] = TERRAIN_FOREST;
                forestCount++;
            }
        }
        board[17][17] = TERRAIN_GRASS; // Ensure hill is grass
        return board;
    }

    placePieces() {
        const pieces = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE));
        const placeTeam = (team, xStart, pawnRow, backRow) => {
            for (let i = 0; i < 8; i++) pieces[xStart + i][pawnRow] = new Piece(team, "pawn", xStart + i, pawnRow);
            const backPieces = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];
            for (let i = 0; i < 8; i++) pieces[xStart + i][backRow] = new Piece(team, backPieces[i], xStart + i, backRow);
        };
        placeTeam(0, 13, 33, 34); // Team 0 bottom
        placeTeam(1, 13, 0, 1);   // Team 1 top
        return pieces;
    }

    start() {
        const state = this.getState();
        console.log('Game started, sending state:', state);
        this.player1.socket.emit('gameStart', { team: 0, state });
        this.player2.socket.emit('gameStart', { team: 1, state });
        this.interval = setInterval(() => this.update(), 1000 / 60);
    }

    update() {
        const currentTime = Date.now();
        for (let x = 0; x < BOARD_SIZE; x++) {
            for (let y = 0; y < BOARD_SIZE; y++) {
                if (this.pieces[x] && this.pieces[x][y] && this.pieces[x][y].cooldown > 0) {
                    this.pieces[x][y].cooldown = Math.max(0, this.pieces[x][y].cooldown - 1000 / 60);
                }
            }
        }

        const hillPiece = this.pieces[this.hill.x] && this.pieces[this.hill.x][this.hill.y];
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
        const piece = this.pieces.flat().filter(p => p)[pieceIdx];
        if (!piece || piece.team !== team || piece.cooldown > 0) return;

        const legalMoves = piece.getLegalMoves(this.board, this.pieces);
        const target = [targetX, targetY];
        if (!legalMoves.some(m => m[0] === targetX && m[1] === targetY)) return;

        if (this.pieces[targetX] && this.pieces[targetX][targetY]) {
            const targetPiece = this.pieces[targetX][targetY];
            if (targetPiece.team !== piece.team) {
                this.pieces[targetX][targetY] = null;
                if (targetPiece.type === 'king') {
                    this.endGame(team, "king_capture");
                    return;
                }
            } else return;
        }

        const shrineIdx = this.shrines.findIndex(s => s[0] === targetX && s[1] === targetY);
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
                const newPiece = new Piece(team, piece.type, targetX + 1, targetY);
                if (newPiece.x < BOARD_SIZE && !this.pieces[newPiece.x][newPiece.y]) this.pieces[newPiece.x][newPiece.y] = newPiece;
            }
        }

        this.update();
    }

    endGame(winnerTeam, reason) {
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

        sendSol(winner.solAddress, SOLANA_PRIZE).then(txId => {
            console.log(`Prize sent to ${winner.solAddress}: ${txId}`);
        }).catch(err => console.error('SOLANA transaction failed:', err));
        games.splice(games.indexOf(this), 1);
    }

    getState() {
        return {
            serverTime: Date.now(),
            board: this.board,
            pieces: this.pieces.flat().filter(p => p).map(p => ({ team: p.team, type: p.type, x: p.x, y: p.y, old_x: p.old_x, old_y: p.old_y, cooldown: p.cooldown, move_start_time: p.move_start_time })),
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
            lamports: amount * 1e9
        })
    );
    const signature = await sendAndConfirmTransaction(connection, transaction, [serverKeypair]);
    return signature;
}

server.listen(3000, () => console.log('Server running on port 3000'));
