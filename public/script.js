const socket = io();

socket.on("number", n => {
  document.querySelector(".live").innerText = n;

  document.querySelectorAll(".cell").forEach(c => {
    if (c.innerText == n) c.classList.add("marked");
  });
});
