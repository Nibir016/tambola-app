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
   PERFECT TAMBOLA GENERATOR (15 numbers, valid cols)
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
   🔥🔥🔥 BLOCKING ENGINE (REAL FIX)
================================================= */









/* =================================================
   CREATE GAME
================================================= */

app.post("/createGame", (req, res) => {

  const id = "game" + counter++;

  games[id] = {
    tickets: [],
    called: [],
    remaining: [],
    winners: {},
    secret: {},
    timer: null,
    timeout: null
  };

  res.json({ id });
});

app.get("/games", (req, res) => res.json(Object.keys(games)));


/* =================================================
   TICKETS
================================================= */

app.post("/generate/:gid", (req, res) => {

  const g = games[req.params.gid];
  const count = Number(req.body.count);

  g.tickets = [];

  for (let i = 1; i <= count; i++)
    g.tickets.push({
      id: i,
      numbers: generateTicket(),
      booked: false,
      name: ""
    });

  res.send("ok");
});

app.get("/tickets/:gid", (req, res) => {
  res.json(games[req.params.gid].tickets);
});

app.post("/ticketUpdate/:gid/:id", (req, res) => {

  const t = games[req.params.gid].tickets.find(x => x.id == req.params.id);

  if (t) {
    t.booked = req.body.booked;
    t.name = req.body.name;
  }

  res.send("ok");
});


/* =================================================
   SECRET
================================================= */

app.post("/secret/:gid", (req, res) => {

  games[req.params.gid].secret = {
    early5: Number(req.body.early5) || null,
    top3: Number(req.body.top3) || null,
    bot4: Number(req.body.bot4) || null,
    full: Number(req.body.full) || null
  };
console.log("SECRET SAVED:", games[req.params.gid].secret);

  res.send("ok");
});


/* =================================================
   WIN CHECK (unchanged)
================================================= */

function checkWins(gid) {

  const g = games[gid];
  const s = g.secret || {};
  const marked = n => g.called.includes(n);

  for (const t of g.tickets) {

    const flat = t.numbers.flat().filter(x => x);

    const total = flat.filter(marked).length;
    const top = t.numbers[0].filter(x => x).filter(marked).length;
    const bottom = t.numbers[2].filter(x => x).filter(marked).length;

    const announce = type => {
      if (!g.winners[type]) {
        g.winners[type] = t.id;
        io.to(gid).emit("winner", { type, id: t.id });
      }
    };

    // ✅ EARLY 5
    if (total >= 5) {
      if (!s.early5 || s.early5 === t.id) {
        announce("early5");
      }
    }

    // ✅ TOP 3
    if (top >= 3) {
      if (!s.top3 || s.top3 === t.id) {
        announce("top3");
      }
    }

    // ✅ BOTTOM 4
    if (bottom >= 4) {
      if (!s.bot4 || s.bot4 === t.id) {
        announce("bot4");
      }
    }

    // ✅ FULL HOUSE
    if (total === 15) {
      if (!s.full || s.full === t.id) {
        announce("full");
      }
    }
  }
}

/* ================= SAFE PICKER ================= */

function nextSafeNumber(g){

  const drawCount = g.called.length;

// natural timing windows
const windows = {
  early5: drawCount >= 20,
  bot4:   drawCount >= 30,
  top3:   drawCount >= 45,
  full:   drawCount >= 75
};

  const s = g.secret || {};

  const candidates = shuffle([...g.remaining]);

  const marked = n => g.called.includes(n);

  const wouldTrigger = (ticket, type, num) => {

  const called = [...g.called, num];

  const count = arr => arr.filter(n => called.includes(n)).length;

  const flat = ticket.numbers.flat().filter(x=>x);

  if(type==="early5")
    return count(flat) >= 5;

  if(type==="top3")
    return count(ticket.numbers[0].filter(x=>x)) >= 3;

  if(type==="bot4")
    return count(ticket.numbers[2].filter(x=>x)) >= 4;

  if(type==="full")
    return count(flat) >= 15; // >= not ===

  return false;
};


  for(const num of candidates){

    let safe = true;

    for(const t of g.tickets){

      if(s.early5 && t.id !== s.early5 && wouldTrigger(t,"early5",num)) safe=false;
      if(s.top3   && t.id !== s.top3   && wouldTrigger(t,"top3",num))   safe=false;
      if(s.bot4   && t.id !== s.bot4   && wouldTrigger(t,"bot4",num))   safe=false;
      if(s.full   && t.id !== s.full   && wouldTrigger(t,"full",num))   safe=false;
      // block secret ticket until its window time
if (s.early5 && t.id === s.early5 && !windows.early5 && wouldTrigger(t,"early5",num)) safe=false;
if (s.top3   && t.id === s.top3   && !windows.top3   && wouldTrigger(t,"top3",num))   safe=false;
if (s.bot4   && t.id === s.bot4   && !windows.bot4   && wouldTrigger(t,"bot4",num))   safe=false;
if (s.full   && t.id === s.full   && !windows.full   && wouldTrigger(t,"full",num))   safe=false;


      if(!safe) break;
    }

    if(safe){
      g.remaining = g.remaining.filter(x=>x!==num);
      return num;
    }
  }

  // fallback
  return g.remaining.shift();
}
/* ================= START (FIXED SAFE VERSION) ================= */

function startGame(gid, interval){

  const g = games[gid];

  clearInterval(g.timer);

  g.called = [];
  g.winners = {};

  // ALWAYS random — blocking logic handles safety
  g.remaining = shuffle([...ALL]);

  g.timer = setInterval(()=>{

    if(!g.remaining.length){
      clearInterval(g.timer);
      return;
    }

    const n = nextSafeNumber(g);

    g.called.push(n);

    io.to(gid).emit("number", n);

    checkWins(gid);

  }, interval * 1000);
}


app.post("/start/:gid", (req, res) => {
  startGame(req.params.gid, req.body.interval);
  res.send("ok");
});


/* =================================================
   STOP / SCHEDULE / PDF (unchanged)
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

  g.timeout = setTimeout(() => startGame(req.params.gid, interval), target - now);

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


/* ================================================= */

io.on("connection", s => {
  s.on("join", gid => s.join(gid));
});

app.get("/debug/:gid",(req,res)=>{
  res.json(games[req.params.gid].secret);
});

server.listen(3000, () => console.log("Running 3000"));
















