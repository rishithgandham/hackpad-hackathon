'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Navbar } from '@/components/navbar';
import type { Bucket, TaskItem } from '@/lib/actions/bucket';
import {
  assignTaskToBucket,
  loadBuckets as loadBucketsAction,
  deleteBucket as deleteBucketAction,
  completeTask as completeTaskAction,
  updateTask,
  getTaskById,
  createEmptyBucket,
  updateBucketName,
} from '@/lib/actions/bucket';
import { useSession } from '@/lib/auth-client';
import { CheckCircle2, Loader2, Trash2, Mic, MicOff, Edit2, X, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';



export default function Dashboard() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = useSession();
  const protectedBucketNames = useMemo(() => new Set(['events']), []);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [isRecording, setIsRecording] = useState(false);
  const [supportsSpeech, setSupportsSpeech] = useState(false);
  const [speechLoading, setSpeechLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [showCreateBucket, setShowCreateBucket] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [editingBucket, setEditingBucket] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!isSessionPending && !session) {
      router.push('/signin');
    }
  }, [isSessionPending, session, router]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hasMediaRecorder = typeof window.MediaRecorder !== 'undefined';
      const hasGetUserMedia = !!navigator.mediaDevices?.getUserMedia;
      setSupportsSpeech(hasMediaRecorder && hasGetUserMedia);
    }

    if (isSessionPending || !session) {
      return () => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        activeStreamRef.current?.getTracks().forEach((track) => track.stop());
      };
    }

    let cancelled = false;
    setIsBootstrapping(true);

    (async () => {
      try {
        const initialBuckets = await loadBucketsAction(session.user.id);
        if (!cancelled) {
          setBuckets(initialBuckets);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError('Unable to load your buckets. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      activeStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [isSessionPending, session]);

  const startRecording = async () => {
    if (!supportsSpeech) {
      setError('Speech recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        setIsRecording(false);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        activeStreamRef.current?.getTracks().forEach((track) => track.stop());
        activeStreamRef.current = null;

        if (audioBlob.size === 0) {
          return;
        }

        setSpeechLoading(true);
        try {
          const formData = new FormData();
          formData.append('audio', audioBlob, 'task.webm');
          const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });
          if (!response.ok) {
            throw new Error('Transcription failed');
          }
          const data = (await response.json()) as { text?: string };
          const transcript = data.text?.trim();
          if (transcript) {
            const updatedBuckets = await assignTaskToBucket(transcript, session?.user.id ?? '');
            setBuckets(updatedBuckets);
          }
        } catch (err) {
          console.error(err);
          setError('Unable to transcribe the spoken task.');
        } finally {
          setSpeechLoading(false);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Unable to access microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const toggleSpeech = () => {
    if (!supportsSpeech) {
      setError('Speech recording is not supported in this browser.');
      return;
    }

    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  if (isSessionPending || !session) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const handleDeleteBucket = async (bucketId: string, bucketName: string) => {
    if (protectedBucketNames.has(bucketName.toLowerCase())) {
      return;
    }

    try {
      const updated = await deleteBucketAction(session.user.id, bucketId);
      setBuckets(updated);
    } catch (err) {
      console.error(err);
      setError('Unable to delete that bucket right now.');
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      const updated = await completeTaskAction(session.user.id, taskId);
      setBuckets(updated);
    } catch (err) {
      console.error(err);
      setError('Unable to complete that task right now.');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const updated = await completeTaskAction(session.user.id, taskId);
      setBuckets(updated);
    } catch (err) {
      console.error(err);
      setError('Unable to delete that task right now.');
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
      await updateTask(session.user.id, editingTask.id, updates);
      const updatedBuckets = await loadBucketsAction(session.user.id);
      setBuckets(updatedBuckets);
      setEditingTask(null);
    } catch (err) {
      console.error(err);
      setError('Failed to update task.');
    }
  };

  const handleEditTask = async (task: TaskItem) => {
    if (!session) return;
    try {
      const fullTask = await getTaskById(session.user.id, task.id);
      if (fullTask) {
        const taskItem: TaskItem = {
          id: fullTask.id,
          raw: fullTask.raw,
          assignmentName: fullTask.assignmentName,
          description: fullTask.description,
          dueDate: fullTask.dueDate,
          dueTime: fullTask.dueTime,
          typeTag: fullTask.typeTag,
          bucketCategory: fullTask.bucketName,
        };
        setEditingTask(taskItem);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load task details.');
    }
  };

  const handleCreateBucket = async () => {
    if (!session || !newBucketName.trim()) return;
    try {
      const updated = await createEmptyBucket(session.user.id, newBucketName.trim());
      setBuckets(updated);
      setNewBucketName('');
      setShowCreateBucket(false);
    } catch (err) {
      console.error(err);
      setError('Failed to create bucket.');
    }
  };

  const handleUpdateBucket = async (newName: string) => {
    if (!session || !editingBucket) return;
    try {
      const updated = await updateBucketName(session.user.id, editingBucket.id, newName.trim());
      setBuckets(updated);
      setEditingBucket(null);
    } catch (err) {
      console.error(err);
      setError('Failed to update bucket.');
    }
  };

  const handleAddTask = () => {
    if (!input.trim()) {
      setError('Please enter a task first.');
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const updatedBuckets = await assignTaskToBucket(input, session.user.id);
        setBuckets(updatedBuckets);
        setInput('');
      } catch (err) {
        console.error(err);
        setError('Something went wrong while organizing your task.');
      }
    });
  };

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-2">AI Planner</h1>
          <p className="text-muted-foreground">Enter any event or task and let AI organize them</p>
        </div>

        {/* Large Textbox */}
        <div className="mb-12">
          <Textarea
            placeholder="Enter your task, assignment, or important date here... (e.g., 'CS101 assignment due Friday' or 'Math exam next week')"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full h-32 p-4 text-base bg-card border-2 border-border rounded-lg focus:border-primary focus:outline-none resize-none"
          />
          {supportsSpeech && (
            <button
              type="button"
              onClick={toggleSpeech}
              className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition ${
                isRecording
                  ? 'border-destructive text-destructive'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              disabled={speechLoading}
            >
              {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {speechLoading
                ? 'Transcribing...'
                : isRecording
                ? 'Listening… tap to stop'
                : 'Speak task'}
            </button>
          )}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          <button
            type="button"
            onClick={handleAddTask}
            disabled={isPending}
            className="mt-4 mx-3 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 font-medium disabled:opacity-60"
          >
            {isPending ? 'Organizing...' : 'Add to Organizer'}
          </button>
        </div>

        {/* Buckets */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-foreground">Your Buckets</h2>
            <button
              type="button"
              onClick={() => setShowCreateBucket(true)}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary"
            >
              <Plus className="h-4 w-4" />
              Create Empty Bucket
            </button>
          </div>
          {isBootstrapping ? (
            <p className="text-muted-foreground">Loading your buckets…</p>
          ) : buckets.length === 0 ? (
            <EmptyBucketsState />
          ) : (
            <div className="grid gap-6">
              {buckets.map((bucket) => (
                <div key={bucket.id} className="border border-border rounded-lg bg-card p-6 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-foreground">{bucket.name}</h3>
                    {!protectedBucketNames.has(bucket.name.toLowerCase()) && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingBucket({ id: bucket.id, name: bucket.name })}
                          className="rounded-full border border-border p-1 text-muted-foreground transition hover:text-primary hover:border-primary"
                          aria-label={`Edit ${bucket.name} bucket`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBucket(bucket.id, bucket.name)}
                          className="rounded-full border border-border p-1 text-muted-foreground transition hover:text-destructive hover:border-destructive"
                          aria-label={`Delete ${bucket.name} bucket`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  {bucket.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing here yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {bucket.items.map((item) => (
                        <TaskCard
                          key={item.id}
                          item={item}
                          onComplete={handleCompleteTask}
                          onEdit={handleEditTask}
                          onDelete={handleDeleteTask}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Task Modal */}
      {editingTask && (
        <EditTaskModal
          task={editingTask}
          buckets={buckets}
          onUpdate={handleUpdateTask}
          onClose={() => setEditingTask(null)}
        />
      )}

      {/* Create Bucket Modal */}
      {showCreateBucket && (
        <CreateBucketModal
          bucketName={newBucketName}
          onBucketNameChange={setNewBucketName}
          onCreate={handleCreateBucket}
          onClose={() => {
            setShowCreateBucket(false);
            setNewBucketName('');
          }}
        />
      )}

      {/* Edit Bucket Modal */}
      {editingBucket && (
        <EditBucketModal
          bucketName={editingBucket.name}
          onBucketNameChange={(name) => setEditingBucket({ ...editingBucket, name })}
          onSave={() => handleUpdateBucket(editingBucket.name)}
          onClose={() => setEditingBucket(null)}
        />
      )}
    </main>
  );
}

type PriorityLevel = 'high' | 'medium' | 'low';

interface PriorityStyles {
  level: PriorityLevel;
  card: string;
  badge: string;
  label: string;
}

function TaskCard({
  item,
  onComplete,
  onEdit,
  onDelete,
}: {
  item: TaskItem;
  onComplete: (taskId: string) => void;
  onEdit: (task: TaskItem) => void;
  onDelete: (taskId: string) => void;
}) {
  const priority = getTaskPriority(item);

  return (
    <li
      className={`group rounded-lg border p-4 shadow-sm transition ${priority.card}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="font-semibold text-foreground">{item.assignmentName || item.raw}</p>
          <div className="mt-1 space-y-1 text-sm text-muted-foreground">
            {(item.dueDate || item.dueTime) && (
              <p>
                Due {item.dueDate ?? 'TBD'}
                {item.dueTime ? ` at ${item.dueTime}` : ''}
              </p>
            )}
            {item.description && <p>{item.description}</p>}
            {!item.assignmentName && !item.description && <p>{item.raw}</p>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {item.typeTag && (
            <span className="rounded-full bg-secondary px-2 py-1 text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
              {item.typeTag}
            </span>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onEdit(item)}
              className="rounded-full border border-border p-1 text-muted-foreground opacity-0 transition hover:border-primary hover:text-primary hover:bg-muted group-hover:opacity-100"
              aria-label="Edit task"
            >
              <Edit2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="rounded-full border border-border p-1 text-muted-foreground opacity-0 transition hover:border-destructive hover:text-destructive hover:bg-destructive/10 group-hover:opacity-100"
              aria-label="Delete task"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onComplete(item.id)}
              className="rounded-full border border-border p-1 text-emerald-600 transition hover:border-emerald-600 hover:bg-emerald-50"
              aria-label="Mark task complete"
            >
              <CheckCircle2 className="h-4 w-4" />
            </button>
            <span className={`text-xs font-semibold uppercase tracking-wide rounded-full px-2 py-1 ${priority.badge}`}>
              {priority.label}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

function getTaskPriority(item: TaskItem): PriorityStyles {
  const styles: Record<PriorityLevel, Omit<PriorityStyles, 'level' | 'label'> & { label: string }> = {
    high: {
      card: 'border-destructive/60 bg-destructive/10 hover:border-destructive/80 hover:shadow-md',
      badge: 'bg-destructive/90 text-destructive-foreground',
      label: 'High',
    },
    medium: {
      card: 'border-amber-500/50 bg-amber-500/10 hover:border-amber-500/70 hover:shadow-md',
      badge: 'bg-amber-500 text-amber-950',
      label: 'Medium',
    },
    low: {
      card: 'border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/70 hover:shadow-md',
      badge: 'bg-emerald-500 text-emerald-950',
      label: 'Low',
    },
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let level: PriorityLevel = 'low';

  if (item.dueDate) {
    const due = new Date(item.dueDate);
    if (!Number.isNaN(due.getTime())) {
      due.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        level = 'high';
      } else if (diffDays <= 4) {
        level = 'medium';
      } else {
        level = 'low';
      }

      if (diffDays < 0) {
        level = 'high';
      }
    }
  } else {
    const context = `${item.assignmentName ?? ''} ${item.description ?? ''} ${item.raw}`.toLowerCase();
    const urgentKeywords = ['urgent', 'asap', 'today', 'tonight', 'immediately'];
    const mediumKeywords = ['exam', 'test', 'midterm', 'assignment', 'project', 'meeting'];

    if (urgentKeywords.some((keyword) => context.includes(keyword))) {
      level = 'high';
    } else if (mediumKeywords.some((keyword) => context.includes(keyword))) {
      level = 'medium';
    }
  }

  const choice = styles[level];
  return {
    level,
    card: choice.card,
    badge: choice.badge,
    label: choice.label,
  };
}

function EmptyBucketsState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-8 py-16 text-center shadow-inner">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="text-2xl">📂</span>
      </div>
      <h3 className="text-xl font-semibold text-foreground">No buckets yet</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Add your first task above and we&apos;ll automatically create the right bucket for it.
      </p>
      <div className="mt-6 rounded-full bg-muted px-4 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Waiting for your next assignment
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
  task: TaskItem;
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
  const [bucketId, setBucketId] = useState(() => {
    if (task.bucketCategory) {
      const bucket = buckets.find((b) => b.name === task.bucketCategory);
      return bucket?.id || '';
    }
    return '';
  });

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

function CreateBucketModal({
  bucketName,
  onBucketNameChange,
  onCreate,
  onClose,
}: {
  bucketName: string;
  onBucketNameChange: (name: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Create New Bucket</h2>
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
            <label htmlFor="bucket-name" className="mb-2 block text-sm font-medium text-foreground">
              Bucket Name
            </label>
            <input
              id="bucket-name"
              type="text"
              value={bucketName}
              onChange={(e) => onBucketNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && bucketName.trim()) {
                  onCreate();
                }
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              placeholder="Enter bucket name..."
              autoFocus
            />
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
              onClick={onCreate}
              disabled={!bucketName.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditBucketModal({
  bucketName,
  onBucketNameChange,
  onSave,
  onClose,
}: {
  bucketName: string;
  onBucketNameChange: (name: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Edit Bucket</h2>
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
            <label htmlFor="edit-bucket-name" className="mb-2 block text-sm font-medium text-foreground">
              Bucket Name
            </label>
            <input
              id="edit-bucket-name"
              type="text"
              value={bucketName}
              onChange={(e) => onBucketNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && bucketName.trim()) {
                  onSave();
                }
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              placeholder="Enter bucket name..."
              autoFocus
            />
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
              onClick={onSave}
              disabled={!bucketName.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
