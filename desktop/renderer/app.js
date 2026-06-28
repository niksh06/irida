// Renderer: turn a pet-state payload into a sprite + a reacting speech bubble.
const stage = document.getElementById("stage");
const sprite = document.getElementById("sprite");
const bubble = document.getElementById("bubble");
const bubbleText = document.getElementById("bubble-text");
document.getElementById("close").addEventListener("click", () => window.petAPI.quit());

// State → animated, transparent WebP sprite. `working` is the real chase loop
// (build-dog-overlay.py); the rest are synthesized from the static art
// (build-dog-states.py). All carry their motion in real frames.
const SPRITE = {
  idle: "idle.webp",
  working: "working.webp",
  happy: "happy.webp",
  sad: "sad.webp",
  sleep: "sleep.webp",
};

const TIPS = {
  idle: "Привет! Я Пёс. Чем займёмся?",
  working: (label) => (label ? `Ловлю ${label}, как бабочку… 🦋` : "Ловлю баг, как бабочку… 🦋"),
  happy: "Готово! Ход прошёл чисто. 🎉",
  sad: "Хм, тут ошибка. Посмотрим вместе?",
  sleep: "Zzz… разбуди, когда понадоблюсь.",
};

const STATES = ["idle", "working", "happy", "sad", "sleep"];

let bubbleTimer = null;

function tip(state, label) {
  const t = TIPS[state];
  return typeof t === "function" ? t(label) : t;
}

function showBubble(text) {
  bubbleText.textContent = text;
  bubble.classList.add("show");
  if (bubbleTimer) clearTimeout(bubbleTimer);
  // Keep "resting" states quiet after a while; working/sad stay up.
  bubbleTimer = setTimeout(() => bubble.classList.remove("show"), 6000);
}

let current = null;

function apply(payload) {
  const state = STATES.includes(payload.state) ? payload.state : "idle";
  const sig = `${state}|${payload.label || ""}|${payload.assetsDir}`;
  if (sig === current) return;
  current = sig;

  // encodeURI so paths with spaces (e.g. "Cursor agent") still load.
  sprite.src = "file://" + encodeURI(`${payload.assetsDir}/${SPRITE[state]}`);
  for (const s of STATES) stage.classList.remove(`state-${s}`);
  stage.classList.add(`state-${state}`);
  showBubble(tip(state, payload.label));
}

window.petAPI.onState(apply);
