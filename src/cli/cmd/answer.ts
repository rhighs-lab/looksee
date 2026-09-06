import type { RunCtx } from '@/cli/commands.js';
import { connect } from '@/cli/connect.js';
import { format } from '@/cli/output.js';
import type { Answer } from '@/shared/protocol.js';

const ANCHOR = /^(.+?):(\d+)(?:-(\d+))?$/;

interface HitInput {
  path: string;
  startLine: number;
  endLine: number;
  why?: string;
  symbol?: string;
  role?: string;
  group?: string;
}

const parseAnchor = (spec: string): HitInput => {
  const m = ANCHOR.exec(spec);
  if (!m)
    throw new Error(`bad --hit "${spec}": expected <file>:<line>[-<line>]`);
  const start = Number(m[2]);
  return {
    path: m[1] as string,
    startLine: start,
    endLine: m[3] ? Number(m[3]) : start,
  };
};

export const runAnswer = async ({
  positionals,
  flags,
  repeated,
  io,
}: RunCtx): Promise<number> => {
  const anchors = repeated['hit'] ?? [];
  let payload: Record<string, unknown>;

  if (anchors.length) {
    const question =
      positionals[0] ?? (flags['question'] as string | undefined);
    if (!question) throw new Error('answer needs a question');
    const whys = repeated['why'] ?? [];
    payload = {
      question,
      summary: (flags['summary'] as string | undefined) ?? '',
      hits: anchors.map((a, i) => ({
        ...parseAnchor(a),
        why: whys[i] ?? null,
      })),
    };
  } else {
    const raw = (await io.stdin()).trim();
    if (!raw)
      throw new Error(
        'answer needs --hit flags or a JSON body on stdin: { question, summary, hits: [{ path, startLine, endLine, why }] }'
      );
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('answer: stdin is not valid JSON');
    }
    if (positionals[0]) payload['question'] = positionals[0];
  }

  const { http, url } = await connect(flags, io.env);
  const { answer } = await http.post<{ answer: Answer }>(
    '/api/answers',
    payload
  );
  io.out(
    format(
      { ...answer, url: `${url}/answer/${answer.id}` },
      Boolean(flags['pretty'])
    )
  );
  return 0;
};
