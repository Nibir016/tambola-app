const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const PDFDocument = require("pdfkit");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

/* ================= MEMORY ================= */

let games = {};
let counter = 1;

const shuffle = a => a.sort(() => Math.random() - 0.5);
const ALL = [...Array(90)].map((_, i) => i + 1);


/* ================= TICKET ================= */

/* ================= REAL TAMBOLA GENERATOR ================= */

function generateTicket(){

  // empty 3x9 grid
  const grid = Array.from({length:3},()=>Array(9).fill(""));

  // how many numbers each column gets (total 15)
  let colCounts = Array(9).fill(1); // minimum 1 each
  let remaining = 6; // 15 - 9

  // randomly distribute remaining
  while(remaining>0){
    const c = Math.floor(Math.random()*9);
    if(colCounts[c] < 3){
      colCounts[c]++;
      remaining--;
    }
  }

  // fill each column with numbers from its range
  for(let c=0;c<9;c++){

    const start = c*10 + 1;
    const end   = c==8 ? 90 : start+9;

    let pool=[];
    for(let i=start;i<=end;i++) pool.push(i);

    pool = shuffle(pool).slice(0,colCounts[c]).sort((a,b)=>a-b);

    // choose random rows for this column
    let rows = shuffle([0,1,2]).slice(0,colCounts[c]);

    rows.forEach((r,i)=>{
      grid[r][c]=pool[i];
    });
  }

  // ensure each row has exactly 5 numbers
  for(let r=0;r<3;r++){

    let filled = grid[r].filter(x=>x!="").length;

    while(filled>5){
      const c=Math.floor(Math.random()*9);
      if(grid[r][c]!=""){
        grid[r][c]="";
        filled--;
      }
    }

    while(filled<5){
      const c=Math.floor(Math.random()*9);
      if(grid[r][c]==""){
        // borrow from another row in same column
        for(let rr=0;rr<3;rr++){
          if(rr!==r && grid[rr][c]!=""){
            grid[r][c]=grid[rr][c];
            grid[rr][c]="";
            filled++;
            break;
          }
        }
      }
    }
  }

  return grid;
}



/* =================================================
   ⭐⭐⭐ DETERMINISTIC CONTROLLED SEQUENCE ⭐⭐⭐
   ONLY THIS FUNCTION CHANGED
================================================= */

function buildSequence(g){

  let numbers = shuffle([...ALL]);
  const s = g.secret;

  const remove = arr => {
    numbers = numbers.filter(x => !arr.includes(x));
  };

  const insertRandom = (n, start, end) => {
    const pos = Math.floor(Math.random()*(end-start))+start;
    numbers.splice(pos,0,n);
  };

  const get = id => g.tickets.find(t=>t.id==id);

  /* ---------- helper to enforce limits ---------- */

  function enforceLimit(getNums, start, end, maxAllowed, winnerId){

    g.tickets.forEach(t=>{

      if(t.id==winnerId) return;

      const arr=getNums(t);

      let count=0;

      arr.forEach(n=>{
        const idx=numbers.indexOf(n);
        if(idx>=start && idx<=end) count++;
      });

      while(count>maxAllowed){
        const move=arr[Math.floor(Math.random()*arr.length)];
        const idx=numbers.indexOf(move);
        if(idx>=start && idx<=end){
          numbers.splice(idx,1);
          numbers.push(move); // push late
          count--;
        }
      }
    });
  }

  /* ================= EARLY5 ================= */

  if(s.early5){
    const t=get(s.early5);
    const arr=t.numbers.flat().slice(0,5);

    remove(arr);
    arr.forEach(n=>insertRandom(n,15,40));

    enforceLimit(
      ticket=>ticket.numbers.flat(),
      15,40,
      4,
      s.early5
    );
  }

  /* ================= BOTTOM4 ================= */

  if(s.bot4){
    const t=get(s.bot4);
    const arr=t.numbers[2].slice(0,4);

    remove(arr);
    arr.forEach(n=>insertRandom(n,25,55));

    enforceLimit(
      ticket=>ticket.numbers[2],
      25,55,
      3,
      s.bot4
    );
  }

  /* ================= TOP3 ================= */

  if(s.top3){
    const t=get(s.top3);
    const arr=t.numbers[0].slice(0,3);

    remove(arr);
    arr.forEach(n=>insertRandom(n,40,65));

    enforceLimit(
      ticket=>ticket.numbers[0],
      40,65,
      2,
      s.top3
    );
  }

  /* ================= FULL ================= */

  if(s.full){
    const t=get(s.full);
    const arr=t.numbers.flat();

    remove(arr);
    arr.forEach(n=>insertRandom(n,70,90));

    enforceLimit(
      ticket=>ticket.numbers.flat(),
      70,90,
      14,
      s.full
    );
  }

  return numbers;
}


