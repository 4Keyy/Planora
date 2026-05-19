// Priority levels with Russian labels, colors, and descriptions
export const PRIORITY_LEVELS = [
  { key: "VeryLow", label: "Очень низкий", color: "#9ca3af", desc: "Можно отложить" },
  { key: "Low",     label: "Низкий",       color: "#10b981", desc: "Не срочно" },
  { key: "Medium",  label: "Средний",      color: "#0ea5e9", desc: "Стандартно" },
  { key: "High",    label: "Высокий",      color: "#f59e0b", desc: "Важно" },
  { key: "Urgent",  label: "Срочный",      color: "#ef4444", desc: "Делать сейчас" },
] as const

const PRIORITY_TO_NUM: Record<string, number> = {
  VeryLow: 1, Low: 2, Medium: 3, High: 4, Urgent: 5, Critical: 5,
}
const NUM_TO_PRIORITY: Record<string, string> = {
  "1": "VeryLow", "2": "Low", "3": "Medium", "4": "High", "5": "Urgent",
}

export function getPriorityNumber(priority: string): number {
  return PRIORITY_TO_NUM[priority] ?? 3
}

export function getPriorityString(priority: string | number): string {
  const s = String(priority)
  if (PRIORITY_LEVELS.some((p) => p.key === s)) return s
  return NUM_TO_PRIORITY[s] ?? "Medium"
}

export function getPriorityColor(priority: string): string {
  return PRIORITY_LEVELS.find((p) => p.key === priority)?.color ?? "#9ca3af"
}

export function getPriorityLabel(priority: string): string {
  return PRIORITY_LEVELS.find((p) => p.key === priority)?.label ?? "Средний"
}

// Russian locale helpers
const RU_MONTHS_SHORT = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"]
export const RU_MONTHS_LONG  = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"]
export const RU_DAYS_SHORT   = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"]

export function formatDatePretty(isoDate: string): string {
  if (!isoDate) return ""
  const d = new Date(isoDate)
  const day   = d.getDate()
  const month = RU_MONTHS_SHORT[d.getMonth()]
  const year  = d.getFullYear()
  const now   = new Date()
  if (year === now.getFullYear()) return `${day} ${month}`
  return `${day} ${month} ${year}`
}

export function formatRelativeRu(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now()
  const days = Math.round(diff / 86_400_000)
  if (days === 0)  return "сегодня"
  if (days === 1)  return "завтра"
  if (days === -1) return "вчера"
  if (days > 0)   return `через ${days} дн`
  return `${Math.abs(days)} дн назад`
}

export function formatDayLabel(iso: string): string {
  const d      = new Date(iso)
  const today  = new Date()
  const yest   = new Date(today); yest.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return "Сегодня"
  if (sameDay(d, yest))  return "Вчера"
  return `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]}`
}

export function formatTimeHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function toIsoDate(iso: string): string {
  return new Date(iso).toISOString().split("T")[0]
}

// Stable hue from an ID string (for avatar gradients)
export function getHueFromId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % 360
}

// System event verb → marker color
export function getSystemEventColor(content: string): string {
  const lower = content.toLowerCase()
  if (lower.includes("взял в работу") || lower.includes("завершил")) return "#10b981"
  if (lower.includes("присоединился"))  return "#0ea5e9"
  if (lower.includes("приостановил"))   return "#f59e0b"
  if (lower.includes("покинул"))        return "#ef4444"
  return "#a3a3a3"
}

export const CATEGORY_COLOR_SWATCHES = [
  "#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#ec4899","#06b6d4","#84cc16","#f97316","#6366f1",
  "#14b8a6","#a855f7",
]
