export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  private currentTime: number;

  constructor(initialDate: Date | string | number = new Date()) {
    this.currentTime = new Date(initialDate).getTime();
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  set(time: Date | string | number): void {
    this.currentTime = new Date(time).getTime();
  }

  advance(ms: number): void {
    this.currentTime += ms;
  }
}

let currentClock: Clock = new SystemClock();

export const clock = {
  now(): Date {
    return currentClock.now();
  },
};

export function setClock(c: Clock): void {
  currentClock = c;
}

export function resetClock(): void {
  currentClock = new SystemClock();
}
