function parseServerMembers(value) {
  if (!value) {
    return [];
  }

  const parsed = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    throw new Error('SERVER_MEMBERS_JSON must be a JSON array.');
  }

  return parsed
    .map((entry) => ({
      userId: String(entry?.userId ?? '').trim(),
      username: String(entry?.username ?? '').trim(),
    }))
    .filter((entry) => entry.userId.length > 0 && entry.username.length > 0);
}

export const SERVER_MEMBERS = parseServerMembers(process.env.SERVER_MEMBERS_JSON);