import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

/**
 * Buffer text input locally so keystrokes don't cause a settings-wide
 * re-render (and optionally a server RPC round-trip) on every character.
 * `onCommit` fires on blur, on Enter, when the focused input unmounts, or before
 * the page exits.
 *
 * The draft resynchronizes from the upstream `value` only when the input
 * is not focused, so an external push (e.g. an optimistic settings
 * update from the user's own commit, or a reset to defaults) doesn't
 * clobber an in-progress edit.
 *
 * Returns a bag of props that should be spread onto an `<Input>`:
 *
 *   const bag = useCommitOnBlur(instance.displayName ?? "", (next) => {...});
 *   <Input {...bag} placeholder="e.g. Work" />
 */
export function useCommitOnBlur(value: string, onCommit: (next: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const valueRef = useRef(value);
  const onCommitRef = useRef(onCommit);

  valueRef.current = value;
  onCommitRef.current = onCommit;

  useEffect(() => {
    const commitPendingDraft = () => {
      const pendingDraft = draftRef.current;
      draftRef.current = null;
      if (pendingDraft !== null && pendingDraft !== valueRef.current) {
        onCommitRef.current(pendingDraft);
      }
    };

    window.addEventListener("pagehide", commitPendingDraft);
    return () => {
      window.removeEventListener("pagehide", commitPendingDraft);
      commitPendingDraft();
    };
  }, []);

  return {
    value: draft ?? value,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      draftRef.current = next;
      setDraft(next);
    },
    onFocus: () => {
      draftRef.current = value;
      setDraft(value);
    },
    onBlur: () => {
      const next = draftRef.current ?? valueRef.current;
      draftRef.current = null;
      setDraft(null);
      if (next !== valueRef.current) {
        onCommitRef.current(next);
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        (event.target as HTMLInputElement).blur();
      }
    },
  };
}
