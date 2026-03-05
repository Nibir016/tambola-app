const socket = io();

// Get the Game ID from the URL (Assuming your URL is something like /player.html?gid=game1)
const urlParams = new URLSearchParams(window.location.search);
const gid = urlParams.get('gid');

if (gid) {
    socket.emit("join", gid);
}

// 1. Function to sync the ticket based on the full list of numbers
function syncTicket(allCalled) {
    const cells = document.querySelectorAll(".cell");
    cells.forEach(c => {
        const num = parseInt(c.innerText);
        if (num && allCalled.includes(num)) {
            c.classList.add("marked");
        }
    });
}

// 2. Handle Initial Sync (When player joins or refreshes)
socket.on("initSync", (data) => {
    if (data.allCalled) {
        syncTicket(data.allCalled);
    }
    // Update live display with the last number drawn before joining
    if (data.allCalled.length > 0) {
        document.querySelector(".live").innerText = data.allCalled[data.allCalled.length - 1];
    }
});

// 3. Handle Ongoing Game Updates
socket.on("updateState", (data) => {
    // Update the big number display
    document.querySelector(".live").innerText = data.lastNumber;

    // Sync the ticket with the new list
    syncTicket(data.allCalled);
});

// Keep your existing winner listener if you have one
socket.on("winner", data => {
    alert(`Winner! ${data.type} claimed by Ticket #${data.id}`);
});
