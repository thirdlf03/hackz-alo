export function containsPoint(
  rect: {x: number; y: number; width: number; height: number},
  x: number,
  y: number
) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}
