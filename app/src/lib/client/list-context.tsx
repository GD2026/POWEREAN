// Shared state for the active EAN list: which list this device uses, the
// server copy (react-query), and an offline queue so a scan in a dead spot of
// the stock room is never lost.
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { z } from "zod";

import {
  addItemsFn,
  clearItemsFn,
  createListFn,
  deleteItemFn,
  getListFn,
  renameListFn,
  setAllDoneFn,
  setItemDoneFn,
} from "../api/powerean.functions";
import type { EanList, NewItem } from "../list-types";
import { readStored, writeStored } from "./storage";

const ACTIVE_KEY = "powerean.activeList";
const PENDING_KEY = "powerean.pending";
const KNOWN_KEY = "powerean.knownLists";

const uuid = z.string().uuid();
const pendingSchema = z.array(
  z.object({
    ean: z.string().regex(/^\d{8,14}$/),
    title: z.string().nullish(),
    price: z.number().nullish(),
    thumbUrl: z.string().nullish(),
    productUrl: z.string().nullish(),
  }),
);
const knownSchema = z.array(z.object({ id: uuid, name: z.string() }));

export type KnownList = z.infer<typeof knownSchema>[number];

interface ListContextValue {
  listId: string | null;
  list: EanList | null | undefined;
  isLoading: boolean;
  pendingCount: number;
  knownLists: KnownList[];
  add: (items: NewItem[]) => Promise<void>;
  setDone: (itemId: string, done: boolean) => void;
  setAllDone: (done: boolean) => void;
  remove: (itemId: string) => void;
  clear: (onlyDone: boolean) => void;
  rename: (name: string) => void;
  startNewList: () => Promise<void>;
  switchTo: (listId: string) => void;
}

const ListContext = createContext<ListContextValue | null>(null);

function defaultListName() {
  const now = new Date();
  return `Liste ${now.toLocaleDateString("nb-NO", { day: "2-digit", month: "2-digit" })} ${now.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}`;
}

function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Noe gikk galt";
}

