// Shared state for the EAN lists. Lists are stored on this device
// (localStorage), so scanning works without a connection and the server stays
// stateless. A list moves to another device (e.g. the PC at the till) inside
// a share link.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import type { EanList, NewItem } from "../list-types";
import * as store from "./list-store";
import { readStored, writeStored } from "./storage";

const STORE_KEY = "powerean.lists.v1";

export type KnownList = { id: string; name: string; count: number };

interface ListContextValue {
  listId: string | null;
  list: EanList | null;
  /** True until this device's saved lists have been read (first client render). */
  isLoading: boolean;
  knownLists: KnownList[];
  add: (items: NewItem[]) => void;
  setDone: (itemId: string, done: boolean) => void;
  setAllDone: (done: boolean) => void;
  remove: (itemId: string) => void;
  clear: (onlyDone: boolean) => void;
  rename: (name: string) => void;
  startNewList: () => void;
  switchTo: (listId: string) => void;
  /** Builds a share link for the active list. */
  shareLink: () => Promise<string | null>;
  /** Imports a list from a share payload; returns its item count or null if invalid. */
  importShared: (payload: string) => Promise<number | null>;
}

const ListContext = createContext<ListContextValue | null>(null);

function defaultListName() {
  const now = new Date();
  const date = now.toLocaleDateString("nb-NO", { day: "2-digit", month: "2-digit" });
  const time = now.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  return `Liste ${date} ${time}`;
}

export function ListProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<store.ListStore>(store.emptyStore);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Read saved lists after mount (SSR has no localStorage), and follow
  // changes made in another tab of the same app.
  useEffect(() => {
    setState(readStored(STORE_KEY, store.storeSchema, store.emptyStore));
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORE_KEY) setState(readStored(STORE_KEY, store.storeSchema, store.emptyStore));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((next: store.ListStore) => {
    stateRef.current = next;
    setState(next);
    writeStored(STORE_KEY, next);
  }, []);

  const active = useMemo(() => state.lists.find((l) => l.id === state.activeId) ?? null, [state]);

  /** Applies a change to the active list, creating one first when there is none. */
  const update = useCallback(
    (change: (list: EanList) => EanList) => {
      const current = stateRef.current;
      const list =
        current.lists.find((l) => l.id === current.activeId) ?? store.createList(defaultListName());
      commit(store.upsertList(current, change(list)));
    },
    [commit],
  );

  const add = useCallback(
    (items: NewItem[]) => {
      if (items.length === 0) return;
      let full = false;
      update((list) => {
        const result = store.addItems(list, items);
        full = result.full;
        return result.list;
      });
      if (full) toast.warning("Listen er full (1000 EAN). Lag en ny liste.");
    },
    [update],
  );

  const value = useMemo<ListContextValue>(
    () => ({
      listId: active?.id ?? null,
      list: active,
      isLoading: !hydrated,
      knownLists: state.lists.map((l) => ({ id: l.id, name: l.name, count: l.items.length })),
      add,
      setDone: (itemId, done) => update((l) => store.setDone(l, itemId, done)),
      setAllDone: (done) => update((l) => store.setAllDone(l, done)),
      remove: (itemId) => update((l) => store.removeItem(l, itemId)),
      clear: (onlyDone) => update((l) => store.clearItems(l, onlyDone)),
      rename: (name) => update((l) => store.renameList(l, name)),
      startNewList: () =>
        commit(store.upsertList(stateRef.current, store.createList(defaultListName()))),
      switchTo: (id) => {
        const list = stateRef.current.lists.find((l) => l.id === id);
        if (list) commit(store.upsertList(stateRef.current, list));
      },
      shareLink: async () => {
        if (!active) return null;
        return `${window.location.origin}/liste#del=${await store.encodeShare(active)}`;
      },
      importShared: async (payload) => {
        const list = await store.decodeShare(payload);
        if (!list) return null;
        commit(store.upsertList(stateRef.current, list));
        return list.items.length;
      },
    }),
    [active, hydrated, state.lists, add, update, commit],
  );

  return <ListContext.Provider value={value}>{children}</ListContext.Provider>;
}

export function useEanList(): ListContextValue {
  const ctx = useContext(ListContext);
  if (!ctx) throw new Error("useEanList must be used inside <ListProvider>");
  return ctx;
}
