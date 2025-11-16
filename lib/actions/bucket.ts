'use server';

import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bucket as bucketTable, task as taskTable } from '@/lib/schema';
import { ensureOpenAIConfigured, openai } from '@/lib/openai';

export interface TaskItem {
  id: string;
  raw: string;
  assignmentName?: string;
  dueDate?: string;
  dueTime?: string;
  description?: string;
  typeTag?: TaskType;
  bucketCategory?: string;
}

export interface Bucket {
  id: string;
  name: string;
  items: TaskItem[];
}

export type TaskType =
  | 'Homework'
  | 'Quiz'
  | 'Lab'
  | 'Test'
  | 'Project'
  | 'Event'
  | 'Reminder'
  | 'Other';

interface ParsedTask {
  assignmentName?: string;
  dueDate?: string;
  dueTime?: string;
  description?: string;
  courseCategory?: string;
  typeTag?: TaskType;
}

interface AssignmentResult {
  bucketId?: string;
  newBucketName?: string;
  parsedTask?: ParsedTask;
  reason?: string;
}

const DEFAULT_BUCKET_NAMES = ['Events'];

const VALID_TASK_TYPES: TaskType[] = [
  'Homework',
  'Quiz',
  'Lab',
  'Test',
  'Project',
  'Event',
  'Reminder',
  'Other',
];

// Load all buckets and their tasks for a user
export async function loadBuckets(userId: string): Promise<Bucket[]> {
  if (!userId) {
    return [];
  }

  await ensureDefaultBuckets(userId);

  const bucketRows = await db
    .select()
    .from(bucketTable)
    .where(eq(bucketTable.userId, userId))
    .orderBy(bucketTable.createdAt);

  if (bucketRows.length === 0) {
    return [];
  }

  const bucketIds = bucketRows.map((bucket) => bucket.id);
  const taskRows = bucketIds.length
    ? await db
        .select()
        .from(taskTable)
        .where(inArray(taskTable.bucketId, bucketIds))
        .orderBy(taskTable.createdAt)
    : [];

  const tasksByBucket = new Map<string, TaskItem[]>();
  for (const task of taskRows) {
    const list = tasksByBucket.get(task.bucketId) ?? [];
    list.push(formatTaskRecord(task));
    tasksByBucket.set(task.bucketId, list);
  }

  return bucketRows.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    items: tasksByBucket.get(bucket.id) ?? [],
  }));
}

