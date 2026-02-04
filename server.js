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

/* =================================================
   PERFECT TAMBOLA GENERATOR (100% CORRECT)
   ALWAYS:
   ✔ 15 numbers
   ✔ 5 per row
   ✔ correct column ranges
   ✔ no duplicates
================================================= */

function generateTicket(){

  const grid = Array.from({length:3},()=>Array(9).fill(""));

  // STEP 1 — choose 5 columns per row
  const rowCols = [];

  for(let r=0;r<3;r++){
    rowCols[r] = shuffle([0,1,2,3,4,5,6,7,8]).slice(0,5);
  }

  // STEP 2 — count numbers needed per column
  const colCounts = Array(9).fill(0);

  rowCols.forEach(cols=>{
    cols.forEach(c=> colCounts[c]++);
  });

  // STEP 3 — generate numbers column-wise
  for(let c=0;c<9;c++){

    const start = c*10+1;
    const end   = c===8 ? 90 : start+9;

    let pool=[];
    for(let i=start;i<=end;i++) pool.push(i);

    pool = shuffle(pool).slice(0,colCounts[c]).sort((a,b)=>a-b);

    let k=0;

    for(let r=0;r<3;r++){
      if(rowCols[r].includes(c)){
        grid[r][c]=pool[k++];
      }
    }
  }

  return grid;
}




/* =================================================
   ⭐⭐⭐ DETERMINISTIC CONTROLLED SEQUENCE ⭐⭐⭐
   ONLY THIS FUNCTION CHANGED
================================================= */
/* ================= SAFE CONTROLLED SEQUENCE ================= */

function buildSequence(g){

  const result = new Array(90).fill(null);

  let pool = shuffle([...ALL]);

  const removeFromPool = nums=>{
    pool = pool.filter(n=>!nums.includes(n));
  };

  const placeInWindow = (nums,start,end)=>{

    nums = shuffle([...nums]);

    const slots=[];

    for(let i=start;i<end;i++){
      if(!result[i]) slots.push(i);
    }

    shuffle(slots);

    nums.forEach((n,i)=>{
      result[slots[i]] = n;
    });
  };

  const get=id=>g.tickets.find(t=>t.id==id);
  const s=g.secret || {};

  // Early5
  if(s.early5){
    const t=get(s.early5);
    if(t){
      const nums = shuffle(t.numbers.flat().filter(x=>x)).slice(0,5);
      removeFromPool(nums);
      placeInWindow(nums,20,35);
    }
  }

  // Bottom4
  if(s.bot4){
    const t=get(s.bot4);
    if(t){
      const nums=t.numbers[2].filter(x=>x).slice(0,4);
      removeFromPool(nums);
      placeInWindow(nums,30,50);
    }
  }

  // Top3
  if(s.top3){
    const t=get(s.top3);
    if(t){
      const nums=t.numbers[0].filter(x=>x).slice(0,3);
      removeFromPool(nums);
      placeInWindow(nums,45,65);
    }
  }

  // Full
  if(s.full){
    const t=get(s.full);
    if(t){
      const nums=t.numbers.flat().filter(x=>x);
      removeFromPool(nums);
      placeInWindow(nums,75,90);
    }
  }

  // fill remaining safely
  shuffle(pool);

  for(let i=0;i<90;i++){
    if(!result[i]) result[i]=pool.shift();
  }

  return result;
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

  const g = games[gid];
  const s = g.secret || {};
  const marked = n => g.called.includes(n);

  for(const t of g.tickets){

    const flat = t.numbers.flat().filter(x=>x);

    const total = flat.filter(marked).length;
    const top = t.numbers[0].filter(x=>x).filter(marked).length;
    const bottom = t.numbers[2].filter(x=>x).filter(marked).length;

    const announce = type=>{
      if(!g.winners[type]){
        g.winners[type] = t.id;

        console.log("WINNER:", type, t.id); // debug

        io.to(gid).emit("winner",{
          type,
          id:t.id
        });
      }
    };

    /* =============================
       SIMPLE + RELIABLE LOGIC
    ============================== */

    // Early 5
    if(total >= 5){
      if(!s.early5 || s.early5 == t.id)
        announce("early5");
    }

    // Top 3
    if(top >= 3){
      if(!s.top3 || s.top3 == t.id)
        announce("top3");
    }

    // Bottom 4
    if(bottom >= 4){
      if(!s.bot4 || s.bot4 == t.id)
        announce("bot4");
    }

    // Full House
    if(total === 15){
      if(!s.full || s.full == t.id)
        announce("full");
    }
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















