/**
 * Convert a DVD BCD time struct to seconds.
 * Same encoding as generateChapters / libdvdnav.
 */
export function dvdTimeToSeconds(dtime: {
  hour?: number;
  minute?: number;
  second?: number;
  frame_u?: number;
} | null | undefined): number {
  if (!dtime) {
    return 0;
  }

  var hour = dtime.hour || 0;
  var minute = dtime.minute || 0;
  var second = dtime.second || 0;
  var frame_u = dtime.frame_u || 0;

  var secondsFrac = parseInt((frame_u & 0x3f).toString(16), 10);
  switch ((frame_u & 0xc0) >> 6) {
    case 1:
      secondsFrac /= 25;
      break;
    case 3:
      secondsFrac /= 30 / 1.001; // 29.97
      break;
    default:
      if (hour === 0 && minute === 0 && second === 0 && frame_u === 0) {
        return 0;
      }
      break;
  }

  return (
    parseInt(hour.toString(16), 10) * 60 * 60 +
    parseInt(minute.toString(16), 10) * 60 +
    parseInt(second.toString(16), 10) +
    secondsFrac
  );
}
