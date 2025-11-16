'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { Navbar } from '@/components/navbar';
import {
  loadCalendarTasks,
  CalendarTask,
  deleteTaskFromCalendar,
  updateTask,
  getTaskById,
  loadBuckets,
  type Bucket,
} from '@/lib/actions/bucket';
import { useSession } from '@/lib/auth-client';
import { Loader2, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function CalendarPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = useSession();
  const [tasksByDate, setTasksByDate] = useState<Record<string, CalendarTask[]>>({});
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [editingTask, setEditingTask] = useState<CalendarTask | null>(null);

  useEffect(() => {
    if (!isSessionPending && !session) {
      router.push('/signin');
    }
  }, [isSessionPending, session, router]);

  useEffect(() => {
    if (isSessionPending || !session) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const [grouped, bucketList] = await Promise.all([
          loadCalendarTasks(session.user.id),
          loadBuckets(session.user.id),
        ]);
        if (!cancelled) {
          setTasksByDate(grouped);
          setBuckets(bucketList);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError('Unable to load calendar tasks right now.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSessionPending, session]);

  const handleDeleteTask = async (taskId: string) => {
    if (!session) return;
    try {
      const updated = await deleteTaskFromCalendar(session.user.id, taskId);
      setTasksByDate(updated);
    } catch (err) {
      console.error(err);
      setError('Failed to delete task.');
    }
  };

  const handleUpdateTask = async (updates: {
    assignmentName?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    bucketId?: string;
  }) => {
    if (!session || !editingTask) return;
    try {
      const updated = await updateTask(session.user.id, editingTask.id, updates);
      setTasksByDate(updated);
      setEditingTask(null);
    } catch (err) {
      console.error(err);
      setError('Failed to update task.');
    }
  };

  if (isSessionPending || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const calendarWeeks = useMemo(
    () => buildCalendarWeeks(tasksByDate, visibleMonth.year, visibleMonth.month),
    [tasksByDate, visibleMonth]
  );

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-foreground">Calendar View</h1>
            <p className="text-muted-foreground">All items grouped by due date</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setVisibleMonth((prev) => {
                  const month = prev.month === 0 ? 11 : prev.month - 1;
                  const year = prev.month === 0 ? prev.year - 1 : prev.year;
                  return { year, month };
                })
              }
              className="rounded-md border border-border px-3 py-1 text-sm font-medium text-foreground hover:border-primary hover:text-primary"
            >
              Previous
            </button>
            <div className="min-w-[180px] text-center text-lg font-semibold text-foreground">
              {new Date(visibleMonth.year, visibleMonth.month).toLocaleDateString(undefined, {
                month: 'long',
                year: 'numeric',
              })}
            </div>
            <button
              type="button"
              onClick={() =>
                setVisibleMonth((prev) => {
                  const month = prev.month === 11 ? 0 : prev.month + 1;
                  const year = prev.month === 11 ? prev.year + 1 : prev.year;
                  return { year, month };
                })
              }
              className="rounded-md border border-border px-3 py-1 text-sm font-medium text-foreground hover:border-primary hover:text-primary"
            >
              Next
            </button>
            <Link
              href="/dashboard"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>

        {error && <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tasks…
          </div>
        ) : calendarWeeks.length === 0 ? (
          <EmptyCalendarState />
        ) : (
          <CalendarGrid
            weeks={calendarWeeks}
            visibleMonth={visibleMonth}
            onTaskClick={(task) => setEditingTask(task)}
            onTaskDelete={handleDeleteTask}
          />
        )}

        {/* Edit Task Modal */}
        {editingTask && (
          <EditTaskModal
            task={editingTask}
            buckets={buckets}
            onUpdate={handleUpdateTask}
            onClose={() => setEditingTask(null)}
          />
        )}
      </div>
    </main>
  );
}

function formatDateLabel(dateKey: string): string {
  // parse YYYY-MM-DD safely into a local Date
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return dateKey;
  }
  const [y, m, d] = parts;
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) {
    return dateKey;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function EmptyCalendarState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/60 p-10 text-center shadow-inner">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="text-2xl">📅</span>
      </div>
      <h3 className="text-xl font-semibold text-foreground">No tasks scheduled yet</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Add tasks from your dashboard and they&apos;ll appear here by due date.
      </p>
    </div>
  );
}

type DayCell = { date: string; tasks: CalendarTask[] };
type Week = DayCell[];

