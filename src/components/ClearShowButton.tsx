import { useState } from "react";

/** "Clear this show" with an inline confirm step, since it deletes progress and chats. */
export function ClearShowButton({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <button className="link" onClick={() => setConfirming(true)}>Clear this show</button>;
  return (
    <span className="confirm" role="group" aria-label="Confirm clearing this show">
      Clear all saved progress and chat history for this show? This can't be undone.
      <button className="link danger" onClick={onConfirm}>Yes, clear it</button>
      <button className="link" autoFocus onClick={() => setConfirming(false)}>Cancel</button>
    </span>
  );
}
