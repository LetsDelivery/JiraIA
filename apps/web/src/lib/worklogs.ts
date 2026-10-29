/** "2h 30min", "45min", "3h" — logged time as people read it. */
export const duration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) {
    return `${rest}min`
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}min`
}
