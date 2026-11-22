import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Icon, Layout, NoteList, SearchBox, formatDate, formatSize, matches } from '../ui.jsx';
import { YField } from './YField.jsx';
import { createNote, listNotes } from './session.js';
import { prepareAndUpload, fileUrl, deleteChunks } from './files.js';
import { allowPickerHide, endPickerHide } from './panic.js';

function useSessionTick(session) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const h = () => force();
    session.notes.observeDeep(h);
    const unsub = session.subscribe(h);
    return () => {
      session.notes.unobserveDeep(h);
      unsub();
    };
  }, [session]);
}

export function VaultApp({ session, onLock }) {
  useSessionTick(session);
  const notes = listNotes(session);
  const [selectedId, setSelectedId] = useState(() => notes[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  const visible = notes.filter((n) => matches(n, query));
  const note = selectedId ? session.notes.get(selectedId) : null;

  const select = (id) => {
    setSelectedId(id);
    setShowEditor(true);
  };
  const create = () => {
    setQuery('');
    select(createNote(session));
  };
  const remove = async () => {
    if (!note || !confirm('Delete this note and its attachments for everyone?')) return;
    const files = note.get('files').toArray();
    session.notes.delete(selectedId);
    setSelectedId(listNotes(session)[0]?.id ?? null);
    setShowEditor(false);
    for (const f of files) deleteChunks(session, f);
  };

  const status = session.online
    ? `Private · ${session.peers} online`
    : 'Private · reconnecting…';

  return (
    <Layout
      showEditor={showEditor}
      sidebarHead={
        <div className="sidebar-head">
          <div className="brand-row">
            <h1 className="brand">Notes</h1>
            <button className={`vault-pill${session.online ? '' : ' offline'}`} onClick={onLock} title="Lock (Esc)">
              {Icon.lock}
              <span>{status}</span>
            </button>
            <button className="icon-btn" onClick={create} title="New note" aria-label="New note">
              {Icon.plus}
            </button>
          </div>
          <SearchBox value={query} onChange={setQuery} onEnter={() => visible[0] && select(visible[0].id)} />
        </div>
      }
      list={
        <NoteList
          notes={visible}
          selectedId={selectedId}
          onSelect={select}
          emptyText={query ? 'No results' : 'Nothing here yet. Press + to add a note.'}
        />
      }
      editor={
        note ? (
          <NoteEditor key={selectedId} session={session} note={note} onBack={() => setShowEditor(false)} onDelete={remove} />
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

function NoteEditor({ session, note, onBack, onDelete }) {
  const files = note.get('files');
  const [uploads, setUploads] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef(null);

  const touch = () => note.set('updated', Date.now());

  const addFiles = (list) => {
    for (const file of Array.from(list)) {
      const key = Math.random().toString(36).slice(2);
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      prepareAndUpload(session, file, (p) =>
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x)))
      )
        .then((meta) => {
          if (session.closed) return;
          session.doc.transact(() => {
            files.push([meta]);
            touch();
          });
          setUploads((u) => u.filter((x) => x.key !== key));
        })
        .catch(() => setUploads((u) => u.map((x) => (x.key === key ? { ...x, failed: true } : x))));
    }
  };

  const removeFile = (meta) => {
    if (!confirm(`Remove ${meta.name} for everyone?`)) return;
    const idx = files.toArray().findIndex((f) => f.id === meta.id);
    if (idx >= 0) session.doc.transact(() => {
      files.delete(idx, 1);
      touch();
    });
    deleteChunks(session, meta);
  };

  const openFile = async (meta) => {
    if (meta.mime.startsWith('image/')) return setViewing(meta);
    const url = await fileUrl(session, meta);
    const a = document.createElement('a');
    a.href = url;
    a.download = meta.name;
    a.click();
  };

  const attached = files.toArray();

  return (
    <div
      className={`editor${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <div className="editor-bar">
        <button className="icon-btn mobile-only" onClick={onBack} aria-label="Back">
          {Icon.back}
        </button>
        <span className="editor-date">{formatDate(note.get('updated'))}</span>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => {
            allowPickerHide();
            window.addEventListener('focus', () => setTimeout(endPickerHide, 1000), { once: true });
            picker.current.click();
          }} title="Attach photos or files" aria-label="Attach">
          {Icon.clip}
        </button>
        <button className="icon-btn" onClick={onDelete} title="Delete note" aria-label="Delete note">
          {Icon.trash}
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            endPickerHide();
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <YField as="input" className="title-input" placeholder="Title" ytext={note.get('title')} onLocalEdit={touch} />
      <YField
        className="body-input"
        placeholder="Start writing…"
        ytext={note.get('body')}
        onLocalEdit={touch}
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            addFiles(e.clipboardData.files);
          }
        }}
      />
      {(attached.length > 0 || uploads.length > 0) && (
        <div className="attachments">
          {attached.map((meta) => (
            <FileTile key={meta.id} session={session} meta={meta} onOpen={() => openFile(meta)} onRemove={() => removeFile(meta)} />
          ))}
          {uploads.map((u) => (
            <div key={u.key} className={`tile uploading${u.failed ? ' failed' : ''}`}>
              <div className="tile-progress">
                <span style={{ width: `${Math.round(u.progress * 100)}%` }} />
              </div>
              <span className="tile-name">{u.failed ? 'Upload failed' : u.name}</span>
            </div>
          ))}
        </div>
      )}
      {dragging && <div className="drop-hint">Drop to attach</div>}
      {viewing && <Lightbox session={session} meta={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function useFileUrl(session, meta, which) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    fileUrl(session, meta, which).then((u) => live && setUrl(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [session, meta.id, which]);
  return url;
}

function FileTile({ session, meta, onOpen, onRemove }) {
  const isImage = meta.mime.startsWith('image/') && meta.thumbChunks;
  return (
    <div className="tile">
      <button className="tile-main" onClick={onOpen} title={meta.name}>
        {isImage ? <Thumb session={session} meta={meta} /> : <span className="tile-icon">{Icon.file}</span>}
        {!isImage && (
          <span className="tile-name">
            {meta.name}
            <small>{formatSize(meta.size)}</small>
          </span>
        )}
      </button>
      <button className="tile-remove" onClick={onRemove} aria-label={`Remove ${meta.name}`}>
        {Icon.close}
      </button>
    </div>
  );
}

function Thumb({ session, meta }) {
  const url = useFileUrl(session, meta, 'thumb');
  return url ? <img className="tile-img" src={url} alt={meta.name} /> : <span className="tile-img loading" />;
}

function Lightbox({ session, meta, onClose }) {
  const url = useFileUrl(session, meta, 'full');
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-name">{meta.name}</span>
        {url && (
          <a className="icon-btn" href={url} download={meta.name} aria-label="Download">
            {Icon.download}
          </a>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          {Icon.close}
        </button>
      </div>
      {url ? <img src={url} alt={meta.name} onClick={(e) => e.stopPropagation()} /> : <div className="spinner" />}
    </div>
  );
}
