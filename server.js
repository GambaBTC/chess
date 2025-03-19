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
        const board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill('grass'));
        const totalCells = BOARD_SIZE * BOARD_SIZE;
        let waterCount = 0, forestCount = 0;

        for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) board[x][y] = 'grass';
        for (let x = BOARD_SIZE - 5; x < BOARD_SIZE; x++) for (let y = BOARD_SIZE - 5; y < BOARD_SIZE; y++) board[x][y] = 'grass';
        board[17][17] = 'grass';

        while (waterCount < totalCells * 0.1) {
            const x = Math.floor(Math.random() * BOARD_SIZE);
            const y = Math.floor(Math.random() * BOARD_SIZE);
            if (board[x][y] === 'grass' && !(x < 5 && y < 5) && !(x >= BOARD_SIZE - 5 && y >= BOARD_SIZE - 5) && !(x === 17 && y === 17)) {
                board[x][y] = 'water';
                waterCount++;
            }
        }
        while (forestCount < totalCells * 0.1) {
            const x = Math.floor(Math.random() * BOARD_SIZE);
            const y = Math.floor(Math.random() * BOARD_SIZE);
            if (board[x][y] === 'grass' && !(x < 5 && y < 5) && !(x >= BOARD_SIZE - 5 && y >= BOARD_SIZE - 5) && !(x === 17 && y === 17)) {
                board[x][y] = 'forest';
                forestCount++;
            }
        }
        return board;
    }

    placePieces() {
        const pieces = [
            { team: 0, type: 'king', x: 2, y: 2, cooldownEndTime: null, targetX: null, targetY: null, moveStartTime: null },
            { team: 0, type: 'knight', x: 3, y: 3, cooldownEndTime: null, targetX: null, targetY: null, moveStartTime: null },
            { team: 0, type: 'pawn', x: 2, y: 3, cooldownEndTime: null, targetX: null, targetY: null, moveStartTime: null },
            { team: 1, type: 'king', x: 32, y: 32, cooldownEndTime: null, targetX: null, targetY: null, moveStartTime: null },
            { team: 1, type: 'knight', x: 31, y: 31, cooldownEndTime: null, targetX: null, targetY: null, moveStartTime: null },
            { team: 1, type: 'pawn', x: 32, y: 31, cooldownEndTime: null, targetX: null, targetY: null, moveStartTime: null }
        ];
        console.log('Initial pieces placed:', pieces);
        return pieces;
    }

    placeShrines() {
        return [{ x: 10, y: 10 }, { x: 24, y: 24 }];
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
        this.pieces.forEach(p => {
            if (p.cooldownEndTime && currentTime >= p.cooldownEndTime) p.cooldownEndTime = null;
        });

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
        const piece = this.pieces[pieceIdx];
        if (!piece || piece.team !== team || piece.cooldownEndTime) return;

        const dx = Math.abs(targetX - piece.x);
        const dy = Math.abs(targetY - piece.y);
        const range = piece.type === 'knight' ? 2 : 1;
        if (targetX < 0 || targetX >= BOARD_SIZE || targetY < 0 || targetY >= BOARD_SIZE || this.board[targetX][targetY] === 'water' || dx > range || dy > range) return;

        const targetPieceIdx = this.pieces.findIndex(p => p.x === targetX && p.y === targetY);
        if (targetPieceIdx !== -1) {
            const targetPiece = this.pieces[targetPieceIdx];
            if (targetPiece.team !== piece.team) {
                this.pieces.splice(targetPieceIdx, 1);
                if (targetPiece.type === 'king') {
                    this.endGame(team, "king_capture");
                    return;
                }
            } else return;
        }

        const shrineIdx = this.shrines.findIndex(s => s.x === targetX && s.y === targetY);
        if (shrineIdx !== -1) {
            this.shrines.splice(shrineIdx, 1);
            if (Math.random() < SHRINE_DELETE_CHANCE) {
                this.pieces.splice(pieceIdx, 1);
            } else {
                this.pieces.push({ team, type: piece.type, x: targetX + 1, y: targetY, cooldownEndTime: null, targetX: null, targetY: null, moveStartTime: null });
            }
        } else {
            piece.targetX = targetX;
            piece.targetY = targetY;
            piece.moveStartTime = Date.now();
            piece.x = targetX;
            piece.y = targetY;
            piece.cooldownEndTime = Date.now() + (this.board[targetX][targetY] === 'forest' ? 3000 : 1500);
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
    }

    getState() {
        return {
            serverTime: Date.now(),
            board: this.board,
            pieces: this.pieces.map(p => ({ ...p })),
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
