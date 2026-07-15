function updateDateTime() {
  const now = new Date();

  const dateElement = document.getElementById("current-date");
  const timeElement = document.getElementById("current-time");

  if (!dateElement || !timeElement) return;

  dateElement.textContent = now.toLocaleDateString("en-GB", {
    timeZone: "Asia/Colombo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  timeElement.textContent = now.toLocaleTimeString("en-US", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

updateDateTime();
setInterval(updateDateTime, 1000);
