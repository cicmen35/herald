/**
 * Herald car client. Simulates in-car behaviour: media playing, earcons for
 * routine events, ducking, spoken briefings, barge-in, and one big control.
 */
import { MediaLayer } from "./media.js";
import { Earcons } from "./earcons.js";

const body = document.body;
const lamp = document.getElementById("lamp");
const modeLabel = document.getElementById("modeLabel");
const bigButton = document.getElementById("bigButton");
const bigLabel = document.getElementById("bigLabel");
const caption = document.getElementById("caption");
const mediaState = document.getElementById("mediaState");
const agentState = document.getElementById("agentState");
const deskState = document.getElementById("deskState");
const logEl = document.getElementById("log");
const sim = document.getElementById("sim");
const simToggle = document.getElementById("simToggle");
const ttsToggle = document.getElementById("ttsToggle");
const vadToggle = document.getElementById("vadToggle");
const typeForm = document.getElementById("typeForm");
const typeInput = document.getElementById("typeInput");
const parkBtn = document.getElementById("parkBtn");

const MODE_TEXT = {
  IDLE: "Not driving",
  LISTEN: "Listening to media",
  BRIEFING: "Herald speaking",
  TALK: "Talking to Herald",
  CONFIRM: "Waiting for yes or no",
  PARKED: "Parked",
};

/** A press longer than this is push-to-talk; anything shorter is a tap toggle. */
const HOLD_MS = 500;
/** Silence after which the driver goes back to their media. */
const IDLE_MS = 8000;
/** Chrome ends a recognition session on its own; how often we may reopen it. */
const MAX_REOPENS = 4;

let media;
let earcons;
let mode = "IDLE";
let driving = false;
let speaking = false;
let currentUtterance = null;
let recognition = null;
let micGranted = false;
let micOpen = false;
// The driver has the floor. Separate from `mode`, because the mode must never
// claim to be listening when no microphone is actually open.
let talkTurn = false;
let submitted = false;
let reopens = 0;
let thinking = false;
let lastTranscript = "";
let silenceTimer = null;
let returnToListenTimer = null;
let releaseTimer = null;
let releasePending = false;
// Only an unanswered question may hold the mic open on its own.
let needsAnswer = false;
let pendingConfirm = false;
let lastPending = null;

function log(line) {
  const stamp = new Date().toTimeString().slice(0, 8);
  logEl.textContent = `${stamp}  ${line}\n${logEl.textContent}`.slice(0, 6000);
}

function setMode(next, why) {
  if (next !== mode) log(`mode ${mode} → ${next}${why ? ` (${why})` : ""}`);
  mode = next;
  body.dataset.mode = next;
  modeLabel.textContent = MODE_TEXT[next] ?? next;
  refreshButton();
}

/**
 * The button must describe the microphone, not our intention. A label that says
 * "listening" over a closed mic is what makes the control feel stuck.
 */
function refreshButton() {
  if (micOpen) body.dataset.mic = "1";
  else delete body.dataset.mic;

  if (!driving) bigLabel.textContent = "Start drive";
  else if (thinking) bigLabel.textContent = "One moment…";
  else if (micOpen) bigLabel.textContent = "Listening… release or tap to stop";
  else if (talkTurn) bigLabel.textContent = vadToggle.checked ? "Opening mic…" : "Mic off — type instead";
  else if (speaking) bigLabel.textContent = "Tap to interrupt";
  else bigLabel.textContent = "Hold or tap to talk";
}

function setAlert(on) {
  if (on) body.dataset.alert = "1";
  else delete body.dataset.alert;
}

/* ---------- speech out ---------- */

/** Detaches handlers first, so a cancel never runs the end-of-briefing logic. */
function cancelSpeech() {
  if (currentUtterance) {
    currentUtterance.onend = null;
    currentUtterance.onerror = null;
    currentUtterance = null;
  }
  window.speechSynthesis?.cancel();
  speaking = false;
}

