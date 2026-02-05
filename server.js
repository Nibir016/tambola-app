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
   PERFECT TICKET GENERATOR
================================================= */

function generateTicket() {

  const grid = Array.from({ length: 3 }, () => Array(9).fill(""));

  const rowCols = [];

  for (let r = 0; r < 3; r++)
    rowCols[r] = shuffle([...Array(9).keys()]).slice(0, 5);

  const colCounts = Array(9).fill(0);
  rowCols.forEach(cols => cols.forEach(c => colCounts[c]++));

  for (let c = 0; c < 9; c++) {

    const start = c * 10 + 1;
    const end = c === 8 ? 90 : start + 9;

    let pool = [];
    for (let i = start; i <= end; i++) pool.push(i);

    pool = shuffle(pool).slice(0, colCounts[c]).sort((a, b) => a - b);

    let k = 0;

    for (let r = 0; r < 3; r++)
      if (rowCols[r].includes(c))
        grid[r][c] = pool[k++];
  }

  return grid;
}


/* =================================================
   ⭐ NATURAL FULL HOUSE ENGINE (ONLY CONTROL)
================================================= */

function buildSequence(g){

  const winnerId = g.secret.full;

  let numbers = shuffle([...ALL]);

  if(!winnerId) return numbers;

  const winner = g.tickets.find(t=>t.id === winnerId);

  const winNums = winner.numbers.flat().filter(x=>x);

  // remove winner numbers
  numbers = numbers.filter(n=>!winNums.includes(n));

  const result = [];

  // first 50 completely random
  result.push(...numbers.splice(0,50));

  // next 25 mix winner numbers
  const mixed = shuffle([...numbers.splice(0,25), ...winNums.slice(0,10)]);
  result.push(...mixed);

  // last remaining winner numbers
  result.push(...shuffle(winNums.slice(10)));

  return result;
}



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
    remaining: [],
    timer: null
  };

  res.json({ id });
});

app.get("/games", (req, res) => res.json(Object.keys(games)));


/* =================================================
   TICKETS
================================================= */

app.post("/generate/:gid", (req, res) => {

  const g = games[req.params.gid];

  g.tickets = [];

  for (let i = 1; i <= req.body.count; i++)
    g.tickets.push({
      id: i,
      numbers: generateTicket(),
      booked: false,
      name: ""
    });

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
   SECRET (ONLY FULL)
================================================= */

app.post("/secret/:gid", (req, res) => {

  games[req.params.gid].secret = {
    full: Number(req.body.full) || null
  };

  res.send("ok");
});


/* =================================================
   WIN CHECK (unchanged)
================================================= */

function checkWins(gid) {

  const g = games[gid];
  const marked = n => g.called.includes(n);

  for (const t of g.tickets) {

    const flat = t.numbers.flat().filter(x => x);
    const total = flat.filter(marked).length;

    const announce = type => {
      if (!g.winners[type]) {
        g.winners[type] = t.id;
        io.to(gid).emit("winner", { type, id: t.id });
      }
    };

    if (total >= 5) announce("early5");
    if (t.numbers[0].filter(x => marked(x)).length >= 3) announce("top3");
    if (t.numbers[2].filter(x => marked(x)).length >= 4) announce("bot4");

  }
}


/* =================================================
   START GAME
================================================= */

function startGame(gid, interval){

  const g = games[gid];
  console.log("STOPPING GAME");


  clearInterval(g.timer);

  g.called = [];
  g.winners = {};

  g.remaining = shuffle([...ALL]);

  const winnerId = g.secret.full;

  const countMarked = (ticket, called) =>
    ticket.numbers.flat().filter(n=>called.includes(n)).length;

  g.timer = setInterval(()=>{

    if(!g.remaining.length){
      clearInterval(g.timer);
      return;
    }

    let chosen = null;

    // pick safe number
    for(const num of shuffle([...g.remaining])){

      const testCalled = [...g.called, num];

      let safe = true;

      for(const t of g.tickets){

        const total = countMarked(t, testCalled);

        // ❌ block other tickets from reaching 15
        if(winnerId && t.id !== winnerId && total === 15){
          safe = false;
          break;
        }
      }

      if(safe){
        chosen = num;
        break;
      }
    }

    if(!chosen) chosen = g.remaining[0];

    g.remaining = g.remaining.filter(x=>x!==chosen);

    g.called.push(chosen);

    io.to(gid).emit("number", chosen);

    /* ⭐ ADD THIS LINE BACK */
    checkWins(gid);   // ← restores early5/top3/bot4

    /* ===== FULL HOUSE CONTROL ===== */

    if(winnerId){

      const winnerTicket = g.tickets.find(t=>t.id===winnerId);

      const total = countMarked(winnerTicket, g.called);

      if(total === 15){

        io.to(gid).emit("winner",{ type:"full", id:winnerId });

        clearInterval(g.timer); // stop game
        return;
      }
    }

  }, interval*1000);
}



app.post("/start/:gid", (req, res) => {
  startGame(req.params.gid, req.body.interval);
  res.send("ok");
});


/* ================================================= */

io.on("connection", s => {
  s.on("join", gid => s.join(gid));
});

server.listen(3000, () => console.log("Running 3000"));

