export function ListProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [listId, setListId] = useState<string | null>(null);
  const [pending, setPending] = useState<NewItem[]>([]);
  const [knownLists, setKnownLists] = useState<KnownList[]>([]);
  const creating = useRef<Promise<string> | null>(null);
  const flushing = useRef(false);

  // Hydrate per-device state after mount (SSR has no localStorage).
  useEffect(() => {
    setListId(readStored(ACTIVE_KEY, uuid.nullable(), null));
    setPending(readStored(PENDING_KEY, pendingSchema, []));
    setKnownLists(readStored(KNOWN_KEY, knownSchema, []));
  }, []);

  const activate = useCallback((id: string | null) => {
    setListId(id);
    writeStored(ACTIVE_KEY, id);
  }, []);

  const query = useQuery({
    queryKey: ["list", listId],
    queryFn: () => getListFn({ data: { listId: listId! } }),
    enabled: listId != null,
    // Keep phone and till PC in sync when both have the list open.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  // A list that no longer exists on the server is forgotten.
  useEffect(() => {
    if (listId && query.isSuccess && query.data === null) activate(null);
  }, [listId, query.isSuccess, query.data, activate]);

  // Remember list names so the user can switch back to an older list.
  useEffect(() => {
    const list = query.data;
    if (!list) return;
    setKnownLists((prev) => {
      const next = [
        { id: list.id, name: list.name },
        ...prev.filter((l) => l.id !== list.id),
      ].slice(0, 10);
      writeStored(KNOWN_KEY, next);
      return next;
    });
  }, [query.data]);

  const setList = useCallback(
    (list: EanList | null) => {
      if (list) queryClient.setQueryData(["list", list.id], list);
    },
    [queryClient],
  );

  const ensureList = useCallback(async (): Promise<string> => {
    if (listId) return listId;
    if (!creating.current) {
      creating.current = createListFn({ data: { name: defaultListName() } })
        .then((list) => {
          setList(list);
          activate(list.id);
          return list.id;
        })
        .finally(() => {
          creating.current = null;
        });
    }
    return creating.current;
  }, [listId, activate, setList]);

  const savePending = useCallback((items: NewItem[]) => {
    setPending(items);
    writeStored(PENDING_KEY, items.length ? items : null);
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    const queued = readStored(PENDING_KEY, pendingSchema, []);
    if (queued.length === 0) return;
    flushing.current = true;
    try {
      const id = await ensureList();
      for (let i = 0; i < queued.length; i += 500) {
        const result = await addItemsFn({ data: { listId: id, items: queued.slice(i, i + 500) } });
        setList(result.list);
        if (result.full) toast.warning("Listen er full (1000 EAN). Lag en ny liste.");
      }
      savePending([]);
    } catch {
      // Still offline: keep the queue for the next attempt.
    } finally {
      flushing.current = false;
    }
  }, [ensureList, savePending, setList]);

  useEffect(() => {
    if (pending.length === 0) return;
    const retry = () => void flush();
    window.addEventListener("online", retry);
    const timer = window.setInterval(retry, 20_000);
    return () => {
      window.removeEventListener("online", retry);
      window.clearInterval(timer);
    };
  }, [pending.length, flush]);

  const add = useCallback(
    async (items: NewItem[]) => {
      if (items.length === 0) return;
      try {
        const id = await ensureList();
        for (let i = 0; i < items.length; i += 500) {
          const result = await addItemsFn({ data: { listId: id, items: items.slice(i, i + 500) } });
          setList(result.list);
          if (result.full) toast.warning("Listen er full (1000 EAN). Lag en ny liste.");
        }
      } catch {
        const queued = readStored(PENDING_KEY, pendingSchema, []);
        const merged = [...queued, ...items.filter((it) => !queued.some((q) => q.ean === it.ean))];
        savePending(merged);
        toast.message("Ingen nett – lagret på telefonen", {
          description: "EAN-ene legges i listen automatisk når du har dekning igjen.",
        });
      }
    },
    [ensureList, savePending, setList],
  );

  // Optimistic edits: update the screen first, then reconcile with the server.
  const mutate = useCallback(
    (patch: (list: EanList) => EanList, request: (id: string) => Promise<EanList | null>) => {
      if (!listId) return;
      const key = ["list", listId];
      const before = queryClient.getQueryData<EanList | null>(key);
      if (before) queryClient.setQueryData(key, patch(before));
      request(listId)
        .then((list) => setList(list))
        .catch((error) => {
          if (before) queryClient.setQueryData(key, before);
          toast.error(errorText(error));
        });
    },
    [listId, queryClient, setList],
  );

  const value = useMemo<ListContextValue>(
    () => ({
      listId,
      list: query.data,
      isLoading: listId != null && query.isLoading,
      pendingCount: pending.length,
      knownLists,
      add,
      setDone: (itemId, done) =>
        mutate(
          (l) => ({ ...l, items: l.items.map((it) => (it.id === itemId ? { ...it, done } : it)) }),
          (id) => setItemDoneFn({ data: { listId: id, itemId, done } }),
        ),
      setAllDone: (done) =>
        mutate(
          (l) => ({ ...l, items: l.items.map((it) => ({ ...it, done })) }),
          (id) => setAllDoneFn({ data: { listId: id, done } }),
        ),
      remove: (itemId) =>
        mutate(
          (l) => ({ ...l, items: l.items.filter((it) => it.id !== itemId) }),
          (id) => deleteItemFn({ data: { listId: id, itemId } }),
        ),
      clear: (onlyDone) =>
        mutate(
          (l) => ({ ...l, items: onlyDone ? l.items.filter((it) => !it.done) : [] }),
          (id) => clearItemsFn({ data: { listId: id, onlyDone } }),
        ),
      rename: (name) =>
        mutate(
          (l) => ({ ...l, name }),
          (id) => renameListFn({ data: { listId: id, name } }),
        ),
      startNewList: async () => {
        const list = await createListFn({ data: { name: defaultListName() } });
        setList(list);
        activate(list.id);
      },
      switchTo: (id) => activate(id),
    }),
    [
      listId,
      query.data,
      query.isLoading,
      pending.length,
      knownLists,
      add,
      mutate,
      setList,
      activate,
    ],
  );

  return <ListContext.Provider value={value}>{children}</ListContext.Provider>;
}

export function useEanList(): ListContextValue {
  const ctx = useContext(ListContext);
  if (!ctx) throw new Error("useEanList must be used inside <ListProvider>");
  return ctx;
}