function say(text, priority) {
  if (!text) return;
  caption.textContent = text;
  if (!ttsToggle.checked || !window.speechSynthesis) {
    log(`(silent) ${text}`);
    afterSpeech();
    return;
  }
  // An interrupt may cut a lower-priority line.
  if (speaking && priority === "interrupt") cancelSpeech();

  // Herald's own voice comes back through the car speakers, so an open mic
  // transcribes the briefing and ends the turn a second later. Close it and
  // reopen once we stop talking; the big button covers barge-in meanwhile.
  if (micOpen) {
    closeRecognition();
    log("mic closed while Herald speaks");
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.06;
  currentUtterance = utterance;
  speaking = true;
  if (driving) {
    setMode("BRIEFING", "speaking");
    media.duck(true);
  }
  const done = () => {
    if (currentUtterance !== utterance) return;
    currentUtterance = null;
    speaking = false;
    media.duck(false);
    afterSpeech();
  };
  utterance.onend = done;
  utterance.onerror = done;
  // Chrome sometimes never fires `onend` (backgrounded tab, long utterance).
  // Without this the client would believe it is still speaking for ever.
  setTimeout(done, Math.max(8000, text.length * 90));
  window.speechSynthesis.speak(utterance);
  log(`speak(${priority}): ${text}`);
  refreshButton();
}

function afterSpeech() {
  if (!driving) {
    refreshButton();
    return;
  }
  // The driver still has the floor: give their microphone back.
  if (talkTurn) {
    setMode(pendingConfirm ? "CONFIRM" : "TALK", "back to the driver");
    media.duck(true);
    openRecognition();
    armIdleReturn();
    return;
  }
  // Only an outstanding question keeps the mic open. A briefing that is just
  // news must hand the driver back to their media, or the button looks broken:
  // the client sits in TALK and the next press reads as "close talk".
  if (needsAnswer) startTalk("answer needed");
  else setMode("LISTEN", "briefing over");
}

/* ---------- server round trip ---------- */

async function send(text) {
  if (!text.trim()) return;
  log(`you: ${text}`);
  thinking = true;
  refreshButton();
  try {
    const res = await fetch("/api/utterance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    applyState(data.state);
    for (const msg of data.messages ?? []) {
      if (msg.type === "speak") say(msg.text, msg.priority ?? "speak");
      if (msg.type === "mode" && msg.mode === "LISTEN" && !speaking && !talkTurn) {
        setMode("LISTEN", "chief");
      }
      // While Herald is speaking, the end of the briefing settles the mode.
      if (msg.type === "mode" && msg.mode === "CONFIRM" && !speaking) setMode("CONFIRM", "chief");
    }
  } catch (err) {
    // Never leave the driver in silence wondering whether it heard them.
    log(`server unreachable (${err.name})`);
    caption.textContent = "I lost the connection. Try again in a moment.";
    backToMedia("server unreachable");
  } finally {
    thinking = false;
    refreshButton();
  }
}

function applyState(state) {
  if (!state) return;
  agentState.textContent = state.activeAgents ? `${state.activeAgents} working` : "No agents";
  deskState.textContent = `Desk ${state.deskCount}`;
  needsAnswer = Boolean(state.openQuestion) || Boolean(state.pending);
  setAlert(needsAnswer);

  // Only a *new* confirmation moves the driver into CONFIRM. Re-applying it on
  // every state push would drag the UI back into a mode they just left.
  const pending = state.pending ?? null;
  pendingConfirm = Boolean(pending);
  if (pending && pending !== lastPending && driving) setMode("CONFIRM", "confirmation pending");
  // A confirmation that expired server-side must not leave the driver waiting
  // in CONFIRM. Mid-turn the briefing settles the mode instead.
  if (!pending && lastPending && mode === "CONFIRM" && !speaking && !thinking && !talkTurn) {
    backToMedia("confirmation resolved");
  }
  lastPending = pending;
}

/* ---------- microphone ---------- */

function SpeechRec() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

/**
 * Prompts for permission only. The track is released straight away: Web Speech
 * opens its own capture, and a second live track makes Chrome raise
 * `not-allowed`/`aborted` and leaves the mic indicator on all drive.
 */
async function ensureMic() {
  if (micGranted) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    micGranted = true;
    log("mic granted");
    return true;
  } catch (err) {
    log(`mic unavailable (${err.name}); use the sim text box`);
    return false;
  }
}

/**
 * Opens a talk turn. Every failure path hands the driver back to their media
 * rather than parking the interface in a TALK mode with a dead microphone.
 */
async function startTalk(source) {
  if (!driving || talkTurn) return;
  talkTurn = true;
  submitted = false;
  releasePending = false;
  reopens = 0;
  lastTranscript = "";
  setMode(pendingConfirm || mode === "CONFIRM" ? "CONFIRM" : "TALK", `talk via ${source}`);
  media.duck(true);
  earcons.play("mode");
  // Armed before any early return, so TALK can never become permanent.
  armIdleReturn();

  if (!SpeechRec()) {
    caption.textContent = "This browser can't hear me. Type in the simulator.";
    backToMedia("no speech recognition");
    return;
  }
  if (!vadToggle.checked) {
    log("hands-free mic off; type in the simulator");
    refreshButton();
    return;
  }
  if (!(await ensureMic())) {
    caption.textContent = "I can't reach the microphone. Type in the simulator.";
    backToMedia("mic unavailable");
    return;
  }
  // The driver may have closed the turn while the permission prompt was up.
  if (!talkTurn) return;
  openRecognition();
}

function openRecognition() {
  if (recognition || !talkTurn || submitted) return;
  if (!micGranted || !vadToggle.checked) return;
  const Ctor = SpeechRec();
  if (!Ctor) return;

  const rec = new Ctor();
  recognition = rec;
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  rec.onstart = () => {
    micOpen = true;
    log("mic open");
    refreshButton();
    // The driver may release while the permission prompt is still visible.
    if (releasePending) finishPushToTalk();
  };

  rec.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const text = (result[0]?.transcript ?? "").trim();
    if (!text) return;
    reopens = 0;
    lastTranscript = text;
    // Barge-in: any speech stops Herald immediately.
    if (speaking) {
      cancelSpeech();
      media.duck(true);
      setMode("TALK", "barge-in");
    }
    caption.textContent = text;
    clearTimeout(silenceTimer);
    armIdleReturn();
    // A physical hold is authoritative: Web Speech may mark a short phrase
    // final while the driver is still pressing, but push-to-talk ends only on
    // release. Tap-to-talk still auto-submits final speech or a short pause.
    const heldPushToTalk = pressActive && pressOpenedTurn;
    if (result.isFinal) {
      if (!heldPushToTalk) submit(text);
    } else if (!heldPushToTalk) {
      silenceTimer = setTimeout(() => submit(text), 1200);
    }
  };

  rec.onerror = (event) => {
    log(`stt error ${event.error}`);
    // `no-speech` fires after a few quiet seconds and `aborted` fires whenever
    // we stop(); both are routine, and `onend` decides whether to reopen.
    if (event.error === "no-speech" || event.error === "aborted") return;
    // Never leave the driver holding an open mic that cannot hear them.
    talkTurn = false;
    caption.textContent = "I can't hear you right now. Tap again, or type in the simulator.";
    backToMedia(`stt ${event.error}`);
  };

  rec.onend = () => {
    micOpen = false;
    if (recognition === rec) recognition = null;
    refreshButton();
    if (!talkTurn || submitted) return;
    if (releasePending) {
      // `stop()` asks Web Speech for a final result. If it ended without one,
      // there is nothing safe to send.
      clearTimeout(releaseTimer);
      releasePending = false;
      if (lastTranscript) submit(lastTranscript);
      else backToMedia("nothing heard");
      return;
    }
    // Chrome closes a session after a pause even with `continuous`. Reopen, or
    // the button would read "listening" over a microphone that is off.
    if (reopens < MAX_REOPENS) {
      reopens += 1;
      setTimeout(() => openRecognition(), 120);
      return;
    }
    backToMedia("mic kept closing");
  };

  try {
    rec.start();
  } catch (err) {
    log(`mic start failed (${err.name})`);
    if (recognition === rec) recognition = null;
    backToMedia("mic start failed");
  }
}

