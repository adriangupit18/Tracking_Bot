import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const submissionFilePath =
  process.env.SUBMISSIONS_FILE_PATH ??
  (process.env.VERCEL
    ? path.join(os.tmpdir(), 'discord-report-tracker-submissions.json')
    : path.join(process.cwd(), 'data', 'submissions.json'));

const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const supabaseTableName = process.env.SUPABASE_TABLE_NAME?.trim() || 'submissions';
const useSupabase = Boolean(supabaseUrl && supabaseServiceRoleKey);

function normalizeSubmission(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const userId = String(entry.userId ?? '').trim();
  const username = String(entry.username ?? '').trim();
  const date = String(entry.date ?? '').trim();
  const content = String(entry.content ?? '').trim();

  if (!userId || !username || !date || !content) {
    return null;
  }

  return {
    userId,
    username,
    date,
    content,
  };
}

async function readFileSubmissions() {
  try {
    const raw = await fs.readFile(submissionFilePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeSubmission).filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function writeFileSubmissions(submissions) {
  await fs.mkdir(path.dirname(submissionFilePath), { recursive: true });
  await fs.writeFile(submissionFilePath, `${JSON.stringify(submissions, null, 2)}\n`, 'utf8');
}

async function readSupabaseJson(response) {
  const text = await response.text();

  if (!text) {
    return [];
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function supabaseRequest(pathSuffix, { method = 'GET', query = '', body } = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${supabaseTableName}${pathSuffix}`);

  if (query) {
    url.search = query;
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await readSupabaseJson(response);
    const errorMessage = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    throw new Error(`Supabase request failed (${response.status}): ${errorMessage}`);
  }

  if (response.status === 204) {
    return [];
  }

  return readSupabaseJson(response);
}

async function readSupabaseSubmissions() {
  const query = new URLSearchParams({ select: 'userId,username,date,content' });
  const result = await supabaseRequest('', { query: query.toString() });

  if (!Array.isArray(result)) {
    return [];
  }

  return result.map(normalizeSubmission).filter(Boolean);
}

async function readSupabaseSubmissionsByDate(date) {
  const query = new URLSearchParams({
    select: 'userId,username,date,content',
    date: `eq.${date}`,
  });

  const result = await supabaseRequest('', { query: query.toString() });

  if (!Array.isArray(result)) {
    return [];
  }

  return result.map(normalizeSubmission).filter(Boolean);
}

async function hasSupabaseDuplicate(userId, date) {
  const query = new URLSearchParams({
    select: 'userId',
    userId: `eq.${userId}`,
    date: `eq.${date}`,
    limit: '1',
  });

  const result = await supabaseRequest('', { query: query.toString() });
  return Array.isArray(result) && result.length > 0;
}

export async function getSubmissions() {
  if (useSupabase) {
    return readSupabaseSubmissions();
  }

  return readFileSubmissions();
}

export async function getSubmissionsByDate(date) {
  if (useSupabase) {
    return readSupabaseSubmissionsByDate(date);
  }

  const submissions = await readFileSubmissions();
  return submissions.filter((submission) => submission.date === date);
}

export async function addSubmission(submission) {
  const normalized = normalizeSubmission(submission);

  if (!normalized) {
    throw new Error('Invalid submission payload.');
  }

  if (useSupabase) {
    const duplicate = await hasSupabaseDuplicate(normalized.userId, normalized.date);

    if (duplicate) {
      return {
        inserted: false,
        submission: normalized,
      };
    }

    const inserted = await supabaseRequest('', {
      method: 'POST',
      body: [normalized],
    });

    return {
      inserted: true,
      submission: Array.isArray(inserted) && inserted.length > 0 ? normalizeSubmission(inserted[0]) ?? normalized : normalized,
    };
  }

  const submissions = await readFileSubmissions();
  const duplicate = submissions.some((entry) => entry.userId === normalized.userId && entry.date === normalized.date);

  if (duplicate) {
    return {
      inserted: false,
      submission: normalized,
    };
  }

  submissions.push(normalized);
  await writeFileSubmissions(submissions);

  return {
    inserted: true,
    submission: normalized,
  };
}