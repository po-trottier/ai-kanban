import { uuidv7 } from 'uuidv7'
import { type IdGenerator } from '../ports/runtime.ts'

/**
 * Default production IdGenerator: UUIDv7, time-ordered so audit events and
 * entities sort chronologically by id. Pure algorithm library — lives in core.
 */
export class Uuidv7IdGenerator implements IdGenerator {
  newId(): string {
    return uuidv7()
  }
}