/** Ends the turn by sending whatever was heard; guards against double sends. */
function submit(text) {
  if (submitted) return;
  submitted = true;
  releasePending = false;
  clearTimeout(releaseTimer);
  talkTurn = false;
  closeRecognition();
  clearTimeout(returnToListenTimer);
  send(text);
}

/** Closes the capture without ending the turn. */
function closeRecognition() {
  clearTimeout(silenceTimer);
  const rec = recognition;
  recognition = null;
  micOpen = false;
  refreshButton();
  if (!rec) return;
  rec.onstart = null;
  rec.onresult = null;
  rec.onerror = null;
  rec.onend = null;
  try {
    rec.abort();
  } catch {
    // ignore
  }
}

/**
 * Ends a held push-to-talk without aborting its audio. `recognition.stop()`
 * flushes the final transcript; aborting here loses short utterances.
 */
function finishPushToTalk() {
  releasePending = true;
  clearTimeout(silenceTimer);
  clearTimeout(releaseTimer);
  if (!recognition || !micOpen) {
    // Permission/startup may still be in flight. `onstart` will finish it.
    releaseTimer = setTimeout(() => {
      if (releasePending && talkTurn) backToMedia("microphone did not open");
    }, 3000);
    return;
  }
  try {
    recognition.stop();
  } catch (err) {
    log(`mic stop failed (${err.name})`);
    if (lastTranscript) submit(lastTranscript);
    else backToMedia("microphone did not stop");
    return;
  }
  // Some implementations omit `onend`; never leave the control stuck.
  releaseTimer = setTimeout(() => {
    if (!releasePending || !talkTurn) return;
    if (lastTranscript) submit(lastTranscript);
    else backToMedia("nothing heard");
  }, 1800);
}

/** After a completed turn, silence returns the driver to their media. */
function armIdleReturn() {
  clearTimeout(returnToListenTimer);
  returnToListenTimer = setTimeout(() => {
    if (!driving) return;
    // Don't cut Herald off mid-sentence; check again when it stops.
    if (speaking || thinking) {
      armIdleReturn();
      return;
    }
    if (talkTurn || mode === "TALK" || mode === "CONFIRM") backToMedia("idle timeout");
  }, IDLE_MS);
}

