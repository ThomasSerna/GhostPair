import type { ControlCommand } from '@ghostpair/protocol';

/** Only movement is replaceable. Discrete input and cancellation preserve their order. */
export class InputBuffer {
  private move?: Extract<ControlCommand, { type: 'pointer' }>;
  private frame?: number;
  constructor(private emit: (command: ControlCommand) => void) {}

  send(command: ControlCommand) {
    if (command.type === 'input.release') { this.discard(); this.emit(command); return; }
    if (command.type === 'pointer' && command.event === 'move') {
      this.move = command;
      if (this.frame === undefined) this.frame = requestAnimationFrame(() => { this.frame = undefined; this.flush(); });
      return;
    }
    this.flush(); this.emit(command);
  }
  flush() {
    const move = this.move; this.discard();
    if (move) this.emit(move);
  }
  discard() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined; this.move = undefined;
  }
}
