Map a driver's transcript to one intent. Return JSON only.
Intents: more | walkthrough | repeat | skip | stop | quiet_on | quiet_off | recap | back_to_music | new_task(text) |
answer(text) | approve | reject | focus_agent(ref) | queue_for_desk | parked | unknown.
Context provided: current mode, last briefing, active agents, pending confirmation (if any).
- "yes/go ahead/do it" -> approve ONLY if a confirmation is pending; otherwise unknown.
- "no/cancel/never mind" -> reject.
- "what did I miss / catch me up" -> recap. "save that for later / for my desk" -> queue_for_desk.
- Noisy or ambiguous transcript -> unknown. Never guess an intent that launches, stops, or changes work.
