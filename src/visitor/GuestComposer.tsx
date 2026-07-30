import type { ChangeEvent, FormEvent, KeyboardEvent, RefObject } from 'react';
import type { ChatMessage } from '../chatModel';

type GuestComposerProps = {
  quote: ChatMessage | null;
  uploadRef: RefObject<HTMLInputElement | null>;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  disabled: boolean;
  imageUploading: boolean;
  canSubmit: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancelQuote: () => void;
  onUploadChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTextChange: (value: string) => void;
  onTextFocus: () => void;
  onTextKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export default function GuestComposer({
  quote,
  uploadRef,
  messageInputRef,
  text,
  disabled,
  imageUploading,
  canSubmit,
  onSubmit,
  onCancelQuote,
  onUploadChange,
  onTextChange,
  onTextFocus,
  onTextKeyDown,
}: GuestComposerProps) {
  return (
    <form className="composer" autoComplete="off" onSubmit={onSubmit}>
      {quote && <div className="quote-compose" style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: 8, color: 'var(--muted)', fontSize: 12 }}>{quote.status === 'recalled' ? '消息已撤回' : quote.message_type === 'image' ? '[图片]' : (quote.content || '').slice(0, 60)} <button type="button" onClick={onCancelQuote} style={{ minHeight: 'auto', padding: '3px 8px', borderRadius: 8, fontSize: 12, background: '#64748b' }}>取消</button></div>}
      <label className="upload-btn"><input ref={uploadRef} type="file" name="image" accept="image/jpeg,image/png,image/webp" disabled={disabled || imageUploading} onChange={onUploadChange} />📎</label>
      <textarea ref={messageInputRef} name="message" autoComplete="off" value={text} onFocus={onTextFocus} onChange={event => onTextChange(event.target.value)} onKeyDown={onTextKeyDown} disabled={disabled} placeholder="输入消息" rows={1} />
      <button type="submit" className="send-btn" onMouseDown={event => event.preventDefault()} disabled={!canSubmit}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg></button>
    </form>
  );
}