// Main function: analyze task and assign to appropriate bucket
export async function assignTaskToBucket(
  task: string,
  userId: string
): Promise<Bucket[]> {
  const trimmedTask = task.trim();
  if (!trimmedTask || !userId) {
    return loadBuckets(userId);
  }

  ensureOpenAIConfigured();
  await ensureDefaultBuckets(userId);

  const existingBuckets = await loadBuckets(userId);
  const assignment = await analyzeTaskWithAI(trimmedTask, existingBuckets, new Date());

  if (!assignment) {
    return loadBuckets(userId);
  }

  // Find or create the target bucket
  let targetBucket = existingBuckets.find((b) => b.id === assignment.bucketId);

  if (!targetBucket) {
    const bucketName = assignment.newBucketName || assignment.parsedTask?.courseCategory || 'Others';
    
    // Check if bucket with same name already exists (normalized comparison)
    const normalizedName = bucketName.toLowerCase().replace(/\s+/g, '');
    targetBucket = existingBuckets.find(
      (b) => b.name.toLowerCase().replace(/\s+/g, '') === normalizedName
    );

    if (!targetBucket) {
      // Create new bucket
      const bucketId = randomUUID();
      await db.insert(bucketTable).values({
        id: bucketId,
        name: bucketName,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      targetBucket = { id: bucketId, name: bucketName, items: [] };
    }
  }

  // Save task to bucket
  const parsedTask = assignment.parsedTask || {};
  const assignmentName = parsedTask.assignmentName || parsedTask.courseCategory || 'Task';
  const dueDate = composeDueDate(parsedTask.dueDate, parsedTask.dueTime);
  const typeTag =
    parsedTask.typeTag && VALID_TASK_TYPES.includes(parsedTask.typeTag)
      ? parsedTask.typeTag
      : categorizeTaskType(trimmedTask, parsedTask);

  await db.insert(taskTable).values({
    id: randomUUID(),
    bucketId: targetBucket.id,
    raw: trimmedTask,
    assignmentName,
    description: parsedTask.description || trimmedTask,
    dueDate,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return loadBuckets(userId);
}

export async function deleteBucket(
  userId: string,
  bucketId: string
): Promise<Bucket[]> {
  if (!userId || !bucketId) {
    return loadBuckets(userId);
  }

  const bucketRecord = await db
    .select()
    .from(bucketTable)
    .where(and(eq(bucketTable.id, bucketId), eq(bucketTable.userId, userId)))
    .limit(1);

  const bucket = bucketRecord[0];
  if (!bucket) {
    return loadBuckets(userId);
  }

  // Prevent deleting default buckets
  if (DEFAULT_BUCKET_NAMES.some((name) => name.toLowerCase() === bucket.name.toLowerCase())) {
    return loadBuckets(userId);
  }

  await db.delete(bucketTable).where(eq(bucketTable.id, bucketId));
  return loadBuckets(userId);
}

export async function completeTask(
  userId: string,
  taskId: string
): Promise<Bucket[]> {
  if (!userId || !taskId) {
    return loadBuckets(userId);
  }

  const taskRecord = await db
    .select({
      id: taskTable.id,
    })
    .from(taskTable)
    .innerJoin(bucketTable, eq(taskTable.bucketId, bucketTable.id))
    .where(and(eq(taskTable.id, taskId), eq(bucketTable.userId, userId)))
    .limit(1);

  if (!taskRecord[0]) {
    return loadBuckets(userId);
  }

  await db.delete(taskTable).where(eq(taskTable.id, taskId));
  return loadBuckets(userId);
}

export async function createEmptyBucket(
  userId: string,
  bucketName: string
): Promise<Bucket[]> {
  if (!userId || !bucketName?.trim()) {
    return loadBuckets(userId);
  }

  const trimmedName = bucketName.trim();
  const bucketId = randomUUID();
  
  await db.insert(bucketTable).values({
    id: bucketId,
    name: trimmedName,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return loadBuckets(userId);
}

export async function updateBucketName(
  userId: string,
  bucketId: string,
  newName: string
): Promise<Bucket[]> {
  if (!userId || !bucketId || !newName?.trim()) {
    return loadBuckets(userId);
  }

  const bucketRecord = await db
    .select()
    .from(bucketTable)
    .where(and(eq(bucketTable.id, bucketId), eq(bucketTable.userId, userId)))
    .limit(1);

  if (!bucketRecord[0]) {
    return loadBuckets(userId);
  }

  if (DEFAULT_BUCKET_NAMES.some((name) => name.toLowerCase() === bucketRecord[0].name.toLowerCase())) {
    return loadBuckets(userId);
  }

  await db
    .update(bucketTable)
    .set({ name: newName.trim(), updatedAt: new Date() })
    .where(eq(bucketTable.id, bucketId));

  return loadBuckets(userId);
}

export async function getTaskById(
  userId: string,
  taskId: string
): Promise<CalendarTask | null> {
  if (!userId || !taskId) {
    return null;
  }

  const row = await db
    .select({
      id: taskTable.id,
      raw: taskTable.raw,
      assignmentName: taskTable.assignmentName,
      description: taskTable.description,
      dueDate: taskTable.dueDate,
      bucketName: bucketTable.name,
    })
    .from(taskTable)
    .innerJoin(bucketTable, eq(taskTable.bucketId, bucketTable.id))
    .where(and(eq(taskTable.id, taskId), eq(bucketTable.userId, userId)))
    .limit(1);

  if (!row[0]) {
    return null;
  }

  const task = row[0];
  const dueDate = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : undefined;
  const dueTime =
    task.dueDate && (task.dueDate.getUTCHours() !== 0 || task.dueDate.getUTCMinutes() !== 0)
      ? task.dueDate.toISOString().slice(11, 16)
      : undefined;

  return {
    id: task.id,
    bucketName: task.bucketName,
    assignmentName: task.assignmentName ?? undefined,
    raw: task.raw,
    dueDate,
    dueTime,
    description: task.description ?? undefined,
    typeTag: categorizeTaskType(task.raw, {
      assignmentName: task.assignmentName ?? undefined,
      description: task.description ?? undefined,
    }),
  };
}

export async function updateTask(
  userId: string,
  taskId: string,
  updates: {
    assignmentName?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    bucketId?: string;
  }
): Promise<Record<string, CalendarTask[]>> {
  if (!userId || !taskId) {
    return loadCalendarTasks(userId);
  }

  const taskRecord = await db
    .select({
      id: taskTable.id,
    })
    .from(taskTable)
    .innerJoin(bucketTable, eq(taskTable.bucketId, bucketTable.id))
    .where(and(eq(taskTable.id, taskId), eq(bucketTable.userId, userId)))
    .limit(1);

  if (!taskRecord[0]) {
    return loadCalendarTasks(userId);
  }

  const dueDate = updates.dueDate ? composeDueDate(updates.dueDate, updates.dueTime) : undefined;

  await db
    .update(taskTable)
    .set({
      assignmentName: updates.assignmentName,
      description: updates.description,
      dueDate,
      bucketId: updates.bucketId,
      updatedAt: new Date(),
    })
    .where(eq(taskTable.id, taskId));

  return loadCalendarTasks(userId);
}

export async function deleteTaskFromCalendar(
  userId: string,
  taskId: string
): Promise<Record<string, CalendarTask[]>> {
  await completeTask(userId, taskId);
  return loadCalendarTasks(userId);
}

export interface CalendarTask {
  id: string;
  bucketName: string;
  assignmentName?: string;
  raw: string;
  dueDate?: string;
  dueTime?: string;
  description?: string;
  typeTag?: TaskType;
}

export async function loadCalendarTasks(userId: string): Promise<Record<string, CalendarTask[]>> {
  if (!userId) {
    return {};
  }

  const rows = await db
    .select({
      id: taskTable.id,
      raw: taskTable.raw,
      assignmentName: taskTable.assignmentName,
      description: taskTable.description,
      dueDate: taskTable.dueDate,
      bucketName: bucketTable.name,
    })
    .from(taskTable)
    .innerJoin(bucketTable, eq(taskTable.bucketId, bucketTable.id))
    .where(eq(bucketTable.userId, userId))
    .orderBy(taskTable.dueDate, taskTable.createdAt);

  const grouped: Record<string, CalendarTask[]> = {};
  for (const row of rows) {
    const dueDate = row.dueDate ? row.dueDate.toISOString().slice(0, 10) : 'unscheduled';
    const dueTime =
      row.dueDate && (row.dueDate.getUTCHours() !== 0 || row.dueDate.getUTCMinutes() !== 0)
        ? row.dueDate.toISOString().slice(11, 16)
        : undefined;

    const entry: CalendarTask = {
      id: row.id,
      bucketName: row.bucketName,
      assignmentName: row.assignmentName ?? undefined,
      raw: row.raw,
      dueDate,
      dueTime,
      description: row.description ?? undefined,
      typeTag: categorizeTaskType(row.raw, {
        assignmentName: row.assignmentName ?? undefined,
        description: row.description ?? undefined,
      }),
    };

    grouped[dueDate] = [...(grouped[dueDate] ?? []), entry];
  }

  return grouped;
}

async function ensureDefaultBuckets(userId: string) {
  const existing = await db
    .select({ name: bucketTable.name })
    .from(bucketTable)
    .where(and(eq(bucketTable.userId, userId), eq(bucketTable.name, DEFAULT_BUCKET_NAMES[0])))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(bucketTable).values({
      id: randomUUID(),
      name: DEFAULT_BUCKET_NAMES[0],
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

function formatTaskRecord(task: typeof taskTable.$inferSelect): TaskItem {
  const dueDate = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : undefined;
  const dueTime =
    task.dueDate && (task.dueDate.getUTCHours() !== 0 || task.dueDate.getUTCMinutes() !== 0)
      ? task.dueDate.toISOString().slice(11, 16)
      : undefined;

  const typeTag = categorizeTaskType(task.raw, {
    assignmentName: task.assignmentName ?? undefined,
    description: task.description ?? undefined,
  });

  return {
    id: task.id,
    raw: task.raw,
    assignmentName: task.assignmentName ?? undefined,
    dueDate,
    dueTime,
    description: task.description ?? undefined,
    typeTag,
    bucketCategory: undefined,
  };
}

function composeDueDate(dueDate?: string, dueTime?: string): Date | undefined {
  if (!dueDate) {
    return undefined;
  }

  const time = dueTime || '00:00';
  const isoTime = time.length === 5 ? `${time}:00` : time;
  const iso = `${dueDate}T${isoTime}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function categorizeTaskType(task: string, parsedTask?: ParsedTask): TaskType {
  const source = `${task} ${parsedTask?.description ?? ''} ${parsedTask?.assignmentName ?? ''}`.toLowerCase();

  const matchingEntry = [
    { type: 'Homework', patterns: [/homework/, /\bhw\b/, /assignment/] },
    { type: 'Quiz', patterns: [/quiz/] },
    { type: 'Lab', patterns: [/lab\b/, /laboratory/] },
    { type: 'Test', patterns: [/test/, /midterm/, /final exam/, /exam/] },
    { type: 'Project', patterns: [/project/, /presentation/] },
    { type: 'Event', patterns: [/event/, /meeting/, /rehearsal/, /game/, /practice/] },
    { type: 'Reminder', patterns: [/reminder/, /note/, /remember/] },
  ].find((entry) => entry.patterns.some((regex) => regex.test(source)));

  if (matchingEntry) {
    return matchingEntry.type as TaskType;
  }

  return 'Other';
}

// Analyze task with AI to determine bucket and extract details
async function analyzeTaskWithAI(
  task: string,
  buckets: Bucket[],
  currentDate: Date
): Promise<AssignmentResult | undefined> {
  const todayIso = currentDate.toISOString().split('T')[0];

  const bucketSummary =
    buckets.length === 0
      ? 'No buckets yet.'
      : buckets
          .map(
            (bucket) =>
              `- ${bucket.id}: ${bucket.name} (example items: ${bucket.items
                .slice(0, 2)
                .map((item) => `${item.assignmentName || item.raw}${item.dueDate ? ` due ${item.dueDate}` : ''}`)
                .join('; ') || 'none'})`
          )
          .join('\n');

  const prompt = `You are an AI assistant that classifies student tasks into appropriate buckets. 

TASK: "${task}"

EXISTING BUCKETS:
${bucketSummary}

TODAY'S DATE: ${todayIso}

INSTRUCTIONS:
1. Analyze the task to extract: assignment name, course/subject category, type (Homework/Quiz/Lab/Test/Project/Event/Reminder/Other), due date, due time, and description.
2. If the task fits an existing bucket, use its bucketId. If not, suggest a new bucket name (use the course/subject name, e.g., "APUSH", "Calculus", "English", "Computer Science").
3. Convert relative dates to absolute dates (e.g., "in 3 days" → YYYY-MM-DD based on today's date).
4. Extract time if mentioned (e.g., "at 3pm" → "15:00").

EXAMPLES:

Task: "APUSH reading chapter 5 due Monday"
→ {"bucketId": "existing-apush-id" OR "newBucketName": "APUSH", "parsedTask": {"assignmentName": "Chapter 5 Reading", "courseCategory": "APUSH", "typeTag": "Homework", "dueDate": "2024-11-18", "description": "Read chapter 5"}}

Task: "Math quiz on derivatives next Friday"
→ {"newBucketName": "Mathematics", "parsedTask": {"assignmentName": "Derivatives Quiz", "courseCategory": "Mathematics", "typeTag": "Quiz", "dueDate": "2024-11-22", "description": "Quiz covering derivatives"}}

Task: "English essay on Macbeth due December 1st at 11:59pm"
→ {"newBucketName": "English", "parsedTask": {"assignmentName": "Macbeth Essay", "courseCategory": "English", "typeTag": "Homework", "dueDate": "2024-12-01", "dueTime": "23:59", "description": "Essay on Macbeth"}}

Task: "CS101 project submission due in 2 weeks"
→ {"newBucketName": "CS101", "parsedTask": {"assignmentName": "Project Submission", "courseCategory": "CS101", "typeTag": "Project", "dueDate": "2024-11-29", "description": "Submit final project"}}

Task: "Study group meeting tomorrow at 2pm"
→ {"bucketId": "events-bucket-id" OR "newBucketName": "Events", "parsedTask": {"assignmentName": "Study Group Meeting", "typeTag": "Event", "dueDate": "2024-11-16", "dueTime": "14:00", "description": "Study group session"}}

Respond with ONLY valid JSON matching this schema:
{
  "bucketId": "<existing bucket id if task fits>",
  "newBucketName": "<new bucket name if no match>",
  "parsedTask": {
    "assignmentName": "<short title>",
    "courseCategory": "<subject/course name>",
    "typeTag": "<Homework|Quiz|Lab|Test|Project|Event|Reminder|Other>",
    "dueDate": "<YYYY-MM-DD>",
    "dueTime": "<HH:MM>",
    "description": "<brief summary>"
  }
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that responds with JSON only. Always include a parsedTask object.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content ?? '{}';

    try {
      const parsed = JSON.parse(content) as AssignmentResult;
      return parsed;
    } catch (parseError) {
      console.error('Failed to parse classification response', parseError);
      return undefined;
    }
  } catch (error) {
    console.error('Failed to classify task with OpenAI', error);
    return undefined;
  }
}
