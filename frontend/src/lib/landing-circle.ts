/**
 * The hero card's circle: three seats and the one sentence that describes who is in.
 *
 * The task is a surprise party for Mira, which is the whole trick: the visitor learns that
 * a task carries its audience by discovering that adding one particular person changes
 * what the task is. Names are always read in seat order — Victoria, Tom, Mira — so the
 * sentence never reshuffles itself depending on which chip was pressed first.
 */

export type SeatId = "victoria" | "tom" | "mira"

export interface Seat {
  id: SeatId
  firstName: string
  lastName: string
}

export const CIRCLE_SEATS: readonly Seat[] = [
  { id: "victoria", firstName: "Victoria", lastName: "Whitfield" },
  { id: "tom", firstName: "Tom", lastName: "Achebe" },
  { id: "mira", firstName: "Mira", lastName: "Sandoval" },
]

/** The person the task is secretly about. */
export const SURPRISE_FOR: SeatId = "mira"

export const CIRCLE_TASK_TITLE = "Plan Mira's surprise party"

/** The selected seats, in seat order, whatever order they were pressed in. */
export function inSeatOrder(selected: readonly SeatId[]): Seat[] {
  return CIRCLE_SEATS.filter((seat) => selected.includes(seat.id))
}

/** "You", "You and Victoria", "You, Victoria and Tom" — no Oxford comma, "and" before the last. */
function withYou(names: string[]): string {
  const all = ["You", ...names]
  if (all.length === 1) return "Only you"
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`
}

export function circleSentence(selected: readonly SeatId[]): string {
  const seats = inSeatOrder(selected)
  if (seats.length === 0) return "Only you can see this."
  const sentence = `${withYou(seats.map((s) => s.firstName))} can see this.`
  return selected.includes(SURPRISE_FOR) ? `${sentence} So much for the surprise.` : sentence
}
