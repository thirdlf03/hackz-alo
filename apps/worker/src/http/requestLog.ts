export function logStructured(event: string, fields: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...fields,
    })
  );
}
