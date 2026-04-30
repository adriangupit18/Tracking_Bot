function parseServerMembers(value) {
  if (!value) {
    return [];
  }

  let parsed;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    console.warn('[server-members] SERVER_MEMBERS_JSON is invalid JSON, using an empty list instead.');
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn('[server-members] SERVER_MEMBERS_JSON is not an array, using an empty list instead.');
    return [];
  }

  return parsed
    .map((entry) => ({
      userId: String(entry?.userId ?? '').trim(),
      username: String(entry?.username ?? '').trim(),
    }))
    .filter((entry) => entry.userId.length > 0 && entry.username.length > 0);
}

export const SERVER_MEMBERS = parseServerMembers(process.env.SERVER_MEMBERS_JSON);