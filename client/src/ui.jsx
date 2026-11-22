// Pieces shared by the everyday notes app and the vault so both look identical.
import React from 'react';

export const Icon = {
  plus: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  clip: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  file: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  ),
};

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function SearchBox({ value, onChange, onEnter }) {
  return (
    <label className="search">
      {Icon.search}
      <input
        type="search"
        placeholder="Search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter?.();
          }
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        aria-label="Search notes"
      />
    </label>
  );
}

export function NoteList({ notes, selectedId, onSelect, emptyText }) {
  if (!notes.length) return <div className="list-empty">{emptyText}</div>;
  return (
    <ul className="note-list">
      {notes.map((n) => (
        <li key={n.id}>
          <button className={`note-item${n.id === selectedId ? ' active' : ''}`} onClick={() => onSelect(n.id)}>
            <span className="note-item-title">{n.title.trim() || 'New note'}</span>
            <span className="note-item-meta">
              <span className="note-item-date">{formatDate(n.updated)}</span>
              <span className="note-item-preview">
                {n.preview.replace(/\s+/g, ' ').trim() || (n.fileCount ? `${n.fileCount} attachment${n.fileCount > 1 ? 's' : ''}` : 'No additional text')}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Two-pane layout; on phones it shows either the list or the editor.
export function Layout({ sidebarHead, list, editor, showEditor }) {
  return (
    <div className={`app${showEditor ? ' show-editor' : ''}`}>
      <aside className="sidebar">
        {sidebarHead}
        <div className="list-scroll">{list}</div>
      </aside>
      <main className="editor-pane">{editor}</main>
    </div>
  );
}

export function matches(note, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle);
}
