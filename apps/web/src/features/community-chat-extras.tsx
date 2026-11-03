import { useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChartColumn, CornerUpLeft, X } from 'lucide-react';
import type {
  ChatAttachment,
  ChatMember,
  ChatMessage,
  CommunityPost,
  Page,
} from '@bnature/contracts';
import { api } from '../lib/api';
import { useSession } from '../app/session';
import { Button, Modal, Empty, Loading } from '../components/ui';

const lang = (language: string) => (language.startsWith('it') ? 'it' : 'de');

export function useChatMembers(groupId: string | null) {
  const { me } = useSession();
  return useQuery({
    queryKey: ['community', 'chat-members', me.activeOrganizationId, groupId],
    queryFn: () =>
      api<{ items: ChatMember[] }>(
        `/community/chat/members${groupId ? `?groupId=${groupId}` : ''}`,
      ),
    staleTime: 60_000,
  });
}

/** Quoted original above a reply; jumps to it when it is on the current page. */
export function ReplyQuote({ reply }: { reply: NonNullable<ChatMessage['replyTo']> }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="chat-quote"
      onClick={() =>
        document.getElementById(`msg-${reply.id}`)?.scrollIntoView({ block: 'center' })
      }
    >
      <CornerUpLeft size={13} aria-hidden="true" />
      <strong>{reply.authorName}</strong>
      <span>{reply.removed ? t('commChatRemoved') : reply.excerpt}</span>
    </button>
  );
}

export function AttachmentCard({ attachment }: { attachment: ChatAttachment }) {
  const { t, i18n } = useTranslation();
  const Icon = attachment.kind === 'event' ? CalendarDays : ChartColumn;
  if (!attachment.available)
    return (
      <div className="chat-card unavailable">
        <Icon size={18} aria-hidden="true" />
        <span>{t('commCardUnavailable')}</span>
      </div>
    );
  const to =
    attachment.kind === 'event' ? `/events/${attachment.id}` : `/community/${attachment.id}`;
  return (
    <div className="chat-card">
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>{attachment.title?.[lang(i18n.language)]}</strong>
        <small>
          {attachment.kind === 'event'
            ? [
                attachment.startAt &&
                  new Date(attachment.startAt).toLocaleString(i18n.language, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                attachment.location,
              ]
                .filter(Boolean)
                .join(' · ')
            : t(attachment.closed ? 'commClosed' : 'commOpen')}
        </small>
      </div>
      {!attachment.closed && (
        <Link className="button button-secondary" to={to}>
          {t(attachment.kind === 'event' ? 'commCardRegister' : 'commCardVote')}
        </Link>
      )}
      {attachment.closed && (
        <Link className="button button-ghost" to={to}>
          {t('commCardOpen')}
        </Link>
      )}
    </div>
  );
}

/**
 * @-autocomplete for the composer: finds `@query` right before the caret and suggests channel
 * members. Picked names are tracked so the message carries their account IDs.
 */
export function useMentions(
  input: RefObject<HTMLTextAreaElement | null>,
  text: string,
  setText: (value: string) => void,
  members: ChatMember[],
) {
  const [picked, setPicked] = useState<ChatMember[]>([]);
  const [active, setActive] = useState(0);
  const [caret, setCaret] = useState(0);
  const match = /(^|\s)@([\p{L}\p{N} ._-]{0,30})$/u.exec(text.slice(0, caret));
  const queryText = match?.[2]?.toLowerCase() ?? null;
  const suggestions = useMemo(
    () =>
      queryText === null
        ? []
        : members.filter((m) => m.name.toLowerCase().startsWith(queryText.trimStart())).slice(0, 6),
    [members, queryText],
  );
  function choose(member: ChatMember) {
    if (!match) return;
    const start = caret - match[2]!.length - 1;
    const next = `${text.slice(0, start)}@${member.name} ${text.slice(caret)}`;
    setText(next.slice(0, 2000));
    setPicked((p) => (p.some((x) => x.userId === member.userId) ? p : [...p, member]));
    const position = start + member.name.length + 2;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!suggestions.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(
        (i) => (i + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length,
      );
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(suggestions[Math.min(active, suggestions.length - 1)]!);
      return true;
    }
    if (event.key === 'Escape') {
      setCaret(-1);
      return true;
    }
    return false;
  }
  return {
    suggestions,
    active,
    choose,
    onKeyDown,
    track: () => setCaret(input.current?.selectionStart ?? text.length),
    // Only names still present in the text count as mentions.
    mentionIds: () => picked.filter((m) => text.includes(`@${m.name}`)).map((m) => m.userId),
    reset: () => setPicked([]),
  };
}

export function MentionList({
  id,
  mentions,
}: {
  id: string;
  mentions: ReturnType<typeof useMentions>;
}) {
  const { t } = useTranslation();
  if (!mentions.suggestions.length) return null;
  return (
    <ul className="mention-list" id={id} role="listbox" aria-label={t('commMentionPick')}>
      {mentions.suggestions.map((member, i) => (
        <li
          key={member.userId}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === mentions.active}
          onMouseDown={(event) => {
            event.preventDefault();
            mentions.choose(member);
          }}
        >
          @{member.name}
        </li>
      ))}
    </ul>
  );
}

