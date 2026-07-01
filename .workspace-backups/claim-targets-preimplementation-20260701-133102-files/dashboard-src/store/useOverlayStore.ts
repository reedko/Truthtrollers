// src/store/useOverlayStore.ts
import { create } from "zustand";

type OverlayName =
  | "ref-claims"
  | "link-claims"
  | "verify-claim"
  | "edit-claim"
  | "edit-reference";

type OverlayState = {
  name: OverlayName | null;
  payload?: any;
  open: (name: OverlayName, payload?: any) => void;
  close: () => void;
};

export const useOverlayStore = create<OverlayState>((set) => ({
  name: null,
  payload: undefined,
  open: (name, payload) => set({ name, payload }),
  close: () => set({ name: null, payload: undefined }),
}));
