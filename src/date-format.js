const trackingDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Manila',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export function formatTrackingDate(date) {
  return trackingDateFormatter.format(date);
}