function backToMedia(why) {
  talkTurn = false;
  submitted = false;
  releasePending = false;
  clearTimeout(releaseTimer);
  lastTranscript = "";
  closeRecognition();
  clearTimeout(returnToListenTimer);
  setMode("LISTEN", why);
  media?.duck(false);
  earcons?.play("mode");
}

/* ---------- drive lifecycle ---------- */

async function startDrive() {
  media = media ?? new MediaLayer();
  earcons = earcons ?? new Earcons(media.context);
  await media.start();
  driving = true;
  setMode("LISTEN", "drive started");
  mediaState.textContent = "Background audio off";
  bindMediaSession();
  log("drive started; media playing");
  await fetch("/api/sim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: "seed" }),
  });
}

/* ---------- the one big control ---------- */

let pressActive = false;
let pressStartedAt = 0;
let pressOpenedTurn = false;

bigButton.addEventListener("pointerdown", async (event) => {
  bigButton.setPointerCapture?.(event.pointerId);
  pressActive = true;
  pressStartedAt = performance.now();
  pressOpenedTurn = false;
  if (!driving) return; // the release starts the drive
  // Pressing the button while Herald talks is barge-in: it takes the floor.
  if (speaking) {
    cancelSpeech();
    media.duck(true);
    log("barge-in via button");
  }
  if (talkTurn) return; // a live turn: the release decides hold vs tap
  pressOpenedTurn = true;
  await startTalk("big button");
});

bigButton.addEventListener("pointerup", async (event) => {
  bigButton.releasePointerCapture?.(event.pointerId);
  if (!pressActive) return; // a release we never saw the press for
  pressActive = false;
  const heldMs = performance.now() - pressStartedAt;
  if (!driving) {
    await startDrive();
    return;
  }
  if (heldMs >= HOLD_MS) {
    // Push-to-talk: releasing ends the turn and sends whatever was heard.
    if (talkTurn) finishPushToTalk();
    return;
  }
  // A tap toggles: it opened the turn above, or it closes the live one.
  if (!pressOpenedTurn && talkTurn) backToMedia("tap closed talk");
  else if (!pressOpenedTurn) await startTalk("tap");
});

bigButton.addEventListener("pointercancel", () => {
  pressActive = false;
  if (talkTurn) backToMedia("press cancelled");
});

// Keyboard activation still reaches the button (pointer events don't fire).
bigButton.addEventListener("click", async (event) => {
  if (event.detail !== 0) return;
  if (!driving) await startDrive();
  else if (talkTurn) backToMedia("keyboard closed talk");
  else await startTalk("keyboard");
});

/* Headset / steering-wheel play-pause as push-to-talk. */
function bindMediaSession() {
  if (!("mediaSession" in navigator)) {
    log("no Media Session API; on-screen button only");
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: "Herald",
    artist: "Drive session",
  });
  navigator.mediaSession.playbackState = "playing";
  const handler = (name) => () => {
    log(`media key ${name} → push to talk`);
    if (talkTurn) backToMedia(`media key ${name}`);
    else startTalk(`media-key:${name}`);
  };
  for (const action of ["play", "pause", "stop", "nexttrack"]) {
    try {
      navigator.mediaSession.setActionHandler(action, handler(action));
    } catch {
      log(`media key ${action} unsupported`);
    }
  }
}

/* ---------- server events ---------- */

const stream = new EventSource("/api/events");
stream.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "state") {
    applyState(msg.state);
    return;
  }
  if (msg.type === "earcon") {
    earcons?.play(msg.kind, msg.agentId);
    log(`earcon ${msg.kind} (${msg.agentLabel ?? "agent"})`);
    return;
  }
  if (msg.type === "speak") {
    if (!driving) {
      log(`(not driving) ${msg.text}`);
      return;
    }
    earcons?.play(msg.priority === "interrupt" ? "needs_you" : "finished", msg.agentId);
    say(msg.text, msg.priority ?? "speak");
  }
};
stream.onerror = () => log("event stream dropped; retrying");

/* ---------- simulator panel ---------- */

simToggle.addEventListener("click", () => {
  sim.hidden = !sim.hidden;
});

for (const button of sim.querySelectorAll("[data-scenario]")) {
  button.addEventListener("click", async () => {
    await fetch("/api/sim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: button.dataset.scenario, label: button.textContent }),
    });
    log(`sim: ${button.dataset.scenario}`);
  });
}

vadToggle.addEventListener("change", refreshButton);

typeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = typeInput.value;
  typeInput.value = "";
  send(text);
});

parkBtn.addEventListener("click", () => send("I'm parked"));

setMode("IDLE");
log(`speechSynthesis=${!!window.speechSynthesis} stt=${!!SpeechRec()} mediaSession=${"mediaSession" in navigator}`);
