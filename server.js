const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const PDFDocument = require("pdfkit");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

/* =================================================
   MEMORY
================================================= */

let games = {};
let counter = 1;

const shuffle = a => a.sort(() => Math.random() - 0.5);
const ALL = [...Array(90)].map((_, i) => i + 1);

/* =================================================
   FIXED SET F (15 numbers) — NEVER CHANGE
================================================= */

const F = [
  3, 7, 12,
  18, 22, 27,
  33, 38, 44,
  49, 56, 61,
  67, 73, 88
];

/* build 105 unique unordered pairs */
const PAIRS = [];
for (let i = 0; i < F.length; i++) {
  for (let j = i + 1; j < F.length; j++) {
    PAIRS.push([F[i], F[j]]);
  }
}

/* =================================================
   PERFECT TICKET GENERATOR (13 + 1 PAIR)
================================================= */

function generateTicket(pair) {
  const grid = Array.from({ length: 3 }, () => Array(9).fill(""));

  const rowCols = [];
  for (let r = 0; r < 3; r++) {
    rowCols[r] = shuffle([...Array(9).keys()]).slice(0, 5);
  }

  const colCounts = Array(9).fill(0);
  rowCols.forEach(cols => cols.forEach(c => colCounts[c]++));

  const colPools = [];
  for (let c = 0; c < 9; c++) {
    const start = c === 0 ? 1 : c * 10;
    const end = c === 8 ? 90 : c * 10 + 9;

    let pool = [];
    for (let n = start; n <= end; n++) {
      if (!F.includes(n)) pool.push(n);
    }
    colPools[c] = shuffle(pool);
  }

  /* place the pair first */
  pair.forEach(num => {
    const col = Math.min(Math.floor(num / 10), 8);
    for (let r = 0; r < 3; r++) {
      if (rowCols[r].includes(col) && grid[r][col] === "") {
        grid[r][col] = num;
        break;
      }
    }
  });

  /* fill remaining cells */
  for (let c = 0; c < 9; c++) {
    for (let r = 0; r < 3; r++) {
      if (rowCols[r].includes(c) && grid[r][c] === "") {
        grid[r][c] = colPools[c].shift();
      }
    }
  }

  return grid;
}

const ticketNumbers = t => t.numbers.flat().filter(Boolean);

/* =================================================
   CREATE GAME
================================================= */

app.post("/createGame", (req, res) => {
  const id = "game" + counter++;
  games[id] = {
    tickets: [],
    called: [],
    winners: {},
    secret: {},
    timer: null,
    ended: false
  };
  res.json({ id });
});

app.get("/games", (req, res) =>
  res.json(Object.keys(games))
);

/* =================================================
   GENERATE TICKETS
================================================= */

app.post("/generate/:gid", (req, res) => {
  const g = games[req.params.gid];
  const count = Number(req.body.count);

  if (count > PAIRS.length)
    return res.status(400).send("Max 105 tickets");

  const pairs = shuffle([...PAIRS]).slice(0, count);
  g.tickets = [];

  for (let i = 0; i < count; i++) {
    g.tickets.push({
      id: i + 1,
      pair: pairs[i],
      numbers: generateTicket(pairs[i]),
      booked: false,
      name: ""
    });
  }

  res.send("ok");
});

app.get("/tickets/:gid", (req, res) =>
  res.json(games[req.params.gid].tickets)
);

app.post("/ticketUpdate/:gid/:id", (req, res) => {
  const t = games[req.params.gid].tickets.find(x => x.id == req.params.id);
  if (t) {
    t.booked = req.body.booked;
    t.name = req.body.name;
  }
  res.send("ok");
});

/* =================================================
   SECRET PANEL — FULL HOUSE ONLY
================================================= */

app.post("/secret/:gid", (req, res) => {
  games[req.params.gid].secret = {
    full: Number(req.body.full) || null
  };
  res.send("ok");
});

/* =================================================
   WIN CHECK (ONE WINNER PER CATEGORY)
================================================= */

function checkWins(gid) {
  const g = games[gid];
  if (g.ended) return;

  const marked = n => g.called.includes(n);

  for (const t of g.tickets) {
    const nums = ticketNumbers(t);
    const total = nums.filter(marked).length;
    const top = t.numbers[0].filter(n => marked(n)).length;
    const bot = t.numbers[2].filter(n => marked(n)).length;

    const announce = type => {
      if (g.winners[type]) return;
      g.winners[type] = t.id;
      io.to(gid).emit("winner", { type, id: t.id });
    };

    if (total >= 5) announce("early5");
    if (top >= 3) announce("top3");
    if (bot >= 4) announce("bot4");
  }
}

/* =================================================
   START GAME — PAIR CONTROLLED FULL HOUSE
================================================= */

function startGame(gid, interval) {
  const g = games[gid];
  clearInterval(g.timer);

  g.called = [];
  g.winners = {};
  g.ended = false;

  const winnerId = g.secret.full;
  const winner = g.tickets.find(t => t.id === winnerId);
  const winningPair = winner ? [...winner.pair] : [];

  /* numbers NOT in F */
  let safePool = shuffle(ALL.filter(n => !F.includes(n)));

  g.timer = setInterval(() => {
    if (g.ended) return;

    let n = null;

    /* Phase 1: natural play */
    if (safePool.length) {
      n = safePool.shift();
    }
    /* Phase 2: draw winning pair */
    else if (winningPair.length) {
      n = winningPair.shift();
    }
    else {
      clearInterval(g.timer);
      return;
    }

    g.called.push(n);
    io.to(gid).emit("number", n);
    checkWins(gid);

    /* FULL HOUSE CHECK */
    if (winner) {
      const total = ticketNumbers(winner)
        .filter(x => g.called.includes(x)).length;

      if (total === 15) {
        g.ended = true;
        io.to(gid).emit("winner", { type: "full", id: winner.id });
        clearInterval(g.timer);
      }
    }
  }, interval * 1000);
}

app.post("/start/:gid", (req, res) => {
  startGame(req.params.gid, req.body.interval);
  res.send("ok");
});

/* =================================================
   STOP / SCHEDULE / PDF
================================================= */

app.post("/stop/:gid", (req, res) => {
  clearInterval(games[req.params.gid].timer);
  res.send("ok");
});

app.post("/schedule/:gid", (req, res) => {
  const { time, interval } = req.body;
  const g = games[req.params.gid];

  const now = new Date();
  const target = new Date();
  const [h, m] = time.split(":");

  target.setHours(h);
  target.setMinutes(m);
  if (target < now) target.setDate(target.getDate() + 1);

  setTimeout(() => startGame(req.params.gid, interval), target - now);
  res.send("scheduled");
});

app.get("/pdf/:gid", (req, res) => {
  const g = games[req.params.gid];
  const doc = new PDFDocument();
  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);
  g.tickets.forEach(t => doc.text("Ticket " + t.id));
  doc.end();
});

/* =================================================
   SOCKET
================================================= */

io.on("connection", s => {
  s.on("join", gid => s.join(gid));
});

server.listen(3000, () => console.log("Running on 3000"));




