/* ================= CREATE GAME ================= */

app.post("/createGame",(req,res)=>{
  const id="game"+counter++;

  games[id]={
    tickets:[],
    called:[],
    remaining:[],
    winners:{},
    secret:{},
    timer:null,
    timeout:null
  };

  res.json({id});
});

app.get("/games",(req,res)=>res.json(Object.keys(games)));


/* ================= TICKETS ================= */

app.post("/generate/:gid",(req,res)=>{
  const g=games[req.params.gid];
  const count=Number(req.body.count);

  g.tickets=[];
  for(let i=1;i<=count;i++){
    g.tickets.push({id:i,numbers:generateTicket(),booked:false,name:""});
  }
  res.send("ok");
});

app.get("/tickets/:gid",(req,res)=>res.json(games[req.params.gid].tickets));

app.post("/ticketUpdate/:gid/:id",(req,res)=>{
  const t=games[req.params.gid].tickets.find(x=>x.id==req.params.id);
  if(t){
    t.booked=req.body.booked;
    t.name=req.body.name;
  }
  res.send("ok");
});


/* ================= SECRET ================= */

app.post("/secret/:gid",(req,res)=>{
  games[req.params.gid].secret={
    early5:Number(req.body.early5)||null,
    top3:Number(req.body.top3)||null,
    bot4:Number(req.body.bot4)||null,
    full:Number(req.body.full)||null
  };
  res.send("ok");
});


/* ================= WIN CHECK (UNCHANGED) ================= */

function checkWins(gid){

  const g=games[gid];
  const marked=n=>g.called.includes(n);

  for(const t of g.tickets){

    const flat=t.numbers.flat().filter(x=>x);
    const total=flat.filter(marked).length;
    const top=t.numbers[0].filter(x=>x).filter(marked).length;
    const bottom=t.numbers[2].filter(x=>x).filter(marked).length;

    const win=type=>{
      if(!g.winners[type]){
        g.winners[type]=t.id;
        io.to(gid).emit("winner",{type,id:t.id});
      }
    };

    if(total>=5) win("early5");
    if(bottom>=4) win("bot4");
    if(top>=3) win("top3");
    if(total===15) win("full");
  }
}


/* ================= START ================= */

function startGame(gid,interval){

  const g=games[gid];

  clearInterval(g.timer);

  g.called=[];
  g.winners={};

  const hasSecret=Object.values(g.secret).some(Boolean);

  g.remaining = hasSecret ? buildSequence(g) : shuffle([...ALL]);

  g.timer=setInterval(()=>{

    if(!g.remaining.length) return clearInterval(g.timer);

    const n=g.remaining.shift();
    g.called.push(n);

    io.to(gid).emit("number",n);

    checkWins(gid);

  },interval*1000);
}

app.post("/start/:gid",(req,res)=>{
  startGame(req.params.gid,req.body.interval);
  res.send("ok");
});


/* ================= STOP / SCHEDULE / PDF ================= */

app.post("/stop/:gid",(req,res)=>{
  clearInterval(games[req.params.gid].timer);
  res.send("ok");
});

app.post("/schedule/:gid",(req,res)=>{
  const {time,interval}=req.body;
  const g=games[req.params.gid];

  const now=new Date();
  const target=new Date();

  const [h,m]=time.split(":");
  target.setHours(h); target.setMinutes(m);

  if(target<now) target.setDate(target.getDate()+1);

  setTimeout(()=>startGame(req.params.gid,interval),target-now);

  res.send("scheduled");
});

app.get("/pdf/:gid",(req,res)=>{
  const g=games[req.params.gid];
  const doc=new PDFDocument();

  res.setHeader("Content-Type","application/pdf");
  doc.pipe(res);

  g.tickets.forEach(t=>doc.text("Ticket "+t.id));
  doc.end();
});


/* ================= SOCKET ================= */

io.on("connection",socket=>{

  socket.on("join",gid=>{

    socket.join(gid);

    const g = games[gid];
    if(!g) return;

    // 🔥 SEND HISTORY TO NEW PLAYER
    socket.emit("history",{
      called: g.called,
      winners: g.winners
    });

  });

});


server.listen(3000,()=>console.log("Running 3000"));















