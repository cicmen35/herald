import type { Intent, Mode, PendingAction } from "./types.js";

export interface IntentContext {
  mode: Mode;
  pending?: PendingAction | null;
}

const APPROVE = /^(yes|yeah|yep|yup|go ahead|do it|confirm|proceed|ok|okay|affirmative)[.!?]?$/i;
const REJECT = /^(no|nope|cancel|never mind|nevermind|stop that|don't|do not)[.!?]?$/i;

export function parseIntent(transcript: string, ctx: IntentContext): Intent {
  const text = transcript.trim();
  if (!text) return { type: "unknown" };

  if (ctx.pending) {
    if (APPROVE.test(text)) return { type: "approve" };
    if (REJECT.test(text)) return { type: "reject" };
  } else if (APPROVE.test(text)) {
    return { type: "unknown" };
  }

  if (REJECT.test(text) && /cancel|never mind|stop that/i.test(text)) {
    return { type: "reject" };
  }

  if (/^more[.!?]?$/i.test(text) || /^tell me more/i.test(text)) return { type: "more" };
  if (/walk me through|walkthrough/i.test(text)) return { type: "walkthrough" };
  if (/^repeat/i.test(text) || /say that again/i.test(text)) return { type: "repeat" };
  if (/^skip/i.test(text)) return { type: "skip" };
  if (/^stop$|^quiet$|^silence$/i.test(text)) return { type: "stop" };
  if (/quiet mode on|go quiet|interrupts only/i.test(text)) return { type: "quiet_on" };
  if (/quiet mode off|stop being quiet/i.test(text)) return { type: "quiet_off" };
  if (/what did i miss|catch me up|recap/i.test(text)) return { type: "recap" };
  if (/back to (music|the podcast)|that's all|that is all/i.test(text)) {
    return { type: "back_to_music" };
  }
  if (/save (that |it )?for (later|my desk)|for my desk/i.test(text)) {
    return { type: "queue_for_desk" };
  }
  if (/i('m| am) parked|drive('s| is) over/i.test(text)) return { type: "parked" };

  if (/^(start|launch|spin up|kick off)\b/i.test(text) || /\bnew (task|agent)\b/i.test(text)) {
    return { type: "new_task", text };
  }

  return { type: "unknown" };
}
