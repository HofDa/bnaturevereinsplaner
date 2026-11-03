import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  ArrowLeft,
  Plus,
  Newspaper,
  ChartColumn,
  Pin,
  Pencil,
  Send,
  Archive,
  CircleStop,
  MessagesSquare,
} from 'lucide-react';
import {
  communityInputSchema,
  type CommunityPost,
  type ChatMessage,
  type ChatReactionEmoji,
  type Page,
} from '@bnature/contracts';
import { api, errorMessage, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import { useFinancialWrite } from './finance/client';
import { ChatReactions, EmojiPicker } from './community-emoji';
import {
  Button,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  Notice,
  PageHeading,
  Pagination,
} from '../components/ui';

type Kind = 'news' | 'poll';
type Text = { de: string; it: string };
const lang = (language: string) => (language.startsWith('it') ? ('it' as const) : ('de' as const));
const refresh = () => queryClient.invalidateQueries({ queryKey: ['community'] });
function Audience({ post }: { post: CommunityPost }) {
  const { t } = useTranslation();
  return <span className="subtle-tag">{post.groupName ?? t('commWholeClub')}</span>;
}
function Metadata({ post }: { post: CommunityPost }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="community-metadata">
      <Audience post={post} />
      <span>{post.authorName}</span>
      <time dateTime={post.publishedAt ?? post.createdAt}>
        {new Date(post.publishedAt ?? post.createdAt).toLocaleDateString(i18n.language)}
      </time>
      {post.pinned && (
        <span className="community-pinned">
          <Pin size={13} />
          {t('commPinned')}
        </span>
      )}
    </div>
  );
}
function CommunityEditor({
  kind,
  post,
  onClose,
  onSaved,
}: {
  kind: Kind;
  post?: CommunityPost;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { me } = useSession();
  const write = useFinancialWrite();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [options, setOptions] = useState<Text[]>(
    post?.options.map((option) => option.labelI18n) ?? [
      { de: '', it: '' },
      { de: '', it: '' },
    ],
  );
  const audiences = useQuery({
    queryKey: ['community', 'audiences', me.activeOrganizationId],
    queryFn: () => api<{ groups: { id: string; name: string }[] }>('/community/audiences'),
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const input = {
      kind,
      titleI18n: { de: form.get('titleDe'), it: form.get('titleIt') },
      bodyI18n: { de: form.get('bodyDe'), it: form.get('bodyIt') },
      groupId: form.get('groupId') || null,
      pinned: form.has('pinned'),
      ...(kind === 'poll'
        ? {
            options,
            closesAt: form.get('closesAt')
              ? new Date(String(form.get('closesAt'))).toISOString()
              : null,
            resultsVisibility: form.get('resultsVisibility'),
          }
        : {}),
    };
    try {
      const parsed = communityInputSchema.parse(input);
      setBusy(true);
      const result = await write<{ id: string }>(
        post ? `/community/posts/${post.id}` : '/community/posts',
        post ? { version: post.version, content: parsed } : parsed,
        post ? 'PATCH' : 'POST',
      );
      await refresh();
      onSaved(result.id);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  const deadline = post?.closesAt
    ? (() => {
        const date = new Date(post.closesAt!);
        return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 16);
      })()
    : '';
  return (
    <Modal
      wide
      title={t(post ? 'commEdit' : kind === 'news' ? 'commCreateNews' : 'commCreatePoll')}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        {post?.state !== 'published' && <p className="form-help">{t('commDraftHint')}</p>}
        <div className="form-grid">
          <Field label={t('commAudience')}>
            <select
              name="groupId"
              defaultValue={post?.groupId ?? ''}
              disabled={post?.state === 'published'}
            >
              <option value="">{t('commWholeClub')}</option>
              {post?.groupId && !audiences.data?.groups.some((g) => g.id === post.groupId) && (
                <option value={post.groupId}>{post.groupName}</option>
              )}
              {audiences.data?.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>
          {post?.state === 'published' && (
            <input type="hidden" name="groupId" value={post.groupId ?? ''} />
          )}
          <Field label={t('commPinned')}>
            <input type="checkbox" name="pinned" defaultChecked={post?.pinned ?? false} />
          </Field>
        </div>
        {audiences.isError && <ErrorState error={audiences.error} />}
        <div className="community-language-fields">
          {(['de', 'it'] as const).map((language) => (
            <fieldset key={language}>
              <legend>{language === 'de' ? 'Deutsch' : 'Italiano'}</legend>
              <Field
                label={`${t(kind === 'news' ? 'commTitleField' : 'commQuestion')} (${language.toUpperCase()})`}
              >
                <input
                  name={language === 'de' ? 'titleDe' : 'titleIt'}
                  maxLength={200}
                  required
                  defaultValue={post?.titleI18n[language] ?? ''}
                />
              </Field>
              <Field
                label={`${t(kind === 'news' ? 'commBodyField' : 'commDescription')} (${language.toUpperCase()})`}
              >
                <textarea
                  name={language === 'de' ? 'bodyDe' : 'bodyIt'}
                  rows={6}
                  maxLength={10_000}
                  required={kind === 'news'}
                  defaultValue={post?.bodyI18n[language] ?? ''}
                />
              </Field>
            </fieldset>
          ))}
        </div>
        {kind === 'poll' && (
          <>
            <fieldset>
              <legend>{t('commOptions')}</legend>
              <p className="form-help">{t('commOptionsHint')}</p>
              {options.map((option, index) => (
                <div className="community-option-editor" key={index}>
                  <div className="form-grid">
                    {(['de', 'it'] as const).map((language) => (
                      <Field
                        key={language}
                        label={`${t('commOption')} ${index + 1} (${language.toUpperCase()})`}
                      >
                        <input
                          value={option[language]}
                          maxLength={200}
                          required
                          onChange={(event) =>
                            setOptions((current) =>
                              current.map((value, i) =>
                                i === index ? { ...value, [language]: event.target.value } : value,
                              ),
                            )
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  {options.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`${t('commRemoveOption')} ${index + 1}`}
                      onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                    >
                      {t('commRemoveOption')}
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                disabled={options.length >= 10}
                onClick={() => setOptions((current) => [...current, { de: '', it: '' }])}
              >
                <Plus size={16} />
                {t('commAddOption')}
              </Button>
            </fieldset>
            <div className="form-grid">
              <Field label={t('commDeadline')} hint={t('commDeadlineHint')}>
                <input type="datetime-local" name="closesAt" defaultValue={deadline} />
              </Field>
              <Field label={t('commResultsPolicy')}>
                <select
                  name="resultsVisibility"
                  defaultValue={post?.resultsVisibility ?? 'after_vote'}
                >
                  <option value="after_vote">{t('commAfterVote')}</option>
                  <option value="after_close">{t('commAfterClose')}</option>
                </select>
              </Field>
            </div>
          </>
        )}
        {error != null && (
          <Notice error>
            {error instanceof z.ZodError
              ? t(
                  error.issues.some((issue) => issue.message === 'communityDuplicateOptions')
                    ? 'communityDuplicateOptions'
                    : 'validation',
                )
              : errorMessage(error)}
          </Notice>
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={busy || audiences.isPending}>
            {t(busy ? 'saving' : post?.state === 'published' ? 'save' : 'commSaveDraft')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CommunityIndex() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const kind: Kind | 'chat' =
    params.get('kind') === 'chat' ? 'chat' : params.get('kind') === 'poll' ? 'poll' : 'news';
  const state = ['draft', 'archived'].includes(params.get('state') ?? '')
    ? params.get('state')!
    : 'published';
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1));
  const groupId = params.get('groupId') ?? '';
  const canManage = me.permissions.includes('community:manage');
  const [creating, setCreating] = useState(false);
  const audiences = useQuery({
    queryKey: ['community', 'audiences', me.activeOrganizationId],
    queryFn: () => api<{ groups: { id: string; name: string }[] }>('/community/audiences'),
  });
  const query = new URLSearchParams({
    kind,
    state,
    page: String(page),
    ...(groupId ? { groupId } : {}),
  });
  const posts = useQuery({
    queryKey: ['community', 'posts', me.activeOrganizationId, query.toString()],
    queryFn: () => api<Page<CommunityPost>>(`/community/posts?${query}`),
    enabled: kind !== 'chat',
  });
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  }
  return (
    <>
      <PageHeading
        title={t('commTitle')}
        description={t('commIntro')}
        actions={
          canManage &&
          kind !== 'chat' && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={17} />
              {t(kind === 'news' ? 'commCreateNews' : 'commCreatePoll')}
            </Button>
          )
        }
      />
      <div className="community-tabs" role="tablist" aria-label={t('commTitle')}>
        {(['news', 'poll', 'chat'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={kind === value}
            id={`community-tab-${value}`}
            aria-controls="community-panel"
            tabIndex={kind === value ? 0 : -1}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const tabs = ['news', 'poll', 'chat'] as const;
              const index = tabs.indexOf(value);
              const next =
                event.key === 'Home'
                  ? 'news'
                  : event.key === 'End'
                    ? 'chat'
                    : tabs[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3]!;
              filter('kind', next);
              document.getElementById(`community-tab-${next}`)?.focus();
            }}
            className={kind === value ? 'active' : ''}
            onClick={() => filter('kind', value)}
          >
            {value === 'news' ? (
              <Newspaper size={18} />
            ) : value === 'poll' ? (
              <ChartColumn size={18} />
            ) : (
              <MessagesSquare size={18} />
            )}
            {t(value === 'news' ? 'commNews' : value === 'poll' ? 'commPolls' : 'commChat')}
          </button>
        ))}
      </div>
      <div className="community-filters">
        <Field label={t('commFilterAudience')}>
          <select value={groupId} onChange={(e) => filter('groupId', e.target.value)}>
            <option value="">{t(kind === 'chat' ? 'commWholeClub' : 'commAllAudiences')}</option>
            {audiences.data?.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        {canManage && kind !== 'chat' && (
          <Field label={t('status')}>
            <select value={state} onChange={(e) => filter('state', e.target.value)}>
              <option value="published">{t('commState_published')}</option>
              <option value="draft">{t('commState_draft')}</option>
              <option value="archived">{t('commState_archived')}</option>
            </select>
          </Field>
        )}
      </div>
      <section id="community-panel" role="tabpanel" aria-labelledby={`community-tab-${kind}`}>
        {kind === 'chat' ? (
          <CommunityChat key={`${me.activeOrganizationId}:${groupId}`} groupId={groupId || null} />
        ) : posts.isPending ? (
          <Loading />
        ) : posts.isError ? (
          <ErrorState error={posts.error} />
        ) : !posts.data.items.length ? (
          <div className="panel">
            <Empty
              title={t(kind === 'news' ? 'commEmptyNews' : 'commEmptyPolls')}
              description={t('commEmptyHint')}
            />
          </div>
        ) : (
          <>
            <div className="community-feed">
              {posts.data.items.map((post) => (
                <article
                  className={`panel community-card ${post.pinned ? 'community-card-pinned' : ''}`}
                  key={post.id}
                >
                  <Metadata post={post} />
                  <h2>
                    <Link to={`/community/${post.id}`}>{post.titleI18n[lang(i18n.language)]}</Link>
                  </h2>
                  <p className="community-excerpt">
                    {post.bodyI18n[lang(i18n.language)].slice(0, 240)}
                    {post.bodyI18n[lang(i18n.language)].length > 240 ? '…' : ''}
                  </p>
                  <div className="community-card-footer">
                    <span>
                      {post.state !== 'published'
                        ? t(`commState_${post.state}`)
                        : post.kind === 'poll'
                          ? t(
                              post.isClosed
                                ? 'commClosed'
                                : post.myOptionId
                                  ? 'commVoted'
                                  : 'commOpen',
                            )
                          : ''}
                    </span>
                    <Link className="button button-secondary" to={`/community/${post.id}`}>
                      {t(
                        post.kind === 'news'
                          ? 'commReadNews'
                          : post.isClosed
                            ? 'commViewResults'
                            : 'commOpenPoll',
                      )}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
            <Pagination
              page={page}
              pageSize={12}
              total={posts.data.total}
              onChange={(next) => {
                const q = new URLSearchParams(params);
                q.set('page', String(next));
                setParams(q);
              }}
            />
          </>
        )}
      </section>
      {creating && kind !== 'chat' && (
        <CommunityEditor
          key={kind}
          kind={kind}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            navigate(`/community/${id}`);
          }}
        />
      )}
    </>
  );
}

function CommunityChat({ groupId }: { groupId: string | null }) {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const write = useFinancialWrite();
  const [before, setBefore] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [removing, setRemoving] = useState<ChatMessage | null>(null);
  const attempt = useRef<{ text: string; key: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const [reacting, setReacting] = useState<string | null>(null);
  const q = new URLSearchParams({ ...(groupId ? { groupId } : {}), ...(before ? { before } : {}) });
  const query = useQuery({
    queryKey: ['community', 'chat', me.activeOrganizationId, groupId, before],
    queryFn: () => api<{ items: ChatMessage[]; nextBefore: string | null }>(`/community/chat?${q}`),
    refetchInterval: before ? false : 5000,
  });
  const lastId = query.data?.items.at(-1)?.id;
  useEffect(() => {
    if (!before && follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lastId, before]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    const body = text.trim();
    if (attempt.current?.text !== body) attempt.current = { text: body, key: crypto.randomUUID() };
    try {
      await api('/community/chat', {
        method: 'POST',
        body: JSON.stringify({ groupId, body }),
        headers: { 'Idempotency-Key': attempt.current.key },
      });
      attempt.current = null;
      setText('');
      setBefore(null);
      follow.current = true;
      await queryClient.invalidateQueries({ queryKey: ['community', 'chat'] });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function react(message: ChatMessage, emoji: ChatReactionEmoji, active: boolean) {
    setReacting(message.id);
    setError(null);
    try {
      await write(`/community/chat/${message.id}/reactions`, { emoji, active }, 'PUT');
      await queryClient.invalidateQueries({ queryKey: ['community', 'chat'] });
    } catch (error) {
      setError(error);
    } finally {
      setReacting(null);
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await write(`/community/chat/${removing.id}/remove`, { version: removing.version });
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: ['community', 'chat'] });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel community-chat" aria-label={t('commChat')}>
      <div className="community-chat-heading">
        <h2>{t('commChat')}</h2>
        <p>{t('commChatHint')}</p>
      </div>
      <div className="community-chat-pages">
        {before && (
          <Button
            variant="secondary"
            onClick={() => {
              setBefore(null);
              follow.current = true;
            }}
          >
            {t('commChatLatest')}
          </Button>
        )}
        {query.data?.nextBefore && (
          <Button variant="ghost" onClick={() => setBefore(query.data!.nextBefore)}>
            {t('commChatOlder')}
          </Button>
        )}
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : (
        <div
          ref={log}
          className="community-chat-log"
          role="log"
          aria-label={t('commChatMessages')}
          tabIndex={0}
          onScroll={() => {
            if (log.current)
              follow.current =
                log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 100;
          }}
        >
          {!query.data.items.length ? (
            <Empty title={t('commChatEmpty')} />
          ) : (
            query.data.items.map((message) => (
              <article
                key={message.id}
                className={`community-chat-message ${message.isOwn ? 'community-chat-own' : ''}`}
                aria-label={`${message.authorName}: ${new Date(message.createdAt).toLocaleString(i18n.language)}`}
              >
                <header>
                  <strong>{message.authorName}</strong>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleString(i18n.language)}
                  </time>
                </header>
                <p className={message.removedAt ? 'community-chat-removed' : ''}>
                  {message.removedAt ? t('commChatRemoved') : message.body}
                </p>
                {!message.removedAt && (
                  <ChatReactions
                    message={message}
                    disabled={reacting === message.id}
                    onReact={(emoji, active) => void react(message, emoji, active)}
                  />
                )}
                {message.canRemove && (
                  <Button
                    variant="ghost"
                    aria-label={`${t('commChatRemove')}: ${message.authorName}`}
                    onClick={() => setRemoving(message)}
                  >
                    {t('commChatRemove')}
                  </Button>
                )}
              </article>
            ))
          )}
        </div>
      )}
      {error != null && !removing && <Notice error>{errorMessage(error)}</Notice>}
      <form className="community-chat-compose" onSubmit={(event) => void send(event)}>
        <Field label={t('commChatMessage')} hint={t('commChatKeyboard')}>
          <textarea
            ref={input}
            rows={3}
            maxLength={2000}
            value={text}
            required
            disabled={busy || query.isError}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </Field>
        <div className="form-actions">
          <EmojiPicker
            target={input}
            value={text}
            maxLength={2000}
            disabled={busy || query.isError}
            onChange={setText}
          />
          <small>{text.length}/2000</small>
          <Button disabled={busy || !text.trim() || query.isError}>
            <Send size={16} />
            {t(busy ? 'saving' : 'commChatSend')}
          </Button>
        </div>
      </form>
      {removing && (
        <Modal
          title={t('commChatRemove')}
          onClose={() => {
            if (!busy) {
              setRemoving(null);
              setError(null);
            }
          }}
        >
          <p>{t('commChatRemoveConfirm')}</p>
          <p>{removing.body.slice(0, 160)}</p>
          {error != null && <Notice error>{errorMessage(error)}</Notice>}
          <div className="form-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setRemoving(null);
                setError(null);
              }}
            >
              {t('cancel')}
            </Button>
            <Button disabled={busy} onClick={() => void remove()}>
              {t('commConfirm')}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function PollBallot({ post }: { post: CommunityPost }) {
  const { t, i18n } = useTranslation();
  const write = useFinancialWrite();
  const [selected, setSelected] = useState(post.myOptionId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function vote(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await write(
        `/community/posts/${post.id}/vote`,
        { version: post.version, optionId: selected },
        'PUT',
      );
      await refresh();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="community-ballot" onSubmit={(event) => void vote(event)}>
      <fieldset>
        <legend>{t(post.canVote ? 'commChooseAnswer' : 'commOptions')}</legend>
        {post.options.map((option) => {
          const percent = post.totalVotes
            ? Math.round(((option.votes ?? 0) * 100) / post.totalVotes)
            : 0;
          return (
            <div
              key={option.id}
              className={`community-answer ${post.myOptionId === option.id ? 'community-answer-own' : ''}`}
            >
              {post.canVote ? (
                <label>
                  <input
                    type="radio"
                    name="answer"
                    value={option.id}
                    checked={selected === option.id}
                    onChange={() => setSelected(option.id)}
                    disabled={busy}
                    required
                  />
                  <span>{option.labelI18n[lang(i18n.language)]}</span>
                </label>
              ) : (
                <p>{option.labelI18n[lang(i18n.language)]}</p>
              )}
              {post.myOptionId === option.id && <small>{t('commYourAnswer')}</small>}
              {post.resultsVisible && (
                <div className="community-result">
                  <div className="community-result-label">
                    <span>{t('commVoteCount', { count: option.votes ?? 0 })}</span>
                    <span>{percent}%</span>
                  </div>
                  <div className="community-result-track" aria-hidden="true">
                    <div style={{ width: `${percent}%` }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
      {post.resultsVisible ? (
        <p className="community-total">{t('commTotalVotes', { count: post.totalVotes ?? 0 })}</p>
      ) : (
        <Notice>
          {t(
            post.resultsVisibility === 'after_vote'
              ? 'commResultsAfterVote'
              : 'commResultsAfterClose',
          )}
        </Notice>
      )}
      <p className="community-hint">{t('commVotePrivacy')}</p>
      {error != null && <Notice error>{errorMessage(error)}</Notice>}
      {post.canVote && (
        <Button disabled={busy || !selected || selected === post.myOptionId}>
          {t(busy ? 'saving' : post.myOptionId ? 'commChangeVote' : 'commSubmitVote')}
        </Button>
      )}
    </form>
  );
}

export function CommunityDetail() {
  const { id = '' } = useParams();
  const { me } = useSession();
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'archive' | 'close' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const write = useFinancialWrite();
  const query = useQuery({
    queryKey: ['community', 'post', me.activeOrganizationId, id],
    queryFn: () => api<CommunityPost>(`/community/posts/${id}`),
    refetchInterval: 15_000,
  });
  const post = query.data;
  async function act() {
    if (!post || !confirm) return;
    setBusy(true);
    setError(null);
    try {
      await write(`/community/posts/${id}/${confirm}`, { version: post.version });
      setConfirm(null);
      await refresh();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" to={`/community?kind=${post?.kind ?? 'news'}`}>
        <ArrowLeft size={16} />
        {t('commBack')}
      </Link>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : (
        post && (
          <>
            <PageHeading
              title={post.titleI18n[lang(i18n.language)]}
              description={t(post.kind === 'news' ? 'commNews' : 'commPolls')}
              actions={
                post.canManage &&
                post.state !== 'archived' && (
                  <>
                    {(post.kind === 'news' || post.state === 'draft') && (
                      <Button variant="secondary" onClick={() => setEditing(true)}>
                        <Pencil size={16} />
                        {t('edit')}
                      </Button>
                    )}
                    {post.state === 'draft' && (
                      <Button onClick={() => setConfirm('publish')}>
                        <Send size={16} />
                        {t('commPublish')}
                      </Button>
                    )}
                    {post.kind === 'poll' && post.state === 'published' && !post.isClosed && (
                      <Button variant="secondary" onClick={() => setConfirm('close')}>
                        <CircleStop size={16} />
                        {t('commClosePoll')}
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setConfirm('archive')}>
                      <Archive size={16} />
                      {t('commArchive')}
                    </Button>
                  </>
                )
              }
            />
            <article className="panel community-detail">
              <Metadata post={post} />
              {post.state !== 'published' && <Notice>{t(`commState_${post.state}`)}</Notice>}
              {post.kind === 'poll' && (
                <div className="community-poll-status">
                  <span className="subtle-tag">
                    {t(
                      post.isClosed
                        ? 'commClosed'
                        : post.state === 'draft'
                          ? 'commState_draft'
                          : 'commOpen',
                    )}
                  </span>
                  {post.closesAt && (
                    <span>
                      {t('commEndsAt')}:{' '}
                      <time dateTime={post.closesAt}>
                        {new Date(post.closesAt).toLocaleString(i18n.language)}
                      </time>
                    </span>
                  )}
                </div>
              )}
              {!!post.bodyI18n[lang(i18n.language)] && (
                <div className="community-body">{post.bodyI18n[lang(i18n.language)]}</div>
              )}
              {post.kind === 'poll' && (
                <PollBallot
                  key={`${post.id}:${post.version}:${post.myOptionId ?? ''}`}
                  post={post}
                />
              )}
            </article>
            {editing && (
              <CommunityEditor
                post={post}
                kind={post.kind}
                onClose={() => setEditing(false)}
                onSaved={() => setEditing(false)}
              />
            )}
            {confirm && (
              <Modal
                title={t(
                  confirm === 'publish'
                    ? 'commPublish'
                    : confirm === 'archive'
                      ? 'commArchive'
                      : 'commClosePoll',
                )}
                onClose={() => {
                  if (!busy) {
                    setConfirm(null);
                    setError(null);
                  }
                }}
              >
                <p>
                  {t(
                    confirm === 'publish'
                      ? 'commPublishConfirm'
                      : confirm === 'archive'
                        ? 'commArchiveConfirm'
                        : 'commCloseConfirm',
                  )}
                </p>
                <p>
                  <strong>{post.groupName ?? t('commWholeClub')}</strong>
                </p>
                {error != null && <Notice error>{errorMessage(error)}</Notice>}
                <div className="form-actions">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setConfirm(null);
                      setError(null);
                    }}
                  >
                    {t('cancel')}
                  </Button>
                  <Button disabled={busy} onClick={() => void act()}>
                    {t(busy ? 'saving' : 'commConfirm')}
                  </Button>
                </div>
              </Modal>
            )}
          </>
        )
      )}
    </>
  );
}
