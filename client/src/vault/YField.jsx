// A plain <input>/<textarea> bound to a Y.Text. Local typing becomes minimal
// insert/delete ops; remote edits update the field while keeping the caret
// anchored to the same spot in the text.
import React, { useEffect, useRef } from 'react';
import * as Y from 'yjs';

const LOCAL = Symbol('local-input');

export function YField({ ytext, as = 'textarea', onLocalEdit, ...props }) {
  const ref = useRef(null);
  const caret = useRef(null);

  useEffect(() => {
    const el = ref.current;
    el.value = ytext.toString();

    const saveCaret = () => {
      caret.current = [
        Y.createRelativePositionFromTypeIndex(ytext, el.selectionStart ?? 0),
        Y.createRelativePositionFromTypeIndex(ytext, el.selectionEnd ?? 0),
      ];
    };
    const observer = (_event, tr) => {
      if (tr.origin === LOCAL) return;
      el.value = ytext.toString();
      if (document.activeElement === el && caret.current) {
        const a = Y.createAbsolutePositionFromRelativePosition(caret.current[0], ytext.doc);
        const b = Y.createAbsolutePositionFromRelativePosition(caret.current[1], ytext.doc);
        if (a && b) el.setSelectionRange(a.index, b.index);
      }
    };
    ytext.observe(observer);
    const events = ['keyup', 'mouseup', 'select', 'focus', 'touchend'];
    events.forEach((e) => el.addEventListener(e, saveCaret));
    return () => {
      ytext.unobserve(observer);
      events.forEach((e) => el.removeEventListener(e, saveCaret));
    };
  }, [ytext]);

  const onInput = () => {
    const el = ref.current;
    const before = ytext.toString();
    const after = el.value;
    if (before === after) return;
    let start = 0;
    const max = Math.min(before.length, after.length);
    while (start < max && before[start] === after[start]) start++;
    let endB = before.length;
    let endA = after.length;
    while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
      endB--;
      endA--;
    }
    ytext.doc.transact(() => {
      if (endB > start) ytext.delete(start, endB - start);
      if (endA > start) ytext.insert(start, after.slice(start, endA));
      onLocalEdit?.();
    }, LOCAL);
    caret.current = [
      Y.createRelativePositionFromTypeIndex(ytext, el.selectionStart ?? 0),
      Y.createRelativePositionFromTypeIndex(ytext, el.selectionEnd ?? 0),
    ];
  };

  const Tag = as;
  return <Tag ref={ref} onInput={onInput} spellCheck={false} autoComplete="off" {...props} />;
}
