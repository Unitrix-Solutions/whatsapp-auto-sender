let widget = null;
let isDragging = false;
let currentX;
let currentY;
let initialX;
let initialY;
let xOffset = 0;
let yOffset = 0;

function createWidget() {
  if (widget) return;

  widget = document.createElement("div");
  widget.id = "wa-sender-widget";

  const header = document.createElement("div");
  header.id = "wa-sender-header";

  const icon = document.createElement("div");
  icon.id = "wa-sender-icon";
  icon.textContent = "💬";

  const titleContainer = document.createElement("div");
  titleContainer.id = "wa-sender-title-container";
  titleContainer.style.flexGrow = "1";
  titleContainer.style.display = "flex";
  titleContainer.style.flexDirection = "column";

  const title = document.createElement("div");
  title.id = "wa-sender-title";
  title.textContent = "WA Auto Sender";

  const subtitle = document.createElement("div");
  subtitle.style.fontSize = "10px";
  subtitle.style.color = "#5d8a63";
  subtitle.textContent = "Powered by Unitrix Solutions";

  titleContainer.appendChild(title);
  titleContainer.appendChild(subtitle);

  const collapseBtn = document.createElement("button");
  collapseBtn.className = "wa-sender-btn";
  collapseBtn.textContent = "−";
  collapseBtn.title = "Collapse/Expand";

  const closeBtn = document.createElement("button");
  closeBtn.className = "wa-sender-btn";
  closeBtn.textContent = "✕";
  closeBtn.title = "Close";

  header.appendChild(icon);
  header.appendChild(titleContainer);
  header.appendChild(collapseBtn);
  header.appendChild(closeBtn);

  const iframe = document.createElement("iframe");
  iframe.id = "wa-sender-iframe";
  iframe.src = chrome.runtime.getURL("popup.html");

  widget.appendChild(header);
  widget.appendChild(iframe);
  document.body.appendChild(widget);

  // Dragging logic
  header.addEventListener("mousedown", dragStart);
  document.addEventListener("mousemove", drag);
  document.addEventListener("mouseup", dragEnd);

  function dragStart(e) {
    if (e.target === collapseBtn || e.target === closeBtn) return;
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;
    isDragging = true;
  }

  function drag(e) {
    if (!isDragging) return;
    e.preventDefault();
    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;
    xOffset = currentX;
    yOffset = currentY;
    widget.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
  }

  function dragEnd() {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
  }

  // Button logic
  collapseBtn.addEventListener("click", () => {
    widget.classList.toggle("collapsed");
    collapseBtn.textContent = widget.classList.contains("collapsed") ? "□" : "−";
  });

  closeBtn.addEventListener("click", () => {
    widget.style.display = "none";
  });

  // Also expand when clicking the icon if collapsed
  icon.addEventListener("click", () => {
    if (widget.classList.contains("collapsed")) {
      widget.classList.remove("collapsed");
      collapseBtn.textContent = "−";
    }
  });
}

function toggleWidget() {
  if (!widget) {
    createWidget();
  } else {
    widget.style.display = widget.style.display === "none" ? "flex" : "none";
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "toggle_widget") {
    toggleWidget();
    sendResponse({ status: "ok" });
  }
  return true;
});
