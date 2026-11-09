// feature flag: off, a tap on a task button or a mode picker row confirms at once instead of
// waiting for a hold. A function, so stories can switch it.
export function holdToConfirmEnabled(): boolean {
  return false;
}
