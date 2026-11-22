import React, { useEffect, useMemo, useState } from 'react';
import { Icon, Layout, NoteList, SearchBox, formatDate, matches } from '../ui.jsx';
import { loadNotes, saveNotes } from './store.js';

const newId = () => Math.random().toString(36).slice(2, 10);

export function DecoyApp({ onSearchEnter }) {
  const [notes, setNotes] = useState(loadNotes);
  const [selectedId, setSelectedId] = useState(() => notes.slice().sort((a, b) => b.updated - a.updated)[0]?.id);
  const [query, setQuery] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => saveNotes(notes), [notes]);

  const sorted = useMemo(() => notes.slice().sort((a, b) => b.updated - a.updated), [notes]);
  const visible = useMemo(
    () => sorted.filter((n) => matches(n, query)).map((n) => ({ ...n, preview: n.body.slice(0, 140) })),
    [sorted, query]
  );
  const current = notes.find((n) => n.id === selectedId);

  const select = (id) => {
    setSelectedId(id);
    setShowEditor(true);
  };
  const create = () => {
    const note = { id: newId(), title: '', body: '', updated: Date.now() };
    setNotes((ns) => [note, ...ns]);
    setQuery('');
    select(note.id);
  };
  const update = (patch) =>
    setNotes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, ...patch, updated: Date.now() } : n)));
  const remove = () => {
    if (!current || !confirm('Delete this note?')) return;
    const rest = notes.filter((n) => n.id !== current.id);
    setNotes(rest);
    setSelectedId(rest.sort((a, b) => b.updated - a.updated)[0]?.id);
    setShowEditor(false);
  };

  const onEnter = () => {
    // Normal behaviour: Enter opens the top result. The phrase check happens
    // silently in the parent and never changes what's on screen.
    if (visible[0]) select(visible[0].id);
    onSearchEnter(query);
  };

  return (
    <Layout
      showEditor={showEditor}
      sidebarHead={
        <div className="sidebar-head">
          <div className="brand-row">
            <h1 className="brand">Notes</h1>
            <button className="icon-btn" onClick={create} title="New note" aria-label="New note">
              {Icon.plus}
            </button>
          </div>
          <SearchBox value={query} onChange={setQuery} onEnter={onEnter} />
        </div>
      }
      list={<NoteList notes={visible} selectedId={selectedId} onSelect={select} emptyText={query ? 'No results' : 'No notes'} />}
      editor={
        current ? (
          <div className="editor">
            <div className="editor-bar">
              <button className="icon-btn mobile-only" onClick={() => setShowEditor(false)} aria-label="Back">
                {Icon.back}
              </button>
              <span className="editor-date">{formatDate(current.updated)}</span>
              <div className="spacer" />
              <button className="icon-btn" onClick={remove} title="Delete note" aria-label="Delete note">
                {Icon.trash}
              </button>
            </div>
            <input
              className="title-input"
              placeholder="Title"
              value={current.title}
              onChange={(e) => update({ title: e.target.value })}
            />
            <textarea
              className="body-input"
              placeholder="Start writing…"
              value={current.body}
              onChange={(e) => update({ body: e.target.value })}
            />
          </div>
        ) : (
          <div className="editor-empty">
            <button className="ghost-btn" onClick={create}>
              {Icon.plus} New note
            </button>
          </div>
        )
      }
    />
  );
}
