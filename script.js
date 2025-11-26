// Start lottery
function startLottery() {
    let lottery = {
        status: "open",
        tickets: [],
        winningNumber: null
    };

    localStorage.setItem("lottery", JSON.stringify(lottery));
    alert("Lottery Started!");
}

// Close lottery
function closeLottery() {
    let lottery = JSON.parse(localStorage.getItem("lottery"));

    if (!lottery || lottery.status !== "open") {
        alert("No active lottery!");
        return;
    }

    lottery.status = "closed";
    lottery.winningNumber = Math.floor(Math.random() * 10);

    localStorage.setItem("lottery", JSON.stringify(lottery));

    document.getElementById("winner").innerText = lottery.winningNumber;

    alert("Lottery closed! Winner picked!");
}

// Buy ticket
function buyTicket() {
    let username = document.getElementById("username").value;
    let number = Number(document.getElementById("number").value);

    if (!username || isNaN(number)) {
        alert("Enter all fields!");
        return;
    }

    if (number < 0 || number > 9) {
        alert("Pick a number from 0-9!");
        return;
    }

    let lottery = JSON.parse(localStorage.getItem("lottery"));

    if (!lottery || lottery.status !== "open") {
        alert("Lottery is not open!");
        return;
    }

    lottery.tickets.push({
        user: username,
        number: number
    });

    localStorage.setItem("lottery", JSON.stringify(lottery));

    alert("Ticket bought!");
}

// Show tickets in Admin
function showTickets() {
    let lottery = JSON.parse(localStorage.getItem("lottery"));

    document.getElementById("ticketList").textContent =
        JSON.stringify(lottery.tickets, null, 4);
}

// User page load logic
window.onload = function () {
    let lottery = JSON.parse(localStorage.getItem("lottery"));

    if (!lottery) return;

    // Update status on user page
    let statusText = document.getElementById("statusText");
    let winningNum = document.getElementById("winningNum");

    if (statusText) {
        statusText.innerText = lottery.status === "open"
            ? "Lottery is OPEN"
            : "Lottery is CLOSED";
    }

    if (winningNum && lottery.winningNumber !== null) {
        winningNum.innerText = lottery.winningNumber;
    }
};