/** Picks an upcoming event or an open poll of this channel to share as a card. */
export function SharePicker({
  groupId,
  onPick,
  onCreatePoll,
  onClose,
}: {
  groupId: string | null;
  onPick: (attachment: { kind: 'event' | 'poll'; id: string; title: string }) => void;
  onCreatePoll?: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const headingId = useId();
  const canEvents = me.permissions.includes('events:read');
  const events = useQuery({
    queryKey: ['community', 'share-events', me.activeOrganizationId],
    queryFn: () =>
      api<
        Page<{
          id: string;
          titleI18n: { de: string; it: string };
          startAt: string;
          status: string;
          visibility: string;
        }>
      >(
        `/events?${new URLSearchParams({ from: new Date().toISOString(), status: 'published', pageSize: '20' })}`,
      ),
    enabled: canEvents,
  });
  const polls = useQuery({
    queryKey: ['community', 'share-polls', me.activeOrganizationId],
    queryFn: () => api<Page<CommunityPost>>('/community/posts?kind=poll&state=published&page=1'),
  });
  const shareable = (polls.data?.items ?? []).filter(
    (p) => !p.isClosed && (p.groupId === null || p.groupId === groupId),
  );
  const upcoming = (events.data?.items ?? []).filter((e) => e.visibility !== 'internal');
  return (
    <Modal title={t('commShareTitle')} onClose={onClose}>
      <section aria-labelledby={`${headingId}-polls`} className="share-section">
        <h3 id={`${headingId}-polls`}>{t('commPolls')}</h3>
        {polls.isPending ? (
          <Loading />
        ) : shareable.length ? (
          <ul className="share-list">
            {shareable.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() =>
                    onPick({ kind: 'poll', id: p.id, title: p.titleI18n[lang(i18n.language)] })
                  }
                >
                  <ChartColumn size={16} aria-hidden="true" />
                  {p.titleI18n[lang(i18n.language)]}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty description={t('commShareNoPolls')} />
        )}
        {onCreatePoll && (
          <Button variant="secondary" onClick={onCreatePoll}>
            {t('commCreatePoll')}
          </Button>
        )}
      </section>
      {canEvents && (
        <section aria-labelledby={`${headingId}-events`} className="share-section">
          <h3 id={`${headingId}-events`}>{t('commShareEvents')}</h3>
          {events.isPending ? (
            <Loading />
          ) : upcoming.length ? (
            <ul className="share-list">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onPick({ kind: 'event', id: e.id, title: e.titleI18n[lang(i18n.language)] })
                    }
                  >
                    <CalendarDays size={16} aria-hidden="true" />
                    <span>
                      {e.titleI18n[lang(i18n.language)]}
                      <small>
                        {new Date(e.startAt).toLocaleString(i18n.language, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty description={t('commShareNoEvents')} />
          )}
        </section>
      )}
    </Modal>
  );
}

export function ComposeBanner({
  icon,
  label,
  text,
  onClear,
}: {
  icon: 'reply' | 'event' | 'poll';
  label: string;
  text: string;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const Icon = icon === 'reply' ? CornerUpLeft : icon === 'event' ? CalendarDays : ChartColumn;
  return (
    <div className="compose-banner">
      <Icon size={15} aria-hidden="true" />
      <span>
        <strong>{label}</strong> {text}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={`${t('cancel')}: ${label}`}
        onClick={onClear}
      >
        <X size={15} />
      </button>
    </div>
  );
}
