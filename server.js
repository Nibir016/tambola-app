const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const PDFDocument = require("pdfkit");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

/* =================================================
   🔐 SECRET PASSWORD
================================================= */

const SECRET_PASSWORD = "nibir123";

/* =================================================
   SECRET LOGIN ONLY
================================================= */

app.get("/secret.html",(req,res)=>{
  res.sendFile(path.join(__dirname,"public/login.html"));
});

app.post("/secret-login",(req,res)=>{
  res.json({ok:req.body.password===SECRET_PASSWORD});
});

/* =================================================
   DATA
================================================= */

let games={};
let counter=1;

/* =================================================
   HELPERS
================================================= */

const shuffle=a=>a.sort(()=>Math.random()-0.5);

function generateTicket(){
  const grid=Array.from({length:3},()=>Array(9).fill(""));
  let nums=shuffle([...Array(90)].map((_,i)=>i+1)).slice(0,15);

  let k=0;
  for(let r=0;r<3;r++){
    let cols=shuffle([...Array(9).keys()]).slice(0,5);
    cols.forEach(c=>grid[r][c]=nums[k++]);
  }
  return grid;
}

/* =================================================
   CREATE GAME
================================================= */

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

app.get("/games",(req,res)=>{
  res.json(Object.keys(games));
});

/* =================================================
   GENERATE TICKETS
================================================= */

app.post("/generate/:gid",(req,res)=>{

  const g=games[req.params.gid];
  const count=req.body.count;

  g.tickets=[];

  for(let i=1;i<=count;i++){
    g.tickets.push({
      id:i,
      numbers:generateTicket(),
      booked:false,
      name:""
    });
  }

  res.send("ok");
});

/* =================================================
   TICKET CONTROL (ADMIN)
================================================= */

app.get("/tickets/:gid",(req,res)=>{
  res.json(games[req.params.gid].tickets);
});

app.post("/ticketUpdate/:gid/:id",(req,res)=>{

  const t=games[req.params.gid].tickets.find(x=>x.id==req.params.id);

  t.booked=req.body.booked;
  t.name=req.body.name;

  res.send("ok");
});

/* =================================================
   PLAYER TICKET FETCH
================================================= */

app.get("/ticket/:gid/:id",(req,res)=>{
  const t=games[req.params.gid].tickets.find(x=>x.id==req.params.id);
  res.json(t||null);
});

/* =================================================
   SECRET SETTINGS
================================================= */

app.post("/secret/:gid",(req,res)=>{
  games[req.params.gid].secret=req.body;
  res.send("ok");
});

/* =================================================
   WIN CHECKING
================================================= */

function checkWins(gid){

  const g=games[gid];
  const marked=n=>g.called.includes(n);

  for(const t of g.tickets){

    const flat=t.numbers.flat().filter(x=>x);
    const count=flat.filter(marked).length;
    const rows=t.numbers.map(r=>r.filter(x=>x));

    const win=(k,n)=>{
      if(!g.winners[k]){
        g.winners[k]=t.id;
        io.to(gid).emit("winner",{type:n,id:t.id});
      }
    };

    if(count>=5) win("early5","Early 5");
    if(rows[0].every(marked)) win("top","Top Line");
    if(rows[1].every(marked)) win("mid","Middle Line");
    if(rows[2].every(marked)) win("bot","Bottom Line");
    if(count===15) win("full","Full House");
  }
}

/* =================================================
   START GAME (SMART SECRET ORDERING)
================================================= */

function startGame(gid,interval){

  const g=games[gid];

  clearInterval(g.timer);

  g.called=[];
  g.winners={};

  let numbers=shuffle([...Array(90)].map((_,i)=>i+1));

  const priority=[];
  const add=a=>a.forEach(x=>!priority.includes(x)&&priority.push(x));

  const s=g.secret;

  if(s.early5){
    const t=g.tickets.find(x=>x.id==s.early5);
    if(t) add(t.numbers.flat().slice(0,5));
  }

  if(s.top){
    const t=g.tickets.find(x=>x.id==s.top);
    if(t) add(t.numbers[0].filter(x=>x));
  }

  if(s.mid){
    const t=g.tickets.find(x=>x.id==s.mid);
    if(t) add(t.numbers[1].filter(x=>x));
  }

  if(s.bot){
    const t=g.tickets.find(x=>x.id==s.bot);
    if(t) add(t.numbers[2].filter(x=>x));
  }

  if(s.full){
    const t=g.tickets.find(x=>x.id==s.full);
    if(t) add(t.numbers.flat().filter(x=>x));
  }

  numbers=[...priority,...numbers.filter(n=>!priority.includes(n))];

  g.remaining=numbers;

  g.timer=setInterval(()=>{

    if(!g.remaining.length) return clearInterval(g.timer);

    const n=g.remaining.shift();
    g.called.push(n);

    io.to(gid).emit("number",n);

    checkWins(gid);

  },interval*1000);
}

/* =================================================
   ADMIN CONTROLS
================================================= */

app.post("/start/:gid",(req,res)=>{
  startGame(req.params.gid,req.body.interval);
  res.send("ok");
});

app.post("/stop/:gid",(req,res)=>{
  clearInterval(games[req.params.gid].timer);
  res.send("ok");
});

app.post("/schedule/:gid",(req,res)=>{

  const {time,interval}=req.body;
  const g=games[req.params.gid];

  clearTimeout(g.timeout);

  const now=new Date();
  const target=new Date();

  const [h,m]=time.split(":");

  target.setHours(h);
  target.setMinutes(m);

  if(target<now) target.setDate(target.getDate()+1);

  g.timeout=setTimeout(()=>startGame(req.params.gid,interval),target-now);

  res.send("scheduled");
});

/* =================================================
   PDF DOWNLOAD
================================================= */

app.get("/pdf/:gid",(req,res)=>{

  const g=games[req.params.gid];

  const doc=new PDFDocument({margin:20});

  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition","attachment; filename=tickets.pdf");

  doc.pipe(res);

  let x=20,y=20;

  g.tickets.forEach(t=>{

    doc.rect(x,y,150,90).stroke();
    doc.text("Ticket "+t.id,x+5,y+5);

    x+=170;

    if(x>450){ x=20; y+=110; }
  });

  doc.end();
});

/* ================================================= */

io.on("connection",socket=>{
  socket.on("join",gid=>socket.join(gid));
});

server.listen(3000,()=>console.log("http://localhost:3000/admin.html"));






