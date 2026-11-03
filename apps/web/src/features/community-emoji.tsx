import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Smile, SmilePlus } from 'lucide-react';
import { chatReactionEmojis, type ChatMessage, type ChatReactionEmoji } from '@bnature/contracts';

const pickerGroups = [
  {
    label: 'commEmojiFaces',
    emojis: [
      '😀',
      '😄',
      '😁',
      '😂',
      '🙂',
      '😉',
      '😊',
      '😍',
      '🥰',
      '😎',
      '🤩',
      '🥳',
      '🤔',
      '😮',
      '😅',
      '😢',
      '😭',
      '😴',
      '🤗',
      '🙃',
    ],
  },
  {
    label: 'commEmojiGestures',
    emojis: ['👍', '👎', '👏', '🙌', '🙏', '💪', '👋', '🤝', '✌️', '👌'],
  },
  {
    label: 'commEmojiSymbols',
    emojis: ['❤️', '🧡', '💚', '💙', '💜', '🔥', '⭐', '✨', '🎉', '🎊', '✅', '❌', '❓', '⚠️'],
  },
  {
    label: 'commEmojiNature',
    emojis: [
      '🌲',
      '🌳',
      '🌿',
      '🍀',
      '🌸',
      '🌻',
      '🌞',
      '🌧️',
      '❄️',
      '🐦',
      '🦋',
      '🐝',
      '🐞',
      '🦊',
      '🥾',
      '🏕️',
      '⛰️',
      '🚲',
      '📍',
      '📸',
      '☕',
      '🍰',
    ],
  },
] as const;

/** Closes a popover on Escape (returning focus to its trigger) or on a click outside it. */
function useDismiss(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLButtonElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      trigger.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close, root, trigger]);
}

export function EmojiPicker({
  target,
  value,
  maxLength,
  disabled,
  onChange,
}: {
  target: RefObject<HTMLTextAreaElement | null>;
  value: string;
  maxLength: number;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root, trigger);
  useEffect(() => {
    if (open) panel.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  function insert(emoji: string) {
    if (value.length + emoji.length > maxLength) return;
    const field = target.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + emoji + value.slice(end));
    requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      field.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }
  return (
    <div className="emoji-popover-root" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="button button-ghost emoji-trigger"
        aria-label={t('commEmojiInsert')}
        title={t('commEmojiInsert')}
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Smile size={18} />
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className="emoji-popover emoji-picker"
          role="group"
          aria-label={t('commEmojiInsert')}
        >
          {pickerGroups.map((group) => (
            <section key={group.label} aria-label={t(group.label)}>
              <h3>{t(group.label)}</h3>
              <div className="emoji-grid">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="emoji-option"
                    onClick={() => insert(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatReactions({
  message,
  disabled,
  onReact,
}: {
  message: ChatMessage;
  disabled?: boolean;
  onReact: (emoji: ChatReactionEmoji, active: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDismiss(open, () => setOpen(false), root, trigger);
  const mine = new Set(message.reactions.filter((r) => r.mine).map((r) => r.emoji));
  return (
    <div className="chat-reactions" ref={root}>
      {message.reactions.map((reaction) => {
        const who = t('commReactionWho', {
          emoji: reaction.emoji,
          names: reaction.names.join(', '),
        });
        return (
          <button
            key={reaction.emoji}
            type="button"
            className={`chat-reaction ${reaction.mine ? 'chat-reaction-mine' : ''}`}
            aria-pressed={reaction.mine}
            aria-label={who}
            title={who}
            disabled={disabled}
            onClick={() => onReact(reaction.emoji, !reaction.mine)}
          >
            <span aria-hidden="true">{reaction.emoji}</span>
            <span aria-hidden="true">{reaction.count}</span>
          </button>
        );
      })}
      <div className="emoji-popover-root">
        <button
          ref={trigger}
          type="button"
          className="chat-reaction chat-reaction-add"
          aria-label={`${t('commReactionAdd')}: ${message.authorName}`}
          title={t('commReactionAdd')}
          aria-expanded={open}
          aria-controls={id}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          <SmilePlus size={16} />
        </button>
        {open && (
          <div
            id={id}
            className="emoji-popover chat-reaction-menu"
            role="group"
            aria-label={t('commReactionAdd')}
          >
            {chatReactionEmojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-option"
                aria-pressed={mine.has(emoji)}
                onClick={() => {
                  onReact(emoji, !mine.has(emoji));
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
