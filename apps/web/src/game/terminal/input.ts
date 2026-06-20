export function keyboardEventToTerminalInput(event: KeyboardEvent) {
  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "c") return "\u0003";
    if (key === "d") return "\u0004";
  }

  if (event.metaKey || event.ctrlKey || event.altKey) return null;

  if (event.key === "Enter") return "\r";
  if (event.key === "Backspace") return "\u007f";
  if (event.key === "Tab") return "\t";
  if (event.key === "ArrowUp") return "\u001b[A";
  if (event.key === "ArrowDown") return "\u001b[B";
  if (event.key === "ArrowRight") return "\u001b[C";
  if (event.key === "ArrowLeft") return "\u001b[D";
  if (event.key.length === 1) return event.key;
  return null;
}
