import { type Clock } from '../ports/runtime.ts'

/** Default production Clock: real wall time. Pure — lives in core. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}
