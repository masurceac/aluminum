import { useEffect, useRef } from 'react';

/** Bind a document-level listener once and always call the newest handler.
 * The overlay's keyboard layer closes over nearly all of the app's state; a
 * plain useEffect would have to list every piece of it as a dependency (and
 * re-register on each keystroke). The ref keeps the handler fresh instead. */
export function useDocumentListener<K extends keyof DocumentEventMap>(
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  });
  useEffect(() => {
    const listener = (event: DocumentEventMap[K]): void => saved.current(event);
    document.addEventListener(type, listener, options);
    return () => document.removeEventListener(type, listener, options);
    // options is expected to be a stable literal at every call site
  }, [type, options]);
}
