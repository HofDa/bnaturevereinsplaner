import { Fragment } from 'react';

export type LinkSegment =
  { type: 'text'; value: string } | { type: 'link'; href: string; label: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

function trimUrlCandidate(raw: string) {
  let candidate = raw;
  let trailing = '';
  while (candidate.length > 0) {
    const last = candidate.at(-1)!;
    if ('.,;:!?'.includes(last)) {
      trailing = last + trailing;
      candidate = candidate.slice(0, -1);
      continue;
    }
    if (last === ')' || last === ']') {
      const open = last === ')' ? '(' : '[';
      const opens = candidate.split(open).length - 1;
      const closes = candidate.split(last).length - 1;
      if (closes > opens) {
        trailing = last + trailing;
        candidate = candidate.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return { candidate, trailing };
}

/** Splits plain text into literal text spans and safe http(s) hyperlinks without HTML parsing. */
export function parseLinkSegments(text: string): LinkSegment[] {
  if (!text) return [];
  const segments: LinkSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const prev = segments.at(-1);
    if (prev?.type === 'text') prev.value += value;
    else segments.push({ type: 'text', value });
  };
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    const raw = match[0];
    if (index > cursor) pushText(text.slice(cursor, index));
    const { candidate, trailing } = trimUrlCandidate(raw);
    let parsed: URL | null = null;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') parsed = url;
    } catch {
      parsed = null;
    }
    if (parsed) {
      segments.push({ type: 'link', href: parsed.toString(), label: candidate });
      pushText(trailing);
    } else {
      pushText(raw);
    }
    cursor = index + raw.length;
  }
  if (cursor < text.length) pushText(text.slice(cursor));
  return segments;
}

export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {parseLinkSegments(text).map((segment, index) =>
        segment.type === 'link' ? (
          <a
            key={`${index}-${segment.href}`}
            className="linked-url"
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {segment.label}
          </a>
        ) : (
          <Fragment key={index}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}
