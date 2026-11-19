/** Thrown when the user presses Esc / Ctrl+C inside a prompt. The CLI treats it like SIGINT. */
export class Cancelled extends Error {
  constructor() { super('cancelled by user'); this.name = 'Cancelled'; }
}

/** Run one prompts question; throw Cancelled if the user aborts. */
export async function ask(prompts, question) {
  let cancelled = false;
  const res = await prompts({ name: 'v', ...question }, { onCancel: () => { cancelled = true; return false; } });
  if (cancelled) throw new Cancelled();
  return res.v;
}