function buildCalendarWeeks(
  tasksByDate: Record<string, CalendarTask[]>,
  year: number,
  month: number
): Week[] {
  const firstDay = new Date(year, month, 1);
  const startOfCalendar = new Date(firstDay);
  startOfCalendar.setDate(firstDay.getDate() - firstDay.getDay());

  const weeks: Week[] = [];
  let current = new Date(startOfCalendar);

  for (let week = 0; week < 6; week++) {
    const days: DayCell[] = [];

    for (let day = 0; day < 7; day++) {
      const isoDate = current.toLocaleDateString('en-CA'); // YYYY-MM-DD guaranteed and local

      days.push({
        date: isoDate,
        tasks: tasksByDate[isoDate] ?? [],
      });
      current.setDate(current.getDate() + 1);
    }

    weeks.push(days);
  }

  return weeks;
}

function CalendarGrid({
  weeks,
  visibleMonth,
  onTaskClick,
  onTaskDelete,
}: {
  weeks: Week[];
  visibleMonth: { year: number; month: number };
  onTaskClick: (task: CalendarTask) => void;
  onTaskDelete: (taskId: string) => void;
}) {
  const todayIso = new Date().toLocaleDateString('en-CA');

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="grid grid-cols-7 border-b border-border bg-muted/50 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
          <div key={label} className="p-3">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {weeks.map((week, idx) => (
          <Fragment key={idx}>
            {week.map(({ date, tasks }) => {
              // date is "YYYY-MM-DD"
              const isToday = date === todayIso;

              // parse year, month, day safely (local)
              const [yStr, mStr, dStr] = date.split('-');
              const y = Number(yStr);
              const m = Number(mStr); // 1-12
              const d = Number(dStr);

              // displayDate is the day number (d)
              const displayDate = d;

              // determine whether the cell belongs to the currently visible month
              const isCurrentMonth = (m - 1) === visibleMonth.month && y === visibleMonth.year;

              return (
                <div
                  key={date}
                  className={`min-h-[140px] bg-card p-3 ${
                    isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/60'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
                        isToday ? 'bg-primary text-primary-foreground' : ''
                      }`}
                    >
                      {displayDate}
                    </span>
                    {tasks.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {tasks.length} task{tasks.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {tasks.slice(0, 3).map((task) => (
                      <div
                        key={task.id}
                        className="group relative rounded-md border border-border/80 bg-background/70 p-2 hover:border-primary"
                      >
                        <button
                          type="button"
                          onClick={() => onTaskClick(task)}
                          className="w-full text-left"
                        >
                          <p className="text-xs font-semibold">{task.assignmentName || task.raw}</p>
                          {task.dueTime && (
                            <p className="text-[11px] text-muted-foreground">Time: {task.dueTime}</p>
                          )}
                          {task.typeTag && (
                            <p className="text-[11px] uppercase tracking-wide text-primary">{task.typeTag}</p>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onTaskDelete(task.id);
                          }}
                          className="absolute right-1 top-1 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </button>
                      </div>
                    ))}
                    {tasks.length > 3 && (
                      <p className="text-[11px] text-muted-foreground">+{tasks.length - 3} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function EditTaskModal({
  task,
  buckets,
  onUpdate,
  onClose,
}: {
  task: CalendarTask;
  buckets: Bucket[];
  onUpdate: (updates: {
    assignmentName?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    bucketId?: string;
  }) => void;
  onClose: () => void;
}) {
  const [assignmentName, setAssignmentName] = useState(task.assignmentName || '');
  const [description, setDescription] = useState(task.description || '');
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [dueTime, setDueTime] = useState(task.dueTime || '');
  const [bucketId, setBucketId] = useState(
    buckets.find((b) => b.name === task.bucketName)?.id || ''
  );

  const handleSave = () => {
    onUpdate({
      assignmentName: assignmentName.trim() || undefined,
      description: description.trim() || undefined,
      dueDate: dueDate || undefined,
      dueTime: dueTime || undefined,
      bucketId: bucketId || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Edit Task</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label htmlFor="task-assignment" className="mb-2 block text-sm font-medium text-foreground">
              Assignment Name
            </label>
            <input
              id="task-assignment"
              type="text"
              value={assignmentName}
              onChange={(e) => setAssignmentName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              placeholder="Enter assignment name..."
            />
          </div>
          <div>
            <label htmlFor="task-description" className="mb-2 block text-sm font-medium text-foreground">
              Description
            </label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              placeholder="Enter description..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="task-due-date" className="mb-2 block text-sm font-medium text-foreground">
                Due Date
              </label>
              <input
                id="task-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="task-due-time" className="mb-2 block text-sm font-medium text-foreground">
                Due Time
              </label>
              <input
                id="task-due-time"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label htmlFor="task-bucket" className="mb-2 block text-sm font-medium text-foreground">
              Bucket
            </label>
            <select
              id="task-bucket"
              value={bucketId}
              onChange={(e) => setBucketId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">Select a bucket</option>
              {buckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>
                  {bucket.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
