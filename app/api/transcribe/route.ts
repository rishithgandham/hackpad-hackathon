import { NextResponse } from 'next/server';

import { ensureOpenAIConfigured, openai } from '@/lib/openai';

export async function POST(request: Request) {
  try {
    ensureOpenAIConfigured();

    const formData = await request.formData();
    const audio = formData.get('audio');

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: 'Missing audio file.' }, { status: 400 });
    }

    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: 'gpt-4o-mini-transcribe',
      temperature: 0,
    });

    return NextResponse.json({ text: transcription.text });
  } catch (error) {
    console.error('Failed to transcribe audio', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio.' },
      { status: 500 }
    );
  }
}


